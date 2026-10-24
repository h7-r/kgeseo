"""NpcContext v0.1 (초안) — NPC 에게 "지금 어떤 상황인가"를 한 번에 건네는 입력.

[누가 만드나]
  NPC 서비스(서버 쪽)가 만든다. 재료는 셋이다.
    · GET /play-sessions/{id} 의 state  → state (모양 그대로)
    · interaction_events                → recent_interactions
    · FE 가 보내는 순간 정보(겨냥·대화 요청) → trigger · focus · player_message
  FE 가 이 객체를 직접 조립해 보내는 구조는 아니다(정답 근처 정보가 클라이언트를 거치지 않게).

[들어가지 않는 것]
  플레이어가 입력한 답의 원문(payload.answer). 같은 오답을 반복하는지만 알면 되므로
  answer_fingerprint(해시)만 받는다. 원문이 LLM 프롬프트에 섞이는 일을 막는다.
"""

from typing import Literal

from pydantic import Field, model_validator

from companion_npc.contracts.common import (
    CONTRACT_VERSION,
    AwareDatetime,
    CaseId,
    ContractModel,
    ExternalInteractionResultType,
    Id,
    InteractionAction,
    InteractionTargetType,
    NpcHintLevel,
    PlaySessionStateSnapshot,
    StateChangeType,
)

# npc-follow 프로토타입 gameEvents.ts 의 세 종류 + NPC 쪽에서 필요한 것 (제안)
TriggerType = Literal[
    "player_request",  # 플레이어가 NPC 에게 말을 걸었다
    "clue_acquired",
    "zone_entered",
    "puzzle_completed",
    "interaction_result",  # 채점 결과(주로 incorrect)를 받았다
    "idle_tick",  # 일정 시간 진전이 없어 서버 타이머가 물었다
]
TriggerSource = Literal["fe", "backend", "timer", "debug"]
NpcBehavior = Literal["Idle", "Follow", "Interact"]  # npc-follow behaviorState.ts


class Trigger(ContractModel):
    type: TriggerType
    source: TriggerSource
    # 이 판단을 일으킨 이벤트 ID (client_event_id 또는 interaction_id). 중복 판단을 막는다.
    event_ref: str | None = None


class StateChangeRef(ContractModel):
    """state_changes 항목을 NPC 용으로 줄인 것. type 은 backend 닫힌 목록과 같다."""

    type: StateChangeType
    target_id: str | None = None  # puzzle_id · clue_id · zone_id · flag 이름


class InteractionRecord(ContractModel):
    """interaction_events 한 줄을 NPC 용으로 옮긴 것."""

    client_event_id: str = Field(min_length=1)
    interaction_id: str | None = None
    occurred_at: AwareDatetime
    zone_id: Id
    action: InteractionAction
    target_type: InteractionTargetType
    target_id: str | None
    # 서버가 처리한 퍼즐 ID (object → puzzle 로 풀린 값). 피처 계산에 쓴다.
    resolved_puzzle_id: Id | None = None
    result_type: ExternalInteractionResultType
    attempt_count: int | None = Field(default=None, ge=0)
    state_changes: list[StateChangeRef] = Field(default_factory=list)
    # 제안 — 서버가 정규화한 답을 세션별 salt 로 해시한 값. 원문은 넣지 않는다.
    answer_fingerprint: str | None = Field(default=None, max_length=128)


class NpcHistoryItem(ContractModel):
    """NPC 가 앞서 한 말 — 같은 말을 되풀이하지 않고 단계를 차례로 올리기 위해 (제안)."""

    utterance_id: str = Field(min_length=1)
    spoken_at: AwareDatetime
    puzzle_id: Id | None = None
    npc_hint_level: NpcHintLevel
    hint_ids: list[Id] = Field(default_factory=list)


class Timing(ContractModel):
    """초 단위. 일시정지·창 열림 동안은 세지 않는다(PRD: UI 를 열면 타이머 정지)."""

    session_active_sec: float = Field(ge=0)
    since_last_progress_sec: float | None = Field(default=None, ge=0)
    since_last_interaction_sec: float | None = Field(default=None, ge=0)
    since_last_npc_utterance_sec: float | None = Field(default=None, ge=0)
    paused: bool = False


class Focus(ContractModel):
    """FE 조사시스템의 겨냥·열림 대상 (제안)."""

    zone_id: Id | None = None
    object_id: Id | None = None
    puzzle_id: Id | None = None


class PlayerMessage(ContractModel):
    text: str = Field(min_length=1, max_length=200)


class Limits(ContractModel):
    """이번 판단에서 넘으면 안 되는 선. 운영 설정이 정한다."""

    max_npc_hint_level: NpcHintLevel = 2
    allow_llm: bool = False  # 기본은 끔 — 켜는 건 실험 설정에서만
    cooldown_sec: float = Field(default=30, ge=0)


class NpcContext(ContractModel):
    contract: Literal["npc_context"] = "npc_context"
    contract_version: Literal["0.1"] = CONTRACT_VERSION
    request_id: str = Field(min_length=1, max_length=64)
    requested_at: AwareDatetime
    play_session_id: str = Field(min_length=1, max_length=36)
    case_id: CaseId
    pack_id: Id
    trigger: Trigger
    state: PlaySessionStateSnapshot
    recent_interactions: list[InteractionRecord] = Field(
        default_factory=list, max_length=50
    )
    npc_history: list[NpcHistoryItem] = Field(default_factory=list, max_length=20)
    timing: Timing
    focus: Focus | None = None
    player_message: PlayerMessage | None = None
    npc_behavior: NpcBehavior | None = None
    limits: Limits = Field(default_factory=Limits)

    @model_validator(mode="after")
    def _consistent(self) -> "NpcContext":
        times = [r.occurred_at for r in self.recent_interactions]
        if times != sorted(times):
            raise ValueError("recent_interactions must be ordered oldest first")
        if self.trigger.type == "player_request" and self.player_message is None:
            # 버튼으로 "도와줘"만 누르는 경우도 있으니 메시지는 빈 문장 대신 정해진 문구로 채운다.
            raise ValueError("player_request trigger requires player_message")
        return self
