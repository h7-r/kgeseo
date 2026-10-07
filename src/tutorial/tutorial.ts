import { useSyncExternalStore } from "react";

import { IS_INPUT_ALWAYS_ON } from "@/app/runtimeFlags";
import { exposeDevHook } from "@/debug/devHooks";
import { aim } from "@/lobby/interactions";
import { lockState } from "@/props/combinationLock";
import { corridorPower, hasSeenAllMarks, workLampLocation } from "@/props/workLampPuzzle/workLampState";

import { giveFirstHint } from "./firstHint";

// 비상계단 앞 첫 조작 안내. 키를 직접 눌러 보게 하고, 작업등 퍼즐을 지나며 손 쓰는 법만 알려 준다.
// 퍼즐 단계 문구는 키·손 쓰는 법만 말하고 정답·위치는 절대 적지 않는다. 막히면 힌트함([H])으로 안내한다.
// 자판기·소화전·배전반으로는 이어지지 않는다 — 튜토리얼 뒤 플레이어가 스스로 찾는다.

/** 차단기함 문과 자물쇠가 같이 쓰는 id */
export const BREAKER_BOX_LOCK_ID = "workLamp:breakerBox";

// 복도: x −31(바깥벽) ~ −20(안쪽벽), z −60(비상계단) ~ 25.5. 시작 (−25.5, −49) 에서 +z 를 본다.
// 동그라미는 작업등 퍼즐 구간(z −30 안쪽)에만 둔다.
const CORRIDOR_X = -25.5;
export const CIRCLE_RADIUS = 1.6;

export type TutorialStepId =
  | "start"
  | "lookAround"
  | "walk"
  | "run"
  | "jump"
  | "crouch"
  | "view"
  | "backToExitDoor"
  | "workLamp"
  | "junctionBox"
  | "breakerBox"
  | "switch"
  | "done";

/** 이번 단계에서 모은 기록 + 틱 문맥 */
export interface TutorialContext {
  pressed: Set<string>;
  pressCounts: Record<string, number>;
  turnedAngle: number;
  hasTouched: boolean;
  previousYaw: number | null;
  isLocked: boolean;
  isInside: boolean;
}

