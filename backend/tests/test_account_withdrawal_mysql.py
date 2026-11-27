"""격리 MySQL 에서 회원 탈퇴 Phase 1(11/17 세진, revision 93fb40166c08 · 계약 `docs/contracts/account_withdrawal_v0.2.md`)을 본다.

실행 조건 · 안전 장치는 `test_admin_api_mysql.py` 와 같다(`ADMIN_API_MYSQL_ISOLATED=1` · `ADMIN_API_MYSQL_URL` · `ADMIN_API_MYSQL_DATADIR`,
`test_admin_api_` 접두사의 빈 schema, 3306 이 아닌 포트, 접속 뒤 `@@datadir` 대조, 끝나면 표를 지운다).

- migration: 열 형식 · 색인 없음 · 기존 회원 NULL · 회원 행 그대로 · downgrade(탈퇴 회원이 있으면 멈춤)
- 실제 요청으로 탈퇴: 지울 것(문의 · 저장 · 캐릭터 · 아이템 · 수단 · 세션 · NPC 해시 · NPC 재전송 기록 · 임시 행) · 남길 것(회원 행 ·
  회차 · 다른 상호작용 · 퍼즐 answer · 베타 기록 · 승계 · 감사 · 비로그인 문의) · 개인정보 잔존 검사 · 옛 쿠키 · 옛 로그인 차단 · 같은
  이메일 · 닉네임 즉시 재가입(옛 기록과 이어지지 않음) · 통계(게임 집계 그대로, 게스트로 안 바뀜, 현재 회원 수 · 목록에서 빠짐)
- 거절: 소셜 전용 · 틀린 비밀번호 · 관리자 — 아무것도 바뀌지 않음. 이메일+소셜 · 테스트 계정은 탈퇴(테스트 계정은 계속 내부 계정)
- 중간 실패 → 통째로 되돌림
- 경합: 탈퇴 vs 로그인 · 게임 저장 · 문의 · 같은 탈퇴 두 번(교착 없음)
- 게스트 쿠키(11/19): 요청 쿠키의 게스트만 폐기 · 두 쿠키 만료 · 옛 게스트 쿠키 재사용 · 재가입 승계 차단 · 실패 · 거절이면 게스트 그대로 ·
  다른 게스트 그대로 · 게스트 회차 · 승계 기록 · 게임 집계 보존 · 잘못된 · 만료 · 폐기 게스트 쿠키는 탈퇴를 막지 않음
"""

import asyncio
import os
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings
from app.main import app
from app.models.account_data import (
    AdminAuditLog,
    GamePlaySave,
    ItemCatalog,
    LoginThrottle,
    UserCharacter,
    UserItem,
    UserSession,
)
from app.models.anonymous_session import AnonymousSession
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.models.beta_event import BetaEvent
from app.models.guest_session import GuestSession, GuestSessionTransfer
from app.models.inquiry import Inquiry, InquiryReply
from app.models.interaction_event import InteractionEvent
from app.models.npc_turn_idempotency import NpcTurnRequest, NpcTurnResponseBody
from app.models.play_session import PlaySession
from app.models.social_onboarding_pending import SocialOnboardingPending
from app.services import account_withdrawal, user_session
from app.services.admin_query import kst_day_start_utc, kst_today
from app.services.guest_session import GUEST_COOKIE
from app.services.local_auth import hash_password, utc_now
from app.services.user_session import current_user
from tests.test_admin_api_mysql import DAY, HOUR, mysql_run, sign_in
from tests.test_admin_is_test_mysql import (
    SeedT,
    _isolated_url,
    _migration,
    _run_revisions,
)
from tests.test_npc_turn_idempotency_mysql import drop_remaining_tables, script

pytestmark = pytest.mark.skipif(
    os.environ.get("ADMIN_API_MYSQL_ISOLATED") != "1",
    reason="explicit isolated admin API MySQL test database required",
)

REVISION = "93fb40166c08"
PASSWORD = "Zebra-Moon-2491"
NPC_HASH = "ab" * 32
PATH = "/api/v1/me/withdrawal"


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers={"Origin": settings.cors_origins[0]},
    )


def _as_cookie_user() -> None:
    """관리자 조회용 덮어쓰기를 걷는다 — 탈퇴 · 로그인은 실제 쿠키 세션으로 확인한다."""

    app.dependency_overrides.pop(current_user, None)


# --- migration ---


def test_migration_adds_nullable_column_and_downgrade_guards_withdrawn_rows():
    async def execute():
        url = _isolated_url()
        expected = Path(os.environ["ADMIN_API_MYSQL_DATADIR"]).resolve()
        engine = create_async_engine(url, hide_parameters=True)
        initialized = False
        try:
            async with engine.begin() as connection:
                database, datadir = (
                    await connection.execute(text("SELECT DATABASE(), @@datadir"))
                ).one()
                assert database == url.database
                assert Path(datadir).resolve() == expected
                assert not (await connection.execute(text("SHOW TABLES"))).all()
                heads = script().get_heads()
                # 단일 head 이고, 이 revision 은 그 조상이다(뒤에 비밀번호 찾기 b7e4c2a9d1f3 이 올라섰다, 11/25)
                assert len(heads) == 1
                assert REVISION in [
                    rev.revision for rev in script().iterate_revisions(heads[0], "base")
                ]
                assert script().get_revision(REVISION).down_revision == "744dc740f81f"
                initialized = True

                await connection.run_sync(_run_revisions, stop_before=REVISION)
                at = utc_now().replace(microsecond=123456)
                ids = [str(uuid4()) for _ in range(2)]
                for index, user_id in enumerate(ids):
                    await connection.execute(
                        text(
                            "INSERT INTO app_users (id, email, nickname, role, created_at, updated_at) "
                            "VALUES (:id, :email, :nick, 'user', :at, :at)"
                        ),
                        {
                            "id": user_id,
                            "email": f"m{index}@example.com",
                            "nick": f"이전{index}",
                            "at": at,
                        },
                    )

                await connection.run_sync(_migration, REVISION, "upgrade")
                column = (
                    await connection.execute(
                        text(
                            "SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS "
                            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' "
                            "AND COLUMN_NAME = 'deleted_at'"
                        )
                    )
                ).one()
                assert tuple(column) == ("datetime(6)", "YES", None)
                indexed = (
                    await connection.execute(
                        text(
                            "SELECT COUNT(*) FROM information_schema.STATISTICS "
                            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' "
                            "AND COLUMN_NAME = 'deleted_at'"
                        )
                    )
                ).scalar_one()
                assert indexed == 0
                rows = (
                    await connection.execute(
                        text(
                            "SELECT email, deleted_at, updated_at FROM app_users ORDER BY email"
                        )
                    )
                ).all()
                assert [tuple(row) for row in rows] == [
                    ("m0@example.com", None, at),
                    ("m1@example.com", None, at),
                ]

                # 탈퇴 회원이 있으면 downgrade 는 멈춘다(열 · 값 그대로)
                await connection.execute(
                    text("UPDATE app_users SET deleted_at = :at WHERE id = :id"),
                    {"at": at, "id": ids[0]},
                )
                with pytest.raises(RuntimeError, match="withdrawn account"):
                    await connection.run_sync(_migration, REVISION, "downgrade")
                assert (
                    await connection.execute(
                        text(
                            "SELECT COUNT(*) FROM app_users WHERE deleted_at IS NOT NULL"
                        )
                    )
                ).scalar_one() == 1

                # 없으면 열만 지운다(회원 행 그대로)
                await connection.execute(text("UPDATE app_users SET deleted_at = NULL"))
                await connection.run_sync(_migration, REVISION, "downgrade")
                remaining = {
                    row[0]
                    for row in (
                        await connection.execute(
                            text(
                                "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
                                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users'"
                            )
                        )
                    ).all()
                }
                assert "deleted_at" not in remaining and "last_login_at" in remaining
                assert (
                    await connection.execute(text("SELECT COUNT(*) FROM app_users"))
                ).scalar_one() == 2
                # 다시 올리면 같은 열
                await connection.run_sync(_migration, REVISION, "upgrade")
        finally:
            if initialized:
                async with engine.begin() as connection:
                    await connection.run_sync(drop_remaining_tables)
            await engine.dispose()

    asyncio.run(execute())


