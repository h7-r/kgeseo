"""탈퇴 회원의 베타 설문 참가 번호 보기(읽기 전용) — 설문 응답 시트에서 그 응답을 찾아 지우기 위한 것(계약 account_withdrawal_v0.2 §8).

    python -m scripts.withdrawn_survey_codes                     # 최근 14일(KST) 안에 탈퇴한 회원
    python -m scripts.withdrawn_survey_codes --since 2026-11-01  # 그날 00:00 KST 부터 탈퇴한 회원
    python scripts/withdrawn_survey_codes.py --since 2026-11-01  # 위와 같다(backend 폴더에서)

- `deleted_at` 이 있는 회원만, 탈퇴 시각 순으로 「탈퇴 시각(KST) · 종류 · 번호 · 겹침」을 화면에만 낸다. 파일을 쓰지 않는다.
  - `account` = 계정 참가 번호(로그인한 채 연 설문). 클라이언트 `shortKey` 와 같은 계산(FNV-1a 32비트, 16진 대문자 8자).
  - `code` = 그 계정 기록에 함께 찍힌 참여 코드(`XXXX-XXXX`) — 같은 사람이 로그인하지 않은 때 연 설문.
  - 겹침 = 같은 계정 참가 번호를 가진 다른 계정 수. 0 이 아니면 번호만으로 사람을 정할 수 없다(운영 문서의 확인 절차를 따른다).
- 계정 id · 이메일 · 닉네임 · 비밀번호 · 세션은 읽지도 내지도 않는다(계정 id 는 번호 계산에만 쓰고 출력하지 않는다).
- 읽기 전용 트랜잭션(`SET TRANSACTION READ ONLY`)으로 읽고 되돌린다 — DB 를 바꾸지 않는다. 접속 계정은 앱 설정(`DB_*`)이며, 운영에서는
  읽기 전용 계정(`app_users(id, deleted_at)` · `beta_events(app_user_id, participant_code)` SELECT 만)으로 바꿔 실행한다.
- 종료 코드: 0 = 정상(대상이 없어도), 2 = 잘못된 사용.
"""

import argparse
import asyncio
import sys
from datetime import date, timedelta
from pathlib import Path

if __package__ in (None, ""):
    # `python scripts/withdrawn_survey_codes.py` 로 불러도 app 패키지를 찾게(backend 폴더 기준)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.admin_query import kst_today  # noqa: E402
from app.services.withdrawn_survey import (  # noqa: E402
    SurveyCode,
    begin_read_only,
    withdrawn_survey_codes,
)

EXIT_USAGE = 2
# 주 1회 실행 + 한 번 빠뜨려도 이어지게 기본 창을 두 주로 둔다(탈퇴 뒤 7일 안 삭제 기한)
DEFAULT_DAYS = 14


class UsageError(Exception):
    """잘못된 사용. 문구를 그대로 출력하고 DB 에 접속하지 않는다."""


def parse_since(value: str | None, today: date) -> date:
    if value is None:
        return today - timedelta(days=DEFAULT_DAYS)
    try:
        since = date.fromisoformat(value)
    except ValueError:
        raise UsageError("--since 는 YYYY-MM-DD(KST 날짜)여야 합니다.") from None
    if since > today:
        raise UsageError("--since 는 오늘(KST) 이후일 수 없습니다.")
    return since


def format_rows(since: date, rows: list[SurveyCode], db_name: str) -> list[str]:
    people = sum(1 for row in rows if row.kind == "account")
    lines = [
        f"[READ-ONLY] db={db_name} since={since.isoformat()} 00:00 KST "
        f"withdrawn={people} rows={len(rows)}",
    ]
    if not rows:
        return lines
    lines.append("탈퇴 시각(KST)    종류     번호        겹침")
    for row in rows:
        overlap = (
            "-"
            if row.shared_with == 0
            else f"다른 계정 {row.shared_with}개와 같은 번호 — 확인 필요"
        )
        lines.append(
            f"{row.withdrawn_at_kst}  {row.kind:<7}  {row.code:<10}  {overlap}"
        )
    return lines


async def run(session_factory, since: date) -> list[SurveyCode]:
    async with session_factory() as db:
        try:
            await begin_read_only(db)
            return await withdrawn_survey_codes(db, since)
        finally:
            await db.rollback()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--since",
        help=f"이 KST 날짜 00:00 부터 탈퇴한 회원(그날 포함). 없으면 최근 {DEFAULT_DAYS}일",
    )
    return parser.parse_args(argv)


async def _main(args: argparse.Namespace) -> int:
    from app.core.config import settings
    from app.db.session import AsyncSessionLocal, engine

    try:
        since = parse_since(args.since, kst_today())
    except UsageError as error:
        print(f"[USAGE] {error}")
        return EXIT_USAGE
    try:
        rows = await run(AsyncSessionLocal, since)
    finally:
        await engine.dispose()
    print("\n".join(format_rows(since, rows, settings.db_name)))
    return 0


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(_main(parse_args(argv)))


if __name__ == "__main__":
    sys.exit(main())
