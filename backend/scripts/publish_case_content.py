"""케이스 콘텐츠 게시 내부 관리 명령(CLI) v0.1 (인증 운영 전 전용, 팀 검토 대기).

    .\\.venv\\Scripts\\python.exe -m scripts.publish_case_content \\
        --case-id naju-angam-01 --content-version 1 --content-root <게시 루트> \\
        [--local-ids <FE 로컬 ID JSON>]                    # idmap 이 있는 케이스는 없으면 LOCAL_IDS UNVERIFIED
        [--db]                                             # 대상 DB 승인 이력 · 게시 상태 · 이전 버전으로 판정(읽기 전용)
        [--commit --confirm-db <DB 이름> --actor <실행자> --reason <근거>]   # 실제 게시

- 판정은 모두 기존 게시 게이트(`publication_gate.evaluate_publication`)가 한다. 이 명령은 게이트 결과를 고치거나
  통과로 바꾸지 않는다. `FAIL` · `UNVERIFIED`가 하나라도 있으면 게시하지 않는다(`NON_BLOCKING_STATUSES`).
- 기본은 dry-run이다. DB에 접속하지 않으므로 승인(G1~G3)은 확인할 수 없어 `APPROVALS: FAIL`로 나온다(「승인 미확인」).
- `--db`는 실제 게시(`NpcPublicationService._publish`)와 같은 입력 — 승인 이력 · 이전 등록 버전 — 을 읽어 판정한다.
  읽기는 공유 잠금 트랜잭션에서 하고 rollback한다(쓰기 없음).
- `--commit`은 `--db` 판정이 통과하고, `--confirm-db`가 앱 설정 DB 이름과 같고, 게시 루트가 앱 설정
  `PUBLISHED_CONTENT_ROOT`와 같을 때만 기존 `content_release.publish_and_register`로 게시한다(DB 게시 + 이 프로세스
  저장소 등록). 앱 서버는 별도 프로세스라 재시작해야 복구된다 — `scripts.check_published_restore`로 확인한다.
- 읽은 npc.json으로 NG·U 검사기를 만든다. ng/open 누락 또는 비교 불가능한 규칙은 `NG: UNVERIFIED`로 막힌다.
  둘 다 명시적인 빈 배열이면 유효하며, NG·U 패턴 일치는 FAIL이다(기존 런타임의 보수적 정책).
- 출력에는 검사 코드 · 상태 · 이유 코드 · fingerprint만 싣는다(정답 · 힌트 원문 · 접속 비밀번호를 싣지 않는다).

종료 코드: 0 게시 가능(또는 게시함), 1 입력 오류, 2 게이트 차단, 3 DB 상태 충돌(이미 다른 묶음 · 전이 불가).
"""

import argparse
import asyncio
import json
import sys
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.repositories.npc_publication import (
    ContentFingerprintConflictError,
    NpcPublicationRepository,
)
from app.schemas.gate_review import ApprovalTarget
from app.schemas.npc_content import NpcContentPack
from app.services.approval_history import GATES, ReviewRecord
from app.services.case_ng_check import build_case_ng_checker
from app.services.content_fingerprint import (
    FingerprintError,
    compute_content_fingerprint,
    header_mismatches,
    parse_i_json,
)
from app.services.content_release import publish_and_register
from app.services.npc_case_access import _records
from app.services.npc_publication import (
    NpcPublicationService,
    PublicationGateFailedError,
    PublicationTransitionError,
    _VersionOrderView,
)
from app.services.pinned_content import PinnedContentStore
from app.services.publication_approval import snapshot_source
from app.services.publication_gate import (
    _NPC_EXTRA_HEADERS,
    NON_BLOCKING_STATUSES,
    GateCheck,
    NgChecker,
    PublicationResult,
    evaluate_publication,
)
from app.services.published_content_loader import (
    BundleSnapshot,
    PublishedContentLoadError,
    read_bundle_snapshot,
)

EXIT_OK, EXIT_INPUT, EXIT_BLOCKED, EXIT_CONFLICT = 0, 1, 2, 3
BUNDLE_ROLES = ("client", "server", "npc", "idmap")
LOCAL_ID_KINDS = ("zones", "navigation", "blockers", "objects", "scenes")

