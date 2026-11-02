"""P3-B 학습 모델 — 로지스틱 회귀 · LightGBM.

· 입력은 X(fs-0.1 학습 열)와 라벨·가중치뿐이다. Oracle · 대상 퍼즐 meta 는 받지 않는다.
· 전처리(열 빼기 · 중앙값 채움 · 표준화)는 넘겨받은 학습 행으로만 적합한다.
· 가중치는 평균 1 로 맞춘다 — 전략(세션·솎아 내기·없음)마다 정규화 강도의 뜻이 같게.
· LightGBM 은 NaN 을 그대로 받는다(채우지 않음). deterministic · 스레드 수 고정으로 재현한다.
"""

from dataclasses import asdict, dataclass

import lightgbm as lgb
import numpy as np
from sklearn.linear_model import LogisticRegression

from companion_npc.training.preprocess import FittedPreprocessor, fit_preprocessor


def _normalized(weight: np.ndarray) -> np.ndarray:
    return weight * (len(weight) / weight.sum())


@dataclass(frozen=True)
class LogRegSpec:
    C: float

    @property
    def label(self) -> str:
        return f"C={self.C:g}"


@dataclass(frozen=True)
class LgbmSpec:
    num_leaves: int
    learning_rate: float
    n_estimators: int
    min_child_samples: int

    @property
    def label(self) -> str:
        return (
            f"leaves={self.num_leaves},lr={self.learning_rate:g},"
            f"trees={self.n_estimators},min_child={self.min_child_samples}"
        )


@dataclass(frozen=True)
class FittedLogReg:
    spec: LogRegSpec
    pre: FittedPreprocessor
    model: LogisticRegression

    def predict(self, X: np.ndarray) -> np.ndarray:
        return self.model.predict_proba(self.pre.transform(X))[:, 1]

    def export(self, columns: tuple[str, ...]) -> dict:
        kept = [c for c, k in zip(columns, self.pre.keep) if k]
        return {
            "family": "logreg",
            "spec": asdict(self.spec),
            "dropped_columns": list(self.pre.dropped),
            "intercept": float(self.model.intercept_[0]),
            "coefficients": dict(zip(kept, self.model.coef_[0].round(6).tolist())),
        }


@dataclass(frozen=True)
class FittedLgbm:
    spec: LgbmSpec
    keep: np.ndarray
    dropped: tuple[str, ...]
    model: lgb.LGBMClassifier

    def predict(self, X: np.ndarray) -> np.ndarray:
        return self.model.predict_proba(X[:, self.keep])[:, 1]

    def export_text(self) -> str:
        return self.model.booster_.model_to_string()


def fit_logreg(
    X: np.ndarray,
    y: np.ndarray,
    w: np.ndarray,
    columns: tuple[str, ...],
    spec: LogRegSpec,
) -> FittedLogReg:
    pre = fit_preprocessor(X, columns)
    model = LogisticRegression(C=spec.C, max_iter=2000)
    model.fit(pre.transform(X), y.astype(int), sample_weight=_normalized(w))
    return FittedLogReg(spec=spec, pre=pre, model=model)


def fit_lgbm(
    X: np.ndarray,
    y: np.ndarray,
    w: np.ndarray,
    columns: tuple[str, ...],
    spec: LgbmSpec,
    threads: int,
) -> FittedLgbm:
    # 열 빼기만 전처리에서 빌려 쓴다 (채움·표준화는 하지 않는다)
    pre = fit_preprocessor(X, columns)
    model = lgb.LGBMClassifier(
        num_leaves=spec.num_leaves,
        learning_rate=spec.learning_rate,
        n_estimators=spec.n_estimators,
        min_child_samples=spec.min_child_samples,
        deterministic=True,
        force_row_wise=True,
        n_jobs=threads,
        random_state=0,
        verbose=-1,
    )
    model.fit(X[:, pre.keep], y.astype(int), sample_weight=_normalized(w))
    return FittedLgbm(spec=spec, keep=pre.keep, dropped=pre.dropped, model=model)
