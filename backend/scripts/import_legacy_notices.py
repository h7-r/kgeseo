"""웹사이트에 하드코딩된 옛 공지(website/src/data/support.ts 의 NOTICES)를 notices 표로 옮긴다(11/16 세진).

마이그레이션과 따로 둔 명시 실행 명령이다. 운영 DB 에는 PM 이 실행을 승인한 뒤에만 쓴다.

    python -m scripts.import_legacy_notices                                   # 확인만(DB 에 접속하지 않는다)
    python -m scripts.import_legacy_notices --bodies bodies.json              # 본문 파일을 붙여 확인만
    python -m scripts.import_legacy_notices --bodies bodies.json --execute --confirm <DB 이름>   # 등록

- 원본에 있는 값만 쓴다: 분류 · 제목 · 날짜. **본문은 원본에 없다** — 본문이 없는 공지는 등록하지 않고 「본문 없음」으로 보고한다.
  본문을 넣으려면 사람이 쓴 본문을 `--bodies` JSON(`{"<legacy_key>": "본문", ...}`)으로 준다. 이 명령은 글을 만들어 내지 않는다.
- 식별: 공지 id = uuid5(고정 네임스페이스, "legacy-notice|<날짜>|<원본 분류>|<제목>"). 같은 원본은 늘 같은 id 다(legacy_key 는
  그 id 의 앞 8자리). 이미 그 id 가 표에 있으면(삭제된 것 포함) 건너뛴다 → 여러 번 실행해도 중복 등록되지 않고, 지운 공지를 되살리지 않는다.
- **한계**: id 는 원본의 날짜 · 분류 · 제목 글자로 정해진다. 등록한 뒤 웹 원본의 제목 · 날짜 · 분류를 한 글자라도 고치고 다시 실행하면
  다른 id 가 되어 **고친 공지가 새로 하나 더 들어간다**(앞의 것은 그대로). 그래서 등록은 원본을 고정한 상태에서 한 번만 하고, 고친 내용은
  관리자 화면(PATCH)으로 반영한다. 다시 실행하기 전에는 확인 모드로 「등록 대상」이 0 인지 본다. 관리자 화면에서 고친 제목은 id 와
  무관하다(id 는 원본 기준이라 다시 실행해도 그 공지는 「이미 있음」).
- 실패: 넣을 것을 한 트랜잭션으로 커밋한다 — 도중 DB 오류면 이번 실행분은 하나도 남지 않고(부분 등록 없음) 종료 코드 4. 원인을 고친 뒤
  다시 실행하면 된다. 등록 대상이 0 이면 --execute 여도 DB 에 접속하지 않는다.
- 게시 시각: 원본 날짜의 00:00 KST(= 전날 15:00 UTC). 고정 아님 · 작성자 없음(created_by NULL).
- --execute 에는 --confirm 으로 지금 설정의 DB 이름을 한 번 더 적어야 한다(다른 DB 에 잘못 쓰지 않게). 출력에는 DB 이름 · 건수 ·
  각 공지의 legacy_key · 분류 · 날짜 · 제목 · 결과만 나온다(접속 정보는 내지 않는다).
- 이 명령은 감사 기록을 남기지 않는다(관리자 요청이 아니다). 실행 사실은 운영 기록으로 남긴다.
- 종료 코드: 0 = 정상(확인만 · 등록 · 등록 대상 없음), 2 = 잘못된 사용(쓰지 않음), 4 = DB 오류(이번 실행분 저장 안 됨).
"""

import argparse
import asyncio
import json
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid5

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notice import NOTICE_BODY_MAX, NOTICE_TITLE_MAX, Notice

EXIT_USAGE = 2
EXIT_DB_ERROR = 4
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = REPO_ROOT / "website" / "src" / "data" / "support.ts"
# 이 네임스페이스는 바꾸지 않는다 — 바꾸면 같은 원본이 다른 id 가 되어 중복 등록된다
LEGACY_NAMESPACE = UUID("6b0f3d2e-7c41-5a9e-9d1b-1f0e5c3a8b47")
CATEGORY_MAP = {
    "점검": "maintenance",
    "이벤트": "event",
    "업데이트": "update",
    "안내": "info",
}
KST_OFFSET = timedelta(hours=9)

