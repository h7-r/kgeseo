"""합성 세션 → (P2-B 파이프라인) → 판단 시점별 기록 · 요약.

[경계]
  replay_session 에는 SessionOutput.rows(interaction_events)만 넘긴다.
  잠재 상태 · session_truth 는 특성이 다 계산된 **뒤에** 라벨을 붙이고 거를 때만 쓴다.

[판단 시점의 잠재 상태]
  working · exploring · stuck · away  — 그 시각을 덮는 구간
  post_end                            — 자연 종료(ended_at) 이후. 실제로는 아무도 없다.

[합성 도움 필요 라벨 synthetic_needs_help]
  stuck → 1 · working/exploring → 0 · away/post_end → None (판단 대상 아님)
  사람이 붙이는 HelpAnnotation(needs_help)과는 다른 것이다.

[정상 학습 데이터]
  post_end 시점과 censored 대리 라벨을 뺀다. post_end 를 가리는 데 ended_at(합성 정답)을 쓰므로,
  실제 로그에서는 세션 종료 기록(합의 #19)이 생기기 전까지 이 필터를 그대로 쓸 수 없다.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from companion_npc.contracts.scenario_pack import ScenarioPack
from companion_npc.features.config import FeatureConfig
from companion_npc.features.fingerprint import AnswerFingerprinter
from companion_npc.features.labels import ProxyLabel, label_replay
from companion_npc.features.replay import replay_features, replay_session
from companion_npc.simulation.engine import LatentSegment, SessionOutput

DecisionMode = Literal["working", "exploring", "stuck", "away", "post_end"]
MODES: tuple[DecisionMode, ...] = ("working", "exploring", "stuck", "away", "post_end")
FinalStatus = Literal["post_termination", "censored", "eligible", "excluded_other"]
FINAL_STATUSES: tuple[FinalStatus, ...] = (
    "post_termination",
    "censored",
    "eligible",
    "excluded_other",
)


def _status_counts(records: list["DecisionRecord"]) -> dict[str, int]:
    counts = Counter(r.final_status for r in records)
    return {s: counts.get(s, 0) for s in FINAL_STATUSES}


def _label_counts(records: list["DecisionRecord"]) -> dict[str, int]:
    # 최종 상태와 **겹치는** 축이다 — 종료 후 시점의 라벨도 센다
    counts = Counter(r.proxy.status for r in records)
    return {s: counts.get(s, 0) for s in ("labeled", "censored")}


@dataclass(frozen=True)
class DecisionRecord:
    play_session_id: str
    case_id: str
    archetype: str  # 분석용. 학습 행에는 넣지 않는다
    phase: str
    decision_at: datetime
    latent_mode: DecisionMode
    synthetic_needs_help: int | None
    proxy: ProxyLabel
    features: dict[str, float | int | None]  # FeatureVector.model_row()

    @property
    def final_status(self) -> "FinalStatus":
        """상호 배타적인 최종 상태. 위에서부터 먼저 걸리는 것 하나만 받는다.

        post_termination  자연 종료 이후 (라벨이 censored 여도 여기로)
        censored          종료 전이지만 관측 구간이 모자라 대리 라벨 미확정
        eligible          정상 학습 데이터
        excluded_other    그 밖의 제외 — 지금 규칙에서는 생기지 않는다(방어용 칸)
        """

        if self.latent_mode == "post_end":
            return "post_termination"
        if self.proxy.status == "censored":
            return "censored"
        if self.proxy.status == "labeled":
            return "eligible"
        return "excluded_other"

    @property
    def training_eligible(self) -> bool:
        return self.final_status == "eligible"


def latent_mode_at(
    segments: list[LatentSegment], ended_at: datetime, t: datetime
) -> DecisionMode:
    if t >= ended_at:
        return "post_end"
    for segment in segments:
        if segment.start <= t < segment.end:
            return segment.mode
    # 구간 경계(이벤트 시각)는 다음 구간의 시작이다. 남는 경우는 working 으로 본다
    return "working"


def needs_help_of(mode: DecisionMode) -> int | None:
    return {"stuck": 1, "working": 0, "exploring": 0}.get(mode)


def analyze_session(
    output: SessionOutput,
    pack: ScenarioPack,
    config: FeatureConfig | None = None,
    fingerprinter: AnswerFingerprinter | None = None,
) -> list[DecisionRecord]:
    config = config or FeatureConfig()
    truth = output.truth
    # ↓ 모델 입력 경로: 행만 들어간다
    result = replay_session(
        output.rows,
        play_session_id=truth.play_session_id,
        case_id=truth.case_id,
        pack=pack,
        observation_end=truth.observation_end,
        config=config,
        fingerprinter=fingerprinter,
        session_started_at=truth.started_at,
    )
    vectors = replay_features(result, pack, config)
    labels = label_replay(result, truth.observation_end, config.label_horizon_sec)
    # ↓ 여기서부터 합성 정답을 쓴다 (라벨 · 필터)
    records = []
    for point, vector, label in zip(result.decision_points, vectors, labels):
        mode = latent_mode_at(
            output.segments, truth.ended_at, point.context.requested_at
        )
        records.append(
            DecisionRecord(
                play_session_id=truth.play_session_id,
                case_id=truth.case_id,
                archetype=truth.archetype,
                phase=point.phase,
                decision_at=point.context.requested_at,
                latent_mode=mode,
                synthetic_needs_help=needs_help_of(mode),
                proxy=label,
                features=vector.model_row(),
            )
        )
    return records


def training_rows(records: list[DecisionRecord]) -> list[dict[str, Any]]:
    """정상 학습 데이터. 특성 · 라벨 · 묶음 키만 — 유형·잠재 상태는 넣지 않는다."""

    return [
        {
            "features": r.features,
            "labels": {
                r.proxy.name: r.proxy.value,
                "synthetic_needs_help": r.synthetic_needs_help,
            },
            "group": {"play_session_id": r.play_session_id, "case_id": r.case_id},
        }
        for r in records
        if r.training_eligible
    ]


def _rate(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def summarize(
    outputs: list[SessionOutput], records: list[DecisionRecord]
) -> dict[str, Any]:
    """사건 × 유형별 요약. 합성 데이터의 성질이지 실제 플레이어에 대한 주장이 아니다."""

    by_key: dict[tuple[str, str], dict[str, Any]] = defaultdict(
        lambda: {"outputs": [], "records": []}
    )
    for output in outputs:
        by_key[(output.truth.case_id, output.truth.archetype)]["outputs"].append(output)
    for record in records:
        by_key[(record.case_id, record.archetype)]["records"].append(record)

    groups = []
    for (case_id, archetype), bucket in sorted(by_key.items()):
        outs: list[SessionOutput] = bucket["outputs"]
        recs: list[DecisionRecord] = bucket["records"]
        submits = [
            r for o in outs for r in o.rows if r["interaction_type"] == "submit_answer"
        ]
        wrong = [r for r in submits if r["result_type"] == "incorrect"]
        repeats = 0
        for o in outs:
            last: dict[str, str] = {}
            for r in o.rows:
                if r["result_type"] != "incorrect":
                    continue
                answer = r["payload_json"]["answer"]
                repeats += last.get(r["target_id"]) == answer
                last[r["target_id"]] = answer
        modes = Counter(r.latent_mode for r in recs)
        proxy_one = Counter(r.latent_mode for r in recs if r.proxy.value == 1)
        labeled = Counter(r.latent_mode for r in recs if r.proxy.status == "labeled")
        groups.append(
            {
                "case_id": case_id,
                "archetype": archetype,
                "sessions": len(outs),
                "events_kept_mean": _rate(
                    sum(o.truth.events_kept for o in outs), len(outs)
                ),
                "outcomes": dict(
                    sorted(Counter(o.truth.outcome for o in outs).items())
                ),
                "reachable_completed_rate": _rate(
                    sum(o.truth.reachable_completed for o in outs), len(outs)
                ),
                "scenario_completed_rate": _rate(
                    sum(o.truth.scenario_completed for o in outs), len(outs)
                ),
                "incorrect_rate": _rate(len(wrong), len(submits)),
                "repeat_wrong_rate": _rate(repeats, len(wrong)),
                "already_completed_events": sum(
                    r["result_type"] == "already_completed" for r in submits
                ),
                "decision_points": len(recs),
                "decision_mode_counts": {m: modes.get(m, 0) for m in MODES},
                "final_status_counts": _status_counts(recs),
                "proxy_label_status_counts": _label_counts(recs),
                # 대리 라벨 1 의 비율 — 잠재 상태별 (labeled 만 분모)
                "proxy1_rate_by_mode": {
                    m: _rate(proxy_one.get(m, 0), labeled.get(m, 0)) for m in MODES
                },
            }
        )

    labeled_all = Counter(r.latent_mode for r in records if r.proxy.status == "labeled")
    proxy_all = Counter(r.latent_mode for r in records if r.proxy.value == 1)
    return {
        "representative": False,
        "note": "합성 데이터의 성질이다. 실제 플레이어 행동이나 모델 성능에 대한 주장이 아니다.",
        "sessions": len(outputs),
        "decision_points": len(records),
        # 상호 배타 — 합이 decision_points 와 같다
        "final_status_counts": _status_counts(records),
        # 아래 둘은 서로 다른 축이라 final_status 와 겹친다 (합하지 않는다)
        "decision_mode_counts": {
            m: sum(r.latent_mode == m for r in records) for m in MODES
        },
        "proxy_label_status_counts": _label_counts(records),
        "proxy1_rate_by_mode": {
            m: _rate(proxy_all.get(m, 0), labeled_all.get(m, 0)) for m in MODES
        },
        "groups": groups,
    }
