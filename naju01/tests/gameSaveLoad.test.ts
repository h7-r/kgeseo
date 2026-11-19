// 계정 저장 불러오기 결과 · 「저장을 불러오지 못했어요」 안내(src/save/gameSaveLoad — 본편 · 나주가 같이 쓴다, 11/12 베타 전 수정).
//   node --test naju01/tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SAVE_LOAD_FAILED_TEXT,
  canSaveAfter,
  createSaveLoadNotice,
  loadGameSave,
} from "../../src/save/gameSaveLoad.ts";

const SAVE = { revision: 3, stage: "naju", state: { sections: { "naju.case": { a: 1 } } } };
const answer = (status: number, body: unknown = null) => () => Promise.resolve({ status, body });

test("불러오기 실패(연결 · 500 · 503 · 모양이 틀림)면 저장을 멈추고 안내가 뜬다", async () => {
  const failures = [
    () => Promise.reject(new TypeError("fetch failed")),
    answer(500, { detail: "Internal Server Error" }),
    answer(503),
    answer(403, { detail: "Origin not allowed." }),
    answer(200, { revision: 3 }),
    answer(200, "oops"),
  ];
  for (const request of failures) {
    const outcome = await loadGameSave(request);
    assert.equal(outcome.kind, "failed");
    assert.equal(canSaveAfter(outcome), false, "저장은 멈춘다(지금 동작 그대로)");
    const notice = createSaveLoadNotice();
    notice.report(outcome);
    assert.equal(notice.isShown(), true, "안내가 뜬다");
  }
});

test("로그인 안 함(401)은 실패가 아니다 — 안내 없이 저장 없이 시작한다", async () => {
  const outcome = await loadGameSave(answer(401, { detail: "Login required." }));
  assert.deepEqual(outcome, { kind: "guest" });
  assert.equal(canSaveAfter(outcome), false);
  const notice = createSaveLoadNotice();
  notice.report(outcome);
  assert.equal(notice.isShown(), false);
});

test("불러왔으면(200) 저장한다 — 저장이 없으면(null) 새로 시작, 안내 없음", async () => {
  const loaded = await loadGameSave(answer(200, SAVE));
  assert.deepEqual(loaded, { kind: "loaded", save: SAVE });
  assert.equal(canSaveAfter(loaded), true);
  const empty = await loadGameSave(answer(200, null));
  assert.deepEqual(empty, { kind: "loaded", save: null });
  assert.equal(canSaveAfter(empty), true);
  const notice = createSaveLoadNotice();
  notice.report(loaded);
  notice.report(empty);
  assert.equal(notice.isShown(), false);
});

test("안내는 닫을 수 있고, 닫아도 다시 뜨지 않는다 — 닫은 뒤에도 저장은 멈춘 그대로(새로고침해야 다시 불러온다)", async () => {
  const outcome = await loadGameSave(answer(500));
  const notice = createSaveLoadNotice();
  let changes = 0;
  notice.subscribe(() => changes++);
  notice.report(outcome);
  notice.report(outcome);
  assert.equal(changes, 1, "같은 실패를 두 번 알려도 한 번");
  notice.dismiss();
  assert.equal(notice.isShown(), false);
  notice.report(outcome);
  assert.equal(notice.isShown(), false, "닫은 뒤 다시 뜨지 않는다");
  assert.equal(canSaveAfter(outcome), false);
});

test("안내 문구는 정한 그대로다", () => {
  assert.equal(SAVE_LOAD_FAILED_TEXT.title, "저장을 불러오지 못했어요. 지금 새로고침해 주세요");
});

test("본편 · 나주 둘 다 — gameSave 가 결과로 저장 여부를 정하고 실패를 알리며, 두 부팅이 안내를 그린다", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const gameSave = read("../../src/save/gameSave.ts");
  assert.match(gameSave, /isLoggedIn = canSaveAfter\(outcome\)/, "실패면 isLoggedIn 거짓 — 저장 멈춤");
  assert.match(gameSave, /saveLoadNotice\.report\(outcome\)/);
  for (const boot of ["../../src/boot.tsx", "../src/boot.tsx"]) {
    const source = read(boot);
    assert.match(source, /initGameSave\(\)/, `${boot} 이 저장을 불러온다`);
    assert.match(source, /<SaveLoadFailedNotice \/>/, `${boot} 이 안내를 그린다`);
  }
});
