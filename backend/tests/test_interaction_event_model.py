from sqlalchemy import UniqueConstraint
from sqlalchemy.dialects.mysql import DATETIME, JSON

from app.models.interaction_event import InteractionEvent


def test_interaction_event_metadata() -> None:
    table = InteractionEvent.__table__

    assert list(table.columns.keys()) == [
        "id",
        "play_session_id",
        "client_event_id",
        "client_timestamp",
        "interaction_type",
        "target_id",
        "payload_json",
        "result_type",
        "response_json",
        "created_at",
    ]
    assert table.c.target_id.nullable is True
    assert table.c.client_timestamp.nullable is True
    assert all(
        column.nullable is False
        for column in table.columns
        if column.name not in {"target_id", "client_timestamp"}
    )
    assert isinstance(table.c.payload_json.type, JSON)
    assert isinstance(table.c.response_json.type, JSON)
    assert isinstance(table.c.created_at.type, DATETIME)
    assert table.c.created_at.type.fsp == 6
    assert isinstance(table.c.client_timestamp.type, DATETIME)
    assert table.c.client_timestamp.type.fsp == 6

    foreign_keys = {
        (foreign_key.parent.name, foreign_key.target_fullname)
        for foreign_key in table.foreign_keys
    }
    assert foreign_keys == {("play_session_id", "play_sessions.id")}

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
            "uq_interaction_events_play_session_client_event",
            ("play_session_id", "client_event_id"),
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
            "ix_interaction_events_play_session_id",
            ("play_session_id",),
            False,
        ),
    }
