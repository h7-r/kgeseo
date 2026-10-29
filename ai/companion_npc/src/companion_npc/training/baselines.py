"""기준선.

[관측 가능 기준선] — fit/score 에 X 와 열 이름만 받는다
  always_intervene · never_intervene
  rule: 도움 요청 · 대상 퍼즐 연속 오답 ≥ a · (대상 있음 AND 마지막 상호작용 뒤 ≥ b 초)
        NaN(관측 없음)인 조건은 거짓으로 본다. (a, b) 는 안쪽 검증에서만 고른다.

[generator_reference] — Oracle 을 쓰는 참고 기준선. 성능 상한선이 아니다.
  시뮬레이터가 stuck 을 일으키는 조건(유형별 stuck_after_fails · stuck_prob > 0)을 그대로 쓴다.
  유형(archetype)은 온라인에서 알 수 없으므로 운영 가능 평가에 넣지 않는다.
  쓰임: 관측 가능 모델이 이 규칙을 얼마나 다시 찾아내는지(규칙 재학습) 보는 비교점.
"""

from dataclasses import dataclass

import numpy as np

from companion_npc.simulation.config import SimulationConfig


def _col(X: np.ndarray, columns: tuple[str, ...], name: str) -> np.ndarray:
    return X[:, columns.index(name)]


@dataclass(frozen=True)
class AlwaysIntervene:
    name: str = "always_intervene"
    uses_oracle: bool = False

    def score(self, X: np.ndarray, columns: tuple[str, ...]) -> np.ndarray:
        return np.ones(len(X))


@dataclass(frozen=True)
class NeverIntervene:
    name: str = "never_intervene"
    uses_oracle: bool = False

    def score(self, X: np.ndarray, columns: tuple[str, ...]) -> np.ndarray:
        return np.zeros(len(X))


@dataclass(frozen=True)
class RuleBaseline:
    consecutive_min: int
    idle_min_sec: float
    name: str = "rule"
    uses_oracle: bool = False

    def score(self, X: np.ndarray, columns: tuple[str, ...]) -> np.ndarray:
        with np.errstate(invalid="ignore"):
            helped = _col(X, columns, "player_requested_help") == 1
            consecutive = (
                _col(X, columns, "target_consecutive_incorrect") >= self.consecutive_min
            )
            idle = (_col(X, columns, "target_known") == 1) & (
                _col(X, columns, "since_last_interaction_sec") >= self.idle_min_sec
            )
        return (helped | consecutive | idle).astype(np.float64)


@dataclass(frozen=True)
class GeneratorReference:
    """Oracle 참고 기준선 — score 에 유형(archetype)을 따로 받는다."""

    simulation: SimulationConfig
    name: str = "generator_reference"
    uses_oracle: bool = True

    def score_with_oracle(
        self, X: np.ndarray, columns: tuple[str, ...], archetype: np.ndarray
    ) -> np.ndarray:
        params = self.simulation.archetypes
        need = np.array(
            [params[a].stuck_after_fails for a in archetype], dtype=np.float64
        )
        can = np.array([params[a].stuck_prob > 0 for a in archetype])
        with np.errstate(invalid="ignore"):
            hit = _col(X, columns, "target_consecutive_incorrect") >= need
        return (hit & can).astype(np.float64)
