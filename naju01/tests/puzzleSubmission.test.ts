// 퍼즐 제출(puzzleSubmission) — P03(input) · P07(complete) 시범 연결 규칙을 가짜 fetch 로 확인한다.
// 런타임 ID 는 시험용 가상 값이다(실제 나주 ID 가 아니다). 로컬 ID 는 najuLocalIds 의 제안 값.
//   node --test naju01/tests/*.test.ts
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import type { CompanionSessionStatus } from "../src/companion/companionSession.ts";
import { NAJU_LOCAL } from "../src/progress/najuLocalIds.ts";
import { createProgressRuntime, type ProgressRuntimeSession } from "../src/progress/progressRuntime.ts";
import type { ProgressIdTable } from "../src/progress/progressSync.ts";
import { createPuzzleSubmission, verdictNotice, type SubmissionState } from "../src/progress/puzzleSubmission.ts";
import { JAR_COUNT, jarOrderAnswer } from "../src/puzzles/jars/jarAnswer.ts";
import { isLocalJarOrderCorrect } from "../src/puzzles/jars/jarLocalJudge.dev.ts";

interface Call {
  path: string;
  body: Record<string, unknown> | null;
  raw: string | null;
}
type Reply = { status: number; body?: unknown } | "network";

let calls: Call[] = [];
const realFetch = globalThis.fetch;

function serve(handler: (call: Call) => Reply) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : null;
    const call: Call = { path: String(input), body: raw ? JSON.parse(raw) : null, raw };
    calls.push(call);
    const reply = handler(call);
    if (reply === "network") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(reply.body ?? null), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const PLAY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const READY: CompanionSessionStatus = { phase: "ready", playSessionId: PLAY, caseId: "t", contentVersion: 1, hintLevels: {} };
// 가상 대응표 — 왼쪽은 najuLocalIds 의 로컬 이름, 오른쪽은 시험용 런타임 ID
const TABLE: ProgressIdTable = {
  zones: { [NAJU_LOCAL.zones.Z2]: "ZONE_TEST_Z2", [NAJU_LOCAL.zones.caveHall]: "ZONE_TEST_HALL" },
  objects: { [NAJU_LOCAL.objects.P03]: "OBJ_TEST_JARS", [NAJU_LOCAL.objects.P07]: "OBJ_TEST_BIG_CLAM" },
};
const P03 = (answer: string) =>
  ({ action: "input", zone: NAJU_LOCAL.zones.Z2, object: NAJU_LOCAL.objects.P03, answer }) as const;
const P07 = { action: "complete", zone: NAJU_LOCAL.zones.caveHall, object: NAJU_LOCAL.objects.P07 } as const;

const result = (type: string, attempt: number | null = null, id = "int-1") => ({
  interaction_id: id,
  result_type: type,
  message: null,
  attempt_count: attempt,
  state_changes: type === "correct" ? [{ type: "puzzle_completed", puzzle_id: "P_TEST" }] : [],
  ui_actions: [],
});

function setup(options: { status?: CompanionSessionStatus; table?: ProgressIdTable | null } = {}) {
  const session: ProgressRuntimeSession = { getStatus: () => options.status ?? READY, noteHintLevel: () => {} };
  const unmapped: unknown[] = [];
  const runtime = createProgressRuntime({
    session,
    ids: options.table === undefined ? TABLE : options.table,
    sendOptions: { retryDelayMs: 0 },
    onUnmapped: (report) => unmapped.push(report),
  });
  const states: SubmissionState[] = [];
  const submission = createPuzzleSubmission(runtime, { onChange: (state) => states.push(state) });
  return { runtime, submission, states, unmapped };
}

// ── P03 답 모양 ──

test("P03 답: 자리 0~5 의 항아리 번호를 쉼표로 잇고, 잘못된 순서는 거절한다", () => {
  assert.equal(JAR_COUNT, 6);
  assert.equal(jarOrderAnswer([5, 4, 3, 2, 1, 0]), "5,4,3,2,1,0");
  assert.throws(() => jarOrderAnswer([0, 1, 2]));
  assert.throws(() => jarOrderAnswer([0, 0, 1, 2, 3, 4]));
  assert.throws(() => jarOrderAnswer([0, 1, 2, 3, 4, 6]));
});

