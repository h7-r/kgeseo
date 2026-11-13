"""베타 퍼즐 통계 SQL 검증용 합성 데이터 · 예상값 생성기 (DB 에 접속하지 않는다).

출력(같은 폴더):
  fixture_테스트전용_합성데이터.sql  — 격리 테스트 DB 전용 INSERT. 운영 · 개발 DB 에서 실행하면 첫 줄 가드가 오류로 멈춘다
  expected.json                      — Q0~Q5 예상 결과(파이썬으로 따로 계산)

예상값은 운영 SQL 을 흉내 내지 않고 문서(베타_퍼즐통계_정의와_운영가이드.md)의 정의를 파이썬으로 다시 구현해 구한다.
그리고 손으로 계산한 값(HAND)과 맞는지 생성할 때 확인한다 — 셋(문서 정의 · 파이썬 · 손 계산)이 어긋나면 생성을 멈춘다.

모든 값은 합성이다: ID 는 고정 패턴 UUID, 이메일은 example.invalid, 답안은 'syn-…' 임의 문자열(실제 정답 아님).
"""

from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASE = "naju-angam-01"
P07_OBJECT = "OBJ_S1_CAVE_BIG_CLAM"

# ---- 테스트 파라미터(운영 SQL 의 SET 줄을 이 값으로 바꿔 실행한다 — make_test_queries.py) ----
PARAMS = {
    "beta_start_utc": "2026-11-12 15:00:00.000000",
    "beta_end_utc": "2026-11-13 15:00:00.000000",
    "asof_utc": "2026-11-14 03:00:00.000000",
}


def T(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S.%f" if "." in s else "%Y-%m-%d %H:%M:%S")


START, END, ASOF = (T(PARAMS[k]) for k in ("beta_start_utc", "beta_end_utc", "asof_utc"))


def uid(prefix: str, n: int) -> str:
    return f"{prefix}-0000-4000-8000-{n:012d}"


# ---- 사용자 · 익명 세션 ----------------------------------------------------------------
USERS = {  # key: (번호, role)
    "U01": (1, "admin"),   # 관리자 — 제외
    "U02": (2, "user"),    # 테스트 회원 — @exclude_user_ids 로 제외
    "U03": (3, "user"),
    "U04": (4, "user"),
    "U05": (5, "user"),
    "U06": (6, "user"),
    "U07": (7, "user"),    # G5 게스트가 가입해 승계받은 회원
    "U08": (8, "user"),
}
USER_ID = {k: uid("aaaaaaaa", n) for k, (n, _) in USERS.items()}
ANONS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8",
         "AM01", "AM02", "AM03", "AM04", "AM05", "AM06", "AM08"]  # AMxx = 회원 세션의 호환용 익명 세션
ANON_ID = {k: uid("bbbbbbbb", i + 1) for i, k in enumerate(ANONS)}
EXCLUDE_USERS = ["U02"]
EXCLUDE_ANONS = ["G8"]


@dataclass
class Ev:
    puzzle: str | None          # P01 · P03 · P07 · P09, None = 퍼즐 아닌 이벤트(inspect)
    result: str                 # incorrect · correct · already_completed · ok(inspect)
    at: str                     # 서버 수신 시각(UTC)
    answer: str | None = None   # 합성 답안(P07 · inspect 는 None)
    client_offset: float | None = 0.2   # 서버 − 클라이언트(초). None = client_timestamp NULL


@dataclass
class Sess:
    key: str
    created: str
    anon: str                       # play_sessions.anonymous_session_id
    owner_user: str | None = None   # owner_user_id
    owner_anon: str | None = None   # owner_anonymous_session_id
    case_id: str = CASE
    version: int | None = 1
    events: list[Ev] = field(default_factory=list)
    attempts_override: dict[str, int | None] = field(default_factory=dict)  # None = 키를 아예 뺀다
    note: str = ""


D = "2026-11-13 "  # 베타 당일(UTC 날짜)


def inc(p, at, a, off=0.2):
    return Ev(p, "incorrect", D + at if len(at) <= 8 else at, a, off)


def cor(p, at, a=None, off=0.2):
    return Ev(p, "correct", D + at if len(at) <= 8 else at, a, off)


def ac(p, at, a=None, off=0.2):
    return Ev(p, "already_completed", D + at if len(at) <= 8 else at, a, off)


