from datetime import datetime

from sqlalchemy.exc import IntegrityError

from app.models.app_user import AppUser
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
        password_hash=hash_password(password),
        terms_version="2026-09",
        terms_accepted_at=now,
        privacy_accepted_at=now,
        age_confirmed_at=now,
        created_at=now,
        updated_at=now,
    )


def register_payload(
    *,
    email: str = "Sejin@Example.COM ",
    nickname: str = "세진",
) -> dict:
    return {
        "email": email,
        "password": "RightPassword123!",
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

    user = db_session.added[0]
    assert user.email == "sejin@example.com"
    assert user.password_hash.startswith("pbkdf2_sha256$210000$")
    assert user.password_hash != "RightPassword123!"
    assert user.terms_version == "2026-09"
    assert user.terms_accepted_at is not None
    assert user.privacy_accepted_at is not None
    assert user.age_confirmed_at is not None
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
    assert response.json()["detail"] == "Invalid local account input."
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
    assert response.json()["detail"] == "Invalid local account input."
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
    db_session.scalar_result = make_user()

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
    db_session.scalar_result = make_user()

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "sejin@example.com", "password": "WrongPassword123!"},
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

    response = client.get("/api/v1/auth/email-exists?email=sejin@example.com")

    assert response.status_code == 200
    assert response.json() == {"exists": True}


def test_nickname_exists(client, db_session):
    db_session.scalar_result = None

    response = client.get("/api/v1/auth/nickname-exists?nickname=세진")

    assert response.status_code == 200
    assert response.json() == {"exists": False}
