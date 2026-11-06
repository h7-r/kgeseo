// 동행 NPC 의 API · 세션 · 대화 상태 — 계약(backend/app/schemas/npc_turn.py · hint.py) 규칙을 가짜 fetch 로 확인한다.
//   node --test naju01/tests/*.test.ts
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  CompanionApiError,
  errorCode,
  isNpcTurnResponse,
  sendFrozen,
} from "../src/companion/companionApi.ts";
import { DIALOG_TEXT, createCompanionDialog } from "../src/companion/companionDialog.ts";
import { SESSION_STORAGE_KEY, createCompanionSession, type KeyValueStore } from "../src/companion/companionSession.ts";

interface Call {
  method: string;
  path: string;
  body: unknown;
  raw: string | null;
  credentials: RequestCredentials | undefined;
}
type Reply = { status: number; body?: unknown } | "network";
type Handler = (call: Call) => Reply;

let calls: Call[] = [];
const realFetch = globalThis.fetch;

function serve(handler: Handler) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : null;
    const call: Call = {
      method: init?.method ?? "GET",
      path: String(input),
      body: raw ? JSON.parse(raw) : null,
      raw,
      credentials: init?.credentials,
    };
    calls.push(call);
    const reply = handler(call);
    if (reply === "network") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(reply.body ?? null), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const PLAY_ID = "11111111-1111-4111-8111-111111111111";
const CONFIG = { caseId: "naju-angam-01", contentVersion: 3 };
const turn = (patch: Record<string, unknown> = {}) => ({
  npc_event_id: "22222222-2222-4222-8222-222222222222",
  reply: null,
  suggest_hint: null,
  fallback_reason: null,
  content_mode: "case",
  ...patch,
});
const hintResponse = (patch: Record<string, unknown> = {}, level: 1 | 2 = 1) => ({
  interaction_id: "i-1",
  result: {
    result_type: "hint_unlocked",
    puzzle_id: "PUZZLE_A",
    hint_level: level,
    hint_balance: 2,
    help_used: 1,
    state: {},
    state_changes: [],
    ...patch,
  },
  hint: { level, text: `<힌트 ${level} 자리>` },
});

/** 세션 만들기 · 복원까지 처리하고, NPC · Hint 는 넘겨받은 처리기로 */
function backend(routes: { turn?: Handler; hint?: Handler } = {}): Handler {
  return (call) => {
    if (call.path === "/api/v1/anonymous-sessions") return { status: 201, body: { data: { anonymous_session_id: "anon-1" } } };
    if (call.path === "/api/v1/play-sessions" && call.method === "POST")
      return { status: 201, body: { data: { play_session_id: PLAY_ID, case_id: CONFIG.caseId, state: { hint_levels: {} } } } };
    if (call.path.endsWith("/npc/turns")) return routes.turn?.(call) ?? { status: 200, body: turn() };
    if (call.path.endsWith("/hints")) return routes.hint?.(call) ?? { status: 200, body: hintResponse() };
    return { status: 500, body: { detail: "unexpected route" } };
  };
}

const FAST = { retryDelayMs: 1 };
const TIMING = { noticeMs: 5, lineMinMs: 5, lineMaxMs: 5, hintMinMs: 5, autoMinIntervalMs: 1000 };

async function readyDialog(routes: Parameters<typeof backend>[0] = {}, now = () => Date.now()) {
  serve(backend(routes));
  const session = createCompanionSession({ config: CONFIG, storage: memoryStore() });
  await session.start();
  const logs: string[] = [];
  const dialog = createCompanionDialog({ session, timing: TIMING, now, log: (level, message) => logs.push(`${level}:${message}`) });
  calls = [];
  return { session, dialog, logs };
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ── API ──

test("네트워크 오류는 같은 client_event_id · 같은 본문으로 최대 2번 다시 보낸다", async () => {
  let attempts = 0;
  serve(() => (++attempts < 3 ? "network" : { status: 200, body: { ok: true } }));
  const body = { client_event_id: "33333333-3333-4333-8333-333333333333", trigger: "auto" };
  await sendFrozen("/x", body, FAST);
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((c) => c.raw)).size, 1);
});

