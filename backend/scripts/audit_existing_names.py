"""기존 회원 닉네임 · 게임 조사관명을 지금 공유 정책(shared/nickname-policy.json)으로 다시 본다 — 읽기 전용 현황 조사.

    python -m scripts.audit_existing_names                  # 집계만(개인정보 없음)
    python -m scripts.audit_existing_names --batch-size 500

배경: 11/27 까지 운영 배포 묶음에 shared/ 가 빠져 백엔드가 옛 내장 목록(금칙어 10 · 예약어 9)으로 판정했다(#219 로 정상화).
그 기간에 들어온 이름 가운데 지금 정책에 어긋나는 것이 얼마나 되는지 센다. 이름을 바꾸거나 지우거나 회원을 막지 않는다.

- 판정은 실제 함수 그대로다: 사이트 닉네임 = `nickname_policy.validate_nickname`(가입 규칙), 조사관명 = `lobby.public_investigator_name`
  (로비 표시 규칙). 두 규칙은 일부러 다르다(조사관명은 자모 · 낱말 사이 한 칸 공백 허용, 정규화도 다름) — 통일하지 않는다.
- 공유 정책을 실제로 쓰고 있는지 먼저 확인한다. 파일이 없거나 · 읽히지 않거나 · 돌고 있는 판정기가 그 파일로 만든 것과 다르면
  (= 내장 목록으로 돌고 있으면) 조회 전에 멈추고 종료 코드 3. 내장 목록 기준으로는 「점검 완료」를 내지 않는다.
- DB 는 SELECT 만, 하나의 읽기 전용 트랜잭션(`REPEATABLE READ, READ ONLY`)에서 회원 id 순으로 묶음 조회한다. 한 트랜잭션이라
  모든 묶음이 같은 시점(첫 조회 때)의 스냅숏을 본다 — 그 뒤 가입 · 이름 변경은 이번 집계에 들어가지 않는다.
- 출력은 건수뿐이다. 이름 · 이메일 · 회원 id · 해시는 내지 않는다(개별 대상 출력 옵션은 없다).
- 종료 코드: 0 = 점검 완료(위반이 있어도 0 — 위반 여부는 `Violations found:` 줄로 본다), 2 = 잘못된 사용,
  3 = 공유 정책을 쓸 수 없음(조회하지 않음), 4 = DB 오류(집계 없음).
"""

import argparse
import asyncio
import hashlib
import json
import logging
import re
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

POLICY_PATH = Path(__file__).resolve().parents[2] / "shared" / "nickname-policy.json"
DEFAULT_BATCH_SIZE = 500
MAX_BATCH_SIZE = 5000
EXIT_OK, EXIT_USAGE, EXIT_POLICY, EXIT_DB = 0, 2, 3, 4

SITE_REASONS = ("control_character", "length", "format", "reserved", "profanity")
LOBBY_REASONS = ("control_character", "length", "format", "reserved", "profanity")


class PolicyUnavailable(Exception):
    pass


@dataclass
class Policy:
    """점검에 쓰는 판정기 묶음 — 돌고 있는 판정기(공유 정책)와 비교용 옛 내장 목록."""

    npol: object
    lobby: object
    shared_judge: object
    fallback_judge: object
    evidence: dict


def _judge_state(judge) -> dict:
    return {**vars(judge), "encoder": vars(judge.encoder)}