# --- 시험 데이터 ---


class World:
    """관리자 · 탈퇴할 회원 · 다른 회원 · 테스트 계정과 그 플레이 · 문의 · 저장 데이터."""

    def __init__(self, sessions) -> None:
        self.sessions = sessions
        self.target = kst_today() - 2 * DAY
        self.start = kst_day_start_utc(self.target)

    async def seed(self) -> None:
        async with self.sessions() as db:
            seed = SeedT(db)
            created = self.start - 10 * DAY
            self.admin = seed.user("운영자", created - 20 * DAY, role="admin")
            self.member = seed.user("떠날회원", created, email="leaver@example.com")
            self.other = seed.user("남는회원", created, email="stayer@example.com")
            self.both = seed.user("둘다회원", created, email="both@example.com")
            self.social = seed.user("소셜만", created, email="social@example.com")
            self.tester = seed.tester("팀시험", created)
            for user in (self.member, self.other, self.both, self.social, self.tester):
                user.terms_version = "2026-11-01"
                user.terms_accepted_at = created
                user.privacy_accepted_at = created
                user.age_confirmed_at = created
                user.last_login_at = created
            self.guest = seed.guest()
            # 로그인 전 게스트 기록이 회원에게 승계됐다 — 게임 집계는 그 게스트를 회원으로 합쳐 센다
            self.guest_session_id = seed.transfer_with_id(
                self.guest, self.member, self.start + 30 * 60 * timedelta(seconds=1)
            )
            t = self.start + HOUR
            for user, run in (
                (self.member, "run-m"),
                (self.other, "run-o"),
                (self.tester, "run-t"),
            ):
                seed.groups[3].append(
                    _event("run_state", "start", t, user=user, run=run)
                )
                seed.groups[3].append(
                    _event(
                        "run_state",
                        "released",
                        t + 30 * 60 * timedelta(seconds=1),
                        user=user,
                        run=run,
                    )
                )
            seed.groups[3].append(
                _event(
                    "stage_reached",
                    "character_open",
                    t,
                    guest_session_id=self.guest_session_id,
                )
            )
            await seed.save()

        async with self.sessions() as db:
            for user in (self.member, self.other, self.both, self.tester):
                db.add(_identity(user, "local", user.email, hash_password(PASSWORD)))
            self.both_subject = uuid4().hex
            self.social_subject = uuid4().hex
            db.add(_identity(self.both, "google", self.both_subject, None))
            db.add(_identity(self.social, "naver", self.social_subject, None))
            await db.commit()

        async with self.sessions() as db:
            db.add(
                ItemCatalog(
                    id="lantern",
                    kind="tool",
                    name="등불",
                    metadata_json={},
                    created_at=self.start,
                )
            )
            await db.flush()
            for user in (self.member, self.other, self.both, self.social, self.tester):
                await self._personal_rows(db, user)
            db.add(
                SocialOnboardingPending(
                    id=str(uuid4()),
                    token_hash=uuid4().hex + uuid4().hex,
                    provider="google",
                    provider_subject=self.both_subject,
                    email=self.both.email,
                    created_at=self.start,
                    expires_at=self.start + DAY,
                    consumed_at=self.start,
                )
            )
            # 같은 이메일로 로그인 없이 낸 문의 — 탈퇴 회원과 이어지지 않아 남는다(로그인 회원 문의만 삭제)
            db.add(_inquiry(None, self.member.email, "비로그인 문의"))
            db.add(
                AdminAuditLog(
                    admin_user_id=self.admin.id,
                    action="view_user",
                    target_user_id=self.member.id,
                    created_at=self.start,
                )
            )
            await db.commit()

    async def _personal_rows(self, db, user: AppUser) -> None:
        now = self.start
        play = PlaySession(
            id=str(uuid4()),
            anonymous_session_id=self.guest,
            case_id="naju-angam-01",
            state_json={"completed_puzzle_ids": []},
            created_at=now,
            updated_at=now,
            hint_balance=0,
            help_used=0,
            owner_user_id=user.id,
        )
        db.add(play)
        await db.flush()
        db.add_all(
            [
                _interaction(
                    play.id,
                    "npc_turn",
                    {
                        "trigger": "player_message",
                        "focus_object_id": "O1",
                        "message_sha256": NPC_HASH,
                    },
                ),
                _interaction(
                    play.id,
                    "npc_turn",
                    {
                        "trigger": "auto",
                        "focus_object_id": None,
                        "message_sha256": None,
                    },
                ),
                _interaction(
                    play.id,
                    "submit_answer",
                    {"answer": answer_of(user)},
                    result_type="incorrect",
                ),
                _interaction(play.id, "inspect", {}),
                NpcTurnRequest(
                    play_session_id=play.id,
                    turn_request_id=str(uuid4()),
                    request_body_hash="v1:k1:" + "c" * 64,
                    status="issued",
                    case_id="naju-angam-01",
                    content_version=1,
                    content_fingerprint="f" * 64,
                    created_at=now,
                ),
                GamePlaySave(
                    id=str(uuid4()),
                    app_user_id=user.id,
                    slot=0,
                    revision=1,
                    schema_version=1,
                    stage="naju",
                    state_json={"x": 1},
                    created_at=now,
                    updated_at=now,
                ),
                UserCharacter(
                    app_user_id=user.id,
                    display_name="조사관이름",
                    appearance_json={},
                    updated_at=now,
                ),
                UserItem(
                    id=str(uuid4()),
                    app_user_id=user.id,
                    item_id="lantern",
                    quantity=1,
                    source="test",
                    acquired_at=now,
                ),
            ]
        )
        await db.flush()
        request = (
            await db.scalars(
                select(NpcTurnRequest).where(NpcTurnRequest.play_session_id == play.id)
            )
        ).one()
        db.add(
            NpcTurnResponseBody(
                play_session_id=play.id,
                turn_request_id=request.turn_request_id,
                response_json={
                    "reply": {"source": "approved_line", "text": "승인 대사"}
                },
                created_at=now,
            )
        )
        inquiry = _inquiry(user.id, user.email, f"{user.nickname} 문의")
        db.add(inquiry)
        await db.flush()
        db.add(
            InquiryReply(
                id=str(uuid4()),
                inquiry_id=inquiry.id,
                admin_user_id=self.admin.id,
                body="답변",
                created_at=now,
            )
        )

    async def count(self, model, *conditions) -> int:
        async with self.sessions() as db:
            return int(
                (
                    await db.execute(
                        select(func.count()).select_from(model).where(*conditions)
                    )
                ).scalar_one()
            )

    async def user(self, user_id: str) -> AppUser:
        async with self.sessions() as db:
            return await db.get(AppUser, user_id, populate_existing=True)

    async def snapshot(self, user: AppUser) -> dict:
        """그 회원에 이어진 행 수 — 거절 · 실패 뒤 아무것도 바뀌지 않았는지 대조한다."""

        plays = select(PlaySession.id).where(PlaySession.owner_user_id == user.id)
        async with self.sessions() as db:
            hashes = (
                await db.scalars(
                    select(InteractionEvent.payload_json).where(
                        InteractionEvent.play_session_id.in_(plays),
                        InteractionEvent.interaction_type == "npc_turn",
                    )
                )
            ).all()
            answers = (
                await db.scalars(
                    select(InteractionEvent.payload_json).where(
                        InteractionEvent.play_session_id.in_(plays),
                        InteractionEvent.interaction_type == "submit_answer",
                    )
                )
            ).all()
        row = await self.user(user.id)
        return {
            "identities": await self.count(
                AuthIdentity, AuthIdentity.app_user_id == user.id
            ),
            "sessions": await self.count(
                UserSession, UserSession.app_user_id == user.id
            ),
            "saves": await self.count(
                GamePlaySave, GamePlaySave.app_user_id == user.id
            ),
            "characters": await self.count(
                UserCharacter, UserCharacter.app_user_id == user.id
            ),
            "items": await self.count(UserItem, UserItem.app_user_id == user.id),
            "inquiries": await self.count(Inquiry, Inquiry.app_user_id == user.id),
            "npc_requests": await self.count(
                NpcTurnRequest, NpcTurnRequest.play_session_id.in_(plays)
            ),
            "npc_hashes": sorted(
                str(payload.get("message_sha256")) for payload in hashes
            ),
            "answers": sorted(str(payload.get("answer")) for payload in answers),
            "user": (
                row.email,
                row.nickname,
                row.region,
                row.terms_version,
                row.deleted_at,
            ),
        }


