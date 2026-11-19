// 진행 동기화 런타임(progressRuntime) — 동행 세션 연결 · 상태 변화 전달 · 힌트 단계 · 오류 전달을 가짜 fetch 로 확인한다.
// ID 는 전부 시험용 가상 값이다.
//   node --test naju01/tests/*.test.ts
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  SESSION_STORAGE_KEY,
  createCompanionSession,
  type CompanionSessionStatus,
  type KeyValueStore,
} from "../src/companion/companionSession.ts";
import {
  createProgressRuntime,
  isServerApplied,
  type ProgressRuntimeOptions,
  type ProgressRuntimeSession,
  type ProgressStateListener,
} from "../src/progress/progressRuntime.ts";
import type { InteractionStateChange, ProgressIdTable } from "../src/progress/progressSync.ts";

interface Call {
  method: string;
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
    const call: Call = { method: init?.method ?? "GET", path: String(input), body: raw ? JSON.parse(raw) : null, raw };
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

const PLAY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const path = (id: string) => `/api/v1/play-sessions/${id}/interactions`;
const ready = (playSessionId: string, hintLevels: Record<string, number> = {}): CompanionSessionStatus => ({
  phase: "ready",
  playSessionId,
  caseId: "test-case",
  contentVersion: 1,
  hintLevels,
});

const TABLE: ProgressIdTable = {
  zones: { TA: "ZONE_TEST_A", TB: "ZONE_TEST_B" },
  objects: { "test-lever": "OBJ_TEST_LEVER" },
};
const LEVER = { action: "complete", zone: "TA", object: "test-lever" } as const;

const response = (interactionId: string, changes: InteractionStateChange[]) => ({
  interaction_id: interactionId,
  result_type: "correct",
  message: null,
  attempt_count: null,
  state_changes: changes,
  ui_actions: [],
});
const DONE: InteractionStateChange[] = [{ type: "puzzle_completed", puzzle_id: "PZ_TEST" }];
const hint = (level: number): InteractionStateChange => ({ type: "hint_level_changed", puzzle_id: "PZ_TEST", hint_level: level });

/** 가짜 동행 세션 — getStatus 는 바꿀 수 있고, noteHintLevel 은 진짜처럼 hintLevels 를 바꾼다 */
function fakeSession(initial: CompanionSessionStatus) {
  let status = initial;
  const notes: [string, number][] = [];
  const session: ProgressRuntimeSession & { set(next: CompanionSessionStatus): void; notes: typeof notes } = {
    getStatus: () => status,
    noteHintLevel(puzzleId, level) {
      notes.push([puzzleId, level]);
      if (status.phase === "ready") status = { ...status, hintLevels: { ...status.hintLevels, [puzzleId]: level } };
    },
    set: (next) => void (status = next),
    notes,
  };
  return session;
}

function runtime(session: ProgressRuntimeSession, patch: Partial<ProgressRuntimeOptions> = {}) {
  return createProgressRuntime({ session, ids: TABLE, sendOptions: { retryDelayMs: 0 }, ...patch });
}

const deliveryOf = (result: unknown) => (result as { delivery?: { status: string } }).delivery?.status;

// ── 세션 연결 ──

test("런타임 1: 저장된 동행 세션을 그대로 쓴다 — 게스트 쿠키만 먼저 받고 플레이 세션은 새로 만들지 않는다", async () => {
  const data: Record<string, string> = {
    [SESSION_STORAGE_KEY]: JSON.stringify({
      anonymousSessionId: "44444444-4444-4444-8444-444444444444",
      playSessionId: PLAY_A,
      caseId: "test-case",
      contentVersion: 1,
    }),
  };
  const storage: KeyValueStore = {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => void (data[key] = value),
    removeItem: (key) => void delete data[key],
  };
  serve((call) =>
    call.method === "GET"
      ? { status: 200, body: { data: { play_session_id: PLAY_A, case_id: "test-case", state: { hint_levels: {} } } } }
      : call.path === "/api/v1/anonymous-sessions"
        ? { status: 201, body: { data: { anonymous_session_id: "44444444-4444-4444-8444-444444444444" } } }
        : { status: 200, body: response("int-1", DONE) },
  );
  const companion = createCompanionSession({ config: { caseId: "test-case", contentVersion: 1 }, storage });
  await companion.start();
  const result = await runtime(companion).submit(LEVER);
  assert.ok(isServerApplied(result));
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.path}`),
    ["POST /api/v1/anonymous-sessions", `GET /api/v1/play-sessions/${PLAY_A}`, `POST ${path(PLAY_A)}`],
  );
});

test("런타임 2: 세션이 준비되지 않았으면 보내지 않고 not-sent 를 돌려준다", async () => {
  serve(() => ({ status: 200, body: response("int-1", DONE) }));
  const result = await runtime(fakeSession({ phase: "starting" })).submit(LEVER);
  assert.deepEqual(result, { kind: "not-sent", reason: "session-not-ready" });
  assert.equal(isServerApplied(result), false);
  assert.equal(calls.length, 0);
});

// ── 대응표 ──

test("런타임 3: 대응표가 없으면(확정 전) 모든 ID 가 미매핑 — 보내지 않고 알린다", async () => {
  serve(() => ({ status: 200, body: response("int-1", DONE) }));
  const reports: unknown[] = [];
  const r = runtime(fakeSession(ready(PLAY_A)), { ids: null, onUnmapped: (report) => reports.push(report) });
  assert.equal(r.hasIdTable(), false);
  assert.deepEqual(await r.submit(LEVER), { ok: false, reason: "unmapped", kind: "zone", localId: "TA" });
  assert.equal(calls.length, 0);
  assert.equal(reports.length, 1);

  r.setIdTable(TABLE);
  assert.ok(isServerApplied(await r.submit(LEVER)));
  assert.deepEqual(await r.submit({ action: "complete", zone: "TA", object: "test-other" }), {
    ok: false,
    reason: "unmapped",
    kind: "object",
    localId: "test-other",
  });
  r.setIdTable(null);
  assert.equal((await r.submit(LEVER)).hasOwnProperty("ok"), true);
  assert.equal(calls.length, 1);
});

test("런타임 4: 잘못된 대응표는 던지고 이전 대응표를 그대로 둔다", async () => {
  serve(() => ({ status: 200, body: response("int-1", DONE) }));
  const r = runtime(fakeSession(ready(PLAY_A)));
  assert.throws(() => r.setIdTable({ zones: { TA: "Z", TB: "Z" }, objects: {} }));
  assert.ok(isServerApplied(await r.submit(LEVER)));
});

// ── 상태 변화 ──

test("런타임 5: 처음 받은 상태 변화를 구독자에게 보낸 세션 · interaction_id 와 함께 넘긴다", async () => {
  serve(() => ({ status: 200, body: response("int-1", DONE) }));
  const r = runtime(fakeSession(ready(PLAY_A)));
  const seen: Parameters<ProgressStateListener>[] = [];
  r.subscribe((changes, context) => seen.push([changes, context]));
  const result = await r.submit(LEVER);
  assert.equal(deliveryOf(result), "delivered");
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0][0], DONE);
  assert.equal(seen[0][1].playSessionId, PLAY_A);
  assert.equal(seen[0][1].interactionId, "int-1");
  assert.equal(seen[0][1].prepared.body.target_id, "OBJ_TEST_LEVER");
});

test("런타임 6: 같은 응답을 다시 받으면 구독자 · 힌트 반영을 다시 하지 않는다", async () => {
  serve(() => ({ status: 200, body: response("int-1", [...DONE, hint(1)]) }));
  const session = fakeSession(ready(PLAY_A));
  const r = runtime(session);
  let count = 0;
  r.subscribe(() => (count += 1));
  const prepared = r.prepare(LEVER);
  assert.ok(prepared.ok);
  assert.equal(deliveryOf(await r.send(prepared.prepared)), "delivered");
  assert.equal(deliveryOf(await r.send(prepared.prepared)), "duplicate");
  assert.equal(count, 1);
  assert.deepEqual(session.notes, [["PZ_TEST", 1]]);
});

test("런타임 7: hint_level_changed 는 동행 세션 noteHintLevel 로 — 올릴 때만 반영한다", async () => {
  const session = fakeSession(ready(PLAY_A, { PZ_TEST: 1 }));
  const r = runtime(session);
  let n = 0;
  const levels = [2, 1, 2];
  serve(() => ({ status: 200, body: response(`int-${++n}`, [hint(levels[n - 1])]) }));
  for (let i = 0; i < levels.length; i++) assert.equal(deliveryOf(await r.submit(LEVER)), "delivered");
  assert.deepEqual(session.notes, [["PZ_TEST", 2]]);
  const status = session.getStatus();
  assert.ok(status.phase === "ready");
  assert.equal(status.hintLevels.PZ_TEST, 2);
});

test("런타임 7-1: 진짜 동행 세션의 hintLevels 가 올라간다", async () => {
  const companion = createCompanionSession({ config: { caseId: "test-case", contentVersion: 1 }, storage: null });
  serve((call) =>
    call.path === "/api/v1/anonymous-sessions"
      ? { status: 201, body: { data: { anonymous_session_id: "55555555-5555-4555-8555-555555555555" } } }
      : call.path === "/api/v1/play-sessions"
        ? { status: 201, body: { data: { play_session_id: PLAY_A, case_id: "test-case", state: { hint_levels: {} } } } }
        : { status: 200, body: response("int-1", [hint(2)]) },
  );
  await companion.start();
  await runtime(companion).submit(LEVER);
  const status = companion.getStatus();
  assert.ok(status.phase === "ready");
  assert.deepEqual(status.hintLevels, { PZ_TEST: 2 });
});

test("런타임 8: 응답을 기다리는 사이 세션이 바뀌면 옛 세션의 힌트 단계를 새 세션에 올리지 않는다", async () => {
  const session = fakeSession(ready(PLAY_A));
  const r = runtime(session);
  const seen: string[] = [];
  r.subscribe((_, context) => seen.push(context.playSessionId));
  serve(() => {
    session.set(ready(PLAY_B)); // 응답이 오기 전에 세션이 바뀐다
    return { status: 200, body: response("int-old", [hint(2)]) };
  });
  assert.equal(deliveryOf(await r.submit(LEVER)), "delivered");
  assert.deepEqual(session.notes, []);
  // 새 세션의 새 이벤트는 정상 반영
  serve(() => ({ status: 200, body: response("int-new", [hint(1)]) }));
  assert.equal(deliveryOf(await r.submit(LEVER)), "delivered");
  assert.deepEqual(session.notes, [["PZ_TEST", 1]]);
  assert.deepEqual(seen, [PLAY_A, PLAY_B]);
  assert.deepEqual(
    calls.map((call) => call.path),
    [path(PLAY_A), path(PLAY_B)],
  );
});

test("런타임 9: 구독자가 던지면 handler-failed — 다른 구독자는 그대로 부르고, 다시 보내면 다시 넘긴다", async () => {
  serve(() => ({ status: 200, body: response("int-1", [...DONE, hint(1)]) }));
  const session = fakeSession(ready(PLAY_A));
  const r = runtime(session);
  let failing = true;
  let calm = 0;
  r.subscribe(() => {
    if (failing) throw new Error("화면 반영 실패");
  });
  r.subscribe(() => (calm += 1));
  const prepared = r.prepare(LEVER);
  assert.ok(prepared.ok);
  const first = await r.send(prepared.prepared);
  assert.ok(isServerApplied(first));
  assert.equal(first.delivery.status, "handler-failed");
  assert.equal(calm, 1);
  failing = false;
  assert.equal(deliveryOf(await r.send(prepared.prepared)), "delivered");
  assert.equal(calm, 2);
  // 힌트 단계는 두 번 넘겨받아도 한 번만 올라간다
  assert.deepEqual(session.notes, [["PZ_TEST", 1]]);
});

test("런타임 9-1: 구독자 둘이 던지면 AggregateError 로 묶어 handler-failed", async () => {
  serve(() => ({ status: 200, body: response("int-1", DONE) }));
  const r = runtime(fakeSession(ready(PLAY_A)));
  r.subscribe(() => {
    throw new Error("a");
  });
  r.subscribe(() => {
    throw new Error("b");
  });
  const result = await r.submit(LEVER);
  assert.ok(isServerApplied(result) && result.delivery.status === "handler-failed");
  assert.ok(result.delivery.status === "handler-failed" && result.delivery.error instanceof AggregateError);
});

test("런타임 10: 구독을 끊으면 더 넘기지 않는다", async () => {
  let n = 0;
  serve(() => ({ status: 200, body: response(`int-${++n}`, DONE) }));
  const r = runtime(fakeSession(ready(PLAY_A)));
  let count = 0;
  const off = r.subscribe(() => (count += 1));
  await r.submit(LEVER);
  off();
  await r.submit(LEVER);
  assert.equal(count, 1);
});

// ── 오류 전달 — 세션 재생성 · 재전송을 하지 않는다 ──

test("런타임 11: 404 · 409 · 네트워크 오류를 그대로 돌려주고, 성공으로 보지 않으며, 세션을 건드리지 않는다", async () => {
  const session = fakeSession(ready(PLAY_A));
  const r = runtime(session);
  let delivered = 0;
  r.subscribe(() => (delivered += 1));

  serve(() => ({ status: 404, body: { detail: "Play session not found." } }));
  const missing = await r.submit(LEVER);
  assert.deepEqual(missing, { kind: "session-missing" });

  serve(() => ({ status: 409, body: { detail: "Required puzzles are not completed.", missing_puzzle_count: 1 } }));
  const conflict = await r.submit(LEVER);
  assert.ok("kind" in conflict && conflict.kind === "conflict" && conflict.reason === "required-puzzles");

  serve(() => "network");
  const before = calls.length;
  const unreachable = await r.submit(LEVER);
  assert.deepEqual(unreachable, { kind: "unreachable", status: null });
  assert.equal(calls.length - before, 3); // progressSync 의 재시도(1 + 2)만 — 런타임은 더 보내지 않는다

  for (const result of [missing, conflict, unreachable]) assert.equal(isServerApplied(result), false);
  assert.equal(delivered, 0);
  assert.deepEqual(session.notes, []);
  assert.ok(calls.every((call) => call.method === "POST" && call.path === path(PLAY_A)));
});

test("런타임 12: 모르는 state_changes 는 해석하지 않고 결과로만 돌려준다", async () => {
  serve(() => ({ status: 200, body: response("int-1", [{ type: "future_change" } as never, ...DONE]) }));
  const session = fakeSession(ready(PLAY_A));
  const r = runtime(session);
  const seen: InteractionStateChange[][] = [];
  r.subscribe((changes) => seen.push(changes));
  const result = await r.submit(LEVER);
  assert.ok(isServerApplied(result));
  assert.deepEqual(result.unknownStateChanges, [{ type: "future_change" }]);
  assert.deepEqual(seen, [DONE]);
  assert.deepEqual(session.notes, []);
});

test("런타임 13: 베타 기록 — prepare → send(퍼즐 판정 경로)와 submit 모두 판정 결과를 남긴다(Codex 리뷰 2)", async () => {
  const { betaSignals } = await import("../src/beta/betaSignals.ts");
  const seen: Array<{ objective: string; result: string; data?: Record<string, unknown> }> = [];
  const original = betaSignals.attempt;
  betaSignals.attempt = (objective, result, _source, data) => void seen.push({ objective, result, data });
  try {
    serve(() => ({ status: 200, body: { ...response("int-9", []), result_type: "incorrect" } }));
    const r = runtime(fakeSession(ready(PLAY_A)));
    const prepared = r.prepare(LEVER);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    await r.send(prepared.prepared);
    await r.submit(LEVER);
    assert.equal(seen.length, 2);
    assert.equal(seen[0].result, "incorrect");
    assert.equal(seen[0].data?.client_event_id, prepared.prepared.body.client_event_id);
  } finally {
    betaSignals.attempt = original;
  }
});
