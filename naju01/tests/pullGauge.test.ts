// 통발 줄 당기기 게이지 계산(puzzles/fishTrap/gaugeMath) — 판이 바뀌어도 막대가 이어 움직이고, 새 칸은 막대 코앞에 오지 않는다(미르 11/12)
//   node --test naju01/tests/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { continuedStart, cursorAt, pickZone, reachSeconds, type ZoneChoice } from "../src/puzzles/fishTrap/gaugeMath.ts";

const near = (actual: number, expected: number, label: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`);

test("막대는 왼쪽 끝에서 출발해 sweep 초에 오른쪽 끝, 다시 sweep 초에 왼쪽 끝 — 출발 전은 왼쪽 끝", () => {
  assert.deepEqual(cursorAt(-100, 1.5), { position: 0, direction: 1 });
  near(cursorAt(750, 1.5).position, 0.5, "반쯤");
  assert.equal(cursorAt(750, 1.5).direction, 1);
  near(cursorAt(2250, 1.5).position, 0.5, "되돌아오는 반쯤");
  assert.equal(cursorAt(2250, 1.5).direction, -1);
  near(cursorAt(3000, 1.5).position, 0, "한 바퀴");
});

test("판이 바뀌면 같은 자리 · 같은 방향에서 새 빠르기로 잇는다(순간이동 · 멈춤 없음)", () => {
  const now = 10_000;
  for (const cursor of [
    { position: 0.42, direction: 1 as const },
    { position: 0.61, direction: -1 as const },
    { position: 0.05, direction: -1 as const },
  ]) {
    const startedAt = continuedStart(now, cursor, 1.15);
    const after = cursorAt(now - startedAt, 1.15);
    near(after.position, cursor.position, "같은 자리");
    assert.equal(after.direction, cursor.direction, "같은 방향");
    // 바로 다음 프레임(16ms)에 이미 그 방향으로 움직이고 있다
    const next = cursorAt(now + 16 - startedAt, 1.15).position;
    assert.ok((next - cursor.position) * cursor.direction > 0, "다음 프레임에 움직인다");
  }
});

test("칸에 닿는 시간 — 안이면 0, 앞에 있으면 거리만큼, 지나쳤으면 끝에서 되돌아오는 길까지", () => {
  assert.equal(reachSeconds({ position: 0.5, direction: 1 }, 0.4, 0.6, 1), 0);
  near(reachSeconds({ position: 0.2, direction: 1 }, 0.4, 0.6, 1), 0.2, "앞");
  near(reachSeconds({ position: 0.8, direction: 1 }, 0.4, 0.6, 1), 0.2 + 0.4, "지나침(오른쪽 끝 갔다 옴)");
  near(reachSeconds({ position: 0.8, direction: -1 }, 0.4, 0.6, 2), 0.2 * 2, "왼쪽으로 앞");
  near(reachSeconds({ position: 0.2, direction: -1 }, 0.4, 0.6, 1), 0.2 + 0.4, "지나침(왼쪽 끝 갔다 옴)");
});

const SECOND: ZoneChoice[] = [0.3, 0.36].flatMap((left) => [
  { center: left, isRight: false },
  { center: 1 - left, isRight: true },
]);

test("둘째 칸은 막대가 닿기까지 0.3 초 넘게 남는 자리에서만 — 막대가 이미 들어가 있는 칸은 고르지 않는다", () => {
  // 첫 판 가운데 칸 오른쪽 가장자리(.62)에서 맞히고 오른쪽으로 가는 중 — 오른쪽 .64 칸은 이미 막대 밑이다
  const cursor = { position: 0.62, direction: 1 as const };
  for (let i = 0; i < 20; i++) {
    const choice = pickZone(SECOND, 0.15, cursor, 0.78, 0.3, () => i / 20);
    const seconds = reachSeconds(cursor, choice.center - 0.075, choice.center + 0.075, 0.78);
    assert.ok(seconds >= 0.3, `${choice.center} 는 ${seconds.toFixed(2)} 초 만에 닿는다`);
  }
});

test("셋째(반대편 고정)에서 0.3 초를 못 채우면 가장 오래 걸리는 자리", () => {
  // 둘째 왼쪽 칸 오른쪽 끝(.435)에서 맞히고 오른쪽으로 — 셋째 오른쪽 칸 .70 · .76 둘 다 0.3 초 안에 닿는다(셋째 칸 .14 · 0.60 초)
  const cursor = { position: 0.435, direction: 1 as const };
  const third: ZoneChoice[] = [0.24, 0.3].map((left) => ({ center: 1 - left, isRight: true }));
  const choice = pickZone(third, 0.14, cursor, 0.6, 0.3, () => 0);
  near(choice.center, 0.76, "더 먼 .76");
  const seconds = reachSeconds(cursor, 0.69, 0.83, 0.6);
  assert.ok(seconds > 0.14 && seconds < 0.2, `셋째 최장 ${seconds}`);
});
