"""승인 기록 내부 관리 명령(CLI) v0.1 (PM v0.4.6 §7 · v0.4.13 §2~3, 인증 운영 전 전용).

    .\\.venv\\Scripts\\python.exe -m scripts.record_gate_review \\
        --target-type dialogue_pack --target-id general_default --target-version 1 \\
        --gate G3 --decision approved --actor 세진 --reviewer 황미르 \\
        --reason "PM 11/3 메시지로 G3 승인" \\
        --target-hash sha256:<64 hex>                      # 기본: 확인만(dry run), DB를 쓰지 않음
        [--db]                                             # + 대상 DB의 revision · 현재 판정(읽기 전용)
        [--commit --confirm-db <DB 이름>]                  # 실제 기록(append-only INSERT 1건)

- `actor`(실행한 사람)와 `reviewer`(판정한 사람)를 따로 받아 그대로 기록한다. 실행자를 판정자로 기록하지 않는다.
- `reviewer`는 관문별 기록 가능한 사람(PM v0.4.13 §2)만 받는다. `reason`(근거)은 필수다.
- 대상 내용의 fingerprint를 파일에서 다시 계산하고, `--target-hash`와 다르면 기록하지 않는다.
- 대상 종류별 필수 관문(`REQUIRED_GATES`)이 아닌 관문은 받지 않는다(dialogue_pack은 G3만).
- 지금은 `dialogue_pack`(공식 일반 팩 파일)만 지원한다. `case_content`는 게시 묶음 fingerprint 재계산 경로를
  연결한 뒤에 연다(거부).
- `--commit`은 `--confirm-db`가 앱 설정의 DB 이름과 같고, 대상 DB가 `actor` 열 revision(b3f7c2e9a4d1) 이후일 때만
  쓴다. 기록은 `record_delegated_gate_review`(같은 잠금 · 같은 append-only 저장소)로만 한다.
- 철회는 같은 관문에 `hold` · `rejected`를 `--supersedes <직전 review_id>`로 기록한다(기존 이력 규칙).
- 정책 검사(`dialogue_pack_policy`)는 승인 기록과 별개다. 기준 미정인 동안 G3를 기록해도 팩은 쓰이지 않는다.
- 출력에는 대상 · fingerprint · 판정 · review_id만 싣는다(접속 비밀번호를 싣지 않는다).
"""

import argparse
import asyncio
import sys
from collections.abc import Sequence
from dataclasses import dataclass

from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.schemas.gate_review import ApprovalTarget, GateReviewCreate
from app.services.approval_history import REQUIRED_GATES, ReviewRecord
from app.services.dialogue_pack_policy import (
    DEFAULT_DIALOGUE_PACK_POLICY,
    run_dialogue_pack_policy,
)
from app.services.gate_review import (
    InternalCliOperator,
    record_delegated_gate_review,
)
from app.services.npc_case_access import _records
from app.services.npc_general_pack import GeneralPackLoadError, load_general_pack
from app.services.npc_line_supply import (
    general_pack_fingerprint,
    general_pack_gate_reasons,
)
from app.services.publication_approval import snapshot_source

# 관문별 기록 가능한 사람(PM v0.4.13 §2, 12월 MVP). reviewer에는 실제로 판정한 사람을 적는다.
GATE_REVIEWERS: dict[str, tuple[str, ...]] = {
    "G1": ("박지하", "황미르"),
    "G2": ("이해랑", "황미르"),
    "G3": ("황미르",),
}
ACTOR_REVISION = "b3f7c2e9a4d1"
SUPPORTED_TARGET_TYPES = ("dialogue_pack",)


class CliInputError(ValueError):
    """입력이 계약을 어겼다. 메시지는 이유만 담는다."""


@dataclass(frozen=True)
class Plan:
    target: ApprovalTarget
    request: GateReviewCreate
    actor: str
    reviewer: str
    fingerprint: str


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--target-type", required=True)
    parser.add_argument("--target-id", required=True)
    parser.add_argument("--target-version", required=True, type=int)
    parser.add_argument("--gate", required=True, choices=("G1", "G2", "G3"))
    parser.add_argument(
        "--decision",
        required=True,
        choices=("approved", "revise", "escalate", "rejected", "hold"),
    )
    parser.add_argument("--actor", required=True, help="이 명령을 실행하는 사람")
    parser.add_argument("--reviewer", required=True, help="실제로 판정한 사람")
    parser.add_argument("--reason", required=True, help="근거(필수)")
    parser.add_argument(
        "--target-hash", required=True, help="판정 대상 fingerprint(재계산 값과 대조)"
    )
    parser.add_argument("--supersedes", default=None)
    parser.add_argument("--db", action="store_true", help="대상 DB 읽기 전용 확인")
    parser.add_argument("--commit", action="store_true", help="실제로 기록한다")
    parser.add_argument("--confirm-db", default=None, help="--commit 대상 DB 이름 확인")
    return parser.parse_args(argv)


