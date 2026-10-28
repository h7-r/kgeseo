"""ActivityGate — 「지금 플레이 중인가」를 관측 가능한 값만으로 어림한다.

[운영 쪽] gate_active
  입력은 since_last_interaction_sec (마지막 서버 이벤트 뒤 경과) 하나뿐이다.
  cutoff_sec 를 넘으면 비활성으로 보고 개입하지 않는다. None 이면 차단하지 않는다.
  값이 없으면(NaN — 창 안에 이벤트가 없음) 비활성으로 본다 (보수적으로).
  ★ Oracle(종료 시각 · away 구간)은 인자로 받지 않는다.

[진단 쪽] diagnose_gate  (Oracle 사후 진단 — 운영 정책의 입력이 아니다)
  · 활동 차단률 = working·exploring·stuck 판단 시점 중 막은 비율 (판단 시점은 30초 간격이라 시간에 비례)
  · 비활성 탐지 = away·종료 후 시점 중 막은 비율(재현율) · 막은 시점 중 실제 비활성 비율(정밀도)
  · 유형별 활동 차단률 — 장시간 탐색형이 잘못 막히는지

[한계] 이 차단은 종료 후 개입을 **줄일 뿐 없애지 못한다**. 종료 직후 cutoff 까지는 막지 못하고,
       cutoff 보다 짧은 자리 비움도 못 막는다. 실제 종료·일시정지 이벤트는 backend 계약 변경(합의 #19)이다.
"""

import numpy as np

from companion_npc.training.dataset import ExampleSet

ACTIVE_MODES = ("working", "exploring", "stuck")
INACTIVE_MODES = ("away", "post_end")


def gate_active(
    X: np.ndarray, columns: tuple[str, ...], cutoff_sec: float | None
) -> np.ndarray:
    since = X[:, columns.index("since_last_interaction_sec")]
    if cutoff_sec is None:
        return np.ones(len(X), dtype=bool)
    with np.errstate(invalid="ignore"):
        return ~np.isnan(since) & (since <= cutoff_sec)


def _share(part: np.ndarray, whole: np.ndarray) -> float | None:
    n = int(whole.sum())
    return round(float((part & whole).sum()) / n, 4) if n else None


def diagnose_gate(examples: ExampleSet, rows: np.ndarray, active: np.ndarray) -> dict:
    """active 는 rows 와 같은 길이. Oracle 로 차단이 맞았는지 센다."""

    modes = examples.oracle.latent_mode[rows]
    archetypes = examples.oracle.archetype[rows]
    blocked = ~active
    is_active = np.isin(modes, ACTIVE_MODES)
    is_inactive = np.isin(modes, INACTIVE_MODES)
    return {
        "blocked_points": int(blocked.sum()),
        "active_time_blocked_share": _share(blocked, is_active),
        "exploring_blocked_share": _share(blocked, modes == "exploring"),
        "stuck_blocked_share": _share(blocked, modes == "stuck"),
        "inactive_recall": _share(blocked, is_inactive),
        "post_termination_recall": _share(blocked, modes == "post_end"),
        "away_recall": _share(blocked, modes == "away"),
        "block_precision": _share(is_inactive, blocked),
        "active_time_blocked_share_by_archetype": {
            a: _share(blocked, is_active & (archetypes == a))
            for a in sorted(set(archetypes.tolist()))
        },
    }