test("운영에서 출처가 달라도 세션 소유권을 확인하도록 모든 요청에 쿠키를 싣는다(재전송 포함)", async () => {
  let attempts = 0;
  serve(() => (++attempts < 2 ? "network" : { status: 200, body: { ok: true } }));
  await sendFrozen("/x", { client_event_id: "44444444-4444-4444-8444-444444444444", trigger: "auto" }, FAST);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.credentials === "include"));
});

test("500 · 409 · 422 는 다시 보내지 않고, 502 는 재시도가 다하면 실패한다", async () => {
  for (const status of [500, 409, 422]) {
    calls = [];
    serve(() => ({ status, body: { detail: "x" } }));
    await assert.rejects(sendFrozen("/x", {}, FAST), CompanionApiError);
    assert.equal(calls.length, 1, String(status));
  }
  calls = [];
  serve(() => ({ status: 502, body: null }));
  await assert.rejects(sendFrozen("/x", {}, FAST), (e: unknown) => e instanceof CompanionApiError && e.status === 502);
  assert.equal(calls.length, 3);
});

test("errorCode 는 문자열 detail · { code } 를 읽고 422 배열은 null 이다", () => {
  assert.equal(errorCode(new CompanionApiError(409, "CASE_VERSION_UNAVAILABLE", null)), "CASE_VERSION_UNAVAILABLE");
  assert.equal(errorCode(new CompanionApiError(409, { code: "HINT_BALANCE_EMPTY", message: "m" }, null)), "HINT_BALANCE_EMPTY");
  assert.equal(errorCode(new CompanionApiError(422, [{ loc: ["body"], msg: "m" }], null)), null);
});

test("content_mode 가 없는 응답은 계약 위반이다(기본값으로 채우지 않는다)", () => {
  assert.equal(isNpcTurnResponse(turn()), true);
  const { content_mode: _omit, ...missing } = turn();
  assert.equal(isNpcTurnResponse(missing), false);
  assert.equal(isNpcTurnResponse(turn({ reply: { source: "approved_line", text: "" } })), false);
});

// ── 세션 ──

test("케이스 · 버전이 없으면 세션을 만들지 않는다(서버 호출 없음)", async () => {
  serve(() => ({ status: 500 }));
  const session = createCompanionSession({ config: null });
  assert.equal((await session.start()).phase, "off");
  assert.equal(calls.length, 0);
});

test("content_version 을 고정한 세션을 만들고 기록한다", async () => {
  serve(backend());
  const storage = memoryStore();
  const status = await createCompanionSession({ config: CONFIG, storage }).start();
  assert.equal(status.phase, "ready");
  const create = calls.find((c) => c.path === "/api/v1/play-sessions");
  assert.deepEqual(create?.body, { anonymous_session_id: "anon-1", case_id: CONFIG.caseId, content_version: 3 });
  assert.equal(JSON.parse(storage.data[SESSION_STORAGE_KEY]).playSessionId, PLAY_ID);
});

