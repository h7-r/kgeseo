"""P3-B — FeatureMeta 대상 · ActivityGate · 정책 확장 · 모델 · 부트스트랩 · 선택 독립성."""

import inspect
import json
from pathlib import Path

import numpy as np
import pytest
from conftest import BACKEND_DIR

from companion_npc.contracts.npc_context import NpcContext
from companion_npc.features.schema import FEATURE_NAMES, FeatureMeta, FeatureRowSchema
from companion_npc.simulation.writer import generate, load_config, load_scenarios
from companion_npc.training.activity import diagnose_gate, gate_active
from companion_npc.training.bootstrap import session_bootstrap, weighted_scores
from companion_npc.training.dataset import (
    FEATURE_COLUMNS,
    ExampleSet,
    OracleColumns,
    build_examples,
)
from companion_npc.training.models import LgbmSpec, LogRegSpec, fit_lgbm, fit_logreg
from companion_npc.training.p3b import (
    P3BConfig,
    run_experiment,
    select_model,
    select_rule,
)
from companion_npc.training.policy import PolicyConfig, run_policy_detailed
from companion_npc.training.provenance import dumps
from companion_npc.training.report import WARNING
from companion_npc.training.report_b import metrics_summary, render
from companion_npc.training.splits import leave_one_case_out

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(
    not (BACKEND_DIR / "app" / "content" / "cases" / "case_001.client.json").is_file(),
    reason="backend not found",
)


def _config(**update) -> P3BConfig:
    raw = json.loads(
        (ROOT / "experiments" / "p3" / "p3b_models.json").read_text(encoding="utf-8")
    )
    raw = {k: v for k, v in raw.items() if not k.startswith("_")}
    raw |= {
        "seeds": [20261025],
        "sessions_per_case_archetype": 2,
        "inner_folds": 3,
        "weightings": ["session", "thin60"],
        "lgbm_grid": [
            {
                "num_leaves": 3,
                "learning_rate": 0.1,
                "n_estimators": 5,
                "min_child_samples": 5,
            },
            {
                "num_leaves": 4,
                "learning_rate": 0.1,
                "n_estimators": 8,
                "min_child_samples": 5,
            },
        ],
        "lgbm_threads": 1,
        "bootstrap": {"n": 100, "seed": 0},
    } | update
    return P3BConfig.model_validate(raw)


@pytest.fixture(scope="module")
def examples():
    sim = load_config(ROOT / "experiments" / "p2c_default.json").model_copy(
        update={"sessions_per_case_archetype": 4}
    )
    scenarios = load_scenarios(sim, ROOT)
    return build_examples("t", generate(sim, scenarios).outputs, scenarios)


def _toy(rows: list[dict]) -> ExampleSet:
    """정책 규칙을 손으로 확인하려는 작은 ExampleSet. 행: t · since · solved · obs · puzzle · session."""

    X = np.full((len(rows), len(FEATURE_COLUMNS)), np.nan)
    since, solved = (
        FEATURE_COLUMNS.index("since_last_interaction_sec"),
        FEATURE_COLUMNS.index("target_solved"),
    )
    for i, r in enumerate(rows):
        X[i, since], X[i, solved] = r.get("since", 0.0), r.get("solved", 0.0)
    n = len(rows)

    def obj(key: str, default=None) -> np.ndarray:
        return np.array([r.get(key, default) for r in rows], dtype=object)

    return ExampleSet(
        dataset_id="toy",
        columns=FEATURE_COLUMNS,
        X=X,
        y=np.zeros(n),
        proxy=np.zeros(n),
        session=obj("session", "s1"),
        case=obj("case", "c"),
        t=np.array([r["t"] for r in rows], dtype=float),
        oracle=OracleColumns(
            obj("mode", "working"),
            obj("arch", "fast_solver"),
            obj("status", "eligible"),
        ),
        sessions={},
        target_puzzle=obj("puzzle"),
        target_observation=obj("obs", "none"),
    )


# ── 1. FeatureMeta ──────────────────────────────────────────
def test_meta_carries_target_but_rows_do_not(examples):
    assert list(FeatureRowSchema().columns) == [
        c for n in FEATURE_NAMES for c in (n, f"{n}__known")
    ]
    assert set(examples.target_observation) <= {
        "last_attempt",
        "none",
    }  # 오프라인엔 포커스가 없다
    puzzles = {p for p in examples.target_puzzle if p}
    assert puzzles and not puzzles & set(
        examples.columns
    )  # 퍼즐 ID 는 열 이름이 아니다
    assert (
        examples.X.dtype == np.float64
    )  # 학습 열은 숫자뿐 — 퍼즐 ID 문자열이 들어갈 자리가 없다
    assert len(examples.target_puzzle) == len(
        examples.X
    )  # meta 는 X 와 따로 같은 길이로