SESSIONS = [
    Sess("S01", D + "01:00:00", "AM03", owner_user="U03", note="#1 P03 배치 3회 후 해결 · #5 P01 · #7 P09 오답 후 해결", events=[
        inc("P01", "01:01:00", "syn-p01-a"), inc("P01", "01:01:20", "syn-p01-ab"), cor("P01", "01:01:50", "syn-p01-abc"),
        inc("P03", "01:10:00", "syn-p03-o1"), inc("P03", "01:10:30", "syn-p03-o2"), inc("P03", "01:11:00", "syn-p03-o3"),
        cor("P03", "01:12:00", "syn-p03-ok"),
        cor("P07", "01:30:00"),
        inc("P09", "01:35:00", "syn-p09-w1"), cor("P09", "01:36:00", "syn-p09-ok"),
    ]),
    Sess("S02", D + "01:05:00", "AM04", owner_user="U04", note="#2 P03 첫 제출 정답 · P07 재보고(already_completed)", events=[
        inc("P01", "01:06:00", "syn-p01-a"), inc("P01", "01:06:30", "syn-p01-ab"), inc("P01", "01:07:00", "syn-p01-abd"),
        cor("P01", "01:08:00", "syn-p01-abcd"),
        cor("P03", "01:20:00", "syn-p03-ok"),
        cor("P07", "01:25:00"), ac("P07", "01:26:00"),
    ]),
    Sess("S03", D + "02:00:00", "G1", owner_anon="G1", note="#3 P03 미해결 · #8 재시작 전 세션", events=[
        inc("P03", "02:10:00", "syn-p03-o1"), inc("P03", "02:10:20", "syn-p03-o2"),
    ]),
    Sess("S04", D + "03:00:00", "G1", owner_anon="G1", note="#8 같은 게스트 재시작 후 해결 · 정답 이벤트는 재전송(클라이언트 시각 30초 앞)", events=[
        inc("P03", "03:10:00", "syn-p03-o1"),
        cor("P03", "03:11:30", "syn-p03-ok", off=30.0),
    ]),
    Sess("S05", D + "03:30:00", "G2", owner_anon="G2", note="#4 P03 같은 답 연속 제출 · 기기 시계 3초 빠름", events=[
        inc("P03", "03:40:00", "syn-p03-x", -3.0), inc("P03", "03:40:10", "syn-p03-x", -3.0),
        inc("P03", "03:40:40", "syn-p03-y", -3.0), cor("P03", "03:42:00", "syn-p03-ok", -3.0),
    ]),
    Sess("S06", D + "04:00:00", "G3", owner_anon="G3", note="#9 게스트 · #13 해결 뒤 재제출", events=[
        inc("P01", "04:01:00", "syn-p01-a"), inc("P01", "04:01:40", "syn-p01-ab"), cor("P01", "04:02:00", "syn-p01-abc"),
        inc("P03", "04:10:00", "syn-p03-o1"), cor("P03", "04:13:00", "syn-p03-ok"), ac("P03", "04:20:00", "syn-p03-ok"),
        cor("P07", "04:30:00"),
    ]),
    Sess("S07", D + "05:00:00", "AM05", owner_user="U05", note="P01 게 구멍 뒤 다시 파기 · P09 첫 제출 정답", events=[
        inc("P01", "05:01:00", "syn-p01-a"), inc("P01", "05:01:20", "syn-p01-ab"), inc("P01", "05:01:40", "syn-p01-abx"),
        inc("P01", "05:02:00", "syn-p01-a"), cor("P01", "05:03:00", "syn-p01-ade"),
        inc("P03", "05:10:00", "syn-p03-o1"), inc("P03", "05:10:45", "syn-p03-o2"), cor("P03", "05:15:00", "syn-p03-ok"),
        cor("P07", "05:20:00"),
        cor("P09", "05:25:00", "syn-p09-ok"),
    ]),
    Sess("S08", D + "06:00:00", "G4", owner_anon="G4", note="게스트 · P01 첫 이벤트 client_timestamp NULL · P01 attempt_counts 일부러 불일치",
         attempts_override={"P01": 2}, events=[
        inc("P01", "06:01:00", "syn-p01-a", None), inc("P01", "06:01:30", "syn-p01-ab"), cor("P01", "06:02:30", "syn-p01-abc"),
        inc("P03", "06:10:00", "syn-p03-o1"), cor("P03", "06:10:30", "syn-p03-ok"),
        cor("P07", "06:20:00"),
    ]),
    Sess("S09", D + "07:00:00", "G5", owner_user="U07", note="#10 게스트(G5)로 P03 해결 → 08:00 가입 승계(소유자 U07)", events=[
        inc("P03", "07:10:00", "syn-p03-o1"), cor("P03", "07:12:30", "syn-p03-ok"),
    ]),
    Sess("S10", D + "07:30:00", "AM01", owner_user="U01", note="#11 관리자 — 제외", events=[
        cor("P03", "07:40:00", "syn-p03-ok"),
    ]),
    Sess("S11", D + "07:45:00", "AM02", owner_user="U02", note="#12 테스트 회원 — 제외 목록", events=[
        inc("P03", "07:50:00", "syn-p03-o1"), cor("P03", "07:51:00", "syn-p03-ok"),
    ]),
    Sess("S12", "2026-11-12 14:00:00", "G6", owner_anon="G6", note="#13 베타 시작 전 생성 — 코호트 제외, 베타 중 시도는 이벤트 기준 참고치", events=[
        inc("P03", "2026-11-12 14:30:00", "syn-p03-o1"), inc("P03", "2026-11-12 15:30:00", "syn-p03-o2"),
    ]),
    Sess("S13", D + "08:00:00", "G6", owner_anon="G6", note="베타 전 이력 있는 게스트 · state 에 P03 키 없음 · 정답 이벤트 기기 시계 역행",
         attempts_override={"P03": None}, events=[
        inc("P03", "08:10:00", "syn-p03-o1"),
        cor("P03", "08:20:00", "syn-p03-ok", off=900.0),
    ]),
    Sess("S14", D + "14:30:00", "AM06", owner_user="U06", note="#14 베타 중 생성, 시도는 종료 뒤 · 조회 기준 시각 뒤 재제출은 안 셈", events=[
        inc("P03", "15:10:00", "syn-p03-o1"), cor("P03", "15:20:00", "syn-p03-ok"),
        ac("P03", "2026-11-14 04:00:00", "syn-p03-ok"),
    ]),
    Sess("S15", D + "09:00:00", "G2", owner_anon="G2", version=None, note="content_version NULL — 대상 아님", events=[
        cor("P03", "09:10:00", "syn-p03-ok"),
    ]),
    Sess("S16", D + "09:30:00", "G3", owner_anon="G3", case_id="other-case-01", note="다른 케이스 — 대상 아님", events=[
        cor("P03", "09:40:00", "syn-p03-ok"),
    ]),
    Sess("S17", D + "10:00:00", "G7", owner_anon="G7", note="이벤트 없는 세션 — Q4 활성 분모에서 빠짐", events=[]),
    Sess("S18", D + "10:30:00", "AM08", owner_user="U08", note="퍼즐 아닌 이벤트(inspect)만 + P01 already_completed 만(점검 탐지용)", events=[
        Ev(None, "ok", D + "10:40:00"),
        ac("P01", "10:45:00", "syn-p01-abc"),
    ]),
    Sess("S19", D + "11:00:00", "G8", owner_anon="G8", note="제외 목록 익명 세션", events=[
        cor("P03", "11:10:00", "syn-p03-ok"),
    ]),
]
SESS = {s.key: s for s in SESSIONS}
# 게스트 G5 → 회원 U07 승계(08:00). guest_sessions 는 익명 세션당 하나
TRANSFERS = [("G5", "U07", D + "08:00:00", ["S09"])]


