"""나주 idmap 검증기 v0.1 (팀 검토 대기, 로더 · FE · 서비스에 연결하지 않음).

세 가지를 나눠 돌려준다.

- 스키마(`schema_valid`) · 내부 참조(`internal_valid`): 대응표 안의 ID 구조와 서로 간 참조.
- 초안 허용 항목(`pending`): `unplaced` · `placed_no_interaction` · 호스트 없음(`local: null`) ·
  런타임 대응 없는 차단물. 초안에서는 오류가 아니지만 게시를 막는다.
- 게시 가능(`publishable`): **v0.1은 늘 False**. 공식 fingerprint · 버전 로더 · 장면 정의가 없어
  Published 검증을 끝까지 할 수 없다. 막는 까닭은 `publish_blockers`에 코드로 남긴다.

Client · Server 콘텐츠와 나주 로컬 ID 목록을 넘기면 그 범위의 교차 검증도 한다(없으면 미검증으로 표시).
결과에는 코드 · 위치 · ID만 담고 이름 · 제목 · 설명 문장은 담지 않는다.
"""

import re
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import ValidationError

from app.schemas.case_content import CaseClientContent
from app.schemas.naju_idmap import NajuIdmap
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition

# 초안에서 허용하지만 게시를 막는 상태
PENDING_STATUSES = frozenset({"unplaced", "placed_no_interaction"})
# 실행 가능 상태(PM v0.4.1). 물건은 상호작용이, 퍼즐 · 단서는 로컬 호스트가 있어야 실제로 실행 가능하다.
PLACED_STATUS = "placed"
KNOWN_STATUSES = PENDING_STATUSES | {PLACED_STATUS}

OBJECT_LOCAL_KEY = re.compile(r"^(?P<group>.+)#(?P<index>\d+)$")
# rules.object_id: OBJ_S<씬>_<영문 이름>_<로컬 인스턴스 번호>
OBJECT_ID_RULE = re.compile(r"^OBJ_S(?P<scene>\d+)_[A-Z0-9_]+_(?P<index>\d+)$")
LOCAL_GROUP_SCENE = re.compile(r"^씬(?P<scene>\d+)\.")

RUNTIME_PREFIXES = {
    "zone": "ZONE_",
    "scene": "SCENE_",
    "object": "OBJ_",
    "puzzle": "PUZZLE_",
    "clue": "CLUE_",
}

Severity = Literal["error", "pending", "warning"]
IdmapIssueCode = Literal[
    "SCHEMA_INVALID",
    "DUPLICATE_LOCAL_ID",
    "DUPLICATE_RUNTIME_ID",
    "DUPLICATE_SRC_ID",
    "UNKNOWN_LOCAL_ZONE",
    "UNKNOWN_RUNTIME_ZONE",
    "SCENE_ZONE_MISMATCH",
    "OBJECT_ZONE_MISMATCH",
    "UNKNOWN_SCENE",
    "UNKNOWN_PUZZLE_SRC",
    "NAVIGATION_SELF_LOOP",
    "DUPLICATE_NAVIGATION",
    "OBJECT_LOCAL_KEY_INVALID",
    "OBJECT_GROUP_CONFLICT",
    "NOT_MAPPED_CONFLICT",
    "OBJECT_ID_RULE_MISMATCH",
    "OBJECT_SCENE_MISMATCH",
    "OBJECT_ZONE_OUTSIDE_SCENE",
    "RUNTIME_ID_PREFIX",
    "UNKNOWN_STATUS",
    "UNPLACED",
    "PLACED_NO_INTERACTION",
    "PLACED_WITHOUT_INTERACTION",
    "NO_LOCAL_HOST",
    "NO_RUNTIME_TARGET",
    "MISSING_IN_CLIENT",
    "MISSING_IN_SERVER",
    "UNMAPPED_RUNTIME_TARGET",
    "LOCAL_ID_NOT_IN_GAME",
]
PublishBlocker = Literal[
    "SCHEMA_INVALID",
    "INTERNAL_INVALID",
    "STATUS_NOT_PUBLISHED",
    "PENDING_ITEMS",
    "VERSION_HEADER_MISSING",
    "CROSS_CHECK_NOT_RUN",
    "CROSS_CHECK_FAILED",
    "SCENES_UNVERIFIED",
    "LOCAL_IDS_UNVERIFIED",
    "LOCAL_IDS_FAILED",
    "FINGERPRINT_UNVERIFIED",
]


