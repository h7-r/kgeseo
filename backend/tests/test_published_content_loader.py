import json
from pathlib import Path
from typing import Any

import pytest

from app.main import app
from app.services.pinned_content import ContentPin, PinnedContentStore
from app.services.published_content_loader import (
    BundleFileMissingError,
    InvalidBundleLocationError,
    load_and_publish,
    read_bundle_snapshot,
)
from tests.test_publication_gate import (
    ANSWER,
    CASE_ID,
    LOCAL_IDS,
    approvals_for,
    base_documents,
    hint_source,
    seal,
)

# 테스트 전용 임시 디렉터리만 쓴다. 실제 게시 디렉터리 · PM 콘텐츠가 아니다.


def write_bundle(
    root: Path,
    files: dict[str, bytes | None],
    *,
    case_id: str = CASE_ID,
    version: int = 1,
) -> Path:
    directory = root / case_id / f"v{version}"
    directory.mkdir(parents=True)
    for role, content in files.items():
        if content is not None:
            (directory / f"{role}.json").write_bytes(content)
    return directory


def non_scene_bundle(
    version: int = 1, **kwargs: Any
) -> tuple[dict[str, bytes | None], str]:
    documents = base_documents(version, **kwargs)
    del documents["idmap"]
    files, fingerprint = seal(documents)
    return {**files, "idmap": None}, fingerprint


def publish(
    root: Path,
    fingerprint: str | None,
    *,
    version: int = 1,
    case_id: str = CASE_ID,
    **overrides,
):
    kwargs: dict[str, Any] = {
        "hint_source": hint_source,
        "approval_source": approvals_for(fingerprint) if fingerprint else None,
        "ng_checker": lambda text: False,
        "local_ids": LOCAL_IDS,
        "store": PinnedContentStore(),
    }
    kwargs.update(overrides)
    return load_and_publish(root, case_id, version, **kwargs), kwargs["store"]


# --- 정상 ---


def test_valid_bundle_is_loaded_validated_and_registered(tmp_path: Path) -> None:
    files, fingerprint = non_scene_bundle()
    write_bundle(tmp_path, files)

    outcome, store = publish(tmp_path, fingerprint)

    assert outcome.registered is True
    assert outcome.publication.approved is True
    assert outcome.snapshot.files["idmap"] is None
    assert store.get(ContentPin(CASE_ID, 1, fingerprint)).server().case_id == CASE_ID


def test_snapshot_is_read_only_and_exact(tmp_path: Path) -> None:
    files, _ = non_scene_bundle()
    write_bundle(tmp_path, files)

    snapshot = read_bundle_snapshot(tmp_path, CASE_ID, 1)

    assert dict(snapshot.files) == files
    with pytest.raises(TypeError):
        snapshot.files["client"] = b"{}"  # type: ignore[index]


# --- 게이트 정책 그대로 ---


def test_missing_approval_source_registers_nothing(tmp_path: Path) -> None:
    files, _ = non_scene_bundle()
    write_bundle(tmp_path, files)

    outcome, store = publish(tmp_path, None)

    assert outcome.publication.check("APPROVALS").status == "FAIL"
    assert outcome.registered is False
    assert store.versions(CASE_ID) == ()


def test_missing_ng_checker_registers_nothing(tmp_path: Path) -> None:
    files, fingerprint = non_scene_bundle()
    write_bundle(tmp_path, files)

    outcome, store = publish(tmp_path, fingerprint, ng_checker=None)

    assert outcome.publication.check("NG").status == "UNVERIFIED"
    assert store.versions(CASE_ID) == ()


def test_fingerprint_mismatch_registers_nothing(tmp_path: Path) -> None:
    files, fingerprint = non_scene_bundle()
    tampered = json.loads(files["server"])
    tampered["puzzles"][0]["accepted_answers"] = ["가상정답이"]
    write_bundle(
        tmp_path, {**files, "server": json.dumps(tampered, ensure_ascii=False).encode()}
    )

    outcome, store = publish(tmp_path, fingerprint)

    assert outcome.publication.check("HEADER").status == "FAIL"
    assert store.versions(CASE_ID) == ()


