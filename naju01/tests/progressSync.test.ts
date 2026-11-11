// 나주 진행 상태 동기화(Interaction API) — 계약(backend/app/schemas/interaction_api.py · api/v1/interactions.py)을 가짜 fetch 로 확인한다.
// ID 는 전부 시험용 가상 값이다. 실제 나주 퍼즐 · 물건 · 구역 ID 가 아니다.
//   node --test naju01/tests/*.test.ts
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import type { CompanionSessionStatus, KeyValueStore } from "../src/companion/companionSession.ts";
import { SESSION_STORAGE_KEY, createCompanionSession } from "../src/companion/companionSession.ts";
import {
  createProgressIdMap,
  createProgressSync,
  isKnownStateChange,
  type InteractionStateChange,
  type ProgressSyncOptions,
  type UnmappedReport,
} from "../src/progress/progressSync.ts";

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

/** 차례대로 답한다. 다 쓰면 마지막 답을 되풀이 */
function serveSequence(replies: Reply[]) {
  let i = 0;
  serve(() => replies[Math.min(i++, replies.length - 1)]);
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const PLAY_ID = "11111111-1111-4111-8111-111111111111";
const INTERACTIONS = `/api/v1/play-sessions/${PLAY_ID}/interactions`;
const READY: CompanionSessionStatus = {
  phase: "ready",
  playSessionId: PLAY_ID,
  caseId: "test-case",
  contentVersion: 7,
  hintLevels: {},
};
const NOW = "2026-11-05T00:00:00.000Z";

// 가상 대응표 — 로컬 구역 TA · TB, 로컬 물건 test-dial · test-lever
const IDS = createProgressIdMap({
  zones: { TA: "ZONE_TEST_A", TB: "ZONE_TEST_B" },
  objects: { "test-dial": "OBJ_TEST_DIAL", "test-lever": "OBJ_TEST_LEVER" },
});

function eventIds() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function sync(patch: Partial<ProgressSyncOptions> = {}) {
  return createProgressSync({
    getSession: () => READY,
    ids: IDS,
    newEventId: eventIds(),
    now: () => NOW,
    sendOptions: { retryDelayMs: 0 },
    ...patch,
  });
}

const okResponse = (patch: Record<string, unknown> = {}) => ({
  interaction_id: "33333333-3333-4333-8333-333333333333",
  result_type: "ok",
  message: null,
  attempt_count: null,
  state_changes: [],
  ui_actions: [],
  ...patch,
});

// ── 요청 본문 ──

test("navigate: 지금 구역은 zone_id, 갈 구역은 target_id(zone), 빈 payload", async () => {
  serve(() => ({ status: 200, body: okResponse({ state_changes: [{ type: "current_zone_changed", zone_id: "ZONE_TEST_B" }] }) }));
  const outcome = await sync().submit({ action: "navigate", fromZone: "TA", toZone: "TB" });
  assert.equal(outcome.kind, "sent");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, INTERACTIONS);
  assert.deepEqual(calls[0].body, {
    client_event_id: "00000000-0000-4000-8000-000000000001",
    client_timestamp: NOW,
    zone_id: "ZONE_TEST_A",
    action: "navigate",
    target_type: "zone",
    target_id: "ZONE_TEST_B",
    payload: {},
  });
});

test("complete: 물건 대상 · 빈 payload(정답 값을 싣지 않는다)", async () => {
  serve(() => ({ status: 200, body: okResponse({ result_type: "correct" }) }));
  const outcome = await sync().submit({ action: "complete", zone: "TA", object: "test-lever" });
  assert.equal(outcome.kind, "sent");
  assert.deepEqual(calls[0].body, {
    client_event_id: "00000000-0000-4000-8000-000000000001",
    client_timestamp: NOW,
    zone_id: "ZONE_TEST_A",
    action: "complete",
    target_type: "object",
    target_id: "OBJ_TEST_LEVER",
    payload: {},
  });
});