test("P03 개발용 로컬 판정: 가락 순서가 같을 때만 맞다(배포 빌드에는 이 파일이 없다)", () => {
  assert.equal(isLocalJarOrderCorrect(["도", "미", "솔", "높은 도", "높은 미", "높은 솔"]), true);
  assert.equal(isLocalJarOrderCorrect(["미", "도", "솔", "높은 도", "높은 미", "높은 솔"]), false);
  assert.equal(isLocalJarOrderCorrect(["도"]), false);
});

// ── P03 서버 판정 ──

test("P03 정답: input 본문은 대표 물건 · 직렬화한 답, correct 면 done", async () => {
  serve(() => ({ status: 200, body: result("correct", 1) }));
  const { submission, states } = setup();
  const verdict = await submission.submit(P03("1,0,2,3,4,5"));
  assert.deepEqual(verdict, { kind: "correct" });
  assert.equal(submission.state(), "done");
  assert.deepEqual(states, ["sending", "done"]);
  assert.equal(calls[0].path, `/api/v1/play-sessions/${PLAY}/interactions`);
  assert.equal(calls[0].body?.action, "input");
  assert.equal(calls[0].body?.zone_id, "ZONE_TEST_Z2");
  assert.equal(calls[0].body?.target_id, "OBJ_TEST_JARS");
  assert.deepEqual(calls[0].body?.payload, { answer: "1,0,2,3,4,5" });
});

test("P03 오답: incorrect 와 시도 횟수 — 완료가 아니고 다시 시도할 것도 없다", async () => {
  serve(() => ({ status: 200, body: result("incorrect", 2) }));
  const { submission } = setup();
  assert.deepEqual(await submission.submit(P03("0,1,2,3,4,5")), { kind: "incorrect", attemptCount: 2 });
  assert.equal(submission.state(), "idle");
  assert.equal(submission.canRetry(), false);
  assert.equal(await submission.retry(), null);
  assert.equal(verdictNotice({ kind: "incorrect", attemptCount: 2 }), null);
});

test("P03 이미 완료: already_completed 는 오류가 아닌 완료(done)", async () => {
  serve(() => ({ status: 200, body: result("already_completed") }));
  const { submission } = setup();
  assert.deepEqual(await submission.submit(P03("1,0,2,3,4,5")), { kind: "already-completed" });
  assert.equal(submission.state(), "done");
});

test("P03 중복 제출: 보내는 중에는 새 시도를 받지 않는다(busy)", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(input), body: JSON.parse(String(init?.body)), raw: String(init?.body) });
    await gate;
    return new Response(JSON.stringify(result("correct")), { status: 200 });
  }) as typeof fetch;
  const { submission } = setup();
  const first = submission.submit(P03("1,0,2,3,4,5"));
  assert.deepEqual(await submission.submit(P03("1,0,2,3,4,5")), { kind: "busy" });
  release();
  assert.deepEqual(await first, { kind: "correct" });
  assert.equal(calls.length, 1);
});

// ── P07 화면 판정 ──

test("P07 완료: complete 본문은 빈 payload, correct 면 done", async () => {
  serve(() => ({ status: 200, body: result("correct") }));
  const { submission } = setup();
  assert.deepEqual(await submission.submit(P07), { kind: "correct" });
  assert.equal(calls[0].body?.action, "complete");
  assert.equal(calls[0].body?.target_type, "object");
  assert.equal(calls[0].body?.zone_id, "ZONE_TEST_HALL");
  assert.equal(calls[0].body?.target_id, "OBJ_TEST_BIG_CLAM");
  assert.deepEqual(calls[0].body?.payload, {});
});

test("P07 중복 완료: 새 이벤트로 다시 신고하면 서버가 already_completed — 완료로 본다", async () => {
  let n = 0;
  serve(() => ({ status: 200, body: n++ === 0 ? result("correct", null, "int-1") : result("already_completed", null, "int-2") }));
  const { submission } = setup();
  assert.deepEqual(await submission.submit(P07), { kind: "correct" });
  assert.deepEqual(await submission.submit(P07), { kind: "already-completed" });
  assert.notEqual(calls[0].body?.client_event_id, calls[1].body?.client_event_id);
});