export interface TutorialStep {
  id: TutorialStepId;
  title: string;
  text: string;
  /** 안내판의 키 칩 [[키들…, 설명], …] */
  keys: [keys: string[], description: string][];
  /** 바닥에 빛나는 동그라미 자리 [x, z] */
  spot?: [number, number];
  isDone: (context: TutorialContext) => boolean;
  /** 안내판 머리에 「퍼즐 n / 4」 로 뜬다. */
  puzzle?: number;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "start",
    title: "비상계단 앞",
    text: "버려진 역의 비밀 복도 끝에서 눈을 떴다. 조작부터 익혀 보자.",
    keys: [[["T"], "조작 시작 — 마우스가 화면에 잠긴다"]],
    isDone: (c) => c.isLocked,
  },
  {
    id: "lookAround",
    title: "둘러보기",
    text: "마우스를 움직여 주변을 둘러보세요.",
    keys: [[["마우스"], "시선 돌리기"]],
    isDone: (c) => c.turnedAngle > 1.4,
  },
  {
    id: "walk",
    title: "걷기",
    text: "바닥에 빛나는 동그라미 안으로 걸어 들어가세요.",
    keys: [[["W", "A", "S", "D"], "앞 · 왼쪽 · 뒤 · 오른쪽"]],
    spot: [CORRIDOR_X, -42],
    isDone: (c) => c.isInside,
  },
  {
    id: "run",
    title: "달리기",
    text: "Shift 를 누른 채로 다음 동그라미까지 달려가세요.",
    keys: [[["Shift", "W"], "누른 채 달리기"]],
    spot: [CORRIDOR_X, -33],
    isDone: (c) => c.isInside && c.pressed.has("Shift"),
  },
  {
    id: "jump",
    title: "점프",
    text: "제자리에서 뛰어 보세요.",
    keys: [[["Space"], "점프"]],
    isDone: (c) => c.pressed.has("Space"),
  },
  {
    id: "crouch",
    title: "앉기",
    text: "한 번 누르면 앉고, 한 번 더 누르면 일어섭니다.",
    keys: [[["C"], "앉기 / 일어서기"]],
    isDone: (c) => (c.pressCounts.C ?? 0) >= 2,
  },
  {
    id: "view",
    title: "시점 바꾸기",
    text: "1인칭과 3인칭을 오갈 수 있습니다. 편한 쪽으로 두세요.",
    keys: [[["V"], "1인칭 ↔ 3인칭"]],
    isDone: (c) => c.pressed.has("V"),
  },
  {
    id: "backToExitDoor",
    title: "되돌아가기",
    text: "뒤로 돌아, 비상문 앞의 동그라미로 돌아가세요.",
    keys: [
      [["마우스"], "돌아보기"],
      [["W", "A", "S", "D"], "걷기"],
    ],
    spot: [CORRIDOR_X, -51.5],
    isDone: (c) => c.isInside,
  },
  {
    id: "workLamp",
    puzzle: 1,
    title: "작업등",
    text:
      "화면 가운데 점을 물건에 맞추면 그 물건이 빛납니다. 빛날 때 E 를 누르면 집습니다.\n" +
      "바닥에 떨어진 작업등을 집어 보세요. 들고 있으면 발밑이 밝아집니다.",
    keys: [
      [["가운데 점"], "겨냥"],
      [["E"], "집기"],
      [["F"], "들고 있는 것 내려놓기"],
    ],
    isDone: () => workLampLocation() !== "floor",
  },
  {
    id: "junctionBox",
    puzzle: 2,
    title: "분기함",
    text:
      "작업등을 든 채 벽의 분기함을 겨냥해 E 를 누르면 그 자리에 꽂힙니다. 다시 E 로 뽑을 수 있어요.\n" +
      "불빛이 닿은 곳을 잘 살펴보세요.",
    keys: [
      [["E"], "꽂기 · 뽑기"],
      [["F"], "내려놓기"],
    ],
    isDone: () => hasSeenAllMarks(),
  },
  {
    id: "breakerBox",
    puzzle: 3,
    title: "차단기함 자물쇠",
    text: "자물쇠는 E 로 다가가 돌립니다. 열쇠가 될 글자는 직접 찾아내세요.",
    keys: [
      [["E"], "자물쇠 앞에서 조작 시작 · 확인"],
      [["←", "→"], "칸 고르기"],
      [["↑", "↓"], "글자 돌리기 (휠도 된다)"],
      [["ESC"], "그만두기"],
    ],
    isDone: () => !!lockState(BREAKER_BOX_LOCK_ID)?.unlocked,
  },
  {
    id: "switch",
    puzzle: 4,
    title: "스위치 올리기",
    text:
      "차단기함 안의 선은 E 로 집어 꽂을 자리에 E 로 꽂습니다. 레버도 E 로 올립니다.\n" +
      "무엇을 어디에 이을지는 직접 찾아내세요.",
    keys: [
      [["E"], "집기 · 꽂기 · 레버"],
      [["F"], "들고 있는 선 내려놓기"],
    ],
    isDone: () => corridorPower(),
  },
  {
    id: "done",
    title: "튜토리얼 완료",
    text:
      "복도에 전기가 들어왔다. 이제부터는 스스로 길을 찾아야 한다.\n" +
      "힌트함에 쪽지 한 장을 넣어 두었다. H 를 눌러 확인해 보자.\n" +
      "비밀 복도와 수사 본부는 언제든 자유롭게 오갈 수 있다.",
    keys: [[["H"], "힌트함 열기 — 새 쪽지 확인"]],
    isDone: () => false,
  },
];

// 퍼즐 구간에서만, 뒤 단계가 이미 끝났으면 앞 단계를 건너뛴다(순서와 다르게 풀었을 때).
const FIRST_PUZZLE_STEP = TUTORIAL_STEPS.findIndex((step) => step.id === "workLamp");

