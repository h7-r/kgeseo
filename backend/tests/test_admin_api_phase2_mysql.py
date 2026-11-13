"""격리 MySQL 에서 관리자 API v0.2 2단계(#138)를 본다 — DAU 「세션 생성 당시 소유자」 경계 사례 넷 · 보안 집계의 로그인 제한 창.

실행 조건 · 안전 장치는 `test_admin_api_mysql.py` 와 같다(`ADMIN_API_MYSQL_ISOLATED=1` · `ADMIN_API_MYSQL_URL` · `ADMIN_API_MYSQL_DATADIR`).
세진 4차 확인(11/12)에서 최종 리뷰 때 보기로 한 검사:
  ① 게스트 승계 뒤 기존 세션 재사용 — 새 세션이 아니라 DAU 가 안 움직인다(그날은 게스트에 남는다)
  ② 회원 로그인 뒤 신규 세션 — 회원 쪽
  ③ 승계 없는 게스트 — 게스트 쪽 그대로
  ④ 날짜 경계 — KST 자정 앞에 만들고 자정 뒤에 승계: 만든 날은 게스트, 승계 뒤 같은 쿠키로 만든 새 세션은 회원
"""

import hashlib
import os
from datetime import timedelta
from uuid import uuid4

import pytest

from app.models.account_data import LoginThrottle
from app.models.app_user import AppUser
from app.models.guest_session import GuestSession, GuestSessionTransfer
from app.models.play_session import PlaySession
from app.services.admin_query import kst_day_start_utc, kst_today
from app.services.local_auth import utc_now
from tests.test_admin_api_mysql import DAY, HOUR, Seed, get_json, mysql_run, sign_in

pytestmark = pytest.mark.skipif(
    os.environ.get("ADMIN_API_MYSQL_ISOLATED") != "1",
    reason="explicit isolated admin API MySQL test database required",
)

MINUTE = timedelta(minutes=1)


class Seed2(Seed):
    """2단계 — 승계 기록 · 로그인 제한 줄을 더 넣는다. 승계는 게스트 세션(표 guest_sessions)을 참조하므로 넷째 묶음에 둔다."""

    def __init__(self, db) -> None:
        super().__init__(db)
        self.groups.append([])

    def transfer(self, guest: str, user: AppUser, at) -> None:
        guest_session = GuestSession(
            id=str(uuid4()),
            anonymous_session_id=guest,
            token_hash=hashlib.sha256(uuid4().bytes).hexdigest(),
            created_at=at - DAY,
            expires_at=at + DAY,
        )
        self.groups[2].append(guest_session)
        self.groups[3].append(
            GuestSessionTransfer(
                id=str(uuid4()),
                guest_session_id=guest_session.id,
                anonymous_session_id=guest,
                app_user_id=user.id,
                play_session_count=1,
                transferred_at=at,
            )
        )

    def transferred_play(self, at, *, guest: str, user: AppUser, reused_until) -> None:
        """게스트가 만들고 뒤에 승계된 세션의 지금 모습 — 소유자는 회원, 익명 소유자는 비고, 익명 세션 id 는 남는다."""

        self.groups[2].append(
            PlaySession(
                id=str(uuid4()),
                anonymous_session_id=guest,
                case_id="naju-angam-01",
                state_json={},
                created_at=at,
                updated_at=reused_until,
                hint_balance=0,
                help_used=0,
                owner_user_id=user.id,
                owner_anonymous_session_id=None,
            )
        )

    def member_play(self, at, *, user: AppUser, cookie: str) -> None:
        """로그인한 회원이 만든 세션 — 쿠키 익명 id 는 그대로 실리지만 소유자는 회원이다."""

        self.groups[2].append(
            PlaySession(
                id=str(uuid4()),
                anonymous_session_id=cookie,
                case_id="naju-angam-01",
                state_json={},
                created_at=at,
                updated_at=at,
                hint_balance=0,
                help_used=0,
                owner_user_id=user.id,
                owner_anonymous_session_id=None,
            )
        )

    def throttle(self, *, failed: int, window_started_at, locked_until=None) -> None:
        self.groups[3].append(
            LoginThrottle(
                key_hash=hashlib.sha256(uuid4().bytes).hexdigest(),
                failed_count=failed,
                window_started_at=window_started_at,
                locked_until=locked_until,
            )
        )