test("input · select: payload 는 answer / choice 하나뿐", async () => {
  serve(() => ({ status: 200, body: okResponse({ result_type: "incorrect", attempt_count: 1 }) }));
  const s = sync();
  const input = await s.submit({ action: "input", zone: "TB", object: "test-dial", answer: "test-answer" });
  const select = await s.submit({ action: "select", zone: "TB", object: "test-dial", choice: "test-choice" });
  assert.equal(input.kind, "sent");
  assert.equal(select.kind, "sent");
  assert.deepEqual(calls[0].body, {
    client_event_id: "00000000-0000-4000-8000-000000000001",
    client_timestamp: NOW,
    zone_id: "ZONE_TEST_B",
    action: "input",
    target_type: "object",
    target_id: "OBJ_TEST_DIAL",
    payload: { answer: "test-answer" },
  });
  assert.deepEqual(calls[1].body, {
    client_event_id: "00000000-0000-4000-8000-000000000002",
    client_timestamp: NOW,
    zone_id: "ZONE_TEST_B",
    action: "select",
    target_type: "object",
    target_id: "OBJ_TEST_DIAL",
    payload: { choice: "test-choice" },
  });
});

test("inspect: 물건 대상 · 빈 payload(조사 ID 는 서버가 물건에서 찾는다)", async () => {
  serve(() => ({ status: 200, body: okResponse() }));
  const outcome = await sync().submit({ action: "inspect", zone: "TA", object: "test-lever" });
  assert.equal(outcome.kind, "sent");
  assert.deepEqual(calls[0].body, {
    client_event_id: "00000000-0000-4000-8000-000000000001",
    client_timestamp: NOW,
    zone_id: "ZONE_TEST_A",
    action: "inspect",
    target_type: "object",
    target_id: "OBJ_TEST_LEVER",
    payload: {},
  });
});

// ── 재시도 ──

test("연결 실패 · 502~504 는 같은 client_event_id · 같은 본문 문자열로 다시 보낸다", async () => {
  serveSequence(["network", { status: 503 }, { status: 200, body: okResponse() }]);
  const outcome = await sync().submit({ action: "complete", zone: "TA", object: "test-lever" });
  assert.equal(outcome.kind, "sent");
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((call) => call.raw)).size, 1);
});

test("재시도가 다 실패한 뒤 같은 prepared 를 다시 보내도 ID 가 그대로다(새 prepare 만 새 ID)", async () => {
  serveSequence(["network", "network", "network", { status: 200, body: okResponse() }]);
  const s = sync();
  const result = s.prepare({ action: "complete", zone: "TA", object: "test-lever" });
  assert.ok(result.ok);
  const first = await s.send(result.prepared);
  assert.deepEqual(first, { kind: "unreachable", status: null });
  assert.equal(calls.length, 3); // 처음 1 + 재시도 2
  const second = await s.send(result.prepared);
  assert.equal(second.kind, "sent");
  assert.equal(new Set(calls.map((call) => call.raw)).size, 1);

  const other = s.prepare({ action: "complete", zone: "TA", object: "test-lever" });
  assert.ok(other.ok);
  assert.notEqual(other.prepared.body.client_event_id, result.prepared.body.client_event_id);
});

test("prepared 본문은 얼려 있어 바꿀 수 없다", () => {
  const result = sync().prepare({ action: "input", zone: "TA", object: "test-dial", answer: "a" });
  assert.ok(result.ok);
  assert.throws(() => {
    (result.prepared.body as { zone_id: string }).zone_id = "ZONE_OTHER";
  }, TypeError);
});

test("onSent 는 서버가 상호작용을 받았을 때만 — 동행의 「마지막 상호작용 뒤 멈춘 시간」 기준점(미르 11/11)", async () => {
  let sent = 0;
  const onSent = () => {
    sent += 1;
  };
  serve(() => ({ status: 200, body: okResponse() }));
  await sync({ onSent }).submit({ action: "complete", zone: "TA", object: "test-lever" });
  assert.equal(sent, 1);
  serve(() => ({ status: 409, body: { detail: "Zone is not current." } }));
  await sync({ onSent }).submit({ action: "complete", zone: "TA", object: "test-lever" });
  serve(() => ({ status: 200, body: { nope: true } }));
  await sync({ onSent }).submit({ action: "complete", zone: "TA", object: "test-lever" });
  assert.equal(sent, 1, "거절 · 이상한 응답은 받은 것이 아니다");
});

