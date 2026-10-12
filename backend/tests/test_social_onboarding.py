from datetime import timedelta

import pytest
from sqlalchemy import UniqueConstraint
from sqlalchemy.exc import IntegrityError

from app.core.terms import CURRENT_TERMS_VERSION
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.models.social_onboarding_pending import SocialOnboardingPending
from app.services.local_auth import utc_now
from app.services.social_onboarding import token_digest

TOKEN = "A" * 43
COMPLETE_PATH = "/api/v1/auth/social-onboarding/complete"


def pending_record(**changes):
    now = utc_now()
    values = dict(
        id="pending",
        token_hash=token_digest(TOKEN),
        provider="google",
        provider_subject="verified-subject",
        email="synthetic@example.com",
        created_at=now,
        expires_at=now + timedelta(minutes=10),
        consumed_at=None,
    )
    values.update(changes)
    return SocialOnboardingPending(**values)


def payload(**changes):
    values = dict(
        onboarding_token=TOKEN,
        nickname="Explorer",
        terms_version=CURRENT_TERMS_VERSION,
        consent={"terms": True, "privacy": True, "age": True},
    )
    values.update(changes)
    return values


def test_pending_metadata():
    table = SocialOnboardingPending.__table__
    assert list(table.columns.keys()) == [
        "id",
        "token_hash",
        "provider",
        "provider_subject",
        "email",
        "created_at",
        "expires_at",
        "consumed_at",
    ]
    assert {
        tuple(c.name for c in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    } == {("token_hash",)}
    assert table.c.consumed_at.nullable
    assert all(not c.nullable for c in table.columns if c.name != "consumed_at")


@pytest.mark.parametrize("provider", ["google", "naver"])
def test_complete_creates_member_and_consumes_atomically(client, db_session, provider):
    pending = pending_record(provider=provider)
    db_session.scalar_result = [pending, None, None, None]
    response = client.post(COMPLETE_PATH, json=payload(nickname=" ＡＢ１２ "))
    assert response.status_code == 201
    assert response.json() == {
        "provider": provider,
        "email": pending.email,
        "nickname": "AB12",
        "picture": None,
    }
    assert response.headers["cache-control"] == "no-store"
    user, identity = db_session.added
    assert isinstance(user, AppUser) and isinstance(identity, AuthIdentity)
    assert user.terms_version == CURRENT_TERMS_VERSION
    assert (
        user.terms_accepted_at
        == user.privacy_accepted_at
        == user.age_confirmed_at
        == pending.consumed_at
    )
    assert identity.app_user_id == user.id
    assert identity.provider_subject == "verified-subject"
    assert identity.password_hash is None
    assert db_session.commit_count == 1
    for secret in [
        TOKEN,
        pending.token_hash,
        "verified-subject",
        "password_hash",
        "app_user_id",
        user.id,
        identity.id,
    ]:
        assert secret not in response.text
    assert db_session.scalar_calls[0]._for_update_arg is not None


@pytest.mark.parametrize(
    "changes,code,status",
    [
        ({"nickname": "admin"}, "invalid_nickname", 422),
        ({"nickname": "시발년"}, "invalid_nickname", 422),
        ({"nickname": "개시발"}, "invalid_nickname", 422),
        ({"nickname": "병신새끼"}, "invalid_nickname", 422),
        ({"nickname": "개병신"}, "invalid_nickname", 422),
        ({"nickname": "f_u_c_k_you"}, "invalid_nickname", 422),
        ({"nickname": "sh1thead"}, "invalid_nickname", 422),
        ({"consent": {}}, "consent_required", 422),
        (
            {"consent": {"terms": False, "privacy": True, "age": True}},
            "consent_required",
            422,
        ),
        ({"terms_version": "old"}, "terms_version_mismatch", 409),
    ],
)
def test_validation_failures_preserve_proof(client, db_session, changes, code, status):
    pending = pending_record()
    db_session.scalar_result = pending
    response = client.post(COMPLETE_PATH, json=payload(**changes))
    assert response.status_code == status
    assert response.json()["detail"]["code"] == code
    assert pending.consumed_at is None
    assert db_session.added == []
    assert db_session.commit_count == 0
    assert db_session.rollback_count == 1
    db_session.scalar_result = [pending, None, None, None]
    assert client.post(COMPLETE_PATH, json=payload()).status_code == 201


def test_missing_consent_uses_stable_error(client, db_session):
    db_session.scalar_result = pending_record()
    request = payload()
    request.pop("consent")
    response = client.post(COMPLETE_PATH, json=request)
    assert response.json()["detail"]["code"] == "consent_required"


@pytest.mark.parametrize("value", ["true", 1, None])
def test_consent_requires_boolean(client, db_session, value):
    response = client.post(
        COMPLETE_PATH,
        json=payload(consent={"terms": value, "privacy": True, "age": True}),
    )
    assert response.status_code == 422
    assert db_session.added == []


@pytest.mark.parametrize(
    "record,token",
    [
        (None, TOKEN),
        (None, "B" * 43),
        (None, ""),
        (pending_record(expires_at=utc_now() - timedelta(seconds=1)), TOKEN),
    ],
)
def test_invalid_tokens(client, db_session, record, token):
    db_session.scalar_result = record
    response = client.post(COMPLETE_PATH, json=payload(onboarding_token=token))
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "invalid_onboarding_token"
    assert db_session.added == []


def test_missing_token_is_unauthorized(client):
    request = payload()
    request.pop("onboarding_token")
    assert client.post(COMPLETE_PATH, json=request).status_code == 401


def test_used_token_cannot_create_member(client, db_session):
    db_session.scalar_result = pending_record(consumed_at=utc_now())
    response = client.post(COMPLETE_PATH, json=payload())
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "onboarding_token_used"
    assert db_session.added == []


def test_duplicate_nickname_keeps_proof(client, db_session):
    pending = pending_record()
    db_session.scalar_result = [pending, object(), None, None]
    response = client.post(COMPLETE_PATH, json=payload())
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "nickname_unavailable"
    assert pending.consumed_at is None
    assert db_session.added == []


def test_email_conflict_keeps_accounts_separate(client, db_session):
    pending = pending_record()
    db_session.scalar_result = [pending, None, None, object()]
    response = client.post(COMPLETE_PATH, json=payload())
    assert response.json()["detail"]["code"] == "account_link_required"
    assert response.status_code == 409
    assert db_session.added == []
    assert pending.consumed_at is None


def test_existing_identity_consumes_other_proof_without_new_user(client, db_session):
    pending = pending_record()
    identity = AuthIdentity(provider="google", app_user_id="existing")
    db_session.scalar_result = [pending, object(), identity]
    db_session.get_result = AppUser(
        email="existing@example.com", nickname="Old Nickname"
    )
    response = client.post(COMPLETE_PATH, json=payload())
    assert response.status_code == 201
    assert response.json()["nickname"] == "Old Nickname"
    assert pending.consumed_at is not None
    assert db_session.added == []


@pytest.mark.parametrize("collision", ["identity", "email", "nickname", "unknown"])
def test_commit_conflict_is_rechecked_after_rollback(client, db_session, collision):
    first, recovered = pending_record(), pending_record()
    identity = AuthIdentity(provider="google", app_user_id="existing")
    recovery = {
        "identity": [recovered, identity],
        "email": [recovered, None, object()],
        "nickname": [recovered, None, None, object()],
        "unknown": [recovered, None, None, None],
    }[collision]
    db_session.scalar_result = [first, None, None, None, *recovery]
    db_session.get_result = AppUser(email="synthetic@example.com", nickname="Winner")

    async def commit():
        db_session.commit_count += 1
        if db_session.commit_count == 1:
            raise IntegrityError("synthetic insert", {}, Exception("collision"))

    db_session.commit = commit
    if collision == "unknown":
        with pytest.raises(IntegrityError):
            client.post(COMPLETE_PATH, json=payload())
        return
    response = client.post(COMPLETE_PATH, json=payload())
    if collision == "identity":
        assert response.status_code == 201
        assert response.json()["nickname"] == "Winner"
        assert recovered.consumed_at is not None
    else:
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == (
            "account_link_required" if collision == "email" else "nickname_unavailable"
        )
        assert recovered.consumed_at is None
    assert db_session.rollback_count >= 1


@pytest.mark.parametrize(
    "extra", ["email", "provider", "provider_subject", "app_user_id"]
)
def test_complete_rejects_client_identity_fields(client, db_session, extra):
    response = client.post(COMPLETE_PATH, json=payload(**{extra: "untrusted"}))
    assert response.status_code == 422
    assert db_session.added == []


@pytest.mark.parametrize(
    "body,code",
    [
        (payload(email="untrusted@example.com"), "invalid_input"),
        (
            payload(consent={"terms": "true", "privacy": True, "age": True}),
            "invalid_input",
        ),
        (payload(onboarding_token=[TOKEN]), "invalid_input"),
        (payload(onboarding_token={"proof": TOKEN}), "invalid_input"),
        (payload(nickname=["Explorer"]), "invalid_nickname"),
        (payload(nickname=12345, onboarding_token=[TOKEN]), "invalid_nickname"),
    ],
)
def test_complete_validation_error_does_not_echo_input(client, db_session, body, code):
    response = client.post(COMPLETE_PATH, json=body)

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code
    assert set(response.json()["detail"]) == {"code", "message"}
    assert '"input"' not in response.text
    assert TOKEN not in response.text
    assert "untrusted" not in response.text
    assert response.headers["cache-control"] == "no-store"
    assert db_session.added == []
    assert db_session.scalar_calls == []


def test_complete_malformed_json_does_not_echo_proof(client, db_session):
    response = client.post(
        COMPLETE_PATH,
        content=f'{{"onboarding_token": "{TOKEN}", "nickname": '.encode(),
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_input"
    assert TOKEN not in response.text
    assert response.headers["cache-control"] == "no-store"
