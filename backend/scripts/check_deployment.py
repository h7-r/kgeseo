"""Read-only deployment check. Run from backend: python -m scripts.check_deployment."""

import argparse
import asyncio
import json
import logging
from dataclasses import dataclass
from importlib import import_module
from os import scandir
from pathlib import Path
from pkgutil import iter_modules
from typing import Literal

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.util import CommandError
from sqlalchemy import Connection, func, inspect, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection, async_sessionmaker

# 앱 모듈(app.*)은 쓰는 함수 안에서 부른다. 맨 위에서 부르면 정책 모듈이 import 때 공유 JSON 을 파싱해, 파일이 깨졌으면
# 「Shared Policy: FAIL」을 찍기 전에 traceback 으로 끝났다(세진 11/27 #219 리뷰).
ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"
# 저장소(= 릴리스 폴더) 맨 위의 shared/ — 백엔드 정책 모듈이 parents[3] / "shared" 로 읽는 자리와 같다
SHARED_DIR = Path(__file__).resolve().parents[2] / "shared"
# 파일마다 있어야 하는 최상위 열쇠(정책 모듈이 import 때 꺼내 쓴다)
SHARED_POLICY_KEYS = {
    "nickname-policy.json": (
        "minLength",
        "maxLength",
        "matching",
        "reserved",
        "forbidden",
        "compose",
    ),
    "regions.json": ("groups",),
}
# 게시 콘텐츠 점검이 쓰는 앱 이름 — 처음 쓸 때 부른다(content_release · npc_publication 이 정책 모듈을 끌어온다).
# 모듈 속성으로도 보이게 둔다: 시험이 check.NpcPublicationService 를 바꿔 끼운다
_LAZY_APP_NAMES = {
    "NpcPublicationState": "app.models.npc_publication",
    "sync_published_content": "app.services.content_release",
    "NpcPublicationService": "app.services.npc_publication",
    "PinnedContentStore": "app.services.pinned_content",
}


def __getattr__(name: str):
    module = _LAZY_APP_NAMES.get(name)
    if module is None:
        raise AttributeError(name)
    value = getattr(import_module(module), name)
    globals()[name] = value
    return value


def _app_name(name: str):
    """바꿔 끼운 값이 있으면 그것, 없으면 지금 부른다."""
    return globals()[name] if name in globals() else __getattr__(name)


@dataclass(frozen=True)
class Check:
    status: Literal["PASS", "FAIL", "SKIP"]
    detail: str = ""


class DeploymentArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        # argparse's default error echoes arguments, which can contain secrets.
        self.exit(
            2,
            "Options: FAIL (use --schema-only or --full; see --help)\nOverall: FAIL\n",
        )


def check_alembic(connection: Connection, scripts: ScriptDirectory) -> Check:
    code_heads = scripts.get_heads()
    db_heads = MigrationContext.configure(connection).get_current_heads()
    if not code_heads:
        return Check("FAIL", "no code head")
    if len(code_heads) > 1:
        return Check("FAIL", "multiple code heads")
    if not db_heads:
        return Check("FAIL", "no DB revision")
    if db_heads != tuple(code_heads):
        return Check("FAIL", "DB revision does not match code head")
    return Check("PASS")


def check_required_tables(connection: Connection) -> Check:
    from app import models
    from app.db.base import Base

    # Register every model, including models not imported by the running API.
    for module in iter_modules(models.__path__, f"{models.__name__}."):
        import_module(module.name)

    inspector = inspect(connection)
    existing = set(inspector.get_table_names())
    missing_tables = False
    missing_columns = False
    for table in Base.metadata.sorted_tables:
        if table.name not in existing:
            missing_tables = True
            continue
        columns = {column["name"] for column in inspector.get_columns(table.name)}
        if any(column.name not in columns for column in table.columns):
            missing_columns = True

    issues = []
    if missing_tables:
        issues.append("missing tables")
    if missing_columns:
        issues.append("missing columns")
    if issues:
        return Check("FAIL", "; ".join(issues))
    return Check("PASS")


