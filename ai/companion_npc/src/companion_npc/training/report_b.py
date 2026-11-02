"""P3-B 결과 → 보고서(markdown) · 커밋용 요약(metrics.json)."""

import hashlib
from pathlib import Path
from typing import Any

from companion_npc.training.report import WARNING

MODEL_ORDER = (
    "rule",
    "logreg[session]",
    "logreg[thin60]",
    "logreg[thin90]",
    "logreg[none]",
    "lgbm[session]",
    "lgbm[thin60]",
    "lgbm[thin90]",
    "lgbm[none]",
    "always_intervene",
    "never_intervene",
)
POLICY_FIELDS = (
    "alerts_per_session",
    "unnecessary_per_10min_exploring",
    "unnecessary_per_10min_active",
    "post_termination_alerts",
    "post_termination_alert_share",
    "away_alerts",
    "stuck_episode_detection_rate",
    "alerts_by_kind",
)


def _f(v: Any, digits: int = 3) -> str:
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:.{digits}f}"
    return str(v)


def _ci(c: dict, key: str) -> str:
    ci = (c.get("bootstrap_95ci") or {}).get(key)
    return (
        f"{_f(c.get(key) if key != 'brier' else c['brier'])} [{_f(ci[0])}, {_f(ci[1])}]"
        if ci
        else _f(c.get(key))
    )


def _policy_core(rep: dict) -> dict:
    core = {k: rep.get(k) for k in POLICY_FIELDS}
    core["latency_median_sec"] = rep["latency_to_first_alert_sec"]["median"]
    if "diagnostic" in rep:
        core["diagnostic"] = rep["diagnostic"]
    if "detection_loss_vs_no_gate" in rep:
        core["detection_loss_vs_no_gate"] = rep["detection_loss_vs_no_gate"]
    return core


def _policy_brief(rep: dict) -> dict:
    return {
        "alerts_per_session": rep["alerts_per_session"],
        "unnecessary_per_10min_exploring": rep["unnecessary_per_10min_exploring"],
        "post_termination_alert_share": rep.get("post_termination_alert_share"),
        "away_alerts": rep["away_alerts"],
        "stuck_episode_detection_rate": rep["stuck_episode_detection_rate"],
        "detection_loss_vs_no_gate": rep.get("detection_loss_vs_no_gate"),
        "feasible": rep["diagnostic"]["feasible"] if "diagnostic" in rep else None,
    }


def summary_policy_keys(results: dict) -> list[str]:
    cfg = results["config"]["policy"]
    caps = cfg["primary_caps"]
    cap = f"cap_s{caps['session'] or 'none'}_p{caps['puzzle'] or 'none'}"
    cd = int(cfg["primary_cooldown_sec"])
    keys = [
        f"{'gate_none' if g is None else f'gate_{int(g)}s'}|{cap}|cd{cd}"
        for g in cfg["gate_cutoffs_sec"]
    ]
    for c in cfg["caps"]:
        alt = f"cap_s{c['session'] or 'none'}_p{c['puzzle'] or 'none'}"
        for cooldown in cfg["cooldowns_sec"]:
            keys.append(f"gate_none|{alt}|cd{int(cooldown)}")
    return list(dict.fromkeys(keys))


# 정책 비교 7조합을 요약에 남길 모델 — 나머지는 분류 지표와 기본 정책만 (전체는 원본 results.json)
DETAILED = ("rule", "logreg[session]", "lgbm[session]", "generator_reference_oracle")


def _entry_summary(entry: dict, keys: list[str], detailed: bool = True) -> dict:
    c = entry["classification"]
    ci = c.get("bootstrap_95ci") or {}
    out: dict[str, Any] = {
        "classification": {
            k: c.get(k)
            for k in (
                "precision",
                "recall",
                "f1",
                "average_precision",
                "false_discovery_rate",
                "false_positive_rate",
                "brier",
                "threshold",
            )
        }
        | {
            "bootstrap_95ci": ci
            if detailed
            else {k: ci.get(k) for k in ("f1", "average_precision")}
        },
    }
    if detailed:
        out["policy_oracle_filtered_primary"] = _policy_core(
            entry["policy_oracle_filtered_primary"]
        )
    if "policy_observable" in entry:
        # 기본 정책(keys[0])은 모든 필드, 비교 조합은 핵심 필드만
        out["policy_observable"] = {
            k: _policy_core(entry["policy_observable"][k])
            if i == 0
            else _policy_brief(entry["policy_observable"][k])
            for i, k in enumerate(keys)
        }
    if "policy_observable_primary" in entry:
        out["policy_observable_primary"] = _policy_core(
            entry["policy_observable_primary"]
        )
    if "parameter_shift" in entry and detailed:
        out["parameter_shift"] = _entry_summary(
            entry["parameter_shift"], keys[:1], False
        )
    return out