@dataclass(frozen=True)
class IdmapIssue:
    code: IdmapIssueCode
    severity: Severity
    location: str
    reference: str | None = None


@dataclass(frozen=True)
class IdmapReport:
    schema_valid: bool
    internal_valid: bool
    is_draft: bool
    cross_check: Literal["not_run", "run"]
    local_ids_check: Literal["not_run", "run"]
    issues: tuple[IdmapIssue, ...] = field(default_factory=tuple)
    publish_blockers: tuple[PublishBlocker, ...] = field(default_factory=tuple)

    @property
    def publishable(self) -> bool:
        return not self.publish_blockers

    def count(self, code: IdmapIssueCode) -> int:
        return sum(1 for issue in self.issues if issue.code == code)


def validate_idmap(
    raw: Any,
    *,
    client: CaseClientContent | None = None,
    server: PuzzleRuntimeDefinition | None = None,
    local_ids: Mapping[str, Iterable[str]] | None = None,
) -> IdmapReport:
    """`local_ids`: 나주 코드에 실제로 있는 로컬 ID — `{"zones": [...], "navigation": [...],
    "blockers": [...], "objects": [...], "scenes": [...]}`(장면은 번호 문자열). 제공 방식은 미정."""

    try:
        idmap = NajuIdmap.model_validate(raw)
    except ValidationError as error:
        return IdmapReport(
            schema_valid=False,
            internal_valid=False,
            is_draft=True,
            cross_check="not_run",
            local_ids_check="not_run",
            issues=tuple(
                IdmapIssue(
                    "SCHEMA_INVALID",
                    "error",
                    "$." + ".".join(str(part) for part in item["loc"]),
                    item["type"],
                )
                for item in error.errors(include_input=False, include_url=False)
            ),
            publish_blockers=("SCHEMA_INVALID",),
        )

    issues = [*_internal_issues(idmap), *_pending_issues(idmap)]
    internal_valid = not any(issue.severity == "error" for issue in issues)

    cross_issues: list[IdmapIssue] = []
    if client is not None and server is not None:
        cross_issues = _cross_issues(idmap, client, server)
    local_issues: list[IdmapIssue] = []
    if local_ids is not None:
        local_issues = _local_id_issues(idmap, local_ids)
    issues += cross_issues + local_issues

    blockers: list[PublishBlocker] = []
    if not internal_valid:
        blockers.append("INTERNAL_INVALID")
    if not idmap.is_published:
        blockers.append("STATUS_NOT_PUBLISHED")
    if any(issue.severity == "pending" for issue in issues):
        blockers.append("PENDING_ITEMS")
    if idmap.content_version is None or idmap.content_fingerprint is None:
        blockers.append("VERSION_HEADER_MISSING")
    if client is None or server is None:
        blockers.append("CROSS_CHECK_NOT_RUN")
    else:
        if any(issue.severity == "error" for issue in cross_issues):
            blockers.append("CROSS_CHECK_FAILED")
        # Server Runtime에 장면 정의가 없어 scene_id를 대조할 수 없다.
        blockers.append("SCENES_UNVERIFIED")
    if local_ids is None:
        blockers.append("LOCAL_IDS_UNVERIFIED")
    elif local_issues:
        blockers.append("LOCAL_IDS_FAILED")
    # 공식 4파일 fingerprint 계산 · 버전 로더가 없다.
    blockers.append("FINGERPRINT_UNVERIFIED")

    return IdmapReport(
        schema_valid=True,
        internal_valid=internal_valid,
        is_draft=not idmap.is_published,
        cross_check="run" if client is not None and server is not None else "not_run",
        local_ids_check="run" if local_ids is not None else "not_run",
        issues=tuple(issues),
        publish_blockers=tuple(blockers),
    )