def test_meta_validator():
    base = dict(
        request_id="r",
        play_session_id="s",
        case_id="c",
        pack_id="p",
        decision_at="2026-10-24T00:00:00+00:00",
        phase="live",
    )
    FeatureMeta(
        **base,
        target_source="focus",
        target_puzzle_id="P",
        target_observation="observed_focus",
    )
    FeatureMeta(**base, target_source="none")
    with pytest.raises(ValueError):
        FeatureMeta(
            **base,
            target_source="last_attempt",
            target_puzzle_id="P",
            target_observation="observed_focus",
        )
    with pytest.raises(ValueError):
        FeatureMeta(
            **base, target_source="last_attempt", target_observation="last_attempt"
        )  # ID 없음


def test_focus_context_marks_observed_focus():
    from companion_npc.adapters import convert_case, load_case_sources
    from companion_npc.features import extract_features

    sources = load_case_sources(
        ROOT / "tests" / "fixtures" / "cases", "case_fixture_archive"
    )
    pack = convert_case(sources.client, sources.server, client_ref="x").pack
    state = {
        "current_zone_id": "ZONE_ARCHIVE_HALL",
        "completed_puzzle_ids": [],
        "acquired_clue_ids": [],
        "hint_levels": {},
        "flags": {},
    }
    ctx = NpcContext.model_validate({
        "request_id": "r", "requested_at": "2026-10-24T00:00:00+00:00", "play_session_id": "s",
        "case_id": pack.case_id, "pack_id": pack.pack_id, "trigger": {"type": "player_request", "source": "fe"},
        "player_message": {"text": "도와줘"}, "state": state, "timing": {"session_active_sec": 1},
        "focus": {"puzzle_id": "PUZZLE_CABINET"},
    })  # fmt: skip
    meta = extract_features(ctx, pack).meta
    assert (meta.target_observation, meta.target_puzzle_id) == (
        "observed_focus",
        "PUZZLE_CABINET",
    )


# ── 2. ActivityGate ────────────────────────────────────────
def test_gate_takes_only_observable_inputs():
    assert list(inspect.signature(gate_active).parameters) == [
        "X",
        "columns",
        "cutoff_sec",
    ]


def test_gate_cutoffs(examples):
    rows = np.arange(len(examples))
    since = examples.X[:, examples.columns.index("since_last_interaction_sec")]
    assert gate_active(examples.X, examples.columns, None).all()
    two = gate_active(examples.X, examples.columns, 120)
    assert not two[since > 120].any() and two[since <= 120].all()
    blocked = [
        int((~gate_active(examples.X, examples.columns, c)).sum())
        for c in (120, 300, 600)
    ]
    assert blocked[0] >= blocked[1] >= blocked[2]
    diag = diagnose_gate(examples, rows, two)
    assert (
        0 <= diag["active_time_blocked_share"] <= 1
        and "long_explorer" in diag["active_time_blocked_share_by_archetype"]
    )
    assert (
        diagnose_gate(examples, rows, np.ones(len(rows), bool))["blocked_points"] == 0
    )


# ── 3. 정책 확장 ────────────────────────────────────────────
def test_focus_allows_puzzle_hints_with_cap_and_cooldown():
    toy = _toy(
        [{"t": 0 + 70 * i, "obs": "observed_focus", "puzzle": "P1"} for i in range(4)]
    )
    res = run_policy_detailed(
        toy, np.arange(4), np.ones(4), PolicyConfig(cooldown_sec=60, max_per_puzzle=2)
    )
    assert (
        list(res.kinds) == ["puzzle_hint", "puzzle_hint", "", ""]
        and res.held["puzzle_cap"] == 2
    )


def test_completed_focus_puzzle_is_never_hinted():
    toy = _toy([{"t": 0, "obs": "observed_focus", "puzzle": "P1", "solved": 1.0}])
    res = run_policy_detailed(toy, np.arange(1), np.ones(1), PolicyConfig())
    assert not res.alerts.any() and res.held["completed_target"] == 1


def test_last_attempt_never_gets_puzzle_hint():
    toy = _toy(
        [{"t": 100 * i, "obs": "last_attempt", "puzzle": "P1"} for i in range(3)]
        + [{"t": 400, "obs": "none"}]
    )
    res = run_policy_detailed(
        toy, np.arange(4), np.ones(4), PolicyConfig(max_per_puzzle=1)
    )
    assert set(res.kinds) == {
        "check_in"
    }  # 퍼즐을 짚지 않는 확인 발화만, 퍼즐 상한도 걸리지 않는다


def test_session_cap_and_gate():
    toy = _toy([{"t": 100 * i, "since": 0 if i < 2 else 700} for i in range(6)])
    capped = run_policy_detailed(
        toy, np.arange(6), np.ones(6), PolicyConfig(max_per_session=3)
    )
    assert capped.alerts.sum() == 3
    gated = run_policy_detailed(
        toy, np.arange(6), np.ones(6), PolicyConfig(gate_cutoff_sec=600)
    )
    assert gated.alerts.sum() == 2 and gated.held["activity_gate"] == 4


