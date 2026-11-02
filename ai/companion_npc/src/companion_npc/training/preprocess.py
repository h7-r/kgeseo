"""전처리 — 학습 행으로만 적합한다 (P3-B 의 로지스틱 회귀용. 규칙 기준선은 원값을 쓴다).

· 학습 행에서 늘 NaN 이거나 값이 하나뿐인 열은 뺀다 (뺀 목록을 남긴다).
· NaN 은 학습 행의 **중앙값**으로 채운다 — 0 으로 채우지 않는다. 값 유무는 <이름>__known 열이 따로 알려 준다.
· 표준화(평균·표준편차)도 학습 행으로만 잰다.
"""

import warnings
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class FittedPreprocessor:
    keep: np.ndarray  # bool, 열마다
    dropped: tuple[str, ...]
    median: np.ndarray
    mean: np.ndarray
    scale: np.ndarray
    fit_rows: int

    def transform(self, X: np.ndarray) -> np.ndarray:
        kept = X[:, self.keep]
        filled = np.where(np.isnan(kept), self.median, kept)
        return (filled - self.mean) / self.scale


def fit_preprocessor(
    X_train: np.ndarray, columns: tuple[str, ...]
) -> FittedPreprocessor:
    all_nan = np.all(np.isnan(X_train), axis=0)
    with warnings.catch_warnings():
        # 전부 NaN 인 열은 위에서 이미 걸러 낸다 — 그 열의 nanmax 경고는 의미가 없다
        warnings.simplefilter("ignore", RuntimeWarning)
        spread = np.nanmax(X_train, axis=0) - np.nanmin(X_train, axis=0)
    keep = ~all_nan & (np.nan_to_num(spread, nan=0.0) > 0)
    kept = X_train[:, keep]
    median = np.nanmedian(kept, axis=0)
    filled = np.where(np.isnan(kept), median, kept)
    mean = filled.mean(axis=0)
    scale = filled.std(axis=0)
    scale[scale == 0] = 1.0
    return FittedPreprocessor(
        keep=keep,
        dropped=tuple(c for c, k in zip(columns, keep) if not k),
        median=median,
        mean=mean,
        scale=scale,
        fit_rows=len(X_train),
    )
