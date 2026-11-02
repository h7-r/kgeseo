"""Opt-in MySQL tests using randomly named, disposable tables.

Run with ONBOARDING_MYSQL_TESTS=1. Existing application tables are never queried.
"""

import asyncio
import os
import re
import sys
from uuid import uuid4

import pytest
from sqlalchemy import (
    Column,
    ForeignKey,
    MetaData,
    Table,
    UniqueConstraint,
    create_engine,
    func,
    select,
)
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import registry

from app.core.config import settings
from app.core.terms import CURRENT_TERMS_VERSION
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.models.social_onboarding_pending import SocialOnboardingPending
from app.schemas.auth import (
    GoogleUserResponse,
    LocalRegisterRequest,
    SocialOnboardingCompleteRequest,
)
from app.services import local_auth, social_onboarding
from app.services.local_auth import register_user
from app.services.social_auth import authenticate_social_user
from app.services.social_onboarding import (
    AccountLinkRequiredError,
    OnboardingError,
    complete_onboarding,
    issue_pending,
)

pytestmark = pytest.mark.skipif(
    os.getenv("ONBOARDING_MYSQL_TESTS") != "1", reason="opt-in disposable MySQL tests"
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module")
def mysql_url():
    prefix = "onboarding_test_" + uuid4().hex[:16]
    metadata = MetaData()
    mapper_registry = registry(metadata=metadata)
    original_models = [AppUser, AuthIdentity, SocialOnboardingPending]
    isolated_models = []
    tables = []
    for original, suffix in zip(
        original_models, ["users", "identities", "pendings"], strict=True
    ):
        columns = []
        for column in original.__table__.columns:
            foreign_keys = [ForeignKey(tables[0].c.id)] if column.foreign_keys else []
            columns.append(
                Column(
                    column.name,
                    column.type,
                    *foreign_keys,
                    primary_key=column.primary_key,
                    nullable=column.nullable,
                    unique=column.unique,
                )
            )
        table = Table(prefix + "_" + suffix, metadata, *columns, mysql_engine="InnoDB")
        for constraint in original.__table__.constraints:
            if isinstance(constraint, UniqueConstraint):
                if (
                    len(constraint.columns) == 1
                    and next(iter(constraint.columns)).unique
                ):
                    continue
                table.append_constraint(
                    UniqueConstraint(
                        *(c.name for c in constraint.columns), name=constraint.name
                    )
                )
        model = type("Isolated" + original.__name__, (), {})
        mapper_registry.map_imperatively(model, table)
        isolated_models.append(model)
        tables.append(table)
    engine = create_engine(
        settings.database_url.set(drivername="mysql+pymysql"), hide_parameters=True
    )
    created = []
    try:
        for table in tables:
            assert re.fullmatch(
                r"onboarding_test_[a-f0-9]{16}_(users|identities|pendings)", table.name
            )
        for table in tables:
            table.create(engine)
            created.append(table)
        with pytest.MonkeyPatch.context() as patch:
            for original, model in zip(original_models, isolated_models, strict=True):
                patch.setattr(sys.modules[__name__], original.__name__, model)
                patch.setattr(social_onboarding, original.__name__, model)
                if hasattr(local_auth, original.__name__):
                    patch.setattr(local_auth, original.__name__, model)
            yield settings.database_url
    finally:
        try:
            for table in reversed(created):
                assert table.name.startswith(prefix + "_") and table.name not in {
                    m.__table__.name for m in original_models
                }
                table.drop(engine)
        finally:
            mapper_registry.dispose()
            engine.dispose()


def request(token, nickname):
    return SocialOnboardingCompleteRequest(
        onboarding_token=token,
        nickname=nickname,
        terms_version=CURRENT_TERMS_VERSION,
        consent={"terms": True, "privacy": True, "age": True},
    )


async def issue(session_factory, subject, email, provider="google"):
    async with session_factory() as db:
        return await issue_pending(db, provider, subject, email, "")


async def finish(session_factory, proof, nickname):
    async with session_factory() as db:
        try:
            return await complete_onboarding(
                db, request(proof.onboarding_token, nickname)
            )
        except (OnboardingError, AccountLinkRequiredError) as error:
            return error


@pytest.mark.anyio
@pytest.mark.parametrize("provider", ["google", "naver"])
async def test_same_token_concurrent_complete(mysql_url, provider):
    engine = create_async_engine(mysql_url, hide_parameters=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    tag = uuid4().hex
    try:
        proof = await issue(sessions, tag, f"{tag}@example.com", provider)
        results = await asyncio.gather(
            finish(sessions, proof, "N" + tag[:10]),
            finish(sessions, proof, "N" + tag[:10]),
        )
        assert (
            sum(
                isinstance(r, OnboardingError) and r.code == "onboarding_token_used"
                for r in results
            )
            == 1
        )
        async with sessions() as db:
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(AuthIdentity)
                    .where(AuthIdentity.provider_subject == tag)
                )
                == 1
            )
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(AppUser)
                    .where(AppUser.email == f"{tag}@example.com")
                )
                == 1
            )
    finally:
        await engine.dispose()


