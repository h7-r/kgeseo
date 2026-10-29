"""P3-B — 로지스틱 회귀 · LightGBM · 규칙 기준선 비교 (합성 데이터).

[선택] 바깥 폴드마다, 안쪽 세션 GroupKFold 의 out-of-fold 점수로만 고른다.
  · 모델 설정: 세션 가중 Average Precision 최대 (지도 라벨 내부 검증 성능)
  · 임계값 τ : 같은 out-of-fold 점수에서 세션 가중 F1 최대
  · 규칙(a, b): 세션 가중 F1 최대
  고른 결과(selection)를 해시와 함께 남긴 **뒤에** 바깥 테스트를 한 번 평가한다.
  바깥 테스트 결과를 보고 다시 고르지 않는다.

[정책] 행동 제한(cooldown · 세션/퍼즐 상한 · ActivityGate)은 관측 가능한 값만 쓴다.
  격자 전체를 서술 보고할 뿐, 숨은 상태가 필요한 진단 지표로 고르지 않는다.

[진단 목표] (합성 잠재 상태에 의존 — 사후 진단, 운영 제약이 아니다)
  탐색 10분당 불필요 개입 ≤ 1 · 활동 시간 차단률 ≤ 20%
  못 맞추면 feasible: false. 맞춰도 운영 적합 판정은 하지 않는다 (operational_suitability: not_assessed).
"""

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any, Literal

import numpy as np
from pydantic import Field, model_validator

from companion_npc.adapters.case_content import canonical_sha256
from companion_npc.contracts.common import ContractModel
from companion_npc.simulation.writer import load_config, load_scenarios
from companion_npc.training.activity import diagnose_gate, gate_active
from companion_npc.training.baselines import (
    AlwaysIntervene,
    GeneratorReference,
    NeverIntervene,
    RuleBaseline,
)
from companion_npc.training.bootstrap import session_bootstrap, weighted_scores
from companion_npc.training.dataset import ExampleSet, check_label_join
from companion_npc.training.experiment import RuleGrid, dataset_stats, make_examples
from companion_npc.training.metrics import classification_metrics
from companion_npc.training.models import LgbmSpec, LogRegSpec, fit_lgbm, fit_logreg
from companion_npc.training.policy import (
    PolicyConfig,
    policy_report,
    run_policy_detailed,
)
from companion_npc.training.provenance import examples_digest, provenance
from companion_npc.training.splits import OuterFold, check_fold, leave_one_case_out
from companion_npc.training.weights import Weighting, apply_weighting, session_weights

LABELED_MODES = ("working", "exploring", "stuck")
Family = Literal["logreg", "lgbm"]


class LgbmSpecModel(ContractModel):
    num_leaves: int = Field(ge=2)
    learning_rate: float = Field(gt=0)
    n_estimators: int = Field(ge=1)
    min_child_samples: int = Field(ge=1)


class CapSetting(ContractModel):
    session: int | None = None
    puzzle: int | None = None


class PolicyGrid(ContractModel):
    cooldowns_sec: list[float] = Field(min_length=1)
    gate_cutoffs_sec: list[float | None] = Field(min_length=1)
    caps: list[CapSetting] = Field(min_length=1)
    primary_cooldown_sec: float
    primary_gate_cutoff_sec: float | None
    primary_caps: CapSetting


class DiagnosticTargets(ContractModel):
    max_unnecessary_per_10min_exploring: float
    max_active_time_blocked_share: float


class BootstrapSetting(ContractModel):
    n: int = Field(default=1000, ge=100)
    seed: int = 0