def build_plan(args: argparse.Namespace) -> Plan:
    if args.target_type not in SUPPORTED_TARGET_TYPES:
        raise CliInputError(f"unsupported target_type: {args.target_type}")
    required = REQUIRED_GATES[args.target_type]
    if args.gate not in required:
        raise CliInputError(
            f"{args.gate} is not a required gate for {args.target_type}"
        )
    if args.reviewer not in GATE_REVIEWERS[args.gate]:
        raise CliInputError(f"reviewer is not allowed to record {args.gate}")
    if not args.actor.strip() or args.actor != args.actor.strip():
        raise CliInputError("actor must not be blank")
    if not args.reason.strip():
        raise CliInputError("reason must not be blank")
    try:
        target = ApprovalTarget(
            target_type=args.target_type,
            target_id=args.target_id,
            content_version=args.target_version,
        )
    except ValidationError as error:
        raise CliInputError("invalid target") from error
    try:
        pack = load_general_pack(f"{target.target_id}/v{target.content_version}")
    except GeneralPackLoadError as error:
        raise CliInputError(f"pack not loadable: {error}") from error
    fingerprint = general_pack_fingerprint(pack)
    if args.target_hash != fingerprint:
        raise CliInputError(
            f"target_hash mismatch: given={args.target_hash} recomputed={fingerprint}"
        )
    try:
        request = GateReviewCreate(
            **target.model_dump(),
            gate=args.gate,
            target_hash=fingerprint,
            decision=args.decision,
            reason=args.reason,
            supersedes=args.supersedes,
        )
    except ValidationError as error:
        raise CliInputError("invalid review request") from error
    return Plan(target, request, args.actor, args.reviewer, fingerprint)


async def schema_revision(db: AsyncSession) -> tuple[str, ...]:
    """대상 DB의 Alembic revision(표시용). 표가 없으면 빈 값이다 — 기록 가능 여부는 열 확인으로 정한다."""

    exists = (
        await db.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alembic_version'"
            )
        )
    ).one()[0]
    if not exists:
        return ()
    rows = (await db.execute(text("SELECT version_num FROM alembic_version"))).all()
    return tuple(row[0] for row in rows)


async def has_actor_column(db: AsyncSession) -> bool:
    row = (
        await db.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_NAME = 'npc_approval_reviews' AND COLUMN_NAME = 'actor'"
            )
        )
    ).one()
    return bool(row[0])


async def current_status(db: AsyncSession, plan: Plan) -> tuple[str, str]:
    """(G3 판정, 정책 검사 상태). 읽기 전용."""

    records = await _records(db, plan.target, lock=False)
    pack = load_general_pack(f"{plan.target.target_id}/v{plan.target.content_version}")
    reasons = general_pack_gate_reasons(pack, snapshot_source(plan.target, records))
    policy = run_dialogue_pack_policy(DEFAULT_DIALOGUE_PACK_POLICY, pack)
    gate = "PASS" if not reasons else "FAIL " + ",".join(reasons)
    return gate, f"{policy.status}({policy.reason})"


async def run(
    args: argparse.Namespace,
    sessions: async_sessionmaker[AsyncSession] | None,
    db_name: str,
    out=print,
) -> ReviewRecord | None:
    plan = build_plan(args)
    out(
        f"target_type={plan.target.target_type} target_id={plan.target.target_id} "
        f"content_version={plan.target.content_version} target_hash={plan.fingerprint}"
    )
    out(
        f"gate={plan.request.gate} decision={plan.request.decision} "
        f"actor={plan.actor} reviewer={plan.reviewer} reason={plan.request.reason} "
        f"supersedes={plan.request.supersedes}"
    )
    if not (args.db or args.commit):
        out("mode=dry-run (DB 접속 · 기록 없음)")
        return None
    if sessions is None:
        raise CliInputError("database is not configured")
    if args.commit and args.confirm_db != db_name:
        raise CliInputError("--confirm-db must equal the configured database name")
    async with sessions() as db:
        revision = await schema_revision(db)
        actor_ready = await has_actor_column(db)
        # 실행자 열이 없는 schema에서는 현재 코드가 승인 기록을 읽지 못한다(판정 생략).
        before = await current_status(db, plan) if actor_ready else ("unavailable", "-")
        await db.rollback()
    out(
        f"db={db_name} alembic={','.join(revision) or '-'} actor_column={actor_ready} "
        f"g3_before={before[0]} policy={before[1]}"
    )
    if args.commit and not actor_ready:
        raise CliInputError(f"target database needs revision {ACTOR_REVISION}")
    if not args.commit:
        out("mode=read-only (기록 없음)")
        return None
    async with sessions() as db:
        record = await record_delegated_gate_review(
            db,
            plan.request,
            operator=InternalCliOperator(actor=plan.actor),
            reviewer=plan.reviewer,
        )
    async with sessions() as db:
        after = await current_status(db, plan)
        await db.rollback()
    out(
        f"recorded review_id={record.review_id} reviewed_at={record.reviewed_at} "
        f"g3_after={after[0]} policy={after[1]}"
    )
    return record


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.db or args.commit:
            from app.core.config import settings
            from app.db.session import AsyncSessionLocal, engine

            async def execute() -> None:
                try:
                    await run(args, AsyncSessionLocal, settings.db_name)
                finally:
                    await engine.dispose()

            asyncio.run(execute())
        else:
            asyncio.run(run(args, None, ""))
    except CliInputError as error:
        print(f"[ERROR] {error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
