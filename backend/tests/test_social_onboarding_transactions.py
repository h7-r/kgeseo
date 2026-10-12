"""Real SQLAlchemy transactions on SQLite; MySQL locking is tested separately."""

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.terms import CURRENT_TERMS_VERSION
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.models.social_onboarding_pending import SocialOnboardingPending
from app.schemas.auth import SocialOnboardingCompleteRequest
from app.services.nickname_policy import InvalidNicknameError
from app.services.social_onboarding import (
    OnboardingError,
    complete_onboarding,
    issue_pending,
    token_digest,
)


class TransactionSession:
    def __init__(self, session):
        self.session = session

    async def scalar(self, statement):
        return self.session.scalar(statement)

    async def execute(self, statement):
        return self.session.execute(statement)

    async def get(self, model, key):
        return self.session.get(model, key)

    def add(self, entity):
        self.session.add(entity)

    async def commit(self):
        self.session.commit()

    async def rollback(self):
        self.session.rollback()


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_real_transaction_validation_retry_consumption_and_reuse():
    engine = create_engine("sqlite://", hide_parameters=True)
    for table in [
        AppUser.__table__,
        AuthIdentity.__table__,
        SocialOnboardingPending.__table__,
    ]:
        table.create(engine)
    try:
        with Session(engine, expire_on_commit=False) as session:
            db = TransactionSession(session)
            proof = await issue_pending(
                db, "google", "synthetic-subject", "synthetic@example.com", ""
            )
            request = SocialOnboardingCompleteRequest(
                onboarding_token=proof.onboarding_token,
                nickname="admin",
                terms_version=CURRENT_TERMS_VERSION,
                consent={"terms": True, "privacy": True, "age": True},
            )
            with pytest.raises(InvalidNicknameError):
                await complete_onboarding(db, request)
            pending = session.scalar(select(SocialOnboardingPending))
            assert pending.consumed_at is None
            assert session.scalar(select(func.count()).select_from(AppUser)) == 0
            session.rollback()
            request.nickname = "Explorer"
            response = await complete_onboarding(db, request)
            assert response.nickname == "Explorer"
            session.expire_all()
            assert (
                session.scalar(select(SocialOnboardingPending)).consumed_at is not None
            )
            assert session.scalar(select(AuthIdentity)).password_hash is None
            assert session.scalar(select(AppUser)).terms_accepted_at is not None
            session.rollback()
            with pytest.raises(OnboardingError, match="onboarding_token_used"):
                await complete_onboarding(db, request)
            assert session.scalar(select(func.count()).select_from(AppUser)) == 1
    finally:
        engine.dispose()


@pytest.mark.anyio
async def test_lazy_cleanup_preserves_recent_proofs_and_members():
    from datetime import timedelta

    from app.services.local_auth import utc_now

    engine = create_engine("sqlite://", hide_parameters=True)
    for table in [
        AppUser.__table__,
        AuthIdentity.__table__,
        SocialOnboardingPending.__table__,
    ]:
        table.create(engine)
    try:
        with Session(engine, expire_on_commit=False) as session:
            now = utc_now()
            for key, expires, consumed in [
                ("old-expired", now - timedelta(days=2), None),
                ("old-consumed", now + timedelta(minutes=10), now - timedelta(days=2)),
                ("recent-consumed", now + timedelta(minutes=10), now),
            ]:
                session.add(
                    SocialOnboardingPending(
                        id=key,
                        token_hash=token_digest(key),
                        provider="google",
                        provider_subject=key,
                        email="synthetic@example.com",
                        created_at=now - timedelta(days=3),
                        expires_at=expires,
                        consumed_at=consumed,
                    )
                )
            session.commit()
            await issue_pending(
                TransactionSession(session),
                "google",
                "new-proof",
                "synthetic@example.com",
                "",
            )
            assert set(
                session.scalars(select(SocialOnboardingPending.provider_subject))
            ) == {"recent-consumed", "new-proof"}
            assert session.scalar(select(func.count()).select_from(AppUser)) == 0
    finally:
        engine.dispose()