class P3BConfig(ContractModel):
    exp_id: str
    representative: Literal[False] = False
    simulation_config: str
    shifted_simulation_config: str | None = None
    seeds: list[int] = Field(min_length=1)
    sessions_per_case_archetype: int = Field(ge=1)
    inner_folds: int = Field(default=5, ge=2)
    split_seed: int
    weightings: list[Weighting] = Field(min_length=1)
    logreg_C: list[float]
    lgbm_grid: list[LgbmSpecModel]
    lgbm_threads: int = Field(default=4, ge=1)
    rule_grid: RuleGrid
    threshold_candidates: int = Field(default=99, ge=9)
    policy: PolicyGrid
    diagnostic_targets: DiagnosticTargets
    bootstrap: BootstrapSetting

    @model_validator(mode="after")
    def _grids_fixed(self) -> "P3BConfig":
        if not 5 <= len(self.logreg_C) <= 10:
            raise ValueError("logreg_C must have 5..10 candidates")
        if not 1 <= len(self.lgbm_grid) <= 20:
            raise ValueError("lgbm_grid must have at most 20 candidates")
        return self


# ── 선택 (안쪽 검증만) ──────────────────────────────────────────
def _best_threshold(
    y: np.ndarray, s: np.ndarray, w: np.ndarray, k: int
) -> tuple[float, float]:
    candidates = np.unique(np.quantile(s, np.linspace(0.01, 0.99, k)))
    best = (0.5, -1.0)
    for tau in candidates:
        f1 = weighted_scores(y, s, w, float(tau))["f1"] or 0.0
        if f1 > best[1]:
            best = (float(tau), f1)
    return best


def _oof(
    examples: ExampleSet,
    fold: OuterFold,
    weighting: Weighting,
    fit_predict,
) -> tuple[np.ndarray, np.ndarray]:
    """안쪽 폴드마다 학습 → 검증 예측. 바깥 학습의 라벨 행 전부에 대한 out-of-fold 점수."""

    rows, scores = [], []
    for inner in fold.inner:
        train = inner.train[examples.labeled[inner.train]]
        val = inner.val[examples.labeled[inner.val]]
        kept, weight = apply_weighting(examples, train, weighting)
        scores.append(fit_predict(kept, weight, val))
        rows.append(val)
    return np.concatenate(rows), np.concatenate(scores)


def _fitter(examples: ExampleSet, family: Family, spec, threads: int):
    def fit_predict(
        train: np.ndarray, weight: np.ndarray, predict_rows: np.ndarray
    ) -> np.ndarray:
        X, y = examples.X[train], examples.y[train]
        if family == "logreg":
            model = fit_logreg(X, y, weight, examples.columns, spec)
        else:
            model = fit_lgbm(X, y, weight, examples.columns, spec, threads)
        return model.predict(examples.X[predict_rows])

    return fit_predict


def select_model(
    examples: ExampleSet,
    fold: OuterFold,
    family: Family,
    weighting: Weighting,
    config: P3BConfig,
) -> dict[str, Any]:
    specs = (
        [LogRegSpec(C) for C in config.logreg_C]
        if family == "logreg"
        else [LgbmSpec(**s.model_dump()) for s in config.lgbm_grid]
    )
    trials = []
    for spec in specs:
        rows, scores = _oof(
            examples,
            fold,
            weighting,
            _fitter(examples, family, spec, config.lgbm_threads),
        )
        w = session_weights(examples, rows)
        ap = (
            weighted_scores(examples.y[rows], scores, w, 0.5)["average_precision"]
            or 0.0
        )
        trials.append((spec, ap, rows, scores))
    spec, ap, rows, scores = max(
        trials, key=lambda t: t[1]
    )  # 같으면 앞의 것(격자 순서)
    tau, f1 = _best_threshold(
        examples.y[rows],
        scores,
        session_weights(examples, rows),
        config.threshold_candidates,
    )
    return {
        "family": family,
        "weighting": weighting,
        "spec": asdict(spec),
        "spec_label": spec.label,
        "inner_average_precision": round(ap, 4),
        "threshold": round(tau, 6),
        "inner_f1_at_threshold": round(f1, 4),
        "trials": [
            {"spec": t[0].label, "inner_average_precision": round(t[1], 4)}
            for t in trials
        ],
    }


