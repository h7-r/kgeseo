"""기존 게임 콘텐츠 → ScenarioPack 변환기 (P2-A).

지금 읽을 수 있는 원천은 backend 의 Case 파일 한 쌍뿐이다.
    <case_id>.client.json  (CaseClientContent)
    <case_id>.server.json  (PuzzleRuntimeDefinition)
GameSpec / PuzzleSpec 은 아직 확정되지 않아 여기서 다루지 않는다.
"""

from companion_npc.adapters.case_content import ConversionResult, convert_case
from companion_npc.adapters.loader import load_case_sources

__all__ = ["ConversionResult", "convert_case", "load_case_sources"]
