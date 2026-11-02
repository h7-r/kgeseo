"""P3-A 기준선 실험.

  seed 마다: 합성 데이터 생성 → P2-B 파이프라인 → ExampleSet → 라벨 결합 검사
           → leave-one-case-out (+ 안쪽 세션 GroupKFold) → 누수 검사
           → 규칙 기준선 (a, b) 를 안쪽 검증에서만 선택 → 바깥 테스트 사건 평가
  매개변수 이동: 기본 설정에서 고른 규칙을, 매개변수를 바꾼 시뮬레이터 데이터의 같은 테스트 사건에 적용

[보고 구분]
  classification         라벨 있는 테스트 행, 세션 가중치 (cooldown 없음)
  policy.observable      테스트 사건의 모든 판단 시점 (운영 가능 조건)
  policy.oracle_filtered working·exploring·stuck 시점만 (이상적 조건, Oracle 필터)
  generator_reference    Oracle 참고 — 운영 가능 평가와 섞지 않는다
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import numpy as np
from pydantic import Field

from companion_npc.contracts.common import ContractModel
from companion_npc.features.config import FeatureConfig
from companion_npc.simulation.config import SimulationConfig
from companion_npc.simulation.writer import generate, load_config, load_scenarios
from companion_npc.training.baselines import (
    AlwaysIntervene,
    GeneratorReference,
    NeverIntervene,
    RuleBaseline,
)
from companion_npc.training.dataset import ExampleSet, build_examples, check_label_join
from companion_npc.training.metrics import classification_metrics
from companion_npc.training.policy import PolicyConfig, policy_report, run_policy
from companion_npc.training.provenance import examples_digest, provenance
from companion_npc.training.splits import OuterFold, check_fold, leave_one_case_out
from companion_npc.training.weights import Weighting, apply_weighting, session_weights

LABELED_MODES = ("working", "exploring", "stuck")


class RuleGrid(ContractModel):
    consecutive_min: list[int] = Field(min_length=1)
    idle_min_sec: list[float] = Field(min_length=1)


class P3AConfig(ContractModel):
    exp_id: str
    representative: Literal[False] = False
    simulation_config: str  # ai/companion_npc 기준 상대 경로
    shifted_simulation_config: str | None = None
    seeds: list[int] = Field(min_length=1)
    sessions_per_case_archetype: int = Field(ge=1)
    inner_folds: int = Field(default=5, ge=2)
    split_seed: int
    weighting: list[Weighting]
    cooldowns_sec: list[float] = Field(min_length=1)
    primary_cooldown_sec: float
    max_interventions_per_session: int | None = None
    budget_per_10min_exploring: float = Field(gt=0)
    rule_grid: RuleGrid


# ── 데이터 ─────────────────────────────────────────────────────
def make_examples(
    sim: SimulationConfig, root: Path, dataset_id: str, scenarios=None
) -> ExampleSet:
    scenarios = scenarios or load_scenarios(sim, root)
    dataset = generate(sim, scenarios)
    return build_examples(dataset_id, dataset.outputs, scenarios, FeatureConfig())


def dataset_stats(examples: ExampleSet) -> dict[str, Any]:
    """학습에 쓸 수 있는 행과 제외 사유 — 사유는 상호 배타, 합 = 전체."""

    status = examples.oracle.final_status
    mode = examples.oracle.latent_mode
    post = status == "post_termination"
    away = ~post & (mode == "away")
    usable = examples.labeled
    reasons = {
        "usable_for_synthetic_needs_help": int(usable.sum()),
        "excluded_post_termination": int(post.sum()),
        "excluded_away": int(away.sum()),
        "excluded_other": int(len(examples) - usable.sum() - post.sum() - away.sum()),
    }
    return {
        "decision_points": len(examples),
        "rows_by_reason": reasons,
        "sum_check": sum(reasons.values()) == len(examples),
        "usable_positive": int(np.nansum(examples.y)),
        # 대리 라벨 비교에는 censored 행이 더 빠진다 (주 라벨 학습에는 쓸 수 있다)
        "usable_but_proxy_censored": int((usable & np.isnan(examples.proxy)).sum()),
        "sessions": len(examples.sessions),
    }


# ── 평가 ─────────────────────────────────────────────────────
def _evaluate(
    examples: ExampleSet,
    rows: np.ndarray,
    scores_all: np.ndarray,
    config: P3AConfig,
) -> dict[str, Any]:
    """rows 에 대한 분류 지표 + 정책 지표 (observable · oracle_filtered × cooldown)."""

    labeled = rows[examples.labeled[rows]]
    result: dict[str, Any] = {
        "classification": classification_metrics(
            examples.y[labeled],
            scores_all[labeled],
            session_weights(examples, labeled),
        ),
        "policy": {},
    }
    oracle_rows = rows[np.isin(examples.oracle.latent_mode[rows], LABELED_MODES)]
    for cooldown in config.cooldowns_sec:
        policy = PolicyConfig(
            cooldown_sec=cooldown, max_per_session=config.max_interventions_per_session
        )
        key = f"cooldown_{int(cooldown)}s"
        result["policy"][key] = {}
        for view, view_rows in (("observable", rows), ("oracle_filtered", oracle_rows)):
            alerts = run_policy(examples, view_rows, scores_all[view_rows], policy)
            report = policy_report(examples, view_rows, alerts)
            per10 = report["unnecessary_per_10min_exploring"]
            report["within_budget"] = (
                per10 is not None and per10 <= config.budget_per_10min_exploring
            )
            result["policy"][key][view] = report
    return result


@dataclass(frozen=True)
class RuleChoice:
    consecutive_min: int
    idle_min_sec: float
    inner_f1: float | None
    inner_unnecessary_per_10min: float | None
    feasible: bool


def tune_rule(
    examples: ExampleSet, fold: OuterFold, weighting: Weighting, config: P3AConfig
) -> RuleChoice:
    """안쪽 검증에서만 고른다. 예산을 지키는 조합 중 가중 F1 최대, 없으면 예산 초과가 가장 작은 것."""

    policy = PolicyConfig(
        cooldown_sec=config.primary_cooldown_sec,
        max_per_session=config.max_interventions_per_session,
    )
    candidates = []
    for a in config.rule_grid.consecutive_min:
        for b in config.rule_grid.idle_min_sec:
            rule = RuleBaseline(consecutive_min=a, idle_min_sec=b)
            f1s, budgets = [], []
            for inner in fold.inner:
                scores = rule.score(examples.X[inner.val], examples.columns)
                labeled_mask = examples.labeled[inner.val]
                kept, weight = apply_weighting(
                    examples, inner.val[labeled_mask], weighting
                )
                kept_scores = rule.score(examples.X[kept], examples.columns)
                f1 = classification_metrics(examples.y[kept], kept_scores, weight)["f1"]
                f1s.append(f1 or 0.0)
                # 예산은 관측 가능 조건(모든 시점)에서 잰다
                alerts = run_policy(examples, inner.val, scores, policy)
                per10 = policy_report(examples, inner.val, alerts)[
                    "unnecessary_per_10min_exploring"
                ]
                budgets.append(per10 if per10 is not None else 0.0)
            mean_f1, mean_budget = float(np.mean(f1s)), float(np.mean(budgets))
            candidates.append((a, b, mean_f1, mean_budget))
    feasible = [c for c in candidates if c[3] <= config.budget_per_10min_exploring]
    if feasible:
        a, b, f1, budget = max(feasible, key=lambda c: (c[2], -c[3]))
    else:
        a, b, f1, budget = min(candidates, key=lambda c: (c[3], -c[2]))
    return RuleChoice(a, b, round(f1, 4), round(budget, 4), bool(feasible))


def run_experiment(config: P3AConfig, root: Path) -> dict[str, Any]:
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
        "note": "합성 데이터의 기능 검증 결과다. 실제 플레이어 성능이 아니다.",
        "config": config.model_dump(mode="json"),
        "provenance": provenance(
            config.model_dump(mode="json"),
            base,
            shifted,
            {
                case_id: {
                    "pack_id": s.pack.pack_id,
                    "client_content_sha256": s.pack.source.client_content_sha256,
                    "server_runtime_sha256": s.pack.source.server_runtime_sha256,
                }
                for case_id, s in scenarios.items()
            },
            root,
        ),
        "seeds": {},
    }
    for seed in config.seeds:
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
        reference = GeneratorReference(sim)
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
        for fold in leave_one_case_out(examples, config.inner_folds, config.split_seed):
            fold_result: dict[str, Any] = {
                "leak_check": check_fold(examples, fold),
                "baselines": {},
            }
            for baseline in (AlwaysIntervene(), NeverIntervene()):
                scores = baseline.score(examples.X, examples.columns)
                fold_result["baselines"][baseline.name] = _evaluate(
                    examples, fold.test, scores, config
                )
            for weighting in config.weighting:
                choice = tune_rule(examples, fold, weighting, config)
                rule = RuleBaseline(choice.consecutive_min, choice.idle_min_sec)
                scores = rule.score(examples.X, examples.columns)
                entry = _evaluate(examples, fold.test, scores, config)
                entry["selected"] = choice.__dict__
                if shifted_examples is not None and weighting == "session":
                    test = np.flatnonzero(shifted_examples.case == fold.test_case)
                    shifted_scores = rule.score(
                        shifted_examples.X, shifted_examples.columns
                    )
                    entry["parameter_shift"] = _evaluate(
                        shifted_examples, test, shifted_scores, config
                    )
                fold_result["baselines"][f"rule[{weighting}]"] = entry
            ref_scores = reference.score_with_oracle(
                examples.X, examples.columns, examples.oracle.archetype
            )
            fold_result["generator_reference"] = _evaluate(
                examples, fold.test, ref_scores, config
            )
            seed_result["folds"][fold.test_case] = fold_result
        results["seeds"][str(seed)] = seed_result
    return results
