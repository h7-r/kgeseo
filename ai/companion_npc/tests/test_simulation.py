"""P2-C — 합성 플레이어 시뮬레이터."""

import ast
import json
import re
from collections import Counter
from pathlib import Path

import pytest
from conftest import BACKEND_DIR, FIXTURES, REPO_ROOT

from companion_npc.features.fingerprint import AnswerFingerprinter
from companion_npc.features.replay import LoggedInteraction
from companion_npc.features.schema import FeatureRowSchema
from companion_npc.simulation.analysis import (
    analyze_session,
    needs_help_of,
    summarize,
    training_rows,
)
from companion_npc.simulation.config import ARCHETYPES, DEFAULT_ARCHETYPES
from companion_npc.simulation.engine import simulate_session
from companion_npc.simulation.runtime_effect import apply_correct
from companion_npc.simulation.writer import (
    dataset_lines,
    generate,
    load_config,
    load_scenarios,
    manifest,
    write_dataset,
)

ROOT = Path(__file__).resolve().parents[1]  # ai/companion_npc
CONFIG = ROOT / "experiments" / "p2c_default.json"
SAMPLE = FIXTURES / "synthetic"
KEY = b"test-only-fingerprint-key-000000"
needs_backend = pytest.mark.skipif(
    not (BACKEND_DIR / "app" / "content" / "cases" / "case_001.client.json").is_file(),
    reason="backend not found",
)
pytestmark = needs_backend  # 기본 설정이 case_001 을 쓴다


def _config(sessions: int, **update):
    config = load_config(CONFIG)
    return config.model_copy(update={"sessions_per_case_archetype": sessions, **update})


@pytest.fixture(scope="module")
def scenarios():
    return load_scenarios(load_config(CONFIG), ROOT)


@pytest.fixture(scope="module")
def dataset(scenarios):
    return generate(_config(12), scenarios)


@pytest.fixture(scope="module")
def records(dataset, scenarios):
    return [
        r
        for o in dataset.outputs
        for r in analyze_session(
            o, scenarios[o.truth.case_id].pack, fingerprinter=AnswerFingerprinter(KEY)
        )
    ]


def _real_answers() -> list[str]:
    answers = []
    for path in [
        BACKEND_DIR / "app" / "content" / "cases" / "case_001.server.json",
        *(FIXTURES / "cases").glob("*.server.json"),
    ]:
        server = json.loads(path.read_text(encoding="utf-8"))
        answers += [a for p in server["puzzles"] for a in p["accepted_answers"]]
    return answers


# ── 설정 ────────────────────────────────────────────────────
def test_config_file_matches_documented_defaults():
    config = load_config(CONFIG)
    assert set(config.archetypes) == set(ARCHETYPES)
    for name in ARCHETYPES:
        assert config.archetypes[name] == DEFAULT_ARCHETYPES[name], name
    assert config.already_completed_prob == 0.05
    assert config.sessions_per_case_archetype == 200


# ── 1. 재현성 ───────────────────────────────────────────────
def test_same_seed_same_bytes(scenarios):
    first = dataset_lines(generate(_config(3), scenarios))
    second = dataset_lines(generate(_config(3), scenarios))
    assert first == second


def test_different_seed_differs(scenarios):
    a = dataset_lines(generate(_config(2), scenarios))
    b = dataset_lines(generate(_config(2, seed=1), scenarios))
    assert a["interaction_events.jsonl"] != b["interaction_events.jsonl"]


def test_streams_are_independent(scenarios):
    # 세션을 늘려도 앞 세션은 그대로
    small = {
        o.truth.play_session_id: o for o in generate(_config(2), scenarios).outputs
    }
    large = {
        o.truth.play_session_id: o for o in generate(_config(4), scenarios).outputs
    }
    assert set(small) <= set(large)
    assert all(small[k].rows == large[k].rows for k in small)


