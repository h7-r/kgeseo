// 조사(inspect) 기록 — 「읽었다」를 Play Session 에 한 번 남기고, 준비 전에는 기억해 두었다가 보낸다.
// 런타임 ID 는 시험용 가상 값이다(실제 나주 ID 가 아니다). 로컬 ID 는 najuLocalIds 의 제안 값.
//   node --test naju01/tests/*.test.ts
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import type { CompanionSessionStatus } from "../src/companion/companionSession.ts";
import { createInspectRecorder } from "../src/progress/inspectRecorder.ts";
import { NAJU_LOCAL } from "../src/progress/najuLocalIds.ts";
import { createProgressRuntime } from "../src/progress/progressRuntime.ts";
import type { ProgressIdTable } from "../src/progress/progressSync.ts";

interface Call {
  body: Record<string, unknown> | null;
  raw: string | null;
}
type Reply = { status: number; body?: unknown } | "network";

let calls: Call[] = [];
const realFetch = globalThis.fetch;

function serve(handler: (call: Call) => Reply) {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : null;
    const call: Call = { body: raw ? JSON.parse(raw) : null, raw };
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

const ready = (id: string): CompanionSessionStatus => ({
  phase: "ready",
  playSessionId: id,
  caseId: "t",
  contentVersion: 1,
  hintLevels: {},
});
const PLAY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TABLE: ProgressIdTable = {
  zones: { [NAJU_LOCAL.zones.caveHall]: "ZONE_TEST_HALL" },
  objects: { [NAJU_LOCAL.objects.caveTablet]: "OBJ_TEST_TABLET" },
};
const TABLET = [NAJU_LOCAL.zones.caveHall, NAJU_LOCAL.objects.caveTablet] as const;
const ok = () => ({
  status: 200,
  body: { interaction_id: crypto.randomUUID(), result_type: "ok", message: null, attempt_count: null, state_changes: [], ui_actions: [] },
});

/** 세션 상태를 바꿔 가며 구독자를 부르는 가짜 동행 세션 */
function setup(options: { status?: CompanionSessionStatus; table?: ProgressIdTable | null } = {}) {
  let status = options.status ?? ready(PLAY_A);
  const listeners = new Set<() => void>();
  const runtime = createProgressRuntime({
    session: { getStatus: () => status, noteHintLevel: () => {} },
    ids: options.table === undefined ? TABLE : options.table,
    sendOptions: { retryDelayMs: 0 },
  });
  const notes: string[] = [];
  const recorder = createInspectRecorder({
    runtime,
    playSessionId: () => (status.phase === "ready" ? status.playSessionId : null),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onDiagnostic: (message) => notes.push(message),
  });
  const setStatus = (next: CompanionSessionStatus) => {
    status = next;
    listeners.forEach((listener) => listener());
  };
  return { runtime, recorder, setStatus, notes };
}

test("읽으면 inspect 를 한 번 보낸다 — 물굴 큰 방 · 비석, 빈 payload", async () => {
  serve(ok);
  const { recorder } = setup();
  await recorder.note(...TABLET);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body?.action, "inspect");
  assert.equal(calls[0].body?.target_type, "object");
  assert.equal(calls[0].body?.zone_id, "ZONE_TEST_HALL");
  assert.equal(calls[0].body?.target_id, "OBJ_TEST_TABLET");
  assert.deepEqual(calls[0].body?.payload, {});
  assert.equal(recorder.waitingCount(), 0);
});

test("같은 Play Session 에서 여러 번 읽어도 한 번만 — 새 Play Session 에서 읽으면 다시 보낸다", async () => {
  serve(ok);
  const { recorder, setStatus } = setup();
  await recorder.note(...TABLET);
  await recorder.note(...TABLET);
  assert.equal(calls.length, 1);
  setStatus(ready(PLAY_B));
  await recorder.flush();
  assert.equal(calls.length, 1); // 새 세션이라고 저절로 보내지는 않는다
  await recorder.note(...TABLET);
  assert.equal(calls.length, 2);
});

test("세션 준비 전에 읽은 것은 기억해 두었다가 세션이 준비되면 한 번 보낸다", async () => {
  serve(ok);
  const { recorder, setStatus } = setup({ status: { phase: "starting" } });
  await recorder.note(...TABLET);
  await recorder.note(...TABLET);
  assert.equal(calls.length, 0);
  assert.equal(recorder.waitingCount(), 1);
  setStatus(ready(PLAY_A));
  await recorder.flush();
  assert.equal(calls.length, 1);
  assert.equal(recorder.waitingCount(), 0);
});

test("대응표 확정 전에는 보내지 않고 기다리기만(진단 한 줄) — 대응표를 넣고 flush 하면 보낸다", async () => {
  serve(ok);
  const { runtime, recorder, notes } = setup({ table: null });
  await recorder.note(...TABLET);
  await recorder.note(...TABLET);
  assert.equal(calls.length, 0);
  assert.equal(notes.length, 1);
  runtime.setIdTable(TABLE);
  await recorder.flush();
  assert.equal(calls.length, 1);
});

test("연결 실패는 같은 이벤트(같은 client_event_id)를 쥐고 다음 flush 때 다시 보낸다", async () => {
  serve(() => "network");
  const { recorder } = setup();
  await recorder.note(...TABLET);
  const failed = calls.length;
  assert.ok(failed >= 1);
  assert.equal(recorder.waitingCount(), 1);
  serve(ok);
  await recorder.flush();
  assert.equal(recorder.waitingCount(), 0);
  assert.equal(new Set(calls.map((call) => call.raw)).size, 1);
});

test("서버가 거절하면(409) 쥐지 않는다 — 다시 읽으면 새 이벤트로 시도한다", async () => {
  serve(() => ({ status: 409, body: { detail: "Zone is not current." } }));
  const { recorder } = setup();
  await recorder.note(...TABLET);
  assert.equal(recorder.waitingCount(), 0);
  serve(ok);
  await recorder.note(...TABLET);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].body?.client_event_id, calls[1].body?.client_event_id);
});

test("대응표에 없는 물건은 보내지 않고 버린다(진단)", async () => {
  serve(ok);
  const { recorder, notes } = setup({ table: { zones: TABLE.zones, objects: {} } });
  await recorder.note(...TABLET);
  assert.equal(calls.length, 0);
  assert.equal(recorder.waitingCount(), 0);
  assert.equal(notes.length, 1);
});
