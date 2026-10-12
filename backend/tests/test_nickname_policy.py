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
        "Shitake",
        "administer",
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
        "시발",
        "시발년",
        "개시발",
        "병신",
        "병신새끼",
        "개병신",
        "f_u_c_k_you",
        "sh1thead",
        "보지마",
        "자지않는",
        "shitakefuck",
        "shitake123",
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


@pytest.mark.parametrize(
    "nickname",
    [
        "",
        "f_u_c_k",
        "a",
        "a b",
        "ab\u200b",
        "a" * 33,
        "시발년",
        "개시발",
        "병신새끼",
        "개병신",
        "f_u_c_k_you",
        "sh1thead",
    ],
)
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
@pytest.mark.parametrize("display_name", ["admin", "f_u_c_k", "Name With Space", None])
async def test_invalid_provider_name_has_empty_suggestion(db_session, display_name):
    from app.schemas.auth import GoogleUserResponse
    from app.services.social_auth import authenticate_social_user

    profile = GoogleUserResponse(
        provider="google",
        subject="synthetic-subject",
        email="private@example.com",
        name=display_name,
    )
    response = await authenticate_social_user(db_session, profile)
    assert response.suggested_nickname == ""
    assert len(db_session.added) == 1


@pytest.mark.anyio
async def test_duplicate_provider_name_has_empty_suggestion(db_session):
    from app.schemas.auth import GoogleUserResponse
    from app.services.social_auth import authenticate_social_user

    db_session.scalar_result = [None, None, object()]
    profile = GoogleUserResponse(
        provider="google",
        subject="synthetic-subject",
        email="private@example.com",
        name="Explorer",
    )
    response = await authenticate_social_user(db_session, profile)
    assert response.suggested_nickname == ""