# ---- 합성 행 만들기 -----------------------------------------------------------------------
def fmt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S.%f")


def target_of(ev: Ev) -> tuple[str, str]:
    if ev.puzzle is None:
        return "inspect", "INSPECT_CAVE_TABLET"
    if ev.puzzle == "P07":
        return "complete", P07_OBJECT
    return "submit_answer", ev.puzzle


def events_with_ids():
    rows, n = [], 0
    for s in SESSIONS:
        for ev in sorted(s.events, key=lambda e: T(e.at)):
            n += 1
            rows.append((s, ev, uid("dddddddd", n), uid("eeeeeeee", n)))
    return rows


EVENTS = events_with_ids()


def graded_count(s: Sess, puzzle: str) -> int:
    return sum(1 for e in s.events if e.puzzle == puzzle and e.result in ("incorrect", "correct"))


def state_json(s: Sess) -> str:
    counts = {}
    for p in ("P01", "P03", "P07", "P09"):
        n = graded_count(s, p)
        if p in s.attempts_override:
            if s.attempts_override[p] is None:
                continue
            n = s.attempts_override[p]
        if n:
            counts[p] = n
    completed = sorted({e.puzzle for e in s.events if e.result == "correct" and e.puzzle})
    return json.dumps({"current_zone_id": None, "completed_puzzle_ids": completed, "attempt_counts": counts},
                      ensure_ascii=False, separators=(",", ":"))


