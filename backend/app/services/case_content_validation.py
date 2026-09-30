from app.schemas.case_content import CaseClientContent
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition


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

    for zone in client_content.zones:
        for obj in zone.objects:
            interaction = obj.interaction
            if interaction is None or interaction.type != "input":
                continue
            if interaction.target_id not in puzzle_ids:
                raise CaseContentLinkValidationError(
                    f"Client Object '{obj.object_id}' references missing puzzle "
                    f"'{interaction.target_id}'."
                )