def load_policy_or_fail() -> Policy:
    """Check the shared file before loading modules that build the app policy."""
    path = POLICY_PATH
    if not path.is_file():
        raise PolicyUnavailable(f"{path.name} missing or not a file")
    try:
        raw = path.read_bytes()
        parsed = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        raise PolicyUnavailable(f"{path.name} unreadable") from None

    # The service logs an absolute path if the file disappears during import.
    policy_logger = logging.getLogger("app.services.nickname_policy")
    previous_level = policy_logger.level
    policy_logger.setLevel(logging.ERROR)
    try:
        from app.services import nickname_policy as npol

        if npol.POLICY_PATH != path:
            raise PolicyUnavailable("shared policy path differs from the service path")
        loaded = npol.load_policy(path)
        if loaded is npol._FALLBACK_POLICY:  # noqa: SLF001
            raise PolicyUnavailable("loader returned the built-in fallback")
        if loaded != parsed or _judge_state(npol.JUDGE) != _judge_state(
            npol.Judge(parsed)
        ):
            raise PolicyUnavailable(
                "running policy differs from the shared file (fallback or stale policy)"
            )
        from app.api.v1 import lobby

        fallback = npol.Judge(npol._FALLBACK_POLICY)  # noqa: SLF001
        evidence = {
            "file": path.name,
            "sha256": hashlib.sha256(raw).hexdigest()[:12],
            "bytes": len(raw),
            "reserved_entries": len(loaded["reserved"]["word"])
            + len(loaded["reserved"]["contains"]),
            "forbidden_entries": sum(
                len(body.get(kind, []))
                for body in loaded["forbidden"]["categories"].values()
                for kind in ("contains", "strict", "word")
            ),
        }
    except PolicyUnavailable:
        raise
    except Exception as error:  # noqa: BLE001 — 불러온 뒤 파일이 바뀌어 구조가 깨진 경우 등
        raise PolicyUnavailable(
            f"{path.name} structure unusable ({type(error).__name__})"
        ) from None
    finally:
        policy_logger.setLevel(previous_level)
    return Policy(npol, lobby, npol.JUDGE, fallback, evidence)


# ---------------------------------------------------------------- 판정(실제 함수 재사용)


def site_reasons(npol, judge, value: str) -> list[str]:
    """가입 규칙(`Judge.validate_nickname`)이 거부하는 이유들(여럿일 수 있다). 최종 판정은 validate_nickname 이 정한다."""
    reasons = []
    if any(unicodedata.category(c).startswith("C") for c in value):
        reasons.append("control_character")
    name = npol.normalize_nickname(value)
    if not judge.min_length <= len(name) <= judge.max_length:
        reasons.append("length")
    if npol.NICKNAME_SHAPE.fullmatch(name) is None:
        reasons.append("format")
    if judge.has_reserved_term(name):
        reasons.append("reserved")
    if judge.forbidden_terms_in(name):
        reasons.append("profanity")
    return reasons


def site_valid(npol, judge, value: str) -> bool:
    try:
        judge.validate_nickname(value)
        return True
    except npol.InvalidNicknameError:
        return False


def lobby_reasons(lobby, judge, raw: str) -> list[str]:
    """로비 조사관명 규칙(`lobby.public_investigator_name`)의 단계별 이유. 판정기만 바꿔 옛 내장 목록과 비교할 때도 쓴다."""
    reasons = []
    if any(unicodedata.category(c).startswith("C") for c in raw):
        return ["control_character"]  # 실제 함수도 여기서 끝낸다
    name = re.sub(r"\s+", " ", unicodedata.normalize("NFC", raw).strip())
    if not 2 <= len(name) <= 12:
        reasons.append("length")
    if lobby.INVESTIGATOR_NAME.fullmatch(name) is None:
        reasons.append("format")
    compact = name.replace(" ", "")
    if judge.has_reserved_term(compact):
        reasons.append("reserved")
    if judge.forbidden_terms_in(compact):
        reasons.append("profanity")
    return reasons


# ---------------------------------------------------------------- 집계


@dataclass
class Tally:
    scanned: int = 0
    valid: int = 0
    invalid: int = 0
    reasons: Counter = field(default_factory=Counter)
    fallback_allowed: int = (
        0  # 지금은 거부 · 옛 내장 목록이면 허용(배포 누락과 관련 있을 수 있는 후보)
    )
    not_normalized: int = 0  # 저장값이 정규화된 모양과 다름(정보)
    unexplained: int = 0  # 실제 함수는 거부했는데 단계별 이유가 안 잡힘(0 이어야 정상)
    by_group: Counter = field(
        default_factory=Counter
    )  # 거부 건수를 회원 · 관리자 · 테스트로


