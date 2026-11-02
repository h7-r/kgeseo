"""실험 결과 → 사람이 읽는 표 (markdown). 첫 줄에 늘 합성 데이터 경고를 넣는다."""

from typing import Any

WARNING = (
    "> **합성 데이터 · representative: false · 실제 플레이어 성능이 아니다.** "
    "라벨은 시뮬레이터 정답(`synthetic_needs_help`)이며 사람의 판단(`needs_help`)이 아니다."
)


def _fmt(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.3f}"
    return str(value)


def render(results: dict[str, Any], primary_cooldown: float) -> str:
    key = f"cooldown_{int(primary_cooldown)}s"
    lines = [WARNING, "", f"# {results['exp_id']} — 기준선", ""]
    for seed, seed_result in results["seeds"].items():
        stats = seed_result["stats"]
        lines += [
            f"## seed {seed}",
            "",
            f"판단 시점 {stats['decision_points']:,} · 학습 가능 {stats['rows_by_reason']['usable_for_synthetic_needs_help']:,}"
            f" · 종료 후 {stats['rows_by_reason']['excluded_post_termination']:,}"
            f" · away {stats['rows_by_reason']['excluded_away']:,}",
            "",
            "| 테스트 사건 | 기준선 | P | R | F1 | AP | FDR | FPR | 탐색10분당 불필요(관측/Oracle) | 막힘 발견율 | 첫 개입(중앙값 s) | 세션당 개입 | away 오개입 | 종료 후 오개입 |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        for case, fold in seed_result["folds"].items():
            entries = list(fold["baselines"].items()) + [
                ("generator_reference*", fold["generator_reference"])
            ]
            for name, entry in entries:
                c = entry["classification"]
                obs = entry["policy"][key]["observable"]
                ora = entry["policy"][key]["oracle_filtered"]
                lines.append(
                    f"| {case} | {name} | {_fmt(c['precision'])} | {_fmt(c['recall'])} | {_fmt(c['f1'])}"
                    f" | {_fmt(c['average_precision'])} | {_fmt(c['false_discovery_rate'])} | {_fmt(c['false_positive_rate'])}"
                    f" | {_fmt(obs['unnecessary_per_10min_exploring'])} / {_fmt(ora['unnecessary_per_10min_exploring'])}"
                    f" | {_fmt(obs['stuck_episode_detection_rate'])} | {_fmt(obs['latency_to_first_alert_sec']['median'])}"
                    f" | {_fmt(obs['alerts_per_session'])} | {obs['away_alerts']} | {obs['post_termination_alerts']} |"
                )
        lines += [
            "",
            "\\* `generator_reference` 는 Oracle(유형)을 쓰는 참고 기준선이다. 성능 상한선이 아니며 운영 가능 평가가 아니다.",
            "",
        ]
    return "\n".join(lines) + "\n"
