import assert from "node:assert/strict";
import { test } from "node:test";

import { activeFrameLimit, estimateRefreshMs, refreshesPerFrame } from "../../src/engine/frameLimit.ts";

const fpsAt = (hz: number, limit: number) => Math.round(hz / refreshesPerFrame(1000 / hz, limit));

test("상한 60 — 주사율별로 고르게 건너뛴다", () => {
  assert.equal(fpsAt(60, 60), 60);
  assert.equal(fpsAt(75, 60), 75);
  assert.equal(fpsAt(90, 60), 90);
  assert.equal(fpsAt(100, 60), 100);
  assert.equal(fpsAt(120, 60), 60);
  assert.equal(fpsAt(144, 60), 72);
  assert.equal(fpsAt(165, 60), 83);
  assert.equal(fpsAt(240, 60), 60);
  assert.equal(fpsAt(180, 60), 60);
  assert.equal(fpsAt(200, 60), 67);
  assert.equal(fpsAt(360, 60), 60);
  // 어림이 조금 낮게 잡혀도 같은 칸
  assert.equal(refreshesPerFrame(1000 / 119.4, 60), 2);
  assert.equal(refreshesPerFrame(1000 / 59.6, 60), 1);
});

test("상한 120 · 제한 없음", () => {
  assert.equal(fpsAt(144, 120), 144);
  assert.equal(fpsAt(240, 120), 120);
  assert.equal(fpsAt(360, 120), 120);
  assert.equal(fpsAt(240, 0), 240);
});

test("주사율 어림 — 밀린 프레임이 섞여도 화면 간격을 잡는다", () => {
  assert.equal(estimateRefreshMs([6.9, 7]), null);
  const deltas = Array.from({ length: 60 }, (_, index) => (index % 3 === 0 ? 13.9 : 6.94));
  assert.equal(estimateRefreshMs(deltas), 6.94);
});

test("상한 30(절전) — 60Hz 는 반, 그 밖은 30 바로 위로", () => {
  assert.equal(fpsAt(60, 30), 30);
  assert.equal(fpsAt(120, 30), 30);
  assert.equal(fpsAt(144, 30), 36);
  assert.equal(fpsAt(240, 30), 30);
  assert.equal(fpsAt(75, 30), 38);
});

test("임시 상한 — 설정보다 낮을 때만 쓴다", () => {
  assert.equal(activeFrameLimit(60, 10), 10);
  assert.equal(activeFrameLimit(60, 0), 60);
  assert.equal(activeFrameLimit(30, 60), 30);
  assert.equal(activeFrameLimit(0, 30), 30);
  assert.equal(activeFrameLimit(0, 0), 0);
});