def _duplicates(values: Iterable[str]) -> list[str]:
    return [value for value, count in Counter(values).items() if count > 1]


def _internal_issues(idmap: NajuIdmap) -> list[IdmapIssue]:
    issues: list[IdmapIssue] = []

    def error(
        code: IdmapIssueCode, location: str, reference: str | None = None
    ) -> None:
        issues.append(IdmapIssue(code, "error", location, reference))

    def warning(
        code: IdmapIssueCode, location: str, reference: str | None = None
    ) -> None:
        issues.append(IdmapIssue(code, "warning", location, reference))

    # 종류별 로컬 ID 중복 · 런타임 ID 중복
    local_kinds = {
        "zones": [z.local for z in idmap.zones],
        "scenes": [str(s.local) for s in idmap.scenes],
        "navigation": [n.local for n in idmap.navigation],
        "blockers": [b.local for b in idmap.blockers],
        "objects": [o.local for o in idmap.objects],
        "object_groups_without_instances": [
            g.local_group for g in idmap.object_groups_without_instances
        ],
        "not_mapped": [n.local for n in idmap.not_mapped],
    }
    for kind, locals_ in local_kinds.items():
        for value in _duplicates(locals_):
            error("DUPLICATE_LOCAL_ID", f"$.{kind}", value)

    runtime_kinds = {
        "zones": [z.zone_id for z in idmap.zones],
        "scenes": [s.scene_id for s in idmap.scenes],
        # 차단물 · 물건 · 인스턴스 없는 묶음 기반 ID는 같은 Object ID 공간이다.
        "objects": [
            *(o.object_id for o in idmap.objects),
            *(b.object_id for b in idmap.blockers if b.object_id is not None),
            *(g.object_id_base for g in idmap.object_groups_without_instances),
        ],
        "puzzles": [p.puzzle_id for p in idmap.puzzles],
        "clues": [c.clue_id for c in idmap.clues],
    }
    for kind, runtimes in runtime_kinds.items():
        for value in _duplicates(runtimes):
            error("DUPLICATE_RUNTIME_ID", f"$.{kind}", value)

    for kind, src_ids in {
        "scenes": [s.src_id for s in idmap.scenes],
        "puzzles": [p.src_id for p in idmap.puzzles],
        "clues": [c.src_id for c in idmap.clues],
    }.items():
        for value in _duplicates(src_ids):
            error("DUPLICATE_SRC_ID", f"$.{kind}", value)

    zone_map = {z.local: z.zone_id for z in idmap.zones}
    runtime_zones = set(zone_map.values())
    scene_locals = {s.local for s in idmap.scenes}
    scene_ids = {s.scene_id for s in idmap.scenes}
    scene_zones = {s.local: set(s.zones) for s in idmap.scenes}

    for index, scene in enumerate(idmap.scenes):
        where = f"$.scenes.{index}"
        for local in scene.zones:
            if local not in zone_map:
                error("UNKNOWN_LOCAL_ZONE", f"{where}.zones", local)
        for runtime in scene.zone_ids:
            if runtime not in runtime_zones:
                error("UNKNOWN_RUNTIME_ZONE", f"{where}.zone_ids", runtime)
        if (
            all(local in zone_map for local in scene.zones)
            and [zone_map[local] for local in scene.zones] != scene.zone_ids
        ):
            error("SCENE_ZONE_MISMATCH", where, scene.scene_id)

    pairs: list[str] = []
    for index, nav in enumerate(idmap.navigation):
        where = f"$.navigation.{index}"
        for side, local in (("from", nav.from_zone), ("to", nav.to_zone)):
            if local not in zone_map:
                error("UNKNOWN_LOCAL_ZONE", f"{where}.{side}", local)
        if nav.from_zone == nav.to_zone:
            error("NAVIGATION_SELF_LOOP", where, nav.local)
        pairs.append(f"{nav.from_zone}->{nav.to_zone}")
    for value in _duplicates(pairs):
        error("DUPLICATE_NAVIGATION", "$.navigation", value)

    groups_without = {g.local_group for g in idmap.object_groups_without_instances}
    for index, obj in enumerate(idmap.objects):
        where = f"$.objects.{index}"
        if obj.zone not in zone_map:
            error("UNKNOWN_LOCAL_ZONE", f"{where}.zone", obj.zone)
        elif zone_map[obj.zone] != obj.zone_id:
            error("OBJECT_ZONE_MISMATCH", where, obj.object_id)
        if obj.zone_id not in runtime_zones:
            error("UNKNOWN_RUNTIME_ZONE", f"{where}.zone_id", obj.zone_id)
        if obj.scene not in scene_locals:
            error("UNKNOWN_SCENE", f"{where}.scene", str(obj.scene))
        elif obj.zone not in scene_zones[obj.scene]:
            # PM 확인 대상(예: 씬2 물건이 씬2 무대 밖 구역에 놓임). 판정은 하지 않고 알린다.
            warning("OBJECT_ZONE_OUTSIDE_SCENE", where, obj.object_id)
        key = OBJECT_LOCAL_KEY.fullmatch(obj.local)
        if key is None:
            error("OBJECT_LOCAL_KEY_INVALID", f"{where}.local", obj.object_id)
            continue
        if key["group"] in groups_without:
            error("OBJECT_GROUP_CONFLICT", f"{where}.local", obj.object_id)
        group_scene = LOCAL_GROUP_SCENE.match(key["group"])
        if group_scene is not None and int(group_scene["scene"]) != obj.scene:
            warning("OBJECT_SCENE_MISMATCH", where, obj.object_id)
        rule = OBJECT_ID_RULE.fullmatch(obj.object_id)
        if (
            rule is None
            or int(rule["scene"]) != obj.scene
            or rule["index"] != key["index"]
        ):
            warning("OBJECT_ID_RULE_MISMATCH", f"{where}.object_id", obj.object_id)

    for index, puzzle in enumerate(idmap.puzzles):
        if puzzle.scene_id not in scene_ids:
            error("UNKNOWN_SCENE", f"$.puzzles.{index}.scene_id", puzzle.scene_id)
    puzzle_srcs = {p.src_id for p in idmap.puzzles}
    for index, clue in enumerate(idmap.clues):
        if clue.puzzle_src_id not in puzzle_srcs:
            error(
                "UNKNOWN_PUZZLE_SRC",
                f"$.clues.{index}.puzzle_src_id",
                clue.puzzle_src_id,
            )

    # 보내지 않는 로컬 상태가 다른 곳에서 매핑되면 서버로 나갈 수 있다.
    mapped_locals = {
        *zone_map,
        *(n.local for n in idmap.navigation),
        *(b.local for b in idmap.blockers),
        *(o.local for o in idmap.objects),
        *(p.local for p in idmap.puzzles if p.local is not None),
        *(c.local for c in idmap.clues if c.local is not None),
    }
    for index, item in enumerate(idmap.not_mapped):
        if item.local in mapped_locals:
            error("NOT_MAPPED_CONFLICT", f"$.not_mapped.{index}", item.local)

    # v0.3 §2 런타임 ID 접두어 규칙(🟡 제안) — 경고만
    for kind, values in (
        ("zone", runtime_kinds["zones"]),
        ("scene", runtime_kinds["scenes"]),
        ("object", runtime_kinds["objects"]),
        ("puzzle", runtime_kinds["puzzles"]),
        ("clue", runtime_kinds["clues"]),
    ):
        for value in values:
            if not value.startswith(RUNTIME_PREFIXES[kind]):
                warning("RUNTIME_ID_PREFIX", f"$.{kind}", value)
    return issues