// ── 보낼 수 없음 ──

test("세션 준비 전: 보내지 않고 unavailable(session-not-ready)", async () => {
  serve(() => ({ status: 200, body: result("correct") }));
  const { submission, unmapped } = setup({ status: { phase: "starting" } });
  assert.deepEqual(await submission.submit(P03("1,0,2,3,4,5")), { kind: "unavailable", reason: "session-not-ready" });
  assert.equal(calls.length, 0);
  assert.equal(unmapped.length, 0);
});

test("대응표 확정 전: 보내지 않고 unavailable(not-configured) — 미매핑 진단을 남기지 않는다", async () => {
  serve(() => ({ status: 200, body: result("correct") }));
  const { submission, unmapped } = setup({ table: null });
  assert.deepEqual(await submission.submit(P07), { kind: "unavailable", reason: "not-configured" });
  assert.equal(calls.length, 0);
  assert.equal(unmapped.length, 0);
  assert.equal(submission.state(), "idle");
});

test("대응표에 없는 물건: 보내지 않고 unavailable(unmapped) + 진단", async () => {
  serve(() => ({ status: 200, body: result("correct") }));
  const { submission, unmapped } = setup({
    table: { zones: TABLE.zones, objects: { [NAJU_LOCAL.objects.P03]: "OBJ_TEST_JARS" } },
  });
  assert.deepEqual(await submission.submit(P07), { kind: "unavailable", reason: "unmapped" });
  assert.equal(calls.length, 0);
  assert.equal(unmapped.length, 1);
});

// ── 실패 · 재시도 ──

test("네트워크 실패: 기본 재시도 뒤 retryable — retry 는 같은 이벤트(같은 본문)를 다시 보낸다", async () => {
  serve(() => "network");
  const { submission, states } = setup();
  assert.deepEqual(await submission.submit(P03("1,0,2,3,4,5")), { kind: "retryable", reason: "unreachable" });
  assert.equal(calls.length, 3); // 처음 1 + 기본 재시도 2 — 그 뒤 자동으로 더 보내지 않는다
  assert.equal(submission.canRetry(), true);
  assert.equal(
    verdictNotice({ kind: "retryable", reason: "unreachable" }),
    "서버 연결이 끊겼다. [E] 로 다시 보내 보자.",
  );

  serve(() => ({ status: 200, body: result("correct") }));
  assert.deepEqual(await submission.retry(), { kind: "correct" });
  assert.equal(new Set(calls.map((call) => call.raw)).size, 1);
  assert.equal(submission.state(), "done");
  assert.deepEqual(states, ["sending", "retryable", "sending", "done"]);
});

test("retryable 상태에서 새 시도를 하면 쥔 이벤트를 버리고 새 이벤트로 보낸다", async () => {
  serve(() => "network");
  const { submission } = setup();
  await submission.submit(P03("1,0,2,3,4,5"));
  serve(() => ({ status: 200, body: result("incorrect", 1) }));
  await submission.submit(P03("0,1,2,3,4,5"));
  assert.notEqual(calls[0].body?.client_event_id, calls.at(-1)?.body?.client_event_id);
  assert.equal(submission.canRetry(), false);
});

test("409 · 404: failed — 쥐지 않고(재시도 없음) 세션을 건드리지 않는다", async () => {
  const { submission } = setup();
  serve(() => ({ status: 409, body: { detail: "Zone is not current." } }));
  assert.deepEqual(await submission.submit(P07), { kind: "failed", reason: "zone-not-current" });
  assert.equal(submission.canRetry(), false);
  serve(() => ({ status: 404, body: { detail: "Play session not found." } }));
  assert.deepEqual(await submission.submit(P07), { kind: "failed", reason: "session-missing" });
  assert.equal(await submission.retry(), null);
  assert.ok(calls.every((call) => call.path.endsWith("/interactions")));
  assert.match(verdictNotice({ kind: "failed", reason: "session-missing" }) ?? "", /진행 기록/);
  assert.match(verdictNotice({ kind: "unavailable", reason: "not-configured" }) ?? "", /연결/);
});
