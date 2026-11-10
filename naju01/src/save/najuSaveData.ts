/** 나주 저장 칸의 모양. */
import { readSavedSection, registerSaveSection, scheduleGameSave } from "@/save/gameSave";

import { clamDig, type ClamStage } from "../puzzles/fishTrap/clamState";
import { fishTrapPuzzle } from "../puzzles/fishTrap/fishTrapState";
import { inventory, type SavedInventory } from "../puzzles/inventory";
import { jarPuzzle } from "../puzzles/jars/jarState";
import { makgeolliBottle } from "../puzzles/makgeolli/makgeolliState";
import { ridge, ridgeCarry, ridgeQuest } from "../puzzles/ridge/ridgeState";
import { ritual, type RitualStage } from "../puzzles/ritual/ritualState";
import { helpLog } from "../progress/helpLog";
import { playClock } from "../progress/playClock";
import { registerPuzzleMemory } from "./puzzleMemory";

export const PLAYER_SECTION = "naju.player";

export interface SavedNajuPlayer {
  x: number;
  z: number;
  yaw: number;
}

/** 시작 자리 [x, z]. 저장이 없으면 null — 원래 시작 지점을 쓴다. */
export function savedNajuStart(): [number, number] | null {
  const saved = readSavedSection<SavedNajuPlayer>(PLAYER_SECTION);
  return saved ? [saved.x, saved.z] : null;
}

/** 게임을 그리기 전에 한 번 부른다. 퍼즐 단계를 자리보다 먼저 넣어 열린 영역이 맞게 잡히게 한다. */
export function registerNajuSave(): void {
  registerPuzzleMemory();
  registerSaveSection("naju.fishTrap", {
    read: () => ({ stage: fishTrapPuzzle.stage(), isGuideAhead: fishTrapPuzzle.guideAhead() }),
    apply: (value) => fishTrapPuzzle.restore(value as Parameters<typeof fishTrapPuzzle.restore>[0]),
  });
  registerSaveSection("naju.clam", {
    read: () => clamDig.stage(),
    // 통발에 넣던 중이면 넣을 통발 정보가 사라지므로 조개를 든 때로 돌아간다.
    apply: (value) => clamDig.set(value === "baiting" ? "held" : (value as ClamStage)),
  });
  registerSaveSection("naju.jars", {
    read: () => jarPuzzle.stage(),
    apply: (value) => {
      if (value === "open") jarPuzzle.open();
    },
  });
  registerSaveSection("naju.makgeolli", {
    read: () => makgeolliBottle.isTaken(),
    apply: (value) => makgeolliBottle.restore(value === true),
  });
  registerSaveSection("naju.ritual", {
    read: () => ritual.stage(),
    apply: (value) => ritual.restore(value as RitualStage),
  });
  registerSaveSection("naju.ridge", {
    read: () => ({ stage: ridge.stage(), releaseFrom: ridge.releaseFrom() }),
    apply: (value) => ridge.restore(value as Parameters<typeof ridge.restore>[0]),
  });
  registerSaveSection("naju.ridgeQuest", {
    read: () => ({
      chestOnAltar: ridgeQuest.chestOnAltar,
      postsSolved: ridgeQuest.postsSolved,
      stairs: ridgeQuest.stairs,
      birdsFacing: ridgeQuest.birdsFacing,
      scaleSet: ridgeQuest.scaleSet,
    }),
    apply: (value) => ridgeQuest.restore(value as Parameters<typeof ridgeQuest.restore>[0]),
  });
  registerSaveSection("naju.ridgeCarry", {
    read: () => ({ load: ridgeCarry.load, putDown: ridgeCarry.putDown }),
    apply: (value) => Object.assign(ridgeCarry, value),
  });
  // 조사 시간(경과 시간 · 시간 별, 미르 11/11) — 1초마다 바뀌므로 자동 저장 신호에는 넣지 않는다(playClock 이 1분마다 저장을 부른다)
  registerSaveSection("naju.playTime", {
    read: () => playClock.read(),
    apply: (value) => playClock.restore(value),
  });
  // 직접 청한 도움(도움 별, 미르 11/11) — 셀 때마다 저장을 부른다(helpLog)
  registerSaveSection("naju.helpLog", {
    read: () => helpLog.read(),
    apply: (value) => helpLog.restore(value),
  });
  registerSaveSection("naju.inventory", {
    read: () => inventory.snapshot(),
    apply: (value) => inventory.restore(value as SavedInventory),
  });
  for (const subscribe of [
    fishTrapPuzzle.subscribe,
    clamDig.subscribe,
    jarPuzzle.subscribe,
    ritual.subscribe,
    ridge.subscribe,
    ridgeQuest.subscribe,
    inventory.subscribe,
  ]) {
    subscribe(scheduleGameSave);
  }
}
