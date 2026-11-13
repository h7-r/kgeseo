"""격리 MySQL 에서 관리자 API v0.3 3단계(#154)를 본다 — 1:1 문의 흐름 · 설정(점검 모드) · 콘텐츠 읽기 전용.

실행 조건 · 안전 장치는 `test_admin_api_mysql.py` 와 같다(`ADMIN_API_MYSQL_ISOLATED=1` · `ADMIN_API_MYSQL_URL` · `ADMIN_API_MYSQL_DATADIR`).
세진 확인 항목: 접수 번호가 `seq`(AUTO_INCREMENT) 와 같은 트랜잭션에서 저장되고 실패하면 통째로 되돌아가는지, 동시 접수에도 번호가 겹치지 않는지.
"""

import asyncio
import os
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import func, select

from app.main import app
from app.models.inquiry import Inquiry
from app.models.npc_publication import NpcContentVersion, NpcPublicationState
from app.services.inquiry import create_inquiry, inquiry_number, ip_display
from app.services.local_auth import utc_now
from app.services.request_rate_limit import get_request_rate_limiter
from app.services.user_session import optional_current_user
from tests.test_admin_api_mysql import DAY, Seed, client, get_json, mysql_run, sign_in

pytestmark = pytest.mark.skipif(
    os.environ.get("ADMIN_API_MYSQL_ISOLATED") != "1",
    reason="explicit isolated admin API MySQL test database required",
)

ORIGIN = {"Origin": "http://localhost:5173"}


def sign_in_optional(user):
    """공개 접수 끝점은 로그인이 선택이다 — 쿠키 대신 의존성으로 사용자를 꽂는다(None 이면 비회원)."""

    app.dependency_overrides[optional_current_user] = lambda: user


async def post_json(path: str, payload: dict, **headers) -> httpx.Response:
    async with client() as http:
        return await http.post(path, json=payload, headers={**ORIGIN, **headers})


async def patch_json(path: str, payload: dict) -> httpx.Response:
    async with client() as http:
        return await http.patch(path, json=payload, headers=ORIGIN)


async def put_json(path: str, payload: dict) -> httpx.Response:
    async with client() as http:
        return await http.put(path, json=payload, headers=ORIGIN)