def select_rule(
    examples: ExampleSet, fold: OuterFold, config: P3BConfig
) -> dict[str, Any]:
    labeled = fold.train[
        examples.labeled[fold.train]
    ]  # 바깥 학습만 (규칙은 학습이 없다)
    w = session_weights(examples, labeled)
    trials = []
    for a in config.rule_grid.consecutive_min:
        for b in config.rule_grid.idle_min_sec:
            s = RuleBaseline(a, b).score(examples.X[labeled], examples.columns)
            f1 = weighted_scores(examples.y[labeled], s, w, 0.5)["f1"] or 0.0
            trials.append(((a, b), f1))
    (a, b), f1 = max(trials, key=lambda t: t[1])
    return {
        "family": "rule",
        "consecutive_min": a,
        "idle_min_sec": b,
        "threshold": 0.5,
        "inner_f1": round(f1, 4),
    }


# ── 평가 (바깥 테스트) ──────────────────────────────────────────
def _classification(
    examples: ExampleSet,
    rows: np.ndarray,
    scores: np.ndarray,
    tau: float,
    boot: BootstrapSetting,
) -> dict:
    labeled = examples.labeled[rows]
    r, s = rows[labeled], scores[labeled]
    w = session_weights(examples, r)
    result = classification_metrics(examples.y[r], s, w, tau)
    result["brier"] = round(weighted_scores(examples.y[r], s, w, tau)["brier"], 4)
    result["bootstrap_95ci"] = session_bootstrap(
        examples.y[r], s, w, examples.session[r], tau, n=boot.n, seed=boot.seed
    )
    return result


def _policy_grid(
    examples: ExampleSet,
    rows: np.ndarray,
    scores: np.ndarray,
    tau: float,
    config: P3BConfig,
    gate_diag: dict[str, dict],
) -> dict[str, Any]:
    targets = config.diagnostic_targets
    grid: dict[str, Any] = {}
    for gate in config.policy.gate_cutoffs_sec:
        for caps in config.policy.caps:
            for cooldown in config.policy.cooldowns_sec:
                policy = PolicyConfig(
                    threshold=tau,
                    cooldown_sec=cooldown,
                    max_per_session=caps.session,
                    max_per_puzzle=caps.puzzle,
                    gate_cutoff_sec=gate,
                )
                result = run_policy_detailed(examples, rows, scores, policy)
                report = policy_report(examples, rows, result.alerts, result.kinds)
                report["held"] = result.held
                block = gate_diag[_gate_key(gate)]["active_time_blocked_share"] or 0.0
                per10 = report["unnecessary_per_10min_exploring"]
                met = (
                    per10 is not None
                    and per10 <= targets.max_unnecessary_per_10min_exploring
                    and block <= targets.max_active_time_blocked_share
                )
                report["diagnostic"] = {
                    "unnecessary_per_10min_exploring": per10,
                    "active_time_blocked_share": block,
                    "feasible": bool(met),
                    "operational_suitability": "not_assessed",
                }
                grid[_policy_key(gate, caps, cooldown)] = report
    # 차단 없음 대비 막힘 발견 손실 (같은 상한 · cooldown)
    for gate in config.policy.gate_cutoffs_sec:
        for caps in config.policy.caps:
            for cooldown in config.policy.cooldowns_sec:
                base = grid[_policy_key(None, caps, cooldown)][
                    "stuck_episode_detection_rate"
                ]
                here = grid[_policy_key(gate, caps, cooldown)][
                    "stuck_episode_detection_rate"
                ]
                grid[_policy_key(gate, caps, cooldown)]["detection_loss_vs_no_gate"] = (
                    round(base - here, 4)
                    if base is not None and here is not None
                    else None
                )
    return grid


def _gate_key(gate: float | None) -> str:
    return "gate_none" if gate is None else f"gate_{int(gate)}s"


def _policy_key(gate: float | None, caps: CapSetting, cooldown: float) -> str:
    cap = f"cap_s{caps.session or 'none'}_p{caps.puzzle or 'none'}"
    return f"{_gate_key(gate)}|{cap}|cd{int(cooldown)}"


def primary_key(config: P3BConfig) -> str:
    p = config.policy
    return _policy_key(
        p.primary_gate_cutoff_sec, p.primary_caps, p.primary_cooldown_sec
    )


