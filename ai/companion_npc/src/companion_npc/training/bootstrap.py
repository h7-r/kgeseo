"""세션 단위 부트스트랩 신뢰구간.

연속 tick 을 독립 표본으로 보지 않는다 — 세션을 복원 추출하고, 뽑힌 횟수만큼 그 세션의
모든 행 가중치를 곱한다(행을 복사하지 않는다). 기본 1,000회 · 95% 백분위 구간.
"""

import numpy as np
from sklearn.metrics import average_precision_score


def weighted_scores(
    y: np.ndarray, score: np.ndarray, weight: np.ndarray, threshold: float
) -> dict[str, float | None]:
    pred = score >= threshold
    pos = y == 1
    tp, fp = weight[pred & pos].sum(), weight[pred & ~pos].sum()
    fn = weight[~pred & pos].sum()
    precision = tp / (tp + fp) if tp + fp > 0 else None
    recall = tp / (tp + fn) if tp + fn > 0 else None
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision and recall
        else (0.0 if precision is not None and recall is not None else None)
    )
    keep = weight > 0
    ap = (
        float(
            average_precision_score(pos[keep], score[keep], sample_weight=weight[keep])
        )
        if 0 < pos[keep].sum() < keep.sum()
        else None
    )
    brier = float(np.sum(weight * (score - y) ** 2) / weight.sum())
    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "average_precision": ap,
        "brier": brier,
    }


def session_bootstrap(
    y: np.ndarray,
    score: np.ndarray,
    weight: np.ndarray,
    sessions: np.ndarray,
    threshold: float,
    n: int = 1000,
    seed: int = 0,
) -> dict[str, list[float] | None]:
    _, inverse = np.unique(sessions.astype(str), return_inverse=True)
    n_sessions = inverse.max() + 1
    rng = np.random.default_rng(seed)
    draws: dict[str, list[float]] = {}
    for _ in range(n):
        picked = np.bincount(
            rng.integers(0, n_sessions, n_sessions), minlength=n_sessions
        )
        result = weighted_scores(y, score, weight * picked[inverse], threshold)
        for key, value in result.items():
            if value is not None:
                draws.setdefault(key, []).append(value)
    return {
        key: [
            round(float(np.percentile(v, 2.5)), 4),
            round(float(np.percentile(v, 97.5)), 4),
        ]
        if len(v) >= n * 0.9
        else None
        for key, v in draws.items()
    }
