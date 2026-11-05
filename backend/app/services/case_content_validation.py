from app.schemas.case_content import CaseClientContent
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition, RuntimeEffect
from app.services.object_resolver import (
    ObjectNotFoundError,
    ZoneNotFoundError,
    find_object,
)


class CaseContentLinkValidationError(Exception):
    pass


def validate_case_content_links(
    client_content: CaseClientContent,
    server_runtime: PuzzleRuntimeDefinition,
) -> None:
    if client_content.case_id != server_runtime.case_id:
        raise CaseContentLinkValidationError(
            f"Client case_id '{client_content.case_id}' does not match "
            f"Server case_id '{server_runtime.case_id}'."
        )

    puzzle_ids = {puzzle.puzzle_id for puzzle in server_runtime.puzzles}
    inspect_ids = {inspection.inspect_id for inspection in server_runtime.inspections}

    for zone in client_content.zones:
        for obj in zone.objects:
            interaction = obj.interaction
            if interaction is None:
                continue
            if interaction.type == "input" and interaction.target_id not in puzzle_ids:
                raise CaseContentLinkValidationError(
                    f"Client Object '{obj.object_id}' references missing puzzle "
                    f"'{interaction.target_id}'."
                )
            # 효과가 없는 조사 대상도 빈 on_inspect로 Server Runtime에 정의해야 한다.
            if (
                interaction.type == "inspect"
                and interaction.target_id not in inspect_ids
            ):
                raise CaseContentLinkValidationError(
                    f"Client Object '{obj.object_id}' references missing inspection "
                    f"'{interaction.target_id}'."
                )

    effects: list[tuple[str, RuntimeEffect]] = (
        [
            (f"Puzzle '{puzzle.puzzle_id}'", puzzle.on_correct)
            for puzzle in server_runtime.puzzles
        ]
        + [
            (f"Clue combination '{combination.combination_id}'", combination.on_success)
            for combination in server_runtime.clue_combinations
        ]
        + [
            (f"Inspection '{inspection.inspect_id}'", inspection.on_inspect)
            for inspection in server_runtime.inspections
        ]
    )
    for owner, effect in effects:
        for object_effect in effect.set_object_states:
            try:
                find_object(
                    client_content,
                    object_effect.zone_id,
                    object_effect.object_id,
                )
            except (ZoneNotFoundError, ObjectNotFoundError) as error:
                raise CaseContentLinkValidationError(
                    f"{owner} set_object_states references missing Object "
                    f"'{object_effect.object_id}' in Zone '{object_effect.zone_id}'."
                ) from error
