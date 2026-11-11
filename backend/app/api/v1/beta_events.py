"""베타 분석 기록 받기(11/11 미르, 베타 수집 항목 v1.1 2-2절 · 계약 `docs/beta_events.md`).

- 게임 진행 · 저장과 완전히 따로다. 이 API 가 실패해도 게임은 그대로 진행된다(게임 화면은 결과를 기다리지 않는다).
- 본문은 `application/json` 과 `text/plain` 둘 다 받는다. 페이지를 떠날 때 보내는 keepalive 요청은 사전 요청(CORS
  preflight) 없이 나가도록 `text/plain` 으로 온다. 본문을 직접 읽어 JSON 으로 해석하고 검사한다.
- 주인은 쿠키로만 정한다(로그인 → 게스트 순, 둘 다 없어도 받는다). 요청 본문의 사용자 id 는 믿지 않는다.
- 같은 event_id 는 한 번만 저장한다(재전송은 `duplicates` 로 센다). 형식이 틀리면 묶음 전체를 거절한다(부분 저장 없음).
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.dialects.mysql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import error_responses
from app.core.config import settings
from app.db.session import get_db
from app.models.beta_event import BetaEvent
from app.schemas.beta_event import BetaEventBatch, BetaEventBatchResult
from app.services.local_auth import utc_now
from app.services.play_principal import require_play_origin, resolve_play_principal
from app.services.request_rate_limit import BETA_EVENTS, limit_by_ip

MAX_BODY_BYTES = 64 * 1024

router = APIRouter(prefix="/beta-events", tags=["Beta Events"])

# 본문을 직접 읽으므로 요청 본문 명세는 여기서 적는다(문서 표시용).
_REQUEST_BODY = {
    "requestBody": {
        "required": True,
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/BetaEventBatch"}
            },
            "text/plain": {
                "schema": {
                    "type": "string",
                    "description": "BetaEventBatch 와 같은 JSON 문자열(keepalive 전송용).",
                }
            },
        },
    }
}


async def _read_capped_body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Beta event batch too large.",
        )
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Beta event batch too large.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def _validation_error(error: ValidationError) -> JSONResponse:
    """FastAPI 기본 검증 오류와 같은 형식. 보낸 값(`input`)은 되돌려 주지 않는다."""
    items = [
        {
            "loc": ["body", *item["loc"]],
            "msg": item["msg"],
            "type": item["type"],
        }
        for item in error.errors(include_url=False)
    ]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": items},
        headers={"Cache-Control": "no-store"},
    )


@router.post(
    "",
    response_model=BetaEventBatchResult,
    responses=error_responses.BETA_EVENTS,
    dependencies=[Depends(require_play_origin), Depends(limit_by_ip(BETA_EVENTS))],
    openapi_extra=_REQUEST_BODY,
)
async def receive_beta_events(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """베타 분석 기록 묶음(1~50개)을 저장한다. `BETA_EVENTS_ENABLED=false` 면 저장하지 않고 `disabled: true`."""
    response.headers["Cache-Control"] = "no-store"
    if not settings.beta_events_enabled:
        return BetaEventBatchResult(accepted=0, duplicates=0, disabled=True)

    body = await _read_capped_body(request)
    try:
        batch = BetaEventBatch.model_validate_json(body)
    except ValidationError as error:
        return _validation_error(error)

    principal = await resolve_play_principal(db, request)
    received_at = utc_now()
    rows = [
        {
            "event_id": str(event.event_id),
            "received_at": received_at,
            "client_ts": event.client_ts_utc(),
            "event_type": event.type,
            "phase": event.phase,
            "participant_code": event.pc,
            "run_id": event.run_id,
            "run_index": event.run_index,
            "tab_id": event.tab_id,
            "seq": event.seq,
            "objective_id": event.objective_id,
            "page": event.page,
            "build": event.build,
            "app_user_id": principal.user_id if principal else None,
            "guest_session_id": principal.guest_session_id if principal else None,
            "data": event.data,
        }
        for event in batch.events
    ]
    # 같은 event_id(재전송)는 유일 색인에 걸려 건너뛴다. 길이 · 형식은 위에서 이미 검사했다.
    result = await db.execute(insert(BetaEvent).values(rows).prefix_with("IGNORE"))
    await db.commit()
    rowcount = getattr(result, "rowcount", None)
    accepted = rowcount if isinstance(rowcount, int) and rowcount >= 0 else len(rows)
    return BetaEventBatchResult(accepted=accepted, duplicates=len(rows) - accepted)
