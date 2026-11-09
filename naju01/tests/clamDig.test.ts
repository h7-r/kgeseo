// P01 조개 숨구멍 — 서버로 보내는 답 모양과 이어 하기 기록(clamAnswer).
//   node --test naju01/tests/clamDig.test.ts
// 판정은 시험용 가짜(FAKE_CLAMS)로 대신한다 — 실제 정답은 서버에만 있다.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CLAM_HOLE_COUNT,
  clamDugAnswer,
  deriveFound,
  dugHoles,
  restoreClamProgress,
} from "../src/puzzles/fishTrap/clamAnswer.ts";

const FAKE_CLAMS = [1, 2, 5];
const isFakeClam = (hole: number) => FAKE_CLAMS.includes(hole);

/** puzzleMemory 흉내 — 저장할 때 tracker 를 읽어 JSON 으로 남기고, 불러올 때 그대로 돌려준다 */
const saveAndLoad = (memory: Record<string, unknown>) => JSON.parse(JSON.stringify(memory)) as Record<string, unknown>;
const restoreFrom = (memory: Record<string, unknown>) =>
  restoreClamProgress({ isDug: memory["clam.isDug"], found: memory["clam.found"], pinches: memory["clam.pinches"] });

/** 남은 구멍을 차례로 판다 — 조개가 나오면 찾은 구멍에 더한다. 다 찾았는지는 판 구멍 목록으로 가린다 */
function digRest(isDug: boolean[], found: number[]) {
  const next = [...found];
  for (let hole = 0; hole < CLAM_HOLE_COUNT; hole++) {
    if (isDug[hole]) continue;
    isDug[hole] = true;
    if (isFakeClam(hole)) next.push(hole);
  }
  return { found: next, done: FAKE_CLAMS.every((clam) => dugHoles(isDug).includes(clam)) };
}

test("답 — 판 구멍 번호를 작은 수부터 쉼표로(공백 없이)", () => {
  assert.equal(clamDugAnswer([4, 1, 6]), "1,4,6");
  assert.equal(clamDugAnswer([]), "");
  assert.throws(() => clamDugAnswer([1, 1]));
  assert.throws(() => clamDugAnswer([7]));
  assert.throws(() => clamDugAnswer([-1]));
  assert.deepEqual(dugHoles([false, true, false, true]), [1, 3]);
});

test("이어 하기 버그 재현 — 옛 저장본(clam.isDug 만)에서 캔 수를 0 부터 세면 남은 조개를 다 파도 수가 안 찬다", () => {
  // 조개 하나 · 헛구멍 하나를 판 채 저장
  const saved = saveAndLoad({ "clam.isDug": [false, true, false, true, false, false, false] });
  const restored = restoreFrom(saved);
  const oldCount = digRest([...restored.isDug], []).found.length;
  assert.ok(oldCount < FAKE_CLAMS.length, "옛 방식은 수가 모자란다");

  // 고친 뒤: 찾은 구멍 기록이 없음(null)을 알리고, 판정으로 다시 가려 캔 수를 되살린다
  assert.equal(restored.found, null);
  const found = deriveFound(restored.isDug, isFakeClam);
  assert.deepEqual(found, [1]);
  const after = digRest([...restored.isDug], found);
  assert.equal(after.found.length, FAKE_CLAMS.length);
  assert.ok(after.done);
});

test("새 저장본 — 판 구멍 · 찾은 구멍 · 꼬집힌 수가 저장 왕복 뒤 그대로다(옛 열쇠 clam.isDug 모양도 그대로)", () => {
  const isDug = [false, true, true, true, false, false, false];
  const saved = saveAndLoad({ "clam.isDug": isDug, "clam.found": [2, 1], "clam.pinches": 1 });
  assert.deepEqual(saved["clam.isDug"], isDug);
  const restored = restoreFrom(saved);
  assert.deepEqual(restored, { isDug, found: [2, 1], pinches: 1 });
  const after = digRest([...restored.isDug], restored.found!);
  assert.equal(after.found.length, FAKE_CLAMS.length);
});

test("어긋난 값은 버린다 — 안 판 구멍 · 범위 밖 · 중복 · 음수 꼬집힘 · 배열 아님", () => {
  const restored = restoreFrom({
    "clam.isDug": [true, true, "yes", null],
    "clam.found": [1, 1, 2, 9, -1, "0", 0],
    "clam.pinches": -2,
  });
  assert.deepEqual(restored.isDug, [true, true, false, false, false, false, false]);
  assert.deepEqual(restored.found, [1, 0]);
  assert.equal(restored.pinches, 0);
  const empty = restoreFrom({ "clam.isDug": "broken" });
  assert.deepEqual(empty, { isDug: Array(CLAM_HOLE_COUNT).fill(false), found: null, pinches: 0 });
});
