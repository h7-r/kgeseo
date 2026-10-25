"""개입 정책 평가 — 점수를 실제처럼 시간 순서대로 개입으로 바꾼다.

[정책] (관측 가능한 값만 씀)
  점수 ≥ threshold 이고, 마지막 개입 뒤 cooldown_sec 이 지났고, 세션 상한을 넘지 않았으면 개입.

[평가] (Oracle 진단) — 개입이 어느 잠재 상태에서 일어났는지 세려고 시뮬레이터 정답을 쓴다.
  · 탐색 10분당 불필요 개입 = exploring 중 개입 / exploring 시간(분) × 10   ← 예산 지표
  · 활동 10분당 불필요 개입 = (working + exploring) 중 개입 / 그 시간 × 10
  · 막힘 에피소드 발견율 · 막힘 시작부터 첫 개입까지 (중앙값 · 90 백분위)
  · away · 종료 후 오개입 수 — 운영 로그에서는 가려낼 수 없는 위험

[두 가지 실행]
  observable       테스트 사건의 **모든** 판단 시점에 정책을 돌린다 (운영과 같은 조건)
  oracle_filtered  working·exploring·stuck 시점에만 돌린다 (자리 비움·종료를 안다고 가정한 이상적 조건)
  둘의 차이 = 종료·자리 비움을 관측하지 못해서 생기는 위험.

[한계] 합성 플레이어는 개입에 반응하지 않는다 (open loop). 개입 효과는 재지 않는다.
"""

from dataclasses import dataclass

import numpy as np

from companion_npc.training.dataset import ExampleSet

PRODUCTIVE = ("working", "exploring")


@dataclass(frozen=True)
class PolicyConfig:
    threshold: float = 0.5
    cooldown_sec: float = 60.0
    max_per_session: int | None = None


def run_policy(
    examples: ExampleSet, rows: np.ndarray, scores: np.ndarray, config: PolicyConfig
) -> np.ndarray:
    """rows 와 같은 순서의 개입 여부(bool). 세션마다 시간 순서로 판단한다."""

    alerts = np.zeros(len(rows), dtype=bool)
    # 임계값을 넘는 후보만 시간 순서로 본다 (나머지는 개입할 수 없다)
    candidates = np.flatnonzero(scores >= config.threshold)
    order = candidates[
        np.lexsort(
            (
                examples.t[rows[candidates]],
                examples.session[rows[candidates]].astype(str),
            )
        )
    ]
    last_session, last_alert, count = None, -np.inf, 0
    for position in order:
        row = rows[position]
        session = examples.session[row]
        if session != last_session:
            last_session, last_alert, count = session, -np.inf, 0
        if examples.t[row] - last_alert < config.cooldown_sec:
            continue
        if config.max_per_session is not None and count >= config.max_per_session:
            continue
        alerts[position] = True
        last_alert, count = examples.t[row], count + 1
    return alerts


def _minutes(examples: ExampleSet, sessions: set[str], modes: tuple[str, ...]) -> float:
    total = 0.0
    for sid in sessions:
        output = examples.sessions[sid]
        end = min(output.truth.observation_end, output.truth.ended_at)
        for seg in output.segments:
            if seg.mode in modes and seg.start < end:
                total += (min(seg.end, end) - seg.start).total_seconds()
    return total / 60


def policy_report(examples: ExampleSet, rows: np.ndarray, alerts: np.ndarray) -> dict:
    modes = examples.oracle.latent_mode[rows]
    sessions = set(examples.session[rows].tolist())
    alert_rows = rows[alerts]
    by_mode = {
        m: int(np.sum(alerts & (modes == m)))
        for m in ("working", "exploring", "stuck", "away", "post_end")
    }
    explore_min = _minutes(examples, sessions, ("exploring",))
    active_min = _minutes(examples, sessions, PRODUCTIVE)

    # 막힘 에피소드 — 관측 종료 전에 시작한 stuck 구간
    alert_times: dict[str, list[float]] = {}
    for row in alert_rows:
        alert_times.setdefault(examples.session[row], []).append(examples.t[row])
    point_times: dict[str, list[float]] = {}
    for row in rows:
        point_times.setdefault(examples.session[row], []).append(examples.t[row])
    episodes = detectable = detected = 0
    latencies = []
    for sid in sessions:
        output = examples.sessions[sid]
        end = min(output.truth.observation_end, output.truth.ended_at)
        times = np.array(alert_times.get(sid, []))
        points = np.array(point_times.get(sid, []))
        for seg in output.segments:
            if seg.mode != "stuck" or seg.start >= end:
                continue
            start, stop = seg.start.timestamp(), min(seg.end, end).timestamp()
            episodes += 1
            detectable += bool(np.any((points >= start) & (points < stop)))
            hits = times[(times >= start) & (times < stop)]
            if hits.size:
                detected += 1
                latencies.append(float(hits.min() - start))
    per10 = lambda n, minutes: round(n / minutes * 10, 4) if minutes > 0 else None  # noqa: E731
    return {
        "sessions": len(sessions),
        "decision_points": int(len(rows)),
        "alerts": int(alerts.sum()),
        "alerts_per_session": round(float(alerts.sum()) / len(sessions), 4)
        if sessions
        else None,
        "alerts_by_latent_mode": by_mode,
        "exploring_minutes": round(explore_min, 1),
        "unnecessary_per_10min_exploring": per10(by_mode["exploring"], explore_min),
        "unnecessary_per_10min_active": per10(
            by_mode["working"] + by_mode["exploring"], active_min
        ),
        "away_alerts": by_mode["away"],
        "post_termination_alerts": by_mode["post_end"],
        "stuck_episodes": episodes,
        "stuck_episodes_with_decision_point": detectable,
        "stuck_episode_detection_rate": round(detected / episodes, 4)
        if episodes
        else None,
        "latency_to_first_alert_sec": {
            "median": round(float(np.median(latencies)), 1) if latencies else None,
            "p90": round(float(np.percentile(latencies, 90)), 1) if latencies else None,
        },
    }
