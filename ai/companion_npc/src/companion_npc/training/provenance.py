"""재현 정보 · 커밋용 핵심 지표 요약.

[원본과 요약]
  runs/p3/<exp_id>/results.json       원본 — 사건·seed·기준선·cooldown·실행 방식별 세부 지표 전부 (깃 제외)
  experiments/results/<exp_id>/metrics.json  요약 — 핵심 지표 + 재현 정보 (커밋)
  요약에는 원본 파일의 sha256 을 적어, 어느 원본에서 나온 것인지 잇는다.
"""

import hashlib
import json
import platform
import subprocess
from importlib.metadata import version
from pathlib import Path
from typing import Any

import numpy as np

from companion_npc.adapters.case_content import canonical_sha256
from companion_npc.features.schema import FEATURE_SET_VERSION
from companion_npc.simulation.config import SimulationConfig
from companion_npc.training.dataset import LABEL, PROXY_LABEL, ExampleSet

PACKAGES = ("pydantic", "numpy", "scipy", "scikit-learn", "lightgbm")


def _git(root: Path, *args: str) -> str | None:
    try:
        return subprocess.run(
            ["git", *args],
            cwd=root,
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


def examples_digest(examples: ExampleSet) -> str:
    """ExampleSet 의 모델 입력·라벨·묶음 키 해시 — 같은 seed 로 다시 만들면 같아야 한다."""

    h = hashlib.sha256()
    for array in (examples.X, examples.y, examples.proxy, examples.t):
        h.update(np.ascontiguousarray(array).tobytes())
    h.update("\n".join(examples.session.astype(str)).encode())
    h.update("\n".join(examples.case.astype(str)).encode())
    return h.hexdigest()


def source_sha256(root: Path) -> str:
    """src/companion_npc 아래 .py 전체의 해시 — 커밋 전 실행이어도 코드 판을 특정한다.

    줄바꿈(CRLF/LF)에 흔들리지 않게 LF 로 맞춘 뒤 잰다.
    """

    h = hashlib.sha256()
    for path in sorted((root / "src" / "companion_npc").rglob("*.py")):
        h.update(path.relative_to(root).as_posix().encode())
        h.update(path.read_bytes().replace(b"\r\n", b"\n"))
    return h.hexdigest()


def provenance(
    config_dump: dict[str, Any],
    base: SimulationConfig,
    shifted: SimulationConfig | None,
    packs: dict[str, dict[str, str | None]],
    root: Path,
) -> dict[str, Any]:
    status = _git(root, "status", "--porcelain", "--", ".")
    return {
        "experiment_config_sha256": canonical_sha256(config_dump),
        "simulation_config_sha256": canonical_sha256(base.model_dump(mode="json")),
        "shifted_simulation_config_sha256": (
            canonical_sha256(shifted.model_dump(mode="json")) if shifted else None
        ),
        "generator_version": base.generator_version,
        "feature_set_version": FEATURE_SET_VERSION,
        "label": LABEL,
        "comparison_label": PROXY_LABEL,
        "cases": packs,
        "source_sha256": source_sha256(root),
        "git_commit": _git(root, "rev-parse", "HEAD"),
        # ai/companion_npc 아래에 커밋 안 된 변경이 있었는가 — 있으면 커밋만으로는 재현이 안 된다
        "git_dirty": bool(status) if status is not None else None,
        "python": platform.python_version(),
        "packages": {name: version(name) for name in PACKAGES},
    }


def _policy_core(report: dict[str, Any]) -> dict[str, Any]:
    alerts = report["alerts"]
    return {
        "alerts_per_session": report["alerts_per_session"],
        "unnecessary_per_10min_exploring": report["unnecessary_per_10min_exploring"],
        "within_budget": report["within_budget"],
        "stuck_episode_detection_rate": report["stuck_episode_detection_rate"],
        "latency_median_sec": report["latency_to_first_alert_sec"]["median"],
        "away_alerts": report["away_alerts"],
        "post_termination_alerts": report["post_termination_alerts"],
        "post_termination_alert_share": (
            round(report["post_termination_alerts"] / alerts, 4) if alerts else None
        ),
    }


def _entry_core(entry: dict[str, Any], with_policy: bool = True) -> dict[str, Any]:
    """기본 cooldown(60초)은 두 실행 모두, 비교 cooldown 은 관측 가능 실행의 3개 지표만."""

    c = entry["classification"]
    core: dict[str, Any] = {
        "classification": {
            k: c[k]
            for k in (
                "precision",
                "recall",
                "f1",
                "average_precision",
                "false_discovery_rate",
                "false_positive_rate",
            )
        }
    }
    if with_policy:
        policy: dict[str, Any] = {}
        for cooldown, views in entry["policy"].items():
            if cooldown == "cooldown_60s":
                policy[cooldown] = {
                    view: _policy_core(rep) for view, rep in views.items()
                }
            else:
                obs = _policy_core(views["observable"])
                policy[cooldown] = {
                    "observable": {
                        k: obs[k]
                        for k in (
                            "unnecessary_per_10min_exploring",
                            "stuck_episode_detection_rate",
                            "post_termination_alert_share",
                        )
                    }
                }
        core["policy"] = policy
    if "selected" in entry:
        core["selected"] = entry["selected"]
    if "parameter_shift" in entry:
        shift = entry["parameter_shift"]
        core["parameter_shift"] = {
            "f1": shift["classification"]["f1"],
            "observable_cooldown_60s": _policy_core(
                shift["policy"]["cooldown_60s"]["observable"]
            ),
        }
    return core


def metrics_summary(results: dict[str, Any], results_path: Path) -> dict[str, Any]:
    """커밋용 요약. 원본 results.json 의 sha256 으로 원본과 잇는다."""

    seeds = {}
    for seed, seed_result in results["seeds"].items():
        seeds[seed] = {
            "data_sha256": seed_result["data_sha256"],
            "stats": seed_result["stats"],
            "folds": {
                case: {
                    "leak_check": fold["leak_check"],
                    # thin 전략은 규칙이 같으면 정책 결과도 같다 — 분류·선택만 남긴다
                    "baselines": {
                        name: _entry_core(e, with_policy="thin" not in name)
                        for name, e in fold["baselines"].items()
                    },
                    "generator_reference_oracle": _entry_core(
                        fold["generator_reference"]
                    ),
                }
                for case, fold in seed_result["folds"].items()
            },
        }
    return {
        "exp_id": results["exp_id"],
        "representative": False,
        "note": results["note"],
        "oracle_note": "generator_reference_oracle 는 Oracle(유형)을 쓰는 참고 기준선이다. 운영에 적용할 수 없고 성능 상한선이 아니다.",
        "config": results["config"],
        "provenance": results["provenance"],
        "raw_results": {
            "path": "runs/p3/" + results["exp_id"] + "/results.json (깃 제외)",
            "sha256": hashlib.sha256(results_path.read_bytes()).hexdigest(),
        },
        "seeds": seeds,
    }


def dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
