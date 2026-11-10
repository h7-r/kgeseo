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
  HINTED_PUZZLES,
  HINT_PUZZLE_IDS,
  OFFER_POLL_PAUSE_MS,
  POLL_MAX_PER_PUZZLE,
  PUZZLE_FOCUS_IDS,
  PUZZLE_POLL_MS,
  SEND_SITUATION,
  SERVER_LINE_TTL_MS,
  SITUATION_ZONE_IDS,
  STEP_FOCUS_IDS,
  createAutoTurnPlanner,
  createCompanionBridge,
  hintedPuzzleIdOf,
  toSpeech,
} from "../src/dialogue/companionBridge.ts";
import { createDialogueStore, type Speech } from "../src/dialogue/dialogueStore.ts";
import { HINT_UNAVAILABLE, OPEN_HINT_QUESTION, createDirector } from "../src/dialogue/director.ts";
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
async function connected(
  routes: Parameters<typeof backend>[0] = {},
  serverPuzzleIds: Record<string, string> | ((objective: ObjectiveId) => string | null) = {},
) {
  const serverPuzzleIdOf =
    typeof serverPuzzleIds === "function" ? serverPuzzleIds : (objective: ObjectiveId) => serverPuzzleIds[objective] ?? null;
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
    serverPuzzleIdOf,
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
  // 서버 넛지 대사는 줄에서 기다리는 동안을 알려고 onShow 가 붙는다(쿨다운 · 횟수는 받은 순간에 셌다) — 글 · 종류만 본다
  assert.deepEqual(
    said.map(({ onShow: _onShow, ...speech }) => speech),
    [{ kind: "line", text: "<승인 대사>", lineId: "SIT_QUIET_01", ttlMs: 10_000 }],
  );
  assert.equal(typeof said[0].onShow, "function");
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

// ── 판마다 정식 힌트가 있는 퍼즐(HINTED_PUZZLES) — 나주 v1 은 0개 ──

const NAJU_V1 = { caseId: "naju-angam-01", contentVersion: 1 };
const SERVER_PUZZLES = (Object.keys(OBJECTIVES) as ObjectiveId[]).filter((id) => OBJECTIVES[id].puzzleId);

test("정식 힌트 대상: 나주 v1 은 0개, 표에 없는 판 · 판을 모를 때도 0개(짐작하지 않는다), 힌트를 넣은 판은 그 퍼즐만", () => {
  assert.deepEqual(HINTED_PUZZLES["naju-angam-01@1"], []);
  assert.equal(SERVER_PUZZLES.length, 13);
  for (const id of Object.keys(OBJECTIVES) as ObjectiveId[]) {
    assert.equal(hintedPuzzleIdOf(id, NAJU_V1), null, `${id} — v1 정식 힌트 없음`);
    assert.equal(hintedPuzzleIdOf(id, { caseId: "naju-angam-01", contentVersion: 2 }), null, `${id} — 표에 없는 판`);
    assert.equal(hintedPuzzleIdOf(id, null), null, `${id} — 세션 준비 전`);
  }
  const future = { "naju-angam-01@2": ["P01", "P03"] };
  const v2 = { caseId: "naju-angam-01", contentVersion: 2 };
  assert.equal(hintedPuzzleIdOf("P03", v2, future), "P03");
  assert.equal(hintedPuzzleIdOf("P01", v2, future), "P01");
  assert.equal(hintedPuzzleIdOf("P09", v2, future), null, "그 판에 힌트가 없는 퍼즐");
  assert.equal(hintedPuzzleIdOf("S2_OFFER", v2, future), null, "걸음은 정식 힌트가 없다");
  assert.equal(hintedPuzzleIdOf("P03", NAJU_V1, future), null, "다른 판의 줄을 빌리지 않는다");
});

test("나주 v1: 13개 퍼즐 모두 「힌트를 주세요」에 차감 안내 없이 FE 고정 문구 하나 — Hint API 를 부르지 않는다", async () => {
  const { director, store, bridge } = await connected({}, (objective) => hintedPuzzleIdOf(objective, NAJU_V1));
  for (const id of SERVER_PUZZLES) {
    while (store.advance());
    assert.equal(bridge.hintProvider.canOpen(id), false, `${id} canOpen`);
    director.help(id, "힌트를 주세요");
    const speech = store.getState()?.speech;
    assert.notEqual(speech?.kind, "ask", `${id} — 정식 힌트를 묻지 않는다`);
    assert.equal(speech?.text, HINT_UNAVAILABLE, `${id} — FE 고정 문구`);
    assert.ok(!speech?.text.includes("줄어요"), `${id} — 차감 안내 없음`);
    assert.equal(await bridge.hintProvider.open(id), false, `${id} — 직접 불러도 보내지 않는다`);
  }
  await tick();
  assert.deepEqual(
    calls.filter((call) => call.path.endsWith("/hints")),
    [],
    "Hint API 요청 0건",
  );
});

test("힌트를 넣은 판(예: v2 의 P03): 정식 힌트 1단계 → 2단계 → 다시 보기가 그대로 돈다", async () => {
  const v2 = { caseId: "naju-angam-01", contentVersion: 2 };
  const table = { "naju-angam-01@2": ["P03"] };
  let opened = 0;
  const { director, store, said } = await connected(
    {
      hint: (call) => {
        const level = call.body!.target_level as 1 | 2;
        const isReview = level <= opened;
        opened = Math.max(opened, level);
        const body = hintResponse(level, call.body!.puzzle_id as string);
        const resultType = isReview ? "already_unlocked" : "hint_unlocked";
        return { status: 200, body: { ...body, result: { ...body.result, result_type: resultType } } };
      },
    },
    (objective) => hintedPuzzleIdOf(objective, v2, table),
  );
  const ask = async (question: string) => {
    while (store.advance());
    director.help("P03", question);
    assert.equal(store.getState()?.speech.kind, "ask", "정식 힌트는 먼저 묻는다");
    store.answer("yes");
    await tick();
    await tick();
  };
  await ask("힌트를 주세요");
  await ask("힌트를 더 주세요");
  await ask("힌트를 더 주세요");
  const hints = calls.filter((call) => call.path.endsWith("/hints"));
  assert.deepEqual(
    hints.map((call) => [call.body!.puzzle_id, call.body!.target_level, "hint_ref" in call.body!]),
    [
      ["P03", 1, false],
      ["P03", 2, false],
      ["P03", 2, false],
    ],
  );
  assert.deepEqual(
    said.filter((speech) => speech.kind === "hint").map((speech) => speech.topic),
    ["힌트 1/2", "힌트 2/2", "힌트 2/2 · 다시 보기"],
  );
  // 힌트가 없는 다른 퍼즐은 같은 판에서도 묻지 않는다
  while (store.advance());
  director.help("P09", "힌트를 주세요");
  assert.equal(store.getState()?.speech.text, HINT_UNAVAILABLE);
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

// ── 퍼즐 폴링(v0.4.7 퍼즐 자동 개입을 BE 가 판단하게) ──

test("퍼즐 폴링 대표 Object 는 대응표 v1.1 §5(진행 동기화 표)의 것 — v1 에 서버 연결된 P01 · P03 · P07 · P09 만, 모두 서버 판정 퍼즐", () => {
  assert.deepEqual(PUZZLE_FOCUS_IDS, {
    P01: "OBJ_S1_CLAM_HOLES",
    P03: "OBJ_S1_JAR_SLOTS",
    P07: "OBJ_S1_CAVE_BIG_CLAM",
    P09: "OBJ_S1_CAVE_RING_DOOR",
  });
  for (const id of Object.keys(PUZZLE_FOCUS_IDS) as ObjectiveId[]) assert.ok(OBJECTIVES[id].puzzleId, id);
});

test("퍼즐 폴링: 대응표 §5 에 대표 Object 가 없는 서버 퍼즐(P02 · P05 · P11 …)과 걸음은 보내지 않는다", () => {
  const planner = createAutoTurnPlanner({
    sendSituation: false,
    puzzleFocusOf: (objective) => (OBJECTIVES[objective].puzzleId ? (PUZZLE_FOCUS_IDS[objective] ?? null) : null),
  });
  for (const objective of ["P02", "P05", "P11", "P13-2", "S1_FIRE"] as const) {
    planner.next(null, "Z1", true, { objective, now: 0, canPoll: true });
    for (let t = 30_000; t <= 300_000; t += 30_000)
      assert.equal(planner.next(null, "Z1", true, { objective, now: t, canPoll: true }), null, objective);
  }
  planner.next(null, "Z1", true, { objective: "P07", now: 400_000, canPoll: true });
  assert.deepEqual(planner.next(null, "Z1", true, { objective: "P07", now: 460_000, canPoll: true }), {
    situation: null,
    focusObjectId: "OBJ_S1_CAVE_BIG_CLAM",
  });
});

/** P03 · P09 만 서버 퍼즐인 플래너. at(시각, 목표, 덧붙임) = 0.5초 판정 한 번 */
function pollPlanner(sendSituation = false) {
  const planner = createAutoTurnPlanner({
    sendSituation,
    puzzleFocusOf: (objective) => (objective === "P03" || objective === "P09" ? PUZZLE_FOCUS_IDS[objective]! : null),
  });
  const at = (
    now: number,
    objective: ObjectiveId | null = "P03",
    extra: { zone?: string; canDisplay?: boolean; canPoll?: boolean; situation?: Parameters<typeof planner.next>[0] } = {},
  ) => planner.next(extra.situation ?? null, extra.zone ?? "Z2", extra.canDisplay ?? true, { objective, now, canPoll: extra.canPoll ?? true });
  return at;
}

test("퍼즐 폴링: 서버 퍼즐이 목표인 동안 60초마다 상황 없이 그 퍼즐 대표 Object 만 실어 보내고, 목표가 바뀌면 처음부터 센다", () => {
  assert.equal(PUZZLE_POLL_MS, 60_000);
  const at = pollPlanner();
  const jar = { situation: null, focusObjectId: "OBJ_S1_JAR_SLOTS" };
  assert.equal(at(0), null, "목표가 된 순간에는 보내지 않는다");
  assert.equal(at(30_000), null);
  assert.equal(at(59_999), null);
  assert.deepEqual(at(60_000), jar);
  assert.equal(at(60_500), null, "보낸 뒤 다시 60초");
  assert.equal(at(119_999), null);
  assert.deepEqual(at(120_000), jar);
  // 다른 서버 퍼즐로 — 그때부터 다시 센다
  assert.equal(at(130_000, "P09"), null);
  assert.equal(at(189_999, "P09"), null);
  assert.deepEqual(at(190_000, "P09"), { situation: null, focusObjectId: "OBJ_S1_CAVE_RING_DOOR" });
  // 걸음 · 목표 없음 · 서버 퍼즐 ID 없는 퍼즐은 보내지 않는다
  for (const objective of ["S2_OFFER", null, "P05"] as const) {
    const other = pollPlanner();
    for (let t = 0; t <= 300_000; t += 30_000) assert.equal(other(t, objective), null, String(objective));
  }
});

test("퍼즐 폴링: 컷신 · 창(표시할 수 없음) · 응답 대기 · 쉬는 중이면 보내지 않고, 풀리면 그때 보낸다", () => {
  const at = pollPlanner();
  at(0);
  assert.equal(at(60_000, "P03", { canDisplay: false }), null, "컷신 · 창 · 대화 중");
  assert.equal(at(61_000, "P03", { canPoll: false }), null, "응답 대기 · 제안 뒤 쉼");
  assert.deepEqual(at(61_500), { situation: null, focusObjectId: "OBJ_S1_JAR_SLOTS" }, "풀리면 바로");
  assert.equal(at(121_000), null, "다음은 보낸 때부터 60초");
  assert.deepEqual(at(121_500), { situation: null, focusObjectId: "OBJ_S1_JAR_SLOTS" });
});

test("퍼즐 폴링: 한 번에 턴 하나 — 구역 진입 · 상황이 먼저고, 폴링은 다음 판정에 간다", () => {
  const at = pollPlanner();
  at(0, "P03", { zone: "Z1" });
  assert.deepEqual(at(60_000, "P03", { zone: "Z2" }), { situation: null }, "구역 진입(대표 Object 없음)");
  assert.deepEqual(at(60_500, "P03", { zone: "Z2" }), { situation: null, focusObjectId: "OBJ_S1_JAR_SLOTS" });

  const withSituation = pollPlanner(true);
  withSituation(0);
  assert.deepEqual(withSituation(60_000, "P03", { situation: { kind: "breath", objective: "P03", step: 0 } }), {
    situation: { code: "BREATH_LOW" },
  });
  assert.deepEqual(withSituation(60_500), { situation: null, focusObjectId: "OBJ_S1_JAR_SLOTS" }, "상황을 실어도 폴링은 따로");
});

/**
 * 서버 · 다리 · 가짜 시계를 세운다(퍼즐 폴링 검사). answer — 물음에 고른 대답(true 「네」 · false 「아니요」 · null 대답 없이 물러남)
 */
async function pollBridge(
  turnReply: Handler = () => ({ status: 200, body: turn() }),
  answer: boolean | null = false,
  isShown = true,
) {
  let clock = 0;
  serve(backend({ turn: turnReply }));
  const session = createCompanionSession({ config: { caseId: "naju-angam-01", contentVersion: 1 }, storage: memoryStore() });
  await session.start();
  const dialog = createCompanionDialog({ session, timing: { ...TIMING, autoMinIntervalMs: 180_000 }, now: () => clock });
  const said: Speech[] = [];
  let asked = 0;
  const bridge = createCompanionBridge({
    dialog,
    // 가짜 대화창 — 받은 말을 바로 띄운다(isShown 거짓이면 창 · 컷신에 막혀 못 띄우고 버린 셈)
    say: (speech) => {
      said.push(speech);
      if (isShown) speech.onShow?.();
    },
    askOpenHint: async (request) => {
      asked += 1;
      if (isShown) request.onShow?.();
      if (isShown && answer === false) request.onDecline?.();
      return answer === true;
    },
    // 나주 v1 처럼 정식 힌트가 0개인 판 — 폴링은 공식 서버 퍼즐 ID 로 따로 간다(HINTED_PUZZLES 와 무관)
    serverPuzzleIdOf: () => null,
    puzzleFocusIdOf: (objective) => (OBJECTIVES[objective].puzzleId ? (PUZZLE_FOCUS_IDS[objective] ?? null) : null),
    now: () => clock,
  });
  calls = [];
  const relayAt = async (time: number, objective: ObjectiveId | null = "P03", zone = "Z2") => {
    clock = time;
    bridge.relay(null, zone, true, objective);
    await tick();
    await tick();
  };
  const turns = () => calls.filter((c) => c.path.endsWith("/npc/turns"));
  return { dialog, said, relayAt, turns, asked: () => asked };
}

test("퍼즐 폴링 본문: 상황 없이 focus_object_id 만 싣고, FE 구역 간격(180초)에 막히지 않으며, reply null 은 조용히 넘긴다 — 정식 힌트가 0개인 판(v1)에서도 간다", async () => {
  const { said, relayAt, turns, dialog } = await pollBridge();
  await relayAt(0);
  await relayAt(60_000);
  await relayAt(120_000);
  const sent = turns();
  assert.equal(sent.length, 2);
  for (const call of sent) {
    assert.equal(call.body!.trigger, "auto");
    assert.equal(call.body!.focus_object_id, "OBJ_S1_JAR_SLOTS");
    assert.equal("situation" in call.body!, false);
  }
  assert.deepEqual(said, [], "reply null — 아무것도 띄우지 않는다");
  assert.equal(dialog.getState().line, null);
  // 걸음 목표는 폴링하지 않는다
  await relayAt(130_000, "S2_OFFER");
  await relayAt(400_000, "S2_OFFER");
  assert.equal(turns().length, 2);
});

test("퍼즐 폴링에 제안(suggest_hint)이 오면 기존 Y/N 으로 묻고, 물은 뒤 180초 · 「아니요」면 600초 쉰다(보고 API 미연결)", async () => {
  const suggest: Handler = () => ({ status: 200, body: turn({ suggest_hint: { hint_ref: "HINT_REF_P03" } }) });
  const { relayAt, turns, asked } = await pollBridge(suggest, false);
  await relayAt(0);
  await relayAt(60_000);
  assert.equal(turns().length, 1);
  assert.equal(asked(), 1, "Y/N 으로 물었다");
  await relayAt(120_000);
  await relayAt(60_000 + OFFER_POLL_PAUSE_MS.declined - 1);
  assert.equal(turns().length, 1, "「아니요」 뒤 600초는 다시 묻지 않는다");
  await relayAt(60_000 + OFFER_POLL_PAUSE_MS.declined);
  assert.equal(turns().length, 2);
});

test("퍼즐 폴링에 넛지 대사만 와도(제안 없음) 띄우고 180초 쉰다 — 같은 넛지를 1분마다 되풀이하지 않게(Codex 리뷰 1fa489b)", async () => {
  const nudge: Handler = () => ({
    status: 200,
    body: turn({ reply: { source: "approved_line", text: "[모의] 숨구멍을 다시 살펴볼까요?", line_id: "NUDGE_P01_1" } }),
  });
  const { said, relayAt, turns, asked } = await pollBridge(nudge);
  await relayAt(0);
  await relayAt(60_000);
  assert.equal(turns().length, 1);
  // 넛지는 대화창에 동행 말(line)로 뜬다
  assert.deepEqual(
    said.map((speech) => [speech.kind, speech.text]),
    [["line", "[모의] 숨구멍을 다시 살펴볼까요?"]],
  );
  assert.equal(asked(), 0, "제안이 없으면 묻지 않는다");
  await relayAt(120_000);
  await relayAt(60_000 + OFFER_POLL_PAUSE_MS.shown - 1);
  assert.equal(turns().length, 1, "180초 쉰다");
  await relayAt(60_000 + OFFER_POLL_PAUSE_MS.shown);
  assert.equal(turns().length, 2);
});

test("퍼즐 폴링으로 받은 개입은 퍼즐당 2번까지 — 그 뒤 그 퍼즐은 폴링하지 않고, 다른 퍼즐은 그대로(Codex 리뷰 1fa489b)", async () => {
  assert.equal(POLL_MAX_PER_PUZZLE, 2);
  const suggest: Handler = () => ({ status: 200, body: turn({ suggest_hint: { hint_ref: "HINT_REF_P03" } }) });
  const { relayAt, turns, asked } = await pollBridge(suggest, false);
  const step = OFFER_POLL_PAUSE_MS.declined;
  await relayAt(0);
  await relayAt(60_000);
  await relayAt(60_000 + step);
  assert.equal(asked(), 2);
  for (let t = 60_000 + step * 2; t <= 60_000 + step * 6; t += step) await relayAt(t);
  assert.equal(turns().length, 2, "P03 은 더 묻지 않는다");
  // 다른 서버 퍼즐은 제 몫이 따로다
  const start = 60_000 + step * 7;
  await relayAt(start, "P09");
  await relayAt(start + 60_000, "P09");
  assert.equal(turns().length, 3);
  assert.equal(turns()[2].body!.focus_object_id, "OBJ_S1_CAVE_RING_DOOR");
});

const NUDGE: Handler = () => ({
  status: 200,
  body: turn({ reply: { source: "approved_line", text: "[모의] 숨구멍을 다시 살펴볼까요?", line_id: "NUDGE_P01_1" } }),
});
const OFFER: Handler = () => ({ status: 200, body: turn({ suggest_hint: { hint_ref: "HINT_REF_P03" } }) });

/**
 * 진짜 대화창 줄(dialogueStore) · director 위에 다리를 세운다 — 줄에서 버려지는 경우(ttl · QUEUE_LIMIT · 같은 key)를 본다.
 * 줄의 수명(ttl)은 Date.now 로 재므로 가짜 시계에 묶는다(restore 로 되돌린다).
 */
async function storeBridge(turnReply: Handler) {
  let clock = 0;
  const realNow = Date.now;
  Date.now = () => clock;
  serve(backend({ turn: turnReply }));
  const session = createCompanionSession({ config: { caseId: "naju-angam-01", contentVersion: 1 }, storage: memoryStore() });
  await session.start();
  const dialog = createCompanionDialog({ session, timing: { ...TIMING, autoMinIntervalMs: 180_000 }, now: () => clock });
  const store = createDialogueStore({ capacity: 300, setTimer: () => 0, clearTimer: () => {} });
  const director = createDirector({ store, guideOf: () => null, showDraftLines: false });
  const bridge = createCompanionBridge({
    dialog,
    say: (speech) => store.say(speech),
    askOpenHint: director.askOpenHint,
    serverPuzzleIdOf: () => null,
    puzzleFocusIdOf: (objective) => (OBJECTIVES[objective].puzzleId ? (PUZZLE_FOCUS_IDS[objective] ?? null) : null),
    now: () => clock,
  });
  calls = [];
  const relayAt = async (time: number, objective: ObjectiveId | null = "P03", zone = "Z2") => {
    clock = time;
    bridge.relay(null, zone, true, objective);
    await tick();
    await tick();
  };
  const turns = () => calls.filter((c) => c.path.endsWith("/npc/turns"));
  return {
    store,
    relayAt,
    turns,
    setClock: (time: number) => void (clock = time),
    restore: () => void (Date.now = realNow),
  };
}

test("받았지만 줄에서 버려진 넛지(수명 ttl · QUEUE_LIMIT · 같은 key)도 받은 순간 180초 쉬고 퍼즐당 횟수에 들어 있다(BE 가 돌려준 것을 센다, 세진 11/10)", async () => {
  const shown = OFFER_POLL_PAUSE_MS.shown;
  /** 넛지 둘을 받아 각각 drop 으로 버린 뒤 — 받을 때마다 180초 쉬고, 둘째 뒤로는 그 퍼즐을 더 폴링하지 않는다 */
  const run = async (turnReply: Handler, drop: (ctx: Awaited<ReturnType<typeof storeBridge>>, at: number) => Promise<void>) => {
    const ctx = await storeBridge(turnReply);
    try {
      const { store, relayAt, turns } = ctx;
      store.setHeld(true); // 연출 중 — 받은 말은 줄만 선다
      await relayAt(0);
      await relayAt(60_000);
      assert.equal(turns().length, 1);
      await drop(ctx, 60_000);
      assert.equal(store.getState(), null, "화면에 뜨지 않았다");
      await relayAt(60_000 + shown - 1);
      assert.equal(turns().length, 1, "버려져도 받은 순간부터 180초 쉰다");
      await relayAt(60_000 + shown);
      assert.equal(turns().length, 2, "받은 때부터 센 180초가 지나면 다시 — 버려진 뒤로 늘지 않는다");
      await drop(ctx, 60_000 + shown);
      for (let t = 60_000 + shown * 2; t <= 60_000 + shown * 5; t += 60_000) await relayAt(t);
      assert.equal(turns().length, 2, `버려진 개입도 퍼즐당 ${POLL_MAX_PER_PUZZLE}번에 들었다`);
    } finally {
      ctx.restore();
    }
  };
  // 수명: 연출이 길어 줄에서 10초 넘게 기다렸다가 버려짐
  await run(NUDGE, async ({ store, setClock }, at) => {
    setClock(at + SERVER_LINE_TTL_MS + 1);
    store.setHeld(false);
    store.setHeld(true);
  });
  // QUEUE_LIMIT: 더 급한 알림 넷이 줄을 채우고 있어 넛지(line)가 바로 밀려남
  await run(NUDGE, async ({ store }) => {
    store.setHeld(false);
    store.setHeld(true);
    for (let i = 0; i < 4; i++) store.say({ kind: "notice", text: `알림 ${i}` });
  });
  // 같은 key: 줄 서 있던 힌트 제안 물음(key offer)을 다른 물음이 바꿔 끼움 — 물음은 「대답 없음」으로 끝난다
  await run(OFFER, async ({ store }) => {
    void store.ask({ text: "다른 물음", key: "offer", choices: [{ id: "yes", label: "네" }, { id: "no", label: "아니요" }] });
    await tick();
    store.reset();
    store.setHeld(true);
  });
});

test("넛지를 받은 직후 구역에 들어서도 쉬는 동안은 구역 진입 auto 턴을 보내지 않는다(세진 11/10)", async () => {
  const { relayAt, turns } = await pollBridge(NUDGE);
  await relayAt(0, "P03", "Z1");
  await relayAt(60_000, "P03", "Z1");
  assert.equal(turns().length, 1, "폴링 → 넛지");
  await relayAt(61_000, "P03", "Z2");
  await relayAt(62_000, "P03", "Z3");
  assert.equal(turns().length, 1, "넛지 뒤 180초 안의 구역 진입은 버린다");
  await relayAt(60_000 + OFFER_POLL_PAUSE_MS.shown, null, "Z4");
  assert.equal(turns().length, 2, "쉬는 시간이 끝나면 구역 진입이 다시 간다");
  assert.equal("focus_object_id" in turns()[1].body!, false, "구역 진입 턴(상황 · 대표 Object 없음)");
});

test("받은 개입이 아직 대화창 줄에서 기다리면 퍼즐 폴링을 보내지 않는다 — 넛지 대기 중 60초 · 제안 대기가 쉬는 시간보다 길어도", async () => {
  // 넛지: 연출 중이라 줄에서 기다리는 사이 60초가 지남
  const nudge = await storeBridge(NUDGE);
  try {
    nudge.store.setHeld(true);
    await nudge.relayAt(0);
    await nudge.relayAt(60_000);
    await nudge.relayAt(120_000);
    assert.equal(nudge.turns().length, 1, "넛지가 줄에서 기다리는 동안 다음 폴링은 안 간다");
  } finally {
    nudge.restore();
  }
  // 제안 물음: 줄에서 쉬는 시간(180초)보다 오래 기다려도 뜨거나 끝날 때까지는 안 간다
  const offer = await storeBridge(OFFER);
  try {
    offer.store.setHeld(true);
    await offer.relayAt(0);
    await offer.relayAt(60_000);
    for (let t = 120_000; t <= 60_000 + OFFER_POLL_PAUSE_MS.shown + 120_000; t += 60_000) await offer.relayAt(t);
    assert.equal(offer.turns().length, 1, "물음이 줄에서 기다리는 동안은 쉬는 시간이 지나도 안 간다");
    offer.store.setHeld(false); // 연출이 끝나 물음이 뜬다
    assert.equal(offer.store.getState()?.speech.kind, "ask");
    await offer.relayAt(60_000 + OFFER_POLL_PAUSE_MS.shown + 121_000);
    assert.equal(offer.turns().length, 2, "뜬 뒤에는 그대로 — 쉬는 시간은 받은 때부터 이미 지났다");
  } finally {
    offer.restore();
  }
});

test("reply: null(후보를 다 씀)이면 아무것도 띄우지 않고, 쉬는 시간 · 퍼즐당 횟수도 걸지 않는다(세진 11/10)", async () => {
  const { said, relayAt, turns, dialog } = await pollBridge(() => ({ status: 200, body: turn({ reply: null }) }));
  await relayAt(0);
  for (let t = 60_000; t <= 300_000; t += 60_000) await relayAt(t);
  assert.equal(turns().length, 5, "60초마다 그대로 — 쉬지 않고 퍼즐당 2번 상한도 쓰지 않았다");
  assert.deepEqual(said, [], "대화창에 아무것도 없다");
  assert.equal(dialog.getState().line, null);
});

test("거절 쿨다운(600초)은 화면에 뜬 물음에 「아니요」를 고른 때만 — 대답 없이 물러나면 받은 때의 180초만", async () => {
  const { relayAt, turns, asked } = await pollBridge(OFFER, null);
  await relayAt(0);
  await relayAt(60_000);
  assert.equal(asked(), 1);
  await relayAt(60_000 + OFFER_POLL_PAUSE_MS.shown - 1);
  assert.equal(turns().length, 1);
  await relayAt(60_000 + OFFER_POLL_PAUSE_MS.shown);
  assert.equal(turns().length, 2, "대답 없이 물러남은 거절이 아니다");
});

test("퍼즐 폴링이 실패해도(422 · 연결) 「다시 말을 걸어 주세요」 같은 안내를 띄우지 않는다", async () => {
  for (const status of [422, 503]) {
    const { said, relayAt, turns, dialog } = await pollBridge(() => ({ status }));
    await relayAt(0);
    await relayAt(60_000);
    // 503 은 같은 본문으로 몇 번 다시 보낸 뒤 끝난다 — 끝날 때까지 기다린다
    for (let i = 0; i < 100 && dialog.getState().waiting !== null; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(turns().length >= 1, `${status} 보냈다`);
    assert.deepEqual(said, [], `${status} 안내 없음`);
    assert.equal(dialog.getState().line, null);
    assert.equal(dialog.getState().waiting, null, "대기가 풀렸다 — 다음 폴링이 막히지 않는다");
  }
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