def _identity(user, provider, subject, password_hash) -> AuthIdentity:
    return AuthIdentity(
        id=str(uuid4()),
        app_user_id=user.id,
        provider=provider,
        provider_subject=subject,
        password_hash=password_hash,
        created_at=user.created_at,
        updated_at=user.created_at,
    )


def answer_of(user: AppUser) -> str:
    """회원마다 다른 퍼즐 입력 — 탈퇴 뒤 DB 어디에도 남지 않는지 문자열로 찾는다."""

    return f"answer-{user.id[:8]}-7781"


def _interaction(
    play_session_id, kind, payload, *, result_type: str = "ok"
) -> InteractionEvent:
    return InteractionEvent(
        id=str(uuid4()),
        play_session_id=play_session_id,
        client_event_id=str(uuid4()),
        interaction_type=kind,
        payload_json=payload,
        result_type=result_type,
        response_json={"result_type": result_type},
        created_at=utc_now(),
    )


def _inquiry(user_id, email, title) -> Inquiry:
    now = utc_now()
    return Inquiry(
        id=str(uuid4()),
        number=f"Q-{uuid4().hex[:12]}",
        app_user_id=user_id,
        email=email,
        category="account",
        title=title,
        body=f"{title} 본문",
        status="open",
        priority="normal",
        client_ip="203.0.113.7",
        created_at=now,
        updated_at=now,
    )


def _event(kind, phase, at, *, user=None, run=None, guest_session_id=None) -> BetaEvent:
    return BetaEvent(
        event_id=str(uuid4()),
        received_at=at,
        client_ts=at,
        event_type=kind,
        phase=phase,
        run_id=run,
        page="naju",
        app_user_id=user.id if user else None,
        guest_session_id=guest_session_id,
        data={"origin": "live"},
    )


async def _login(http: httpx.AsyncClient, email: str, password: str = PASSWORD) -> None:
    response = await http.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert response.status_code == 200, response.text


async def _admin_get(world: World, path: str, **params) -> dict:
    sign_in(world.admin)
    try:
        async with _client() as http:
            response = await http.get(path, params=params)
    finally:
        _as_cookie_user()
    assert response.status_code == 200, response.text
    return response.json()


GAME_KEYS = (
    "people",
    "case_completed_people",
    "completed_runs",
    "avg_completion_minutes",
    "median_completion_minutes",
    "funnel",
    "stages",
    "entry_only_stages",
    "puzzles",
)


async def _game(world: World, include_internal: str) -> dict:
    body = await _admin_get(
        world,
        "/api/v1/admin/stats/game",
        date=world.target.isoformat(),
        days=1,
        include_internal=include_internal,
    )
    return {key: body[key] for key in GAME_KEYS}


# --- 정상 탈퇴 ---


