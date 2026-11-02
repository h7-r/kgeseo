"""시나리오에서 '로그로 풀 수 있는' 퍼즐을 가린다.

[답으로 풀 수 있는 퍼즐 (answerable)]
  보이는(initially_visible) input 오브젝트가 가리키는 퍼즐. 팩 순서대로 차례로 푼다.
  backend 에는 퍼즐 해금 조건이 없으므로(Contract Gap) 처음부터 모두 입력할 수 있다고 본다.

[도달 가능 (reachable)]
  answerable + 그 퍼즐들의 효과(completes_puzzle_ids)로 완료되는 퍼즐 (닫힘).

[도달 불가]
  단서 조합으로만 완료되는 퍼즐 — 조합 성공은 P2-C 초기 구현에서 다루지 않는다.
  숨은 오브젝트에만 걸린 퍼즐 — 드러나는 조건이 아직 계약에 없다.
"""

from dataclasses import dataclass

from companion_npc.contracts.scenario_pack import PackPuzzle, ScenarioPack


@dataclass(frozen=True)
class SimScenario:
    pack: ScenarioPack
    answerable: tuple[str, ...]  # 플레이어가 차례로 입력하는 순서
    reachable: frozenset[str]
    unreachable: tuple[str, ...]
    puzzles: dict[str, PackPuzzle]


def build_scenario(pack: ScenarioPack) -> SimScenario:
    puzzles = {p.puzzle_id: p for p in pack.puzzles}
    visible_targets = {
        o.puzzle_id
        for o in pack.objects
        if o.puzzle_id and o.interaction_type == "input" and o.initially_visible
    }
    answerable = tuple(
        p.puzzle_id for p in pack.puzzles if p.puzzle_id in visible_targets
    )
    reachable = set(answerable)
    frontier = list(answerable)
    while frontier:
        for pid in puzzles[frontier.pop()].completes_puzzle_ids:
            if pid not in reachable:
                reachable.add(pid)
                frontier.append(pid)
    return SimScenario(
        pack=pack,
        answerable=answerable,
        reachable=frozenset(reachable),
        unreachable=tuple(
            p.puzzle_id for p in pack.puzzles if p.puzzle_id not in reachable
        ),
        puzzles=puzzles,
    )
