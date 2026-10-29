"""P3-A — 학습·평가 환경 · 데이터 · 분할 · 기준선 · 평가 골격."""

import inspect
import json
from importlib.metadata import version
from pathlib import Path

import numpy as np
import pytest
from conftest import BACKEND_DIR

from companion_npc.simulation.writer import (
    generate,
    load_config,
    load_scenarios,
    write_dataset,
)
from companion_npc.training.baselines import (
    AlwaysIntervene,
    GeneratorReference,
    NeverIntervene,
    RuleBaseline,
)
from companion_npc.training.dataset import (
    FEATURE_COLUMNS,
    ORACLE_NAMES,
    DatasetError,
    build_examples,
    check_label_join,
    load_synthetic_dir,
)
from companion_npc.training.experiment import (
    P3AConfig,
    dataset_stats,
    run_experiment,
    tune_rule,
)
from companion_npc.training.metrics import classification_metrics
from companion_npc.training.policy import PolicyConfig, policy_report, run_policy
from companion_npc.training.preprocess import fit_preprocessor
from companion_npc.training.report import WARNING, render
from companion_npc.training.splits import (
    LeakError,
    OuterFold,
    check_fold,
    group_kfold,
    leave_one_case_out,
)
from companion_npc.training.weights import apply_weighting, session_weights, thin_mask

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(
    not (BACKEND_DIR / "app" / "content" / "cases" / "case_001.client.json").is_file(),
    reason="backend not found",
)


def _small_config(**update) -> P3AConfig:
    raw = json.loads(
        (ROOT / "experiments" / "p3" / "p3a_baselines.json").read_text(encoding="utf-8")
    )
    raw = {k: v for k, v in raw.items() if not k.startswith("_")}
    raw |= {
        "sessions_per_case_archetype": 3,
        "seeds": [20261025],
        "inner_folds": 3,
    } | update
    return P3AConfig.model_validate(raw)


@pytest.fixture(scope="module")
def sim():
    return load_config(ROOT / "experiments" / "p2c_default.json").model_copy(
        update={"sessions_per_case_archetype": 6}
    )


@pytest.fixture(scope="module")
def scenarios(sim):
    return load_scenarios(sim, ROOT)


@pytest.fixture(scope="module")
def dataset(sim, scenarios):
    return generate(sim, scenarios)


@pytest.fixture(scope="module")
def examples(dataset, scenarios):
    return build_examples("t", dataset.outputs, scenarios)


# ── 의존성 ──────────────────────────────────────────────────
def test_requirements_ml_pins_match_installed():
    pins = {}
    for line in (ROOT / "requirements-ml.txt").read_text(encoding="utf-8").splitlines():
        if "==" in line and not line.startswith("#"):
            name, ver = line.split("==")
            pins[name.strip()] = ver.strip()
    assert {"scikit-learn", "lightgbm"} <= set(pins)
    for name, pinned in pins.items():
        assert version(name) == pinned, name


# ── 4. 데이터셋 로더 · 라벨 결합 ────────────────────────────────
def test_columns_are_feature_schema_only(examples):
    assert examples.columns == FEATURE_COLUMNS
    assert not ORACLE_NAMES & set(examples.columns)
    assert examples.X.shape == (len(examples), len(FEATURE_COLUMNS))


def test_label_join(examples):
    counts = check_label_join(examples)
    assert sum(counts.values()) == len(examples)
    mode = examples.oracle.latent_mode
    assert np.all(np.isnan(examples.y[(mode == "away") | (mode == "post_end")]))
    assert np.all(examples.y[mode == "stuck"] == 1)
    assert np.all(examples.y[np.isin(mode, ["working", "exploring"])] == 0)


def test_stats_reasons_partition(examples):
    stats = dataset_stats(examples)
    assert stats["sum_check"] and stats["rows_by_reason"]["excluded_other"] == 0
    assert stats["rows_by_reason"]["usable_for_synthetic_needs_help"] == int(
        examples.labeled.sum()
    )


