// 동행 서버 대화 ↔ 대화창 다리(dialogue/companionBridge) · 에셋 전 세션 기다림(app/sessionGate).
// 세진 님 세션 · 대화(companion/)를 가짜 fetch 로 그대로 돌리고, 대화창은 실제 저장소 · director 를 쓴다.
//   node --test naju01/tests/*.test.ts
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { waitForSessionBeforeAssets } from "../src/app/sessionGate.ts";
import { DIALOG_TEXT, createCompanionDialog } from "../src/companion/companionDialog.ts";
import { createCompanionSession, type KeyValueStore } from "../src/companion/companionSession.ts";
import {
  HINT_PUZZLE_IDS,
  SEND_SITUATION,
  SITUATION_ZONE_IDS,
  STEP_FOCUS_IDS,
  createAutoTurnPlanner,
  createCompanionBridge,
  toSpeech,
} from "../src/dialogue/companionBridge.ts";
import { createDialogueStore, type Speech } from "../src/dialogue/dialogueStore.ts";
import { OPEN_HINT_QUESTION, createDirector } from "../src/dialogue/director.ts";
import { OBJECTIVES, type ObjectiveId } from "../src/dialogue/objectives.ts";

// ── 가짜 백엔드(companion.test.ts 와 같은 모양) ──

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}
type Reply = { status: number; body?: unknown };
type Handler = (call: Call) => Reply;

let calls: Call[] = [];
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  calls = [];
});