@pytest.mark.parametrize(
    "broken", [b'{"a": 1, "a": 2}', b"{", b"\xef\xbb\xbf{}", b'{"a": NaN}']
)
def test_corrupt_json_registers_nothing(tmp_path: Path, broken: bytes) -> None:
    files, fingerprint = non_scene_bundle()
    write_bundle(tmp_path, {**files, "npc": broken})

    outcome, store = publish(tmp_path, fingerprint)

    assert outcome.publication.check("PARSE").status == "FAIL"
    assert store.versions(CASE_ID) == ()


@pytest.mark.parametrize("role", ["client", "server", "npc"])
def test_missing_required_file_is_rejected(tmp_path: Path, role: str) -> None:
    files, fingerprint = non_scene_bundle()
    write_bundle(tmp_path, {**files, role: None})
    store = PinnedContentStore()

    with pytest.raises(BundleFileMissingError) as raised:
        publish(tmp_path, fingerprint, store=store)

    assert str(raised.value) == f"{CASE_ID}@v1:{role}"
    assert store.versions(CASE_ID) == ()


def test_directory_must_match_file_headers(tmp_path: Path) -> None:
    files, fingerprint = non_scene_bundle(version=1)
    write_bundle(tmp_path, files, version=2)  # v2 폴더에 v1 파일

    outcome, store = publish(tmp_path, fingerprint, version=2)

    assert outcome.location_mismatch == "content_version"
    assert outcome.publication is None
    assert store.versions(CASE_ID) == ()


# --- 경로 ---


@pytest.mark.parametrize(
    "case_id", ["../escape", "..", "a/b", "a\\b", "", "case 1", "케이스"]
)
def test_invalid_case_id_or_traversal_is_rejected(tmp_path: Path, case_id: str) -> None:
    with pytest.raises(InvalidBundleLocationError):
        read_bundle_snapshot(tmp_path / "published", case_id, 1)


@pytest.mark.parametrize("version", [0, -1, True, "1", 1.0, None])
def test_invalid_version_is_rejected(tmp_path: Path, version: Any) -> None:
    with pytest.raises(InvalidBundleLocationError):
        read_bundle_snapshot(tmp_path, CASE_ID, version)


def test_linked_directory_outside_root_is_rejected(tmp_path: Path) -> None:
    root = tmp_path / "published"
    (root / CASE_ID).mkdir(parents=True)
    outside = tmp_path / "outside"
    files, _ = non_scene_bundle()
    write_bundle(outside, files)
    try:
        (root / CASE_ID / "v1").symlink_to(
            outside / CASE_ID / "v1", target_is_directory=True
        )
    except OSError:
        pytest.skip("이 환경에서는 심볼릭 링크를 만들 수 없다")

    with pytest.raises(InvalidBundleLocationError):
        read_bundle_snapshot(root, CASE_ID, 1)


# --- 버전 보존 · 스냅샷 ---


def test_same_version_cannot_be_registered_again(tmp_path: Path) -> None:
    store = PinnedContentStore()
    files, fingerprint = non_scene_bundle()
    write_bundle(tmp_path, files)
    assert publish(tmp_path, fingerprint, store=store)[0].registered is True

    other_root = tmp_path / "other"
    changed = base_documents(1)
    del changed["idmap"]
    changed["npc"]["general_nudges"][0]["text"] = "(가상) 다른 문장."
    changed_files, changed_fp = seal(changed)
    write_bundle(other_root, {**changed_files, "idmap": None})

    again, _ = publish(other_root, changed_fp, store=store)

    assert again.publication.check("VERSION_ORDER").status == "FAIL"
    assert again.registered is False
    assert (
        store.get(ContentPin(CASE_ID, 1, fingerprint)).npc().general_nudges[0].text
        == "(가상) 둘러보자."
    )