def test_loader_round_trip(dataset, scenarios, examples, tmp_path):
    write_dataset(dataset, tmp_path)
    loaded = load_synthetic_dir(tmp_path)
    again = build_examples("t", loaded, scenarios)
    assert np.array_equal(again.X, examples.X, equal_nan=True)
    assert np.array_equal(again.y, examples.y, equal_nan=True)


def test_loader_rejects_tampering(dataset, tmp_path):
    write_dataset(dataset, tmp_path)
    path = tmp_path / "session_truth.jsonl"
    path.write_text(
        path.read_text(encoding="utf-8").replace("dropout", "fast_solver", 1),
        encoding="utf-8",
    )
    with pytest.raises(DatasetError, match="sha256"):
        load_synthetic_dir(tmp_path)


def test_loader_requires_non_representative_manifest(dataset, tmp_path):
    write_dataset(dataset, tmp_path)
    manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    manifest["representative"] = True
    (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(DatasetError, match="representative"):
        load_synthetic_dir(tmp_path)


# ── 5. 학습 입력과 합성 정답의 분리 ────────────────────────────
def test_observable_baselines_take_no_oracle():
    for baseline in (AlwaysIntervene(), NeverIntervene(), RuleBaseline(3, 90)):
        assert not baseline.uses_oracle
        assert list(inspect.signature(baseline.score).parameters) == ["X", "columns"]
    reference = GeneratorReference(
        load_config(ROOT / "experiments" / "p2c_default.json")
    )
    assert reference.uses_oracle and not hasattr(reference, "score")


def test_scores_ignore_oracle_columns(examples):
    rule = RuleBaseline(3, 90)
    before = rule.score(examples.X, examples.columns)
    original = examples.oracle.latent_mode
    shuffled = np.random.RandomState(0).permutation(original)
    object.__setattr__(examples.oracle, "latent_mode", shuffled)  # 정답을 망가뜨려도
    try:
        assert np.array_equal(
            rule.score(examples.X, examples.columns), before
        )  # 점수는 같다
    finally:
        object.__setattr__(examples.oracle, "latent_mode", original)
    check_label_join(examples)  # 원래대로 돌아왔는지


# ── 6. 분할 ─────────────────────────────────────────────────
@pytest.fixture(scope="module")
def fresh_examples(dataset, scenarios):
    return build_examples("t", dataset.outputs, scenarios)


def test_leave_one_case_out(fresh_examples):
    folds = leave_one_case_out(fresh_examples, 5, seed=7)
    assert sorted(f.test_case for f in folds) == sorted(
        set(fresh_examples.case.tolist())
    )
    for fold in folds:
        summary = check_fold(fresh_examples, fold)
        assert summary["train_rows"] + summary["test_rows"] == len(fresh_examples)


def test_group_kfold_is_deterministic_and_disjoint(fresh_examples):
    rows = np.arange(len(fresh_examples))
    a = group_kfold(fresh_examples.session, rows, 5, seed=1)
    b = group_kfold(fresh_examples.session, rows, 5, seed=1)
    assert all(np.array_equal(x.val, y.val) for x, y in zip(a, b))
    for inner in a:
        assert not set(fresh_examples.session[inner.train]) & set(
            fresh_examples.session[inner.val]
        )


def test_leak_check_catches_shared_session(fresh_examples):
    fold = leave_one_case_out(fresh_examples, 5, seed=7)[0]
    leaked = OuterFold(
        fold.test_case,
        np.concatenate([fold.train, fold.test[:1]]),
        fold.test,
        fold.inner,
    )
    with pytest.raises(LeakError):
        check_fold(fresh_examples, leaked)


def test_tuning_never_reads_outer_test(fresh_examples):
    config = _small_config()
    fold = leave_one_case_out(fresh_examples, 3, seed=7)[0]
    before = tune_rule(fresh_examples, fold, "session", config)
    saved = fresh_examples.y[fold.test].copy()
    fresh_examples.y[fold.test] = 1 - np.nan_to_num(
        saved, nan=0
    )  # 바깥 테스트 라벨을 뒤집어도
    try:
        assert (
            tune_rule(fresh_examples, fold, "session", config) == before
        )  # 선택은 같다
    finally:
        fresh_examples.y[fold.test] = saved


def test_preprocessor_fits_on_train_only(fresh_examples):
    fold = leave_one_case_out(fresh_examples, 5, seed=7)[0]
    fitted = fit_preprocessor(fresh_examples.X[fold.train], fresh_examples.columns)
    poisoned = fresh_examples.X.copy()
    poisoned[fold.test] = 1e9  # 테스트 행을 바꿔도
    again = fit_preprocessor(poisoned[fold.train], fresh_examples.columns)
    assert np.array_equal(fitted.median, again.median) and fitted.fit_rows == len(
        fold.train
    )
    assert (
        "zone_dwell_sec" in fitted.dropped and "zone_dwell_sec__known" in fitted.dropped
    )
    out = fitted.transform(fresh_examples.X[fold.test])
    assert not np.isnan(out).any()


# ── 가중치 ──────────────────────────────────────────────────
def test_session_weights_sum_to_one_per_session(fresh_examples):
    rows = np.flatnonzero(fresh_examples.labeled)
    w = session_weights(fresh_examples, rows)
    for sid in set(fresh_examples.session[rows]):
        assert w[fresh_examples.session[rows] == sid].sum() == pytest.approx(1.0)


def test_thinning_keeps_events_and_stride(fresh_examples):
    rows = np.arange(len(fresh_examples))
    since = fresh_examples.X[
        rows, fresh_examples.columns.index("since_last_interaction_sec")
    ]
    kept = thin_mask(fresh_examples, rows, 2)
    assert (
        kept[since == 0].all()
        and not kept[since == 30].any()
        and kept[since == 60].all()
    )
    kept_rows, w = apply_weighting(fresh_examples, rows, "thin90")
    assert len(kept_rows) < len(rows) and set(np.unique(w)) == {1.0}


# ── 7. 기준선 · 8. 지표 ───────────────────────────────────────
def test_classification_metrics_by_hand():
    y = np.array([1, 1, 0, 0, 0], dtype=float)
    score = np.array([1, 0, 1, 0, 0], dtype=float)
    m = classification_metrics(y, score, np.ones(5))
    assert (m["precision"], m["recall"], m["f1"]) == (0.5, 0.5, 0.5)
    assert m["false_discovery_rate"] == 0.5 and m[
        "false_positive_rate"
    ] == pytest.approx(1 / 3, abs=1e-4)
    assert (
        classification_metrics(np.zeros(3), np.ones(3), np.ones(3))["average_precision"]
        is None
    )
    with pytest.raises(ValueError):
        classification_metrics(np.array([np.nan]), np.ones(1), np.ones(1))


def test_trivial_baselines(fresh_examples):
    rows = np.flatnonzero(fresh_examples.labeled)
    w = session_weights(fresh_examples, rows)
    always = classification_metrics(fresh_examples.y[rows], np.ones(len(rows)), w)
    never = classification_metrics(fresh_examples.y[rows], np.zeros(len(rows)), w)
    assert always["recall"] == 1.0 and always["false_positive_rate"] == 1.0
    assert never["recall"] == 0.0 and never["precision"] is None


def test_policy_cooldown_and_cap(fresh_examples):
    rows = np.arange(len(fresh_examples))
    ones = np.ones(len(rows))
    alerts = run_policy(fresh_examples, rows, ones, PolicyConfig(cooldown_sec=60))
    for sid in set(fresh_examples.session):
        times = np.sort(
            fresh_examples.t[rows[alerts & (fresh_examples.session[rows] == sid)]]
        )
        assert np.all(np.diff(times) >= 60)
    capped = run_policy(
        fresh_examples, rows, ones, PolicyConfig(cooldown_sec=0, max_per_session=2)
    )
    per_session = [
        int(capped[fresh_examples.session[rows] == s].sum())
        for s in set(fresh_examples.session)
    ]
    assert max(per_session) <= 2
    assert not run_policy(
        fresh_examples, rows, np.zeros(len(rows)), PolicyConfig()
    ).any()


def test_policy_report_separates_unobservable_risk(fresh_examples):
    rows = np.arange(len(fresh_examples))
    alerts = run_policy(
        fresh_examples, rows, np.ones(len(rows)), PolicyConfig(cooldown_sec=60)
    )
    report = policy_report(fresh_examples, rows, alerts)
    assert report["post_termination_alerts"] > 0  # 운영 조건에서는 종료 후에도 개입한다
    assert sum(report["alerts_by_latent_mode"].values()) == report["alerts"]
    assert report["stuck_episodes_with_decision_point"] <= report["stuck_episodes"]
    oracle_rows = rows[
        np.isin(fresh_examples.oracle.latent_mode, ["working", "exploring", "stuck"])
    ]
    ideal = policy_report(
        fresh_examples,
        oracle_rows,
        run_policy(
            fresh_examples, oracle_rows, np.ones(len(oracle_rows)), PolicyConfig()
        ),
    )
    assert ideal["post_termination_alerts"] == 0 and ideal["away_alerts"] == 0


# ── 실험 전체 (작게) ─────────────────────────────────────────
def test_small_experiment_end_to_end():
    config = _small_config()
    results = run_experiment(config, ROOT)
    seed = results["seeds"]["20261025"]
    assert seed["stats"]["sum_check"]
    assert results["representative"] is False
    for fold in seed["folds"].values():
        assert fold["leak_check"]["inner_folds"] == 3
        assert {
            "always_intervene",
            "never_intervene",
            "rule[session]",
            "rule[thin60]",
            "rule[thin90]",
        } <= set(fold["baselines"])
        assert "parameter_shift" in fold["baselines"]["rule[session]"]
        policy = fold["baselines"]["rule[session]"]["policy"]
        assert set(policy) == {"cooldown_60s", "cooldown_30s"}
        assert set(policy["cooldown_60s"]) == {"observable", "oracle_filtered"}
    text = render(results, 60)
    assert text.startswith(WARNING) and "generator_reference" in text


# ── 결과 파일 관리 · 재현 정보 ─────────────────────────────────
def test_metrics_summary_links_to_raw_and_stays_small(tmp_path):
    from companion_npc.training.provenance import dumps, metrics_summary

    results = run_experiment(_small_config(), ROOT)
    raw = tmp_path / "results.json"
    raw.write_text(dumps(results), encoding="utf-8")
    summary = metrics_summary(results, raw)
    prov = summary["provenance"]
    assert summary["representative"] is False
    assert prov["packages"]["scikit-learn"] == version("scikit-learn")
    assert (
        len(prov["source_sha256"]) == 64 and len(prov["simulation_config_sha256"]) == 64
    )
    assert (
        summary["raw_results"]["sha256"]
        == __import__("hashlib").sha256(raw.read_bytes()).hexdigest()
    )
    fold = next(iter(summary["seeds"]["20261025"]["folds"].values()))
    assert (
        "generator_reference_oracle" in fold
        and "generator_reference" not in fold["baselines"]
    )
    assert len(dumps(summary)) < len(dumps(results)) / 3


def test_examples_digest_is_reproducible(dataset, scenarios):
    from companion_npc.training.provenance import examples_digest

    a = examples_digest(build_examples("t", dataset.outputs, scenarios))
    b = examples_digest(build_examples("t", dataset.outputs, scenarios))
    assert a == b and len(a) == 64