test("세션을 만들 때와 되살릴 때 서버가 준 에셋 경로를 넘기고, 없으면 경고만 남긴다", async () => {
  const PATH = "/c/naju-angam-01/v3";
  const withPath = (body: { status: number; body?: unknown }) => {
    const data = (body.body as { data: Record<string, unknown> }).data;
    return { ...body, body: { data: { ...data, asset_base_path: PATH } } };
  };

  // 새로 만들 때
  const base = backend();
  serve((call) => (call.path === "/api/v1/play-sessions" && call.method === "POST" ? withPath(base(call) as never) : base(call)));
  const created: string[] = [];
  await createCompanionSession({ config: CONFIG, storage: memoryStore(), onAssetBasePath: (path) => created.push(path) }).start();
  assert.deepEqual(created, [PATH]);

  // 저장된 세션을 되살릴 때
  const record = JSON.stringify({ anonymousSessionId: "anon-1", playSessionId: "old", ...CONFIG });
  serve(() => ({
    status: 200,
    body: { data: { play_session_id: "old", case_id: CONFIG.caseId, state: { hint_levels: {} }, asset_base_path: PATH } },
  }));
  const restored: string[] = [];
  await createCompanionSession({
    config: CONFIG,
    storage: memoryStore({ [SESSION_STORAGE_KEY]: record }),
    onAssetBasePath: (path) => restored.push(path),
  }).start();
  assert.deepEqual(restored, [PATH]);

  // 서버가 아직 경로를 주지 않으면 지금 경로를 건드리지 않고 경고만
  serve(backend());
  const untouched: string[] = [];
  const logs: string[] = [];
  const status = await createCompanionSession({
    config: CONFIG,
    storage: memoryStore(),
    onAssetBasePath: (path) => untouched.push(path),
    log: (message) => logs.push(message),
  }).start();
  assert.equal(status.phase, "ready");
  assert.deepEqual(untouched, []);
  assert.ok(logs.some((message) => message.includes("asset_base_path")));
});

test("저장된 세션은 GET 으로 이어 쓰고, 404 면 새로 만든다", async () => {
  const record = JSON.stringify({ anonymousSessionId: "anon-1", playSessionId: "old", ...CONFIG });
  serve((call) =>
    call.method === "GET"
      ? { status: 200, body: { data: { play_session_id: "old", case_id: CONFIG.caseId, state: { hint_levels: { P: 1 } } } } }
      : { status: 500 },
  );
  const restored = await createCompanionSession({ config: CONFIG, storage: memoryStore({ [SESSION_STORAGE_KEY]: record }) }).start();
  assert.equal(restored.phase === "ready" && restored.playSessionId, "old");
  assert.deepEqual(restored.phase === "ready" && restored.hintLevels, { P: 1 });

  calls = [];
  const base = backend();
  serve((call) => (call.method === "GET" ? { status: 404, body: { detail: "Play session not found." } } : base(call)));
  const fresh = await createCompanionSession({ config: CONFIG, storage: memoryStore({ [SESSION_STORAGE_KEY]: record }) }).start();
  assert.equal(fresh.phase === "ready" && fresh.playSessionId, PLAY_ID);
});

test("버전이 다른 옛 기록은 쓰지 않고, 409 CASE_VERSION_UNAVAILABLE 이면 비활성이다", async () => {
  const old = JSON.stringify({ anonymousSessionId: "anon-1", playSessionId: "old", caseId: CONFIG.caseId, contentVersion: 1 });
  serve((call) =>
    call.path === "/api/v1/play-sessions" ? { status: 409, body: { detail: "CASE_VERSION_UNAVAILABLE" } } : backend()(call),
  );
  const status = await createCompanionSession({ config: CONFIG, storage: memoryStore({ [SESSION_STORAGE_KEY]: old }) }).start();
  assert.deepEqual(status, { phase: "unavailable", reason: "case-version-unavailable" });
  assert.equal(calls.some((c) => c.method === "GET"), false);
});

// ── 대화 ──

test("승인 대사(reply)는 그대로 띄우고, 요청은 player_message · UUID · 시간대 포함이다", async () => {
  const { dialog } = await readyDialog({
    turn: () => ({ status: 200, body: turn({ reply: { source: "approved_line", text: "<승인 원문 자리>", line_id: "NUDGE_A" } }) }),
  });
  await dialog.talk();
  const sent = calls[0].body as Record<string, string>;
  assert.equal(sent.trigger, "player_message");
  assert.match(sent.client_event_id, /^[0-9a-f-]{36}$/);
  assert.match(sent.client_timestamp, /Z$/);
  assert.equal("focus_object_id" in sent, false);
  assert.deepEqual(dialog.getState().line, { kind: "npc", text: "<승인 원문 자리>", lineId: "NUDGE_A" });
  assert.equal(dialog.getState().contentMode, "case");
});

