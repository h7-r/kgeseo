"""PromptPayload — 생성기에 넘기는 **유일한** 입력.

모든 생성기(템플릿 · 가짜 · 향후 GPT · Qwen)가 같은 payload 를 받는다 — 허용 정보 범위가 같다.
NPC 내부에서 참조할 수 있는 정보보다 좁다:
  넣는 것   유형 · 시작 주체 · 페르소나 말투 · 승인 템플릿 · 승인 힌트 본문 · 허용 조각 본문 · 정제한 플레이어 메시지
  넣지 않는 것  퍼즐/오브젝트/단서 ID · flag 이름 · 정답 · 별칭 · 공개 조건 · 다른 등급 조각 · case_id
조각과 힌트는 K1·K2·H1 같은 임시 라벨로만 부르고, 실제 ID 와의 연결(label_map)은 서버 쪽에만 둔다.
"""

import re
import unicodedata
from dataclasses import dataclass, field

from companion_npc.contracts.npc_content import NpcTemplates
from companion_npc.contracts.npc_utterance import Initiator, UtteranceKind
from companion_npc.contracts.scenario_pack import (
    ApprovedHint,
    KnowledgeChunk,
    NpcPersona,
)

MAX_PLAYER_MESSAGE = 200
# 제어 문자 · 폭 없는 문자 · 방향 제어 문자 (소스에 문자를 직접 쓰지 않고 코드 포인트로 둔다)
_INVISIBLE_RANGES = (
    (0x00, 0x1F),
    (0x7F, 0x9F),
    (0x200B, 0x200F),
    (0x2028, 0x202E),
    (0x2066, 0x2069),
)
_CONTROL = re.compile(
    "["
    + "".join(re.escape(chr(a)) + "-" + re.escape(chr(b)) for a, b in _INVISIBLE_RANGES)
    + "]"
)


def sanitize_player_message(text: str | None) -> str | None:
    """제어 문자 · 보이지 않는 방향 문자를 지우고 길이를 자른다. 내용은 **데이터**로만 다룬다."""

    if text is None:
        return None
    cleaned = _CONTROL.sub(" ", unicodedata.normalize("NFKC", text)).strip()
    return cleaned[:MAX_PLAYER_MESSAGE] or None


@dataclass(frozen=True)
class Evidence:
    label: str  # K1, K2 ...
    text: str


@dataclass(frozen=True)
class PromptPayload:
    request_id: str
    kind: UtteranceKind
    initiator: Initiator
    npc_hint_level: int
    persona_name: str
    speech_style: str
    templates: NpcTemplates
    approved_hint: Evidence | None  # H1 — nudge · hint 에서만
    evidence: tuple[Evidence, ...]
    object_name: str | None  # clarify 에서 플레이어가 짚은 것이 확인된 오브젝트 이름
    player_message: str | None
    # ↓ 서버 쪽 전용 — 생성기에 보여 주는 값이 아니다 (to_model_input 에서 빠진다)
    label_map: dict[str, str] = field(default_factory=dict, repr=False)

    def to_model_input(self) -> dict:
        """LLM 에 실제로 보낼 수 있는 모양. label_map 은 넣지 않는다."""

        return {
            "kind": self.kind,
            "initiator": self.initiator,
            "npc_hint_level": self.npc_hint_level,
            "persona": {"name": self.persona_name, "speech_style": self.speech_style},
            "approved_hint": {
                "label": self.approved_hint.label,
                "text": self.approved_hint.text,
            }
            if self.approved_hint
            else None,
            "evidence": [{"label": e.label, "text": e.text} for e in self.evidence],
            "object_name": self.object_name,
            "player_message": self.player_message,
        }


def build_payload(
    *,
    request_id: str,
    kind: UtteranceKind,
    initiator: Initiator,
    npc_hint_level: int,
    persona: NpcPersona,
    templates: NpcTemplates,
    hint: ApprovedHint | None,
    chunks: list[KnowledgeChunk],
    object_name: str | None,
    player_message: str | None,
) -> PromptPayload:
    label_map: dict[str, str] = {}
    approved = None
    if hint is not None:
        approved = Evidence("H1", hint.text)
        label_map["H1"] = hint.hint_id
    evidence = []
    for i, chunk in enumerate(chunks, start=1):
        label = f"K{i}"
        evidence.append(Evidence(label, chunk.text))
        label_map[label] = chunk.chunk_id
    return PromptPayload(
        request_id=request_id,
        kind=kind,
        initiator=initiator,
        npc_hint_level=npc_hint_level,
        persona_name=persona.display_name,
        speech_style=persona.speech_style,
        templates=templates,
        approved_hint=approved,
        evidence=tuple(evidence),
        object_name=object_name,
        player_message=sanitize_player_message(player_message),
        label_map=label_map,
    )
