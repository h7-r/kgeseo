"""분할 — 사건 단위 leave-one-case-out (바깥) + 세션 단위 GroupKFold (안쪽).

· 바깥 테스트 사건은 설정·임계값 선택에 쓰지 않는다. 선택은 안쪽 검증에서만.
· 같은 세션의 판단 시점은 학습·검증·테스트 중 한 곳에만 있다.
· 섞는 순서는 split_seed 로 고정한다 (세션 ID 정렬 → 난수 섞기 → 차례로 배정).
"""

import random
from dataclasses import dataclass

import numpy as np

from companion_npc.training.dataset import ExampleSet


class LeakError(AssertionError):
    pass


@dataclass(frozen=True)
class InnerFold:
    train: np.ndarray  # 행 번호
    val: np.ndarray


@dataclass(frozen=True)
class OuterFold:
    test_case: str
    train: np.ndarray
    test: np.ndarray
    inner: tuple[InnerFold, ...]


def group_kfold(
    groups: np.ndarray, rows: np.ndarray, k: int, seed: int
) -> list[InnerFold]:
    unique = sorted(set(groups[rows].tolist()))
    if len(unique) < k:
        raise ValueError(f"need at least {k} sessions for {k}-fold, got {len(unique)}")
    random.Random(seed).shuffle(unique)
    fold_of = {g: i % k for i, g in enumerate(unique)}
    assigned = np.array([fold_of[g] for g in groups[rows]])
    return [
        InnerFold(train=rows[assigned != i], val=rows[assigned == i]) for i in range(k)
    ]


def leave_one_case_out(
    examples: ExampleSet, inner_k: int, seed: int
) -> list[OuterFold]:
    all_rows = np.arange(len(examples))
    folds = []
    for case in sorted(set(examples.case.tolist())):
        train = all_rows[examples.case != case]
        test = all_rows[examples.case == case]
        inner = tuple(group_kfold(examples.session, train, inner_k, seed))
        folds.append(OuterFold(test_case=case, train=train, test=test, inner=inner))
    return folds


def check_fold(examples: ExampleSet, fold: OuterFold) -> dict[str, int]:
    """누수 검사. 걸리면 LeakError. 통과하면 크기 요약을 돌려준다."""

    train_sessions = set(examples.session[fold.train].tolist())
    test_sessions = set(examples.session[fold.test].tolist())
    if train_sessions & test_sessions:
        raise LeakError("a session appears in both outer train and test")
    if fold.test_case in set(examples.case[fold.train].tolist()):
        raise LeakError("outer test case appears in training rows")
    for inner in fold.inner:
        if set(inner.val.tolist()) & set(fold.test.tolist()) or set(
            inner.train.tolist()
        ) & set(fold.test.tolist()):
            raise LeakError("inner folds touch outer test rows")
        if set(examples.session[inner.train].tolist()) & set(
            examples.session[inner.val].tolist()
        ):
            raise LeakError("a session appears in both inner train and validation")
    covered = np.concatenate([inner.val for inner in fold.inner])
    if sorted(covered.tolist()) != sorted(fold.train.tolist()):
        raise LeakError("inner validation folds do not partition outer train")
    return {
        "train_rows": len(fold.train),
        "test_rows": len(fold.test),
        "train_sessions": len(train_sessions),
        "test_sessions": len(test_sessions),
        "inner_folds": len(fold.inner),
    }
