"""격리 MySQL 에서 게임 저장 계정 확인(11/20 세진, `account_id`)을 본다.

실행 조건 · 안전 장치는 `test_admin_api_mysql.py` 와 같다(`ADMIN_API_MYSQL_ISOLATED=1` · `ADMIN_API_MYSQL_URL` · `ADMIN_API_MYSQL_DATADIR`,
`test_admin_api_` 접두사의 빈 schema, 3306 이 아닌 포트, 접속 뒤 `@@datadir` 대조, 끝나면 표를 지운다).

쿠키 = B 인데 게임이 A 로 불러온 경우(다른 탭에서 계정이 바뀜): revision 이 둘 다 0 이어도 · 같은 양수여도 B 저장은 그대로.
같은 계정 저장 · revision 충돌(save_conflict)은 지금처럼. `account_id` 를 보내지 않는 옛 클라이언트는 지금처럼 쓴다(남은 위험 기록).
"""

import os

import httpx
import pytest
from sqlalchemy import select

from app.core.config import settings
from app.main import app
from app.models.account_data import GamePlaySave
from app.services.local_auth import utc_now
from tests.test_admin_api_mysql import DAY, Seed, mysql_run, sign_in

pytestmark = pytest.mark.skipif(
    os.environ.get("ADMIN_API_MYSQL_ISOLATED") != "1",
    reason="explicit isolated admin API MySQL test database required",
)

URL = "/api/v1/me/game-save"


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers={"Origin": settings.cors_origins[0]},
    )


def _body(revision: int, value: str, account_id: str | None = None) -> dict:
    body = {
        "revision": revision,
        "schema_version": 1,
        "stage": "naju",
        "state": {"sections": {"naju.jars": value}},
    }
    if account_id is not None:
        body["account_id"] = account_id
    return body


def test_switched_account_never_writes_into_the_other_account():
    async def scenario(sessions):
        async with sessions() as db:
            seed = Seed(db)
            a = seed.user("저장A", utc_now() - DAY)
            b = seed.user("저장B", utc_now() - DAY)
            fresh_a = seed.user("새A", utc_now() - DAY)
            fresh_b = seed.user("새B", utc_now() - DAY)
            await seed.save()

        async def saved(user):
            async with sessions() as db:
                row = await db.scalar(
                    select(GamePlaySave).where(GamePlaySave.app_user_id == user.id)
                )
                return None if row is None else (row.revision, row.state_json)

        async def put(as_user, body):
            sign_in(as_user)  # 쿠키 = as_user
            async with _client() as http:
                return await http.put(URL, json=body)

        # 1) 둘 다 저장 없음(revision 0): 쿠키 B · 게임은 A 로 불러옴 → 409, B 에 저장이 생기지 않는다
        response = await put(fresh_b, _body(0, "A-progress", fresh_a.id))
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "account_changed"
        assert await saved(fresh_b) is None and await saved(fresh_a) is None

        # 2) 둘 다 같은 양수 revision(3): B 저장 그대로
        for user, value in ((a, "A-own"), (b, "B-own")):
            for revision in range(3):
                assert (
                    await put(user, _body(revision, value, user.id))
                ).status_code == 200
        assert await saved(b) == (3, {"sections": {"naju.jars": "B-own"}})
        response = await put(b, _body(3, "A-progress", a.id))
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "account_changed"
        assert await saved(b) == (3, {"sections": {"naju.jars": "B-own"}})
        assert await saved(a) == (3, {"sections": {"naju.jars": "A-own"}})

        # 3) 같은 계정의 정상 저장
        response = await put(b, _body(3, "B-more", b.id))
        assert response.status_code == 200 and response.json()["revision"] == 4
        assert await saved(b) == (4, {"sections": {"naju.jars": "B-more"}})

        # 4) 같은 계정의 revision 충돌은 지금처럼 save_conflict + 최신 번호, 값 그대로
        response = await put(b, _body(2, "stale", b.id))
        assert response.status_code == 409
        assert response.json()["detail"] == {"code": "save_conflict", "revision": 4}
        assert await saved(b) == (4, {"sections": {"naju.jars": "B-more"}})

        # 5) account_id 를 보내지 않는 옛 클라이언트는 지금처럼 쓴다 — 번호가 맞으면 쿠키 회원(B) 저장에 들어간다.
        #    (FE 가 account_id 를 보내기 전까지 남는 위험 — 이 PR 만으로는 막히지 않는다)
        response = await put(b, _body(4, "legacy-client", None))
        assert response.status_code == 200
        assert await saved(b) == (5, {"sections": {"naju.jars": "legacy-client"}})

    mysql_run(scenario)
