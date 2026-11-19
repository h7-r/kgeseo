/** 그래픽 품질 자동 판정 — 내장 그래픽 · 메모리 4GB 이하만 저사양. node --test naju01/tests/quality.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";

import { detectQuality, isWeakGpuName } from "../../shared/qualityChoice.ts";

test("내장 그래픽 · 소프트웨어 렌더러는 저사양, 외장 · 애플 · Arc 는 기본", () => {
  const weak = [
    "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
  ];
  const strong = [
    "ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max, Unspecified Version)",
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) Arc(TM) A750 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
  ];
  for (const name of weak) assert.equal(isWeakGpuName(name), true, name);
  for (const name of strong) assert.equal(isWeakGpuName(name), false, name);
});

test("메모리 4GB 이하면 그래픽 이름과 상관없이 저사양 — 8(상한)은 기본", () => {
  assert.equal(detectQuality("NVIDIA GeForce RTX 3060", 4), "low");
  assert.equal(detectQuality("NVIDIA GeForce RTX 3060", 8), "standard");
  assert.equal(detectQuality("", undefined), "standard");
  assert.equal(detectQuality("Intel(R) Iris(R) Xe Graphics", 8), "low");
});

test("다시 시작 횟수 — 깨진 저장값은 0, 올리고 되돌린다", async () => {
  const { attemptCount, readRestarts } = await import("../src/progress/attemptCount.ts");
  assert.equal(readRestarts(undefined), 0);
  assert.equal(readRestarts({ restarts: "x" }), 0);
  assert.equal(readRestarts({ restarts: 2.7 }), 2);
  attemptCount.restore({ restarts: 1 });
  attemptCount.bump();
  assert.deepEqual(attemptCount.read(), { restarts: 2 });
  attemptCount.undo();
  assert.equal(attemptCount.restarts(), 1);
});