def _pending_issues(idmap: NajuIdmap) -> list[IdmapIssue]:
    issues: list[IdmapIssue] = []
    for section, items, id_attr in (
        ("objects", idmap.objects, "object_id"),
        ("puzzles", idmap.puzzles, "puzzle_id"),
        ("clues", idmap.clues, "clue_id"),
    ):
        for index, item in enumerate(items):
            where = f"$.{section}.{index}"
            ref = getattr(item, id_attr)
            if item.status == "unplaced":
                issues.append(IdmapIssue("UNPLACED", "pending", where, ref))
            elif item.status == "placed_no_interaction":
                issues.append(
                    IdmapIssue("PLACED_NO_INTERACTION", "pending", where, ref)
                )
            elif item.status not in KNOWN_STATUSES:
                issues.append(IdmapIssue("UNKNOWN_STATUS", "pending", where, ref))
            elif section == "objects" and item.interaction is None:
                # placed라고 적었지만 상호작용이 없다 → 실행 불가
                issues.append(
                    IdmapIssue("PLACED_WITHOUT_INTERACTION", "pending", where, ref)
                )
            if (
                section != "objects"
                and item.local is None
                and item.status != "unplaced"
            ):
                issues.append(IdmapIssue("NO_LOCAL_HOST", "pending", where, ref))
    for index, blocker in enumerate(idmap.blockers):
        if blocker.object_id is None:
            issues.append(
                IdmapIssue(
                    "NO_RUNTIME_TARGET", "pending", f"$.blockers.{index}", blocker.local
                )
            )
    return issues


