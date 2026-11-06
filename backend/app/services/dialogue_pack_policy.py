"""일반 대사 팩(dialogue_pack) 정책 검사 v0.3 (PM v0.4.15, v0.4.14 §A 확장).

PM 계약: 일반 대사 팩의 사용 조건은 「G3 승인 + 정책 검사 통과」다(v0.4.13 §1). 두 조건은 따로 판정 · 표시한다.
일반 팩 문장은 정해진 원문이라 정적으로 검사한다(v0.4.14 §A). 실행 중에는 기존 NPC 출력 검사가 그대로 돈다.

| 코드 | 검사 | 대상 | 근거 데이터 |
|---|---|---|---|
| GEN-LEAK | 게시 케이스의 정답 · NG · 미공개 단서 · 힌트와 겹침 없음 | 전 문장 | `check_generated_line`(기존 출력 검사) |
| GEN-CASE | 게시 케이스 고유명 없음 | 전 문장 | Client object_name + NPC proper_nouns/aliases |
| GEN-WORD | 기존 금칙어 없음 | 전 문장 | `nickname_policy.forbidden_terms_in` |
| GEN-SYS | 시스템 용어 없음 | `GENERIC_PAUSE_*` | PM 예시 6개(`SYSTEM_TERMS`) |
| GEN-TIME | 복귀 시간 약속 없음 | `GENERIC_PAUSE_*` | PM 예시 3개(`TIME_PROMISES`) |
| GEN-LEN | 80자 이하 | 전 문장 | 코드 포인트 수(`len`) |

[GEN-LEAK] 케이스마다 기존 출력 검사(`npc_generation_policy.check_generated_line`)를 그대로 쓴다. 일반 팩은 어느 세션에서나
나오므로 「아무것도 풀지 · 얻지 · 해금하지 않은 상태」로 본다(모든 정답 · 단서 · 힌트가 미공개). NG는 그 케이스 npc.json
`ng[]`. U 단정(`open[]`)은 v0.4.14 표에 없어 넣지 않는다. 기존 규칙과 같이 정규화(조사 · 공백 · 구두점) 뒤 정답 포함,
미공개 문장과 8자 이상 연속 일치 또는 공개되지 않은 핵심어 2개 이상 겹침, NG 패턴 포함이면 위반이다(짧은 정답도 뺀다
— 기존 규칙). NG 데이터가 없으면(`ng` 없음) 그 케이스는 UNVERIFIED다.

[GEN-CASE] PM v0.4.15: Client object_name과 NPC proper_nouns(person/place, aliases 포함)를 검사한다.
검수 목록이 누락되면 UNVERIFIED이며 빈 배열은 유효하다. 내부 ID는 이름으로 취급하지 않는다.

[GEN-WORD] 닉네임 금칙어 검사와 같은 규칙(NFKC · casefold · "_" 제거 · leet · 부분 포함)을 그대로 쓴다(팀 결정 11/4).
혐오어 목록은 기존에 없다.

[GEN-SYS · GEN-TIME] PM 예시만 쓴다(넓히지 않는다). 공백을 뺀 비교 문자열(`normalize_compact`)에서 찾는다.
「곧」은 한 낱말로 쓰인 경우만(「곧장」 · 「곧바로」는 낱말이 다르다). 「잠시만 기다려 주세요」는 어느 예시와도 맞지 않는다.

[게시 케이스] 호출하는 쪽이 넘긴다. `None`이면 「게시 케이스 전체를 확인할 수 없음」이라 GEN-LEAK · GEN-CASE는 UNVERIFIED다.
빈 목록은 「게시 케이스 없음」이라 두 검사는 PASS다.

[결과] 전체 상태 · 검사별 상태 · 위반 근거(코드 · line_id · 케이스 · 규칙 ID · 맞은 용어)를 담는다. 정답 · 미공개 문장
원문은 담지 않는다. 예외 · 다른 형식의 결과는 UNVERIFIED(fail closed).
"""

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal

from app.schemas.case_content import CaseClientContent
from app.schemas.npc_content import GeneralLinePack, NpcContentPack
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.hint import HintSource
from app.services.nickname_policy import forbidden_terms_in
from app.services.npc_generation_policy import (
    NgRule,
    PolicyRules,
    _contains,
    _forms,
    check_generated_line,
)
from app.services.puzzle_question import normalize_compact, normalize_text