test("reply 가 null 이면 아무것도 띄우지 않는다(오류 아님)", async () => {
  const { dialog, logs } = await readyDialog();
  await dialog.talk();
  assert.equal(dialog.getState().line, null);
  assert.equal(dialog.getState().waiting, null);
  assert.deepEqual(logs, []);
});

test("suggest_hint 는 제안일 뿐 — 수락할 때만 Hint API(hint_ref, level 1), 그다음은 puzzle_id 로 level 2", async () => {
  const { dialog, session } = await readyDialog({
    turn: () => ({ status: 200, body: turn({ suggest_hint: { hint_ref: "hr1.k1.abc" }, fallback_reason: "NPC_GENERIC_PACK_MISSING" }) }),
  });
  await dialog.talk();
  assert.equal(calls.filter((c) => c.path.endsWith("/hints")).length, 0);
  assert.deepEqual(dialog.getState().offer, { via: "ref", hintRef: "hr1.k1.abc", level: 1 });

  await dialog.acceptOffer();
  const hint = calls.find((c) => c.path.endsWith("/hints"))?.body as Record<string, unknown>;
  assert.equal(hint.hint_ref, "hr1.k1.abc");
  assert.equal(hint.target_level, 1);
  assert.equal("puzzle_id" in hint, false);
  const state = dialog.getState();
  assert.deepEqual(state.line, { kind: "hint", level: 1, text: "<힌트 1 자리>", isReview: false });
  assert.equal(state.hintBalance, 2);
  assert.deepEqual(state.offer, { via: "puzzle", puzzleId: "PUZZLE_A", level: 2 });
  const status = session.getStatus();
  assert.deepEqual(status.phase === "ready" && status.hintLevels, { PUZZLE_A: 1 });
});

test("generic(긴급 중단)이면 NPC 제안은 숨기고 정식 힌트(puzzle_id)는 남긴다", async () => {
  let mode = "case";
  const { dialog } = await readyDialog({
    turn: () => ({
      status: 200,
      body:
        mode === "case"
          ? turn({ suggest_hint: { hint_ref: "hr1.k1.abc" } })
          : turn({ content_mode: "generic", fallback_reason: "NPC_CONTENT_WITHDRAWN", suggest_hint: { hint_ref: "hr1.k1.zzz" } }),
    }),
  });
  await dialog.talk();
  mode = "generic";
  await dialog.talk();
  assert.equal(dialog.getState().offer, null, "NPC 제안 숨김");
  assert.equal(dialog.getState().fallbackReason, "NPC_CONTENT_WITHDRAWN");

  mode = "case";
  await dialog.talk();
  await dialog.acceptOffer();
  mode = "generic";
  await dialog.talk();
  assert.deepEqual(dialog.getState().offer, { via: "puzzle", puzzleId: "PUZZLE_A", level: 2 }, "정식 힌트 유지");
  await dialog.acceptOffer();
  const last = calls.filter((c) => c.path.endsWith("/hints")).at(-1)?.body as Record<string, unknown>;
  assert.equal(last.puzzle_id, "PUZZLE_A");
  assert.equal(last.target_level, 2);
});

test("이미 연 힌트는 already_unlocked — 다시 보기로 띄우고 잔액은 응답 값 그대로다", async () => {
  const { dialog } = await readyDialog({
    turn: () => ({ status: 200, body: turn({ suggest_hint: { hint_ref: "hr1.k1.abc" } }) }),
    hint: () => ({ status: 200, body: hintResponse({ result_type: "already_unlocked", hint_balance: 3 }) }),
  });
  await dialog.talk();
  await dialog.acceptOffer();
  const line = dialog.getState().line;
  assert.equal(line?.kind === "hint" && line.isReview, true);
  assert.equal(dialog.getState().hintBalance, 3);
});

