/**
 * 나주 케이스 진행률(목적지 창) · 다시 접속하면 로비로. node --test naju01/tests/caseProgress.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { najuCaseProgress } from "../src/progress/caseProgress.ts";
import { LOBBY_PATH, LOBBY_SPOT, isLobbyStage, wantsLobbyEntry, withoutLobbyEntry } from "../../src/save/lobbyEntry.ts";

const reader = (sections: Record<string, unknown>) => (name: string) => (name in sections ? sections[name] : null);

test("나주에 들어온 적이 없으면 진행률이 없다 — 목적지 창은 「처음」으로 보인다", () => {
  assert.equal(najuCaseProgress(reader({})), null);
  assert.equal(najuCaseProgress(reader({ "main.tutorial": { step: 3 } })), null);
});

test("들어오기만 하고 아무것도 못 했어도 「하던 케이스」(0%)다", () => {
  const progress = najuCaseProgress(reader({ "naju.player": { x: 1, z: 2, yaw: 0 }, "naju.clam": "buried" }))!;
  assert.equal(progress.hasStarted, true);
  assert.equal(progress.percent, 0);
  assert.equal(progress.stageName, "나루터");
  assert.equal(progress.isCleared, false);
});

test("이정표를 셀수록 오르고, 지금 스테이지 이름이 따라간다", () => {
  const dock = najuCaseProgress(
    reader({ "naju.player": {}, "naju.clam": "held", "naju.fishTrap": { stage: "pulled", isGuideAhead: false } }),
  )!;
  assert.equal(dock.done, 2);
  assert.equal(dock.stageName, "나루터");
  const rock = najuCaseProgress(
    reader({
      "naju.player": {},
      "naju.clam": "baited",
      "naju.fishTrap": { stage: "told", isGuideAhead: true },
      "naju.jars": "open",
      "naju.ritual": "drawing",
    }),
  )!;
  assert.equal(rock.done, 4 + 2);
  assert.equal(rock.stageName, "바위 아래");
  assert.ok(rock.percent > dock.percent);
});

test("스테이지별 숫자를 함께 준다 — 마이페이지가 스테이지마다 몇 개 했는지 그린다", () => {
  const progress = najuCaseProgress(
    reader({ "naju.player": {}, "naju.clam": "held", "naju.fishTrap": { stage: "pulled", isGuideAhead: false } }),
  )!;
  assert.deepEqual(
    progress.stages.map((stage) => stage.name),
    ["나루터", "바위 아래", "물굴", "능선", "바위 위", "굿판"],
  );
  assert.deepEqual(progress.stages[0], { name: "나루터", done: 2, total: 4 });
  assert.equal(progress.stages[1].done, 0);
  // 합은 전체와 같다
  assert.equal(
    progress.stages.reduce((sum, stage) => sum + stage.done, 0),
    progress.done,
  );
  assert.equal(
    progress.stages.reduce((sum, stage) => sum + stage.total, 0),
    progress.total,
  );
});

test("뒤 스테이지에 손을 댔으면 앞 스테이지는 다 한 것으로 센다(옛 저장 · 빠진 칸)", () => {
  const progress = najuCaseProgress(
    reader({ "naju.player": {}, "naju.ridge": { stage: "sealed" }, "naju.ridgeQuest": { chestOnAltar: true } }),
  )!;
  // 나루터 4 · 바위 아래 6 · 물굴 6 은 다 했고, 능선은 둘(sealing · 궤)
  assert.equal(progress.done, 4 + 6 + 6 + 2);
  assert.equal(progress.stageName, "능선");
});

test("끝은 굿판이 동트기(gut.dawn)까지 — 물굴을 나온 것(ritual.cleared)이 아니다. 끝내기 전에는 100% 가 아니다", () => {
  const caveDone = najuCaseProgress(reader({ "naju.player": {}, "naju.ritual": "cleared" }))!;
  assert.equal(caveDone.isCleared, false);
  assert.equal(caveDone.stageName, "능선");
  const released = najuCaseProgress(reader({ "naju.player": {}, "naju.puzzleMemory": { gut: { stage: "released", lit: 0 } } }))!;
  assert.equal(released.isCleared, false);
  assert.ok(released.percent < 100);
  assert.equal(released.stageName, "굿판");
  const cleared = najuCaseProgress(reader({ "naju.player": {}, "naju.puzzleMemory": { gut: { stage: "dawn", lit: 0 } } }))!;
  assert.deepEqual([cleared.isCleared, cleared.percent, cleared.stageName], [true, 100, "완료"]);
});

test("되돌아가는 값(횃불 수 · 가락지를 올린 굿판 rite)은 세지 않는다 — 진행률이 뒤로 가지 않게", () => {
  const at = (gut: Record<string, unknown>) =>
    najuCaseProgress(reader({ "naju.player": {}, "naju.puzzleMemory": { gut, cliff: { stage: "crossed" } } }))!;
  const lit = at({ stage: "rite", lit: 4 });
  assert.equal(lit.done, at({ stage: "rite", lit: 0 }).done);
  // 가락지를 도로 집으면 rite → waiting(gut.pause) — 같은 값이어야 한다
  assert.equal(lit.done, at({ stage: "waiting", lit: 0 }).done);
  assert.ok(at({ stage: "released", lit: 0 }).done > lit.done);
});

// ── 다시 접속하면 로비로 ──

test("본부실에 들어선 뒤(본부실 · 기차 · 나주)면 로비에서 시작하고, 튜토리얼 중이면 나갔던 자리에서 잇는다", () => {
  for (const stage of ["headquarters", "train", "naju"] as const) assert.equal(isLobbyStage(stage), true, stage);
  for (const stage of ["character", "tutorial", null] as const) assert.equal(isLobbyStage(stage), false, String(stage));
  assert.equal(LOBBY_PATH, "/?entry=lobby");
});

test("로비 표시는 저장 단계가 맞을 때만 받는다 — 주소만으로 본부실을 열지 않는다(나주에서 방금 나온 탭은 저장 없이도)", () => {
  assert.equal(wantsLobbyEntry("?entry=lobby", null, true), true, "로그인하지 않고 나주에서 나왔다");
  assert.equal(wantsLobbyEntry("", null, true), false);
  assert.equal(wantsLobbyEntry("?entry=lobby", "naju"), true);
  assert.equal(wantsLobbyEntry("?entry=lobby&fps", "train"), true);
  assert.equal(wantsLobbyEntry("?entry=lobby", "tutorial"), false);
  assert.equal(wantsLobbyEntry("", "naju"), false);
  assert.equal(wantsLobbyEntry("?entry=other", "naju"), false);
});

test("읽은 뒤에는 주소에서 로비 표시만 지운다(다른 질의 · 경로 · 해시는 그대로)", () => {
  assert.equal(withoutLobbyEntry("https://play.k-escape.com/?entry=lobby"), "/");
  assert.equal(withoutLobbyEntry("https://play.k-escape.com/?fps&entry=lobby#x"), "/?fps=#x");
});

test("로비 자리는 본부실 안(x −20~16 · z −14~12)이고 비밀 복도 문(x −20 · z 4)에서 5m 넘게 안쪽이다", () => {
  assert.ok(LOBBY_SPOT.x > -20 && LOBBY_SPOT.x < 16 && LOBBY_SPOT.z > -14 && LOBBY_SPOT.z < 12);
  assert.ok(Math.hypot(LOBBY_SPOT.x + 20, LOBBY_SPOT.z - 4) > 5);
});