def q(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def write_fixture(path: Path) -> None:
    L = []
    w = L.append
    w("-- ##################################################################################")
    w("-- !!! 테스트 전용 합성 데이터 — 운영 · 개발 · 공유 DB 에서 절대 실행하지 않는다 !!!")
    w("-- 격리된 새 MySQL 8 인스턴스의 빈 test_puzzle_stats_* DB 에서만 쓴다.")
    w("-- 아래 가드가 조건에 맞지 않으면 'Subquery returns more than 1 row'(1242) 오류로 멈춘다.")
    w("-- mysql 클라이언트를 --force 없이 실행해야 가드 오류에서 멈춘다.")
    w("-- 생성: make_fixture.py — 이 파일을 손으로 고치지 않는다.")
    w("-- ##################################################################################")
    w("")
    w("-- 가드 1: DB 이름이 test_puzzle_stats_ 로 시작해야 한다(LIKE 이스케이프 · sql_mode 에 기대지 않는 비교)")
    w("DO (SELECT 1 FROM (SELECT 1 AS x UNION ALL SELECT 2) g")
    w("    WHERE DATABASE() IS NULL OR LEFT(DATABASE(), 18) <> 'test_puzzle_stats_' OR CHAR_LENGTH(DATABASE()) <= 18);")
    w("-- 가드 2: 기본 포트 3306(기존 MySQL80) 이 아니어야 한다")
    w("DO (SELECT 1 FROM (SELECT 1 AS x UNION ALL SELECT 2) g WHERE @@port = 3306);")
    w("-- 가드 3: RDS 가 아니어야 한다")
    w("DO (SELECT 1 FROM (SELECT 1 AS x UNION ALL SELECT 2) g WHERE @@basedir LIKE '/rdsdbbin%');")
    w("-- 가드 4: 대상 테이블이 비어 있어야 한다(실데이터가 있는 DB 에 섞지 않는다)")
    w("DO (SELECT 1 FROM (SELECT 1 AS x UNION ALL SELECT 2) g")
    w("    WHERE (SELECT COUNT(*) FROM app_users) > 0 OR (SELECT COUNT(*) FROM anonymous_sessions) > 0")
    w("       OR (SELECT COUNT(*) FROM guest_sessions) > 0 OR (SELECT COUNT(*) FROM play_sessions) > 0")
    w("       OR (SELECT COUNT(*) FROM interaction_events) > 0 OR (SELECT COUNT(*) FROM guest_session_transfers) > 0);")
    w("")
    w("START TRANSACTION;")
    w("")
    w("-- app_users (합성)")
    for k, (n, role) in USERS.items():
        created = "2026-11-01 00:00:00.000000"
        w("INSERT INTO app_users (id, email, nickname, region, terms_version, terms_accepted_at, privacy_accepted_at,"
          " age_confirmed_at, role, created_at, updated_at) VALUES ("
          f"{q(USER_ID[k])}, {q(f'syn-user-{n:02d}@example.invalid')}, {q(f'syn{n:02d}')}, NULL, NULL, NULL, NULL,"
          f" NULL, {q(role)}, {q(created)}, {q(created)});")
    w("")
    w("-- anonymous_sessions (합성)")
    for k in ANONS:
        w(f"INSERT INTO anonymous_sessions (id, created_at, expires_at) VALUES ({q(ANON_ID[k])},"
          " '2026-11-01 00:00:00.000000', '2026-12-31 00:00:00.000000');")
    w("")
    w("-- guest_sessions (승계 대상 게스트만)")
    for i, (g, u, at, _) in enumerate(TRANSFERS, start=1):
        th = hashlib.sha256(f"syn-guest-token-{g}".encode()).hexdigest()
        w(f"INSERT INTO guest_sessions (id, anonymous_session_id, token_hash, created_at, expires_at, revoked_at)"
          f" VALUES ({q(uid('ffffffff', i))}, {q(ANON_ID[g])}, {q(th)}, '2026-11-13 06:59:00.000000',"
          f" '2026-12-31 00:00:00.000000', {q(fmt(T(at)))});")
    w("")
    w("-- play_sessions")
    for s in SESSIONS:
        n = int(s.key[1:])
        fp = None if s.version is None else "sha256:" + "0" * 64
        w("INSERT INTO play_sessions (id, anonymous_session_id, case_id, state_json, created_at, updated_at,"
          " completed_at, content_version, content_fingerprint, hint_balance, help_used, owner_user_id,"
          " owner_anonymous_session_id) VALUES ("
          f"{q(uid('cccccccc', n))}, {q(ANON_ID[s.anon])}, {q(s.case_id)}, {q(state_json(s))},"
          f" {q(fmt(T(s.created)))}, {q(fmt(T(s.created)))}, NULL, {q(s.version)}, {q(fp)}, 0, 0,"
          f" {q(USER_ID[s.owner_user] if s.owner_user else None)},"
          f" {q(ANON_ID[s.owner_anon] if s.owner_anon else None)});  -- {s.key}: {s.note}")
    w("")
    w("-- interaction_events")
    for s, ev, eid, ceid in EVENTS:
        itype, target = target_of(ev)
        at = T(ev.at)
        cts = None if ev.client_offset is None else at - timedelta(seconds=ev.client_offset)
        if itype == "complete":
            payload = {"zone_id": "cave-hall", "client_timestamp": (cts or at).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
                       "payload": {}}
        elif itype == "inspect":
            payload = {}
        else:
            payload = {"answer": ev.answer}
        response = {"result_type": ev.result, "synthetic": True}
        w("INSERT INTO interaction_events (id, play_session_id, client_event_id, client_timestamp, interaction_type,"
          " target_id, payload_json, result_type, response_json, created_at) VALUES ("
          f"{q(eid)}, {q(uid('cccccccc', int(s.key[1:])))}, {q(ceid)}, {q(fmt(cts) if cts else None)},"
          f" {q(itype)}, {q(target)}, {q(json.dumps(payload, ensure_ascii=False))}, {q(ev.result if itype != 'inspect' else 'inspected')},"
          f" {q(json.dumps(response))}, {q(fmt(at))});  -- {s.key} {ev.puzzle or 'inspect'} {ev.result}")
    w("")
    w("-- guest_session_transfers")
    for i, (g, u, at, moved) in enumerate(TRANSFERS, start=1):
        w("INSERT INTO guest_session_transfers (id, guest_session_id, anonymous_session_id, app_user_id,"
          f" play_session_count, transferred_at) VALUES ({q(uid('99999999', i))}, {q(uid('ffffffff', i))},"
          f" {q(ANON_ID[g])}, {q(USER_ID[u])}, {len(moved)}, {q(fmt(T(at)))});")
    w("")
    w("COMMIT;")
    path.write_text("\n".join(L) + "\n", encoding="utf-8", newline="\n")


# ---- 예상값: 문서 정의를 파이썬으로 다시 구현 -------------------------------------------------
def r1(x) -> str | None:
    """MySQL ROUND(x, 1)(소수 반올림, half-up) → 문자열"""
    if x is None:
        return None
    return str(Decimal(str(x)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def principal(s: Sess) -> tuple[str, str]:
    if s.owner_user:
        return "u:" + USER_ID[s.owner_user], "member"
    if s.owner_anon:
        return "g:" + ANON_ID[s.owner_anon], "guest"
    return "l:" + ANON_ID[s.anon], "legacy"


def in_base(s: Sess) -> bool:
    if s.case_id != CASE or s.version != 1:
        return False
    if s.owner_user and USERS[s.owner_user][1] == "admin":
        return False
    if s.owner_user in EXCLUDE_USERS or s.anon in EXCLUDE_ANONS:
        return False
    return T(s.created) < ASOF


def compute():
    base = [s for s in SESSIONS if in_base(s)]
    ev_rows = [(s, ev, eid) for s, ev, eid, _ in EVENTS if s in base and ev.puzzle and T(ev.at) < ASOF]
    graded = defaultdict(list)  # (session, puzzle) -> [(at, eid, ev)]
    for s, ev, eid in ev_rows:
        if ev.result in ("incorrect", "correct"):
            graded[(s.key, ev.puzzle)].append((T(ev.at), eid, ev))
    per = {}
    for key, rows in graded.items():
        rows.sort(key=lambda r: (r[0], r[1]))
        prev = None
        inc_n = changed = repeat = corr = 0
        solved = solved_c = None
        for i, (at, _, ev) in enumerate(rows):
            h = ev.answer
            if ev.result == "incorrect":
                inc_n += 1
                # SQL: prev_hash IS NULL OR prev_hash <> ans_hash (ans 가 NULL 이면 비교가 NULL → 세지 않음)
                if prev is None or (h is not None and prev != h):
                    changed += 1
            if i > 0 and prev is not None and h is not None and prev == h:
                repeat += 1
            if ev.result == "correct":
                corr += 1
                if solved is None:
                    solved = at
                    solved_c = None if ev.client_offset is None else at - timedelta(seconds=ev.client_offset)
            prev = h
        first_ev = rows[0][2]
        per[key] = dict(first=rows[0][0],
                        first_c=None if first_ev.client_offset is None else rows[0][0] - timedelta(seconds=first_ev.client_offset),
                        solved=solved, solved_c=solved_c, inc=inc_n, changed=changed, repeat=repeat,
                        correct=corr, graded=len(rows))
    # P07 처럼 답안이 없는(None) 퍼즐은 SQL 에서 해시가 NULL → LAG 비교가 NULL → 반복 0, incorrect 없음
    prior_sessions = [s for s in SESSIONS if s.case_id == CASE and T(s.created) < START]
    prior_naju = {principal(s)[0] for s in prior_sessions}
    prior_pz = {(principal(s)[0], e.puzzle) for s in prior_sessions for e in s.events if e.puzzle}
    cohort = []
    for (sk, p), m in per.items():
        s = SESS[sk]
        if not (START <= T(s.created) < END):
            continue
        pr, ot = principal(s)
        sj = json.loads(state_json(s))
        cohort.append(dict(sess=s, puzzle=p, principal=pr, owner_type=ot,
                           state=sj["attempt_counts"].get(p), **m,
                           prior_naju=pr in prior_naju, prior_pz=(pr, p) in prior_pz))
    grp = defaultdict(list)
    for c in cohort:
        grp[(c["principal"], c["puzzle"])].append(c)
    for rows in grp.values():
        rows.sort(key=lambda c: (c["first"], uid("cccccccc", int(c["sess"].key[1:]))))
        for i, c in enumerate(rows, start=1):
            c["nth"] = i
    return base, ev_rows, graded, per, cohort


def secs(a, b):
    return (b - a).total_seconds()


def hide_small(n):
    return 1 <= n <= 4


def build_expected():
    base, ev_rows, graded, per, cohort = compute()
    puzzles = sorted({c["puzzle"] for c in cohort})
    out = {}

    # Q0 (집합 비교 — UNION ALL 순서는 보장되지 않는다)
    q0 = {
        "param_beta_start_utc": PARAMS["beta_start_utc"], "param_beta_end_utc": PARAMS["beta_end_utc"],
        "param_asof_utc": PARAMS["asof_utc"], "check_start_lt_end (1=정상)": "1",
        "check_asof_ge_end (1=정상)": "1", "check_exclude_lists_are_arrays (1=정상)": "1",
        "exclude_user_ids_count": str(len(EXCLUDE_USERS)), "exclude_anon_ids_count": str(len(EXCLUDE_ANONS)),
    }
    dist = defaultdict(int)
    for s in SESSIONS:
        if START <= T(s.created) < END:
            dist[f"sessions_created_in_window:{s.case_id}@{'null' if s.version is None else s.version}"] += 1
    q0.update({k: str(v) for k, v in dist.items()})
    q0["naju_v1_sessions_in_window_before_exclusion"] = str(sum(
        1 for s in SESSIONS if s.case_id == CASE and s.version == 1 and START <= T(s.created) < END))
    q0["naju_v1_sessions_in_window_after_exclusion"] = str(sum(1 for s in base if START <= T(s.created) < END))
    for p in puzzles:
        q0[f"cohort_sessions:{p}"] = str(sum(1 for c in cohort if c["puzzle"] == p))
    eb = defaultdict(int)
    for (sk, p), rows in graded.items():
        s = SESS[sk]
        for at, _, _ in rows:
            if START <= at < END:
                origin = "session_created_before_start" if T(s.created) < START else "session_created_in_window"
                eb[f"event_basis_graded_in_window:{p}:{origin}"] += 1
    q0.update({k: str(v) for k, v in eb.items()})
    after = defaultdict(int)
    cohort_keys = {(c["sess"].key, c["puzzle"]) for c in cohort}
    for (sk, p), rows in graded.items():
        if (sk, p) in cohort_keys:
            after[p] += sum(1 for at, _, _ in rows if at >= END)
    q0.update({f"cohort_graded_after_end:{p}": str(n) for p, n in after.items() if n})
    ce = defaultdict(int)
    for s, ev, _ in ev_rows:
        if START <= T(s.created) < END:
            it, _t = target_of(ev)
            ce[f"cohort_events:{ev.puzzle}:{it}:{ev.result}"] += 1
    q0.update({k: str(v) for k, v in ce.items()})
    out["Q0"] = [{"metric": k, "value": v} for k, v in sorted(q0.items())]

    # Q1
    q1 = []
    for p in puzzles:
        cs = [c for c in cohort if c["puzzle"] == p]
        att = len(cs)
        sol = [c for c in cs if c["solved"]]
        nsol = len(sol)
        rt = sum(1 for c in cs if c["nth"] > 1)
        h_att = att < 5
        h_sol = att < 5 or hide_small(nsol) or hide_small(att - nsol)
        h_rt = att < 5 or hide_small(rt) or hide_small(att - rt)
        h_avg = nsol < 5
        avg = lambda xs: (sum(xs) / len(xs)) if xs else None
        q1.append({
            "puzzle_id": p,
            "incorrect_meaning": {"P01": "dig_step", "P03": "placement_step", "P07": "none"}.get(p, "deliberate_submit"),
            "duration_basis": "not_measurable" if p == "P07" else "first_submit_to_correct",
            "sessions_attempted": None if h_att else str(att),
            "sessions_solved": None if h_sol else str(nsol),
            "sessions_unsolved_at_asof": None if h_sol else str(att - nsol),
            "session_solve_rate_pct": None if (h_sol or p == "P07") else r1(100 * nsol / att),
            "retry_sessions_in_window": None if h_rt else str(rt),
            "incorrect_events": None if (h_att or p == "P07") else str(sum(c["inc"] for c in cs)),
            "avg_incorrect_solved": None if (h_avg or p == "P07") else r1(avg([c["inc"] for c in sol])),
            "avg_incorrect_changed_solved": None if (h_avg or p == "P07") else r1(avg([c["changed"] for c in sol])),
            "avg_sec_first_to_solve": None if (h_avg or p == "P07") else r1(avg([secs(c["first"], c["solved"]) for c in sol])),
        })
    out["Q1"] = q1

    # Q2
    cohort_t = []
    for c in cohort:
        sg = False
        if c["owner_type"] == "member" and c["solved"]:
            for g, u, at, _ in TRANSFERS:
                if USER_ID[u] == USER_ID[c["sess"].owner_user] and ANON_ID[g] == ANON_ID[c["sess"].anon] and T(at) > c["solved"]:
                    sg = True
        cohort_t.append({**c, "sg": sg})
    q2 = []
    for p in puzzles:
        players = defaultdict(list)
        for c in cohort_t:
            if c["puzzle"] == p:
                players[c["principal"]].append(c)
        pl = []
        for pr, rows in players.items():
            pl.append(dict(owner_type=rows[0]["owner_type"], sessions=len(rows),
                           solved=any(r["solved"] for r in rows),
                           first=any(r["nth"] == 1 and r["solved"] for r in rows),
                           pn=any(r["prior_naju"] for r in rows), pp=any(r["prior_pz"] for r in rows),
                           sg=any(r["sg"] for r in rows)))
        scopes = ["all"] + [t for t in ("member", "guest", "legacy") if any(x["owner_type"] == t for x in pl)]
        agg = {}
        for sc in scopes:
            xs = pl if sc == "all" else [x for x in pl if x["owner_type"] == sc]
            a = dict(players=len(xs), solved=sum(x["solved"] for x in xs), sf=sum(x["first"] for x in xs),
                     rt=sum(x["sessions"] >= 2 for x in xs), pn=sum(x["pn"] for x in xs),
                     pp=sum(x["pp"] for x in xs), sg=sum(x["sg"] for x in xs))
            n = a["players"]
            a["h"] = dict(pl=n < 5,
                          sol=n < 5 or hide_small(a["solved"]) or hide_small(n - a["solved"]),
                          sf=n < 5 or hide_small(a["sf"]) or hide_small(n - a["sf"]),
                          rt=n < 5 or hide_small(a["rt"]), pn=n < 5 or hide_small(a["pn"]),
                          pp=n < 5 or hide_small(a["pp"]), sg=n < 5 or hide_small(a["sg"]))
            agg[sc] = a
        split = {k: any(agg[sc]["h"][k] for sc in scopes if sc != "all") for k in agg["all"]["h"]}
        for sc in scopes:
            a = agg[sc]

            def show(k, val):
                return None if (a["h"][k] or (sc != "all" and split[k])) else val
            q2.append({
                "puzzle_id": p, "scope": sc,
                "players": show("pl", str(a["players"])),
                "players_solved": show("sol", str(a["solved"])),
                "player_solve_rate_pct": None if p == "P07" else show("sol", r1(100 * a["solved"] / a["players"])),
                "players_solved_in_first_session": show("sf", str(a["sf"])),
                "players_with_retry_session": show("rt", str(a["rt"])),
                "players_with_prior_naju_session": show("pn", str(a["pn"])),
                "players_with_prior_puzzle_attempt": show("pp", str(a["pp"])),
                "member_players_solved_while_guest": show("sg", str(a["sg"])),
            })
    out["Q2"] = q2

    # Q3
    q3 = []
    for p in puzzles:
        if p == "P07":
            continue
        sol = [c for c in cohort if c["puzzle"] == p and c["solved"]]
        n = len(sol)
        if n == 0:
            continue

        def pct(vals, frac):
            vals = sorted(vals)
            return vals[math.ceil(frac * n) - 1]
        sv = [secs(c["first"], c["solved"]) for c in sol]
        iv = [c["inc"] for c in sol]
        cv = [c["changed"] for c in sol]
        band = "lt_5" if n < 5 else "5_9" if n < 10 else "10_19" if n < 20 else "20_plus"
        q3.append({
            "puzzle_id": p, "solved_sessions_band": band,
            "median_sec_first_to_solve": None if n < 5 else r1(pct(sv, .5)),
            "p75_sec_first_to_solve": None if n < 5 else r1(pct(sv, .75)),
            "p90_sec_first_to_solve": None if n < 10 else r1(pct(sv, .9)),
            "median_incorrect_solved": None if n < 5 else str(pct(iv, .5)),
            "p90_incorrect_solved": None if n < 10 else str(pct(iv, .9)),
            "median_incorrect_changed_solved": None if n < 5 else str(pct(cv, .5)),
            "p90_incorrect_changed_solved": None if n < 10 else str(pct(cv, .9)),
        })
    out["Q3"] = q3

    # Q4
    window_base = [s for s in base if START <= T(s.created) < END]
    active = sum(1 for s in window_base if any(T(e.at) < ASOF for e in s.events))
    q4 = []
    for p in puzzles:
        cs = [c for c in cohort if c["puzzle"] == p]
        att, nsol = len(cs), sum(1 for c in cs if c["solved"])
        q4.append({
            "puzzle_id": p,
            "active_sessions_denominator": None if active < 5 else str(active),
            "attempted_share_of_active_pct": None if (active < 5 or hide_small(att) or hide_small(active - att)) else r1(100 * att / active),
            "solved_share_of_active_pct": None if (active < 5 or hide_small(nsol) or hide_small(active - nsol)) else r1(100 * nsol / active),
        })
    out["Q4"] = q4

    # Q5
    q5 = {}
    for p in puzzles:
        cs = [c for c in cohort if c["puzzle"] == p]
        q5[f"{p}:cohort_sessions"] = len(cs)
        q5[f"{p}:attempt_count_mismatch"] = sum(1 for c in cs if c["graded"] != (c["state"] or 0))
        q5[f"{p}:state_attempts_missing"] = sum(1 for c in cs if c["state"] is None)
        q5[f"{p}:multiple_correct"] = sum(1 for c in cs if c["correct"] > 1)
        q5[f"{p}:repeat_same_answer_events"] = sum(c["repeat"] for c in cs)
        q5[f"{p}:legacy_owner_sessions"] = sum(1 for c in cs if c["owner_type"] == "legacy")
        q5[f"{p}:first_attempt_after_end"] = sum(1 for c in cs if c["first"] >= END)
        diff = neg = 0
        for c in cs:
            if c["solved"] and c["first_c"] and c["solved_c"]:
                cd, sd = secs(c["first_c"], c["solved_c"]), secs(c["first"], c["solved"])
                diff += abs(cd - sd) > 5
                neg += cd < 0
        q5[f"{p}:client_vs_server_duration_diff_over_5s"] = diff
        q5[f"{p}:client_duration_negative"] = neg
        q5[f"{p}:incorrect_after_correct"] = sum(
            1 for c in cs for at, _, ev in graded[(c["sess"].key, p)]
            if ev.result == "incorrect" and c["solved"] and at > c["solved"])
        ckeys = {c["sess"].key for c in cs}
        q5[f"{p}:already_completed_events"] = sum(
            1 for s, ev, _ in ev_rows if s.key in ckeys and ev.puzzle == p and ev.result == "already_completed")
    only_after = defaultdict(int)
    window_keys = {s.key for s in window_base}
    seen = defaultdict(lambda: [0, 0])
    for s, ev, _ in ev_rows:
        if s.key in window_keys:
            seen[(s.key, ev.puzzle)][0] += 1
            seen[(s.key, ev.puzzle)][1] += ev.result in ("incorrect", "correct")
    for (sk, p), (n_all, n_g) in seen.items():
        if n_g == 0:
            only_after[p] += 1
    for p in puzzles:
        q5[f"{p}:sessions_only_already_completed"] = only_after.get(p, 0)
    q5["all:sessions_only_already_completed_total"] = sum(only_after.values())
    q5["P07:incorrect_events (0 이어야 함)"] = sum(
        1 for (sk, p), rows in graded.items() if p == "P07" for _, _, ev in rows if ev.result == "incorrect")
    p09b = 0
    for c in cohort:
        if c["puzzle"] != "P09":
            continue
        c7 = next((x for x in cohort if x["sess"] is c["sess"] and x["puzzle"] == "P07"), None)
        for at, _, _ in graded[(c["sess"].key, "P09")]:
            if c7 is None or c7["solved"] is None or at < c7["solved"]:
                p09b += 1
    q5["P09:graded_before_p07_solved (0 이어야 함)"] = p09b
    offs, null_ct = [], 0
    for c in cohort:
        for at, _, ev in graded[(c["sess"].key, c["puzzle"])]:
            if ev.client_offset is None:
                null_ct += 1
            else:
                offs.append(ev.client_offset)
    q5["all:graded_events_without_client_timestamp"] = null_ct
    offs.sort()
    n = len(offs)
    q5["all:clock_offset_p50_sec"] = r1(offs[math.ceil(.5 * n) - 1])
    q5["all:clock_offset_p90_sec"] = r1(offs[math.ceil(.9 * n) - 1])
    q5["all:events_client_ahead_over_1s"] = sum(1 for o in offs if o < -1)
    q5["all:events_abs_offset_over_60s"] = sum(1 for o in offs if abs(o) > 60)
    out["Q5"] = [{"metric": k, "value": v if isinstance(v, str) else str(int(v))} for k, v in sorted(q5.items())]
    return out


# ---- 손 계산(문서 「검증_절차와_예상값.md」 §3 표와 같은 값) — 어긋나면 생성 중단 ----------------
HAND = {
    ("Q1", "P01"): dict(sessions_attempted="5", sessions_solved="5", sessions_unsolved_at_asof="0",
                        session_solve_rate_pct="100.0", retry_sessions_in_window="0", incorrect_events="13",
                        avg_incorrect_solved="2.6", avg_incorrect_changed_solved="2.6", avg_sec_first_to_solve="88.0"),
    ("Q1", "P03"): dict(sessions_attempted="11", sessions_solved=None, sessions_unsolved_at_asof=None,
                        session_solve_rate_pct=None, retry_sessions_in_window=None, incorrect_events="16",
                        avg_incorrect_solved="1.4", avg_incorrect_changed_solved="1.3", avg_sec_first_to_solve="219.0"),
    ("Q1", "P07"): dict(sessions_attempted="5", sessions_solved="5", sessions_unsolved_at_asof="0",
                        session_solve_rate_pct=None, retry_sessions_in_window="0", incorrect_events=None,
                        avg_incorrect_solved=None, avg_incorrect_changed_solved=None, avg_sec_first_to_solve=None),
    ("Q1", "P09"): dict(sessions_attempted=None, sessions_solved=None, sessions_unsolved_at_asof=None,
                        session_solve_rate_pct=None, retry_sessions_in_window=None, incorrect_events=None,
                        avg_incorrect_solved=None, avg_incorrect_changed_solved=None, avg_sec_first_to_solve=None),
    ("Q3", "P01"): dict(solved_sessions_band="5_9", median_sec_first_to_solve="90.0", p75_sec_first_to_solve="120.0",
                        p90_sec_first_to_solve=None, median_incorrect_solved="2", median_incorrect_changed_solved="2"),
    ("Q3", "P03"): dict(solved_sessions_band="10_19", median_sec_first_to_solve="120.0", p75_sec_first_to_solve="300.0",
                        p90_sec_first_to_solve="600.0", median_incorrect_solved="1", p90_incorrect_solved="3",
                        median_incorrect_changed_solved="1", p90_incorrect_changed_solved="2"),
    ("Q3", "P09"): dict(solved_sessions_band="lt_5", median_sec_first_to_solve=None),
    ("Q4", "P01"): dict(active_sessions_denominator="12", attempted_share_of_active_pct="41.7", solved_share_of_active_pct="41.7"),
    ("Q4", "P03"): dict(active_sessions_denominator="12", attempted_share_of_active_pct=None, solved_share_of_active_pct=None),
    ("Q4", "P07"): dict(attempted_share_of_active_pct="41.7", solved_share_of_active_pct="41.7"),
    ("Q4", "P09"): dict(attempted_share_of_active_pct=None, solved_share_of_active_pct=None),
    ("Q2", "P03", "all"): dict(players="10", players_solved="10", player_solve_rate_pct="100.0",
                               players_solved_in_first_session=None, players_with_retry_session=None,
                               players_with_prior_naju_session=None, players_with_prior_puzzle_attempt=None,
                               member_players_solved_while_guest=None),
    ("Q2", "P03", "member"): dict(players="5", players_solved="5", player_solve_rate_pct="100.0",
                                  players_solved_in_first_session=None, players_with_retry_session=None,
                                  member_players_solved_while_guest=None),
    ("Q2", "P03", "guest"): dict(players="5", players_solved="5", players_solved_in_first_session=None),
    ("Q2", "P01", "all"): dict(players="5", players_solved="5", player_solve_rate_pct="100.0",
                               players_solved_in_first_session="5", players_with_retry_session="0",
                               players_with_prior_naju_session="0", member_players_solved_while_guest="0"),
    ("Q2", "P01", "member"): dict(players=None, players_solved=None, players_solved_in_first_session=None),
    ("Q2", "P07", "all"): dict(players="5", player_solve_rate_pct=None),
    ("Q2", "P09", "all"): dict(players=None, players_solved=None),
    ("Q5",): {"P01:attempt_count_mismatch": "1", "P03:attempt_count_mismatch": "1", "P03:state_attempts_missing": "1",
              "P03:repeat_same_answer_events": "1", "P03:first_attempt_after_end": "1",
              "P03:client_vs_server_duration_diff_over_5s": "2", "P03:client_duration_negative": "1",
              "P03:already_completed_events": "1", "P07:already_completed_events": "1",
              "P01:already_completed_events": "0", "P01:sessions_only_already_completed": "1",
              "all:sessions_only_already_completed_total": "1", "P07:incorrect_events (0 이어야 함)": "0",
              "P09:graded_before_p07_solved (0 이어야 함)": "0", "all:graded_events_without_client_timestamp": "1",
              "all:clock_offset_p50_sec": "0.2", "all:clock_offset_p90_sec": "0.2",
              "all:events_client_ahead_over_1s": "4", "all:events_abs_offset_over_60s": "1",
              "P03:incorrect_after_correct": "0", "P01:cohort_sessions": "5", "P03:cohort_sessions": "11",
              "P07:cohort_sessions": "5", "P09:cohort_sessions": "2"},
    ("Q0",): {"sessions_created_in_window:naju-angam-01@1": "16", "sessions_created_in_window:naju-angam-01@null": "1",
              "sessions_created_in_window:other-case-01@1": "1",
              "naju_v1_sessions_in_window_before_exclusion": "16", "naju_v1_sessions_in_window_after_exclusion": "13",
              "event_basis_graded_in_window:P03:session_created_before_start": "1",
              "event_basis_graded_in_window:P03:session_created_in_window": "24",
              "event_basis_graded_in_window:P01:session_created_in_window": "18",
              "event_basis_graded_in_window:P07:session_created_in_window": "5",
              "event_basis_graded_in_window:P09:session_created_in_window": "3",
              "cohort_graded_after_end:P03": "2",
              "cohort_events:P03:submit_answer:incorrect": "16", "cohort_events:P03:submit_answer:correct": "10",
              "cohort_events:P03:submit_answer:already_completed": "1",
              "cohort_events:P01:submit_answer:incorrect": "13", "cohort_events:P01:submit_answer:correct": "5",
              "cohort_events:P01:submit_answer:already_completed": "1",
              "cohort_events:P07:complete:correct": "5", "cohort_events:P07:complete:already_completed": "1",
              "cohort_events:P09:submit_answer:incorrect": "1", "cohort_events:P09:submit_answer:correct": "2"},
}


def check_hand(exp) -> None:
    errors = []
    for key, want in HAND.items():
        q = key[0]
        if q in ("Q0", "Q5"):
            got = {r["metric"]: r["value"] for r in exp[q]}
            rows = [got]
        elif q == "Q2":
            rows = [r for r in exp[q] if r["puzzle_id"] == key[1] and r["scope"] == key[2]]
        else:
            rows = [r for r in exp[q] if r["puzzle_id"] == key[1]]
        if len(rows) != 1:
            errors.append(f"{key}: 행 {len(rows)}개")
            continue
        for col, v in want.items():
            if rows[0].get(col, "<없음>") != v:
                errors.append(f"{key} {col}: 계산 {rows[0].get(col, '<없음>')!r} ≠ 손 계산 {v!r}")
    if any(r["puzzle_id"] == "P07" for r in exp["Q3"]):
        errors.append("Q3 에 P07 행이 있으면 안 된다")
    if errors:
        raise SystemExit("손 계산과 어긋남:\n  " + "\n  ".join(errors))


def main() -> None:
    write_fixture(HERE / "fixture_테스트전용_합성데이터.sql")
    exp = build_expected()
    check_hand(exp)
    meta = {"params": PARAMS, "exclude_user_ids": [USER_ID[u] for u in EXCLUDE_USERS],
            "exclude_anon_ids": [ANON_ID[a] for a in EXCLUDE_ANONS],
            "note": "합성 데이터 전용 예상값. NULL 은 null. Q0 · Q5 는 metric 집합 비교, 나머지는 키 컬럼 기준 비교."}
    (HERE / "expected.json").write_text(json.dumps({"meta": meta, **exp}, ensure_ascii=False, indent=2) + "\n",
                                        encoding="utf-8", newline="\n")
    print("ok: fixture + expected.json, 손 계산 일치")


if __name__ == "__main__":
    main()