PolicyStatus = Literal["PASS", "FAIL", "UNVERIFIED"]
PolicyCode = Literal[
    "GEN-LEAK", "GEN-CASE", "GEN-WORD", "GEN-SYS", "GEN-TIME", "GEN-LEN"
]
POLICY_CODES: tuple[PolicyCode, ...] = (
    "GEN-LEAK",
    "GEN-CASE",
    "GEN-WORD",
    "GEN-SYS",
    "GEN-TIME",
    "GEN-LEN",
)
# 「잠시 멈춤」 범주(PM v0.4.12). npc_line_supply.PAUSE_LINE_PREFIX와 같다.
PAUSE_LINE_PREFIX = "GENERIC_PAUSE_"
MAX_LINE_LENGTH = 80
# PM v0.4.14 §A 예시 그대로
SYSTEM_TERMS = ("오류", "서버", "점검", "버그", "연결", "시스템")
TIME_PROMISES = ("곧", "몇 분", "잠시 뒤 돌아")
# 출력 검사 위반 코드 → GEN-LEAK 근거(U_ASSERT는 v0.4.14 대상이 아니다)
_LEAK_CODES = frozenset({"ANSWER", "LEAK_CLUE", "LEAK_HINT", "NG"})


@dataclass(frozen=True)
class PolicyFinding:
    code: PolicyCode
    status: Literal["FAIL", "UNVERIFIED"]
    # 위반 문장(케이스 단위 확인 불가면 None)
    line_id: str | None
    # 근거: "ANSWER:case@v1:P01" · "term:서버" · "length:93" · "published_cases_unavailable" 등(원문 없음)
    detail: str


@dataclass(frozen=True)
class PackPolicyResult:
    status: PolicyStatus
    # 요약 이유 코드
    reason: str
    checks: tuple[tuple[PolicyCode, PolicyStatus], ...] = ()
    findings: tuple[PolicyFinding, ...] = ()

    @property
    def passed(self) -> bool:
        return self.status == "PASS"

    def check(self, code: PolicyCode) -> PolicyStatus | None:
        return dict(self.checks).get(code)


@dataclass(frozen=True)
class PublishedCase:
    """GEN-LEAK · GEN-CASE 대조용 게시 케이스 하나(검증된 게시본에서 만든다)."""

    case_id: str
    content_version: int
    runtime: PuzzleRuntimeDefinition
    npc: NpcContentPack | None
    hint_source: HintSource
    # 계약된 고유명 목록. 없으면 None(GEN-CASE UNVERIFIED)
    proper_names: tuple[str, ...] | None = None

    @property
    def label(self) -> str:
        return f"{self.case_id}@v{self.content_version}"


def collect_proper_names(
    client: CaseClientContent, npc: NpcContentPack | None
) -> tuple[str, ...] | None:
    """검증된 Client의 표시 이름과 NPC 인물/장소 및 별칭만 수집한다.

    현재 Client는 퍼즐/단서를 별도 이름 필드 없이 interaction 대상 object로
    표시한다. object_name만 읽고 object_id/target_id/zone_name은 읽지 않는다.
    수동 검수 목록이 없으면 자동 수집 결과만으로 PASS시키지 않는다.
    """
    if npc is None or npc.proper_nouns is None:
        return None
    return tuple(
        dict.fromkeys(
            [
                *(
                    name
                    for noun in npc.proper_nouns
                    for name in (noun.text, *noun.aliases)
                ),
                *(obj.object_name for zone in client.zones for obj in zone.objects),
            ]
        )
    )


DialoguePackPolicy = Callable[[GeneralLinePack], PackPolicyResult]


def check_dialogue_pack(
    pack: GeneralLinePack, published: Sequence[PublishedCase] | None
) -> PackPolicyResult:
    findings: list[PolicyFinding] = []
    for line in pack.lines:
        findings += _static_findings(line.line_id, line.text)
    if published is None:
        for code in ("GEN-LEAK", "GEN-CASE"):
            findings.append(
                PolicyFinding(code, "UNVERIFIED", None, "published_cases_unavailable")
            )
    else:
        for case in published:
            findings += case_conflicts(pack, case)
    return _result(findings)


