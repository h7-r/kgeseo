import pytest

from app.db.session import engine
from app.services.nickname_policy import InvalidNicknameError, validate_nickname


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.parametrize(
    "value",
    [
        "가나",
        "Ab123_가",
        "abcdefghijkl",
        "shitake",
        "classic",
        "보지마",
        "자지않는",
        "TestUser",
    ],
)
def test_valid_nickname(value):
    assert validate_nickname(value) == value


@pytest.mark.parametrize(
    "value",
    [
        "a",
        "abcdefghijklm",
        "a b",
        "ab!",
        "ㄱㄴ",
        "ab\u200b",
        "ab\n",
        "씨발",
        "f_u_c_k",
        "sh1t",
        "admin",
        "ADMIN_123",
    ],
)
def test_invalid_nickname(value):
    with pytest.raises(InvalidNicknameError):
        validate_nickname(value)


def test_nfkc_and_trim():
    assert validate_nickname(" ＡＢ１２ ") == "AB12"


def test_database_parameters_hidden():
    assert engine.sync_engine.hide_parameters is True


def test_sql_error_hides_bound_parameters():
    from sqlalchemy.exc import StatementError

    synthetic_value = "synthetic-sensitive-parameter"
    error = StatementError(
        "synthetic error",
        "SELECT :value",
        {"value": synthetic_value},
        Exception("synthetic"),
        hide_parameters=engine.sync_engine.hide_parameters,
    )
    assert synthetic_value not in str(error)


def test_invalid_availability(client):
    response = client.post("/api/v1/auth/nickname-exists", json={"nickname": "f_u_c_k"})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_nickname"
    assert response.headers["cache-control"] == "no-store"


def test_get_availability_removed(client):
    assert client.get("/api/v1/auth/email-exists").status_code == 405
    assert client.get("/api/v1/auth/nickname-exists").status_code == 405


@pytest.mark.parametrize("nickname", ["", "f_u_c_k", "a", "a b", "ab\u200b", "a" * 33])
def test_register_cannot_bypass_policy(client, db_session, nickname):
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "synthetic@example.com",
            "password": "Synthetic123!",
            "nickname": nickname,
            "consent": {"terms": True, "privacy": True, "age": True},
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_nickname"
    assert db_session.added == []


def test_availability_no_store(client):
    for path, payload in [
        ("email-exists", {"email": "synthetic@example.com"}),
        ("nickname-exists", {"nickname": "Explorer"}),
    ]:
        response = client.post(f"/api/v1/auth/{path}", json=payload)
        assert response.status_code == 200
        assert response.json() == {"exists": False}
        assert response.headers["cache-control"] == "no-store"


@pytest.mark.anyio
async def test_social_nickname_collision(db_session):
    from app.services.social_auth import make_unique_nickname

    db_session.scalar_result = [object(), None]
    nickname = await make_unique_nickname(db_session, "Explorer", "private@example.com")
    assert nickname.startswith("Explore_")
    assert len(nickname) == 12
    assert validate_nickname(nickname) == nickname


@pytest.mark.anyio
@pytest.mark.parametrize("display_name", ["admin", "f_u_c_k", "Name With Space", None])
async def test_social_fallback_never_uses_email(db_session, display_name):
    from app.services.social_auth import make_unique_nickname

    nickname = await make_unique_nickname(
        db_session, display_name, "private@example.com"
    )
    assert nickname.startswith("user_")
    assert len(nickname) == 9
    assert validate_nickname(nickname) == nickname


@pytest.mark.anyio
async def test_social_valid_provider_name(db_session):
    from app.services.social_auth import make_unique_nickname

    assert (
        await make_unique_nickname(db_session, "Explorer", "private@example.com")
        == "Explorer"
    )


@pytest.mark.anyio
@pytest.mark.parametrize("provider", ["google", "naver"])
async def test_social_commit_nickname_race(db_session, provider):
    from sqlalchemy.exc import IntegrityError

    from app.schemas.auth import GoogleUserResponse
    from app.services.social_auth import authenticate_social_user

    db_session.scalar_result = [
        None,
        None,
        None,
        None,
        None,
        object(),
        None,
        None,
        object(),
        None,
    ]

    async def commit():
        db_session.commit_count += 1
        if db_session.commit_count == 1:
            raise IntegrityError("synthetic", {}, Exception("collision"))

    db_session.commit = commit
    profile = GoogleUserResponse(
        provider=provider,
        subject="synthetic-subject",
        email="private@example.com",
        name="Explorer",
    )
    assert await authenticate_social_user(db_session, profile) == profile
    assert db_session.commit_count == 2
    assert db_session.rollback_count == 1
    assert db_session.added[2].nickname != db_session.added[0].nickname


@pytest.mark.anyio
async def test_social_commit_nickname_race_is_bounded(db_session):
    from sqlalchemy.exc import IntegrityError

    from app.schemas.auth import GoogleUserResponse
    from app.services.social_auth import (
        MAX_NICKNAME_ATTEMPTS,
        SocialAuthConflictError,
        authenticate_social_user,
    )

    db_session.scalar_result = [
        None,
        None,
        None,
        None,
        None,
        object(),
    ] * MAX_NICKNAME_ATTEMPTS
    db_session.commit_error = IntegrityError("synthetic", {}, Exception("collision"))
    profile = GoogleUserResponse(
        provider="google",
        subject="synthetic-subject",
        email="private@example.com",
        name="Explorer",
    )
    with pytest.raises(SocialAuthConflictError):
        await authenticate_social_user(db_session, profile)
    assert db_session.commit_count == MAX_NICKNAME_ATTEMPTS
    assert db_session.rollback_count == MAX_NICKNAME_ATTEMPTS
