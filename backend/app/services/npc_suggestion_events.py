"""NPC 자동 개입 제안의 표시 · 미표시 · 거절 기록 v0.1 (PM v0.4.7, 서비스만 · HTTP 미연결).

FE는 「지금 보여 줄 수 있는가」(대화 중 · 컷 · 거리 등)만 판단해 결과를 보고한다. 개입 여부 · 횟수 · 쿨다운은
BE가 이 기록으로 계산한다(`npc_decision`).

이벤트(interaction_events, 대사 · 플레이어 원문 없음):
- `npc_suggestion_shown`      화면에 표시함 → 퍼즐당 · 세션당 횟수와 180초 쿨다운에 들어간다.
- `npc_suggestion_suppressed` 표시하지 않음 → 횟수 · 쿨다운을 소모하지 않는다.
- `npc_suggestion_declined`   표시된 제안을 플레이어가 거절 → 600초 쿨다운.
`target_id`는 제안 ID(제안을 응답한 NPC 턴의 `npc_event_id`)다.

전이 규칙(한 제안 기준):
- shown · suppressed는 둘 중 하나만 기록된다(먼저 온 것). 반대 보고는 `SuggestionEventConflictError`.
- declined는 shown 뒤에만 받는다.
- 같은 종류를 다시 보고하면(다른 client_event_id여도) 새 행을 만들지 않고 처음 기록을 돌려준다(중복 수신 방지).
- 같은 client_event_id로 다른 보고를 보내면 `IdempotencyConflictError`.
세션 행을 잠가(`FOR UPDATE`) 같은 세션의 보고를 직렬화한다. 이 함수는 받은 세션을 commit · rollback한다
(기존 Interaction · NPC 턴 서비스와 같은 방식).
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.services.interaction import IdempotencyConflictError, _to_db_datetime
from app.services.play_session import PlaySessionNotFoundError

SuggestionEventKind = Literal["shown", "suppressed", "declined"]
SUGGESTION_EVENT_TYPES: dict[str, str] = {
    "shown": "npc_suggestion_shown",
    "suppressed": "npc_suggestion_suppressed",
    "declined": "npc_suggestion_declined",
}
OFFER_EVENT_TYPE = "npc_turn"


class SuggestionNotFoundError(Exception):
    """그 세션의 자동 개입 제안이 아니다."""


class SuggestionEventConflictError(Exception):
    """이미 반대 보고가 기록되었거나(shown ↔ suppressed), 표시되지 않은 제안을 거절했다."""


@dataclass(frozen=True)
class SuggestionEventResult:
    event_id: str
    kind: SuggestionEventKind
    # 이미 같은 보고가 있어 새로 기록하지 않았는가
    duplicate: bool


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def record_suggestion_event(
    db: AsyncSession,
    play_session_id: str,
    *,
    suggestion_id: str,
    kind: SuggestionEventKind,
    client_event_id: str,
    client_timestamp: datetime | None = None,
    now: datetime | None = None,
) -> SuggestionEventResult:
    if kind not in SUGGESTION_EVENT_TYPES:
        raise ValueError("unknown suggestion event kind")
    event_type = SUGGESTION_EVENT_TYPES[kind]
    try:
        session = (
            await db.execute(
                select(PlaySession)
                .where(PlaySession.id == play_session_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if session is None:
            raise PlaySessionNotFoundError()

        offer = (
            await db.execute(
                select(InteractionEvent).where(
                    InteractionEvent.id == suggestion_id,
                    InteractionEvent.play_session_id == play_session_id,
                    InteractionEvent.interaction_type == OFFER_EVENT_TYPE,
                )
            )
        ).scalar_one_or_none()
        offered = (offer.response_json or {}) if offer is not None else {}
        if offer is None or not offered.get("auto_intervened"):
            raise SuggestionNotFoundError()

        same_client = (
            await db.execute(
                select(InteractionEvent).where(
                    InteractionEvent.play_session_id == play_session_id,
                    InteractionEvent.client_event_id == client_event_id,
                )
            )
        ).scalar_one_or_none()
        if same_client is not None:
            if (
                same_client.interaction_type == event_type
                and same_client.target_id == suggestion_id
            ):
                result = SuggestionEventResult(same_client.id, kind, True)
                await db.rollback()
                return result
            raise IdempotencyConflictError()

        existing = {
            event.interaction_type: event
            for event in (
                await db.execute(
                    select(InteractionEvent).where(
                        InteractionEvent.play_session_id == play_session_id,
                        InteractionEvent.target_id == suggestion_id,
                        InteractionEvent.interaction_type.in_(
                            SUGGESTION_EVENT_TYPES.values()
                        ),
                    )
                )
            ).scalars()
        }
        if event_type in existing:
            result = SuggestionEventResult(existing[event_type].id, kind, True)
            await db.rollback()
            return result
        shown = SUGGESTION_EVENT_TYPES["shown"] in existing
        suppressed = SUGGESTION_EVENT_TYPES["suppressed"] in existing
        if (kind == "shown" and suppressed) or (kind == "suppressed" and shown):
            raise SuggestionEventConflictError()
        if kind == "declined" and not shown:
            raise SuggestionEventConflictError()

        auto = offered.get("auto_intervene") or {}
        event_id = str(uuid4())
        db.add(
            InteractionEvent(
                id=event_id,
                play_session_id=play_session_id,
                client_event_id=client_event_id,
                client_timestamp=_to_db_datetime(client_timestamp),
                interaction_type=event_type,
                target_id=suggestion_id,
                payload_json={},
                result_type=kind,
                # 내부 퍼즐 ID · 단계만 남긴다(대사 · 원문 없음).
                response_json={
                    "puzzle_id": auto.get("puzzle_ref"),
                    "level": auto.get("level"),
                },
                created_at=now or _utc_now(),
            )
        )
        await db.commit()
        return SuggestionEventResult(event_id, kind, False)
    except asyncio.CancelledError:
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise


def shown_and_declined(
    events,
) -> tuple[list[tuple[datetime, str | None]], list[datetime]]:
    """세션 이벤트에서 (표시 시각, 퍼즐) 목록과 거절 시각 목록을 뽑는다(판단 입력용)."""

    shown: list[tuple[datetime, str | None]] = []
    declined: list[datetime] = []
    for event in events:
        if event.interaction_type == SUGGESTION_EVENT_TYPES["shown"]:
            shown.append(
                (event.created_at, (event.response_json or {}).get("puzzle_id"))
            )
        elif event.interaction_type == SUGGESTION_EVENT_TYPES["declined"]:
            declined.append(event.created_at)
    return shown, declined