def metrics_summary(results: dict, raw_path: Path) -> dict:
    keys = summary_policy_keys(results)
    seeds = {}
    for seed, s in results["seeds"].items():
        seeds[seed] = {
            "data_sha256": s["data_sha256"],
            "stats": s["stats"],
            "folds": {
                case: {
                    "leak_check": f["leak_check"],
                    "selection_sha256": f["selection_sha256"],
                    "selection": {
                        k: {kk: vv for kk, vv in v.items() if kk != "trials"}
                        for k, v in f["selection"].items()
                    },
                    "gate_diagnostics": f["gate_diagnostics"],
                    # keys[0] = 기본 정책. 나머지 6조합은 DETAILED 모델에만 남긴다
                    "models": {
                        k: (
                            _entry_summary(v, keys)
                            if k in DETAILED
                            else _entry_summary(v, keys[:1], detailed=False)
                        )
                        for k, v in f["models"].items()
                    },
                    "generator_reference_oracle": _entry_summary(
                        f["generator_reference_oracle"], keys
                    ),
                }
                for case, f in s["folds"].items()
            },
        }
    return {
        "exp_id": results["exp_id"],
        "representative": False,
        "note": results["note"],
        "oracle_note": "generator_reference_oracle 는 Oracle(유형)을 쓰는 참고 결과다. 운영에 적용할 수 없고 상한선이 아니다.",
        "diagnostic_note": "diagnostic.feasible 은 합성 잠재 상태에 의존하는 사후 진단이다. 운영 제약·운영 적합 판정이 아니다.",
        "config": results["config"],
        "provenance": results["provenance"],
        "primary_policy": results["primary_policy"],
        "summary_policy_keys": keys,
        "completed_seeds": results["completed_seeds"],
        "raw_results": {
            "path": f"runs/p3/{results['exp_id']}/results.json (깃 제외)",
            "sha256": hashlib.sha256(raw_path.read_bytes()).hexdigest(),
        },
        "seeds": seeds,
    }