def test_committed_sample_reproduces(scenarios, tmp_path):
    meta = write_dataset(generate(_config(1), scenarios), tmp_path)
    committed = json.loads((SAMPLE / "manifest.json").read_text(encoding="utf-8"))
    assert meta == committed
    for name in meta["files"]:
        assert (tmp_path / name).read_bytes() == (SAMPLE / name).read_bytes(), name


# ── 2. 사건 · 유형별 생성 ────────────────────────────────────
def test_every_case_and_archetype_generated(dataset):
    counts = Counter((o.truth.case_id, o.truth.archetype) for o in dataset.outputs)
    assert len(counts) == 3 * 5 and set(counts.values()) == {12}


def test_reachability(scenarios):
    archive = scenarios["case_fixture_archive"]
    assert len(archive.answerable) == 5
    assert archive.reachable == {
        "PUZZLE_CABINET", "PUZZLE_LEDGER", "PUZZLE_MAP", "PUZZLE_KEYPAD", "PUZZLE_SEAL",
        "PUZZLE_VAULT_ENTRY",
    }  # fmt: skip
    assert archive.unreachable == ("PUZZLE_RECONCILE",)  # 조합으로만 완료
    assert scenarios["case_fixture_lighthouse"].unreachable == ("PUZZLE_RECONSTRUCT",)
    assert scenarios["case_001"].unreachable == ()


def test_archetypes_behave_in_configured_direction(dataset, records):
    summary = {
        (g["case_id"], g["archetype"]): g
        for g in summarize(dataset.outputs, records)["groups"]
    }
    for case in ("case_fixture_archive", "case_fixture_lighthouse"):
        fast, repeat = summary[(case, "fast_solver")], summary[(case, "repeat_wrong")]
        assert fast["incorrect_rate"] < repeat["incorrect_rate"]
        assert (repeat["repeat_wrong_rate"] or 0) > (fast["repeat_wrong_rate"] or 0)
        assert summary[(case, "dropout")]["outcomes"].get("abandoned", 0) > 0
        explorer = summary[(case, "long_explorer")]["decision_mode_counts"]
        assert explorer["exploring"] > explorer["stuck"]


def test_rows_use_only_operational_actions(dataset):
    types = {r["interaction_type"] for o in dataset.outputs for r in o.rows}
    assert types <= {
        "submit_answer",
        "combine_clues",
    }  # inspect·navigate 는 별도 파일에만
    results = Counter(r["result_type"] for o in dataset.outputs for r in o.rows)
    assert (
        results["incorrect_combination"] > 0 and "combined" not in results
    )  # 조합 성공 없음
    assert results["already_completed"] > 0


def test_runtime_effect_matches_backend_order(scenarios):
    lens = scenarios["case_fixture_lighthouse"].puzzles["PUZZLE_LENS"]
    state = {"completed_puzzle_ids": [], "acquired_clue_ids": [], "flags": {}}
    _, changes = apply_correct(state, lens)
    assert changes == [
        {"type": "puzzle_completed", "puzzle_id": "PUZZLE_LENS"},
        {"type": "puzzle_completed", "puzzle_id": "PUZZLE_FINALE"},
        {"type": "flag_updated", "flag": "lamp_lit", "value": True},
    ]
    _, again = apply_correct({"completed_puzzle_ids": ["PUZZLE_LENS"], "acquired_clue_ids": [], "flags": {"lamp_lit": True}}, lens)  # fmt: skip
    assert again == [{"type": "puzzle_completed", "puzzle_id": "PUZZLE_FINALE"}]


# ── 3. 재생 파이프라인 · 4. 스키마 ─────────────────────────────
def _backend_event_columns() -> set[str]:
    tree = ast.parse(
        (BACKEND_DIR / "app" / "models" / "interaction_event.py").read_text(
            encoding="utf-8"
        )
    )
    return {
        node.target.id
        for node in ast.walk(tree)
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
        and "mapped_column" in ast.unparse(node.value or ast.Constant(None))
    }  # fmt: skip