def test_email_member_withdrawal_deletes_anonymizes_keeps_and_allows_resignup():
    async def scenario(sessions):
        world = World(sessions)
        await world.seed()
        member = world.member
        before_game = {flag: await _game(world, flag) for flag in ("false", "true")}
        before_summary = await _admin_get(
            world, "/api/v1/admin/stats/summary", date=world.target.isoformat()
        )
        before_members = await _admin_get(
            world, "/api/v1/admin/stats/members", date=world.target.isoformat()
        )
        before_traffic = await _admin_get(
            world, "/api/v1/admin/stats/traffic", date=world.target.isoformat(), days=1
        )
        assert (
            before_game["false"]["people"] == 2
        )  # 탈퇴 회원(+승계 게스트) · 남는 회원, 테스트 계정 제외
        keep = {
            "plays": await world.count(
                PlaySession, PlaySession.owner_user_id == member.id
            ),
            "events": await world.count(BetaEvent, BetaEvent.app_user_id == member.id),
            "transfers": await world.count(
                GuestSessionTransfer, GuestSessionTransfer.app_user_id == member.id
            ),
            "audits": await world.count(
                AdminAuditLog, AdminAuditLog.target_user_id == member.id
            ),
            "interactions": await world.count(InteractionEvent),
        }
        other_before = await world.snapshot(world.other)

        async with _client() as phone, _client() as laptop:
            await _login(phone, member.email)
            await _login(laptop, member.email)
            # 틀린 비밀번호 한 번 → 실패 집계(이메일 키)가 생긴다. 탈퇴가 그 행도 지운다
            wrong = await phone.post(PATH, json={"password": "Wrong-Pass-77"})
            assert (
                wrong.status_code == 401
                and wrong.json()["detail"]["code"] == "invalid_password"
            )
            email_key = account_withdrawal._login_throttle_key(member.email)
            assert (
                await world.count(LoginThrottle, LoginThrottle.key_hash == email_key)
                == 1
            )

            done = await phone.post(PATH, json={"password": PASSWORD})
            assert done.status_code == 204, done.text
            assert "Max-Age=0" in done.headers["set-cookie"]
            # 두 기기 모두 끊긴다
            assert (await phone.get("/api/v1/me")).status_code == 401
            assert (await laptop.get("/api/v1/me")).status_code == 401
            # 같은 쿠키로 다시 → 401
            again = await laptop.post(PATH, json={"password": PASSWORD})
            assert again.status_code == 401 and again.json() == {
                "detail": "Login required."
            }

        row = await world.user(member.id)
        assert row.deleted_at is not None and row.updated_at == row.deleted_at
        assert row.email.startswith("deleted+") and row.email.endswith(
            "@withdrawn.invalid"
        )
        assert row.nickname.startswith("탈퇴#")
        assert (
            row.region,
            row.terms_version,
            row.terms_accepted_at,
            row.privacy_accepted_at,
        ) == (None, None, None, None)
        assert (row.age_confirmed_at, row.last_login_at) == (None, None)
        assert (row.role, row.is_test, row.created_at) == (
            "user",
            False,
            member.created_at,
        )

        gone = await world.snapshot(member)
        assert {
            k: v for k, v in gone.items() if k not in {"npc_hashes", "answers", "user"}
        } == {
            "identities": 0,
            "sessions": 0,
            "saves": 0,
            "characters": 0,
            "items": 0,
            "inquiries": 0,
            "npc_requests": 0,
        }
        assert gone["answers"] == ["None"]  # 퍼즐 입력도 지웠다(행은 남음)
        assert gone["npc_hashes"] == [
            "None",
            "None",
        ]  # 자유 대화 해시만 지웠다(행 · 다른 키는 그대로)
        assert (
            await world.count(NpcTurnResponseBody) == 4
        )  # 다른 네 계정 몫만 남음(본문은 FK CASCADE)
        assert await world.count(InquiryReply) == 4
        assert (
            await world.count(LoginThrottle, LoginThrottle.key_hash == email_key) == 0
        )
        # 남기는 것
        assert keep == {
            "plays": await world.count(
                PlaySession, PlaySession.owner_user_id == member.id
            ),
            "events": await world.count(BetaEvent, BetaEvent.app_user_id == member.id),
            "transfers": await world.count(
                GuestSessionTransfer, GuestSessionTransfer.app_user_id == member.id
            ),
            "audits": await world.count(
                AdminAuditLog, AdminAuditLog.target_user_id == member.id
            ),
            "interactions": await world.count(InteractionEvent),
        }
        plays = select(PlaySession.id).where(PlaySession.owner_user_id == member.id)
        async with sessions() as db:
            payloads = {
                event.interaction_type: event.payload_json
                for event in (
                    await db.scalars(
                        select(InteractionEvent).where(
                            InteractionEvent.play_session_id.in_(plays)
                        )
                    )
                ).all()
                if event.interaction_type != "npc_turn"
            }
            npc = (
                await db.scalars(
                    select(InteractionEvent.payload_json).where(
                        InteractionEvent.play_session_id.in_(plays),
                        InteractionEvent.interaction_type == "npc_turn",
                    )
                )
            ).all()
        # 퍼즐 입력 answer 는 null(미르 11/17), 행 · 판정 결과(result_type · response_json)는 그대로
        assert payloads == {"submit_answer": {"answer": None}, "inspect": {}}
        async with sessions() as db:
            judged = (
                await db.execute(
                    select(
                        InteractionEvent.result_type, InteractionEvent.response_json
                    ).where(
                        InteractionEvent.play_session_id.in_(plays),
                        InteractionEvent.interaction_type == "submit_answer",
                    )
                )
            ).one()
        assert tuple(judged) == ("incorrect", {"result_type": "incorrect"})
        assert {
            "trigger": "player_message",
            "focus_object_id": "O1",
            "message_sha256": None,
        } in npc
        assert (
            await world.count(
                Inquiry, Inquiry.app_user_id.is_(None), Inquiry.email == member.email
            )
            == 1
        )
        # 다른 회원 것은 그대로
        assert await world.snapshot(world.other) == other_before

        # 개인정보 잔존: 원래 이메일 · 닉네임이 남은 곳은 비로그인 문의(이메일 칸) 하나뿐
        async with sessions() as db:
            columns = (
                await db.execute(
                    text(
                        "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                        "AND DATA_TYPE IN ('char','varchar','text','mediumtext','longtext','json')"
                    )
                )
            ).all()
            found = set()
            for table, column in columns:
                for label, needle in (
                    ("email", member.email),
                    ("nickname", member.nickname),
                    ("answer", answer_of(member)),
                ):
                    hits = (
                        await db.execute(
                            text(
                                f"SELECT COUNT(*) FROM `{table}` WHERE CAST(`{column}` AS CHAR) LIKE :needle"
                            ),
                            {"needle": f"%{needle}%"},
                        )
                    ).scalar_one()
                    if hits:
                        found.add((label, table, column, hits))
        assert found == {("email", "inquiries", "email", 1)}

        # 옛 이메일 로그인은 실패, 같은 이메일 · 닉네임으로 바로 새로 가입된다(옛 기록과 잇지 않는다)
        async with _client() as http:
            old = await http.post(
                "/api/v1/auth/login", json={"email": member.email, "password": PASSWORD}
            )
            assert old.status_code == 401 and old.json() == {
                "detail": "Invalid email or password."
            }
            fresh = await http.post(
                "/api/v1/auth/register",
                json={
                    "email": member.email,
                    "password": PASSWORD,
                    "nickname": member.nickname,
                    "consent": {"terms": True, "privacy": True, "age": True},
                },
            )
            assert fresh.status_code == 201, fresh.text
            new_id = fresh.json()["user"]["user_id"]
            assert new_id != member.id
            assert (await http.get("/api/v1/me")).json()["user_id"] == new_id
        assert await world.count(PlaySession, PlaySession.owner_user_id == new_id) == 0
        assert await world.count(BetaEvent, BetaEvent.app_user_id == new_id) == 0
        assert (
            await world.count(
                GuestSessionTransfer, GuestSessionTransfer.app_user_id == new_id
            )
            == 0
        )

        # 통계: 게임 집계는 그대로(탈퇴 회원 · 승계 게스트가 게스트로 바뀌지 않음), 활동도 그대로
        for flag in ("false", "true"):
            assert await _game(world, flag) == before_game[flag]
        traffic = await _admin_get(
            world, "/api/v1/admin/stats/traffic", date=world.target.isoformat(), days=1
        )
        assert (
            traffic["daily"][0]["members_dau"]
            == before_traffic["daily"][0]["members_dau"]
        )
        assert (
            traffic["daily"][0]["guests_dau"]
            == before_traffic["daily"][0]["guests_dau"]
        )
        # 현재 회원 수: 탈퇴 −1, 새 가입 +1. 지역 「(미입력)」이 늘지 않는다(새 가입은 지역 없음 → +1 만)
        summary = await _admin_get(
            world, "/api/v1/admin/stats/summary", date=world.target.isoformat()
        )
        assert summary["members"]["total"] == before_summary["members"]["total"]
        members = await _admin_get(
            world, "/api/v1/admin/stats/members", date=world.target.isoformat()
        )
        assert members["totals"]["total"] == before_members["totals"]["total"]
        regions = {b["label"]: b["count"] for b in members["by_region"]}
        before_regions = {b["label"]: b["count"] for b in before_members["by_region"]}
        assert regions.get("naju", 0) == before_regions["naju"] - 1
        assert regions.get("(미입력)", 0) == before_regions.get("(미입력)", 0) + 1
        listed = {u["user_id"] for u in members["recent_signups"]}
        assert member.id not in listed and new_id in listed
        users = await _admin_get(world, "/api/v1/admin/users")
        assert member.id not in {u["user_id"] for u in users["users"]}
        assert new_id in {u["user_id"] for u in users["users"]}

        # 관리자 상세: 탈퇴 회원은 id 로 열면 deleted_at 으로 알 수 있다(그 밖의 값은 비식별화 · 비움), 회원은 null
        gone_detail = (await _admin_get(world, f"/api/v1/admin/users/{member.id}"))[
            "user"
        ]
        assert gone_detail["deleted_at"] == row.deleted_at.isoformat()
        assert (
            gone_detail["email"] == row.email
            and gone_detail["nickname"] == row.nickname
        )
        assert (gone_detail["region"], gone_detail["providers"]) == (None, [])
        assert (
            gone_detail["last_login_at"],
            gone_detail["last_session_started_at"],
        ) == (
            None,
            None,
        )
        assert (gone_detail["role"], gone_detail["stage"]) == ("user", None)
        stay_detail = (
            await _admin_get(world, f"/api/v1/admin/users/{world.other.id}")
        )["user"]
        assert stay_detail["deleted_at"] is None and stay_detail["region"] == "naju"

    mysql_run(scenario)