# 검사 코드별 한 줄 안내. 게이트의 이유 코드는 그대로 함께 낸다.
CHECK_HINTS: dict[str, str] = {
    "PARSE": "파일이 I-JSON 으로 읽히지 않는다",
    "FINGERPRINT": "공식 fingerprint 를 다시 계산하지 못했다",
    "HEADER": "파일 머리(case_id · content_version · content_fingerprint)가 다시 계산한 값과 다르다",
    "VERSION_ORDER": "이전 게시본보다 큰 버전이어야 한다",
    "CLIENT_SERVER": "Client · Server 스키마 · ID 교차 참조 오류",
    "NPC": "npc.json 스키마 · 힌트 단계 참조 · 정답/원문 보호 위반",
    "NUDGE_COVERAGE": "(경고) 넛지가 없는 퍼즐",
    "IDMAP": "idmap 내부 · 교차 참조 오류",
    "EXECUTABLE_REFS": "실행 불가 항목을 참조한다",
    "SCENES": "장면 clear_when 오류(나주는 장면 필수)",
    "LEAK_CLIENT": "client.json 에 정답 · 정식 힌트 원문이 있다",
    "LOCAL_IDS": "FE 로컬 ID 대조 — UNVERIFIED 면 --local-ids 가 없다",
    "NG": "금지 왜곡 · 해석 유보 검사 — UNVERIFIED 면 ng/open 미제공 또는 비교 불가능한 규칙",
    "GEN_PACK": "일반 팩 재검사 — UNVERIFIED 면 판정 근거(케이스 고유명 등)가 없다",
    "APPROVALS": "G1~G3 승인 — dry-run 은 DB 를 읽지 않아 늘 미확인(--db 로 확인)",
}


class CliInputError(ValueError):
    """입력이 계약을 어겼다. 메시지는 이유만 담는다."""


@dataclass(frozen=True)
class CaseBundle:
    snapshot: BundleSnapshot
    fingerprint: str

    @property
    def files(self) -> dict[str, bytes | None]:
        return {role: self.snapshot.files.get(role) for role in BUNDLE_ROLES}


def read_case_bundle(
    root: str | Path, case_id: str, content_version: int
) -> CaseBundle:
    """게시 루트의 묶음을 읽고 fingerprint를 다시 계산한다. 파일 머리가 그 값과 다르면 거부한다.

    승인 기록(`record_gate_review`)과 게시가 같은 함수로 대상 묶음을 확인한다 — 승인한 묶음과 게시할 묶음이 같아야 한다.
    """

    try:
        snapshot = read_bundle_snapshot(Path(root), case_id, content_version)
    except PublishedContentLoadError as error:
        raise CliInputError(
            f"bundle not readable: {type(error).__name__}({error})"
        ) from error
    files = {role: snapshot.files.get(role) for role in BUNDLE_ROLES}
    try:
        fingerprint = compute_content_fingerprint(**files)
        documents = {
            role: parse_i_json(content)
            for role, content in files.items()
            if content is not None
        }
    except FingerprintError as error:
        raise CliInputError(f"bundle not parseable: {error}") from error
    problems = header_mismatches(
        documents,
        case_id=case_id,
        content_version=content_version,
        fingerprint=fingerprint,
    )
    if problems:
        listed = ",".join(f"{role}.{name}" for role, name in problems)
        raise CliInputError(
            f"file header does not match the recomputed bundle: {listed}"
        )
    return CaseBundle(snapshot, fingerprint)


def bundle_ng_checker(bundle: CaseBundle) -> NgChecker | None:
    """Use the same NPC schema/header handling as the gate, from the read snapshot.

    Invalid NPC schemas remain the gate's responsibility (NPC FAIL); do not
    expose validation input or turn an invalid pack into empty policy lists.
    """
    document = parse_i_json(bundle.snapshot.files["npc"])
    if not isinstance(document, dict):
        return None
    try:
        pack = NpcContentPack.model_validate(
            {
                key: value
                for key, value in document.items()
                if key not in _NPC_EXTRA_HEADERS
            }
        )
    except ValidationError:
        return None
    return build_case_ng_checker(pack)