def test_inquiry_flow_submit_list_reply_and_my_inquiries():
    async def scenario(sessions):
        try:
            async with sessions() as db:
                seed = Seed(db)
                admin = seed.user("운영자", utc_now() - 30 * DAY, role="admin")
                member = seed.user("문의회원", utc_now() - 10 * DAY)
                await seed.save()

            # ① 비회원 접수 — 번호 · 201. 글자만 저장된다
            sign_in_optional(None)
            first = await post_json(
                "/api/v1/inquiries",
                {
                    "category": "gameplay",
                    "title": "  통발이 안 당겨져요  ",
                    "body": "<b>굵게</b> 3스테이지에서 멈춰요",
                    "email": "guest@example.com",
                },
            )
            assert first.status_code == 201, first.text
            guest_inquiry = first.json()
            assert guest_inquiry["number"].startswith("INQ-")

            # ② 회원 접수 — app_user_id 가 붙어 「내 문의」에 나온다
            sign_in_optional(member)
            second = await post_json(
                "/api/v1/inquiries",
                {
                    "category": "account",
                    "title": "닉네임 바꾸고 싶어요",
                    "body": "방법이 있나요?",
                    "email": member.email,
                },
            )
            assert second.status_code == 201, second.text
            member_inquiry = second.json()
            assert member_inquiry["number"] != guest_inquiry["number"]

            # 검증 실패 — 분류 밖 · 빈 제목 · 이메일 아님 → 422, 저장 안 됨
            bad = await post_json(
                "/api/v1/inquiries",
                {
                    "category": "spam",
                    "title": "   ",
                    "body": "x",
                    "email": "not-an-email",
                },
            )
            assert bad.status_code == 422
            async with sessions() as db:
                stored = (
                    (await db.execute(select(Inquiry).order_by(Inquiry.seq)))
                    .scalars()
                    .all()
                )
                assert [row.title for row in stored] == [
                    "통발이 안 당겨져요",
                    "닉네임 바꾸고 싶어요",
                ]
                assert (
                    stored[0].body == "<b>굵게</b> 3스테이지에서 멈춰요"
                )  # 해석 없이 글자 그대로
                assert (
                    stored[0].app_user_id is None and stored[1].app_user_id == member.id
                )
                assert stored[0].number == inquiry_number(
                    stored[0].seq, stored[0].created_at
                )
                assert stored[0].client_ip is not None

            # ③ 관리자 목록 · 집계 · 가린 이메일
            sign_in(admin)
            listing = await get_json("/api/v1/admin/inquiries")
            assert listing["stats"]["total"] == 2 and listing["stats"]["open"] == 2
            assert (
                listing["stats"]["today"] == 2
                and listing["stats"]["avg_first_reply_hours"] is None
            )
            assert [item["title"] for item in listing["items"]] == [
                "닉네임 바꾸고 싶어요",
                "통발이 안 당겨져요",
            ]
            assert listing["items"][1]["email"] == "gu***@example.com"
            assert (
                listing["items"][0]["nickname"] == "문의회원"
                and listing["items"][1]["nickname"] is None
            )
            only_open = await get_json("/api/v1/admin/inquiries", status="open")
            assert len(only_open["items"]) == 2

            # ④ 상세 — 전체 이메일 · IP 앞 두 자리
            detail = await get_json(f"/api/v1/admin/inquiries/{member_inquiry['id']}")
            assert detail["email"] == member.email
            assert detail["client_ip_display"] is not None and detail[
                "client_ip_display"
            ].endswith("*")
            assert (
                ip_display("203.0.113.7") == "203.0.*.*"
                and ip_display("2001:db8::1") == "2001:db8:*"
            )

            # ⑤ 답변 → answered · answered_at · 내 문의에 보임(관리자 이름 없음)
            replied = await post_json(
                f"/api/v1/admin/inquiries/{member_inquiry['id']}/replies",
                {"body": "마이페이지 〉 계정에서 바꿀 수 있어요."},
            )
            assert replied.status_code == 201, replied.text
            assert (
                replied.json()["status"] == "answered"
                and replied.json()["answered_at"] is not None
            )
            assert replied.json()["replies"][0]["admin_nickname"] == "운영자"
            after = await get_json("/api/v1/admin/inquiries")
            assert (
                after["stats"]["open"] == 1
                and after["stats"]["avg_first_reply_hours"] is not None
            )

            # ⑥ 상태 · 우선순위 — 빈 요청은 422, 종료 뒤 답변은 409
            empty = await patch_json(
                f"/api/v1/admin/inquiries/{guest_inquiry['id']}", {}
            )
            assert empty.status_code == 422
            urgent = await patch_json(
                f"/api/v1/admin/inquiries/{guest_inquiry['id']}",
                {"priority": "urgent", "status": "closed"},
            )
            assert urgent.status_code == 200 and urgent.json()["priority"] == "urgent"
            closed_reply = await post_json(
                f"/api/v1/admin/inquiries/{guest_inquiry['id']}/replies",
                {"body": "늦었어요"},
            )
            assert closed_reply.status_code == 409
            urgent_only = await get_json("/api/v1/admin/inquiries", priority="urgent")
            assert [item["id"] for item in urgent_only["items"]] == [
                guest_inquiry["id"]
            ]

            # ⑦ 내 문의 — 회원 것만, 답변 포함, 비회원 문의는 안 보임
            app.dependency_overrides.pop(optional_current_user, None)
            from app.services.user_session import current_user

            app.dependency_overrides[current_user] = lambda: member
            mine = await get_json("/api/v1/me/inquiries")
            assert [item["number"] for item in mine["items"]] == [
                member_inquiry["number"]
            ]
            assert mine["items"][0]["replies"][0]["body"].startswith("마이페이지")
            assert "admin_nickname" not in mine["items"][0]["replies"][0]

            # ⑧ 대시보드 요약에 미답변 수
            sign_in(admin)
            summary = await get_json("/api/v1/admin/stats/summary")
            assert summary["inquiries"] == {"open": 0}  # 비회원 것은 종료 · 회원 것은 답변됨

            # ⑨ 감사 기록 — 목록 · 상세 · 답변 · 상태 변경이 남는다
            logs = await get_json("/api/v1/admin/audit-logs")
            actions = [row["action"] for row in logs["logs"]]
            for expected in (
                "list_inquiries",
                "read_inquiry",
                "reply_inquiry",
                "update_inquiry",
            ):
                assert expected in actions, actions
        finally:
            app.dependency_overrides.pop(optional_current_user, None)

    mysql_run(scenario)


