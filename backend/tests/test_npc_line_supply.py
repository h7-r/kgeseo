"""승인 대사 · 정책 규칙 공급 (PM v0.4.3) — 승인 이력 없이는 아무것도 승인되지 않는다."""

import uuid
from typing import Any

import pytest

from app.schemas.npc_content import GeneralLinePack, NpcContentPack
from app.services.approval_history import ApprovalLog, ReviewRecord
from app.services.npc_dialogue import PM_GENERIC_PUZZLE_LINES
from app.services.npc_line_supply import (
    fallback_line_provider,
    general_pack_approved,
    general_pack_fingerprint,
    general_pack_line_provider,
    generic_line_approval,
    policy_rules_from_pack,
)
from tests.test_pinned_content import CASE_ID, make_bundle, make_npc

# 가상 테스트 데이터. 실제 PM 콘텐츠 · 실제 승인 기록이 아니다.
FP = "sha256:" + "c" * 64


def review(fp: str, gate: str, decision: str = "approved", **kw: Any) -> ReviewRecord:
    if decision != "approved":
        kw.setdefault("reason", "(가상) 사유")
    return ReviewRecord(
        review_id=str(uuid.uuid4()),
        gate=gate,
        target_hash=fp,
        decision=decision,
        reviewer="reviewer-test",
        reviewed_at=kw.pop("at", "2026-10-29T00:00:00.000Z"),
        **kw,
    )


def approved_log(key: tuple[str, int], fp: str) -> ApprovalLog:
    log = ApprovalLog()
    for gate in ("G1", "G2", "G3"):
        log.append(*key, review(fp, gate))
    return log


def v043_npc(**extra: Any) -> NpcContentPack:
    raw = make_npc(1, FP).model_dump(mode="json", exclude_none=True)
    raw.update(extra)
    return NpcContentPack.model_validate(raw)


def bundle(**npc_extra: Any):
    return make_bundle(1, FP, npc=v043_npc(**npc_extra))


# --- 고정 콘텐츠 nudge ---


def test_lines_are_unapproved_without_approval_source() -> None:
    line = bundle().line_source()(CASE_ID, "NPC_COMPANION", "NUDGE_GENERAL")

    assert line is not None and line.approved is False


def test_lines_are_approved_only_by_matching_approval_history() -> None:
    target = bundle()
    log = approved_log((CASE_ID, 1), FP)

    line = target.line_source(log.source())(CASE_ID, "NPC_COMPANION", "NUDGE_PUZZLE_A")

    assert line is not None and line.approved is True
    assert line.puzzle_id == "PUZZLE_A"
    assert line.reveal_when == {"always": True}


@pytest.mark.parametrize(
    "records",
    [
        [],  # 기록 없음
        ["G1", "G2"],  # G3 없음
        ["G1", "G2", "G3:other"],  # 다른 해시
    ],
)
def test_incomplete_approval_keeps_lines_unapproved(records: list[str]) -> None:
    log = ApprovalLog()
    for item in records:
        gate, _, other = item.partition(":")
        log.append(CASE_ID, 1, review("sha256:" + "d" * 64 if other else FP, gate))

    line = bundle().line_source(log.source())(CASE_ID, "NPC_COMPANION", "NUDGE_GENERAL")

    assert line is not None and line.approved is False


def test_later_rejection_blocks_lines_immediately() -> None:
    log = approved_log((CASE_ID, 1), FP)
    source = bundle().line_source(log.source())
    assert source(CASE_ID, "NPC_COMPANION", "NUDGE_GENERAL").approved is True

    g3 = next(r for r in log.records(CASE_ID, 1) if r.gate == "G3")
    log.append(
        CASE_ID,
        1,
        review(
            FP,
            "G3",
            "rejected",
            at="2026-10-29T01:00:00.000Z",
            supersedes=g3.review_id,
        ),
    )

    assert source(CASE_ID, "NPC_COMPANION", "NUDGE_GENERAL").approved is False


def test_content_approvals_field_is_not_trusted() -> None:
    claimed = [
        {
            "gate": g,
            "decision": "approved",
            "target_hash": FP,
            "at": "2026-10-29T00:00:00Z",
        }
        for g in ("G1", "G2", "G3")
    ]
    target = bundle(approvals=claimed)

    assert (
        target.line_source()(CASE_ID, "NPC_COMPANION", "NUDGE_GENERAL").approved
        is False
    )
    assert target.is_approved(None) is False


@pytest.mark.anyio
@pytest.mark.parametrize("approved", [True, False])
async def test_pinned_approval_reaches_npc_nudge_service(approved: bool) -> None:
    from datetime import datetime

    from app.models.play_session import PlaySession
    from app.schemas.npc import NpcNudgeRequest
    from app.services.hint import server_hint_text
    from app.services.npc import NpcLineNotFoundError, process_npc_request
    from tests.conftest import FakeAsyncSession

    target = bundle()
    log = approved_log((CASE_ID, 1), FP) if approved else ApprovalLog()
    db = FakeAsyncSession()
    db.get_result = PlaySession(
        id="play-session-id",
        anonymous_session_id="anonymous-session-id",
        case_id=CASE_ID,
        state_json={
            "current_zone_id": "ZONE_A",
            "completed_puzzle_ids": [],
            "acquired_clue_ids": [],
            "hint_levels": {},
            "flags": {},
        },
        created_at=datetime(2026, 10, 29),
        updated_at=datetime(2026, 10, 29),
        completed_at=None,
    )
    request = NpcNudgeRequest(
        client_event_id="e1",
        kind="nudge",
        npc_id="NPC_COMPANION",
        line_id="NUDGE_GENERAL",
    )

    async def call():
        return await process_npc_request(
            db,
            "play-session-id",
            request,
            line_source=target.line_source(log.source()),
            hint_source=target.hint_source(server_hint_text),
            runtime_loader=target.runtime_loader(),
        )

    if approved:
        result = await call()
        assert result.line is not None and result.line.text == "(가상) 둘러보자."
    else:
        with pytest.raises(NpcLineNotFoundError):
            await call()