def load_local_ids(path: str | None) -> Mapping[str, tuple[str, ...]] | None:
    if path is None:
        return None
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise CliInputError(
            f"local ids not readable: {type(error).__name__}"
        ) from error
    if not isinstance(raw, dict) or set(raw) - set(LOCAL_ID_KINDS):
        raise CliInputError(f"local ids must be an object with keys {LOCAL_ID_KINDS}")
    result: dict[str, tuple[str, ...]] = {}
    for kind, values in raw.items():
        if not isinstance(values, list) or not all(
            isinstance(v, str) and v for v in values
        ):
            raise CliInputError(f"local ids.{kind} must be a list of strings")
        result[kind] = tuple(values)
    return result


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--content-version", required=True, type=int)
    parser.add_argument(
        "--content-root", required=True, help="게시 루트(<root>/<case>/v<n>/)"
    )
    parser.add_argument("--local-ids", default=None, help="FE 로컬 ID JSON 파일")
    parser.add_argument("--db", action="store_true", help="대상 DB로 판정(읽기 전용)")
    parser.add_argument("--commit", action="store_true", help="실제로 게시한다")
    parser.add_argument("--confirm-db", default=None, help="--commit 대상 DB 이름 확인")
    parser.add_argument("--actor", default=None, help="--commit 실행자")
    parser.add_argument("--reason", default=None, help="--commit 근거")
    return parser.parse_args(argv)


@dataclass(frozen=True)
class DbView:
    records: tuple[ReviewRecord, ...]
    registered: Mapping[int, str]
    status: str | None


async def read_db_view(
    sessions: async_sessionmaker[AsyncSession], target: ApprovalTarget
) -> DbView:
    """실제 게시와 같은 입력을 읽는다. 공유 잠금 읽기 뒤 rollback — 쓰지 않는다."""

    async with sessions() as db:
        try:
            records = tuple(await _records(db, target, lock=False))
            repository = NpcPublicationRepository(db)
            registered = await repository.lock_case_versions(target.target_id)
            state = await repository.lock_state(
                target.target_id, target.content_version, mode="share"
            )
        finally:
            await db.rollback()
    return DbView(records, registered, state.status if state else None)


def evaluate(
    bundle: CaseBundle,
    *,
    view: DbView | None,
    local_ids: Mapping[str, Iterable[str]] | None,
    ng_checker: NgChecker | None,
) -> PublicationResult:
    """`NpcPublicationService._publish`와 같은 인자로 게이트를 부른다(hint_source 는 넘기지 않는다 — 묶음의 server.json)."""

    snapshot = bundle.snapshot
    target = ApprovalTarget(
        target_type="case_content",
        target_id=snapshot.case_id,
        content_version=snapshot.content_version,
    )
    others = (
        ()
        if view is None
        else tuple(sorted(v for v in view.registered if v != snapshot.content_version))
    )
    return evaluate_publication(
        **bundle.files,
        approval_source=None if view is None else snapshot_source(target, view.records),
        ng_checker=ng_checker,
        local_ids=local_ids,
        store=_VersionOrderView(others),
    )


def approval_lines(records: Iterable[ReviewRecord], fingerprint: str) -> list[str]:
    """관문별 마지막 판정(이 fingerprint 기준). 다른 fingerprint 기록만 있으면 stale."""

    items = list(records)
    lines = []
    for gate in GATES:
        current = sorted(
            (r for r in items if r.gate == gate and r.target_hash == fingerprint),
            key=lambda r: r.order_key,
        )
        if current:
            last = current[-1]
            lines.append(
                f"  {gate}: {last.decision} reviewer={last.reviewer} at={last.reviewed_at}"
            )
        elif any(r.gate == gate for r in items):
            lines.append(f"  {gate}: stale (다른 fingerprint 에만 기록 있음)")
        else:
            lines.append(f"  {gate}: missing")
    return lines


def blocking(checks: Iterable[GateCheck]) -> list[GateCheck]:
    return [check for check in checks if check.status not in NON_BLOCKING_STATUSES]


def report(result: PublicationResult, out: Callable[[str], None]) -> list[GateCheck]:
    out("checks:")
    for check in result.checks:
        reasons = f" [{', '.join(check.reasons)}]" if check.reasons else ""
        out(f"  {check.code:<16} {check.status:<14}{reasons}")
    blocked = blocking(result.checks)
    if blocked:
        out("verdict=BLOCKED " + ", ".join(f"{c.code}:{c.status}" for c in blocked))
        for check in blocked:
            out(f"  - {check.code}: {CHECK_HINTS.get(check.code, '')}")
    else:
        out("verdict=PUBLISHABLE")
    return blocked


