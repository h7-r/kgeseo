"""합성 데이터셋 → 학습·평가용 배열.

[세 묶음]
  X · columns          모델 입력. FeatureVector.model_row() 그대로 (None → NaN)
  y · proxy            라벨. synthetic_needs_help (학습 목표) · no_progress_within_120s (비교용)
  session · case · t   묶음 키와 판단 시각 — 온라인에서도 알 수 있는 값
  oracle               시뮬레이터 정답. 진단·참조 평가 전용 (모델 입력·실시간 판단·운영 가능 평가 필터 금지)

[라벨 결합]
  synthetic_needs_help 는 판단 시각을 덮는 잠재 구간에서 온다 (analysis.needs_help_of).
  away · 종료 후는 None(NaN) — 학습 대상이 아니다.
"""

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from companion_npc.features.config import FeatureConfig
from companion_npc.features.schema import FeatureRowSchema
from companion_npc.simulation.analysis import DecisionRecord, analyze_session
from companion_npc.simulation.engine import (
    ExplorationEvent,
    LatentSegment,
    SessionOutput,
    SessionTruth,
)
from companion_npc.simulation.scenario import SimScenario

FEATURE_COLUMNS: tuple[str, ...] = tuple(FeatureRowSchema().columns)
LABEL = "synthetic_needs_help"
PROXY_LABEL = "no_progress_within_120s"
# 모델 입력에 절대 들어가면 안 되는 이름 — 열 이름 검사에 쓴다
ORACLE_NAMES = frozenset(
    {
        "latent_mode",
        "archetype",
        "final_status",
        "ended_at",
        "outcome",
        LABEL,
        PROXY_LABEL,
    }
)


class DatasetError(ValueError):
    pass


@dataclass(frozen=True)
class OracleColumns:
    """시뮬레이터 정답. 진단·참조 평가 전용."""

    latent_mode: np.ndarray  # str
    archetype: np.ndarray  # str
    final_status: np.ndarray  # str


@dataclass(frozen=True)
class ExampleSet:
    dataset_id: str
    columns: tuple[str, ...]
    X: np.ndarray  # float64, NaN = 관측 없음
    y: np.ndarray  # float64 0/1, NaN = 학습 대상 아님 (away · 종료 후)
    proxy: np.ndarray  # float64 0/1, NaN = censored
    session: np.ndarray  # str
    case: np.ndarray  # str
    t: np.ndarray  # float64, UTC epoch 초
    oracle: OracleColumns
    sessions: dict[str, SessionOutput] = field(repr=False)  # 정책 평가(Oracle 진단)용

    def __len__(self) -> int:
        return len(self.y)

    @property
    def labeled(self) -> np.ndarray:
        return ~np.isnan(self.y)


def examples_from_records(
    dataset_id: str, records: list[DecisionRecord], outputs: list[SessionOutput]
) -> ExampleSet:
    columns = FEATURE_COLUMNS
    if ORACLE_NAMES & set(columns):
        raise DatasetError("feature columns must not contain oracle names")
    X = np.array(
        [
            [np.nan if r.features[c] is None else r.features[c] for c in columns]
            for r in records
        ],
        dtype=np.float64,
    ).reshape(len(records), len(columns))
    nan = np.nan
    return ExampleSet(
        dataset_id=dataset_id,
        columns=columns,
        X=X,
        y=np.array(
            [
                nan if r.synthetic_needs_help is None else r.synthetic_needs_help
                for r in records
            ],
            dtype=np.float64,
        ),
        proxy=np.array(
            [nan if r.proxy.value is None else r.proxy.value for r in records],
            dtype=np.float64,
        ),
        session=np.array([r.play_session_id for r in records], dtype=object),
        case=np.array([r.case_id for r in records], dtype=object),
        t=np.array([r.decision_at.timestamp() for r in records], dtype=np.float64),
        oracle=OracleColumns(
            latent_mode=np.array([r.latent_mode for r in records], dtype=object),
            archetype=np.array([r.archetype for r in records], dtype=object),
            final_status=np.array([r.final_status for r in records], dtype=object),
        ),
        sessions={o.truth.play_session_id: o for o in outputs},
    )


