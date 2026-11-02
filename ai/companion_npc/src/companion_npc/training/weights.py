"""표본 가중치 · tick 솎아 내기. 둘 다 관측 가능한 값(세션 ID · 마지막 상호작용 뒤 경과)만 쓴다.

session  세션마다 합이 1 — 판단 시점이 많은 세션이 결과를 지배하지 않게 (기본)
thin60   이벤트 직후 시점 + 60초마다의 tick 만 남기고 같은 무게
thin90   이벤트 직후 시점 + 90초마다의 tick 만 남기고 같은 무게
none     모든 행을 같은 무게로 (비교용)
"""

from typing import Literal

import numpy as np

from companion_npc.training.dataset import ExampleSet

Weighting = Literal["session", "thin60", "thin90", "none"]
TICK_SEC = 30.0  # FeatureConfig.decision_interval_sec 기본값
_STRIDE = {"thin60": 2, "thin90": 3}


def session_weights(examples: ExampleSet, rows: np.ndarray) -> np.ndarray:
    sessions = examples.session[rows]
    _, inverse, counts = np.unique(
        sessions.astype(str), return_inverse=True, return_counts=True
    )
    return 1.0 / counts[inverse]


def thin_mask(examples: ExampleSet, rows: np.ndarray, stride: int) -> np.ndarray:
    since = examples.X[rows, examples.columns.index("since_last_interaction_sec")]
    tick_no = np.rint(np.nan_to_num(since, nan=0.0) / TICK_SEC)
    return (tick_no % stride == 0) | np.isnan(since)


def apply_weighting(
    examples: ExampleSet, rows: np.ndarray, weighting: Weighting
) -> tuple[np.ndarray, np.ndarray]:
    """(남길 행, 가중치)."""

    if weighting == "session":
        return rows, session_weights(examples, rows)
    if weighting == "none":
        return rows, np.ones(len(rows))
    kept = rows[thin_mask(examples, rows, _STRIDE[weighting])]
    return kept, np.ones(len(kept))