# --- 거절 · 이메일+소셜 · 테스트 계정 · 관리자 ---


def test_refusals_change_nothing_and_variants_withdraw():
    async def scenario(sessions):
        world = World(sessions)
        await world.seed()

        # 소셜 전용: 세션을 직접 만들어 쿠키로 부른다(소셜 로그인 왕복 없이)
        async with sessions() as db:
            token = "social-cookie-token"
            db.add(
                UserSession(
                    id=str(uuid4()),
                    app_user_id=world.social.id,
                    token_hash=user_session.hash_session_token(token),
                    created_at=utc_now(),
                    expires_at=utc_now() + DAY,
                )
            )
            await db.commit()
        social_before = await world.snapshot(world.social)
        async with _client() as http:
            http.cookies.set(user_session.SESSION_COOKIE, token)
            refused = await http.post(PATH, json={"password": PASSWORD})
            assert (
                refused.status_code == 403
                and refused.json()["detail"]["code"] == "reauth_required"
            )
            assert "set-cookie" not in refused.headers
            assert (await http.get("/api/v1/me")).status_code == 200
        assert await world.snapshot(world.social) == social_before

        # 틀린 비밀번호: 아무것도 안 바뀌고, 다섯 번이면 잠긴다(로그인과 같은 집계)
        other_before = await world.snapshot(world.other)
        async with _client() as http:
            await _login(http, world.other.email)
            other_before["sessions"] += 1
            for _ in range(5):
                wrong = await http.post(PATH, json={"password": "Wrong-Pass-77"})
                assert wrong.status_code == 401
            locked = await http.post(PATH, json={"password": PASSWORD})
            assert locked.status_code == 429 and int(locked.headers["retry-after"]) > 0
            missing = await http.post(PATH, json={})
            assert missing.status_code == 429
        assert await world.snapshot(world.other) == other_before

        # 관리자: 403, 그대로
        async with sessions() as db:
            db.add(
                _identity(
                    world.admin, "local", world.admin.email, hash_password(PASSWORD)
                )
            )
            await db.commit()
        admin_before = await world.snapshot(world.admin)
        async with _client() as http:
            await _login(http, world.admin.email)
            admin_before["sessions"] += 1
            refused = await http.post(PATH, json={"password": PASSWORD})
            assert (
                refused.status_code == 403
                and refused.json()["detail"]["code"] == "admin_cannot_withdraw"
            )
        assert await world.snapshot(world.admin) == admin_before

        # 이메일+소셜: 이메일 비밀번호로 탈퇴, 소셜 수단 · 그 소셜 가입 대기 행도 지운다
        async with _client() as http:
            await _login(http, world.both.email)
            assert (
                await http.post(PATH, json={"password": PASSWORD})
            ).status_code == 204
        both = await world.snapshot(world.both)
        assert (
            both["identities"] == 0
            and both["sessions"] == 0
            and both["user"][4] is not None
        )
        assert (
            await world.count(
                SocialOnboardingPending,
                SocialOnboardingPending.provider_subject == world.both_subject,
            )
            == 0
        )

        # 테스트 계정: 탈퇴되고, 기본 통계(include_internal=false)에서는 계속 빠진다
        before = {flag: await _game(world, flag) for flag in ("false", "true")}
        async with _client() as http:
            await _login(http, world.tester.email)
            assert (
                await http.post(PATH, json={"password": PASSWORD})
            ).status_code == 204
        tester = await world.user(world.tester.id)
        assert tester.deleted_at is not None and tester.is_test is True
        for flag in ("false", "true"):
            assert await _game(world, flag) == before[flag]

    mysql_run(scenario)


# --- 중간 실패 → 통째로 되돌림 ---


def test_failure_in_the_middle_rolls_everything_back(monkeypatch):
    async def scenario(sessions):
        world = World(sessions)
        await world.seed()

        def broken():
            raise RuntimeError("injected failure after deletions")

        monkeypatch.setattr(account_withdrawal, "withdrawn_nickname", broken)
        async with _client() as http:
            await _login(http, world.member.email)
            before = await world.snapshot(world.member)
            with pytest.raises(RuntimeError, match="injected"):
                await http.post(PATH, json={"password": PASSWORD})
            # 쿠키 · 세션 그대로 — 다시 쓸 수 있다
            assert (await http.get("/api/v1/me")).status_code == 200
        assert await world.snapshot(world.member) == before
        assert before["npc_hashes"] == ["None", NPC_HASH] and before["saves"] == 1
        assert before["answers"] == [answer_of(world.member)]

    mysql_run(scenario)


# --- 게스트 쿠키 · 게스트 세션(11/19 미르 요청) ---


