"""분류 지표 — 판단 시점 하나하나를 맞혔나 (cooldown·횟수 제한 없음).

정책 지표(policy.py)와 따로 보고한다. 양성 = synthetic_needs_help == 1.
"""

import numpy as np
from sklearn.metrics import average_precision_score


def _ratio(a: float, b: float) -> float | None:
    return round(a / b, 4) if b > 0 else None


def classification_metrics(
    y: np.ndarray, score: np.ndarray, weight: np.ndarray, threshold: float = 0.5
) -> dict:
    """y·score·weight 는 같은 길이, y 에 NaN 이 없어야 한다 (라벨 있는 행만 넘긴다)."""

    if np.isnan(y).any():
        raise ValueError("pass labeled rows only")
    pred = score >= threshold
    pos = y == 1
    tp = float(weight[pred & pos].sum())
    fp = float(weight[pred & ~pos].sum())
    fn = float(weight[~pred & pos].sum())
    tn = float(weight[~pred & ~pos].sum())
    precision, recall = _ratio(tp, tp + fp), _ratio(tp, tp + fn)
    f1 = (
        round(2 * precision * recall / (precision + recall), 4)
        if precision and recall
        else (0.0 if precision is not None and recall is not None else None)
    )
    ap = (
        round(float(average_precision_score(pos, score, sample_weight=weight)), 4)
        if 0 < pos.sum() < len(pos)
        else None
    )
    return {
        "rows": int(len(y)),
        "positives": int(pos.sum()),
        "positive_rate_weighted": _ratio(float(weight[pos].sum()), float(weight.sum())),
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "false_discovery_rate": _ratio(fp, tp + fp),
        "false_positive_rate": _ratio(fp, fp + tn),
        "average_precision": ap,
        "threshold": threshold,
    }
