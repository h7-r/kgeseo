from datetime import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.services import local_auth
from app.services.local_auth import hash_password


def make_user(
    *,
    email: str = "sejin@example.com",
    nickname: str = "세진",
    password: str = "RightPassword123!",
) -> AppUser:
    now = datetime(2026, 10, 6, 12, 0, 0)
    return AppUser(
        id="11111111-1111-4111-8111-111111111111",
        email=email,
        nickname=nickname,
        region="전남",
        terms_version="2026-09",
        terms_accepted_at=now,
        privacy_accepted_at=now,
        age_confirmed_at=now,
        created_at=now,
        updated_at=now,
    )


def make_local_identity(
    *,
    user: AppUser | None = None,
    email: str = "sejin@example.com",
    password: str = "RightPassword123!",
) -> AuthIdentity:
    now = datetime(2026, 10, 6, 12, 0, 0)
    app_user = user or make_user(email=email, password=password)
    return AuthIdentity(
        id="22222222-2222-4222-8222-222222222222",
        app_user_id=app_user.id,
        provider="local",
        provider_subject=email,
        password_hash=hash_password(password),
        created_at=now,
        updated_at=now,
    )


def register_payload(
    *,
    email: str = "Sejin@Example.COM",
    nickname: str = "세진",
) -> dict:
    return {
        "email": email,
        "password": "RightCombination123!",
        "nickname": nickname,
        "region": "전남",
        "consent": {
            "terms": True,
            "privacy": True,
            "age": True,
            "terms_version": "2026-09",
        },
    }