def _require(value: str | None, name: str) -> str:
    if value is None or not value.strip() or value != value.strip():
        raise CliInputError(f"--{name} is required for --commit and must not be blank")
    return value


async def run(
    args: argparse.Namespace,
    sessions: async_sessionmaker[AsyncSession] | None,
    db_name: str,
    configured_root: str,
    out: Callable[[str], None] = print,
) -> int:
    """Build the checker from this bundle for preview and final gate evaluation."""

    if args.commit:
        # DB 를 열기 전에 실행 조건부터 본다
        actor = _require(args.actor, "actor")
        reason = _require(args.reason, "reason")
        if args.confirm_db != db_name:
            raise CliInputError("--confirm-db must equal the configured database name")
        if (
            not configured_root.strip()
            or Path(configured_root).resolve() != Path(args.content_root).resolve()
        ):
            raise CliInputError(
                "--content-root must equal PUBLISHED_CONTENT_ROOT (the app restores only from that root)"
            )
    bundle = read_case_bundle(args.content_root, args.case_id, args.content_version)
    ng_checker = bundle_ng_checker(bundle)
    local_ids = load_local_ids(args.local_ids)
    out(
        f"case_id={args.case_id} content_version={args.content_version} "
        f"content_fingerprint={bundle.fingerprint} local_ids={'given' if local_ids is not None else 'none'}"
    )

    view = None
    if args.db or args.commit:
        if sessions is None:
            raise CliInputError("database is not configured")
        target = ApprovalTarget(
            target_type="case_content",
            target_id=args.case_id,
            content_version=args.content_version,
        )
        view = await read_db_view(sessions, target)
        out(
            f"db={db_name} publication_status={view.status or 'none'} "
            f"registered_versions={sorted(view.registered) or '-'}"
        )
        registered = view.registered.get(args.content_version)
        if registered is not None and registered != bundle.fingerprint:
            out(
                f"conflict: v{args.content_version} is registered with another fingerprint"
            )
            return EXIT_CONFLICT
        out(f"approvals (case_content, fingerprint={bundle.fingerprint}):")
        for line in approval_lines(view.records, bundle.fingerprint):
            out(line)
    else:
        out("mode=dry-run (DB 접속 없음 — 승인 · 이전 버전은 확인하지 않는다)")

    result = evaluate(bundle, view=view, local_ids=local_ids, ng_checker=ng_checker)
    if report(result, out):
        return EXIT_BLOCKED
    if not args.commit:
        out("mode=read-only (게시 없음)" if view is not None else "mode=dry-run")
        return EXIT_OK

    assert sessions is not None
    try:
        release = await publish_and_register(
            NpcPublicationService(sessions),
            PinnedContentStore(),
            Path(args.content_root),
            args.case_id,
            args.content_version,
            reason=reason,
            actor=actor,
            snapshot=bundle.snapshot,
            ng_checker=ng_checker,
            local_ids=local_ids,
        )
    except PublicationGateFailedError as error:
        # 판정 사이에 승인이 바뀌었으면 여기서 막힌다 — 그 결과를 그대로 보인다
        out("publish refused by the gate:")
        report(error.result, out)
        return EXIT_BLOCKED
    except (PublicationTransitionError, ContentFingerprintConflictError) as error:
        out(f"publish refused: {type(error).__name__}")
        return EXIT_CONFLICT
    out(
        f"published outcome={release.outcome} publication={release.publication.status} "
        f"registration={release.registration.status}"
    )
    out(
        "next: 앱 서버를 같은 PUBLISHED_CONTENT_ROOT 로 재시작한 뒤 "
        "`python -m scripts.check_published_restore --expect "
        f"{args.case_id}:{args.content_version}` 로 복구를 확인한다"
    )
    return EXIT_OK


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.db or args.commit:
            from app.core.config import settings
            from app.db.session import AsyncSessionLocal, engine

            async def execute() -> int:
                try:
                    return await run(
                        args,
                        AsyncSessionLocal,
                        settings.db_name,
                        settings.published_content_root,
                    )
                finally:
                    await engine.dispose()

            return asyncio.run(execute())
        return asyncio.run(run(args, None, "", ""))
    except (CliInputError, ValidationError) as error:
        print(f"[ERROR] {error}")
        return EXIT_INPUT


if __name__ == "__main__":
    sys.exit(main())