async def _guest_with_play(sessions, token: str) -> tuple[str, str, str]:
    """유효한 게스트(쿠키 원문 `token`)와 그 게스트가 가진 회차 하나. (게스트 id, 익명 세션 id, 회차 id)."""

    now = utc_now()
    anonymous_id, guest_id, play_id = (str(uuid4()) for _ in range(3))
    async with sessions() as db:
        db.add(AnonymousSession(id=anonymous_id, created_at=now, expires_at=now + DAY))
        await db.flush()
        db.add(
            GuestSession(
                id=guest_id,
                anonymous_session_id=anonymous_id,
                token_hash=user_session.hash_session_token(token),
                created_at=now,
                expires_at=now + DAY,
            )
        )
        db.add(
            PlaySession(
                id=play_id,
                anonymous_session_id=anonymous_id,
                case_id="naju-angam-01",
                state_json={"completed_puzzle_ids": []},
                created_at=now,
                updated_at=now,
                hint_balance=0,
                help_used=0,
                owner_anonymous_session_id=anonymous_id,
            )
        )
        await db.commit()
    return guest_id, anonymous_id, play_id


async def _guest_state(sessions, guest_id: str, play_id: str) -> tuple:
    """(revoked_at, expires_at, 회차 owner_user_id, 회차 owner_anonymous_session_id)."""

    async with sessions() as db:
        guest = await db.get(GuestSession, guest_id, populate_existing=True)
        play = await db.get(PlaySession, play_id, populate_existing=True)
        return (
            guest.revoked_at,
            guest.expires_at,
            play.owner_user_id,
            play.owner_anonymous_session_id,
        )


def _expired(response: httpx.Response) -> set[str]:
    names = set()
    for line in response.headers.get_list("set-cookie"):
        assert "Max-Age=0" in line, line
        names.add(line.split("=", 1)[0])
    return names


async def _anonymous_session_id(guest_token: str) -> tuple[str, bool]:
    """게스트 쿠키만 든 브라우저로 익명 세션 창구를 부른다 — (익명 세션 id, 새 게스트 쿠키가 발급됐는지)."""

    async with _client() as http:
        http.cookies.set(GUEST_COOKIE, guest_token)
        response = await http.post("/api/v1/anonymous-sessions")
        assert response.status_code == 201, response.text
        issued = any(
            line.startswith(f"{GUEST_COOKIE}=")
            for line in response.headers.get_list("set-cookie")
        )
        return response.json()["data"]["anonymous_session_id"], issued


@pytest.mark.real_play_auth
def test_withdrawal_revokes_the_request_guest_and_blocks_its_reuse(monkeypatch):
    async def scenario(sessions):
        world = World(sessions)
        await world.seed()
        member = world.member
        mine_token, other_token = f"mine-{uuid4().hex}", f"other-{uuid4().hex}"
        mine_guest, mine_anonymous, mine_play = await _guest_with_play(
            sessions, mine_token
        )
        other_guest, other_anonymous, other_play = await _guest_with_play(
            sessions, other_token
        )
        mine_before = await _guest_state(sessions, mine_guest, mine_play)
        other_before = await _guest_state(sessions, other_guest, other_play)
        assert mine_before[0] is None and mine_before[2] is None
        transfers_before = await world.count(GuestSessionTransfer)
        game_before = {flag: await _game(world, flag) for flag in ("false", "true")}

        async with _client() as http:
            # 로그인 승계가 쿠키를 지우지 않도록 로그인 뒤에 게스트 쿠키를 싣는다(로그인한 채 게임에서 받은 게스트)
            await _login(http, member.email)
            http.cookies.set(GUEST_COOKIE, mine_token)

            # 탈퇴 트랜잭션 중간 실패 → 게스트 폐기도 되돌린다(회원 · 쿠키 · 게스트 모두 그대로)
            def broken():
                raise RuntimeError("injected failure after deletions")

            original = account_withdrawal.withdrawn_nickname
            monkeypatch.setattr(account_withdrawal, "withdrawn_nickname", broken)
            member_before = await world.snapshot(member)
            with pytest.raises(RuntimeError, match="injected"):
                await http.post(PATH, json={"password": PASSWORD})
            monkeypatch.setattr(account_withdrawal, "withdrawn_nickname", original)
            assert await world.snapshot(member) == member_before
            assert await _guest_state(sessions, mine_guest, mine_play) == mine_before
            assert (await http.get("/api/v1/me")).status_code == 200

            # 틀린 비밀번호 → 그대로, 쿠키도 내려가지 않는다
            wrong = await http.post(PATH, json={"password": "Wrong-Pass-77"})
            assert wrong.status_code == 401 and "set-cookie" not in wrong.headers
            assert await _guest_state(sessions, mine_guest, mine_play) == mine_before

            # 정상 탈퇴 → 204, 로그인 · 게스트 쿠키 둘 다 만료
            done = await http.post(PATH, json={"password": PASSWORD})
            assert done.status_code == 204, done.text
            assert _expired(done) == {user_session.SESSION_COOKIE, GUEST_COOKIE}

        # 요청 쿠키의 게스트만 폐기 — 만료 시각 · 그 게스트 회차의 소유자는 그대로(지우지도 회원으로 옮기지도 않는다)
        revoked_at, expires_at, owner_user, owner_anonymous = await _guest_state(
            sessions, mine_guest, mine_play
        )
        assert revoked_at is not None
        assert (expires_at, owner_user, owner_anonymous) == (
            mine_before[1],
            None,
            mine_anonymous,
        )
        assert (await world.user(member.id)).deleted_at is not None
        # 다른 게스트 세션은 그대로
        assert await _guest_state(sessions, other_guest, other_play) == other_before
        # 기존 승계 기록 · 게임 집계 보존
        assert await world.count(GuestSessionTransfer) == transfers_before
        assert (
            await world.count(
                GuestSessionTransfer, GuestSessionTransfer.app_user_id == member.id
            )
            == 1
        )
        for flag in ("false", "true"):
            assert await _game(world, flag) == game_before[flag]

        # 옛 게스트 쿠키를 브라우저가 다시 보내도 — 재사용 차단(새 게스트가 발급되고, 옛 회차는 열리지 않는다)
        reissued, fresh_cookie = await _anonymous_session_id(mine_token)
        assert reissued != mine_anonymous and fresh_cookie
        async with _client() as http:
            http.cookies.set(GUEST_COOKIE, mine_token)
            play = await http.get(f"/api/v1/play-sessions/{mine_play}")
            assert play.status_code == 401
            assert play.json() == {"detail": "Play session cookie required."}
        # 다른 게스트는 계속 같은 익명 세션을 쓴다
        assert await _anonymous_session_id(other_token) == (other_anonymous, False)

        # 같은 이메일로 재가입하면서 옛 게스트 쿠키를 보내도 과거 게스트 진행은 승계되지 않는다
        async with _client() as http:
            http.cookies.set(GUEST_COOKIE, mine_token)
            fresh = await http.post(
                "/api/v1/auth/register",
                json={
                    "email": member.email,
                    "password": PASSWORD,
                    "nickname": member.nickname,
                    "consent": {"terms": True, "privacy": True, "age": True},
                },
            )
            assert fresh.status_code == 201, fresh.text
            new_id = fresh.json()["user"]["user_id"]
        assert new_id != member.id
        assert await world.count(PlaySession, PlaySession.owner_user_id == new_id) == 0
        assert (
            await world.count(
                GuestSessionTransfer, GuestSessionTransfer.app_user_id == new_id
            )
            == 0
        )
        assert (await _guest_state(sessions, mine_guest, mine_play))[2:] == (
            None,
            mine_anonymous,
        )
        assert await _guest_state(sessions, other_guest, other_play) == other_before

    mysql_run(scenario)


