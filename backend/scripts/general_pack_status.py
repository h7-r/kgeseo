"""공식 일반 대사 팩의 승인 대상 · 현재 승인 상태 확인(읽기 전용). 승인 기록을 만들거나 바꾸지 않는다.

    .\\.venv\\Scripts\\python.exe -m scripts.general_pack_status general_default/v1         # 파일 · fingerprint만
    .\\.venv\\Scripts\\python.exe -m scripts.general_pack_status general_default/v1 --db    # + DB의 G3 판정

`--db`는 앱 설정(.env의 DB_*)의 `npc_approval_reviews`에서 `(dialogue_pack, pack_id, pack_version)` 기록을 읽는다.
판정은 NPC 턴과 같다(PM v0.4.13): G3 승인(`general_pack_gate_reasons`)과 정책 검사(`dialogue_pack_policy`, 기준 미정 ·
늘 UNVERIFIED)를 따로 보여 주고, 둘 다 통과할 때만 `usable=yes`다. 출력에는 대상 · fingerprint · 판정만 있다.
"""

import argparse
import asyncio
import sys

from app.core.config import settings
from app.db.session import AsyncSessionLocal, engine
from app.services.dialogue_pack_policy import (
    DEFAULT_DIALOGUE_PACK_POLICY,
    run_dialogue_pack_policy,
)
from app.services.npc_general_pack import (
    NO_PACK_APPROVAL,
    GeneralPackLoadError,
    load_general_pack,
    read_general_pack_access,
)
from app.services.npc_line_supply import (
    general_pack_fingerprint,
    general_pack_gate_reasons,
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "pack", help="<pack_id>/v<pack_version>, 예: general_default/v1"
    )
    parser.add_argument(
        "--db", action="store_true", help="DB 승인 기록으로 G3 판정도 본다"
    )
    return parser.parse_args(argv)


async def _approval(pack) -> str:
    try:
        async with AsyncSessionLocal() as db:
            access = await read_general_pack_access(db, pack, lock=False)
            await db.rollback()
    finally:
        await engine.dispose()
    if access == NO_PACK_APPROVAL:
        return "unavailable"
    reasons = general_pack_gate_reasons(pack, access.approval_source)
    return "PASS" if not reasons else "FAIL " + ",".join(reasons)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        pack = load_general_pack(args.pack)
    except GeneralPackLoadError as error:
        print(f"[ERROR] pack={args.pack} reason={error}")
        return 1
    print(
        "target_type=dialogue_pack "
        f"target_id={pack.pack_id} content_version={pack.pack_version} "
        f"target_hash={general_pack_fingerprint(pack)} lines={len(pack.lines)}"
    )
    policy = run_dialogue_pack_policy(DEFAULT_DIALOGUE_PACK_POLICY, pack)
    print(f"policy={policy.status} reason={policy.reason}")
    if args.db:
        approval = asyncio.run(_approval(pack))
        usable = "yes" if approval == "PASS" and policy.passed else "no"
        print(f"db={settings.db_name} g3_approval={approval} usable={usable}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