def build_examples(
    dataset_id: str,
    outputs: list[SessionOutput],
    scenarios: dict[str, SimScenario],
    feature_config: FeatureConfig | None = None,
) -> ExampleSet:
    records = [
        r
        for o in outputs
        for r in analyze_session(o, scenarios[o.truth.case_id].pack, feature_config)
    ]
    return examples_from_records(dataset_id, records, outputs)


# ── P2-C 출력 폴더 읽기 ──────────────────────────────────────
def _read_jsonl(path: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


def load_synthetic_dir(path: Path) -> list[SessionOutput]:
    """P2-C writer 가 쓴 폴더를 다시 SessionOutput 으로 읽는다. manifest 해시로 손상 여부를 본다."""

    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("representative") is not False:
        raise DatasetError("manifest must declare representative: false")
    for name, meta in manifest["files"].items():
        digest = hashlib.sha256((path / name).read_bytes()).hexdigest()
        if digest != meta["sha256"]:
            raise DatasetError(f"{name}: sha256 mismatch with manifest")

    truths = [
        SessionTruth.model_validate(t)
        for t in _read_jsonl(path / "session_truth.jsonl")
    ]
    rows: dict[str, list[dict]] = {t.play_session_id: [] for t in truths}
    for row in _read_jsonl(path / "interaction_events.jsonl"):
        if row["play_session_id"] not in rows:
            raise DatasetError(
                "interaction event for a session missing from session_truth"
            )
        rows[row["play_session_id"]].append(row)
    segments: dict[str, list[LatentSegment]] = {t.play_session_id: [] for t in truths}
    for seg in _read_jsonl(path / "latent_segments.jsonl"):
        segment = LatentSegment.model_validate(seg)
        if segment.play_session_id not in segments:
            raise DatasetError(
                "latent segment for a session missing from session_truth"
            )
        segments[segment.play_session_id].append(segment)
    exploration: dict[str, list[ExplorationEvent]] = {
        t.play_session_id: [] for t in truths
    }
    extra = path / "synthetic_exploration_events.jsonl"
    if extra.exists():
        for event in _read_jsonl(extra):
            item = ExplorationEvent.model_validate(event)
            exploration[item.play_session_id].append(item)

    outputs = []
    for truth in truths:
        sid = truth.play_session_id
        if len(rows[sid]) != truth.events_kept:
            raise DatasetError("events_kept does not match interaction_events")
        outputs.append(
            SessionOutput(
                rows=rows[sid],
                truth=truth,
                segments=segments[sid],
                exploration=exploration[sid],
            )
        )
    return outputs


def check_label_join(examples: ExampleSet) -> dict[str, int]:
    """라벨 결합 검사. 잠재 구간이 세션 시작~끝을 빈틈·겹침 없이 덮고, 라벨이 잠재 상태와 맞는지."""

    for sid, output in examples.sessions.items():
        segments = sorted(output.segments, key=lambda s: s.start)
        if not segments:
            continue
        if segments[0].start != output.truth.started_at:
            raise DatasetError(f"session {sid}: segments do not start at started_at")
        for a, b in zip(segments, segments[1:]):
            if a.end != b.start:
                raise DatasetError(f"session {sid}: segments have a gap or overlap")
    expected = {"stuck": 1.0, "working": 0.0, "exploring": 0.0}
    mismatch = 0
    for mode, label in zip(examples.oracle.latent_mode, examples.y):
        want = expected.get(mode)
        mismatch += (want is None and not np.isnan(label)) or (
            want is not None and label != want
        )
    if mismatch:
        raise DatasetError(f"{mismatch} labels disagree with latent mode")
    modes, counts = np.unique(
        examples.oracle.latent_mode.astype(str), return_counts=True
    )
    return dict(zip(modes.tolist(), counts.tolist()))