def _cross_issues(
    idmap: NajuIdmap, client: CaseClientContent, server: PuzzleRuntimeDefinition
) -> list[IdmapIssue]:
    issues: list[IdmapIssue] = []
    if client.case_id != idmap.case_id or server.case_id != idmap.case_id:
        issues.append(
            IdmapIssue("MISSING_IN_SERVER", "error", "$.case_id", idmap.case_id)
        )
    client_zones = {zone.zone_id for zone in client.zones}
    client_objects = {
        (zone.zone_id, obj.object_id) for zone in client.zones for obj in zone.objects
    }
    client_object_ids = {object_id for _, object_id in client_objects}
    for index, zone in enumerate(idmap.zones):
        if zone.zone_id not in client_zones:
            issues.append(
                IdmapIssue(
                    "MISSING_IN_CLIENT", "error", f"$.zones.{index}", zone.zone_id
                )
            )
    for index, obj in enumerate(idmap.objects):
        if (obj.zone_id, obj.object_id) not in client_objects:
            issues.append(
                IdmapIssue(
                    "MISSING_IN_CLIENT", "error", f"$.objects.{index}", obj.object_id
                )
            )
    for index, blocker in enumerate(idmap.blockers):
        if blocker.object_id is not None and blocker.object_id not in client_object_ids:
            issues.append(
                IdmapIssue(
                    "MISSING_IN_CLIENT",
                    "error",
                    f"$.blockers.{index}",
                    blocker.object_id,
                )
            )
    server_puzzles = {p.puzzle_id for p in server.puzzles}
    server_clues = {c.clue_id for c in server.clues}
    for index, puzzle in enumerate(idmap.puzzles):
        if puzzle.puzzle_id not in server_puzzles:
            issues.append(
                IdmapIssue(
                    "MISSING_IN_SERVER", "error", f"$.puzzles.{index}", puzzle.puzzle_id
                )
            )
    for index, clue in enumerate(idmap.clues):
        if clue.clue_id not in server_clues:
            issues.append(
                IdmapIssue(
                    "MISSING_IN_SERVER", "error", f"$.clues.{index}", clue.clue_id
                )
            )
    # 나주 상호작용이 필요한 런타임 대상(구역 · 상호작용 있는 물건)이 대응표에 있는지(v0.4 §11 ①)
    mapped_zones = {z.zone_id for z in idmap.zones}
    mapped_objects = {(o.zone_id, o.object_id) for o in idmap.objects} | {
        (zone_id, b.object_id)
        for b in idmap.blockers
        if b.object_id is not None
        for zone_id, object_id in client_objects
        if object_id == b.object_id
    }
    for zone in client.zones:
        if zone.zone_id not in mapped_zones:
            issues.append(
                IdmapIssue("UNMAPPED_RUNTIME_TARGET", "error", "$.zones", zone.zone_id)
            )
        for obj in zone.objects:
            if (zone.zone_id, obj.object_id) not in mapped_objects:
                issues.append(
                    IdmapIssue(
                        "UNMAPPED_RUNTIME_TARGET", "error", "$.objects", obj.object_id
                    )
                )
    return issues