_ARRAY = re.compile(r"export const NOTICES[^=]*=\s*\[(?P<body>.*?)\n\];", re.S)
_OBJECT = re.compile(r"\{(?P<fields>[^{}]*)\}", re.S)
_FIELD = re.compile(r'(?P<key>[A-Za-z_]+)\s*:\s*"(?P<value>(?:[^"\\]|\\.)*)"')


class UsageError(Exception):
    """잘못된 사용. 문구를 그대로 출력하고 아무것도 쓰지 않는다."""


@dataclass(frozen=True)
class LegacyNotice:
    source_category: str
    title: str
    date: str  # 원본 그대로 "YYYY.MM.DD"
    body: str | None  # 원본에 본문 칸이 있으면

    @property
    def notice_id(self) -> str:
        key = f"legacy-notice|{self.date}|{self.source_category}|{self.title}"
        return str(uuid5(LEGACY_NAMESPACE, key))

    @property
    def legacy_key(self) -> str:
        return self.notice_id[:8]


@dataclass(frozen=True)
class Planned:
    notice: LegacyNotice
    body: str | None
    reason: str | None  # None 이면 등록 대상

    @property
    def is_candidate(self) -> bool:
        return self.reason is None


def parse_legacy_notices(text: str) -> list[LegacyNotice]:
    """support.ts 의 NOTICES 배열에서 문자열 칸만 읽는다(코드를 실행하지 않는다)."""

    found = _ARRAY.search(text)
    if found is None:
        raise UsageError("원본에서 `export const NOTICES` 배열을 찾지 못했습니다.")
    notices = []
    for match in _OBJECT.finditer(found.group("body")):
        fields = {
            m.group("key"): json.loads(f'"{m.group("value")}"')
            for m in _FIELD.finditer(match.group("fields"))
        }
        missing = {"category", "title", "date"} - fields.keys()
        if missing:
            raise UsageError(f"원본 공지에 칸이 없습니다: {sorted(missing)}")
        notices.append(
            LegacyNotice(
                source_category=fields["category"],
                title=fields["title"],
                date=fields["date"],
                body=fields.get("body"),
            )
        )
    if not notices:
        raise UsageError(
            "원본 NOTICES 배열에서 공지를 하나도 읽지 못했습니다(원본 형식이 바뀌었는지 확인)."
        )
    return notices


def published_at_of(notice: LegacyNotice) -> datetime:
    """원본 날짜 00:00 KST 를 UTC naive 로."""

    day = date(*(int(part) for part in notice.date.split(".")))
    return datetime(day.year, day.month, day.day) - KST_OFFSET


def plan(notices: list[LegacyNotice], bodies: dict[str, str]) -> list[Planned]:
    """등록 대상과 제외(사유)를 가른다. 본문은 원본 칸 → --bodies(legacy_key) 순으로 찾고, 어디에도 없으면 제외."""

    planned: list[Planned] = []
    seen: set[str] = set()
    for notice in notices:
        body = (notice.body or bodies.get(notice.legacy_key) or "").strip() or None
        reason = None
        if notice.notice_id in seen:
            reason = "원본 안에서 중복"
        elif notice.source_category not in CATEGORY_MAP:
            reason = f"모르는 분류({notice.source_category})"
        elif not notice.title.strip() or len(notice.title) > NOTICE_TITLE_MAX:
            reason = "제목 길이(1~200자) 밖"
        elif not re.fullmatch(r"\d{4}\.\d{2}\.\d{2}", notice.date):
            reason = f"날짜 형식이 아님({notice.date})"
        elif body is None:
            reason = "본문 없음(원본에 본문이 없고 --bodies 에도 없음)"
        elif len(body) > NOTICE_BODY_MAX:
            reason = "본문 20,000자 초과"
        seen.add(notice.notice_id)
        planned.append(Planned(notice=notice, body=body, reason=reason))
    return planned


