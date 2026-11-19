/**
 * 관리자 API v0.2 1단계 화면 규칙 — 회원 검색어 · 이어 받기 중복 제거 · 최근 로그인 표시 · 활동 로그 기간 · 기록 이름.
 * 대상 파일은 "@/" 별칭이 없어 node 가 TS 를 바로 읽는다.
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";

// 한국 날짜 계산이 보는 사람의 시간대와 상관없는지 보려고 일부러 다른 시간대에서 돈다.
process.env.TZ = "America/Los_Angeles";

const { readMemberSearch, recentLogin, providerLabel, SEARCH_MAX_LENGTH } =
  await import("../../website/src/admin/lib/memberSearch.ts");
const { appendUnique } = await import("../../website/src/admin/lib/paging.ts");
const { kstDate, kstPeriod, auditActionLabel, AUDIT_ACTION_FILTERS, AUDIT_PERIODS } =
  await import("../../website/src/admin/lib/auditLog.ts");

test("검색어 — 앞뒤 공백을 빼고, @ 가 있으면 이메일 완전 일치", () => {
  assert.deepEqual(readMemberSearch(null), { kind: "none" });
  assert.deepEqual(readMemberSearch("   "), { kind: "none" });
  assert.deepEqual(readMemberSearch(" 조사관 "), { kind: "nickname", q: "조사관" });
  assert.deepEqual(readMemberSearch("Agent@Example.com "), { kind: "email", q: "Agent@Example.com" });
  assert.deepEqual(readMemberSearch("%_"), { kind: "nickname", q: "%_" }, "와일드카드는 서버가 글자 그대로 찾는다");
});

test("검색어 — 64자까지(공백을 뺀 길이로 센다)", () => {
  assert.equal(SEARCH_MAX_LENGTH, 64);
  assert.equal(readMemberSearch("가".repeat(64)).kind, "nickname");
  assert.equal(readMemberSearch(` ${"가".repeat(64)} `).kind, "nickname");
  assert.deepEqual(readMemberSearch("가".repeat(65)), { kind: "tooLong" });
  // 서버(Python len)처럼 코드 포인트로 — 이모지 64개는 UTF-16 길이 128 이어도 통과
  assert.equal(readMemberSearch("😀".repeat(64)).kind, "nickname");
  assert.deepEqual(readMemberSearch("😀".repeat(65)), { kind: "tooLong" });
});

test("이어 받기 — 이미 받은 id 는 빼고 순서는 그대로", () => {
  const id = (row) => row.id;
  const first = [{ id: "a" }, { id: "b" }];
  const next = [{ id: "b" }, { id: "c" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(appendUnique(first, next, id).map(id), ["a", "b", "c", "d"]);
  assert.deepEqual(first.map(id), ["a", "b"], "원본은 바꾸지 않는다");
  assert.deepEqual(appendUnique([], [], id), []);
});

test("최근 로그인 — 실제 값 → 세션 시각(추정) → 기록 없음", () => {
  assert.deepEqual(
    recentLogin({ last_login_at: "2026-11-12T01:00:00", last_session_started_at: "2026-11-10T01:00:00" }),
    {
      at: "2026-11-12T01:00:00",
      isEstimate: false,
    },
  );
  assert.deepEqual(recentLogin({ last_login_at: null, last_session_started_at: "2026-11-10T01:00:00" }), {
    at: "2026-11-10T01:00:00",
    isEstimate: true,
  });
  assert.equal(recentLogin({ last_login_at: null, last_session_started_at: null }), null);
});

test("로그인 수단 이름 — 모르는 값은 원문", () => {
  assert.deepEqual(["local", "google", "naver", "kakao"].map(providerLabel), ["이메일", "구글", "네이버", "kakao"]);
});

test("한국 날짜 — UTC 15:00 에 날이 바뀐다", () => {
  assert.equal(kstDate(Date.parse("2026-11-12T14:59:59.999Z")), "2026-11-12");
  assert.equal(kstDate(Date.parse("2026-11-12T15:00:00.000Z")), "2026-11-13");
  assert.equal(kstDate(Date.parse("2026-12-31T15:00:00.000Z")), "2027-01-01");
});

test("활동 로그 기간 — 오늘(KST)까지 양 끝 포함, 서버 최대 92일을 넘지 않는다", () => {
  const now = Date.parse("2026-11-12T16:00:00Z"); // KST 11-13 01:00
  assert.deepEqual(kstPeriod(1, now), { from: "2026-11-13", to: "2026-11-13" });
  assert.deepEqual(kstPeriod(7, now), { from: "2026-11-07", to: "2026-11-13" });
  assert.deepEqual(kstPeriod(30, now), { from: "2026-10-15", to: "2026-11-13" });
  const days = (period) => (Date.parse(period.to) - Date.parse(period.from)) / 86_400_000 + 1;
  for (const { days: n } of AUDIT_PERIODS) {
    assert.equal(days(kstPeriod(n, now)), n);
    assert.ok(n <= 92, `${n}일`);
  }
});

test("기록 이름 — 서버 action 값에 한국어 이름, 모르는 값은 원문", () => {
  for (const action of ["list_users", "read_user", "list_audit_logs", "export_beta_events", "view_stats_summary"]) {
    assert.notEqual(auditActionLabel(action), action, action);
  }
  assert.equal(auditActionLabel("delete_everything"), "delete_everything");
  assert.equal(AUDIT_ACTION_FILTERS[0].id, "all");
  assert.ok(
    !AUDIT_ACTION_FILTERS.some((item) => item.id === "view_stats_summary"),
    "아직 남기지 않는 종류는 거르지 않는다",
  );
});