def _day(daily: list[dict], day) -> dict:
    return next(row for row in daily if row["date"] == day.isoformat())


def test_dau_counts_session_owner_at_creation_time_across_transfer_and_midnight():
    async def scenario(sessions):
        target = kst_today() - 3 * DAY
        start = kst_day_start_utc(target)  # target 00:00 KST
        end = start + DAY  # 다음 날 00:00 KST
        async with sessions() as db:
            seed = Seed2(db)
            admin = seed.user("운영자", start - 30 * DAY, role="admin")
            # ① 게스트로 만들고 그날 안에 승계 → 승계 뒤 이어 함(updated_at 만 움직임). 그날 게스트 1 · 회원 0
            reuse_user = seed.user("승계뒤재사용", start - 10 * DAY)
            reuse_guest = seed.guest()
            seed.transferred_play(
                start + HOUR,
                guest=reuse_guest,
                user=reuse_user,
                reused_until=start + 4 * HOUR,
            )
            seed.transfer(reuse_guest, reuse_user, start + 3 * HOUR)
            # ② 회원이 로그인하고 새 세션 — 승계 기록 없음. 회원 1(로그인 · 플레이 한 번)
            member = seed.user("로그인뒤신규", start - 10 * DAY)
            seed.login(member, start + 2 * HOUR)
            seed.member_play(
                start + 2 * HOUR + 30 * MINUTE, user=member, cookie=seed.guest()
            )
            # ③ 승계 없는 게스트 — 게스트 1
            seed.play(start + 5 * HOUR, guest=seed.guest())
            # ④ 날짜 경계 — 23:30 KST 에 게스트로 만들고 다음 날 00:30 KST 에 승계, 01:00 KST 에 같은 쿠키로 회원 세션
            edge_user = seed.user("자정경계", start - 10 * DAY)
            edge_guest = seed.guest()
            seed.transferred_play(
                end - 30 * MINUTE,
                guest=edge_guest,
                user=edge_user,
                reused_until=end + 10 * MINUTE,
            )
            seed.transfer(edge_guest, edge_user, end + 30 * MINUTE)
            seed.member_play(end + HOUR, user=edge_user, cookie=edge_guest)
            await seed.save()
        sign_in(admin)

        summary = await get_json("/api/v1/admin/stats/summary", date=target.isoformat())
        assert summary["activity"]["members_dau"] == 1  # ② 만
        assert summary["activity"]["guests_dau"] == 3  # ① · ③ · ④
        assert summary["play_sessions"] == {
            "created_on_date": 4,
            "created_on_date_by_member": 1,
            "created_on_date_by_guest": 3,
        }

        traffic = await get_json(
            "/api/v1/admin/stats/traffic", date=(target + DAY).isoformat(), days=2
        )
        today = _day(traffic["daily"], target)
        assert (
            today["members_dau"],
            today["guests_dau"],
            today["play_sessions_created"],
        ) == (1, 3, 4)
        # 다음 날 — ④ 의 승계 자체는 세션이 아니고, 승계 뒤 같은 쿠키로 만든 새 세션만 회원으로 든다
        after = _day(traffic["daily"], target + DAY)
        assert (
            after["members_dau"],
            after["guests_dau"],
            after["play_sessions_created"],
        ) == (1, 0, 1)

    mysql_run(scenario)


def test_security_summary_counts_only_current_login_throttle_window():
    async def scenario(sessions):
        now = utc_now()
        async with sessions() as db:
            seed = Seed2(db)
            admin = seed.user("운영자", now - 30 * DAY, role="admin")
            seed.throttle(
                failed=3, window_started_at=now - 20 * MINUTE
            )  # 창(15분) 지남 — 다음 실패 때 버려진다
            seed.throttle(failed=2, window_started_at=now - 5 * MINUTE)  # 현재 창
            seed.throttle(
                failed=5,
                window_started_at=now - 10 * MINUTE,
                locked_until=now + 5 * MINUTE,
            )  # 현재 창 · 잠김
            seed.throttle(
                failed=5,
                window_started_at=now - 40 * MINUTE,
                locked_until=now - 25 * MINUTE,
            )  # 창도 잠김도 지남
            await seed.save()
        sign_in(admin)

        body = await get_json("/api/v1/admin/security/summary")
        assert body["login_throttle"] == {
            "locked_now": 1,
            "keys_with_failures": 2,
            "failures_in_window": 7,
        }

    mysql_run(scenario)
