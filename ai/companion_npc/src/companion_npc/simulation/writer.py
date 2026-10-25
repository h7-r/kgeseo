"""합성 데이터 생성 · 파일 쓰기.

파일 (모두 정규화 JSON — key 정렬, LF):
  interaction_events.jsonl          운영 interaction_events 와 같은 형식. 모델 입력 경로는 이것만 읽는다
  session_truth.jsonl               합성 정답 — 유형 · 결과 · 자연 종료 시각
  latent_segments.jsonl             합성 정답 — 잠재 상태 구간
  synthetic_exploration_events.jsonl  선택. 합성 inspect·navigate (운영 이벤트와 섞지 않는다)
  manifest.json                     representative: false · 시드 · 설정 해시 · 파일 해시

만든 시각(wall clock)은 넣지 않는다 — 같은 시드에서 바이트까지 같아야 하기 때문이다.
"""

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from companion_npc.adapters import convert_case, load_case_sources
from companion_npc.adapters.case_content import canonical_sha256
from companion_npc.contracts.scenario_pack import ScenarioPack
from companion_npc.simulation.config import ARCHETYPES, SimulationConfig
from companion_npc.simulation.engine import SessionOutput, simulate_session
from companion_npc.simulation.scenario import SimScenario, build_scenario

FILES = (
    "interaction_events.jsonl",
    "session_truth.jsonl",
    "latent_segments.jsonl",
    "synthetic_exploration_events.jsonl",
)


def load_config(path: Path) -> SimulationConfig:
    raw = json.loads(path.read_text(encoding="utf-8"))
    # "_" 로 시작하는 key 는 사람이 읽는 메모다
    return SimulationConfig.model_validate(
        {k: v for k, v in raw.items() if not k.startswith("_")}
    )


def load_scenarios(config: SimulationConfig, root: Path) -> dict[str, SimScenario]:
    """P2-A 변환기로 팩을 만든다. 정답은 변환기의 누설 검사에만 쓰이고 시뮬레이터에는 오지 않는다."""

    scenarios = {}
    for source in config.cases:
        sources = load_case_sources(root / source.cases_dir, source.case_id)
        pack: ScenarioPack = convert_case(
            sources.client, sources.server, client_ref=f"{source.case_id}.client.json"
        ).pack
        scenarios[source.case_id] = build_scenario(pack)
    return scenarios


@dataclass(frozen=True)
class Dataset:
    config: SimulationConfig
    scenarios: dict[str, SimScenario]
    outputs: list[SessionOutput]


def generate(config: SimulationConfig, scenarios: dict[str, SimScenario]) -> Dataset:
    outputs = [
        simulate_session(scenarios[source.case_id], config, archetype, index)
        for source in config.cases
        for archetype in ARCHETYPES
        for index in range(config.sessions_per_case_archetype)
    ]
    return Dataset(config=config, scenarios=scenarios, outputs=outputs)


def _line(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def dataset_lines(dataset: Dataset) -> dict[str, list[str]]:
    outs = dataset.outputs
    lines = {
        "interaction_events.jsonl": [_line(r) for o in outs for r in o.rows],
        "session_truth.jsonl": [_line(o.truth.model_dump(mode="json")) for o in outs],
        "latent_segments.jsonl": [
            _line(s.model_dump(mode="json")) for o in outs for s in o.segments
        ],
    }
    if dataset.config.emit_exploration_events:
        lines["synthetic_exploration_events.jsonl"] = [
            _line(e.model_dump(mode="json")) for o in outs for e in o.exploration
        ]
    return lines


def manifest(dataset: Dataset, lines: dict[str, list[str]]) -> dict[str, Any]:
    return {
        "representative": False,
        "purpose": "학습 파이프라인 기능 검증용 합성 데이터. 실제 플레이어 행동 분포를 대표하지 않는다.",
        "parameters_note": "유형별 매개변수는 관찰 근거가 없는 초기 가정값이다.",
        "generator_version": dataset.config.generator_version,
        "seed": dataset.config.seed,
        "config_sha256": canonical_sha256(dataset.config.model_dump(mode="json")),
        "sessions": len(dataset.outputs),
        "cases": [
            {
                "case_id": case_id,
                "pack_id": s.pack.pack_id,
                "client_content_sha256": s.pack.source.client_content_sha256,
                "server_runtime_sha256": s.pack.source.server_runtime_sha256,
                "answerable_puzzle_ids": list(s.answerable),
                "reachable_puzzle_ids": sorted(s.reachable),
                "unreachable_puzzle_ids": list(s.unreachable),
            }
            for case_id, s in dataset.scenarios.items()
        ],
        "files": {
            name: {
                "lines": len(content),
                "sha256": hashlib.sha256(
                    ("\n".join(content) + "\n").encode()
                ).hexdigest(),
            }
            for name, content in lines.items()
        },
        "model_input_files": ["interaction_events.jsonl"],
        "truth_files": ["session_truth.jsonl", "latent_segments.jsonl"],
        "non_operational_files": ["synthetic_exploration_events.jsonl"],
    }


def write_dataset(dataset: Dataset, out_dir: Path) -> dict[str, Any]:
    lines = dataset_lines(dataset)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, content in lines.items():
        (out_dir / name).write_text(
            "\n".join(content) + "\n", encoding="utf-8", newline="\n"
        )
    meta = manifest(dataset, lines)
    (out_dir / "manifest.json").write_text(
        json.dumps(meta, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return meta
