// NPC 500 이 공용 플레이 세션을 끄지 않는다(11/12 베타 전 수정) — 동행만 꺼지고 퍼즐 제출(progressSync)은 계속 간다.
// 세션 · 서버 대화 · 다리 · 진행 동기화를 한 가짜 백엔드 위에 같이 세운다(실제 모듈 그대로).
//   node --test naju01/tests/*.test.ts
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import { DIALOG_TEXT, createCompanionDialog } from "../src/companion/companionDialog.ts";
import { createCompanionSession, type KeyValueStore } from "../src/companion/companionSession.ts";
import { PUZZLE_FOCUS_IDS, createCompanionBridge } from "../src/dialogue/companionBridge.ts";
import type { Speech } from "../src/dialogue/dialogueStore.ts";
import { OBJECTIVES, type ObjectiveId } from "../src/dialogue/objectives.ts";
import { createProgressIdMap, createProgressSync } from "../src/progress/progressSync.ts";

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

let calls: Call[] = [];
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  calls = [];
});

const PLAY_ID = "11111111-1111-4111-8111-111111111111";

/** NPC 턴은 늘 500, 나머지(익명 세션 · 플레이 세션 · 상호작용 · 힌트)는 정상 */
function serveNpc500() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : null;
    const call: Call = { method: init?.method ?? "GET", path: String(input), body: raw ? JSON.parse(raw) : null };
    calls.push(call);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (call.path === "/api/v1/anonymous-sessions") return json(201, { data: { anonymous_session_id: "anon-1" } });
    if (call.path === "/api/v1/play-sessions" && call.method === "POST")
      return json(201, { data: { play_session_id: PLAY_ID, case_id: "naju-angam-01", state: { hint_levels: {} } } });
    if (call.path.endsWith("/npc/turns")) return json(500, { detail: "NPC content is unavailable." });
    if (call.path.endsWith("/interactions"))
      return json(200, {
        interaction_id: "33333333-3333-4333-8333-333333333333",
        result_type: "correct",
        message: null,
        attempt_count: null,
        state_changes: [],
        ui_actions: [],
      });
    return json(500, { detail: "unexpected route" });
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

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function world() {
  let clock = 0;
  serveNpc500();
  const session = createCompanionSession({ config: { caseId: "naju-angam-01", contentVersion: 1 }, storage: memoryStore() });
  await session.start();
  const dialog = createCompanionDialog({
    session,
    timing: { noticeMs: 5, lineMinMs: 5, lineMaxMs: 5, hintMinMs: 5, autoMinIntervalMs: 180_000 },
    now: () => clock,
  });
  const said: Speech[] = [];
  const bridge = createCompanionBridge({
    dialog,
    say: (speech) => {
      said.push(speech);
      speech.onShow?.();
    },
    askOpenHint: async () => false,
    serverPuzzleIdOf: () => null,
    puzzleFocusIdOf: (objective) => (OBJECTIVES[objective].puzzleId ? (PUZZLE_FOCUS_IDS[objective] ?? null) : null),
    now: () => clock,
  });
  // 진행 동기화는 게임처럼 같은 동행 세션을 읽기만 한다(companionSession.getStatus)
  const sync = createProgressSync({
    getSession: () => session.getStatus(),
    ids: createProgressIdMap({ zones: { TA: "ZONE_TEST_A" }, objects: { "test-lever": "OBJ_TEST_LEVER" } }),
    sendOptions: { retryDelayMs: 0 },
  });
  calls = [];
  const relayAt = async (time: number, objective: ObjectiveId = "P03") => {
    clock = time;
    bridge.relay(null, "Z2", true, objective);
    await tick();
    await tick();
  };
  const turns = () => calls.filter((c) => c.path.endsWith("/npc/turns"));
  return { session, dialog, bridge, said, sync, relayAt, turns };
}

test("퍼즐 폴링이 NPC 500 을 받아도 공용 세션은 ready — 그 뒤 퍼즐 제출은 서버로 간다(session-not-ready 아님)", async () => {
  const { session, sync, relayAt, turns } = await world();
  for (let t = 0; t <= 120_000; t += 60_000) await relayAt(t);
  assert.ok(turns().length >= 1, "폴링이 500 을 받았다");
  assert.equal(session.getStatus().phase, "ready");

  const outcome = await sync.submit({ action: "complete", zone: "TA", object: "test-lever" });
  assert.equal(outcome.kind, "sent", JSON.stringify(outcome));
  assert.equal(calls.filter((c) => c.path === `/api/v1/play-sessions/${PLAY_ID}/interactions`).length, 1);
});

test("NPC 500 뒤 동행이 꺼지고(isNpcEnabled) 퍼즐 폴링도 멈춘다 — 안내는 대화창에 딱 한 번", async () => {
  const { dialog, said, relayAt, turns } = await world();
  // 첫 폴링이 갈 때까지
  let t = 0;
  while (turns().length === 0 && t <= 300_000) {
    await relayAt(t);
    t += 60_000;
  }
  assert.equal(turns().length, 1);
  assert.equal(dialog.getState().isNpcEnabled, false);
  assert.equal(dialog.getState().isEnabled, true, "공용 세션은 그대로");

  // 10분 동안 판정을 돌려도 NPC 턴을 더 보내지 않는다(목표가 바뀌어도)
  for (let i = 0; i < 10; i++, t += 60_000) await relayAt(t, i % 2 === 0 ? "P03" : "P01");
  assert.equal(turns().length, 1, "꺼진 뒤 폴링 없음");
  assert.deepEqual(
    said.filter((speech) => speech.kind === "notice").map((speech) => speech.text),
    [DIALOG_TEXT.unavailable],
    "quiet 폴링에서 꺼져도 한 번은 알리고, 그 뒤로는 다시 띄우지 않는다",
  );
});
