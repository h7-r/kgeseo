/**
 * 베타 기록 집계(관리자 「베타 기록」 화면 · tools/beta/beta-report.mjs 공용) — 합성 기록으로 지표를 확인한다.
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";

const { buildBetaReport, collectEvents, parseUtc, shortKey, summaryMarkdown, peopleCsv, objectivesCsv, eventsCsv } =
  await import("../../website/src/admin/lib/betaReport.ts");

const BASE = Date.parse("2026-11-13T01:00:00Z");
let serial = 0;
/** 서버 내보내기와 같은 모양 — 시각은 시간대 없는 UTC */
function ev(fields) {
  serial += 1;
  const at = BASE + (fields.atMin ?? 0) * 60000;
  const naive = new Date(at).toISOString().replace("Z", "");
  return {
    id: serial,
    event_id: `e-${serial}`,
    received_at: naive,
    client_ts: naive,
    event_type: fields.type,
    phase: fields.phase ?? null,
    participant_code: fields.code ?? null,
    run_id: fields.run ?? null,
    run_index: fields.run ? 0 : null,
    tab_id: "tab",
    seq: serial,
    objective_id: fields.obj ?? null,
    page: fields.page ?? "naju",
    build: "b1",
    app_user_id: fields.user ?? null,
    guest_session_id: null,
    data: fields.data ?? {},
  };
}

/** 한 사람이 나주를 처음부터 끝까지(엔딩) — 도움을 한 번 받는다 */
function finisher(user, run) {
  return [
    ev({ user, type: "beta_entry", phase: "open", page: "main", data: { os: "macos", browser: "chrome" } }),
    ev({ user, type: "stage_reached", phase: "character_open", page: "main" }),
    ev({ user, type: "stage_reached", phase: "character_done", page: "main" }),
    ev({ user, type: "stage_reached", phase: "headquarters", page: "main" }),
    ev({ user, type: "stage_reached", phase: "load_done", data: { at_ms: 8000, result: "ready" } }),
    ev({ user, run, type: "stage_reached", phase: "naju_controllable", atMin: 1 }),
    ev({ user, run, type: "run_state", phase: "start", atMin: 1, data: { active_ms: 0 } }),
    ev({ user, run, type: "objective_state", phase: "available", obj: "P01", atMin: 1, data: { active_ms: 0 } }),
    ev({ user, run, type: "puzzle_attempt", phase: "fail", obj: "P01", atMin: 2 }),
    ev({ user, run, type: "help_event", phase: "request", obj: "P01", atMin: 3 }),
    ev({ user, run, type: "help_event", phase: "received", obj: "P01", atMin: 3 }),
    ev({
      user,
      run,
      type: "objective_state",
      phase: "complete",
      obj: "P01",
      atMin: 4,
      data: { active_ms: 180000, origin: "live" },
    }),
    ev({ user, run, type: "story_exposure", phase: "heard", atMin: 5, data: { evidence: "c2_rock" } }),
    ev({ user, run, type: "story_exposure", phase: "heard", atMin: 6, data: { evidence: "c3_that_day" } }),
    ev({ user, run, type: "story_exposure", phase: "heard", atMin: 7, data: { evidence: "c3_ask" } }),
    ev({
      user,
      run,
      type: "npc_turn",
      phase: "response",
      atMin: 8,
      data: { trigger: "player_message", rtt_ms: 1200, has_reply: true },
    }),
    ev({ user, run, type: "run_state", phase: "dawn", atMin: 40, data: { active_ms: 2400000 } }),
    ev({ user, run, type: "survey_link", phase: "shown", atMin: 41, data: { kind: "post" } }),
    ev({ user, run, type: "survey_link", phase: "opened", atMin: 41, data: { kind: "post" } }),
  ];
}