function serve(handler: Handler) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : null;
    const call: Call = { method: init?.method ?? "GET", path: String(input), body: raw ? JSON.parse(raw) : null };
    calls.push(call);
    const reply = handler(call);
    return new Response(JSON.stringify(reply.body ?? null), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

const memoryStore = (): KeyValueStore => {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
};

const PLAY_ID = "11111111-1111-4111-8111-111111111111";
const turn = (patch: Record<string, unknown> = {}) => ({
  npc_event_id: "22222222-2222-4222-8222-222222222222",
  reply: null,
  suggest_hint: null,
  fallback_reason: null,
  content_mode: "case",
  ...patch,
});
const hintResponse = (level: 1 | 2, puzzleId = "PUZZLE_ANGAM_01") => ({
  interaction_id: "i-1",
  result: { result_type: "hint_unlocked", puzzle_id: puzzleId, hint_level: level, hint_balance: 2, help_used: 1 },
  hint: { level, text: `<힌트 ${level} 자리>` },
});

function backend(routes: { turn?: Handler; hint?: Handler } = {}): Handler {
  return (call) => {
    if (call.path === "/api/v1/anonymous-sessions") return { status: 201, body: { data: { anonymous_session_id: "anon-1" } } };
    if (call.path === "/api/v1/play-sessions" && call.method === "POST")
      return { status: 201, body: { data: { play_session_id: PLAY_ID, case_id: "naju-angam-01", state: { hint_levels: {} } } } };
    if (call.path.endsWith("/npc/turns")) return routes.turn?.(call) ?? { status: 200, body: turn() };
    if (call.path.endsWith("/hints")) return routes.hint?.(call) ?? { status: 200, body: hintResponse(1) };
    return { status: 500, body: { detail: "unexpected route" } };
  };
}

const TIMING = { noticeMs: 5, lineMinMs: 5, lineMaxMs: 5, hintMinMs: 5, autoMinIntervalMs: 1000 };
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** 세션 · 서버 대화 · 대화창 · director · 다리를 한 벌 세운다. 대화창에 올라간 말은 said 에 모인다 */
async function connected(routes: Parameters<typeof backend>[0] = {}, serverPuzzleIds: Record<string, string> = {}) {
  serve(backend(routes));
  const session = createCompanionSession({ config: { caseId: "naju-angam-01", contentVersion: 1 }, storage: memoryStore() });
  await session.start();
  const dialog = createCompanionDialog({ session, timing: TIMING });
  const store = createDialogueStore({ capacity: 300, setTimer: () => 0, clearTimer: () => {} });
  const director = createDirector({ store, guideOf: () => null, showDraftLines: false });
  const said: Speech[] = [];
  const bridge = createCompanionBridge({
    dialog,
    say: (speech) => {
      said.push(speech);
      store.say(speech);
    },
    askOpenHint: director.askOpenHint,
    serverPuzzleIdOf: (objective) => serverPuzzleIds[objective] ?? null,
  });
  director.setHintProvider(bridge.hintProvider);
  calls = [];
  return { session, dialog, store, director, bridge, said };
}

// ── 서버가 준 말 → 대화창 ──

test("서버 승인 대사는 고치지 않고 대화창에 올리고, reply 가 null 이면 아무것도 띄우지 않는다", async () => {
  let reply: unknown = { source: "approved_line", line_id: "SIT_QUIET_01", text: "<승인 대사>" };
  const { dialog, store, said } = await connected({ turn: () => ({ status: 200, body: turn({ reply }) }) });
  await dialog.autoTurn();
  await tick();
  assert.deepEqual(said, [{ kind: "line", text: "<승인 대사>", lineId: "SIT_QUIET_01", ttlMs: 10_000 }]);
  assert.equal(store.getState()?.speech.text, "<승인 대사>");

  reply = null;
  said.length = 0;
  await dialog.talk("안녕");
  await tick();
  assert.deepEqual(said, [], "무발화는 오류도 말도 아니다");
});

test("서버 오류는 영문 detail 대신 companionDialog 의 한국어 문구(DIALOG_TEXT)로만 올라온다", async () => {
  const { dialog, said } = await connected({
    turn: () => ({ status: 422, body: { detail: [{ msg: "Extra inputs are not permitted" }] } }),
  });
  await dialog.autoTurn();
  await tick();
  assert.deepEqual(said, [{ kind: "notice", text: DIALOG_TEXT.failed }]);
  assert.ok(!said.some((speech) => /Extra inputs/.test(speech.text)));
});

test("힌트 줄은 단계와 다시 보기를 화제로 달아 올린다", () => {
  assert.deepEqual(toSpeech({ kind: "hint", level: 2, text: "<정답>", isReview: true }), {
    kind: "hint",
    text: "<정답>",
    topic: "힌트 2/2 · 다시 보기",
  });
  assert.deepEqual(toSpeech({ kind: "notice", text: DIALOG_TEXT.connection }), {
    kind: "notice",
    text: DIALOG_TEXT.connection,
  });
});

// ── 힌트 제안 → Y/N ──

test("서버가 힌트를 권하면 같이 온 대사 아래 Y/N 으로 묻고, 「네」일 때만 Hint API(hint_ref, level 1)를 부른다", async () => {
  const suggestion = turn({
    reply: { source: "approved_line", line_id: "NUDGE_X", text: "<넛지>" },
    suggest_hint: { hint_ref: "ref-1" },
  });
  const { dialog, store } = await connected({ turn: () => ({ status: 200, body: suggestion }) });
  await dialog.autoTurn();
  await tick();
  const ask = store.getState()!.speech;
  assert.equal(ask.kind, "ask");
  assert.equal(ask.text, `<넛지>\n${OPEN_HINT_QUESTION}`, "대사가 물음에 밀려 사라지지 않게 위에 붙인다");
  assert.equal(ask.lineId, "NUDGE_X");
  assert.equal(calls.filter((c) => c.path.endsWith("/hints")).length, 0, "제안만으로는 열지 않는다");

  store.answer("yes");
  await tick();
  await tick();
  const hint = calls.find((c) => c.path.endsWith("/hints"))!;
  assert.deepEqual([hint.body!.hint_ref, hint.body!.target_level], ["ref-1", 1]);
  assert.equal(store.getState()?.speech.kind, "hint");
  assert.equal(store.getState()?.speech.text, "<힌트 1 자리>");
});

test("「아니요」면 열지 않고, 남은 힌트 수를 알면 물음에 붙인다", async () => {
  const suggestion = turn({ suggest_hint: { hint_ref: "ref-2" } });
  const { dialog, store } = await connected({ turn: () => ({ status: 200, body: suggestion }) });
  await dialog.autoTurn();
  await tick();
  assert.equal(store.getState()!.speech.text, OPEN_HINT_QUESTION);
  store.answer("no");
  await tick();
  assert.equal(calls.filter((c) => c.path.endsWith("/hints")).length, 0);

  // 한 번 연 뒤에는 잔액을 안다 — 다음 제안 물음에 남은 수가 붙는다
  const { director, store: other } = await connected();
  const pending = director.askOpenHint({ lead: null, balance: 2 });
  assert.equal(other.getState()!.speech.text, `${OPEN_HINT_QUESTION} (남은 힌트 2)`);
  other.answer("yes");
  assert.equal(await pending, true);
});

test("[F] 「힌트를 주세요」는 서버 퍼즐 ID 를 알 때만 Hint API(puzzle_id)로 다음 단계를 열고, 모르면 FE 고정 문구 하나다", async () => {
  // 서버 퍼즐 ID 를 모르면 정식 힌트를 열 수 없다
  const bare = await connected();
  assert.equal(bare.bridge.hintProvider.canOpen("P03"), false);

  const { director, store } = await connected(
    {
      hint: (call) => ({
        status: 200,
        body: hintResponse(call.body!.target_level as 1 | 2, call.body!.puzzle_id as string),
      }),
    },
    { P03: "PUZZLE_ANGAM_03" },
  );
  director.help("P03", "힌트를 주세요");
  assert.equal(store.getState()?.speech.kind, "ask", "정식 힌트는 잔액이 줄어 먼저 묻는다");
  store.answer("yes");
  await tick();
  await tick();
  const first = calls.filter((c) => c.path.endsWith("/hints"));
  assert.deepEqual([first[0].body!.puzzle_id, first[0].body!.target_level], ["PUZZLE_ANGAM_03", 1]);
  while (store.advance());
  director.help("P03", "힌트를 더 주세요");
  store.answer("yes");
  await tick();
  await tick();
  const second = calls.filter((c) => c.path.endsWith("/hints"));
  assert.equal(second[1].body!.target_level, 2, "두 번째는 다음 단계(정답)");
});

// ── 나주 ID 대응표 v1.1(docs/naju/나주_ID대응표_v1_1108.md §5) ──

test("대응표 값: 퍼즐은 공식 ID 그대로 Hint API 로, 걸음은 대표 Object 로, 잡담 구역은 Zone ID 로 — 물굴은 잡담 구역이 없다", () => {
  const ids = Object.keys(OBJECTIVES) as ObjectiveId[];
  for (const id of ids) {
    const puzzleId = OBJECTIVES[id].puzzleId;
    if (puzzleId) {
      assert.equal(HINT_PUZZLE_IDS[id], puzzleId, `${id} 힌트 퍼즐 ID`);
      assert.equal(STEP_FOCUS_IDS[id], undefined, `${id} 는 퍼즐 — 서버가 퍼즐로 찾는다`);
    } else {
      assert.match(STEP_FOCUS_IDS[id] ?? "", /^OBJ_S[12]_[A-Z0-9_]+$/, `${id} 대표 Object`);
      assert.equal(HINT_PUZZLE_IDS[id], undefined, `${id} 는 걸음 — 정식 힌트가 없다`);
    }
  }
  assert.equal(new Set(Object.values(STEP_FOCUS_IDS)).size, Object.keys(STEP_FOCUS_IDS).length, "대표 Object 가 겹치지 않는다");
  assert.deepEqual(SITUATION_ZONE_IDS, {
    dock: "ZONE_FERRY_TERRACE",
    rock: "ZONE_GRAVEL_BEACH",
    ridge: "ZONE_JINBU_RIDGE",
  });
});

// ── auto 턴 한 길 ──

test("상황을 싣지 않는 동안은 구역에 들어선 순간에만 상황 없는 auto 턴을 보낸다(첫 구역 · 같은 구역 제외)", () => {
  const planner = createAutoTurnPlanner({ sendSituation: false });
  const stuck = { kind: "stuck", objective: "S2_OFFER", step: 0 } as const;
  assert.equal(planner.next(null, "Z1"), null, "처음 선 구역은 진입이 아니다");
  assert.equal(planner.next(stuck, "Z1"), null, "상황은 보내지 않는다");
  assert.equal(planner.next(null, null), null, "구역 밖(물굴 · 연결로)은 진입이 아니다");
  assert.deepEqual(planner.next(null, "Z2"), { situation: null });
  assert.equal(planner.next(null, "Z2"), null);
});

test("상황을 싣게 되면 생긴 상황 하나를 계약 모양(code · value · zone_id)으로 보내고, 서버 판정 퍼즐의 실수 · 진전 없음은 보내지 않는다", () => {
  const planner = createAutoTurnPlanner({ sendSituation: true, zoneIdOf: (stage) => (stage === "rock" ? "ZONE_ROCK" : null) });
  planner.next(null, "Z1");
  assert.deepEqual(planner.next({ kind: "sentBack", objective: "P09", step: 1 }, "Z1"), {
    situation: { code: "SENT_BACK", value: 2 },
  });
  // 잡담은 FE 구역 이름(zone)이 아니라 대응표의 zone_id 만 싣는다 — 계약에 없는 필드는 보내지 않는다
  const quiet = planner.next({ kind: "chatter", objective: null, step: 0, zone: "rock" }, "Z1")!;
  assert.deepEqual(quiet, { situation: { code: "QUIET", zone_id: "ZONE_ROCK" } });
  assert.deepEqual(planner.next({ kind: "chatter", objective: null, step: 0, zone: "dock" }, "Z1"), {
    situation: { code: "QUIET" },
  });
  // 서버가 판정하는 퍼즐(P03)의 진전 없음은 v0.4.7 퍼즐 자동 개입이 맡는다
  assert.equal(planner.next({ kind: "stuck", objective: "P03", step: 0 }, "Z1"), null);
  assert.deepEqual(planner.next({ kind: "stuck", objective: "S2_OFFER", step: 0 }, "Z1"), {
    situation: { code: "NO_PROGRESS" },
  });
});

test("표시할 수 없는 때(연출 · 창 · 장면 인물 대화 · 동행 물음)의 상황 · 구역 진입은 보내지 않고 버린다 — 나중에 늦게 보내지도 않는다(§11-2)", () => {
  for (const sendSituation of [false, true]) {
    const planner = createAutoTurnPlanner({ sendSituation });
    planner.next(null, "Z1");
    assert.equal(planner.next({ kind: "breath", objective: "P09", step: 0 }, "Z1", false), null);
    assert.equal(planner.next(null, "Z2", false), null, "가려진 동안 들어선 구역");
    assert.equal(planner.next(null, "Z2", true), null, "다시 보이게 돼도 그 진입을 늦게 보내지 않는다");
    assert.deepEqual(planner.next(null, "Z3", true), { situation: null });
  }
});

test("걸음 상황은 그 걸음의 대표 Object 를 focus_object_id 로 싣고, 퍼즐 · 잡담 상황은 싣지 않는다", async () => {
  const planner = createAutoTurnPlanner({ sendSituation: true, focusIdOf: (objective) => STEP_FOCUS_IDS[objective] ?? null });
  planner.next(null, "Z1");
  assert.deepEqual(planner.next({ kind: "arrive", objective: "S1_FIRE", step: 0 }, "Z1"), {
    situation: { code: "STEP_ARRIVED" },
    focusObjectId: "OBJ_S1_BONFIRE_0",
  });
  assert.deepEqual(planner.next({ kind: "breath", objective: "P09", step: 0 }, "Z1"), {
    situation: { code: "BREATH_LOW" },
  });

  // 본문 — focus_object_id 는 계약 §2 의 맨 위 필드, situation 과 함께만
  serve(backend());
  const session = createCompanionSession({ config: { caseId: "naju-angam-01", contentVersion: 1 }, storage: memoryStore() });
  await session.start();
  const dialog = createCompanionDialog({ session, timing: TIMING });
  const bridge = createCompanionBridge({
    dialog,
    say: () => {},
    askOpenHint: async () => false,
    sendSituation: true,
    focusIdOf: (objective) => STEP_FOCUS_IDS[objective] ?? null,
  });
  calls = [];
  bridge.relay({ kind: "stuck", objective: "S2_OFFER", step: 0 }, "Z2");
  await tick();
  const [sent] = calls.filter((c) => c.path.endsWith("/npc/turns"));
  assert.deepEqual(sent.body!.situation, { code: "NO_PROGRESS" });
  assert.equal(sent.body!.focus_object_id, "OBJ_S1_RITUAL_TABLE");
});

test("다리의 auto 턴: 꺼진 동안 본문에 situation 이 없고, 구역 진입은 간격(180초) 안에서 한 번만 간다", async () => {
  let clock = 0;
  serve(backend());
  const session = createCompanionSession({ config: { caseId: "naju-angam-01", contentVersion: 1 }, storage: memoryStore() });
  await session.start();
  const dialog = createCompanionDialog({ session, timing: { ...TIMING, autoMinIntervalMs: 180_000 }, now: () => clock });
  const bridge = createCompanionBridge({ dialog, say: () => {}, askOpenHint: async () => false });
  calls = [];
  bridge.relay(null, "Z1");
  bridge.relay({ kind: "breath", objective: "P09", step: 0 }, "Z1");
  bridge.relay(null, "Z2");
  await tick();
  clock = 10_000;
  bridge.relay(null, "Z3");
  await tick();
  const sent = calls.filter((c) => c.path.endsWith("/npc/turns"));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body!.trigger, "auto");
  assert.equal("situation" in sent[0].body!, false);
});