def test_rows_match_backend_columns_and_replay_model(dataset):
    columns = _backend_event_columns()
    assert len(columns) == 10
    for output in dataset.outputs:
        for row in output.rows:
            assert set(row) == columns
            LoggedInteraction.model_validate(row)


def test_every_session_replays_with_same_schema(records, dataset):
    assert {r.play_session_id for r in records} == {
        o.truth.play_session_id for o in dataset.outputs if o.rows
    }
    columns = FeatureRowSchema().columns
    assert all(list(r.features) == columns for r in records)


# ── 5. 정답 · 원문 누설 ──────────────────────────────────────
# 무작위 UUID · 시각 · 해시 안에 4자리 숫자 정답이 우연히 나타날 수 있다 — 콘텐츠가 아니다
_NOISE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    r"|\d{4}-\d{2}-\d{2}T[\d:.+]+"
    r"|[0-9a-f]{64}"
)


def test_no_real_answers_in_outputs(dataset):
    text = "\n".join(
        line for lines in dataset_lines(dataset).values() for line in lines
    )
    text += json.dumps(manifest(dataset, dataset_lines(dataset)), ensure_ascii=False)
    text = _NOISE.sub("", text)
    for answer in _real_answers():
        assert answer.casefold() not in text.casefold(), answer


def test_simulator_never_reads_answers():
    package = ROOT / "src" / "companion_npc" / "simulation"
    for path in package.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert "accepted_answers" not in source and "server.json" not in source.replace(
            "server.json 을 읽지 않는다", ""
        ), path.name


def test_placeholder_answers_do_not_reach_features(records):
    rows = json.dumps(training_rows(records))
    assert "SYNTH" not in rows and "answer" not in rows


# ── 6. 합성 정답과 모델 입력의 분리 ────────────────────────────
def test_hidden_truth_does_not_change_features(dataset, scenarios):
    output = next(
        o for o in dataset.outputs if o.truth.archetype == "repeat_wrong" and o.rows
    )
    pack = scenarios[output.truth.case_id].pack
    altered = type(output)(
        rows=output.rows,
        truth=output.truth.model_copy(
            update={
                "archetype": "fast_solver",
                "ended_at": output.truth.started_at,
                "outcome": "completed",
            }
        ),
        segments=[],
        exploration=[],
    )
    original = [r.features for r in analyze_session(output, pack)]
    assert [r.features for r in analyze_session(altered, pack)] == original


def test_training_rows_hold_no_truth_fields(records):
    for row in training_rows(records):
        assert set(row) == {"features", "labels", "group"}
        assert set(row["group"]) == {"play_session_id", "case_id"}
        flat = json.dumps(row)
        for leaked in ("archetype", "latent", "exploring", "stuck", "away", "post_end"):
            assert leaked not in flat


def test_manifest_flags(dataset):
    meta = manifest(dataset, dataset_lines(dataset))
    assert meta["representative"] is False
    assert meta["model_input_files"] == ["interaction_events.jsonl"]
    assert "synthetic_exploration_events.jsonl" in meta["non_operational_files"]


# ── 7. exploring 과 stuck ──────────────────────────────────
def test_synthetic_help_label_by_mode():
    assert needs_help_of("stuck") == 1
    assert needs_help_of("exploring") == 0 and needs_help_of("working") == 0
    assert needs_help_of("away") is None and needs_help_of("post_end") is None


def test_proxy_label_is_not_help_label(records):
    exploring = [
        r
        for r in records
        if r.latent_mode == "exploring" and r.proxy.status == "labeled"
    ]
    stuck = [
        r for r in records if r.latent_mode == "stuck" and r.proxy.status == "labeled"
    ]
    # 대리 라벨은 탐색 중에도 1 이 된다 — 합성 도움 라벨(0)과 어긋나는 지점이 있다
    assert any(r.proxy.value == 1 and r.synthetic_needs_help == 0 for r in exploring)
    assert all(r.synthetic_needs_help == 1 for r in stuck)
    rate = lambda rs: sum(r.proxy.value for r in rs) / len(rs)  # noqa: E731
    # 이 시드에서의 관찰값 (회귀 확인용). 실제 플레이어에 대한 주장이 아니다
    assert rate(stuck) > rate(exploring)


