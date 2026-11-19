"""게시 콘텐츠 상태 관리 명령(CLI) — status · suspend · block · resume (인증 운영 전 전용, 팀 검토 대기).

    # 읽기 전용(DB 쓰기 없음)
    .\\.venv\\Scripts\\python.exe -m scripts.publication_state status --case-id naju-angam-01 --content-version 1

    # 상태 변경 — 기본은 계획만 출력(쓰기 없음). --commit 일 때만 바꾼다
    .\\.venv\\Scripts\\python.exe -m scripts.publication_state suspend|block \\
        --case-id <case> --content-version <n> --expect-fingerprint sha256:<64 hex> \\
        --actor <실행자> --reason <근거> [--commit --confirm-db <DB 이름>]
    .\\.venv\\Scripts\\python.exe -m scripts.publication_state resume \\
        --case-id <case> --content-version <n> --expect-fingerprint sha256:<64 hex> \\
        --content-root <PUBLISHED_CONTENT_ROOT> [--local-ids <FE 로컬 ID JSON>] \\
        --actor <실행자> --reason <근거> [--commit --confirm-db <DB 이름>]

- 판정 · 전이는 모두 기존 `NpcPublicationService`(suspend · block · resume)가 한다. 이 명령은 규칙을 다시 만들지 않는다.
  - suspend: published → suspended(그 밖은 거부)
  - block: published · suspended → blocked. 잠근 뒤 상태가 실행 전에 본 상태와 다르면 거부(`expected_status`)
  - resume: suspended · blocked → published. 게시 루트의 묶음을 다시 읽어 등록 fingerprint와 같은지 보고, 지금 DB 승인
    이력으로 게시 게이트를 다시 통과해야 한다. blocked 재개는 G1~G3 최종 approved가 모두 **마지막 차단 뒤**여야 한다.
- 대상은 `(case_id, content_version)` 하나다. 다른 케이스 · 버전은 바꾸지 않는다. 상태 변경 이력(actor · reason)은
  서비스가 같은 트랜잭션에서 남긴다(기존 계약). 승인 기록 · 새 게시 기록은 만들지 않는다.
- 실행 전에 대상 · fingerprint · 현재 상태를 출력한다. `--expect-fingerprint`가 등록 fingerprint와 다르면 바꾸지 않는다.
- 이미 목표 상태면 아무것도 바꾸지 않고 `result=unchanged`로 끝난다(종료 코드 0).
- 출력에는 상태 · fingerprint · 이력 · 이유 코드만 싣는다(접속 정보 · 비밀번호 · 정답 · 대사 원문을 싣지 않는다).
- 상태는 앱 서버가 요청마다 DB에서 읽는다 — 바꾼 뒤 서버 재시작은 필요 없다.

종료 코드: 0 성공(또는 변화 없음 · 계획 출력), 1 입력 오류 · 대상 없음 · DB 오류, 2 게이트 · 재승인 차단, 3 상태 충돌.
"""

import argparse
import asyncio
import re
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.npc_publication import (
    PUBLICATION_BLOCKED,
    PUBLICATION_PUBLISHED,
    PUBLICATION_SUSPENDED,
)
from app.services.npc_publication import (
    BlockedReapprovalRequiredError,
    ContentFingerprintMismatchError,
    NpcPublicationService,
    PublicationGateFailedError,
    PublicationStateConflictError,
    PublicationStateNotFoundError,
    PublicationTransitionError,
)
from scripts.publish_case_content import (
    CliInputError,
    bundle_ng_checker,
    load_local_ids,
    read_case_bundle,
    report,
)

EXIT_OK, EXIT_INPUT, EXIT_BLOCKED, EXIT_CONFLICT = 0, 1, 2, 3
ACTIONS = ("status", "suspend", "block", "resume")
FINGERPRINT = re.compile(r"^sha256:[0-9a-f]{64}$")
CASE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
EVENT_LIMIT = 5

# 동작별 (목표 상태, 시작 가능 상태). 서비스 규칙과 같아야 한다(계획 출력용 — 최종 판정은 서비스).
PLAN = {
    "suspend": (PUBLICATION_SUSPENDED, (PUBLICATION_PUBLISHED,)),
    "block": (PUBLICATION_BLOCKED, (PUBLICATION_PUBLISHED, PUBLICATION_SUSPENDED)),
    "resume": (PUBLICATION_PUBLISHED, (PUBLICATION_SUSPENDED, PUBLICATION_BLOCKED)),
}


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("action", choices=ACTIONS)
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--content-version", required=True, type=int)
    parser.add_argument("--expect-fingerprint", default=None)
    parser.add_argument("--content-root", default=None, help="resume: 게시 루트")
    parser.add_argument("--local-ids", default=None, help="resume: FE 로컬 ID JSON")
    parser.add_argument("--actor", default=None)
    parser.add_argument("--reason", default=None)
    parser.add_argument("--commit", action="store_true", help="실제로 상태를 바꾼다")
    parser.add_argument("--confirm-db", default=None, help="--commit 대상 DB 이름 확인")
    return parser.parse_args(argv)


def _text(value: str | None, name: str) -> str:
    if value is None or not value.strip() or value != value.strip():
        raise CliInputError(f"--{name} is required and must not be blank")
    return value


