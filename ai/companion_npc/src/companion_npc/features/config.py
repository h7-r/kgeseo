"""실험 설정값. 판단 간격·관측 구간은 확정값이 아니라 실험으로 정할 값이다."""

from pydantic import Field

from companion_npc.contracts.common import ContractModel


class FeatureConfig(ContractModel):
    # 진전이 없을 때 몇 초마다 판단 시점을 둘까 (오프라인 재생의 tick)
    decision_interval_sec: float = Field(default=30, gt=0)
    # 대리 라벨 no_progress_within_<N>s 의 N
    label_horizon_sec: float = Field(default=120, gt=0)
    # events_in_rate_window 를 세는 구간
    rate_window_sec: float = Field(default=300, gt=0)
    # mean_gap_recent_sec 에 쓰는 최근 간격 수
    gap_window: int = Field(default=5, ge=1)
    # NpcContext.recent_interactions 와 같은 상한. 오프라인도 이만큼만 본다.
    recent_window: int = Field(default=50, ge=1, le=50)

    # 아직 없는 데이터 원천. False 면 그 원천에 기대는 특성은 unobservable 이다.
    #   (값이 비어 있는 것과 "원래 0" 을 구분하려고 둔다)
    hint_api_available: bool = False  # Hint API 가 hint_levels 를 실제로 갱신하는가
    npc_log_available: bool = False  # npc_history 가 NPC 발화 로그로 채워지는가