def _local_id_issues(
    idmap: NajuIdmap, local_ids: Mapping[str, Iterable[str]]
) -> list[IdmapIssue]:
    known = {kind: set(values) for kind, values in local_ids.items()}
    issues: list[IdmapIssue] = []
    for kind, values in (
        ("zones", [z.local for z in idmap.zones]),
        ("navigation", [n.local for n in idmap.navigation]),
        ("blockers", [b.local for b in idmap.blockers]),
        ("objects", [o.local for o in idmap.objects]),
        ("scenes", [str(s.local) for s in idmap.scenes]),
    ):
        game = known.get(kind)
        for value in values:
            if game is None or value not in game:
                issues.append(
                    IdmapIssue("LOCAL_ID_NOT_IN_GAME", "error", f"$.{kind}", value)
                )
    return issues


class IdmapLookup:
    """FE 어댑터 경계용 변환 표. 내부 참조가 유효한 대응표로만 만든다.

    서버로 보낼 수 있는 것만 정방향 변환한다. 물건은 `status="placed"`이고 상호작용이 있을 때만이다.
    `not_mapped` · 런타임 대응 없음 · 상호작용 없는 물건 · `unplaced`/`placed_no_interaction` · 모르는 상태는
    None(보내지 않음)이다. 매핑에 없는 로컬 ID를 만들어 내지 않는다.
    """

    def __init__(self, idmap: NajuIdmap) -> None:
        report = validate_idmap(idmap.model_dump(by_alias=True))
        if not report.internal_valid:
            raise ValueError("idmap internal references are invalid")
        self._not_mapped = {item.local for item in idmap.not_mapped}
        self._zones = {z.local: z.zone_id for z in idmap.zones}
        self._objects = {
            o.local: (o.zone_id, o.object_id)
            for o in idmap.objects
            if o.interaction is not None and o.status == PLACED_STATUS
        }
        self._blockers = {
            b.local: b.object_id for b in idmap.blockers if b.object_id is not None
        }
        self._zone_locals = {runtime: local for local, runtime in self._zones.items()}
        self._scene_locals = {s.scene_id: s.local for s in idmap.scenes}
        self._object_locals = {o.object_id: o.local for o in idmap.objects}

    def is_not_mapped(self, local: str) -> bool:
        return local in self._not_mapped

    def runtime_zone(self, local: str) -> str | None:
        return None if local in self._not_mapped else self._zones.get(local)

    def runtime_object(self, local: str) -> tuple[str, str] | None:
        return None if local in self._not_mapped else self._objects.get(local)

    def runtime_blocker(self, local: str) -> str | None:
        return None if local in self._not_mapped else self._blockers.get(local)

    def local_zone(self, zone_id: str) -> str | None:
        return self._zone_locals.get(zone_id)

    def local_scene(self, scene_id: str) -> int | None:
        return self._scene_locals.get(scene_id)

    def local_object(self, object_id: str) -> str | None:
        return self._object_locals.get(object_id)