def validate(args: argparse.Namespace, db_name: str, configured_root: str) -> None:
    """DB를 열기 전에 입력 · 실행 조건을 본다."""

    if not CASE_ID.fullmatch(args.case_id):
        raise CliInputError("--case-id has an invalid format")
    if args.content_version < 1:
        raise CliInputError("--content-version must be >= 1")
    if args.action == "status":
        if args.commit:
            raise CliInputError("status is read-only (no --commit)")
        return
    if args.expect_fingerprint is None or not FINGERPRINT.fullmatch(
        args.expect_fingerprint
    ):
        raise CliInputError("--expect-fingerprint must be sha256:<64 lowercase hex>")
    _text(args.actor, "actor")
    _text(args.reason, "reason")
    if args.action == "resume":
        if not args.content_root:
            raise CliInputError("resume needs --content-root")
    if args.commit:
        if args.confirm_db != db_name:
            raise CliInputError("--confirm-db must equal the configured database name")
        if args.action == "resume" and (
            not configured_root.strip()
            or Path(configured_root).resolve() != Path(args.content_root).resolve()
        ):
            raise CliInputError(
                "--content-root must equal PUBLISHED_CONTENT_ROOT (the app serves only that root)"
            )


async def show_state(
    service: NpcPublicationService, case_id: str, version: int, out
) -> object | None:
    snapshot = await service.current(case_id, version)
    if snapshot is None:
        out(f"target={case_id}@v{version} status=none (게시 기록 없음)")
        return None
    out(
        f"target={case_id}@v{version} status={snapshot.status} "
        f"content_fingerprint={snapshot.content_fingerprint} "
        f"revision={snapshot.revision} updated_at={snapshot.updated_at.isoformat()}"
    )
    events = await service.events(case_id, version)
    for event in events[-EVENT_LIMIT:]:
        out(
            f"  event rev={event.state_revision} {event.from_status or '-'}->{event.to_status} "
            f"at={event.at.isoformat()} actor={event.actor} reason={event.reason}"
        )
    return snapshot


async def run(
    args: argparse.Namespace,
    sessions: async_sessionmaker[AsyncSession],
    db_name: str,
    configured_root: str,
    out: Callable[[str], None] = print,
    service: NpcPublicationService | None = None,
) -> int:
    validate(args, db_name, configured_root)
    service = service or NpcPublicationService(sessions)
    case_id, version = args.case_id, args.content_version
    out(f"db={db_name} action={args.action} mode={'commit' if args.commit else 'plan'}")

    snapshot = await show_state(service, case_id, version, out)
    if args.action == "status":
        return EXIT_OK
    if snapshot is None:
        out("refused: target has no publication state")
        return EXIT_INPUT
    if snapshot.content_fingerprint != args.expect_fingerprint:
        out("refused: --expect-fingerprint does not match the registered fingerprint")
        return EXIT_CONFLICT

    target, allowed_from = PLAN[args.action]
    if snapshot.status == target:
        out(f"result=unchanged (already {target})")
        return EXIT_OK
    if snapshot.status not in allowed_from:
        out(f"refused: {snapshot.status} -> {target} is not allowed")
        return EXIT_CONFLICT

    bundle = None
    if args.action == "resume":
        bundle = read_case_bundle(args.content_root, case_id, version)
        out(f"bundle content_fingerprint={bundle.fingerprint}")
        if bundle.fingerprint != snapshot.content_fingerprint:
            out("refused: bundle on disk differs from the registered fingerprint")
            return EXIT_CONFLICT

    out(f"plan: {snapshot.status} -> {target}")
    if not args.commit:
        out("mode=plan (상태를 바꾸지 않았다 — 바꾸려면 --commit --confirm-db)")
        return EXIT_OK

    try:
        if args.action == "suspend":
            final = await service.suspend(
                case_id, version, reason=args.reason, actor=args.actor
            )
        elif args.action == "block":
            result = await service.block(
                case_id,
                version,
                reason=args.reason,
                actor=args.actor,
                expected_status=snapshot.status,
            )
            final = result.snapshot
            out(
                f"withdrawn bodies_deleted={result.withdrawal.bodies_deleted} "
                f"processing_fenced={result.withdrawal.processing_fenced}"
            )
        else:
            assert bundle is not None
            outcome = await service.resume(
                bundle.snapshot,
                hint_source=None,
                ng_checker=bundle_ng_checker(bundle),
                local_ids=load_local_ids(args.local_ids),
                reason=args.reason,
                actor=args.actor,
            )
            final = outcome.snapshot
    except PublicationGateFailedError as error:
        out("refused by the publication gate:")
        report(error.result, out)
        return EXIT_BLOCKED
    except BlockedReapprovalRequiredError as error:
        out(f"refused: {error.gate} needs a final approved record after the block")
        return EXIT_BLOCKED
    except (
        PublicationTransitionError,
        PublicationStateConflictError,
        ContentFingerprintMismatchError,
    ) as error:
        out(f"refused: {type(error).__name__} (state changed or not allowed)")
        return EXIT_CONFLICT
    except PublicationStateNotFoundError:
        out("refused: target has no publication state")
        return EXIT_INPUT
    out(f"result=changed status={final.status} revision={final.revision}")
    out("next: 서버 재시작 없이 바로 적용된다 — status 로 다시 확인")
    return EXIT_OK


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
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
    except (CliInputError, ValidationError) as error:
        print(f"[ERROR] {error}")
        return EXIT_INPUT
    except SQLAlchemyError as error:
        # 접속 정보가 섞일 수 있어 종류만 싣는다
        print(f"[ERROR] database error: {type(error).__name__}")
        return EXIT_INPUT


if __name__ == "__main__":
    sys.exit(main())