// ── 오류 구분 ──

test("409: detail 문자열로 이유를 고르고 다시 보내지 않는다", async () => {
  const cases: [unknown, string][] = [
    [{ detail: "Required puzzles are not completed.", missing_puzzle_count: 2 }, "required-puzzles"],
    [{ detail: "Required clues are not acquired.", missing_clue_count: 1 }, "required-clues"],
    [{ detail: "Zone is not current." }, "zone-not-current"],
    [{ detail: "Current zone is unknown." }, "current-zone-unknown"],
    [{ detail: "Navigation is unavailable." }, "navigation-unavailable"],
    [{ detail: "Interaction action does not match the puzzle solve mode." }, "solve-mode-mismatch"],
    [{ detail: "Client event ID conflicts with a previous interaction." }, "idempotency-conflict"],
    [{ detail: "CASE_VERSION_UNAVAILABLE" }, "case-version-unavailable"],
    [{ detail: "Something new." }, "other"],
  ];
  for (const [body, reason] of cases) {
    calls = [];
    serve(() => ({ status: 409, body }));
    const outcome = await sync().submit({ action: "complete", zone: "TA", object: "test-lever" });
    assert.equal(outcome.kind, "conflict");
    assert.equal(outcome.kind === "conflict" && outcome.reason, reason);
    assert.equal(calls.length, 1);
  }
});

test("404 세션 없음은 session-missing, 그 밖 404 · 422 · 500 · 501 은 rejected(재시도 없음)", async () => {
  serve(() => ({ status: 404, body: { detail: "Play session not found." } }));
  assert.deepEqual(await sync().submit({ action: "complete", zone: "TA", object: "test-lever" }), {
    kind: "session-missing",
  });
  for (const [status, detail] of [
    [404, "Object not found."],
    [422, [{ loc: ["body"], msg: "x" }]],
    [500, "Case content is unavailable."],
    [501, "Interaction action 'x' is not implemented."],
  ] as const) {
    calls = [];
    serve(() => ({ status, body: { detail } }));
    const outcome = await sync().submit({ action: "complete", zone: "TA", object: "test-lever" });
    assert.equal(outcome.kind, "rejected");
    assert.equal(outcome.kind === "rejected" && outcome.status, status);
    assert.equal(calls.length, 1);
  }
});

test("200 이지만 약속한 모양이 아니면 invalid-response", async () => {
  serve(() => ({ status: 200, body: { result_type: "ok" } }));
  const outcome = await sync().submit({ action: "complete", zone: "TA", object: "test-lever" });
  assert.equal(outcome.kind, "invalid-response");
});

// ── 미매핑 차단 ──

test("대응이 없는 로컬 ID 는 보내지 않고 진단만 남긴다", async () => {
  serve(() => ({ status: 200, body: okResponse() }));
  const reports: UnmappedReport[] = [];
  const s = sync({ onUnmapped: (report) => reports.push(report) });
  const unmappedObject = await s.submit({ action: "complete", zone: "TA", object: "test-unknown" });
  const unmappedZone = await s.submit({ action: "navigate", fromZone: "TA", toZone: "TZ" });
  assert.deepEqual(unmappedObject, { ok: false, reason: "unmapped", kind: "object", localId: "test-unknown" });
  assert.deepEqual(unmappedZone, { ok: false, reason: "unmapped", kind: "zone", localId: "TZ" });
  assert.equal(calls.length, 0);
  assert.deepEqual(reports, [
    { localId: "test-unknown", kind: "object", action: "complete", caseId: "test-case", contentVersion: 7, at: NOW },
    { localId: "TZ", kind: "zone", action: "navigate", caseId: "test-case", contentVersion: 7, at: NOW },
  ]);
});

test("대응표: 빈 값 · 중복 런타임 ID 는 만들 때 멈추고, 받은 런타임 ID 는 로컬로 되돌린다", () => {
  assert.throws(() => createProgressIdMap({ zones: { TA: "" }, objects: {} }));
  assert.throws(() => createProgressIdMap({ zones: {}, objects: { a: "OBJ_X", b: "OBJ_X" } }));
  assert.equal(IDS.toLocal("object", "OBJ_TEST_DIAL"), "test-dial");
  assert.equal(IDS.toLocal("zone", "ZONE_NOPE"), null);
});

