/**
 * 증언 능선 3스테이지 진행.
 *   idle      아직 능선에 오르지 않았다
 *   sealing   들어서자 바람이 미친 듯이 휘몰아치고 안개가 걷히며 바람 장막이 내려온다
 *   sealed    장막 안에 갇혔다 — 안에서 차례로 푼다(ridgeQuest):
 *               지게로 궤를 수레에 싣고 진부촌 문 돌단에 올린다 → 횃불에 불이 붙는다
 *               → 장승 고리를 궤 뚜껑의 글대로 맞춘다 → 횃불이 커지고 바람이 잦아든다
 *               → 통나무 걸상을 도끼 자국 차례로 밟는다 → 걸상이 바람에 떠올라 돌새 곁 계단이 된다
 *               → 등진 두 돌새를 서로 마주 보게 돌리고 → 두 기둥 사이 화석 자리에 푸른 비늘을 맞춰 넣는다
 *   awakening 기둥이 떨리다 돌 껍질이 깨지고 장막이 풀린다. 진짜 새가 된다. 장막 밖에 새 떼가 모여 기다린다
 *   circling  두 새가 하늘을 한 바퀴 반 돌고, 열쇠를 문 새가 플레이어 앞에 열쇠를 떨어뜨린다
 *   leaving   두 새가 풀린 장막 위로 새 떼와 함께 멀리 날아간다
 *   rift      진부촌 문 횃불에 불이 들어오고 장승 사이에 시공간 틈이 열려 그날 밤의 강을 보여 준다
 *   done      틈이 닫혔다
 */
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

export type RidgeStage = "idle" | "sealing" | "sealed" | "awakening" | "circling" | "leaving" | "rift" | "done";

const ORDER: RidgeStage[] = ["idle", "sealing", "sealed", "awakening", "circling", "leaving", "rift", "done"];

const signal = createChangeSignal();
let stage: RidgeStage = "idle";
let stageAt = 0;
/** 장막이 얼마나 쳐져 있나 0~1 — 장막 그림이 매 프레임 적는다. 0.5 넘으면 밖으로 못 나간다 */
let curtainClosed = 0;
/** 깨어난 새가 장막을 뚫고 나간 자리(둘레 0~1) — 여기서부터 장막이 찢어져 풀린다 */
let releaseFrom: number | null = null;
/** 플레이어가 장막에 마지막으로 부딪힌 자리(둘레 0~1 · 시각 초) — 장막이 그 자리에서 물결친다 */
let lastTouch = { t: 0, at: -99 };

const now = () => performance.now() / 1000;

export const ridge = {
  stage: () => stage,
  subscribe: signal.subscribe,
  /** 지금 단계에 들어선 지 몇 초 */
  elapsed: () => now() - stageAt,
  isAtLeast: (at: RidgeStage) => ORDER.indexOf(stage) >= ORDER.indexOf(at),
  /** 앞으로만 간다 — 같은 단계를 두 번 알리지 않는다 */
  advance(next: RidgeStage) {
    if (ORDER.indexOf(next) <= ORDER.indexOf(stage)) return;
    stage = next;
    stageAt = now();
    signal.notify();
  },
  curtainClosed: () => curtainClosed,
  setCurtainClosed(value: number) {
    curtainClosed = value;
  },
  releaseFrom: () => releaseFrom,
  breakCurtainAt(t: number) {
    if (releaseFrom === null) releaseFrom = t;
  },
  lastTouch: () => lastTouch,
  touchCurtain(t: number) {
    lastTouch = { t, at: now() };
  },
  /** 장막 안에 가둬야 하나 */
  isConfining: () => curtainClosed > 0.5,
  reset() {
    stage = "idle";
    stageAt = now();
    curtainClosed = 0;
    releaseFrom = null;
    signal.notify();
  },
};

export const useRidgeStage = () => useSyncExternalStore(signal.subscribe, ridge.stage);

/**
 * 등짐 — 장막 안에서 끌어 내린 지게를 지면 무거운 궤를 나를 수 있다.
 *   none 빈 몸 · jige 지게만 · jigeChest 지게에 궤를 얹었다. putDown 은 지게를 내려놓을 자리(수레 곁)
 */
export const ridgeCarry: {
  load: "none" | "jige" | "jigeChest";
  putDown: { x: number; z: number } | null;
} = { load: "none", putDown: null };

export type RidgeQuestKey = "chestOnAltar" | "postsSolved" | "stairs" | "birdsFacing" | "scaleSet";

/** 장막 안 퍼즐 진행 — 앞으로만 간다. calm 은 바람이 잦아든 정도(0~1, 장막 그림이 매 프레임 따라 적는다) */
const questSignal = createChangeSignal();
let questVersion = 0;
export const ridgeQuest = {
  chestOnAltar: false,
  postsSolved: false,
  stairs: false,
  birdsFacing: false,
  scaleSet: false,
  calm: 0,
  subscribe: questSignal.subscribe,
  set(key: RidgeQuestKey) {
    if (ridgeQuest[key]) return;
    ridgeQuest[key] = true;
    questVersion++;
    questSignal.notify();
  },
};
export const useRidgeQuest = () => useSyncExternalStore(questSignal.subscribe, () => questVersion);

/** 퍼즐을 건너뛰고 뒤 연출을 볼 때 — 돌새 쪽이 풀이를 등록한다 */
export const ridgeDev: { solve: (() => void) | null } = { solve: null };

exposeDevHook("najuRidge", {
  stage: ridge.stage,
  quest: () => ({ ...ridgeQuest }),
  setQuest: (key: RidgeQuestKey) => ridgeQuest.set(key),
  seal: () => ridge.advance("sealing"),
  solve: () => ridgeDev.solve?.(),
  reset: ridge.reset,
});