test("BE 상황 대사(#54)가 운영에 배포될 때까지 SEND_SITUATION 은 꺼 둔다(계약 §11-7)", () => {
  assert.equal(SEND_SITUATION, false);
});

test("백엔드 NpcTurnRequest 가 situation 을 모르고 모르는 필드를 막는 동안은 SEND_SITUATION 이 꺼져 있어야 한다", () => {
  const schema = readFileSync(new URL("../../backend/app/schemas/npc_turn.py", import.meta.url), "utf8");
  const request = schema.slice(schema.indexOf("class NpcTurnRequest"), schema.indexOf("class NpcReplyOut"));
  const isForbidden = /extra="forbid"/.test(request);
  const knowsSituation = /^\s+situation\s*:/m.test(request);
  if (isForbidden && !knowsSituation) assert.equal(SEND_SITUATION, false);
});

test("situation 을 실은 auto 턴은 FE 간격으로 막지 않고(쿨다운은 BE), 같은 본문을 얼려 다시 보낸다", async () => {
  let clock = 0;
  let failures = 1;
  serve(
    backend({
      turn: () => {
        if (failures-- > 0) return { status: 503 };
        return { status: 200, body: turn() };
      },
    }),
  );
  const session = createCompanionSession({ config: { caseId: "naju-angam-01", contentVersion: 1 }, storage: memoryStore() });
  await session.start();
  const dialog = createCompanionDialog({ session, timing: { ...TIMING, autoMinIntervalMs: 180_000 }, now: () => clock });
  calls = [];
  assert.equal(await dialog.autoTurn({ code: "BREATH_LOW", value: 12 }), true);
  clock = 1;
  assert.equal(await dialog.autoTurn({ code: "BREATH_LOW", value: 9 }), true);
  const sent = calls.filter((c) => c.path.endsWith("/npc/turns"));
  // 첫 턴은 503 한 번 뒤 같은 id · 같은 본문으로 다시 갔다(§8-6)
  assert.equal(sent.length, 3);
  assert.deepEqual(sent[0].body, sent[1].body);
  assert.deepEqual(sent[0].body!.situation, { code: "BREATH_LOW", value: 12 });
  assert.notEqual(sent[2].body!.client_event_id, sent[0].body!.client_event_id);
});

// ── 에셋보다 세션 먼저 ──

test("CDN 에셋이면 세션을 최대 2.5초 기다리고, 로컬 에셋이거나 세션이 끝나면 바로 진행한다", async () => {
  const never = new Promise<never>(() => {});
  const order: string[] = [];
  await waitForSessionBeforeAssets(never, { isCdn: false }).then(() => order.push("local"));
  await waitForSessionBeforeAssets(Promise.resolve({ phase: "off" }), { isCdn: true }).then(() => order.push("off"));
  await waitForSessionBeforeAssets(Promise.reject(new Error("x")), { isCdn: true }).then(() => order.push("failed"));
  const startedAt = Date.now();
  await waitForSessionBeforeAssets(never, { isCdn: true, timeoutMs: 30 }).then(() => order.push("timeout"));
  assert.ok(Date.now() - startedAt >= 25);
  assert.deepEqual(order, ["local", "off", "failed", "timeout"]);
});
