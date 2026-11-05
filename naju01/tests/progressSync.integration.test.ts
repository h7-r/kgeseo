// 진행 동기화(progressSync) ↔ 실제 FastAPI + MySQL 통합 검증. 서버 응답을 흉내 내지 않는다.
// 격리 서버 주소가 있을 때만 돈다(없으면 건너뜀 — 평소 naju:test 에 영향 없음):
//   PROGRESS_SYNC_IT_BASE=http://127.0.0.1:18017 node --test naju01/tests/progressSync.integration.test.ts
// 서버에는 가상 케이스 progress_sync_it v1 이 게시돼 있어야 한다(backend/scripts/it_progress_sync_case.py).
// 준비(격리 MySQL · 버리는 DB 에서만, 운영 DB 금지):
//   1) DB_* · APP_ENV=test · PUBLISHED_CONTENT_ROOT=<빈 폴더> 로 `alembic upgrade head`
//   2) `python -m scripts.it_progress_sync_case <루트>` → fingerprint
//   3) `scripts.record_gate_review` G1~G3(--commit --confirm-db) → `scripts.publish_case_content --commit --confirm-db`
//   4) 같은 환경으로 `uvicorn app.main:app --port 18017` (사용 중이 아닌 포트)
// 세션은 동행 NPC 세션(createCompanionSession)이 실제 서버에서 만든다. 실행할 때마다 새 세션이다.
// 브라우저가 아니라서 상대 경로(/api/...)에 서버 주소만 붙인다 — 요청 본문 · 응답은 손대지 않는다.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { loadPlaySession, newEventId, postHint, postNpcTurn, clientTimestamp } from "../src/companion/companionApi.ts";
import { createCompanionSession, type KeyValueStore } from "../src/companion/companionSession.ts";
import {
  createProgressIdMap,
  createProgressSync,
  type InteractionStateChange,
  type PreparedInteraction,
  type SendOutcome,
} from "../src/progress/progressSync.ts";

const BASE = process.env.PROGRESS_SYNC_IT_BASE ?? "";
const CASE = { caseId: "progress_sync_it", contentVersion: 1 };

// 가상 대응표 — 로컬 이름은 시험용, 런타임 ID 는 가상 케이스(backend/scripts/it_progress_sync_case.py)
const IDS = createProgressIdMap({
  zones: { "it-a": "ZONE_IT_A", "it-b": "ZONE_IT_B" },
  objects: { "it-skill": "OBJ_IT_SKILL", "it-lock": "OBJ_IT_LOCK", "it-dial": "OBJ_IT_DIAL" },
});

interface Wire {
  method: string;
  path: string;
  status: number;
}
const wire: Wire[] = [];
const realFetch = globalThis.fetch;

function memoryStore(): KeyValueStore {
  const data: Record<string, string> = {};
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => void (data[key] = value),
    removeItem: (key) => void delete data[key],
  };
}

// 오브젝트 이름이 모두 「가상 …」이라 「가상」을 넣으면 두 퍼즐에 걸려 모호한 질문이 된다 — 자물쇠만 부른다
const LOCK_QUESTION = "자물쇠는 어떻게 열어?";
/** 보고용 — NPC 응답 요약(대사 원문은 가상 문장) */
const npcLog: { step: string; reply: string | null; suggest: string | null; fallback: string | null }[] = [];