def case_conflicts(pack: GeneralLinePack, case: PublishedCase) -> list[PolicyFinding]:
    """한 게시 케이스와의 GEN-LEAK · GEN-CASE(새 케이스 게시 때 다시 대조하는 두 검사)."""

    findings: list[PolicyFinding] = []
    ng = case.npc.ng if case.npc is not None else None
    if ng is None:
        findings.append(
            PolicyFinding("GEN-LEAK", "UNVERIFIED", None, f"ng_rules:{case.label}")
        )
    rules = PolicyRules(
        ng=tuple(
            NgRule(f"ng[{index}]", rule.text, tuple(rule.patterns))
            for index, rule in enumerate(ng or ())
        ),
        open_topics=(),
    )
    for line in pack.lines:
        result = check_generated_line(
            line.text,
            case_id=case.case_id,
            runtime=case.runtime,
            state={},
            hint_source=case.hint_source,
            rules=rules,
        )
        for violation in result.violations:
            detail = f"{violation.code}:{case.label}:{violation.rule_id}"
            if violation.code in _LEAK_CODES:
                findings.append(PolicyFinding("GEN-LEAK", "FAIL", line.line_id, detail))
            elif violation.code == "UNVERIFIED":
                findings.append(
                    PolicyFinding("GEN-LEAK", "UNVERIFIED", line.line_id, detail)
                )
    if case.proper_names is None:
        findings.append(
            PolicyFinding(
                "GEN-CASE", "UNVERIFIED", None, f"proper_names_undefined:{case.label}"
            )
        )
    else:
        for line in pack.lines:
            forms = _forms(line.text)
            for index, name in enumerate(case.proper_names):
                if name.strip() and _contains(forms, name):
                    # 이름 원문 대신 목록 위치만 남긴다
                    findings.append(
                        PolicyFinding(
                            "GEN-CASE",
                            "FAIL",
                            line.line_id,
                            f"proper_name:{case.label}:{index}",
                        )
                    )
    return findings


def run_dialogue_pack_policy(
    policy: DialoguePackPolicy, pack: GeneralLinePack
) -> PackPolicyResult:
    try:
        result = policy(pack)
    except Exception:
        return PackPolicyResult("UNVERIFIED", "policy_error")
    if not isinstance(result, PackPolicyResult) or result.status not in (
        "PASS",
        "FAIL",
        "UNVERIFIED",
    ):
        return PackPolicyResult("UNVERIFIED", "invalid_policy_result")
    return result


def published_cases_policy(
    published: Sequence[PublishedCase] | None,
) -> DialoguePackPolicy:
    """게시 케이스 목록을 고정한 검사 함수(요청 하나 동안 쓴다)."""

    snapshot = tuple(published) if published is not None else None

    def policy(pack: GeneralLinePack) -> PackPolicyResult:
        return check_dialogue_pack(pack, snapshot)

    return policy


# 게시 케이스를 넘기지 않은 기본 검사: 정적 검사는 하되 GEN-LEAK · GEN-CASE는 UNVERIFIED(fail closed).
DEFAULT_DIALOGUE_PACK_POLICY: DialoguePackPolicy = published_cases_policy(None)


# --- 정적 검사 ---


def _static_findings(line_id: str, text: str) -> list[PolicyFinding]:
    findings = [
        PolicyFinding("GEN-WORD", "FAIL", line_id, f"term:{term}")
        for term in forbidden_terms_in(text)
    ]
    if len(text) > MAX_LINE_LENGTH:
        findings.append(
            PolicyFinding("GEN-LEN", "FAIL", line_id, f"length:{len(text)}")
        )
    if line_id.startswith(PAUSE_LINE_PREFIX):
        compact = normalize_compact(text)
        findings += [
            PolicyFinding("GEN-SYS", "FAIL", line_id, f"term:{term}")
            for term in SYSTEM_TERMS
            if term in compact
        ]
        findings += [
            PolicyFinding("GEN-TIME", "FAIL", line_id, f"term:{promise}")
            for promise in TIME_PROMISES
            if _has_time_promise(text, compact, promise)
        ]
    return findings


_WORD_SPLIT = re.compile(r"[\W_]+")


def _has_time_promise(text: str, compact: str, promise: str) -> bool:
    if " " not in promise:
        # 한 낱말 예시(「곧」): 낱말 그대로일 때만(「곧장」 · 「곧바로」 · 「곧은」은 다른 낱말)
        return promise in _WORD_SPLIT.split(normalize_text(text))
    return normalize_compact(promise) in compact


def _result(findings: list[PolicyFinding]) -> PackPolicyResult:
    checks: list[tuple[PolicyCode, PolicyStatus]] = []
    for code in POLICY_CODES:
        statuses = {f.status for f in findings if f.code == code}
        status: PolicyStatus = (
            "FAIL" if "FAIL" in statuses else "UNVERIFIED" if statuses else "PASS"
        )
        checks.append((code, status))
    overall = {status for _, status in checks}
    if "FAIL" in overall:
        status, reason = "FAIL", "policy_violation"
    elif "UNVERIFIED" in overall:
        status, reason = "UNVERIFIED", "policy_unverified"
    else:
        status, reason = "PASS", "policy_passed"
    return PackPolicyResult(status, reason, tuple(checks), tuple(findings))