def evaluate(
    examples: ExampleSet,
    rows: np.ndarray,
    scores: np.ndarray,
    tau: float,
    config: P3BConfig,
    gate_diag: dict[str, dict],
    full: bool = True,
) -> dict[str, Any]:
    result = {
        "classification": _classification(
            examples, rows, scores, tau, config.bootstrap
        ),
    }
    if full:
        result["policy_observable"] = _policy_grid(
            examples, rows, scores, tau, config, gate_diag
        )
    # 이상 조건 (Oracle 필터) — 기본 정책만
    p = config.policy
    oracle_rows = np.isin(examples.oracle.latent_mode[rows], LABELED_MODES)
    primary = PolicyConfig(
        threshold=tau,
        cooldown_sec=p.primary_cooldown_sec,
        max_per_session=p.primary_caps.session,
        max_per_puzzle=p.primary_caps.puzzle,
        gate_cutoff_sec=p.primary_gate_cutoff_sec,
    )
    if not full:
        res = run_policy_detailed(examples, rows, scores, primary)
        result["policy_observable_primary"] = policy_report(
            examples, rows, res.alerts, res.kinds
        )
    res = run_policy_detailed(examples, rows[oracle_rows], scores[oracle_rows], primary)
    result["policy_oracle_filtered_primary"] = policy_report(
        examples, rows[oracle_rows], res.alerts, res.kinds
    )
    return result


def gate_diagnostics(
    examples: ExampleSet, rows: np.ndarray, config: P3BConfig
) -> dict[str, dict]:
    return {
        _gate_key(g): diagnose_gate(
            examples, rows, gate_active(examples.X[rows], examples.columns, g)
        )
        for g in config.policy.gate_cutoffs_sec
    }


def _final_scores(
    examples: ExampleSet,
    fold: OuterFold,
    choice: dict[str, Any],
    config: P3BConfig,
    targets: list[tuple[ExampleSet, np.ndarray]],
) -> list[np.ndarray]:
    """고른 설정으로 바깥 학습 전체(라벨 행)에 다시 학습하고 target 행들을 점수 매긴다."""

    train = fold.train[examples.labeled[fold.train]]
    kept, weight = apply_weighting(examples, train, choice["weighting"])
    X, y = examples.X[kept], examples.y[kept]
    if choice["family"] == "logreg":
        model = fit_logreg(X, y, weight, examples.columns, LogRegSpec(**choice["spec"]))
    else:
        model = fit_lgbm(
            X,
            y,
            weight,
            examples.columns,
            LgbmSpec(**choice["spec"]),
            config.lgbm_threads,
        )
    return [model.predict(ex.X[rows]) for ex, rows in targets]