@pytest.mark.anyio
@pytest.mark.parametrize("race", ["identity", "email", "nickname"])
async def test_concurrent_unique_races(mysql_url, monkeypatch, race):
    engine = create_async_engine(mysql_url, hide_parameters=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    tag = uuid4().hex
    email = f"{tag}@example.com"
    try:
        proofs = [await issue(sessions, tag, email)]
        proofs.append(
            await issue(
                sessions,
                tag if race == "identity" else tag + "other",
                email if race != "nickname" else f"other{tag}@example.com",
            )
        )
        barrier = asyncio.Event()
        reached = 0
        original = social_onboarding.get_identity

        async def synchronize(db, provider, subject):
            nonlocal reached
            result = await original(db, provider, subject)
            if result is None and reached < 2:
                reached += 1
                if reached == 2:
                    barrier.set()
                await asyncio.wait_for(barrier.wait(), 5)
            return result

        monkeypatch.setattr(social_onboarding, "get_identity", synchronize)
        nickname = "N" + tag[:10]
        results = await asyncio.gather(
            finish(sessions, proofs[0], nickname),
            finish(
                sessions, proofs[1], nickname if race == "nickname" else "O" + tag[:10]
            ),
        )
        if race == "identity":
            assert all(not isinstance(r, Exception) for r in results)
            assert results[0].user == results[1].user
        elif race == "email":
            assert sum(isinstance(r, AccountLinkRequiredError) for r in results) == 1
        else:
            assert (
                sum(
                    isinstance(r, OnboardingError) and r.code == "nickname_unavailable"
                    for r in results
                )
                == 1
            )
        async with sessions() as db:
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(AppUser)
                    .where(AppUser.email.in_([email, f"other{tag}@example.com"]))
                )
                == 1
            )
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(AuthIdentity)
                    .where(AuthIdentity.provider_subject.in_([tag, tag + "other"]))
                )
                == 1
            )
    finally:
        await engine.dispose()


@pytest.mark.anyio
async def test_failed_request_can_retry_and_local_email_can_win(mysql_url):
    engine = create_async_engine(mysql_url, hide_parameters=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    tag = uuid4().hex
    try:
        proof = await issue(sessions, tag, f"{tag}@example.com")
        async with sessions() as db:
            invalid = request(proof.onboarding_token, "admin")
            from app.services.nickname_policy import InvalidNicknameError

            with pytest.raises(InvalidNicknameError):
                await complete_onboarding(db, invalid)
        assert not isinstance(await finish(sessions, proof, "N" + tag[:10]), Exception)
        other = uuid4().hex
        proof2 = await issue(sessions, other, f"{other}@example.com")
        async with sessions() as db:
            await register_user(
                db,
                LocalRegisterRequest(
                    email=f"{other}@example.com",
                    password="Synthetic123!",
                    nickname="L" + other[:10],
                    consent={"terms": True, "privacy": True, "age": True},
                ),
            )
        assert isinstance(
            await finish(sessions, proof2, "S" + other[:10]), AccountLinkRequiredError
        )
    finally:
        await engine.dispose()


@pytest.mark.anyio
async def test_pending_cleanup_and_legacy_login_preserve_data(mysql_url):
    from datetime import timedelta

    from app.services.local_auth import utc_now

    engine = create_async_engine(mysql_url, hide_parameters=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    tag = uuid4().hex
    try:
        proof = await issue(sessions, tag, f"{tag}@example.com")
        await finish(sessions, proof, "N" + tag[:10])
        async with sessions() as db:
            identity = await db.scalar(
                select(AuthIdentity).where(AuthIdentity.provider_subject == tag)
            )
            user = await db.get(AppUser, identity.app_user_id)
            user.nickname = "Old Nickname"
            user.terms_version = user.terms_accepted_at = user.privacy_accepted_at = (
                user.age_confirmed_at
            ) = None
            old = await db.scalar(
                select(SocialOnboardingPending).where(
                    SocialOnboardingPending.provider_subject == tag
                )
            )
            old.consumed_at = utc_now() - timedelta(days=2)
            await db.commit()
        async with sessions() as db:
            response = await authenticate_social_user(
                db,
                GoogleUserResponse(
                    provider="google", subject=tag, email=f"{tag}@example.com"
                ),
            )
            assert response.user.nickname == "Old Nickname"
            await db.rollback()
        await issue(sessions, tag + "new", f"new{tag}@example.com")
        async with sessions() as db:
            assert (
                await db.scalar(
                    select(SocialOnboardingPending).where(
                        SocialOnboardingPending.provider_subject == tag
                    )
                )
                is None
            )
            user = await db.scalar(
                select(AppUser).where(AppUser.email == f"{tag}@example.com")
            )
            assert user.nickname == "Old Nickname" and user.terms_version is None
    finally:
        await engine.dispose()