def test_register_local_account_success(client, db_session):
    response = client.post("/api/v1/auth/register", json=register_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["user"]["email"] == "sejin@example.com"
    assert body["user"]["nickname"] == "세진"
    assert body["user"]["provider"] == "local"
    assert "password" not in response.text
    assert "password_hash" not in response.text

    assert len(db_session.added) == 2
    user = db_session.added[0]
    identity = db_session.added[1]
    assert user.email == "sejin@example.com"
    assert user.terms_version == "2026-09"
    assert user.terms_accepted_at is not None
    assert user.privacy_accepted_at is not None
    assert user.age_confirmed_at is not None
    assert isinstance(identity, AuthIdentity)
    assert identity.app_user_id == user.id
    assert identity.provider == "local"
    assert identity.provider_subject == "sejin@example.com"
    assert identity.password_hash.startswith("pbkdf2_sha256$210000$")
    assert identity.password_hash != "RightPassword123!"
    assert db_session.commit_count == 1
    assert db_session.refresh_count == 1


def test_register_local_account_rejects_duplicate_email(client, db_session):
    db_session.scalar_result = make_user()

    response = client.post("/api/v1/auth/register", json=register_payload())

    assert response.status_code == 409
    assert response.json()["detail"] == "Email already registered."
    assert db_session.added == []


def test_register_local_account_rejects_duplicate_nickname(client, db_session):
    db_session.scalar_result = [None, make_user(email="other@example.com")]

    response = client.post("/api/v1/auth/register", json=register_payload())

    assert response.status_code == 409
    assert response.json()["detail"] == "Nickname already registered."
    assert db_session.added == []


def test_register_local_account_rejects_blank_email_after_normalization(
    client,
    db_session,
):
    response = client.post(
        "/api/v1/auth/register",
        json=register_payload(email="   "),
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_email"
    assert db_session.added == []


def test_register_local_account_rejects_blank_nickname_after_normalization(
    client,
    db_session,
):
    response = client.post(
        "/api/v1/auth/register",
        json=register_payload(nickname="   "),
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_nickname"
    assert db_session.added == []


def test_register_local_account_race_condition_reports_email_duplicate(
    client,
    db_session,
):
    db_session.scalar_result = [None, None, make_user()]
    db_session.commit_error = IntegrityError("insert app_users", {}, Exception())

    response = client.post("/api/v1/auth/register", json=register_payload())

    assert response.status_code == 409
    assert response.json()["detail"] == "Email already registered."
    assert db_session.rollback_count == 1


def test_register_local_account_race_condition_reports_nickname_duplicate(
    client,
    db_session,
):
    db_session.scalar_result = [
        None,
        None,
        None,
        make_user(email="other@example.com"),
    ]
    db_session.commit_error = IntegrityError("insert app_users", {}, Exception())

    response = client.post("/api/v1/auth/register", json=register_payload())

    assert response.status_code == 409
    assert response.json()["detail"] == "Nickname already registered."
    assert db_session.rollback_count == 1


def test_login_local_account_success(client, db_session):
    user = make_user()
    db_session.scalar_result = make_local_identity(user=user)
    db_session.get_result = user

    response = client.post(
        "/api/v1/auth/login",
        json={"email": " SEJIN@example.com ", "password": "RightPassword123!"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["email"] == "sejin@example.com"
    assert body["user"]["provider"] == "local"
    assert "password" not in response.text
    assert "password_hash" not in response.text


def test_login_local_account_rejects_wrong_password(client, db_session):
    db_session.scalar_result = make_local_identity()

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "sejin@example.com", "password": "WrongPassword123!"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password."


def test_login_local_account_rejects_missing_user_for_identity(client, db_session):
    db_session.scalar_result = make_local_identity()
    db_session.get_result = None

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "sejin@example.com", "password": "RightPassword123!"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password."


def test_login_local_account_rejects_missing_email(client, db_session):
    db_session.scalar_result = None

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "missing@example.com", "password": "RightPassword123!"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password."


def test_email_exists(client, db_session):
    db_session.scalar_result = make_user()

    response = client.post(
        "/api/v1/auth/email-exists", json={"email": "sejin@example.com"}
    )

    assert response.status_code == 200
    assert response.json() == {"exists": True}


def test_nickname_exists(client, db_session):
    db_session.scalar_result = None

    response = client.post("/api/v1/auth/nickname-exists", json={"nickname": "세진"})

    assert response.status_code == 200
    assert response.json() == {"exists": False}


@pytest.mark.parametrize(
    "email",
    [
        "abc@example.com",
        "user123@naver.com",
        "grape.test+1@gmail.com",
        "user!tag@example.com",
    ],
)
def test_registration_accepts_ascii_email(client, db_session, email):
    response = client.post("/api/v1/auth/register", json=register_payload(email=email))
    assert response.status_code == 201
    assert db_session.added[0].email == email.lower()


@pytest.mark.parametrize(
    "email",
    [
        "abc",
        "abc@",
        "@naver.com",
        "abc@naver",
        "가나다@naver.com",
        "abc @naver.com",
        "abc@ naver.com",
        " abc@naver.com",
        "abc@naver.com ",
        "abc\u200b@naver.com",
        "abc\n@naver.com",
        "é@example.com",
        ".abc@example.com",
        "abc..def@example.com",
        "abc@-example.com",
        "abc@example..com",
        "a" * 65 + "@example.com",
        "",
        "a" * 255,
        "abc@example.com\n",
        None,
        123,
    ],
)
def test_registration_rejects_invalid_email_without_echo(client, db_session, email):
    response = client.post("/api/v1/auth/register", json=register_payload(email=email))
    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "invalid_email",
        "message": "올바른 이메일 형식이 아닙니다.",
    }
    assert response.headers["cache-control"] == "no-store"
    assert "RightPassword123!" not in response.text
    assert db_session.added == [] and db_session.scalar_calls == []


@pytest.mark.parametrize("password", ["SafeMix2026", "Pass2026!", "Aa1!" * 32])
def test_registration_accepts_password_policy(client, db_session, password):
    request = register_payload()
    request["password"] = password
    response = client.post("/api/v1/auth/register", json=request)
    assert response.status_code == 201
    from app.services.local_auth import verify_password

    assert verify_password(password, db_session.added[1].password_hash)
    assert password not in response.text


@pytest.mark.parametrize(
    "password",
    [
        "abc123",
        "qwer1234!",
        "Qwer1234!",
        "Abc1112!",
        "ABCD1234!",
        "abcdefg",
        "abcdefgh",
        "12345678",
        "한글비번123",
        "abcd 1234",
        "abcd1234\n",
        "abcd\t1234",
        "abcd1234\u200b",
        "abcd1234é",
        "abcd1234😀",
        "",
        "A1" + "x" * 127,
        None,
        123,
        {"secret": "Synthetic123!"},
    ],
)
def test_registration_rejects_password_without_echo(client, db_session, password):
    request = register_payload()
    request["password"] = password
    response = client.post("/api/v1/auth/register", json=request)
    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "invalid_password",
        "message": "비밀번호 형식을 확인해 주세요.",
    }
    assert response.headers["cache-control"] == "no-store"
    assert db_session.added == [] and db_session.scalar_calls == []


@pytest.mark.parametrize("password", ["legacy", "qwer1234!", "a" * 65, "a" * 128])
def test_existing_login_does_not_apply_new_registration_policy(
    client, db_session, password
):
    user = make_user()
    db_session.scalar_result = make_local_identity(user=user, password=password)
    db_session.get_result = user
    response = client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": password}
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "field,code", [("email", "invalid_email"), ("password", "invalid_password")]
)
def test_registration_missing_fields_have_stable_codes(client, field, code):
    request = register_payload()
    del request[field]
    response = client.post("/api/v1/auth/register", json=request)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code
    assert "RightPassword123!" not in response.text


def test_other_registration_validation_does_not_echo_password(client):
    request = register_payload()
    request["consent"] = "invalid"
    response = client.post("/api/v1/auth/register", json=request)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_input"
    assert "RightPassword123!" not in response.text


@pytest.mark.parametrize(
    "email,nickname,password",
    [
        ("explorer@example.com", "Traveler", "SafeExplorer2026!"),
        ("abc@example.com", "Traveler", "SafeTraveler2026!"),
        ("abc@example.com", "Ｔｒａｖｅｌｅｒ", "SafeTraveler2026!"),
    ],
)
def test_registration_rejects_password_containing_account_information(
    client, db_session, email, nickname, password
):
    request = register_payload(email=email, nickname=nickname)
    request["password"] = password
    response = client.post("/api/v1/auth/register", json=request)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_password"
    assert password not in response.text
    assert db_session.added == []


def spy_verify_password(monkeypatch) -> list[str]:
    calls: list[str] = []
    original = local_auth.verify_password

    def spy(password: str, stored_hash: str) -> bool:
        calls.append(stored_hash)
        return original(password, stored_hash)

    monkeypatch.setattr(local_auth, "verify_password", spy)
    return calls


def null_password_identity() -> AuthIdentity:
    identity = make_local_identity()
    identity.password_hash = None
    return identity


@pytest.mark.parametrize("identity_factory", [lambda: None, null_password_identity])
def test_login_without_local_password_verifies_dummy_hash(
    client, db_session, monkeypatch, identity_factory
):
    calls = spy_verify_password(monkeypatch)
    monkeypatch.setattr(local_auth, "hash_password", pytest.fail)
    db_session.scalar_result = identity_factory()

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "sejin@example.com", "password": "DummyLogin2026x"},
    )

    assert calls == [local_auth.DUMMY_PASSWORD_HASH]
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password."}
    assert response.headers["cache-control"] == "no-store"
    assert db_session.get_calls == []


