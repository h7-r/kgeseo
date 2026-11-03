"""장면 완료 조건 `clear_when` 정적 검증기 v0.1 (팀 검토 대기, 게시 게이트에서 쓴다).

Server Runtime 문서의 `scenes`를 읽어, 서버가 이미 가진 상태만으로 판정할 수 있는 조건인지 확인한다.
문법 · 판정 규칙은 `app.schemas.scene_condition`에 있고, Server Runtime 모델(`PuzzleRuntimeDefinition`)도
같은 규칙으로 `scenes`를 받는다. 이 모듈은 게이트가 장면을 뗀 Server 모델로 그 규칙을 부르는 입구다.
"""

from typing import Any

from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition, settable_flags
from app.schemas.scene_condition import (
    SCENE_FIELDS,
    UNSUPPORTED_CONDITIONS,
    SceneAssessment,
    SceneStatus,
    assess_scene_list,
)

__all__ = [
    "SCENE_FIELDS",
    "UNSUPPORTED_CONDITIONS",
    "SceneAssessment",
    "SceneStatus",
    "assess_scenes",
]


def assess_scenes(raw_scenes: Any, server: PuzzleRuntimeDefinition) -> SceneAssessment:
    return assess_scene_list(
        raw_scenes,
        (puzzle.puzzle_id for puzzle in server.puzzles),
        settable_flags(server),
    )