def render(results: dict) -> str:
    primary = results["primary_policy"]
    keys = summary_policy_keys(results)
    lines = [
        WARNING,
        "",
        f"# {results['exp_id']} — 모델 비교",
        "",
        f"완료한 seed: {results['completed_seeds']} · 기본 정책 `{primary}`",
        "",
    ]
    for seed, s in results["seeds"].items():
        st = s["stats"]["rows_by_reason"]
        lines += [
            f"## seed {seed}",
            "",
            f"학습 가능 {st['usable_for_synthetic_needs_help']:,} · 종료 후 제외 {st['excluded_post_termination']:,} · away 제외 {st['excluded_away']:,}",
            "",
        ]
        lines += [
            "### 분류 지표 (바깥 테스트 · 세션 가중 · [세션 부트스트랩 95% 구간])",
            "",
            "| 테스트 사건 | 모델 | 선택 | τ | P | R | F1 | AP | FDR | FPR | Brier |",
            "|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        for case, f in s["folds"].items():
            entries = [(m, f["models"][m]) for m in MODEL_ORDER if m in f["models"]] + [
                ("generator_reference*", f["generator_reference_oracle"])
            ]
            for name, e in entries:
                c = e["classification"]
                sel = f["selection"].get(name, {})
                label = sel.get("spec_label") or (
                    f"a={sel['consecutive_min']},b={int(sel['idle_min_sec'])}"
                    if "consecutive_min" in sel
                    else ""
                )
                lines.append(
                    f"| {case} | {name} | {label} | {_f(c['threshold'])} | {_ci(c, 'precision')} | {_ci(c, 'recall')} | {_ci(c, 'f1')} | {_ci(c, 'average_precision')} | {_f(c['false_discovery_rate'])} | {_f(c['false_positive_rate'])} | {_ci(c, 'brier')} |"
                )
        lines += [
            "",
            "### 정책 지표 — 기본 정책 (관측 가능 조건)",
            "",
            "| 테스트 사건 | 모델 | 세션당 개입 | 탐색10분당 불필요 | 활동10분당 불필요 | 종료 후 개입(비율) | away 개입 | 막힘 발견율 | 첫 개입 중앙값 s | 진단 feasible |",
            "|---|---|---|---|---|---|---|---|---|---|",
        ]
        for case, f in s["folds"].items():
            entries = [(m, f["models"][m]) for m in MODEL_ORDER if m in f["models"]] + [
                ("generator_reference*", f["generator_reference_oracle"])
            ]
            for name, e in entries:
                p = e["policy_observable"][primary]
                lines.append(
                    f"| {case} | {name} | {_f(p['alerts_per_session'])} | {_f(p['unnecessary_per_10min_exploring'])} | {_f(p['unnecessary_per_10min_active'])}"
                    f" | {p['post_termination_alerts']} ({_f(p['post_termination_alert_share'])}) | {p['away_alerts']} | {_f(p['stuck_episode_detection_rate'])}"
                    f" | {_f(p['latency_to_first_alert_sec']['median'], 1)} | {p['diagnostic']['feasible']} |"
                )
        lines += [
            "",
            "### ActivityGate (모델과 무관 · Oracle 사후 진단)",
            "",
            "| 테스트 사건 | 차단 | 활동 차단률 | 탐색 차단률 | 장시간 탐색형 활동 차단률 | 종료 후 탐지율 | away 탐지율 | 차단 정밀도 |",
            "|---|---|---|---|---|---|---|---|",
        ]
        for case, f in s["folds"].items():
            for gate, d in f["gate_diagnostics"].items():
                lines.append(
                    f"| {case} | {gate} | {_f(d['active_time_blocked_share'])} | {_f(d['exploring_blocked_share'])} | {_f(d['active_time_blocked_share_by_archetype'].get('long_explorer'))}"
                    f" | {_f(d['post_termination_recall'])} | {_f(d['away_recall'])} | {_f(d['block_precision'])} |"
                )
        lines += [
            "",
            "### 정책 비교 — lgbm[session] (관측 가능 조건)",
            "",
            "| 테스트 사건 | 정책 | 세션당 개입 | 탐색10분당 불필요 | 종료 후 비율 | away 개입 | 막힘 발견율 | 발견 손실(차단 없음 대비) | 진단 feasible |",
            "|---|---|---|---|---|---|---|---|---|",
        ]
        for case, f in s["folds"].items():
            grid = f["models"]["lgbm[session]"]["policy_observable"]
            for key in keys:
                p = grid[key]
                lines.append(
                    f"| {case} | {key} | {_f(p['alerts_per_session'])} | {_f(p['unnecessary_per_10min_exploring'])} | {_f(p['post_termination_alert_share'])} | {p['away_alerts']}"
                    f" | {_f(p['stuck_episode_detection_rate'])} | {_f(p['detection_loss_vs_no_gate'])} | {p['diagnostic']['feasible']} |"
                )
        if any(
            "parameter_shift" in e
            for f in s["folds"].values()
            for e in f["models"].values()
        ):
            lines += [
                "",
                "### 매개변수 이동 (기본 설정에서 고른 모델 → 이동 설정 데이터의 같은 사건)",
                "",
                "| 테스트 사건 | 모델 | F1 기본 → 이동 | AP 기본 → 이동 | 탐색10분당 불필요 기본 → 이동 |",
                "|---|---|---|---|---|",
            ]
            for case, f in s["folds"].items():
                for name, e in f["models"].items():
                    if "parameter_shift" not in e:
                        continue
                    a, b = e["classification"], e["parameter_shift"]["classification"]
                    pa = e["policy_observable"][primary][
                        "unnecessary_per_10min_exploring"
                    ]
                    pb = e["parameter_shift"]["policy_observable_primary"][
                        "unnecessary_per_10min_exploring"
                    ]
                    lines.append(
                        f"| {case} | {name} | {_f(a['f1'])} → {_f(b['f1'])} | {_f(a['average_precision'])} → {_f(b['average_precision'])} | {_f(pa)} → {_f(pb)} |"
                    )
        lines += [
            "",
            "\\* `generator_reference` 는 Oracle(유형)을 쓰는 참고 결과다. 상한선이 아니고 운영에 적용할 수 없다.",
            "진단 feasible 은 합성 잠재 상태에 의존하는 사후 진단(탐색 10분당 ≤1 · 활동 차단률 ≤20%)이다. 운영 적합 판정이 아니다.",
            "",
        ]
    return "\n".join(lines) + "\n"