def test_versions_are_kept_independently(tmp_path: Path) -> None:
    store = PinnedContentStore()
    v1, v1_fp = non_scene_bundle(1)
    v2_docs = base_documents(2)
    del v2_docs["idmap"]
    v2_docs["server"]["puzzles"][0]["accepted_answers"] = ["가상정답이"]
    v2, v2_fp = seal(v2_docs)
    write_bundle(tmp_path, v1, version=1)
    write_bundle(tmp_path, {**v2, "idmap": None}, version=2)

    assert publish(tmp_path, v1_fp, version=1, store=store)[0].registered is True
    assert publish(tmp_path, v2_fp, version=2, store=store)[0].registered is True

    assert store.versions(CASE_ID) == (1, 2)
    assert store.get(ContentPin(CASE_ID, 1, v1_fp)).server().puzzles[
        0
    ].accepted_answers == [ANSWER]
    assert store.get(ContentPin(CASE_ID, 2, v2_fp)).server().puzzles[
        0
    ].accepted_answers == ["가상정답이"]


def test_registered_bundle_uses_snapshot_even_if_files_change_during_validation(
    tmp_path: Path,
) -> None:
    files, fingerprint = non_scene_bundle()
    directory = write_bundle(tmp_path, files)
    tampered = json.loads(files["server"])
    tampered["puzzles"][0]["accepted_answers"] = ["바꿔치기"]

    def hint_source_that_rewrites_disk(case_id: str, puzzle_id: str, level: int):
        # 게이트가 검증하는 도중에 디스크 파일을 바꾼다.
        (directory / "server.json").write_text(
            json.dumps(tampered, ensure_ascii=False), "utf-8"
        )
        return hint_source(case_id, puzzle_id, level)

    outcome, store = publish(
        tmp_path, fingerprint, hint_source=hint_source_that_rewrites_disk
    )

    assert outcome.registered is True
    assert outcome.snapshot.files["server"] == files["server"]
    registered = store.get(ContentPin(CASE_ID, 1, fingerprint))
    assert registered.server().puzzles[0].accepted_answers == [ANSWER]


# --- 나주 Draft · 레거시 · HTTP ---


def test_naju_bundle_without_scene_verification_is_not_registered(
    tmp_path: Path,
) -> None:
    documents = base_documents(case_id="naju-angam-01")
    documents["idmap"]["status"] = "draft"
    files, fingerprint = seal(documents)
    write_bundle(tmp_path, files, case_id="naju-angam-01")

    outcome, store = publish(
        tmp_path,
        fingerprint,
        case_id="naju-angam-01",
        hint_source=lambda c, p, level: hint_source(CASE_ID, p, level),
    )

    assert outcome.publication.check("SCENES").status == "UNVERIFIED"
    assert outcome.registered is False
    assert store.versions("naju-angam-01") == ()


def test_loader_does_not_touch_legacy_flat_case_files(tmp_path: Path) -> None:
    # case_001은 버전 폴더가 없다 → 이 로더로는 읽을 수 없고, 기존 평면 파일 로더는 그대로다.
    cases_dir = Path(__file__).resolve().parents[1] / "app" / "content"
    with pytest.raises(BundleFileMissingError):
        read_bundle_snapshot(cases_dir, "cases", 1)
    with pytest.raises(BundleFileMissingError):
        read_bundle_snapshot(tmp_path, "case_001", 1)


def test_loader_is_not_exposed_over_http() -> None:
    import app.api.v1 as api_package

    api_dir = Path(api_package.__file__).resolve().parent
    sources = "\n".join(
        path.read_text(encoding="utf-8") for path in api_dir.glob("*.py")
    )

    assert "published_content_loader" not in sources
    assert "load_and_publish" not in sources
    assert not [r.path for r in app.routes if "publish" in getattr(r, "path", "")]