# ── 8. 종료 이후 tick · censored ─────────────────────────────
def test_post_end_points_are_excluded(records, dataset):
    post_end = [r for r in records if r.latent_mode == "post_end"]
    assert post_end
    assert all(
        r.synthetic_needs_help is None and not r.training_eligible for r in post_end
    )
    cutoff = {
        o.truth.play_session_id
        for o in dataset.outputs
        if o.truth.outcome == "observation_cutoff"
    }
    assert not [
        r for r in post_end if r.play_session_id in cutoff
    ]  # 잘린 세션은 종료 뒤 관측이 없다


def test_censored_points_are_excluded(records, dataset):
    obs_end = {
        o.truth.play_session_id: o.truth.observation_end for o in dataset.outputs
    }
    for record in records:
        late = (
            obs_end[record.play_session_id] - record.decision_at
        ).total_seconds() < 120
        if record.proxy.status == "censored":
            assert late and not record.training_eligible
    assert len(training_rows(records)) == sum(r.training_eligible for r in records)


# ── 9. 도달 가능한 완료 · 전체 완료 ───────────────────────────
def test_reachable_vs_scenario_completion(dataset):
    truths = [o.truth for o in dataset.outputs]
    archive_done = [
        t
        for t in truths
        if t.case_id == "case_fixture_archive" and t.outcome == "completed"
    ]
    assert archive_done and all(
        t.reachable_completed and not t.scenario_completed for t in archive_done
    )
    case_001_done = [
        t for t in truths if t.case_id == "case_001" and t.outcome == "completed"
    ]
    assert case_001_done and all(
        t.reachable_completed and t.scenario_completed for t in case_001_done
    )
    for t in truths:
        if t.outcome == "abandoned":
            assert t.abandon_reason in ("dropout", "max_session")
        if t.outcome == "observation_cutoff":
            assert t.observation_end < t.ended_at
        else:
            assert t.observation_end >= t.ended_at


def test_cutoff_truncates_rows(scenarios):
    config = _config(1, export_after_min=(0.5, 0.5))  # 30초 만에 내보냄 → 거의 다 잘림
    output = simulate_session(
        scenarios["case_fixture_archive"], config, "long_explorer", 0
    )
    assert output.truth.outcome == "observation_cutoff"
    assert output.truth.events_kept <= output.truth.events_generated
    assert all(s.end <= output.truth.observation_end for s in output.segments)


def test_no_writes_outside_out_dir(dataset, tmp_path):
    write_dataset(dataset, tmp_path / "out")
    assert [p.name for p in tmp_path.iterdir()] == ["out"]
    assert not (
        REPO_ROOT / "ai" / "companion_npc" / "data" / "synthetic" / "pytest"
    ).exists()


# ── 판단 시점 집계 — 최종 상태는 상호 배타 ──────────────────────
def test_final_statuses_partition_decision_points(dataset, records):
    summary = summarize(dataset.outputs, records)
    for scope in [summary, *summary["groups"]]:
        assert sum(scope["final_status_counts"].values()) == scope["decision_points"]
    status = summary["final_status_counts"]
    assert status["eligible"] == len(training_rows(records))
    assert status["post_termination"] == summary["decision_mode_counts"]["post_end"]
    # censored 축은 종료 후 시점과 겹친다 — 최종 상태의 censored 는 종료 전 것만
    overlap = sum(
        r.latent_mode == "post_end" and r.proxy.status == "censored" for r in records
    )
    assert (
        summary["proxy_label_status_counts"]["censored"] == status["censored"] + overlap
    )
    assert status["excluded_other"] == 0