@dataclass
class Report:
    accounts_total: int = 0
    excluded: Counter = field(default_factory=Counter)
    groups: Counter = field(default_factory=Counter)
    nicknames: Tally = field(default_factory=Tally)
    characters: Tally = field(default_factory=Tally)
    lobby_kept: int = 0
    lobby_fallback: int = 0
    lobby_fallback_nickname_invalid: int = 0
    no_character: int = 0
    no_character_nickname_invalid: int = 0
    withdrawn_with_character: int = 0


def group_of(role: str, is_test: bool) -> str:
    if role == "admin":
        return "admin"
    return "test" if is_test else "member"


def audit_row(policy: Policy, report: Report, row) -> None:
    npol, lobby = policy.npol, policy.lobby
    report.accounts_total += 1
    if row.deleted_at is not None:
        # 탈퇴 회원은 닉네임이 비식별 값(탈퇴#…)이라 가입 규칙과 비교하지 않는다
        report.excluded["withdrawn"] += 1
        if row.display_name is not None:
            report.withdrawn_with_character += 1
        return
    group = group_of(row.role, bool(row.is_test))
    report.groups[group] += 1

    tally = report.nicknames
    tally.scanned += 1
    nickname_ok = site_valid(npol, policy.shared_judge, row.nickname)
    if row.nickname != npol.normalize_nickname(row.nickname):
        tally.not_normalized += 1
    if nickname_ok:
        tally.valid += 1
    else:
        tally.invalid += 1
        tally.by_group[group] += 1
        reasons = site_reasons(npol, policy.shared_judge, row.nickname)
        tally.reasons.update(reasons)
        if not reasons:
            tally.unexplained += 1
        if site_valid(npol, policy.fallback_judge, row.nickname):
            tally.fallback_allowed += 1

    if row.display_name is None:
        report.no_character += 1
        if not nickname_ok:
            report.no_character_nickname_invalid += 1
        return
    chars = report.characters
    chars.scanned += 1
    shown = lobby.public_investigator_name(row.display_name)
    if row.display_name != re.sub(
        r"\s+", " ", unicodedata.normalize("NFC", row.display_name).strip()
    ):
        chars.not_normalized += 1
    if shown is not None:
        chars.valid += 1
        report.lobby_kept += 1
        return
    chars.invalid += 1
    chars.by_group[group] += 1
    reasons = lobby_reasons(lobby, policy.shared_judge, row.display_name)
    chars.reasons.update(reasons)
    if not reasons:
        chars.unexplained += 1
    if not lobby_reasons(lobby, policy.fallback_judge, row.display_name):
        chars.fallback_allowed += 1
    # 로비는 입장을 막지 않는다 — 머리 위 이름만 계정 닉네임으로 대신한다(계정 닉네임은 다시 검사하지 않는다)
    report.lobby_fallback += 1
    if not nickname_ok:
        report.lobby_fallback_nickname_invalid += 1


async def scan(sessions, policy: Policy, batch_size: int) -> Report:
    from sqlalchemy import select, text

    from app.models.account_data import UserCharacter
    from app.models.app_user import AppUser

    report = Report()
    last_id = ""
    async with sessions() as db:
        # 이 세션의 첫 문장 — 다음 트랜잭션 하나(이 점검 전체)에만 적용된다(세션 · 전역 설정은 그대로).
        # READ ONLY: 쓰기 문장은 MySQL 이 거부한다. REPEATABLE READ: 첫 SELECT 때 만든 스냅숏을 모든 묶음이 같이 본다 —
        # 서버나 계정의 기본값이 READ COMMITTED 여도(그러면 묶음마다 새 스냅숏이 되어 점검 중 가입 · 탈퇴가 섞인다).
        await db.execute(
            text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        )
        try:
            while True:
                rows = (
                    await db.execute(
                        select(
                            AppUser.id,
                            AppUser.nickname,
                            AppUser.role,
                            AppUser.is_test,
                            AppUser.deleted_at,
                            UserCharacter.display_name,
                        )
                        .outerjoin(
                            UserCharacter, UserCharacter.app_user_id == AppUser.id
                        )
                        .where(AppUser.id > last_id)
                        .order_by(AppUser.id)
                        .limit(batch_size)
                    )
                ).all()
                for row in rows:
                    audit_row(policy, report, row)
                if len(rows) < batch_size:
                    break
                last_id = rows[-1].id
        finally:
            await db.rollback()
    return report