def test_login_wrong_password_verifies_stored_hash_once(
    client, db_session, monkeypatch
):
    calls = spy_verify_password(monkeypatch)
    identity = make_local_identity()
    db_session.scalar_result = identity

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "sejin@example.com", "password": "WrongPassword123!"},
    )

    assert calls == [identity.password_hash]
    assert response.status_code == 401


def test_login_failures_are_indistinguishable(client, db_session):
    responses = []
    for identity in (make_local_identity(), None, null_password_identity()):
        db_session.scalar_result = identity
        responses.append(
            client.post(
                "/api/v1/auth/login",
                json={"email": "sejin@example.com", "password": "WrongPassword123!"},
            )
        )

    assert {response.status_code for response in responses} == {401}
    assert len({response.text for response in responses}) == 1
    headers = [
        {k: v for k, v in response.headers.items() if k != "date"}
        for response in responses
    ]
    assert headers[0] == headers[1] == headers[2]


def test_login_success_is_not_cached(client, db_session):
    user = make_user()
    db_session.scalar_result = make_local_identity(user=user)
    db_session.get_result = user

    response = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": "RightPassword123!"},
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "payload,code",
    [
        (
            {"email": "sejin@example.com", "password": "DummySecret" + "x" * 130},
            "invalid_password",
        ),
        ({"email": "sejin@example.com", "password": ""}, "invalid_password"),
        ({"email": "sejin@example.com", "password": 20261012}, "invalid_password"),
        ({"email": "", "password": "DummySecret2026x"}, "invalid_email"),
        ({"password": "DummySecret2026x"}, "invalid_email"),
        ({"email": "sejin@example.com"}, "invalid_password"),
    ],
)
def test_login_validation_error_does_not_echo_input(client, db_session, payload, code):
    response = client.post("/api/v1/auth/login", json=payload)

    assert response.status_code == 422
    assert response.json() == {
        "detail": {"code": code, "message": response.json()["detail"]["message"]}
    }
    assert "input" not in response.text
    assert "DummySecret" not in response.text
    assert "20261012" not in response.text
    assert response.headers["cache-control"] == "no-store"
    assert db_session.scalar_calls == []


def test_other_routes_keep_default_validation_error(client):
    response = client.post("/api/v1/auth/email-exists", json={"email": ""})

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
