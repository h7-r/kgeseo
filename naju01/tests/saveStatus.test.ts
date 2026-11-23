// 계정 저장 상태 · 409 뒤 다시 쓰기 판단 · 상태별 안내 문구(src/save/saveStatus · saveStatusText — 본편 · 나주가 같이 쓴다, 인증 점검 M13 · M14 · L22).
//   node --test naju01/tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createSaveStatusStore,
  decideConflictRetry,
  decideSaveConflict,
  isSameSave,
  readAccountId,
  readConflictCode,
  readConflictRevision,
  type SaveStatus,
} from "../../src/save/saveStatus.ts";
import { restartBlockedReason, saveFailureText, unsavedNote } from "../../src/save/saveStatusText.ts";

const me = (status: number, body: unknown = null) => ({ status, body });
const ME_A = me(200, { user_id: "user-a", email: "a@example.com" });
const ME_B = me(200, { user_id: "user-b", email: "b@example.com" });
const CONFLICT = { detail: { code: "save_conflict", revision: 7 } };

test("상태 저장소 — 바뀔 때만 알리고, 구독을 풀면 더 안 온다", () => {
  const store = createSaveStatusStore();
  assert.equal(store.get(), "guest");
  let calls = 0;
  const unsubscribe = store.subscribe(() => (calls += 1));
  store.set("saving");
  store.set("saving");
  assert.equal(calls, 1, "같은 값은 알리지 않는다");
  store.set("signed_out");
  assert.equal(store.get(), "signed_out");
  assert.equal(calls, 2);
  unsubscribe();
  store.set("account_changed");
  assert.equal(calls, 2);
});

test("/me 응답에서 계정 id — 200 에 user_id 가 있을 때만", () => {
  assert.equal(readAccountId(ME_A), "user-a");
  assert.equal(readAccountId(me(401, { detail: "Login required." })), null);
  assert.equal(readAccountId(me(200, { user_id: "" })), null);
  assert.equal(readAccountId(me(200, "oops")), null);
  assert.equal(readAccountId(me(0)), null);
});

test("409 본문의 서버 revision — detail.revision 만 믿는다(문장 detail · 없는 본문은 null)", () => {
  assert.equal(readConflictRevision(CONFLICT), 7);
  assert.equal(readConflictRevision({ detail: { code: "save_conflict", revision: 0 } }), 0, "첫 저장 경합의 0 도 숫자다");
  assert.equal(readConflictRevision({ detail: "Conflict" }), null);
  assert.equal(readConflictRevision({ detail: { code: "save_conflict" } }), null);
  assert.equal(readConflictRevision(null), null);
});

test("409 뒤 — 같은 계정이면 다시 쓰고, 401 이면 세션 끊김, 다른 계정이면 멈춘다", () => {
  assert.equal(decideConflictRetry(ME_A, "user-a"), "retry");
  assert.equal(decideConflictRetry(me(401, { detail: "Login required." }), "user-a"), "signed_out");
  assert.equal(decideConflictRetry(ME_B, "user-a"), "account_changed", "다른 탭에서 다른 계정으로 로그인했다");
});

test("409 뒤 — 비교할 수 없으면(처음 id 를 못 읽음 · /me 가 잠깐 안 됨) 지금까지처럼 다시 쓴다", () => {
  assert.equal(decideConflictRetry(ME_B, null), "retry", "처음에 /me 를 못 읽었으면 바뀐 줄 알 수 없다");
  assert.equal(decideConflictRetry(me(0), "user-a"), "retry", "연결 실패");
  assert.equal(decideConflictRetry(me(500, { detail: "Internal Server Error" }), "user-a"), "retry");
});

test("안내 문구 — 저장 중이면 없고, 안 되는 까닭은 상태마다 다르다(전부 「로그인하지 않아…」였던 것)", () => {
  assert.equal(unsavedNote("saving"), null);
  const reasons: Exclude<SaveStatus, "saving">[] = ["guest", "load_failed", "signed_out", "account_changed", "conflict"];
  const notes = reasons.map((status) => unsavedNote(status));
  for (const note of notes) assert.ok(note && note.length > 0);
  assert.equal(new Set(notes).size, reasons.length, "상태마다 다른 문장");
  assert.match(unsavedNote("guest") ?? "", /로그인하지 않아/);
  assert.match(unsavedNote("signed_out") ?? "", /로그인이 풀려/);
  assert.doesNotMatch(unsavedNote("signed_out") ?? "", /로그인하지 않아/);
  assert.match(unsavedNote("account_changed") ?? "", /다른 계정/);
  assert.match(unsavedNote("load_failed") ?? "", /불러오지 못해/);
  assert.match(unsavedNote("conflict") ?? "", /다른 창/);
  assert.match(unsavedNote("conflict") ?? "", /새로고침/);
});