@pytest.mark.real_play_auth
def test_withdrawal_with_a_bad_guest_cookie_still_succeeds():
    """잘못된 · 만료된 · 이미 폐기된 게스트 쿠키는 탈퇴를 막지 않고, 그 게스트 행도 바꾸지 않는다."""

    async def scenario(sessions):
        world = World(sessions)
        await world.seed()
        expired_token, revoked_token = f"exp-{uuid4().hex}", f"rev-{uuid4().hex}"
        expired_guest, _, expired_play = await _guest_with_play(sessions, expired_token)
        revoked_guest, _, revoked_play = await _guest_with_play(sessions, revoked_token)
        async with sessions() as db:
            await db.execute(
                update(GuestSession)
                .where(GuestSession.id == expired_guest)
                .values(expires_at=utc_now() - HOUR)
            )
            await db.execute(
                update(GuestSession)
                .where(GuestSession.id == revoked_guest)
                .values(revoked_at=utc_now() - HOUR)
            )
            await db.commit()
        expired_before = await _guest_state(sessions, expired_guest, expired_play)
        revoked_before = await _guest_state(sessions, revoked_guest, revoked_play)

        for user, token in (
            (world.member, expired_token),
            (world.other, revoked_token),
            (world.tester, "not-a-real-guest-token"),
        ):
            async with _client() as http:
                await _login(http, user.email)
                http.cookies.set(GUEST_COOKIE, token)
                done = await http.post(PATH, json={"password": PASSWORD})
                assert done.status_code == 204, done.text
                assert _expired(done) == {user_session.SESSION_COOKIE, GUEST_COOKIE}
            assert (await world.user(user.id)).deleted_at is not None
        assert (
            await _guest_state(sessions, expired_guest, expired_play) == expired_before
        )
        assert (
            await _guest_state(sessions, revoked_guest, revoked_play) == revoked_before
        )

    mysql_run(scenario)


# --- 경합 ---


async def _hold_withdrawal(sessions, user_id):
    """탈퇴 트랜잭션처럼 회원 행을 배타 잠금으로 쥐고 deleted_at 을 쓴 채(커밋 전) 돌려준다."""

    holder = sessions()
    await holder.execute(
        select(AppUser.id).where(AppUser.id == user_id).with_for_update()
    )
    await holder.execute(
        update(AppUser).where(AppUser.id == user_id).values(deleted_at=utc_now())
    )
    return holder


def test_races_with_login_saves_inquiries_and_a_second_withdrawal():
    async def scenario(sessions):
        world = World(sessions)
        await world.seed()

        # 1) 비밀번호 확인을 마친 로그인이 탈퇴 커밋을 기다렸다가 → 세션 없이 401
        holder = await _hold_withdrawal(sessions, world.other.id)
        try:
            async with _client() as http:
                waiting = asyncio.create_task(
                    http.post(
                        "/api/v1/auth/login",
                        json={"email": world.other.email, "password": PASSWORD},
                    )
                )
                await asyncio.sleep(0.7)
                assert not waiting.done()
                await holder.commit()
                response = await waiting
        finally:
            await holder.close()
        assert response.status_code == 401 and response.json() == {
            "detail": "Invalid email or password."
        }
        assert "set-cookie" not in response.headers
        assert (
            await world.count(UserSession, UserSession.app_user_id == world.other.id)
            == 0
        )

        # 2) 세션 확인을 마친 저장 · 캐릭터 · 문의가 탈퇴 커밋을 기다렸다가 → 401, 다시 만들지 않는다
        async with sessions() as db:
            await db.execute(
                GamePlaySave.__table__.delete().where(
                    GamePlaySave.app_user_id == world.tester.id
                )
            )
            await db.commit()
        holder = await _hold_withdrawal(sessions, world.tester.id)
        sign_in(world.tester)
        from app.services.user_session import optional_current_user

        app.dependency_overrides[optional_current_user] = lambda: world.tester
        try:
            async with _client() as http:
                tasks = [
                    asyncio.create_task(
                        http.put(
                            "/api/v1/me/game-save",
                            json={
                                "revision": 0,
                                "schema_version": 1,
                                "stage": "naju",
                                "state": {"x": 2},
                            },
                        )
                    ),
                    asyncio.create_task(
                        http.post(
                            "/api/v1/inquiries",
                            json={
                                "category": "account",
                                "title": "경합",
                                "body": "경합 본문",
                                "email": world.tester.email,
                            },
                        )
                    ),
                ]
                await asyncio.sleep(0.7)
                assert not any(task.done() for task in tasks)
                await holder.commit()
                results = [await task for task in tasks]
        finally:
            await holder.close()
            app.dependency_overrides.pop(optional_current_user, None)
            _as_cookie_user()
        assert [r.status_code for r in results] == [401, 401], [r.text for r in results]
        assert (
            await world.count(GamePlaySave, GamePlaySave.app_user_id == world.tester.id)
            == 0
        )
        assert await world.count(Inquiry, Inquiry.title == "경합") == 0

        # 3) 실제 탈퇴와 저장을 동시에 여러 번 — 교착 없이, 끝나면 저장이 남지 않는다
        for index in range(3):
            async with sessions() as db:
                seed = SeedT(db)
                racer = seed.user(f"경합{index}", utc_now() - DAY)
                await seed.save()
            async with sessions() as db:
                db.add(_identity(racer, "local", racer.email, hash_password(PASSWORD)))
                await db.commit()

            async def withdraw():
                async with sessions() as db:
                    await account_withdrawal.withdraw_member(db, racer.id, PASSWORD)

            async def save():
                sign_in(racer)
                async with _client() as http:
                    return await http.put(
                        "/api/v1/me/game-save",
                        json={
                            "revision": 0,
                            "schema_version": 1,
                            "stage": "naju",
                            "state": {"i": index},
                        },
                    )

            _, saved = await asyncio.gather(withdraw(), save())
            _as_cookie_user()
            assert saved.status_code in {200, 401}, saved.text
            assert (
                await world.count(GamePlaySave, GamePlaySave.app_user_id == racer.id)
                == 0
            )
            assert (await world.user(racer.id)).deleted_at is not None

        # 4) 같은 쿠키로 탈퇴 두 번을 동시에 — 하나만 204
        async with _client() as http:
            await _login(http, world.member.email)
            first, second = await asyncio.gather(
                http.post(PATH, json={"password": PASSWORD}),
                http.post(PATH, json={"password": PASSWORD}),
            )
        assert sorted([first.status_code, second.status_code]) == [204, 401]
        assert (
            await world.count(
                AppUser, AppUser.id == world.member.id, AppUser.deleted_at.is_not(None)
            )
            == 1
        )

    mysql_run(scenario)