def check_shared_policy(shared_dir: Path | None = None) -> Check:
    """공용 정책 JSON(금칙어 · 예약어 = nickname-policy.json, 가입 지역 = regions.json)이 배포 묶음에 있고 읽히는지.

    백엔드는 파일이 없으면 경고만 남기고 옛 내장 목록(금칙어 10개 · 예약어 9개)으로 돌아 조용히 약해진다 — 11/27 운영에서
    배포 묶음에 shared/ 가 빠진 채 몇 주를 그렇게 돌았다. 여기서 FAIL 이면 deploy.sh 가 이전 릴리스로 되돌린다(미르 11/27).

    앱 모듈을 부르기 전에 파일부터 본다 — 없음 · 0바이트 · 잘못된 JSON · 빈 객체 · 열쇠 빠짐 · 그 자리에 폴더가 있음은
    여기서 FAIL 이다. 다 맞으면 정책 모듈을 실제로 불러 import 때의 구조 오류도 FAIL 로 받는다(세진 11/27).
    """
    base = SHARED_DIR if shared_dir is None else shared_dir
    unreadable = []
    for name, keys in SHARED_POLICY_KEYS.items():
        try:
            data = json.loads((base / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            unreadable.append(name)
            continue
        if not isinstance(data, dict) or any(not data.get(key) for key in keys):
            unreadable.append(name)
    if unreadable:
        return Check(
            "FAIL", "shared policy missing or unreadable: " + ", ".join(unreadable)
        )
    if shared_dir is not None:
        # 시험이 다른 폴더를 줄 때는 파일 검사까지만 — 정책 모듈은 저장소 shared/ 를 읽는다
        return Check("PASS")
    try:
        from app.services import nickname_policy, registration_input_policy

        if (
            nickname_policy.POLICY_PATH.parent.resolve() != base.resolve()
            or registration_input_policy.REGIONS_PATH.parent.resolve() != base.resolve()
            or not registration_input_policy.load_regions()
        ):
            return Check("FAIL", "shared policy path does not match the app")
    except Exception:  # noqa: BLE001 — import 때의 구조 오류도 FAIL 줄로 남긴다(원문은 찍지 않는다)
        return Check("FAIL", "shared policy could not be loaded by the app")
    return Check("PASS")


async def check_published_content(
    connection: AsyncConnection, root_setting: str
) -> Check:
    NpcPublicationState = _app_name("NpcPublicationState")  # noqa: N806
    sync_published_content = _app_name("sync_published_content")
    NpcPublicationService = _app_name("NpcPublicationService")  # noqa: N806
    PinnedContentStore = _app_name("PinnedContentStore")  # noqa: N806

    if not root_setting.strip():
        return Check("SKIP", "WARNING: PUBLISHED_CONTENT_ROOT is unset")

    count = await connection.scalar(
        select(func.count()).select_from(NpcPublicationState)
    )

    root = Path(root_setting)
    try:
        with scandir(root) as directory:
            next(directory, None)
    except (OSError, ValueError):
        return Check("FAIL", "PUBLISHED_CONTENT_ROOT is not a readable directory")
    if not count:
        return Check("SKIP", "publication root is readable; no publication records")

    # Reuse the startup rebuild in a private store. Binding to the same
    # connection keeps the count and restore reads in the same transaction.
    service = NpcPublicationService(async_sessionmaker(connection))
    entries = await sync_published_content(service, PinnedContentStore(), root)
    issues = sorted({entry.status for entry in entries if not entry.available})
    if len(entries) != count:
        issues.append(
            "publication records lack matching version metadata or changed during the check"
        )
    if issues:
        return Check("FAIL", "; ".join(issues))
    return Check("PASS")


async def run_checks(schema_only: bool) -> tuple[Check, Check, Check, Check]:
    # Settings validation can include sensitive input values. Load settings
    # inside the CLI's redacted error boundary.
    from app.core.config import settings
    from app.db.session import engine

    skipped = Check(
        "SKIP", "schema-only mode" if schema_only else "database unavailable"
    )
    # DB 와 상관없이 늘 본다(--schema-only 여도). 깨졌으면 앱 모듈을 더 부르지 않는다 — 부르면 import 때 같은 파일에서 멈춘다
    shared = check_shared_policy()
    if shared.status == "FAIL":
        blocked = Check("SKIP", "shared policy failed")
        return blocked, blocked, blocked, shared
    try:
        scripts = ScriptDirectory.from_config(Config(ALEMBIC_INI))
        async with engine.connect() as connection:
            try:
                alembic = await connection.run_sync(check_alembic, scripts)
            except SQLAlchemyError:
                alembic = Check("FAIL", "could not read DB revision")
            except CommandError:
                alembic = Check("FAIL", "could not resolve the code revision graph")
            try:
                tables = await connection.run_sync(check_required_tables)
            except SQLAlchemyError:
                tables = Check("FAIL", "could not inspect DB tables and columns")
            content = skipped
            if not schema_only:
                try:
                    content = await check_published_content(
                        connection, settings.published_content_root
                    )
                except SQLAlchemyError:
                    content = Check("FAIL", "could not read publication records")
            return alembic, tables, content, shared
    except SQLAlchemyError:
        unavailable = Check("FAIL", "database connection failed")
        return unavailable, unavailable, skipped, shared
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = DeploymentArgumentParser(description=__doc__, allow_abbrev=False)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--schema-only",
        dest="mode",
        action="store_const",
        const="schema-only",
        help="check Alembic and model schema only",
    )
    mode.add_argument(
        "--full",
        dest="mode",
        action="store_const",
        const="full",
        help="check schema and published content (default)",
    )
    schema_only = parser.parse_args(argv).mode == "schema-only"
    previous_logging_level = logging.root.manager.disable
    # The shared startup code logs restoration errors. Print only this CLI's
    # controlled diagnostics, even if a driver or validation error has secrets.
    logging.disable(logging.CRITICAL)
    try:
        results = asyncio.run(run_checks(schema_only))
    except Exception:
        print(
            "Deployment Check: FAIL (could not load configuration or complete checks)"
        )
        print("Overall: FAIL")
        return 1
    finally:
        logging.disable(previous_logging_level)

    for label, result in zip(
        ("Alembic", "Required Tables", "Published Content", "Shared Policy"),
        results,
        strict=True,
    ):
        detail = f" ({result.detail})" if result.detail else ""
        print(f"{label}: {result.status}{detail}")
    if not schema_only:
        print("Running App Restore: SKIP (process memory was not inspected)")
    failed = any(result.status == "FAIL" for result in results)
    print(f"Overall: {'FAIL' if failed else 'PASS'}")
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