def test_inquiry_number_is_unique_under_concurrent_submissions_and_rolls_back_on_failure():
    async def scenario(sessions):
        # 동시 접수 20건 — seq 가 DB 에서 매겨져 번호가 겹치지 않는다
        async def submit(index: int) -> str:
            async with sessions() as db:
                row = await create_inquiry(
                    db,
                    category="other",
                    title=f"동시 {index}",
                    body="본문",
                    email=f"c{index}@example.com",
                    app_user_id=None,
                    client_ip="203.0.113.7",
                )
                return row.number or ""

        numbers = await asyncio.gather(*(submit(i) for i in range(20)))
        assert len(set(numbers)) == 20
        async with sessions() as db:
            stored = (
                await db.execute(
                    select(Inquiry.seq, Inquiry.number).order_by(Inquiry.seq)
                )
            ).all()
            assert [number for _, number in stored] == sorted(
                number for _, number in stored
            )
            assert all(number.endswith(f"-{seq:05d}") for seq, number in stored)

        # 실패하면 통째로 되돌아간다 — 번호 자리만 남는 반쪽 행이 없다(제목 길이 초과로 DB 가 거부)
        async with sessions() as db:
            before = await db.scalar(select(func.count()).select_from(Inquiry))
            with pytest.raises(Exception):
                await create_inquiry(
                    db,
                    category="other",
                    title="x" * 500,
                    body="본문",
                    email="fail@example.com",
                    app_user_id=None,
                    client_ip=None,
                )
            await db.rollback()
        async with sessions() as db:
            after = await db.scalar(select(func.count()).select_from(Inquiry))
            assert after == before
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(Inquiry)
                    .where(Inquiry.number.is_(None))
                )
                == 0
            )

    mysql_run(scenario)


def test_inquiry_rate_limit_counts_per_ip():
    async def scenario(sessions):
        limiter = get_request_rate_limiter()
        limiter._hits.clear()  # 앞 검사의 접수가 같은 IP 로 세어졌다
        sign_in_optional(None)
        try:
            codes = []
            for index in range(6):
                response = await post_json(
                    "/api/v1/inquiries",
                    {
                        "category": "tech",
                        "title": f"빈도 {index}",
                        "body": "본문",
                        "email": "r@example.com",
                    },
                )
                codes.append(response.status_code)
            assert codes == [201] * 5 + [429], codes
        finally:
            app.dependency_overrides.pop(optional_current_user, None)
            limiter._hits.clear()

    mysql_run(scenario)