// ── 세션 ──

test("세션이 준비되지 않았으면 보내지 않는다(세션을 만들지 않는다)", async () => {
  serve(() => ({ status: 200, body: okResponse() }));
  for (const status of [
    { phase: "off", reason: "not-configured" },
    { phase: "starting" },
    { phase: "unavailable", reason: "server-unreachable" },
  ] as CompanionSessionStatus[]) {
    const outcome = await sync({ getSession: () => status }).submit({ action: "complete", zone: "TA", object: "test-lever" });
    assert.deepEqual(outcome, { kind: "not-sent", reason: "session-not-ready" });
  }
  assert.equal(calls.length, 0);
});

test("동행 NPC 세션을 그대로 쓴다 — 게스트 쿠키만 먼저 받고 플레이 세션은 새로 만들지 않는다", async () => {
  const data: Record<string, string> = {
    [SESSION_STORAGE_KEY]: JSON.stringify({
      anonymousSessionId: "44444444-4444-4444-8444-444444444444",
      playSessionId: PLAY_ID,
      caseId: "test-case",
      contentVersion: 7,
    }),
  };
  const storage: KeyValueStore = {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => void (data[key] = value),
    removeItem: (key) => void delete data[key],
  };
  serve((call) =>
    call.method === "GET"
      ? { status: 200, body: { data: { play_session_id: PLAY_ID, case_id: "test-case", state: { hint_levels: {} } } } }
      : call.path === "/api/v1/anonymous-sessions"
        ? { status: 201, body: { data: { anonymous_session_id: "44444444-4444-4444-8444-444444444444" } } }
        : { status: 200, body: okResponse() },
  );
  const session = createCompanionSession({ config: { caseId: "test-case", contentVersion: 7 }, storage });
  await session.start();
  const s = sync({ getSession: session.getStatus });
  await s.submit({ action: "navigate", fromZone: "TA", toZone: "TB" });
  await s.submit({ action: "complete", zone: "TB", object: "test-lever" });
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.path}`),
    ["POST /api/v1/anonymous-sessions", `GET /api/v1/play-sessions/${PLAY_ID}`, `POST ${INTERACTIONS}`, `POST ${INTERACTIONS}`],
  );
});

// ── state_changes ──

test("state_changes: 아는 13종만 onStateChanges 로 넘기고 모르는 종류는 따로 돌려준다", async () => {
  const known: InteractionStateChange[] = [
    { type: "puzzle_completed", puzzle_id: "PZ_TEST" },
    { type: "current_zone_changed", zone_id: "ZONE_TEST_B" },
    { type: "hint_level_changed", puzzle_id: "PZ_TEST", hint_level: 1 },
    { type: "flag_updated", flag: "test-flag", value: true },
    { type: "object_unlocked", zone_id: "ZONE_TEST_B", object_id: "OBJ_TEST_DIAL" },
    { type: "case_completed" },
    { type: "scene_cleared", scene_id: "SCENE_TEST" },
  ];
  const strange = [{ type: "future_change", foo: 1 }, { type: "puzzle_completed" }, "x"];
  serve(() => ({ status: 200, body: okResponse({ result_type: "correct", state_changes: [...known, ...strange] }) }));
  const seen: InteractionStateChange[][] = [];
  const outcome = await sync({ onStateChanges: (changes) => seen.push(changes) }).submit({
    action: "complete",
    zone: "TB",
    object: "test-lever",
  });
  assert.equal(outcome.kind, "sent");
  assert.ok(outcome.kind === "sent");
  assert.deepEqual(outcome.response.state_changes, known);
  assert.deepEqual(outcome.unknownStateChanges, strange);
  assert.deepEqual(seen, [known]);
});

test("state_changes 가 비면 onStateChanges 를 부르지 않는다", async () => {
  serve(() => ({ status: 200, body: okResponse() }));
  let count = 0;
  await sync({ onStateChanges: () => (count += 1) }).submit({ action: "navigate", fromZone: "TA", toZone: "TB" });
  assert.equal(count, 0);
  assert.equal(isKnownStateChange({ type: "hint_level_changed", puzzle_id: "P", hint_level: 1.5 }), false);
});

// ── 상태 변화 중복 방지 — (Play Session, interaction_id) 를 한 번만 넘긴다 ──

const COMPLETED: InteractionStateChange[] = [{ type: "puzzle_completed", puzzle_id: "PZ_TEST" }];
const changed = (interactionId: string) => okResponse({ interaction_id: interactionId, result_type: "correct", state_changes: COMPLETED });
const LEVER = { action: "complete", zone: "TA", object: "test-lever" } as const;

function counting(patch: Partial<ProgressSyncOptions> = {}) {
  const seen: InteractionStateChange[][] = [];
  const s = sync({ onStateChanges: (list) => seen.push(list), ...patch });
  return { s, seen };
}

function prepared(s: ReturnType<typeof sync>) {
  const result = s.prepare(LEVER);
  assert.ok(result.ok);
  return result.prepared;
}

const deliveryOf = (outcome: unknown) => (outcome as { delivery?: { status: string } }).delivery?.status;

test("중복 1: 같은 prepared 를 두 번 보내면 상태 변화는 한 번만 넘기고, 응답은 두 번 다 돌려준다", async () => {
  serve(() => ({ status: 200, body: changed("int-1") }));
  const { s, seen } = counting();
  const p = prepared(s);
  const first = await s.send(p);
  const second = await s.send(p);
  assert.equal(deliveryOf(first), "delivered");
  assert.equal(deliveryOf(second), "duplicate");
  assert.equal(seen.length, 1);
  assert.ok(second.kind === "sent");
  assert.deepEqual(second.response.state_changes, COMPLETED);
  assert.equal(new Set(calls.map((call) => call.raw)).size, 1);
});

test("중복 2: 다른 prepared 라도 서버가 같은 interaction_id 를 돌려주면 다시 넘기지 않는다", async () => {
  serve(() => ({ status: 200, body: changed("int-same") }));
  const { s, seen } = counting();
  assert.equal(deliveryOf(await s.submit(LEVER)), "delivered");
  assert.equal(deliveryOf(await s.submit(LEVER)), "duplicate");
  assert.equal(seen.length, 1);
});

test("중복 3: 서로 다른 Interaction 은 각각 넘긴다", async () => {
  let n = 0;
  serve(() => ({ status: 200, body: changed(`int-${++n}`) }));
  const { s, seen } = counting();
  assert.equal(deliveryOf(await s.submit(LEVER)), "delivered");
  assert.equal(deliveryOf(await s.submit({ action: "input", zone: "TB", object: "test-dial", answer: "a" })), "delivered");
  assert.equal(seen.length, 2);
});

test("중복 4: 네트워크 재시도는 같은 이벤트 ID · 본문이고, 상태 변화는 한 번만 넘긴다", async () => {
  serveSequence(["network", { status: 504 }, { status: 200, body: changed("int-retry") }]);
  const { s, seen } = counting();
  const p = prepared(s);
  assert.equal(deliveryOf(await s.send(p)), "delivered");
  serve(() => ({ status: 200, body: changed("int-retry") }));
  assert.equal(deliveryOf(await s.send(p)), "duplicate");
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls.map((call) => call.body?.client_event_id)).size, 1);
  assert.equal(new Set(calls.map((call) => call.raw)).size, 1);
  assert.equal(seen.length, 1);
});

test("중복 5: 다른 Play Session 의 같은 interaction_id 는 섞이지 않는다", async () => {
  const OTHER = "22222222-2222-4222-8222-222222222222";
  let current: CompanionSessionStatus = READY;
  serve(() => ({ status: 200, body: changed("int-shared") }));
  const { s, seen } = counting({ getSession: () => current });
  assert.equal(deliveryOf(await s.submit(LEVER)), "delivered");
  current = { ...READY, playSessionId: OTHER };
  assert.equal(deliveryOf(await s.submit(LEVER)), "delivered");
  assert.equal(seen.length, 2);
  assert.deepEqual(
    calls.map((call) => call.path),
    [INTERACTIONS, `/api/v1/play-sessions/${OTHER}/interactions`],
  );
});

test("중복 6: 세션이 바뀐 뒤 새 이벤트는 넘기고, 이전 세션 기록은 새 세션을 막지 않는다", async () => {
  const NEW = "33333333-3333-4333-8333-333333333334";
  let current: CompanionSessionStatus = READY;
  let n = 0;
  serve(() => ({ status: 200, body: changed(`int-${++n}`) }));
  const { s, seen } = counting({ getSession: () => current });
  const old = prepared(s);
  assert.equal(deliveryOf(await s.send(old)), "delivered"); // int-1 @ 옛 세션
  current = { ...READY, playSessionId: NEW };
  assert.equal(deliveryOf(await s.submit(LEVER)), "delivered"); // int-2 @ 새 세션
  // 옛 세션으로 돌아가 같은 interaction_id 를 다시 받으면 여전히 중복이다
  current = READY;
  serve(() => ({ status: 200, body: changed("int-1") }));
  assert.equal(deliveryOf(await s.send(old)), "duplicate");
  assert.equal(seen.length, 2);
});

test("중복 7: 오류 · 모양이 어긋난 응답은 넘긴 것으로 기록하지 않아 정상 재시도가 넘긴다", async () => {
  const { s, seen } = counting();
  const p = prepared(s);
  serve(() => ({ status: 503 }));
  assert.equal((await s.send(p)).kind, "unreachable");
  serve(() => ({ status: 409, body: { detail: "Zone is not current." } }));
  assert.equal((await s.send(p)).kind, "conflict");
  serve(() => ({ status: 200, body: { interaction_id: "int-ok", state_changes: COMPLETED } }));
  assert.equal((await s.send(p)).kind, "invalid-response");
  assert.equal(seen.length, 0);
  serve(() => ({ status: 200, body: changed("int-ok") }));
  assert.equal(deliveryOf(await s.send(p)), "delivered");
  assert.equal(seen.length, 1);
});

test("중복 8: onStateChanges 가 던지면 sent 로 돌려주되 기록하지 않아, 다시 보내면 다시 넘긴다", async () => {
  serve(() => ({ status: 200, body: changed("int-throw") }));
  let attempts = 0;
  const applied: InteractionStateChange[][] = [];
  const s = sync({
    onStateChanges: (list) => {
      attempts += 1;
      if (attempts === 1) throw new Error("화면 반영 실패");
      applied.push(list);
    },
  });
  const p = prepared(s);
  const first = await s.send(p);
  assert.equal(first.kind, "sent");
  assert.equal(deliveryOf(first), "handler-failed");
  assert.ok(first.kind === "sent" && first.delivery.status === "handler-failed" && first.delivery.error instanceof Error);
  assert.equal(deliveryOf(await s.send(p)), "delivered");
  assert.equal(deliveryOf(await s.send(p)), "duplicate");
  assert.equal(attempts, 2);
  assert.deepEqual(applied, [COMPLETED]);
});

test("중복 9: 기록은 한도까지만 남고(오래된 것부터 잊음), clearDeliveryHistory 로 비울 수 있다", async () => {
  let id = "";
  serve(() => ({ status: 200, body: changed(id) }));
  const { s, seen } = counting({ deliveryHistoryLimit: 2 });
  for (const next of ["int-a", "int-b", "int-c"]) {
    id = next;
    assert.equal(deliveryOf(await s.submit(LEVER)), "delivered");
  }
  id = "int-c";
  assert.equal(deliveryOf(await s.submit(LEVER)), "duplicate");
  id = "int-a"; // 한도 2 를 넘어 잊혔다
  assert.equal(deliveryOf(await s.submit(LEVER)), "delivered");
  s.clearDeliveryHistory();
  id = "int-a";
  assert.equal(deliveryOf(await s.submit(LEVER)), "delivered");
  assert.equal(seen.length, 5);
});

test("중복: 상태 변화가 없거나 콜백이 없으면 none — 기록하지 않는다", async () => {
  serve(() => ({ status: 200, body: okResponse() }));
  assert.equal(deliveryOf(await counting().s.submit(LEVER)), "none");
  serve(() => ({ status: 200, body: changed("int-nocb") }));
  assert.equal(deliveryOf(await sync().submit(LEVER)), "none");
});
