import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

import { tutorialStore } from "./tutorial";

// 튜토리얼 다음 흐름: 본부실에 들어서면 잠시 뒤 나주 출동 호출 → 바닥 화살표로 기차 문까지 → 기차에 오르면 끝.
//   idle      튜토리얼 전이거나 본부실에 아직 안 들어왔다
//   countdown 본부실에 들어섰다. 한 번 들어오면 나가도 계속 센다
//   alert     긴급 호출 카드가 떠 있다(화살표도 이미 깔린다)
//   guide     카드를 닫았다 — 목표 표시 + 바닥 화살표
//   boarded   기차에 올랐다

/** 본부실에 들어선 뒤 긴급 호출까지(초) */
const ALERT_DELAY_SECONDS = 5;

/** 경보의 주황 — 튜토리얼(하늘색)과 구분한다. 카드와 바닥 화살표가 같이 쓴다. */
export const DISPATCH_COLOR = "#ffb25c";

type DispatchPhase = "idle" | "countdown" | "alert" | "guide" | "boarded";

interface DispatchState {
  phase: DispatchPhase;
  /** performance.now() 기준 ms */
  enteredAt: number | null;
  secondsLeft: number | null;
  /** 문까지 거리(미터, 정수) */
  doorDistance: number | null;
}

const INITIAL_STATE: DispatchState = { phase: "idle", enteredAt: null, secondsLeft: null, doorDistance: null };

let state: DispatchState = INITIAL_STATE;
const signal = createChangeSignal();
function setState(patch: Partial<DispatchState>) {
  state = { ...state, ...patch };
  signal.notify();
}

export const useDispatchState = () => useSyncExternalStore(signal.subscribe, () => state);

/** 카드를 닫는다 — 화살표 안내만 남는다. */
export function acknowledgeDispatch() {
  if (state.phase === "alert") setState({ phase: "guide" });
}

interface DispatchTickInput {
  isInHeadquarters: boolean;
  isInTrain: boolean;
  /** 기차 문까지 거리(유닛) */
  doorDistance?: number | null;
}

/** 매 프레임(DispatchPath) 또는 기차 안에서 부른다. */
export function tickDispatch({ isInHeadquarters, isInTrain, doorDistance = null }: DispatchTickInput) {
  const { phase } = state;
  if (phase === "boarded") return;
  // 호출 전에 먼저 기차에 타도 안내를 띄우지 않는다.
  if (isInTrain) {
    if (phase !== "idle") setState({ phase: "boarded" });
    return;
  }
  if (phase === "idle") {
    if (tutorialStore.get().isFinished && isInHeadquarters) {
      setState({ phase: "countdown", enteredAt: performance.now() });
    }
    return;
  }
  if (phase === "countdown") {
    const elapsed = (performance.now() - (state.enteredAt ?? 0)) / 1000;
    const secondsLeft = Math.max(0, Math.ceil(ALERT_DELAY_SECONDS - elapsed));
    if (secondsLeft <= 0) setState({ phase: "alert", secondsLeft: 0 });
    else if (secondsLeft !== state.secondsLeft) setState({ secondsLeft });
    return;
  }
  // 리렌더를 아끼려고 1m 단위로만 갱신한다.
  if (doorDistance !== null) {
    const meters = Math.round(doorDistance * 0.3);
    if (meters !== state.doorDistance) setState({ doorDistance: meters });
  }
}

exposeDevHook("dispatch", {
  get: () => state,
  /** 기다리지 않고 바로 호출 */
  triggerNow: () => setState({ phase: "alert", secondsLeft: 0 }),
  reset: () => setState({ ...INITIAL_STATE }),
});
