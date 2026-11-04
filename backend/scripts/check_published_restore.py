"""게시본 복구 확인(CLI) v0.1 — 서버 재시작 복구를 게시 상태를 바꾸지 않고 미리 해 본다(팀 검토 대기).

    .\\.venv\\Scripts\\python.exe -m scripts.check_published_restore \\
        [--content-root <게시 루트>]          # 기본: 앱 설정 PUBLISHED_CONTENT_ROOT
        [--expect <case_id>:<content_version>]  # 이 버전이 반드시 복구돼야 한다(여러 번 줄 수 있음)

- 앱 시작 때 부르는 `content_release.restore_on_startup`을 그대로 부른다. 같은 DB 게시 상태 · 같은 원본 파일 ·
  같은 fingerprint 재확인으로 **빈 저장소(이 프로세스 메모리)**에 채워 본다. DB는 읽기만 한다(게시 상태 · 이력 쓰기 없음).
- 버전마다 `registered` · `files_missing` · `invalid_location` · `rebuild_failed` 등과 게시 상태를 출력한다.
  `registered`가 아닌 버전은 앱 서버에서도 그 버전의 고정 세션이 409가 된다.
- 게시 루트가 비어 있거나 DB 상태를 읽지 못하면 복구할 수 없다(앱 서버와 같다).

종료 코드: 0 모두 복구 가능(그리고 --expect 모두 있음), 1 입력 · 설정 오류 또는 복구 실패.
"""

import argparse
import asyncio
import sys
from collections.abc import Callable, Sequence

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.services.content_release import RegistrationEntry, restore_on_startup
from app.services.pinned_content import PinnedContentStore

EXIT_OK, EXIT_FAILED = 0, 1


class CliInputError(ValueError):
    pass


def parse_expect(values: Sequence[str]) -> set[tuple[str, int]]:
    expected = set()
    for value in values:
        case_id, sep, version = value.rpartition(":")
        if not sep or not case_id or not version.isdigit() or int(version) < 1:
            raise CliInputError(
                f"--expect must be <case_id>:<content_version>: {value}"
            )
        expected.add((case_id, int(version)))
    return expected


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--content-root", default=None, help="기본: PUBLISHED_CONTENT_ROOT"
    )
    parser.add_argument("--expect", action="append", default=[])
    return parser.parse_args(argv)


async def run(
    args: argparse.Namespace,
    sessions: async_sessionmaker[AsyncSession],
    configured_root: str,
    out: Callable[[str], None] = print,
    *,
    restore: Callable = restore_on_startup,
) -> int:
    expected = parse_expect(args.expect)
    root = args.content_root if args.content_root is not None else configured_root
    if not root.strip():
        raise CliInputError(
            "PUBLISHED_CONTENT_ROOT is not set (the app restores nothing)"
        )
    if args.content_root is not None and args.content_root != configured_root:
        out(
            "note: --content-root differs from PUBLISHED_CONTENT_ROOT — the app restores from the setting"
        )
    entries: tuple[RegistrationEntry, ...] | None = await restore(
        root, sessions, PinnedContentStore()
    )
    if entries is None:
        out("restore=FAILED (DB 게시 상태를 읽지 못했다 — 아무것도 복구되지 않는다)")
        return EXIT_FAILED
    failed = False
    out(f"versions={len(entries)}")
    for entry in entries:
        mark = "ok" if entry.available else "UNAVAILABLE"
        reason = f" reason={entry.reason}" if entry.reason else ""
        out(
            f"  {entry.case_id}:v{entry.content_version} {entry.status} "
            f"publication={entry.publication_status}{reason} -> {mark}"
        )
        failed |= not entry.available
    available = {(e.case_id, e.content_version) for e in entries if e.available}
    for case_id, version in sorted(expected - available):
        out(f"  expected {case_id}:v{version} -> NOT RESTORED")
        failed = True
    out("restore=" + ("FAILED" if failed else "OK"))
    return EXIT_FAILED if failed else EXIT_OK


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        from app.core.config import settings
        from app.db.session import AsyncSessionLocal, engine

        async def execute() -> int:
            try:
                return await run(
                    args, AsyncSessionLocal, settings.published_content_root
                )
            finally:
                await engine.dispose()

        return asyncio.run(execute())
    except CliInputError as error:
        print(f"[ERROR] {error}")
        return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