def load_bodies(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise UsageError(f"--bodies 파일을 읽지 못했습니다: {error}") from error
    if not isinstance(data, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in data.items()
    ):
        raise UsageError(
            '--bodies 는 {"<legacy_key>": "본문"} 모양의 JSON 이어야 합니다.'
        )
    return data


async def import_candidates(
    db: AsyncSession, candidates: list[Planned], now: datetime
) -> tuple[list[Planned], list[Planned]]:
    """없는 것만 넣는다(한 트랜잭션). (넣은 것, 이미 있어 건너뛴 것) — 이미 있음에는 삭제된 공지도 든다."""

    ids = [item.notice.notice_id for item in candidates]
    existing = (
        set((await db.execute(select(Notice.id).where(Notice.id.in_(ids)))).scalars())
        if ids
        else set()
    )
    inserted, skipped = [], []
    for item in candidates:
        if item.notice.notice_id in existing:
            skipped.append(item)
            continue
        db.add(
            Notice(
                id=item.notice.notice_id,
                category=CATEGORY_MAP[item.notice.source_category],
                title=item.notice.title.strip(),
                body=item.body,
                is_pinned=False,
                published_at=published_at_of(item.notice),
                created_by=None,
                created_at=now,
                updated_at=now,
                deleted_at=None,
            )
        )
        inserted.append(item)
    await db.commit()
    return inserted, skipped


def _line(item: Planned, result: str) -> str:
    n = item.notice
    return f"  [{n.legacy_key}] {n.source_category} {n.date} {n.title} - {result}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--bodies", type=Path, default=None)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm", default=None)
    args = parser.parse_args(argv)
    try:
        notices = parse_legacy_notices(args.source.read_text(encoding="utf-8"))
        planned = plan(notices, load_bodies(args.bodies))
    except (UsageError, OSError) as error:
        print(f"사용 오류: {error}", file=sys.stderr)
        return EXIT_USAGE
    candidates = [item for item in planned if item.is_candidate]
    excluded = [item for item in planned if not item.is_candidate]
    print(f"원본 {len(planned)}건 - 등록 대상 {len(candidates)} · 제외 {len(excluded)}")
    for item in candidates:
        print(_line(item, "등록 대상"))
    for item in excluded:
        print(_line(item, f"제외: {item.reason}"))
    if not args.execute:
        print(
            "확인만 했습니다(DB 에 접속하지 않음). 등록하려면 --execute --confirm <DB 이름>."
        )
        return 0

    from app.core.config import settings  # 확인만 할 때는 설정 · DB 를 읽지 않는다

    if args.confirm != settings.db_name:
        print(
            "사용 오류: --execute 에는 --confirm 으로 지금 설정의 DB 이름을 정확히 적어야 합니다.",
            file=sys.stderr,
        )
        return EXIT_USAGE
    if not candidates:
        # 넣을 것이 없으면 DB 에 접속하지 않는다(지금 원본 9건은 모두 본문 없음)
        print(f"db={settings.db_name} - 등록 대상이 없어 DB 에 접속하지 않았습니다.")
        return 0

    from sqlalchemy.exc import SQLAlchemyError

    from app.db.session import AsyncSessionLocal, engine
    from app.services.local_auth import utc_now

    async def run() -> tuple[list[Planned], list[Planned]]:
        try:
            async with AsyncSessionLocal() as db:
                return await import_candidates(db, candidates, utc_now())
        finally:
            await engine.dispose()

    try:
        inserted, skipped = asyncio.run(run())
    except SQLAlchemyError as error:
        # 한 트랜잭션이라 커밋 전 실패면 아무것도 들어가지 않는다 — 원인을 고친 뒤 다시 실행하면 된다(이미 든 것은 건너뛴다)
        print(
            f"DB 오류로 멈췄습니다(이번 실행은 저장되지 않음): {type(error).__name__}",
            file=sys.stderr,
        )
        return EXIT_DB_ERROR
    print(
        f"db={settings.db_name} - 등록 {len(inserted)} · 이미 있음 {len(skipped)} · 제외 {len(excluded)}"
    )
    for item in inserted:
        print(_line(item, "등록함"))
    for item in skipped:
        print(_line(item, "이미 있음(건너뜀)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
