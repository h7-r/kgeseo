"""관리자 설정 — 점검 모드 읽기 · 쓰기와 읽기 전용 서버 값(관리자 API v0.3 3단계 P3-2, 해랑 11/13).

(a) 값 저장: `admin_settings` 표의 `maintenance_mode` 한 줄. (b) 점검 적용: 공개 `GET /site/status` 가 이 값을 그대로 내주고
웹사이트가 읽어 `/maintenance` 로 보낸다 — 웹사이트만이고 게임 · API 는 안 막는다(미르 11/13).
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.admin_setting import MAINTENANCE_MODE_KEY, AdminSetting
from app.services.guest_session import GUEST_LIFETIME
from app.services.local_auth import utc_now
from app.services.user_session import SESSION_LIFETIME

MESSAGE_MAX = 200


@dataclass(frozen=True)
class MaintenanceValue:
    on: bool
    message: str
    updated_at: datetime | None
    updated_by: str | None


def _parse(row: AdminSetting | None) -> MaintenanceValue:
    if row is None:
        return MaintenanceValue(on=False, message="", updated_at=None, updated_by=None)
    value = row.value_json if isinstance(row.value_json, dict) else {}
    message = value.get("message", "")
    return MaintenanceValue(
        on=bool(value.get("on", False)),
        message=message if isinstance(message, str) else "",
        updated_at=row.updated_at,
        updated_by=row.updated_by,
    )


async def read_maintenance(db: AsyncSession) -> MaintenanceValue:
    return _parse(await db.get(AdminSetting, MAINTENANCE_MODE_KEY))


async def write_maintenance(
    db: AsyncSession, *, admin_user_id: str, on: bool, message: str
) -> MaintenanceValue:
    row = await db.get(AdminSetting, MAINTENANCE_MODE_KEY)
    now = utc_now()
    payload = {"on": on, "message": message[:MESSAGE_MAX]}
    if row is None:
        row = AdminSetting(
            key=MAINTENANCE_MODE_KEY,
            value_json=payload,
            updated_by=admin_user_id,
            updated_at=now,
        )
        db.add(row)
    else:
        row.value_json = payload
        row.updated_by = admin_user_id
        row.updated_at = now
    await db.commit()
    await db.refresh(row)
    return _parse(row)


def readonly_values() -> dict[str, int | bool]:
    """실행 중 서버의 실제 값(비밀값 없음). 화면은 이 숫자를 그대로 보여 주고 바꾸지 않는다 — 바꾸려면 배포."""

    return {
        "hint_initial_balance": settings.hint_initial_balance,
        "hint_fun_minigames_per_session": settings.hint_fun_minigames_per_session,
        "hint_special_minigames_per_session": settings.hint_special_minigames_per_session,
        "rate_limit_window_sec": settings.rate_limit_window_sec,
        "rate_limit_inquiry_create": settings.rate_limit_inquiry_create,
        "rate_limit_inquiry_window_sec": settings.rate_limit_inquiry_window_sec,
        "beta_events_enabled": settings.beta_events_enabled,
        "user_session_days": SESSION_LIFETIME.days,
        "guest_lifetime_days": GUEST_LIFETIME.days,
    }
