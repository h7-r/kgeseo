"""idmap ↔ FE 로컬 ID 대조 명령(scripts.check_idmap_local_ids). 가상 idmap · 가상 목록만 쓴다."""

import json
from pathlib import Path

import pytest

from scripts import check_idmap_local_ids as cli
from tests.test_publication_gate import LOCAL_IDS, base_documents

KINDS = ("zones", "navigation", "blockers", "objects", "scenes")


def write(path: Path, value) -> str:
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    return str(path)


# 게이트 테스트의 가상 idmap 은 길 · 차단물이 없다. 실제 FE 목록은 다섯 종류가 다 있으므로 하나씩 채운다
# (idmap 에 없는 FE 값이 더 있는 것은 대조에 영향이 없다)
FE_EXTRA = {"navigation": ["T1"], "blockers": ["B1"]}


def fe_list(**overrides) -> dict:
    values = {kind: sorted(LOCAL_IDS.get(kind, ())) or FE_EXTRA[kind] for kind in KINDS}
    values.update(overrides)
    return values


def run(tmp_path, local_ids, *extra, idmap=None) -> tuple[int, str]:
    lines: list[str] = []
    args = cli.parse_args(
        [
            "--idmap",
            write(tmp_path / "idmap.json", idmap or base_documents(1)["idmap"]),
            "--local-ids",
            write(tmp_path / "local.json", local_ids),
            *extra,
        ]
    )
    return cli.run(args, lines.append), "\n".join(lines)


def test_every_idmap_local_is_in_the_fe_list(tmp_path) -> None:
    code, out = run(tmp_path, fe_list())
    assert code == cli.EXIT_OK
    assert "result=OK" in out


def test_missing_fe_ids_are_listed_per_kind(tmp_path) -> None:
    objects = sorted(LOCAL_IDS["objects"])
    dropped = objects[0]
    code, out = run(tmp_path, fe_list(objects=objects[1:], zones=["Z9"]))
    assert code == cli.EXIT_MISSING
    assert f"- LOCAL_ID_NOT_IN_GAME {dropped}" in out
    assert "- LOCAL_ID_NOT_IN_GAME " + sorted(LOCAL_IDS["zones"])[0] in out
    assert "result=MISSING" in out


def test_show_unused_lists_only_scene_group_keys(tmp_path) -> None:
    objects = sorted({*LOCAL_IDS["objects"], "씬9.새무리#0", "자갈#3"})
    code, out = run(tmp_path, fe_list(objects=objects), "--show-unused")
    assert code == cli.EXIT_OK
    assert "· 씬9.새무리#0" in out and "자갈#3" not in out


@pytest.mark.parametrize(
    ("local_ids", "message"),
    [
        ({"zones": ["Z1"]}, "exactly the keys"),
        ({**fe_list(), "rooms": []}, "exactly the keys"),
        (fe_list(scenes=[1]), "list of non-empty strings"),
        (fe_list(objects=["a#0", "a#0"]), "duplicates"),
        (fe_list(navigation=[]), "empty"),
    ],
)
def test_rejects_malformed_local_ids(tmp_path, capsys, local_ids, message) -> None:
    args = [
        "--idmap",
        write(tmp_path / "idmap.json", base_documents(1)["idmap"]),
        "--local-ids",
        write(tmp_path / "local.json", local_ids),
    ]
    assert cli.main(args) == cli.EXIT_INPUT
    assert message in capsys.readouterr().out


def test_rejects_unreadable_files_and_invalid_idmap(tmp_path, capsys) -> None:
    good = write(tmp_path / "local.json", fe_list())
    assert cli.main(["--idmap", str(tmp_path / "none.json"), "--local-ids", good]) == 1
    assert "idmap not readable" in capsys.readouterr().out
    bad = write(tmp_path / "idmap.json", {"schema": "nope"})
    assert cli.main(["--idmap", bad, "--local-ids", good]) == 1
    assert "idmap schema is invalid" in capsys.readouterr().out
