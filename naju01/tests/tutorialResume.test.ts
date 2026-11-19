/**
 * 다시 접속했을 때의 시작(미르 11/10 튜토리얼 재접속 정리). node --test naju01/tests/tutorialResume.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { TUTORIAL_SECTIONS, isInsideHeadquarters, resumeKindFor, skipsOpening } from "../../src/save/resumePolicy.ts";

const CORRIDOR = { position: [-22.5, 4.15, 4], yaw: 3.1 };
const HEADQUARTERS = { position: [-13, 4.15, 4], yaw: 0 };

test("저장이 없으면(처음 · 로그인 안 함) 처음 시작이다", () => {
  assert.equal(resumeKindFor({ stage: null }), "new");
  assert.equal(resumeKindFor({ stage: null, stationPose: CORRIDOR }), "new");
});

test("튜토리얼 중에 나갔으면 처음부터 다시 — 자판기 앞이든 튜토리얼 완료 안내 뒤든", () => {
  assert.equal(resumeKindFor({ stage: "tutorial" }), "restartTutorial");
  assert.equal(resumeKindFor({ stage: "tutorial", stationPose: CORRIDOR }), "restartTutorial");
});

test("본부실에 들어선 뒤면(본부실 · 기차 · 나주) 로비에서", () => {
  for (const stage of ["headquarters", "train", "naju"] as const) assert.equal(resumeKindFor({ stage }), "afterTutorial");
  // 복도 자리가 남아 있어도 단계가 본부실 뒤면 로비
  assert.equal(resumeKindFor({ stage: "headquarters", stationPose: CORRIDOR }), "afterTutorial");
});

test("단계가 튜토리얼로 내려가 적힌 옛 저장도 본부실 · 기차 · 나주 흔적이 있으면 튜토리얼 뒤로 본다", () => {
  assert.equal(resumeKindFor({ stage: "tutorial", stationPose: HEADQUARTERS }), "afterTutorial");
  assert.equal(resumeKindFor({ stage: "tutorial", hasTrainPose: true }), "afterTutorial");
  assert.equal(resumeKindFor({ stage: "tutorial", hasNajuProgress: true }), "afterTutorial");
});

test("본부실 안 자리 판정 — 서쪽 벽(x −20)에서 0.5 안쪽부터, 문턱 · 복도 · 이상한 값은 아니다", () => {
  assert.equal(isInsideHeadquarters(HEADQUARTERS), true);
  assert.equal(isInsideHeadquarters({ position: [-19.4, 4, 4] }), true);
  assert.equal(isInsideHeadquarters({ position: [-19.6, 4, 4] }), false);
  assert.equal(isInsideHeadquarters(CORRIDOR), false);
  assert.equal(isInsideHeadquarters(null), false);
  assert.equal(isInsideHeadquarters({ position: "x" }), false);
});

test("오프닝은 처음 한 번만 — 저장 단계가 있으면 틀지 않는다", () => {
  assert.equal(skipsOpening(null), false);
  assert.equal(skipsOpening("tutorial"), true);
  assert.equal(skipsOpening("headquarters"), true);
  assert.equal(skipsOpening("naju"), true);
});

test("처음부터 다시 할 때 넣지 않는 칸 — 위치 · 단계 · 소지품. 나주 칸은 건드리지 않는다", () => {
  for (const name of ["main.tutorial", "main.inventory", "main.stationPose"]) assert.ok(TUTORIAL_SECTIONS.includes(name));
  assert.ok(!TUTORIAL_SECTIONS.some((name) => name.startsWith("naju.")));
});