def test_settings_maintenance_toggle_and_public_status():
    async def scenario(sessions):
        async with sessions() as db:
            seed = Seed(db)
            admin = seed.user("운영자", utc_now() - 30 * DAY, role="admin")
            await seed.save()
        sign_in(admin)

        # 기본값 — 꺼짐, 읽기 전용 값은 실제 설정에서
        initial = await get_json("/api/v1/admin/settings")
        assert initial["editable"]["maintenance_mode"] == {
            "on": False,
            "message": "",
            "updated_at": None,
            "updated_by": None,
        }
        assert (
            initial["readonly"]["hint_initial_balance"] >= 0
            and "user_session_days" in initial["readonly"]
        )
        public = await get_json("/api/v1/site/status")
        assert public == {"maintenance": {"on": False, "message": ""}}

        # 켜기 → 공개 상태에 바로 보인다 · 기록 update_setting
        turned_on = await put_json(
            "/api/v1/admin/settings/maintenance_mode",
            {"on": True, "message": "  새벽 점검 (~06:00)  "},
        )
        assert turned_on.status_code == 200, turned_on.text
        assert (
            turned_on.json()["on"] is True
            and turned_on.json()["updated_by"] == "운영자"
        )
        assert (await get_json("/api/v1/site/status")) == {
            "maintenance": {"on": True, "message": "새벽 점검 (~06:00)"}
        }
        too_long = await put_json(
            "/api/v1/admin/settings/maintenance_mode",
            {"on": True, "message": "x" * 201},
        )
        assert too_long.status_code == 422
        turned_off = await put_json(
            "/api/v1/admin/settings/maintenance_mode", {"on": False}
        )
        assert turned_off.status_code == 200 and turned_off.json()["message"] == ""
        logs = await get_json("/api/v1/admin/audit-logs")
        assert [row["action"] for row in logs["logs"]].count("update_setting") == 2

        # 관리자 목록 — 가린 이메일, 기록 list_admins
        admins = await get_json("/api/v1/admin/admins")
        assert [item["nickname"] for item in admins["items"]] == ["운영자"]
        assert (
            admins["items"][0]["email"].endswith("@example.com")
            and "***" in admins["items"][0]["email"]
        )

    mysql_run(scenario)


def test_contents_read_only_lists_registered_versions_without_answers():
    async def scenario(sessions):
        now = utc_now()
        async with sessions() as db:
            seed = Seed(db)
            admin = seed.user("운영자", now - 30 * DAY, role="admin")
            await seed.save()
            db.add(
                NpcContentVersion(
                    case_id="naju-angam-01",
                    content_version=3,
                    content_fingerprint="sha256:" + "a" * 64,
                    registered_at=now - timedelta(days=2),
                )
            )
            await db.flush()
            db.add(
                NpcPublicationState(
                    case_id="naju-angam-01",
                    content_version=3,
                    status="published",
                    revision=1,
                    updated_at=now - DAY,
                )
            )
            await db.commit()
        sign_in(admin)

        listing = await get_json("/api/v1/admin/contents")
        by_id = {case["case_id"]: case for case in listing["cases"]}
        registered = by_id["naju-angam-01"]
        assert registered["source"] == "published" and registered["legacy"] is False
        assert registered["versions"][0]["content_fingerprint"] == "sha256:" + "a" * 64
        assert registered["versions"][0]["publication_status"] == "published"
        # 게시 저장소(메모리)에 그 버전이 없으니 개수는 추측하지 않는다
        assert (
            registered["versions"][0]["counts"] is None and registered["counts"] is None
        )
        # 레거시 사건은 폴더의 client 파일에서 센다
        legacy = by_id["case_001"]
        assert legacy["legacy"] is True and legacy["versions"] == []
        assert legacy["counts"]["zones"] >= 1
        # 응답 어디에도 정답 · 런타임 · 원문 낱말이 없다
        text = str(listing)
        for forbidden in ("answer", "solution", "runtime", "dialogue", "script"):
            assert forbidden not in text.lower(), forbidden

        detail = await get_json("/api/v1/admin/contents/case_001")
        assert detail["zones"] and all(
            set(zone)
            == {"zone_id", "zone_name", "zone_type", "objects", "interactions"}
            for zone in detail["zones"]
        )
        assert detail["events"] == []
        async with client() as http:
            missing = await http.get("/api/v1/admin/contents/no-such-case")
            bad_id = await http.get("/api/v1/admin/contents/..%2Fetc")
        assert missing.status_code == 404 and bad_id.status_code == 404

    mysql_run(scenario)
