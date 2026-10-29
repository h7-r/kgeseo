"""P2-B — 플레이어 상태 · 상호작용 로그 → 판단층 특성.

    온라인:  NpcContext ─────────────────────────────┐
                                                      ├→ extract_features(context, pack, config)
    오프라인: interaction_events → replay → NpcContext[] ┘

특성을 계산하는 함수는 extract_features **하나**다. 학습(오프라인)과 서비스(온라인)가
같은 함수를 지나므로 둘의 계산이 어긋날 수 없다.
"""

from companion_npc.features.config import FeatureConfig
from companion_npc.features.extract import extract_features
from companion_npc.features.schema import (
    FEATURE_SET_VERSION,
    FEATURE_SPECS,
    FeatureVector,
)

__all__ = [
    "FEATURE_SET_VERSION",
    "FEATURE_SPECS",
    "FeatureConfig",
    "FeatureVector",
    "extract_features",
]