test("힌트 오류는 코드별 한국어 문구만 — 잔액 없음 · 참조 불일치 · 아직 못 엶", async () => {
  const cases: [number, unknown, string][] = [
    [409, { code: "HINT_BALANCE_EMPTY", message: "Hint balance is empty.", minigames_left: 0 }, DIALOG_TEXT.balanceEmpty],
    [409, { code: "HINT_REF_MISMATCH", message: "Hint reference does not match this play session." }, DIALOG_TEXT.hintUnavailable],
    [503, { code: "HINT_REF_UNAVAILABLE", message: "Hint reference cannot be verified." }, DIALOG_TEXT.hintUnavailable],
    [404, "Puzzle not found.", DIALOG_TEXT.hintUnavailable],
    [409, "Previous hint level is not unlocked.", DIALOG_TEXT.hintNotYet],
  ];
  for (const [status, detail, expected] of cases) {
    const { dialog } = await readyDialog({
      turn: () => ({ status: 200, body: turn({ suggest_hint: { hint_ref: "hr1.k1.abc" } }) }),
      hint: () => ({ status, body: { detail } }),
    });
    await dialog.talk();
    await dialog.acceptOffer();
    assert.equal(calls.filter((c) => c.path.endsWith("/hints")).length, 1, "코드가 실린 오류는 다시 보내지 않는다");
    const line = dialog.getState().line;
    assert.deepEqual(line, { kind: "notice", text: expected }, JSON.stringify(detail));
    assert.equal(dialog.getState().offer, null);
    assert.doesNotMatch(line?.text ?? "", /[A-Za-z]{3,}/, "영문 노출 없음");
  }
});

test("NPC 409 CASE_VERSION_UNAVAILABLE · 500 은 동행 대화를 끈다(게임은 계속)", async () => {
  for (const [status, detail] of [
    [409, "CASE_VERSION_UNAVAILABLE"],
    [500, "NPC content is unavailable."],
  ] as const) {
    const { dialog, session } = await readyDialog({ turn: () => ({ status, body: { detail } }) });
    await dialog.talk();
    assert.equal(session.getStatus().phase, "unavailable");
    assert.equal(dialog.getState().isEnabled, false);
    assert.deepEqual(dialog.getState().line, { kind: "notice", text: DIALOG_TEXT.unavailable });
    assert.equal(await dialog.talk(), false, "꺼진 뒤에는 보내지 않는다");
  }
});

test("client_event_id 충돌(409)은 새 id 로 다시 보내지 않고 버그로만 기록한다", async () => {
  const { dialog, logs } = await readyDialog({
    turn: () => ({ status: 409, body: { detail: "Client event ID conflicts with a previous interaction." } }),
  });
  await dialog.talk();
  assert.equal(calls.length, 1);
  assert.equal(dialog.getState().line, null);
  assert.ok(logs.some((line) => line.startsWith("error:")));
});

test("세션이 없어졌으면(404) 새 세션을 만들고 다시 말을 걸게 한다", async () => {
  let gone = true;
  const { dialog } = await readyDialog({
    turn: () => (gone ? { status: 404, body: { detail: "Play session not found." } } : { status: 200, body: turn() }),
  });
  await dialog.talk();
  assert.deepEqual(dialog.getState().line, { kind: "notice", text: DIALOG_TEXT.sessionRenewed });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(calls.some((c) => c.path === "/api/v1/play-sessions" && c.method === "POST"));
  gone = false;
  assert.equal(await dialog.talk(), true);
});

test("auto 턴은 message 없이 보내고, 간격 안에서는 다시 보내지 않는다", async () => {
  let clock = 0;
  const { dialog } = await readyDialog({}, () => clock);
  clock = 5000;
  assert.equal(await dialog.autoTurn(), true);
  const sent = calls[0].body as Record<string, unknown>;
  assert.equal(sent.trigger, "auto");
  assert.equal("message" in sent, false);
  clock = 5500;
  assert.equal(await dialog.autoTurn(), false);
  clock = 6100;
  assert.equal(await dialog.autoTurn(), true);
});

test("빈 말 · 대기 중 중복은 보내지 않는다", async () => {
  const { dialog } = await readyDialog();
  assert.equal(await dialog.talk("   "), false);
  const first = dialog.talk("안녕");
  assert.equal(await dialog.talk("또"), false);
  await first;
  assert.equal(calls.length, 1);
});
