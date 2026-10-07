/**
 * 소화전 밸브가 돌면 음료 자판기가 옆으로 밀려난다(비밀문).
 * 밀린 정도는 매 프레임 바뀌어 모듈 바깥에 둔다. 자판기 그룹은 매 프레임 position 을 직접 만지고,
 * 길이가 늘어야 하는 배전관은 지오를 다시 떠야 해서 0.08 유닛 칸으로 끊어 알린다.
 */
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

let progress = 0; // 0 = 제자리, 1 = 다 밀렸다
let distance = 0; // 다 밀렸을 때 z 이동량
let steppedOffset = 0; // 관에게 알려 줄 끊은 밀림
const STEP_SIZE = 0.08;

const signal = createChangeSignal();

// 진행 자체를 지수 감쇠로 굴리면 끝이 늘어져 「시간」 값이 거짓이 된다.
// 진행은 시간대로 선형으로 올리고 부드러움은 읽을 때 입힌다.
const smoothstep = (t: number) => t * t * (3 - 2 * t);

// 매끈하게 흐르면 저절로 미끄러지는 물건이 된다. 무거운 자판기를 억지로 미는 것이라
// 세 번 '툭' 힘이 실리게 한다. 멈칫이 크면 무게감이 아니라 렉으로 읽혀 각 칸의 앞 83% 동안 민다.
const PUSH_STAGES = 3;
export const pushStage = (t: number) => Math.min(PUSH_STAGES - 1, Math.floor(t * PUSH_STAGES));
const strained = (t: number) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const stage = pushStage(t);
  const within = t * PUSH_STAGES - stage;
  const shove = Math.min(1, within * 1.2);
  return (stage + smoothstep(shove)) / PUSH_STAGES;
};

/** 지금 밀린 거리(연속) — 자판기 그룹이 매 프레임 쓴다 */
export const pushOffset = () => strained(progress) * distance;
/** 관이 쓰는 밀림(칸으로 끊어져 있다) */
export const pipeOffset = () => steppedOffset;
export const pushProgress = () => progress;

function updateSteppedOffset() {
  const next = Math.round(pushOffset() / STEP_SIZE) * STEP_SIZE;
  if (next !== steppedOffset) {
    steppedOffset = next;
    signal.notify();
  }
}

/**
 * 한 프레임 굴린다. 「duration」 초에 정확히 끝난다.
 * @param open 1 = 밸브가 돌았다 · 0 = 제자리
 * @param target 다 밀렸을 때의 z 이동량
 */
export function advancePush(open: number | boolean, dt: number, duration: number, target: number) {
  distance = target;
  const step = dt / Math.max(0.1, duration);
  progress += (open ? 1 : -1) * step;
  if (progress > 1) progress = 1;
  if (progress < 0) progress = 0;
  updateSteppedOffset();
  return progress;
}

// ── 컷신 ──
// 컷신 동안 걷기·마우스를 멈추는 판단은 App 껍데기가, 컷신은 씬 안 컴포넌트가 돌린다. 여기서 잇는다.
let cutscenePlaying = false;
export const isCutscenePlaying = () => cutscenePlaying;

// 컴포넌트 ref 로 잡으면 기차에 탔다 내릴 때 씬이 다시 마운트되며 false 로 돌아가
// 컷신이 또 돈다. 한 번 봤다는 사실은 씬보다 오래 살아야 한다.
let cutsceneSeen = false;
export const hasSeenCutscene = () => cutsceneSeen;
/** true = 봤다(다시 안 돈다) · false = 다음에 열리면 다시 돈다 */
export const markCutsceneSeen = (seen = true) => {
  cutsceneSeen = !!seen;
};

// 연출만 손보는 동안 퍼즐을 매번 풀 수는 없으니 밸브가 돌아간 척하는 스위치(Leva 버튼).
let valveFaked = false;
export const isValveFaked = () => valveFaked;
export function forceCutscene() {
  valveFaked = true;
  signal.notify();
}
export function startCutscene() {
  if (cutscenePlaying) return false;
  cutscenePlaying = true;
  signal.notify();
  return true;
}
export function endCutscene() {
  if (!cutscenePlaying) return;
  cutscenePlaying = false;
  signal.notify();
}
/** App 껍데기가 구독해 연출 동안 조작을 멈춘다. */
export const useCutscene = () => {
  useSyncExternalStore(signal.subscribe, signal.version);
  return cutscenePlaying;
};

/**
 * 진행도를 직접 정한다(컷신용). dt 를 쌓으면 카메라 순간이동 뒤 구역이 새로 올라오며
 * 프레임이 끊겨 연출이 제 시간보다 길어진다. 컷신은 벽시계 시간으로 넣는다.
 */
export function setPush(value: number, target: number) {
  distance = target;
  progress = value < 0 ? 0 : value > 1 ? 1 : value;
  updateSteppedOffset();
  return progress;
}

/** 개발·시험용 */
export function resetPush() {
  progress = 0;
  steppedOffset = 0;
  cutsceneSeen = false;
  cutscenePlaying = false;
  valveFaked = false;
  signal.notify();
}

/** 관 쪽만 구독한다 — 복도 전체는 이 값이 바뀌어도 다시 그리지 않는다. */
export const usePipeOffset = () => {
  useSyncExternalStore(signal.subscribe, signal.version);
  return steppedOffset;
};

exposeDevHook("vendingPush", {
  pushOffset,
  pipeOffset,
  pushProgress,
  setPush,
  resetPush,
  pushStage,
  isCutscenePlaying,
  startCutscene,
  endCutscene,
  forceCutscene,
  isValveFaked,
});