/** P01 에서 멈추고 하루 넘게 안 온 사람 — 오류 하나, 그만두기 설문을 연다 */
function quitter(user, run) {
  return [
    ev({ user, type: "beta_entry", phase: "open", page: "main", data: { os: "windows", browser: "edge" } }),
    ev({ user, type: "stage_reached", phase: "headquarters", page: "main" }),
    ev({ user, run, type: "stage_reached", phase: "naju_controllable", atMin: 2 }),
    ev({ user, run, type: "run_state", phase: "start", atMin: 2, data: { active_ms: 0 } }),
    ev({ user, run, type: "objective_state", phase: "available", obj: "P01", atMin: 2, data: { active_ms: 0 } }),
    ev({ user, run, type: "puzzle_attempt", phase: "fail", obj: "P01", atMin: 3 }),
    ev({ user, run, type: "puzzle_attempt", phase: "fail", obj: "P01", atMin: 4 }),
    ev({ user, run, type: "puzzle_attempt", phase: "fail", obj: "P01", atMin: 5 }),
    ev({ user, run, type: "client_error", phase: "webgl", atMin: 6 }),
    ev({ user, run, type: "survey_link", phase: "opened", atMin: 7, data: { kind: "exit" } }),
  ];
}

const rows = [
  ...finisher("user-a", "run-a"),
  ...quitter("user-b", "run-b"),
  // 계정 없이 코드만 — 그 코드가 user-a 에도 붙어 있으면 user-a 로 합친다
  ev({ user: "user-a", code: "K-1", type: "stage_reached", phase: "train", page: "main" }),
  ev({ code: "K-1", type: "stage_reached", phase: "train", page: "main" }),
  // 다른 사람이 쓴 코드 하나 — 계정이 없어서 코드로만 센다
  ev({ code: "K-9", type: "beta_entry", phase: "open", page: "main", data: { os: "macos", browser: "chrome" } }),
  // 관리자(뺄 계정)
  ev({ user: "admin-1", type: "beta_entry", phase: "open", page: "main", data: { os: "macos", browser: "safari" } }),
];
const NOW = BASE + 2 * 24 * 3600 * 1000;

test("시각 — 시간대 없는 서버 값은 UTC 로 읽는다", () => {
  assert.equal(parseUtc("2026-11-13T01:00:00.123456"), Date.parse("2026-11-13T01:00:00.123Z"));
  assert.equal(parseUtc("2026-11-13T01:00:00Z"), Date.parse("2026-11-13T01:00:00Z"));
  assert.ok(Number.isNaN(parseUtc(null)));
});

test("참가 번호 — 게임 shortKey 와 같은 값", () => {
  assert.equal(shortKey(""), "811C9DC5");
  assert.match(shortKey("user-a"), /^[0-9A-F]{8}$/);
});

test("내보내기 응답 · 배열 · 중복을 한 목록으로", () => {
  const list = collectEvents([{ events: rows.slice(0, 3) }, rows.slice(2, 5), rows[0]]);
  assert.equal(list.length, 5);
});

test("사람 묶기 — 계정, 한 계정에만 붙은 코드는 그 계정으로, 뺄 계정은 뺀다", () => {
  const report = buildBetaReport(rows, { now: NOW, exclude: new Set(["admin-1"]) });
  assert.equal(report.people, 3);
  assert.equal(report.accountPeople, 2);
  assert.equal(report.codeOnlyPeople, 1);
  assert.ok(!report.events.some((e) => e.app_user_id === "admin-1"));
  const merged = report.events.filter((e) => e.participant_code === "K-1");
  assert.ok(merged.every((e) => e.who === "u:user-a"));
});

test("뺄 계정 — 사람 묶기는 빼기 전 전체 기록으로 정한다", () => {
  const linked = [
    // 관리자가 코드를 쓴 기록과, 같은 코드로 계정 없이 남긴 기록 — 관리자를 빼면 둘 다 빠져야 한다
    ev({ user: "admin-1", code: "A-1", type: "beta_entry", phase: "open", page: "main" }),
    ev({ code: "A-1", type: "stage_reached", phase: "train", page: "main" }),
    // 두 계정이 함께 쓴 코드 — 한 계정을 빼도 남은 계정에 붙이지 않는다(코드로만 센다)
    ev({ user: "user-x", code: "S-1", type: "beta_entry", phase: "open", page: "main" }),
    ev({ user: "admin-2", code: "S-1", type: "beta_entry", phase: "open", page: "main" }),
    ev({ code: "S-1", type: "stage_reached", phase: "train", page: "main" }),
  ];
  const report = buildBetaReport(linked, { now: NOW, exclude: new Set(["admin-1", "admin-2"]) });
  assert.ok(!report.events.some((e) => e.participant_code === "A-1"));
  assert.deepEqual([...new Set(report.events.map((e) => e.who))].sort(), ["c:S-1", "u:user-x"]);
});

