"""본편 튜토리얼 소화전 자물쇠 — 프론트 정답과 서버 판정이 같은지(11/20 세진).

#178(11/17)이 프론트 답(`src/props/hydrantCabinet/hydrantLockClue.ts` `HYDRANT_LOCK_ANSWER`)을 캔 라벨 퀴즈로 바꿨는데 서버
`case_001.server.json` 의 `PUZZLE_FIRE_CABINET_LOCK.accepted_answers` 는 옛 답 그대로라, 처음 푸는 플레이어는 맞는 답을 넣어도
`incorrect` 를 받았다(본편은 `content_version` 없이 레거시 세션을 만들어 이 파일로 판정한다 — `src/server/api.ts` createPlaySession).

- 프론트 상수와 서버 정답이 다시 갈라지면 여기서 먼저 실패한다(파일을 직접 읽는다).
- 실제 콘텐츠 파일 + 실제 `/interactions` 판정 경로(DB 만 가짜)로 정답 · 오답 · 이미 완료를 본다.
"""

import re
from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient

from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.services.puzzle_runtime import load_case_runtime, normalize_answer
from tests.conftest import FakeAsyncSession

REPO = Path(__file__).resolve().parents[2]
CLUE_SOURCE = REPO / "src" / "props" / "hydrantCabinet" / "hydrantLockClue.ts"
CONTROLS_SOURCE = REPO / "src" / "station" / "controls" / "corridorCabinetControls.ts"

PLAY_SESSION_ID = "33333333-3333-4333-8333-333333333333"
URL = f"/api/v1/play-sessions/{PLAY_SESSION_ID}/interactions"
ZONE = "ZONE_SECRET_CORRIDOR"
LOCK = "OBJ_FIRE_CABINET_LOCK"
PUZZLE = "PUZZLE_FIRE_CABINET_LOCK"


def frontend_answer() -> str:
    match = re.search(
        r'export const HYDRANT_LOCK_ANSWER = "([^"]+)";',
        CLUE_SOURCE.read_text(encoding="utf-8"),
    )
    assert match, "hydrantLockClue.ts 에서 HYDRANT_LOCK_ANSWER 를 찾지 못했다"
    return match.group(1)


def server_answers() -> set[str]:
    runtime = load_case_runtime("case_001")
    puzzle = next(p for p in runtime.puzzles if p.puzzle_id == PUZZLE)
    return {normalize_answer(answer) for answer in puzzle.accepted_answers}


# --- 프론트 · 서버 정답 일치 ---


def test_frontend_answer_is_accepted_by_the_server_runtime():
    assert normalize_answer(frontend_answer()) in server_answers()


def test_frontend_lock_reads_the_single_answer_constant():
    """자물쇠의 Leva 「정답」 기본값도 같은 상수를 읽는다 — 프론트 안에 다른 답 문자열이 따로 있지 않다."""

    controls = CONTROLS_SOURCE.read_text(encoding="utf-8")
    assert 'answer: { value: HYDRANT_LOCK_ANSWER, label: "정답" }' in controls


def test_server_puzzle_keeps_its_ids_and_reward():
    runtime = load_case_runtime("case_001")
    puzzle = next(p for p in runtime.puzzles if p.puzzle_id == PUZZLE)
    assert puzzle.on_correct.set_flags == {"fire_cabinet_unlocked": True}
    assert puzzle.on_correct.grant_clue_ids == []
    assert puzzle.on_correct.complete_puzzle_ids == []


# --- 실제 판정 경로(레거시 세션 = content_version 없음) ---


def legacy_session(*, completed: bool = False) -> PlaySession:
    now = datetime(2026, 11, 20, 1, 0, 0)
    return PlaySession(
        id=PLAY_SESSION_ID,
        anonymous_session_id="anonymous-session-id",
        case_id="case_001",
        state_json={
            "current_zone_id": ZONE,
            "completed_puzzle_ids": [PUZZLE] if completed else [],
            "acquired_clue_ids": [],
            "hint_levels": {},
            "attempt_counts": {PUZZLE: 1} if completed else {},
            "flags": {"fire_cabinet_unlocked": True} if completed else {},
        },
        created_at=now,
        updated_at=now,
        completed_at=None,
    )


def submit(client: TestClient, answer: str, event_id: str):
    return client.post(
        URL,
        json={
            "client_event_id": event_id,
            "client_timestamp": "2026-11-20T10:00:00+09:00",
            "zone_id": ZONE,
            "action": "input",
            "target_type": "object",
            "target_id": LOCK,
            "payload": {"answer": answer},
        },
    )


def test_new_player_opens_the_lock_with_the_frontend_answer(
    client: TestClient, db_session: FakeAsyncSession
):
    session = legacy_session()
    assert session.content_version is None  # 본편이 만드는 레거시 세션
    db_session.get_result = session

    response = submit(client, frontend_answer(), "44444444-4444-4444-8444-444444444441")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["result_type"] == "correct"
    assert {"type": "puzzle_completed", "puzzle_id": PUZZLE} in body["state_changes"]
    assert {
        "type": "flag_updated",
        "flag": "fire_cabinet_unlocked",
        "value": True,
    } in body["state_changes"]
    assert session.state_json["completed_puzzle_ids"] == [PUZZLE]
    assert session.state_json["flags"] == {"fire_cabinet_unlocked": True}
    event = db_session.added[0]
    assert isinstance(event, InteractionEvent)
    assert event.target_id == PUZZLE and event.interaction_type == "submit_answer"


def test_spacing_and_case_are_normalized_like_before(
    client: TestClient, db_session: FakeAsyncSession
):
    db_session.get_result = legacy_session()
    spaced = " " + " ".join(frontend_answer().lower()) + " "

    response = submit(client, spaced, "44444444-4444-4444-8444-444444444442")

    assert response.json()["result_type"] == "correct"


def test_other_inputs_are_incorrect(client: TestClient, db_session: FakeAsyncSession):
    session = legacy_session()
    db_session.get_result = session
    answer = frontend_answer()
    # 옛 답(VALVE)은 이 PR 에서 더는 받지 않는다 — 계속 받을지는 PM 결정 대기(받기로 하면 이 목록에서 빼고 서버 정답에 더한다)
    wrong_inputs = ["VALVE", answer[:-1], answer + "S", "WRONG"]
    for index, wrong in enumerate(wrong_inputs, start=3):
        response = submit(client, wrong, f"44444444-4444-4444-8444-44444444444{index}")
        assert response.json()["result_type"] == "incorrect", wrong
    assert session.state_json["completed_puzzle_ids"] == []
    assert session.state_json["attempt_counts"] == {PUZZLE: len(wrong_inputs)}
    assert "fire_cabinet_unlocked" not in session.state_json["flags"]


def test_player_who_already_solved_it_is_unaffected(
    client: TestClient, db_session: FakeAsyncSession
):
    """이미 푼 회차는 어떤 입력이든 `already_completed`(전과 같다) — 정답이 바뀌어도 진행 · 횟수가 그대로다."""

    session = legacy_session(completed=True)
    db_session.get_result = session

    for index, answer in enumerate(["VALVE", frontend_answer(), "anything"]):
        response = submit(client, answer, f"55555555-5555-4555-8555-55555555555{index}")
        assert response.json()["result_type"] == "already_completed", answer
    assert session.state_json["completed_puzzle_ids"] == [PUZZLE]
    assert session.state_json["attempt_counts"] == {PUZZLE: 1}
    assert session.state_json["flags"] == {"fire_cabinet_unlocked": True}
