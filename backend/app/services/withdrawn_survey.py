"""탈퇴 회원의 베타 설문(Google Forms) 응답을 찾기 위한 참가 번호 — 읽기 전용(계약 `account_withdrawal_v0.2.md` §8).

설문 폼에는 이름 · 이메일 대신 「참가 번호」가 미리 채워진다(`src/beta/betaSurvey.ts`). 로그인한 사람의 참가 번호는 계정 id(`/me` 의
`user_id` = `app_users.id`)의 FNV-1a 32비트 지문(16진 대문자 8자, `src/beta/betaLog.ts` `shortKey`)이다. 로그인하지 않은 때는 운영자가
나눠 준 참여 코드(`XXXX-XXXX`, 하이픈 포함 — 8자 16진과 겹칠 수 없다)가 들어간다. 그래서 탈퇴 회원 한 명의 응답은

- 계정 참가 번호(`account`) — 로그인한 채 연 설문
- 그 계정 기록에 함께 찍힌 참여 코드(`code`) — 같은 사람이 로그인하지 않은 때 연 설문

으로 찾는다. 이 모듈은 DB 를 읽기만 한다(읽기 전용 트랜잭션). 계정 id · 이메일 · 닉네임은 돌려주지 않는다.
"""

from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_user import AppUser
from app.models.beta_event import BetaEvent
from app.services.admin_query import KST_OFFSET, kst_day_start_utc

FNV_OFFSET = 0x811C9DC5
FNV_PRIME = 0x01000193
MASK32 = 0xFFFFFFFF


def participant_key(account_id: str) -> str:
    """클라이언트 `shortKey` 와 같은 값 — JS `charCodeAt`(UTF-16 코드 단위) 마다 XOR 후 `Math.imul` 곱(32비트)."""

    value = FNV_OFFSET
    encoded = account_id.encode("utf-16-le")
    for index in range(0, len(encoded), 2):
        unit = encoded[index] | (encoded[index + 1] << 8)
        value = ((value ^ unit) * FNV_PRIME) & MASK32
    return f"{value:08X}"


@dataclass(frozen=True)
class SurveyCode:
    withdrawn_at: datetime  # UTC naive(저장 값)
    kind: str  # "account" | "code"
    code: str
    # 같은 계정 참가 번호를 가진 **다른** 계정 수(회원 · 탈퇴 모두). 0 이 아니면 그 번호만으로 사람을 정할 수 없다
    shared_with: int

    @property
    def withdrawn_at_kst(self) -> str:
        return (self.withdrawn_at + KST_OFFSET).strftime("%Y-%m-%d %H:%M")


async def begin_read_only(db: AsyncSession) -> None:
    """다음 트랜잭션을 읽기 전용으로 — 실수로 쓰는 문장이 있어도 MySQL 이 거절한다(1792)."""

    await db.execute(text("SET TRANSACTION READ ONLY"))


async def withdrawn_survey_codes(db: AsyncSession, since: date) -> list[SurveyCode]:
    """`since`(KST 날짜 00:00 부터, 그날 포함) 뒤에 탈퇴한 회원의 참가 번호 · 참여 코드. 탈퇴 시각 · 종류 · 번호 순."""

    cut = kst_day_start_utc(since)
    withdrawn = (
        await db.execute(
            select(AppUser.id, AppUser.deleted_at)
            .where(AppUser.deleted_at.is_not(None), AppUser.deleted_at >= cut)
            .order_by(AppUser.deleted_at, AppUser.id)
        )
    ).all()
    if not withdrawn:
        return []
    # 짧은 지문이라 다른 계정과 겹칠 수 있다 — 모든 계정(회원 · 탈퇴)의 번호를 세어 겹침을 알린다
    every_key = Counter(
        participant_key(user_id)
        for user_id in (await db.scalars(select(AppUser.id))).all()
    )
    ids = [user_id for user_id, _ in withdrawn]
    seen_codes: dict[str, set[str]] = {}
    for user_id, code in (
        await db.execute(
            select(BetaEvent.app_user_id, BetaEvent.participant_code)
            .where(
                BetaEvent.app_user_id.in_(ids),
                BetaEvent.participant_code.is_not(None),
            )
            .distinct()
        )
    ).all():
        seen_codes.setdefault(user_id, set()).add(code)

    rows: list[SurveyCode] = []
    for user_id, deleted_at in withdrawn:
        key = participant_key(user_id)
        rows.append(SurveyCode(deleted_at, "account", key, every_key[key] - 1))
        for code in sorted(seen_codes.get(user_id, ())):
            rows.append(SurveyCode(deleted_at, "code", code, 0))
    return rows