test("진입 단계 · 첫 판 완주 · 마지막 지점", () => {
  const report = buildBetaReport(rows, { now: NOW, exclude: new Set(["admin-1"]) });
  const steps = Object.fromEntries(report.funnel.map((s) => [s.name, s.people]));
  assert.equal(steps["게임 첫 실행"], 3);
  assert.equal(steps["본부실 진입"], 2);
  assert.equal(steps["나주 조작 가능"], 2);
  assert.equal(steps["첫 퍼즐 해결(P01)"], 1);
  assert.equal(steps["엔딩(동트기)"], 1);
  assert.deepEqual(report.firstRun, { starters: 2, finished: 1, observing: 0 });
  assert.deepEqual(report.lastSpots, [{ spot: "P01", people: 1, reached: 2 }]);
});

test("24시간 관찰 창 — 아직 하루가 안 지났으면 분모에서 뺀다", () => {
  const report = buildBetaReport(rows, { now: BASE + 3600 * 1000, exclude: new Set(["admin-1"]) });
  assert.deepEqual(report.firstRun, { starters: 2, finished: 1, observing: 1 });
  assert.equal(report.lastSpots.length, 0);
});

test("목표별 · 별 · 설화 · 동행 · 오류 · 로딩 · 환경 · 설문", () => {
  const report = buildBetaReport(rows, { now: NOW, exclude: new Set(["admin-1"]) });
  const p01 = report.objectives.find((o) => o.id === "P01");
  assert.equal(p01.reached, 2);
  assert.equal(p01.done, 1);
  assert.equal(p01.fail3, "1/2");
  assert.equal(p01.help, "1/2");
  assert.equal(p01.median, "1명(10명 미만)");
  assert.deepEqual(report.stars, { three: 0, two: 1, one: 0 });
  assert.deepEqual(report.playTimes, [2400000]);
  assert.deepEqual(report.story, { najuPeople: 2, heardAll: 1 });
  assert.equal(report.companion.responses, 1);
  assert.deepEqual(report.companion.directRtt, [1200]);
  assert.deepEqual(report.errors, [{ category: "webgl", people: 1 }]);
  assert.deepEqual(report.najuLoad, { readyMs: [8000], timeouts: 0 });
  assert.deepEqual(report.environments, [
    { name: "macos · chrome", people: 2 },
    { name: "windows · edge", people: 1 },
  ]);
  const post = report.surveys.find((s) => s.kind === "post");
  const exit = report.surveys.find((s) => s.kind === "exit");
  assert.deepEqual([post.shown, post.opened, exit.opened], [1, 1, 1]);
});

test("내려받기 파일 — 엑셀용 BOM, 사람 · 목표 · 원시 · 요약", () => {
  const report = buildBetaReport(rows, { now: NOW, exclude: new Set(["admin-1"]) });
  const people = peopleCsv(report);
  assert.ok(people.startsWith("﻿사람,참가 번호"));
  assert.ok(people.includes(`u:user-a,${shortKey("user-a")},user-a,예,예,2400,P01`));
  assert.ok(objectivesCsv(report).includes("P01,2,1,1/2(20명 미만)"));
  assert.equal(eventsCsv(report).trim().split("\n").length, report.events.length + 1);
  const md = summaryMarkdown(report);
  assert.ok(md.includes("| 엔딩(동트기) | 1 |"));
  assert.ok(md.includes("나주 첫 시작 2명 중 24시간 안에 엔딩 1명"));
});
