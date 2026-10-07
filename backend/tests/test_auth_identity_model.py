from datetime import datetime

from sqlalchemy import UniqueConstraint
from sqlalchemy.dialects.mysql import DATETIME

from app.models.auth_identity import AuthIdentity


def test_auth_identity_metadata() -> None:
    table = AuthIdentity.__table__

    assert list(table.columns.keys()) == [
        "id",
        "app_user_id",
        "provider",
        "provider_subject",
        "password_hash",
        "created_at",
        "updated_at",
    ]
    assert table.c.password_hash.nullable is True
    assert all(
        column.nullable is False
        for column in table.columns
        if column.name != "password_hash"
    )
    assert isinstance(table.c.created_at.type, DATETIME)
    assert table.c.created_at.type.fsp == 6
    assert isinstance(table.c.updated_at.type, DATETIME)
    assert table.c.updated_at.type.fsp == 6

    foreign_keys = {
        (foreign_key.parent.name, foreign_key.target_fullname)
        for foreign_key in table.foreign_keys
    }
    assert foreign_keys == {("app_user_id", "app_users.id")}

    unique_constraints = {
        (
            constraint.name,
            tuple(column.name for column in constraint.columns),
        )
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert unique_constraints == {
        (
            "uq_auth_identities_provider_subject",
            ("provider", "provider_subject"),
        ),
    }

    indexes = {
        (
            index.name,
            tuple(column.name for column in index.columns),
            index.unique,
        )
        for index in table.indexes
    }
    assert indexes == {
        (
            "ix_auth_identities_app_user_id",
            ("app_user_id",),
            False,
        ),
    }


def test_local_identity_can_store_password_hash() -> None:
    now = datetime(2026, 10, 6, 12, 0, 0)

    identity = AuthIdentity(
        id="22222222-2222-4222-8222-222222222222",
        app_user_id="11111111-1111-4111-8111-111111111111",
        provider="local",
        provider_subject="sejin@example.com",
        password_hash="pbkdf2_sha256$210000$salt$hash",
        created_at=now,
        updated_at=now,
    )

    assert identity.provider == "local"
    assert identity.provider_subject == "sejin@example.com"
    assert identity.password_hash == "pbkdf2_sha256$210000$salt$hash"


def test_social_identity_can_omit_password_hash() -> None:
    now = datetime(2026, 10, 6, 12, 0, 0)

    identity = AuthIdentity(
        id="33333333-3333-4333-8333-333333333333",
        app_user_id="11111111-1111-4111-8111-111111111111",
        provider="google",
        provider_subject="google-subject",
        password_hash=None,
        created_at=now,
        updated_at=now,
    )

    assert identity.provider == "google"
    assert identity.password_hash is None