# ---------------------------------------------------------------- 출력


def render(policy: Policy, report: Report) -> str:
    e, n, c = policy.evidence, report.nicknames, report.characters
    lines = [
        "[Shared Policy]",
        "Status: PASS",
        f"Source: {e['file']} (sha256 {e['sha256']}, {e['bytes']} bytes) · reserved entries {e['reserved_entries']}"
        f" · forbidden entries {e['forbidden_entries']} · running judge = shared file (not built-in fallback)",
        "",
        "[Accounts]",
        f"Total rows: {report.accounts_total}",
        f"Excluded: {sum(report.excluded.values())} (withdrawn — anonymized nickname, not a sign-up name: {report.excluded['withdrawn']})",
        f"Scanned: {sum(report.groups.values())} (member {report.groups['member']} · admin {report.groups['admin']}"
        f" · test {report.groups['test']})",
        "",
        "[Account Nicknames] (sign-up rule: nickname_policy.validate_nickname)",
        f"Scanned: {n.scanned}",
        f"Valid: {n.valid}",
        f"Invalid: {n.invalid} (member {n.by_group['member']} · admin {n.by_group['admin']} · test {n.by_group['test']})",
        "",
        "[Character Names] (lobby rule: lobby.public_investigator_name)",
        f"Scanned: {c.scanned}",
        f"Valid: {c.valid}",
        f"Invalid: {c.invalid} (member {c.by_group['member']} · admin {c.by_group['admin']} · test {c.by_group['test']})",
        "",
        "[Policy Violations] (one name can have several reasons — these do not add up to Invalid)",
    ]
    for label, tally in (("Nicknames", n), ("Characters", c)):
        counts = " · ".join(
            f"{reason} {tally.reasons[reason]}" for reason in SITE_REASONS
        )
        lines.append(f"{label}: {counts} · unexplained {tally.unexplained}")
    lines += [
        f"Allowed by the old built-in fallback list but invalid now: nicknames {n.fallback_allowed} · characters {c.fallback_allowed}",
        f"Stored value not in normalized form (info): nicknames {n.not_normalized} · characters {c.not_normalized}",
        "",
        "[Lobby Impact] (lobby entry is never refused by name — only the shown name changes)",
        f"Character name shown: {report.lobby_kept}",
        f"Fallback to account nickname: {report.lobby_fallback} (of which the account nickname is also invalid: "
        f"{report.lobby_fallback_nickname_invalid})",
        f"No character (account nickname shown): {report.no_character} (of which invalid: {report.no_character_nickname_invalid})",
        f"Withdrawn accounts that still have a character row (should be 0): {report.withdrawn_with_character}",
        "",
        "[Overall]",
        f"Violations found: {'yes' if n.invalid or c.invalid else 'no'}",
        "Completed: PASS",
    ]
    return "\n".join(lines)


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description=__doc__.splitlines()[0], allow_abbrev=False
    )
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    args = parser.parse_args(argv)
    if not 1 <= args.batch_size <= MAX_BATCH_SIZE:
        parser.error(f"--batch-size must be 1-{MAX_BATCH_SIZE}")
    return args


async def _run(args) -> int:
    try:
        policy = load_policy_or_fail()
    except PolicyUnavailable as error:
        print("[Shared Policy]")
        print(f"Status: FAIL ({error})")
        print("[Overall]")
        print("Completed: FAIL (not scanned — the shared policy is not in use)")
        return EXIT_POLICY
    try:
        from app.db import session as session_module

        try:
            report = await scan(
                session_module.AsyncSessionLocal, policy, args.batch_size
            )
        finally:
            await session_module.engine.dispose()
    except Exception as error:  # noqa: BLE001 — 메시지에 SQL · 값 · 접속 정보가 섞일 수 있어 종류만
        print("[Shared Policy]")
        print("Status: PASS")
        print("[Overall]")
        print(f"Completed: FAIL (database error: {type(error).__name__})")
        return EXIT_DB
    print(render(policy, report))
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
    except SystemExit as exit_:
        return EXIT_USAGE if exit_.code else EXIT_OK
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
