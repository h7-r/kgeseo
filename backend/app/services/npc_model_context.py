"""AI 일반 대화용 `model_context` v0.1 (PM v0.4.3, 순수 함수 · 라우터 미연결).

생성 모델에 넘길 수 있는 **공개된 정보만** 서버 상태 · 콘텐츠에서 모은다.

[넣는 것 — 지금 BE 스키마에 근거가 있는 것]
- 현재 구역 이름(client `zone_name`) · 그 구역에서 보이는 Object 이름(`object_states` 반영)
- 퍼즐: puzzle_id · 상태(open / completed) · `hint_level` 숫자. 현재 구역에서 보이는 호스트가 있거나 이미
  완료한 퍼즐만. 퍼즐 이름은 공개 콘텐츠에 필드가 없어 호출하는 쪽이 공개 제목을 넘길 때만 넣는다.
- 획득한 단서의 title · summary · body(단서 카탈로그 API 가 플레이어에게 이미 보여 주는 값). 최근 20개.
- U 규칙의 공개 주제 이름(`OpenTopicRule.topic`) — 「단정하지 말 주제」. patterns · hedges 는 넣지 않는다.
- 사실 · 필수 발견: BE 스키마에 없다. 호출하는 쪽이 `reveal_when` 을 가진 항목으로 넘길 때만, 평가기가
  공개(`revealed`)로 판정한 것만 넣는다. 판정할 수 없으면(문법 오류 · 미지원 조건 · 조건 없음) 넣지 않는다.
  종류별 최근 20개(넘겨준 순서의 끝 20개).

[넣지 않는 것]
정답 · 판정 규칙 · 미공개 콘텐츠 · nudge 원문 · 정식 힌트 원문 · NG 목록 · U patterns · 엔딩 · 생성 이력 ·
개인정보 · 내부 단서 ID.

[스키마 미지원 — 추측하지 않고 비워 둔다] `unsupported` 로 이름을 남긴다.
npc_scenario(호칭 · 회피 주제) · 장면 purpose · questions · open_scene_ids · 퍼즐 이름(주입 없을 때) ·
사실 · 필수 발견(주입 없을 때) · U 주제(규칙 주입 없을 때).
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from app.schemas.case_content import CaseClientContent
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.npc_generation_policy import PolicyRules
from app.services.npc_reveal import evaluate_reveal_when
from app.services.object_state import resolve_effective_object_states
from app.services.puzzle_question import PUZZLE_INTERACTION_TYPES

RECENT_LIMIT = 20

ALWAYS_UNSUPPORTED = (
    "npc_scenario.address",
    "npc_scenario.avoid_topics",
    "scene.purpose",
    "scene.questions",
    "open_scene_ids",
)


@dataclass(frozen=True)
class RevealableItem:
    """호출하는 쪽이 넘기는 사실 · 필수 발견 한 항목. reveal_when 이 공개로 판정될 때만 쓴다."""

    kind: Literal["fact", "discovery"]
    item_id: str
    text: str
    reveal_when: Any


@dataclass(frozen=True)
class ContextPuzzle:
    puzzle_id: str
    status: Literal["open", "completed"]
    hint_level: int
    name: str | None = None


@dataclass(frozen=True)
class ContextClue:
    title: str
    summary: str | None
    body: str | None


@dataclass(frozen=True)
class ModelContext:
    zone_name: str | None
    visible_object_names: tuple[str, ...]
    puzzles: tuple[ContextPuzzle, ...]
    clues: tuple[ContextClue, ...]
    facts: tuple[str, ...]
    discoveries: tuple[str, ...]
    uncertain_topics: tuple[str, ...]

    def to_model_input(self) -> dict[str, Any]:
        return {
            "zone_name": self.zone_name,
            "visible_object_names": list(self.visible_object_names),
            "puzzles": [
                {
                    "puzzle_id": p.puzzle_id,
                    "name": p.name,
                    "status": p.status,
                    "hint_level": p.hint_level,
                }
                for p in self.puzzles
            ],
            "clues": [
                {"title": c.title, "summary": c.summary, "body": c.body}
                for c in self.clues
            ],
            "facts": list(self.facts),
            "discoveries": list(self.discoveries),
            "uncertain_topics": list(self.uncertain_topics),
        }

    def public_texts(self) -> tuple[str, ...]:
        """정책 검사가 「이미 공개된 낱말」로 쓸 문자열."""

        texts = [self.zone_name or "", *self.visible_object_names]
        texts += [p.name or "" for p in self.puzzles]
        for clue in self.clues:
            texts += [clue.title, clue.summary or "", clue.body or ""]
        texts += [*self.facts, *self.discoveries, *self.uncertain_topics]
        return tuple(t for t in texts if t)


@dataclass(frozen=True)
class ModelContextBuild:
    context: ModelContext
    # 스키마에 근거가 없어 비워 둔 항목 이름(내용 없음)
    unsupported: tuple[str, ...]
    # reveal_when 이 공개가 아니거나 판정할 수 없어 뺀 주입 항목 수
    excluded_items: int


def build_model_context(
    client: CaseClientContent,
    runtime: PuzzleRuntimeDefinition,
    state: Mapping[str, Any],
    *,
    puzzle_titles: Mapping[str, str] | None = None,
    revealable_items: Sequence[RevealableItem] | None = None,
    policy_rules: PolicyRules | None = None,
) -> ModelContextBuild:
    unsupported = list(ALWAYS_UNSUPPORTED)
    current_zone_id = state.get("current_zone_id")
    completed = list(state.get("completed_puzzle_ids") or [])
    acquired = list(state.get("acquired_clue_ids") or [])
    hint_levels = state.get("hint_levels") or {}
    effective = resolve_effective_object_states(client, state.get("object_states", {}))
    runtime_ids = {puzzle.puzzle_id for puzzle in runtime.puzzles}

    zone = next((z for z in client.zones if z.zone_id == current_zone_id), None)
    visible_names: list[str] = []
    open_hosts: list[str] = []
    if zone is not None:
        for obj in zone.objects:
            if not effective[(zone.zone_id, obj.object_id)].visible:
                continue
            visible_names.append(obj.object_name)
            interaction = obj.interaction
            if (
                interaction is not None
                and interaction.type in PUZZLE_INTERACTION_TYPES
                and interaction.target_id in runtime_ids
                and interaction.target_id not in completed
            ):
                open_hosts.append(interaction.target_id)

    if not puzzle_titles:
        unsupported.append("puzzle.name")
    puzzles = [
        ContextPuzzle(
            puzzle_id=puzzle_id,
            status=status,
            hint_level=_hint_level(hint_levels, puzzle_id),
            name=(puzzle_titles or {}).get(puzzle_id),
        )
        for puzzle_id, status in [
            *((p, "completed") for p in completed if p in runtime_ids),
            *((p, "open") for p in dict.fromkeys(open_hosts)),
        ]
    ]

    definitions = {clue.clue_id: clue for clue in runtime.clues}
    clues = [
        ContextClue(d.title, d.summary, d.body)
        for d in (definitions.get(clue_id) for clue_id in acquired)
        if d is not None
    ][-RECENT_LIMIT:]

    excluded = 0
    facts: list[str] = []
    discoveries: list[str] = []
    if revealable_items is None:
        unsupported += ["facts", "required_discoveries"]
    else:
        for item in revealable_items:
            if evaluate_reveal_when(item.reveal_when, state).reason != "revealed":
                excluded += 1
                continue
            (facts if item.kind == "fact" else discoveries).append(item.text)

    if policy_rules is None:
        unsupported.append("uncertain_topics")
    topics = _unique(
        r.topic for r in (policy_rules.open_topics if policy_rules else ())
    )

    return ModelContextBuild(
        ModelContext(
            zone_name=zone.zone_name if zone is not None else None,
            visible_object_names=tuple(visible_names),
            puzzles=tuple(puzzles),
            clues=tuple(clues),
            facts=tuple(facts[-RECENT_LIMIT:]),
            discoveries=tuple(discoveries[-RECENT_LIMIT:]),
            uncertain_topics=topics,
        ),
        tuple(unsupported),
        excluded,
    )


def _hint_level(hint_levels: Mapping[str, Any], puzzle_id: str) -> int:
    value = hint_levels.get(puzzle_id, 0)
    # 저장값이 이상하면 0으로 둔다(숫자만 넘기고 원문은 넘기지 않는다).
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _unique(values: Iterable[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(v for v in values if v and v.strip()))
