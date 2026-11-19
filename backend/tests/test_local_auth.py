from datetime import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.account_data import LoginThrottle
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.services import local_auth
from app.services.local_auth import hash_password

# 409 중복은 code 로 가르고 message 는 옛 화면이 비교하던 문장 그대로다(11/18)
EMAIL_TAKEN = {"code": "email_taken", "message": "Email already registered."}
NICKNAME_TAKEN = {"code": "nickname_taken", "message": "Nickname already registered."}


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

    # 계정 · 인증 수단 · 로그인 세션
    assert len(db_session.added) == 3
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
    # 계정 저장 한 번 · 로그인 세션 저장 한 번
    assert db_session.commit_count == 2
    assert db_session.refresh_count == 1


def test_register_local_account_rejects_duplicate_email(client, db_session):
    db_session.scalar_result = make_user()

    response = client.post("/api/v1/auth/register", json=register_payload())

    assert response.status_code == 409
    assert response.json()["detail"] == EMAIL_TAKEN
    assert response.headers["cache-control"] == "no-store"
    assert db_session.added == []


def test_register_local_account_rejects_duplicate_nickname(client, db_session):
    db_session.scalar_result = [None, make_user(email="other@example.com")]

    response = client.post("/api/v1/auth/register", json=register_payload())

    assert response.status_code == 409
    assert response.json()["detail"] == NICKNAME_TAKEN
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
    assert response.json()["detail"] == EMAIL_TAKEN
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
    assert response.json()["detail"] == NICKNAME_TAKEN
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
    # 시도 제한 말고 다른 조회는 하지 않는다.
    assert {model for model, _ in db_session.get_calls} == {LoginThrottle}


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


@pytest.mark.parametrize(
    "path,payload,code",
    [
        ("email-exists", {"email": ""}, "invalid_email"),
        ("email-exists", {"email": 12345}, "invalid_email"),
        ("email-exists", {}, "invalid_email"),
        ("email-exists", {"email": "a" * 255}, "invalid_email"),
        ("nickname-exists", {}, "invalid_nickname"),
        ("nickname-exists", {"nickname": ["세진"]}, "invalid_nickname"),
        ("nickname-exists", {"nickname": "세진", "extra": "x"}, None),
    ],
)
def test_exists_validation_error_does_not_echo_input(
    client, db_session, path, payload, code
):
    """중복 확인 둘의 형식 오류도 register · login 과 같은 {code, message} 다(11/18) — 입력값을 되돌리지 않는다."""
    response = client.post(f"/api/v1/auth/{path}", json=payload)

    if code is None:
        # 모르는 키는 그냥 무시된다(기존 그대로)
        assert response.status_code == 200
        return
    assert response.status_code == 422
    assert set(response.json()["detail"]) == {"code", "message"}
    assert response.json()["detail"]["code"] == code
    assert "input" not in response.text
    assert "12345" not in response.text and "a" * 255 not in response.text
    assert response.headers["cache-control"] == "no-store"
    assert db_session.scalar_calls == []


def test_other_routes_keep_default_validation_error(client):
    response = client.post(
        "/api/v1/inquiries", json={"category": "bug", "title": "", "body": ""}
    )

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


# --- 가입 검증(11/18): 동의 엄격 bool · 약관 판 · 지역 ---


@pytest.mark.parametrize("value", ["true", "yes", "on", 1, None])
def test_registration_consent_requires_boolean(client, db_session, value):
    request = register_payload()
    request["consent"]["terms"] = value
    response = client.post("/api/v1/auth/register", json=request)

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_input"
    assert "RightCombination123!" not in response.text
    assert db_session.added == []


def test_registration_consent_rejects_unknown_keys(client, db_session):
    request = register_payload()
    request["consent"]["marketing"] = True
    response = client.post("/api/v1/auth/register", json=request)

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_input"
    assert db_session.added == []


@pytest.mark.parametrize("version", ["1999-01", "2026-10", "old"])
def test_registration_rejects_other_terms_version(client, db_session, version):
    request = register_payload()
    request["consent"]["terms_version"] = version
    response = client.post("/api/v1/auth/register", json=request)

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "terms_version_mismatch"
    assert response.headers["cache-control"] == "no-store"
    assert db_session.added == [] and db_session.scalar_calls == []


def test_registration_without_terms_version_stores_current_version(client, db_session):
    request = register_payload()
    del request["consent"]["terms_version"]
    response = client.post("/api/v1/auth/register", json=request)

    assert response.status_code == 201
    assert db_session.added[0].terms_version == "2026-09"


@pytest.mark.parametrize("region", ["화성시", "전라남도", "Seoul", "서울특별시"])
def test_registration_rejects_region_outside_list(client, db_session, region):
    request = register_payload()
    request["region"] = region
    response = client.post("/api/v1/auth/register", json=request)

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "invalid_region",
        "message": "목록에 있는 지역을 골라 주세요.",
    }
    assert response.headers["cache-control"] == "no-store"
    assert region not in response.text
    assert db_session.added == [] and db_session.scalar_calls == []


@pytest.mark.parametrize("region", [None, "", "   "])
def test_registration_blank_region_is_stored_as_none(client, db_session, region):
    request = register_payload()
    request["region"] = region
    response = client.post("/api/v1/auth/register", json=request)

    assert response.status_code == 201
    assert db_session.added[0].region is None
    assert response.json()["user"]["region"] is None


def test_registration_region_list_matches_shared_json():
    from app.services.registration_input_policy import REGIONS, REGIONS_PATH

    assert REGIONS_PATH.exists(), "shared/regions.json 이 있어야 화면과 같은 목록이다"
    assert len(REGIONS) == 17
    assert {"서울", "세종", "전남", "제주"} <= REGIONS
