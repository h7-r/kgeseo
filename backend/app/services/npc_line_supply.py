"""승인 대사 · 정책 규칙 공급 v0.1 (PM v0.4.3, 순수 함수 · 라우터 미연결).

고정 콘텐츠(`PinnedContent`)와 G1~G3 승인 이력(`approval_history`)에서 NPC 서비스가 쓰는 공급자를 만든다.

- 승인은 늘 승인 이력으로만 정한다. 승인 정보(`approval_source`)가 없으면 모든 대사가 미승인이다(기본 차단).
  콘텐츠 안의 `status` · `approvals`, 개발용 자동 승인 같은 우회 경로는 없다.
- 대체 대사 우선순위(일반 대화 생성이 막혔을 때): 케이스별 `fallback_lines` → 일반 팩 대사.
- 정책 규칙(NG · U)은 npc.json `ng` · `open` 이 둘 다 있을 때만 만든다. 하나라도 없으면 None 이고,
  None 이면 정책 검사가 UNVERIFIED 라 생성 대사는 나가지 않는다.
- 정식 힌트 원문은 여기서 다루지 않는다(server.json → HintSource, LLM 입력에 넣지 않는다).
"""

import hashlib
from collections.abc import Mapping

from app.schemas.npc_content import GeneralLinePack, NpcContentPack
from app.services.approval_history import (
    ApprovalSource,
    ApprovalSourceUnavailableError,
    gate_decisions,
)
from app.services.content_fingerprint import FINGERPRINT_PREFIX, jcs_canonicalize
from app.services.npc_dialogue import GenericLineApproval
from app.services.npc_general_dialogue import ApprovedLine, ApprovedLineProvider
from app.services.npc_generation_policy import NgRule, OpenTopicRule, PolicyRules
from app.services.pinned_content import PinnedContent


def fallback_line_provider(
    bundle: PinnedContent, approval_source: ApprovalSource | None
) -> ApprovedLineProvider:
    """케이스별 승인 대체 대사. 고정 버전이 승인되지 않았으면 모두 approved=False."""

    def provide() -> list[ApprovedLine]:
        pack = bundle.npc()
        if pack is None:
            return []
        approved = bundle.is_approved(approval_source)
        return [
            ApprovedLine(line.line_id, line.text, approved)
            for line in pack.fallback_lines
        ]

    return provide


def policy_rules_from_pack(pack: NpcContentPack | None) -> PolicyRules | None:
    if pack is None or pack.ng is None or pack.open is None:
        return None
    return PolicyRules(
        ng=tuple(
            NgRule(f"ng[{index}]", rule.text, tuple(rule.patterns))
            for index, rule in enumerate(pack.ng)
        ),
        open_topics=tuple(
            # open[]에는 유보 표현 목록이 없다 → 패턴이 맞으면 단정으로 본다(보수적).
            OpenTopicRule(f"open[{index}]", rule.text, tuple(rule.patterns))
            for index, rule in enumerate(pack.open)
        ),
    )


# --- 일반 팩 (계약 준비) ---


def general_pack_fingerprint(pack: GeneralLinePack) -> str:
    """일반 팩 내용 해시. 승인 기록의 target_hash 와 같은 형식("sha256:" + 64 hex)."""

    canonical = jcs_canonicalize(pack.model_dump(mode="json"))
    return FINGERPRINT_PREFIX + hashlib.sha256(canonical).hexdigest()


def general_pack_approved(
    pack: GeneralLinePack, approval_source: ApprovalSource | None
) -> bool:
    if approval_source is None:
        return False
    try:
        records = approval_source(pack.pack_id, pack.pack_version)
    except ApprovalSourceUnavailableError:
        return False
    return gate_decisions(records, general_pack_fingerprint(pack)) == ()


def general_pack_line_provider(
    pack: GeneralLinePack | None, approval_source: ApprovalSource | None
) -> ApprovedLineProvider:
    def provide() -> list[ApprovedLine]:
        if pack is None:
            return []
        approved = general_pack_approved(pack, approval_source)
        return [ApprovedLine(line.line_id, line.text, approved) for line in pack.lines]

    return provide


def generic_line_approval(
    pack: GeneralLinePack | None,
    approval_source: ApprovalSource | None,
    expected_texts: Mapping[str, str],
) -> GenericLineApproval:
    """PM 기본 안내 문구 승인 확인. 승인된 일반 팩에 같은 line_id · 같은 원문이 있을 때만 True."""

    def approved(line_id: str) -> bool:
        if pack is None or not general_pack_approved(pack, approval_source):
            return False
        expected = expected_texts.get(line_id)
        return any(
            line.line_id == line_id and line.text == expected for line in pack.lines
        )

    return approved


# --- 긴급 중단 대체 대사 (PM v0.4.12) ---

# 일반 팩의 「잠시 멈춤」 범주 line_id 접두어(PM v0.4.12, 이름은 🟡 운영하며 조정)
PAUSE_LINE_PREFIX = "GENERIC_PAUSE_"
_PAUSE_SELECTION_DOMAIN = b"kgeseo/npc-generic-pause/v1"


def select_pause_line(
    pack: GeneralLinePack | None,
    approval_source: ApprovalSource | None,
    request_key: str,
) -> ApprovedLine | None:
    """케이스 긴급 중단 때 쓸 승인 일반 대사 하나. 없으면 None(응답 `reply: null`).

    - 공급된 일반 팩이 그 팩 내용(fingerprint)에 대해 G1~G3 승인일 때만 쓴다(`general_pack_approved`).
      케이스 콘텐츠 승인 · 케이스 대사는 쓰지 않는다.
    - 후보는 `line_id`가 `GENERIC_PAUSE_`로 시작하는 대사뿐이고, `line_id` 코드 포인트 순으로 정렬한다.
    - 고르기: SHA-256(도메인 · 팩 fingerprint · 요청 키)의 앞 8바이트(빅 엔디언 정수) mod 후보 수.
      같은 팩 내용 · 같은 요청 키면 프로세스 · 서버가 달라도 같은 대사다(Python `hash()`는 쓰지 않는다).
    - 원문은 팩의 승인 원문 그대로다(만들거나 고치지 않는다).
    """

    if pack is None or not general_pack_approved(pack, approval_source):
        return None
    candidates = sorted(
        (line for line in pack.lines if line.line_id.startswith(PAUSE_LINE_PREFIX)),
        key=lambda line: line.line_id,
    )
    if not candidates:
        return None
    digest = hashlib.sha256(
        b"\0".join(
            (
                _PAUSE_SELECTION_DOMAIN,
                general_pack_fingerprint(pack).encode("ascii"),
                request_key.encode("utf-8"),
            )
        )
    ).digest()
    chosen = candidates[int.from_bytes(digest[:8], "big") % len(candidates)]
    return ApprovedLine(chosen.line_id, chosen.text, True)
