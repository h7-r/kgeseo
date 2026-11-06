"""Read-only deployment check. Run from backend: python -m scripts.check_deployment."""

import argparse
import asyncio
import logging
from collections import Counter
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

from app import models
from app.db.base import Base
from app.models.npc_publication import NpcPublicationState
from app.services.content_release import sync_published_content
from app.services.npc_publication import NpcPublicationService
from app.services.pinned_content import PinnedContentStore

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


@dataclass(frozen=True)
class Check:
    status: Literal["PASS", "FAIL", "SKIP"]
    detail: str


def check_alembic(connection: Connection, scripts: ScriptDirectory) -> Check:
    code_heads = scripts.get_heads()
    db_heads = MigrationContext.configure(connection).get_current_heads()
    known = {revision.revision for revision in scripts.walk_revisions()}
    # Unknown revision values are DB data. Do not echo them into deployment logs.
    db_revisions = ", ".join(
        sorted(head if head in known else "<unknown>" for head in db_heads)
    )
    detail = f"code={', '.join(code_heads) or '<none>'}; DB={db_revisions or '<none>'}"
    if len(code_heads) != 1:
        return Check(
            "FAIL", f"expected one code head, found {len(code_heads)}; {detail}"
        )
    if db_heads != tuple(code_heads):
        return Check("FAIL", f"DB revision does not match code head; {detail}")
    return Check("PASS", detail)


def check_required_tables(connection: Connection) -> Check:
    # Register every model, including models not imported by the running API.
    for module in iter_modules(models.__path__, f"{models.__name__}."):
        import_module(module.name)

    inspector = inspect(connection)
    existing = set(inspector.get_table_names())
    missing_tables = []
    missing_columns = []
    for table in Base.metadata.sorted_tables:
        if table.name not in existing:
            missing_tables.append(table.name)
            continue
        columns = {column["name"] for column in inspector.get_columns(table.name)}
        missing_columns.extend(
            f"{table.name}.{column.name}"
            for column in table.columns
            if column.name not in columns
        )

    issues = []
    if missing_tables:
        issues.append(f"missing tables: {', '.join(sorted(missing_tables))}")
    if missing_columns:
        issues.append(f"missing columns: {', '.join(sorted(missing_columns))}")
    if issues:
        return Check("FAIL", "; ".join(issues))
    return Check(
        "PASS", f"{len(Base.metadata.tables)} model tables and their columns present"
    )


async def check_published_content(
    connection: AsyncConnection, root_setting: str
) -> Check:
    count = await connection.scalar(
        select(func.count()).select_from(NpcPublicationState)
    )
    if not root_setting.strip():
        if count:
            return Check(
                "FAIL",
                "PUBLISHED_CONTENT_ROOT is unset with publication records present",
            )
        return Check("SKIP", "no publication records; PUBLISHED_CONTENT_ROOT is unset")

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
    failures = Counter(entry.status for entry in entries if not entry.available)
    issues = [f"{status}={total}" for status, total in sorted(failures.items())]
    if len(entries) != count:
        issues.append(
            "publication records lack matching version metadata or changed during the check"
        )
    if issues:
        return Check("FAIL", "; ".join(issues))
    return Check("PASS", f"{len(entries)} version(s) rebuilt in a temporary store")


async def run_checks(schema_only: bool) -> tuple[Check, Check, Check]:
    # Settings validation can include sensitive input values. Load settings
    # inside the CLI's redacted error boundary.
    from app.core.config import settings
    from app.db.session import engine

    skipped = Check(
        "SKIP", "schema-only mode" if schema_only else "database unavailable"
    )
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
            return alembic, tables, content
    except SQLAlchemyError:
        unavailable = Check("FAIL", "database connection failed")
        return unavailable, unavailable, skipped
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--schema-only", action="store_true", help="check Alembic and model schema only"
    )
    args = parser.parse_args(argv)
    previous_logging_level = logging.root.manager.disable
    # The shared startup code logs restoration errors. Print only this CLI's
    # controlled diagnostics, even if a driver or validation error has secrets.
    logging.disable(logging.CRITICAL)
    try:
        results = asyncio.run(run_checks(args.schema_only))
    except Exception:
        print(
            "Deployment Check: FAIL (could not load configuration or complete checks)"
        )
        print("Overall: FAIL")
        return 1
    finally:
        logging.disable(previous_logging_level)

    for label, result in zip(
        ("Alembic", "Required Tables", "Published Content"), results, strict=True
    ):
        print(f"{label}: {result.status} ({result.detail})")
    if not args.schema_only:
        print("Running App Restore: SKIP (process memory was not inspected)")
    failed = any(result.status == "FAIL" for result in results)
    print(f"Overall: {'FAIL' if failed else 'PASS'}")
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