def run_seed(
    config: P3BConfig, root: Path, seed: int, base, shifted, scenarios, log=print
) -> dict[str, Any]:
    sim = base.model_copy(
        update={
            "seed": seed,
            "sessions_per_case_archetype": config.sessions_per_case_archetype,
        }
    )
    examples = make_examples(sim, root, f"seed{seed}", scenarios)
    seed_result: dict[str, Any] = {
        "data_sha256": examples_digest(examples),
        "stats": dataset_stats(examples),
        "latent_mode_counts": check_label_join(examples),
        "folds": {},
    }
    shifted_examples = None
    if shifted is not None and seed == config.seeds[0]:
        shifted_sim = shifted.model_copy(
            update={
                "seed": seed,
                "sessions_per_case_archetype": config.sessions_per_case_archetype,
            }
        )
        shifted_examples = make_examples(shifted_sim, root, f"shifted_seed{seed}")
        seed_result["shifted_stats"] = dataset_stats(shifted_examples)
    reference = GeneratorReference(sim)
    for fold in leave_one_case_out(examples, config.inner_folds, config.split_seed):
        log(f"seed {seed} · test {fold.test_case}: selecting")
        leak = check_fold(examples, fold)
        # ── 1) 선택 — 안쪽 검증만 ─────────────────────────────
        selections: dict[str, dict] = {"rule": select_rule(examples, fold, config)}
        for family in ("logreg", "lgbm"):
            for weighting in config.weightings:
                selections[f"{family}[{weighting}]"] = select_model(
                    examples, fold, family, weighting, config
                )
        selection_sha = canonical_sha256(selections)
        # ── 2) 바깥 테스트 — 한 번 ─────────────────────────────
        log(f"seed {seed} · test {fold.test_case}: evaluating")
        test = fold.test
        gate_diag = gate_diagnostics(examples, test, config)
        shift_test = (
            np.flatnonzero(shifted_examples.case == fold.test_case)
            if shifted_examples is not None
            else None
        )
        shift_diag = (
            gate_diagnostics(shifted_examples, shift_test, config)
            if shifted_examples is not None
            else None
        )
        models: dict[str, Any] = {}
        for name, choice in selections.items():
            if choice["family"] == "rule":
                rule = RuleBaseline(choice["consecutive_min"], choice["idle_min_sec"])
                test_scores = rule.score(examples.X[test], examples.columns)
                shift_scores = (
                    rule.score(shifted_examples.X[shift_test], shifted_examples.columns)
                    if shifted_examples is not None
                    else None
                )
            else:
                targets = [(examples, test)] + (
                    [(shifted_examples, shift_test)]
                    if shifted_examples is not None
                    else []
                )
                out = _final_scores(examples, fold, choice, config, targets)
                test_scores, shift_scores = out[0], (out[1] if len(out) > 1 else None)
            entry = evaluate(
                examples, test, test_scores, choice["threshold"], config, gate_diag
            )
            if shift_scores is not None and (
                name == "rule" or name.endswith("[session]")
            ):
                entry["parameter_shift"] = evaluate(
                    shifted_examples,
                    shift_test,
                    shift_scores,
                    choice["threshold"],
                    config,
                    shift_diag,
                    full=False,
                )
            models[name] = entry
        for baseline in (AlwaysIntervene(), NeverIntervene()):
            s = baseline.score(examples.X[test], examples.columns)
            models[baseline.name] = evaluate(examples, test, s, 0.5, config, gate_diag)
        ref = reference.score_with_oracle(
            examples.X[test], examples.columns, examples.oracle.archetype[test]
        )
        seed_result["folds"][fold.test_case] = {
            "leak_check": leak,
            "selection": selections,
            "selection_sha256": selection_sha,
            "gate_diagnostics": gate_diag,
            "models": models,
            "generator_reference_oracle": evaluate(
                examples, test, ref, 0.5, config, gate_diag
            ),
        }
    return seed_result


def run_experiment(
    config: P3BConfig, root: Path, out_dir: Path | None = None, log=print
) -> dict[str, Any]:
    base = load_config(root / config.simulation_config)
    shifted = (
        load_config(root / config.shifted_simulation_config)
        if config.shifted_simulation_config
        else None
    )
    scenarios = load_scenarios(base, root)
    results: dict[str, Any] = {
        "exp_id": config.exp_id,
        "representative": False,
        "note": "합성 데이터의 평가 결과다. 실제 플레이어 성능이 아니며 운영 적합 판정이 아니다.",
        "config": config.model_dump(mode="json"),
        "provenance": provenance(
            config.model_dump(mode="json"),
            base,
            shifted,
            {
                c: {
                    "pack_id": s.pack.pack_id,
                    "client_content_sha256": s.pack.source.client_content_sha256,
                    "server_runtime_sha256": s.pack.source.server_runtime_sha256,
                }
                for c, s in scenarios.items()
            },
            root,
        ),
        "primary_policy": primary_key(config),
        "seeds": {},
        "completed_seeds": [],
    }
    for seed in config.seeds:
        results["seeds"][str(seed)] = run_seed(
            config, root, seed, base, shifted, scenarios, log
        )
        results["completed_seeds"].append(seed)
        if (
            out_dir is not None
        ):  # seed 마다 중간 저장 — 끊겨도 끝난 실험과 아닌 실험을 가를 수 있다
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"partial_seed{seed}.json").write_text(
                json.dumps(
                    results["seeds"][str(seed)], ensure_ascii=False, sort_keys=True
                )
                + "\n",
                encoding="utf-8",
                newline="\n",
            )
    return results