# --- 케이스별 대체 대사 ---


FALLBACKS = [
    {
        "line_id": "FALLBACK_01",
        "text": "(가상) 잠깐 쉬어요.",
        "use": "generation_blocked",
    },
    {
        "line_id": "FALLBACK_02",
        "text": "(가상) 같이 봐요.",
        "use": "generation_blocked",
    },
]


def test_fallback_lines_follow_bundle_approval() -> None:
    target = bundle(fallback_lines=FALLBACKS)
    log = approved_log((CASE_ID, 1), FP)

    without = fallback_line_provider(target, None)()
    approved = fallback_line_provider(target, log.source())()

    assert [(line.line_id, line.approved) for line in without] == [
        ("FALLBACK_01", False),
        ("FALLBACK_02", False),
    ]
    assert [(line.line_id, line.approved) for line in approved] == [
        ("FALLBACK_01", True),
        ("FALLBACK_02", True),
    ]


def test_bundle_without_npc_has_no_fallbacks() -> None:
    assert fallback_line_provider(make_bundle(1, FP, npc=None), None)() == []


# --- 정책 규칙 ---


def test_policy_rules_need_both_ng_and_open() -> None:
    assert policy_rules_from_pack(None) is None
    assert policy_rules_from_pack(v043_npc()) is None
    assert policy_rules_from_pack(v043_npc(ng=[])) is None
    assert policy_rules_from_pack(v043_npc(open=[])) is None


def test_policy_rules_from_pack() -> None:
    rules = policy_rules_from_pack(
        v043_npc(
            ng=[{"text": "(가상) 금지", "patterns": ["금지패턴"]}],
            open=[{"text": "(가상) 정체", "patterns": ["정체패턴"]}],
        )
    )

    assert rules is not None
    assert [(r.rule_id, r.text, r.patterns) for r in rules.ng] == [
        ("ng[0]", "(가상) 금지", ("금지패턴",))
    ]
    assert [(r.rule_id, r.topic, r.patterns, r.hedges) for r in rules.open_topics] == [
        ("open[0]", "(가상) 정체", ("정체패턴",), ())
    ]


# --- 일반 팩 (계약 준비) ---


def general_pack(**overrides: Any) -> GeneralLinePack:
    raw = {
        "schema_version": "npc-general-pack 0.1",
        "pack_id": "general_default",
        "pack_version": 1,
        "lines": [
            {"line_id": line_id, "text": text, "use": "puzzle_question"}
            for line_id, text in PM_GENERIC_PUZZLE_LINES.items()
        ],
    }
    raw.update(overrides)
    return GeneralLinePack.model_validate(raw)


def test_general_pack_fingerprint_is_stable_and_content_bound() -> None:
    pack = general_pack()
    changed = general_pack(pack_version=2)

    assert general_pack_fingerprint(pack) == general_pack_fingerprint(general_pack())
    assert general_pack_fingerprint(pack).startswith("sha256:")
    assert general_pack_fingerprint(pack) != general_pack_fingerprint(changed)


def test_general_pack_needs_approval_history() -> None:
    pack = general_pack()
    log = approved_log(("general_default", 1), general_pack_fingerprint(pack))

    assert general_pack_approved(pack, None) is False
    assert general_pack_approved(pack, log.source()) is True
    assert all(
        line.approved for line in general_pack_line_provider(pack, log.source())()
    )
    assert not any(line.approved for line in general_pack_line_provider(pack, None)())


def test_generic_line_approval_requires_approved_pack_with_same_text() -> None:
    pack = general_pack()
    log = approved_log(("general_default", 1), general_pack_fingerprint(pack))
    altered_lines = [line.model_dump() for line in pack.lines]
    altered_lines[0]["text"] = "(가상) 바뀐 문구"
    altered = general_pack(lines=altered_lines)
    altered_log = approved_log(
        ("general_default", 1), general_pack_fingerprint(altered)
    )

    approve = generic_line_approval(pack, log.source(), PM_GENERIC_PUZZLE_LINES)
    unapproved = generic_line_approval(pack, None, PM_GENERIC_PUZZLE_LINES)
    wrong_text = generic_line_approval(
        altered, altered_log.source(), PM_GENERIC_PUZZLE_LINES
    )

    assert approve("NPC_GENERIC_PUZZLE_02") is True
    assert approve("NPC_UNKNOWN") is False
    assert unapproved("NPC_GENERIC_PUZZLE_02") is False
    assert wrong_text("NPC_GENERIC_PUZZLE_01") is False
    assert wrong_text("NPC_GENERIC_PUZZLE_02") is True


@pytest.mark.parametrize(
    "overrides",
    [
        {"schema_version": "npc-general-pack 0.2"},
        {"pack_version": 0},
        {"lines": []},
        {"extra": 1},
    ],
)
def test_invalid_general_pack_is_rejected(overrides: dict) -> None:
    with pytest.raises(ValueError):
        general_pack(**overrides)
