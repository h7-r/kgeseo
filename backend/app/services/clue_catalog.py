from collections.abc import Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.clue import PlaySessionClue
from app.schemas.play_session import PlaySessionState
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.play_session import get_play_session
from app.services.puzzle_runtime import load_case_runtime

RuntimeLoader = Callable[[str], PuzzleRuntimeDefinition]


async def get_acquired_clues(
    db: AsyncSession,
    play_session_id: str,
    *,
    runtime_loader: RuntimeLoader = load_case_runtime,
) -> list[PlaySessionClue]:
    """PlaySession이 획득한 단서만 획득 순서대로 공개 표시 정보로 돌려준다.

    조회만 하며 DB를 변경하지 않는다. 획득하지 않은 단서 정의는 결과에 넣지 않는다.
    """

    play_session = await get_play_session(db, play_session_id)
    state = PlaySessionState.model_validate(play_session.state_json)
    if not state.acquired_clue_ids:
        return []

    definitions = {
        clue.clue_id: clue for clue in runtime_loader(play_session.case_id).clues
    }
    clues: list[PlaySessionClue] = []
    for clue_id in state.acquired_clue_ids:
        definition = definitions.get(clue_id)
        clues.append(
            PlaySessionClue(
                clue_id=clue_id,
                title=definition.title if definition else None,
                summary=definition.summary if definition else None,
                body=definition.body if definition else None,
                carrier_kind=definition.carrier_kind if definition else None,
            )
        )
    return clues