test("저장 실패 문구 — 끊김 · 계정 바뀜은 그 까닭을, 나머지는 부른 쪽의 연결 실패 문구를", () => {
  const connection = "저장하지 못했어요. 연결을 확인해 주세요.";
  assert.equal(saveFailureText("saving", connection), connection);
  assert.equal(saveFailureText("guest", connection), connection);
  assert.match(saveFailureText("signed_out", connection), /로그인이 풀려/);
  assert.match(saveFailureText("account_changed", connection), /다른 계정/);
  assert.match(saveFailureText("conflict", connection), /다른 창/);
});

test("처음부터 다시 — 세션이 끊긴 채로만 막는다", () => {
  assert.equal(restartBlockedReason("saving"), null);
  assert.equal(restartBlockedReason("guest"), null);
  assert.equal(restartBlockedReason("load_failed"), null);
  assert.ok(restartBlockedReason("signed_out"));
  assert.ok(restartBlockedReason("account_changed"));
  assert.ok(restartBlockedReason("conflict"), "다른 창이 저장한 뒤에는 옛 저장본으로 기록을 지우지 않는다");
});

test("409 본문의 사유 — detail.code 만 믿는다", () => {
  assert.equal(readConflictCode(CONFLICT), "save_conflict");
  assert.equal(readConflictCode({ detail: { code: "account_changed", message: "…" } }), "account_changed");
  assert.equal(readConflictCode({ detail: "Conflict" }), null);
  assert.equal(readConflictCode({ detail: { revision: 3 } }), null);
  assert.equal(readConflictCode(null), null);
});

test("같은 계정의 409 — 이미 저장하던 창이면 멈추고, 첫 저장이면 전처럼 다시 쓴다(페이지를 넘어올 때 앞 페이지의 마지막 저장과 겹친 것)", () => {
  assert.equal(decideSaveConflict(ME_A, "user-a", true), "conflict", "살아 있는 다른 창이 먼저 썼다 — 덮지 않는다");
  assert.equal(decideSaveConflict(ME_A, "user-a", false), "retry", "기차 → 나주 첫 저장");
  assert.equal(decideSaveConflict(me(0), "user-a", false), "retry");
  assert.equal(decideSaveConflict(me(0), "user-a", true), "conflict", "/me 가 잠깐 안 돼도 덮어쓰지는 않는다");
});

test("같은 계정의 409 — 계정 확인이 먼저다(끊김 · 계정 바뀜은 저장 여부와 상관없이 그쪽으로)", () => {
  for (const hasSavedOnce of [true, false]) {
    assert.equal(decideSaveConflict(me(401, { detail: "Login required." }), "user-a", hasSavedOnce), "signed_out");
    assert.equal(decideSaveConflict(ME_B, "user-a", hasSavedOnce), "account_changed");
  }
});

test("응답을 잃은 제 저장 가리기 — 서버 값이 보냈던 것과 같으면(키 순서는 달라도) 다른 창이 아니다", () => {
  const sent = { sections: { "naju.jars": { open: [1, 2] }, "main.inventory": ["coin"] } };
  const fromServer = { revision: 9, stage: "naju", state: { sections: { "main.inventory": ["coin"], "naju.jars": { open: [1, 2] } } } };
  assert.equal(isSameSave(fromServer, "naju", sent), true, "DB 가 키 순서를 바꿔 돌려줘도 같다");
  assert.equal(isSameSave(fromServer, "headquarters", sent), false, "단계가 다르면 남이 쓴 것");
  assert.equal(isSameSave({ ...fromServer, state: { sections: { "naju.jars": { open: [1, 2, 3] }, "main.inventory": ["coin"] } } }, "naju", sent), false);
  assert.equal(isSameSave({ ...fromServer, state: { sections: { "naju.jars": { open: [1, 2] } } } }, "naju", sent), false, "칸이 빠졌다");
  assert.equal(isSameSave(null, "naju", sent), false);
  assert.equal(isSameSave("oops", "naju", sent), false);
});