# --- 월별 회원 통계: 과거 달은 당시 기준, 현재 회원 수에서는 뺀다(미르 11/17) ---


def test_month_end_members_keep_history_and_current_total_drops_withdrawn():
    async def scenario(sessions):
        today = kst_today()
        month_end_cut = kst_day_start_utc(
            today.replace(day=1)
        )  # 지난달 말 = 이번 달 1일 00:00 KST
        created = month_end_cut - 70 * DAY
        async with sessions() as db:
            seed = SeedT(db)
            admin = seed.user("월별운영", created - DAY, role="admin")
            stays = seed.user("계속회원", created)
            left_now = seed.user("이번달탈퇴", created)
            left_before = seed.user("지난달탈퇴", created)
            tester = seed.tester("시험탈퇴", created)
            await seed.save()

        sign_in(admin)

        async def members(include_internal: str = "false") -> dict:
            async with _client() as http:
                response = await http.get(
                    "/api/v1/admin/stats/members",
                    params={"months": 4, "include_internal": include_internal},
                )
            assert response.status_code == 200, response.text
            return response.json()

        async def summary_total() -> int:
            async with _client() as http:
                response = await http.get("/api/v1/admin/stats/summary")
            assert response.status_code == 200, response.text
            return response.json()["members"]["total"]

        before = await members()
        before_internal = await members("true")
        assert before["totals"]["total"] == 3  # 관리자 · 테스트 계정 제외
        assert before["totals"]["total_at_prev_month_end"] == 3
        signups_before = {m["month"]: m["signups"] for m in before["monthly_signups"]}

        # 이번 달 탈퇴 둘(회원 · 테스트 계정), 지난달 말 전에 탈퇴 하나 — 실제 탈퇴가 남기는 deleted_at 값만 바꿔 시점을 만든다
        async with sessions() as db:
            now = utc_now()
            for user, at in (
                (left_now, now),
                (tester, now),
                (left_before, month_end_cut - HOUR),
            ):
                await db.execute(
                    update(AppUser).where(AppUser.id == user.id).values(deleted_at=at)
                )
            await db.commit()

        after = await members()
        after_internal = await members("true")
        # 현재 회원 수: 탈퇴 둘이 빠진다(계속회원만)
        assert after["totals"]["total"] == 1
        assert await summary_total() == 1
        # 지난달 말: 그때 아직 회원이던 이번 달 탈퇴자는 남고, 지난달에 탈퇴한 회원은 빠진다
        assert after["totals"]["total_at_prev_month_end"] == 2
        # 신규 가입 수는 가입 사실 그대로(탈퇴와 무관)
        assert {
            m["month"]: m["signups"] for m in after["monthly_signups"]
        } == signups_before
        assert sum(signups_before.values()) == 3
        # 내부 계정 포함: 테스트 계정도 같은 규칙(이번 달 탈퇴 → 지난달 말에는 있음, 지금은 없음), 관리자는 그대로
        assert before_internal["totals"]["total"] == 5
        assert after_internal["totals"]["total"] == 2  # 관리자 · 계속회원
        assert after_internal["totals"]["total_at_prev_month_end"] == 4
        assert {
            m["month"]: m["signups"] for m in after_internal["monthly_signups"]
        } == {m["month"]: m["signups"] for m in before_internal["monthly_signups"]}
        assert stays.id  # 남은 회원은 그대로

    mysql_run(scenario)


# --- 설문 참가 번호 조회(읽기 전용) ---

COLLIDING = (
    "f110cb7a-82d1-4330-998a-9bda31ee3ccd",
    "18965dcc-d6c6-440c-9a3d-539143b70ca6",
)


def test_withdrawn_survey_codes_lists_only_withdrawn_and_never_writes():
    from app.services.withdrawn_survey import begin_read_only, participant_key
    from scripts import withdrawn_survey_codes as survey_cli

    async def scenario(sessions):
        since = kst_today() - 3 * DAY
        cut = kst_day_start_utc(since)
        async with sessions() as db:
            seed = SeedT(db)
            created = cut - 30 * DAY
            at_edge = seed.user("경계탈퇴", created)
            before_edge = seed.user("하루전탈퇴", created)
            later = seed.user("나중탈퇴", created)
            later.id = COLLIDING[0]
            twin = seed.user("같은번호회원", created)
            twin.id = COLLIDING[1]
            active = seed.user("지금회원", created)
            at_edge.deleted_at = cut  # 그날 00:00 KST 정각 → 포함
            before_edge.deleted_at = cut - timedelta(
                microseconds=1
            )  # 전날 23:59:59.999999 → 제외
            later.deleted_at = cut + 2 * DAY
            for user, code in ((at_edge, "ABCD-EFGH"), (active, "WXYZ-2345")):
                seed.groups[3].append(_coded_event(user, code, cut))
            await seed.save()

        async def fingerprint():
            async with sessions() as db:
                return [
                    tuple(row)
                    for row in (
                        await db.execute(text("CHECKSUM TABLE app_users, beta_events"))
                    ).all()
                ]

        before = await fingerprint()
        rows = await survey_cli.run(sessions, since)
        assert await fingerprint() == before  # 읽기만 했다

        assert [(r.kind, r.code, r.shared_with) for r in rows] == [
            ("account", participant_key(at_edge.id), 0),
            ("code", "ABCD-EFGH", 0),
            (
                "account",
                "B080C459",
                1,
            ),  # 회원 「같은번호회원」과 번호가 같다 — 확인 필요 표시
        ]
        assert [r.withdrawn_at for r in rows] == [cut, cut, cut + 2 * DAY]
        lines = survey_cli.format_rows(since, rows, "test")
        text_out = " | ".join(lines)
        for user in (at_edge, before_edge, later, twin, active):
            assert user.id not in text_out and user.email not in text_out
            assert user.nickname not in text_out
        assert "WXYZ-2345" not in text_out  # 탈퇴하지 않은 회원의 참여 코드는 안 나온다
        assert participant_key(before_edge.id) not in text_out
        assert "다른 계정 1개와 같은 번호 — 확인 필요" in lines[-1]
        # 다음 날부터 보면 경계 탈퇴자는 빠진다(반복 실행은 겹치는 창으로 — 기본 14일)
        later_rows = await survey_cli.run(sessions, since + timedelta(days=1))
        assert [r.code for r in later_rows] == ["B080C459"]

        # 읽기 전용 트랜잭션은 쓰기를 거절한다
        async with sessions() as db:
            await begin_read_only(db)
            with pytest.raises(Exception, match="1792|READ ONLY"):
                await db.execute(
                    update(AppUser).where(AppUser.id == active.id).values(region="x")
                )
            await db.rollback()
        assert await fingerprint() == before

    mysql_run(scenario)


def _coded_event(user: AppUser, code: str, at) -> BetaEvent:
    return BetaEvent(
        event_id=str(uuid4()),
        received_at=at,
        client_ts=at,
        event_type="stage_reached",
        phase="character_open",
        participant_code=code,
        page="naju",
        app_user_id=user.id,
        data={},
    )