describe("progressSync ↔ 실제 Interaction API", { skip: BASE ? false : "PROGRESS_SYNC_IT_BASE 없음" }, () => {
  const session = createCompanionSession({ config: CASE, storage: memoryStore() });
  const changes: InteractionStateChange[][] = [];
  const sync = createProgressSync({
    getSession: session.getStatus,
    ids: IDS,
    onStateChanges: (list) => changes.push(list),
  });
  let playId = "";

  const state = async () => (await loadPlaySession(playId)).state as Record<string, unknown>;
  const ask = async (message: string, step: string) => {
    const turn = await postNpcTurn(playId, {
      client_event_id: newEventId(),
      client_timestamp: clientTimestamp(),
      trigger: "player_message",
      message,
    });
    npcLog.push({
      step,
      reply: turn.reply ? `${turn.reply.source}:${turn.reply.line_id ?? "-"}` : null,
      suggest: turn.suggest_hint ? "hint_ref" : null,
      fallback: turn.fallback_reason,
    });
    return turn;
  };
  const sent = (outcome: SendOutcome | { ok: false }) => {
    assert.ok("kind" in outcome && outcome.kind === "sent", JSON.stringify(outcome));
    return outcome.response;
  };

  before(async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" && input.startsWith("/") ? BASE + input : input;
      const response = await realFetch(url, init);
      wire.push({ method: init?.method ?? "GET", path: String(input), status: response.status });
      return response;
    }) as typeof fetch;
    const status = await session.start();
    assert.equal(status.phase, "ready", JSON.stringify(status));
    assert.ok(status.phase === "ready");
    playId = status.playSessionId;
  });
  after(() => {
    globalThis.fetch = realFetch;
    console.log("NPC_LOG " + JSON.stringify(npcLog));
  });

  test("1. 동행 세션이 실제 버전 고정 Play Session 을 만들고 입구 Zone 에 둔다", async () => {
    assert.deepEqual(
      wire.map((w) => `${w.method} ${w.path} ${w.status}`),
      ["POST /api/v1/anonymous-sessions 201", "POST /api/v1/play-sessions 201"],
    );
    const s = await state();
    assert.equal(s.current_zone_id, "ZONE_IT_A");
  });

  test("2. NPC: 입구에서는 안쪽 자물쇠 nudge 가 나오지 않는다(서버 현재 Zone 기준 — 일반 nudge 만)", async () => {
    const turn = await ask(LOCK_QUESTION, "2-입구");
    assert.notEqual(turn.reply?.line_id, "NUDGE_IT_LOCK");
    assert.equal(turn.suggest_hint, null);
    assert.equal(turn.content_mode, "case");
  });

  test("3. navigate: 서버 현재 Zone 이 바뀌고 state_changes 를 받는다", async () => {
    const response = sent(await sync.submit({ action: "navigate", fromZone: "it-a", toZone: "it-b" }));
    assert.equal(response.result_type, "ok");
    assert.deepEqual(response.state_changes, [{ type: "current_zone_changed", zone_id: "ZONE_IT_B" }]);
    assert.deepEqual(changes.at(-1), response.state_changes);
    assert.equal((await state()).current_zone_id, "ZONE_IT_B");
  });

  test("4. 409: 선행 퍼즐 전 input 은 required-puzzles, 다른 Zone 물건 complete 는 zone-not-current", async () => {
    const early = await sync.submit({ action: "input", zone: "it-b", object: "it-lock", answer: "가상답" });
    assert.equal("kind" in early && early.kind === "conflict" && early.reason, "required-puzzles");
    const away = await sync.submit({ action: "complete", zone: "it-a", object: "it-skill" });
    assert.equal("kind" in away && away.kind === "conflict" && away.reason, "zone-not-current");
  });

  test("5. NPC: 안쪽에서 자물쇠는 퍼즐 질문이지만 nudge 는 물레 완료 전이라 공개되지 않는다", async () => {
    const turn = await ask(LOCK_QUESTION, "5-안쪽·물레 전");
    assert.notEqual(turn.reply?.line_id, "NUDGE_IT_LOCK");
  });

  let completeOnce: PreparedInteraction;
  test("6. complete(client_skill): 완료 · 단서 · flag 가 서버에 기록된다", async () => {
    sent(await sync.submit({ action: "navigate", fromZone: "it-b", toZone: "it-a" }));
    const prepared = sync.prepare({ action: "complete", zone: "it-a", object: "it-skill" });
    assert.ok(prepared.ok);
    completeOnce = prepared.prepared;
    const response = sent(await sync.send(completeOnce));
    assert.equal(response.result_type, "correct");
    const types = response.state_changes.map((c) => c.type).sort();
    assert.deepEqual(types, ["clue_acquired", "flag_updated", "puzzle_completed"]);
    const s = await state();
    assert.deepEqual(s.completed_puzzle_ids, ["PZ_IT_SKILL"]);
    assert.deepEqual(s.acquired_clue_ids, ["CLUE_IT_SKILL"]);
  });

  test("7. 같은 prepared 재전송은 처음 결과를 되돌리고 효과를 중복 적용하지 않는다", async () => {
    const before = await state();
    const first = wire.length;
    const replay = await sync.send(completeOnce);
    const response = sent(replay);
    assert.equal(response.result_type, "correct");
    const after = await state();
    assert.deepEqual(after.completed_puzzle_ids, before.completed_puzzle_ids);
    assert.deepEqual(after.acquired_clue_ids, before.acquired_clue_ids);
    assert.deepEqual(after.attempt_counts, before.attempt_counts);
    assert.equal(wire.slice(first).filter((w) => w.path.endsWith("/interactions")).length, 1);
    // 새 이벤트로 다시 신고하면 already_completed
    const again = sent(await sync.submit({ action: "complete", zone: "it-a", object: "it-skill" }));
    assert.equal(again.result_type, "already_completed");
  });

  test("8. 같은 client_event_id 로 다른 본문을 보내면 409 idempotency-conflict", async () => {
    const tampered: PreparedInteraction = {
      intent: completeOnce.intent,
      body: { ...completeOnce.body, target_id: "OBJ_IT_A_DOOR" },
    };
    const outcome = await sync.send(tampered);
    assert.equal(outcome.kind === "conflict" && outcome.reason, "idempotency-conflict");
  });

  test("9. NPC · Hint: 물레 완료 뒤 같은 질문에 승인 nudge 가 공개되고, 정식 힌트가 열린다", async () => {
    sent(await sync.submit({ action: "navigate", fromZone: "it-a", toZone: "it-b" }));
    const turn = await ask(LOCK_QUESTION, "9-물레 후");
    assert.equal(turn.reply?.source, "approved_line");
    assert.equal(turn.reply?.line_id, "NUDGE_IT_LOCK");
    const hint = await postHint(playId, {
      puzzle_id: "PZ_IT_INPUT",
      client_event_id: newEventId(),
      client_timestamp: clientTimestamp(),
      target_level: 1,
    });
    assert.equal(hint.result.result_type, "hint_unlocked");
    assert.equal(hint.hint.level, 1);
    assert.ok(hint.hint.text.startsWith("(가상)"));
  });

  test("10. input: 오답은 incorrect + 시도 횟수, 정답은 correct + 완료 · NPC 맥락에서 빠진다", async () => {
    const wrong = sent(await sync.submit({ action: "input", zone: "it-b", object: "it-lock", answer: "틀린답" }));
    assert.equal(wrong.result_type, "incorrect");
    assert.equal(wrong.attempt_count, 1);
    assert.deepEqual(wrong.state_changes, []);
    const right = sent(await sync.submit({ action: "input", zone: "it-b", object: "it-lock", answer: "가상답" }));
    assert.equal(right.result_type, "correct");
    assert.ok(right.state_changes.some((c) => c.type === "puzzle_completed" && c.puzzle_id === "PZ_IT_INPUT"));
    const turn = await ask(LOCK_QUESTION, "10-자물쇠 완료 후");
    assert.notEqual(turn.reply?.line_id, "NUDGE_IT_LOCK");
  });

  test("11. select: 오답 incorrect, 정답 correct + case_completed", async () => {
    const wrong = sent(await sync.submit({ action: "select", zone: "it-b", object: "it-dial", choice: "CHOICE_IT_A" }));
    assert.equal(wrong.result_type, "incorrect");
    const right = sent(await sync.submit({ action: "select", zone: "it-b", object: "it-dial", choice: "CHOICE_IT_B" }));
    assert.equal(right.result_type, "correct");
    assert.ok(right.state_changes.some((c) => c.type === "case_completed"));
  });

  test("12. 404 세션 없음 → session-missing, 시간대 없는 시각 → 422 rejected", async () => {
    const ghost = createProgressSync({
      getSession: () => ({ ...(session.getStatus() as object), playSessionId: newEventId() }) as never,
      ids: IDS,
    });
    assert.deepEqual(await ghost.submit({ action: "navigate", fromZone: "it-b", toZone: "it-a" }), {
      kind: "session-missing",
    });
    const naive = createProgressSync({ getSession: session.getStatus, ids: IDS, now: () => "2026-11-05T00:00:00" });
    const outcome = await naive.submit({ action: "navigate", fromZone: "it-b", toZone: "it-a" });
    assert.equal("kind" in outcome && outcome.kind === "rejected" && outcome.status, 422);
  });

  test("13. 대응 없는 로컬 ID 는 서버로 가지 않는다", async () => {
    const before = wire.length;
    const outcome = await sync.submit({ action: "complete", zone: "it-b", object: "it-unknown" });
    assert.deepEqual(outcome, { ok: false, reason: "unmapped", kind: "object", localId: "it-unknown" });
    assert.equal(wire.length, before);
  });
});