export interface TutorialState {
  /** TUTORIAL_STEPS 의 위치 */
  step: number;
  /** 방금 끝낸 단계 */
  previousStepId: TutorialStepId | null;
  isFinished: boolean;
  isHidden: boolean;
}

let state: TutorialState = { step: 0, previousStepId: null, isFinished: false, isHidden: false };
const listeners = new Set<() => void>();
function setState(patch: Partial<TutorialState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const tutorialStore = { get: () => state, subscribe };
export const useTutorial = () => useSyncExternalStore(subscribe, () => state);

// 단계가 바뀌면 비운다.
const record: Omit<TutorialContext, "isLocked" | "isInside"> = {
  pressed: new Set(),
  pressCounts: {},
  turnedAngle: 0,
  hasTouched: false,
  previousYaw: null,
};
function clearRecord() {
  record.pressed = new Set();
  record.pressCounts = {};
  record.turnedAngle = 0;
  record.hasTouched = false;
  record.previousYaw = null;
}

function goToStep(target = state.step + 1) {
  const last = TUTORIAL_STEPS.length - 1;
  const next = Math.min(target, last);
  // 완료 문구가 「H 로 확인하라」고 하므로 끝나는 순간 첫 쪽지를 넣는다.
  if (next === last) giveFirstHint();
  clearRecord();
  setState({ step: next, previousStepId: TUTORIAL_STEPS[state.step]?.id ?? null, isFinished: next === last });
}

// 게임의 키 처리(useMovement · App)와 따로 듣는다 — 그쪽을 건드리지 않으려고.
const KEY_NAMES: Partial<Record<string, string>> = {
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  Space: "Space",
  KeyC: "C",
  KeyV: "V",
  KeyE: "E",
  KeyH: "H",
};

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    const name = KEY_NAMES[event.code];
    if (!name) return;
    record.pressed.add(name);
    record.pressCounts[name] = (record.pressCounts[name] ?? 0) + 1;
    // 겨냥한 게 있을 때 E = 실제로 무언가를 만졌다.
    if (name === "E" && aim.get()) record.hasTouched = true;
  });
}

function restartTutorial() {
  clearRecord();
  setState({ step: 0, previousStepId: null, isFinished: false, isHidden: false });
}

exposeDevHook("tutorial", {
  get: () => ({ ...state, stepId: TUTORIAL_STEPS[state.step]?.id }),
  skip: () => goToStep(),
  restart: restartTutorial,
});

export interface TutorialTickInput {
  eye: { x: number; z: number };
  /** 카메라 y 회전 */
  yaw: number;
}

/** 매 프레임 부른다(TutorialFloor). */
export function tickTutorial({ eye, yaw }: TutorialTickInput) {
  const current = TUTORIAL_STEPS[state.step];
  if (!current || state.isFinished) return;

  // 한 바퀴를 넘어갈 때 튀지 않게 감싸서 누적한다.
  if (record.previousYaw !== null) {
    let delta = yaw - record.previousYaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    record.turnedAngle += Math.abs(delta);
  }
  record.previousYaw = yaw;

  const context: TutorialContext = {
    ...record,
    isLocked: IS_INPUT_ALWAYS_ON || (typeof document !== "undefined" && !!document.pointerLockElement),
    isInside: !!current.spot && Math.hypot(eye.x - current.spot[0], eye.z - current.spot[1]) < CIRCLE_RADIUS,
  };

  if (state.step >= FIRST_PUZZLE_STEP) {
    for (let i = TUTORIAL_STEPS.length - 2; i > state.step; i -= 1) {
      if (TUTORIAL_STEPS[i]?.isDone(context)) {
        goToStep(i + 1);
        return;
      }
    }
  }
  if (current.isDone(context)) goToStep();
}

/** 안내판을 숨기거나 되살린다([F1]). */
export function toggleTutorialHidden() {
  setState({ isHidden: !state.isHidden });
}