# ── 4·5. 모델 ───────────────────────────────────────────────
def test_logreg_preprocess_fits_on_train_only(examples):
    rows = np.flatnonzero(examples.labeled)
    train, test = rows[: len(rows) // 2], rows[len(rows) // 2 :]
    w = np.ones(len(train))
    a = fit_logreg(
        examples.X[train], examples.y[train], w, examples.columns, LogRegSpec(1.0)
    )
    poisoned = examples.X.copy()
    poisoned[test] = 1e6
    b = fit_logreg(
        poisoned[train], examples.y[train], w, examples.columns, LogRegSpec(1.0)
    )
    assert np.allclose(a.predict(examples.X[test]), b.predict(examples.X[test]))
    assert set(a.export(examples.columns)["coefficients"]) <= set(examples.columns)


def test_lgbm_is_deterministic_and_accepts_nan(examples):
    rows = np.flatnonzero(examples.labeled)
    spec = LgbmSpec(4, 0.1, 10, 5)
    p = [
        fit_lgbm(
            examples.X[rows],
            examples.y[rows],
            np.ones(len(rows)),
            examples.columns,
            spec,
            2,
        ).predict(examples.X[rows])
        for _ in range(2)
    ]
    assert np.array_equal(p[0], p[1]) and np.isnan(examples.X[rows]).any()


# ── 부트스트랩 ───────────────────────────────────────────────
def test_bootstrap_is_session_level_and_deterministic():
    rng = np.random.default_rng(0)
    sessions = np.repeat([f"s{i}" for i in range(40)], 10)
    y = np.repeat(rng.integers(0, 2, 40), 10).astype(
        float
    )  # 같은 세션의 tick 은 같은 라벨
    score = np.clip(y * 0.6 + rng.random(400) * 0.4, 0, 1)
    w = np.ones(400)
    a = session_bootstrap(y, score, w, sessions, 0.5, n=200, seed=1)
    assert a == session_bootstrap(y, score, w, sessions, 0.5, n=200, seed=1)
    order = rng.permutation(400)
    assert a == session_bootstrap(
        y[order], score[order], w[order], sessions[order], 0.5, n=200, seed=1
    )
    point = weighted_scores(y, score, w, 0.5)["f1"]
    assert a["f1"][0] <= point <= a["f1"][1]


# ── 10. 바깥 테스트를 선택에 쓰지 않는다 ─────────────────────────
def test_selection_ignores_outer_test(examples):
    config = _config()
    fold = leave_one_case_out(examples, 3, seed=7)[0]
    before = (
        select_model(examples, fold, "logreg", "session", config),
        select_rule(examples, fold, config),
    )
    saved_y, saved_X = examples.y[fold.test].copy(), examples.X[fold.test].copy()
    examples.y[fold.test] = 1 - np.nan_to_num(saved_y)
    examples.X[fold.test] = 0.0
    try:
        after = (
            select_model(examples, fold, "logreg", "session", config),
            select_rule(examples, fold, config),
        )
    finally:
        examples.y[fold.test], examples.X[fold.test] = saved_y, saved_X
    assert after == before


def test_config_grids_are_fixed():
    committed = _config(
        lgbm_grid=json.loads(
            (ROOT / "experiments" / "p3" / "p3b_models.json").read_text(
                encoding="utf-8"
            )
        )["lgbm_grid"]
    )
    assert len(committed.logreg_C) == 6 and len(committed.lgbm_grid) == 16
    with pytest.raises(ValueError):
        _config(logreg_C=[1.0, 2.0])
    with pytest.raises(ValueError):
        _config(
            lgbm_grid=[
                {
                    "num_leaves": 3,
                    "learning_rate": 0.1,
                    "n_estimators": 5,
                    "min_child_samples": 5,
                }
            ]
            * 21
        )


# ── 전체 (작게) ─────────────────────────────────────────────
def test_small_p3b_end_to_end(tmp_path):
    config = _config()
    results = run_experiment(config, ROOT, out_dir=tmp_path, log=lambda m: None)
    fold = next(iter(results["seeds"]["20261025"]["folds"].values()))
    assert {
        "rule",
        "logreg[session]",
        "logreg[thin60]",
        "lgbm[session]",
        "lgbm[thin60]",
        "always_intervene",
        "never_intervene",
    } <= set(fold["models"])
    assert len(fold["selection_sha256"]) == 64
    grid = fold["models"]["lgbm[session]"]["policy_observable"]
    assert len(grid) == 4 * 2 * 2 and results["primary_policy"] in grid
    diag = grid[results["primary_policy"]]["diagnostic"]
    assert (
        isinstance(diag["feasible"], bool)
        and diag["operational_suitability"] == "not_assessed"
    )
    assert "brier" in fold["models"]["logreg[session]"]["classification"]
    assert (
        "parameter_shift" in fold["models"]["lgbm[session]"]
        and "parameter_shift" in fold["models"]["rule"]
    )
    assert (tmp_path / "partial_seed20261025.json").exists()
    raw = tmp_path / "results.json"
    raw.write_text(dumps(results), encoding="utf-8")
    summary = metrics_summary(results, raw)
    assert summary["representative"] is False and summary["completed_seeds"] == [
        20261025
    ]
    assert len(dumps(summary)) < len(dumps(results))
    assert render(results).startswith(WARNING)
