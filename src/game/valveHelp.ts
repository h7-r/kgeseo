// 밸브(소화전) 자물쇠에서 오래 막힌 사람에게 단계별로 돕는다 — 미르 플레이 시험 메모(11/8): 「밸브를 보고 스펠링을 추론해내지
// 못하는 사람들은 튜토공간을 벗어나는 것이 불가능」 → 오래 막히면 「밸브가 영어로 뭐지?」, 그래도 못 풀면 「정답 확인하기」
// (튜토피드백 검토 01회차).
//   ① 오답 3번 · 자물쇠를 만진 시간 60초 · 밸브가 다음 장치가 된 뒤 2분 → 「밸브 자물쇠 힌트」(자물쇠 안내에 한 줄 + 힌트함 쪽지)
//   ② 오답 6번 · 180초 · 5분 → 「정답 확인하기」(창에서 「정답 보기」를 눌러야 보인다 — 새 쪽지는 자동으로 펼쳐지므로)
// 「밸브가 다음 장치가 된 뒤」 시간(goal): 완전 전원(앞 장치를 다 푼 때)부터, 게임 화면이 조작 중이거나 자물쇠를 만지는 동안만 센다
// — 자물쇠를 안 만지고 헤매는 사람도 막힌 걸 알아챈다(미르 11/10). 그때 자물쇠 밖이면 게임 화면 가운데에서 묻는다(Y · N).
// 문턱을 넘으면 넣지 않고 먼저 묻는다 — 「추가 힌트를 받으시겠습니까?」(미르 11/9: 시간이 걸려도 제 힘으로 풀고 싶은 사람에게
// 선택지를, 튜토피드백 12회차). 문턱을 넘을 때마다 아직 안 받은 첫 힌트를 한 번 묻고, 거절하면 다음 문턱까지 다시 안 묻는다.
// 거절한 것도 힌트함 창의 「받기」로 언제든 받는다.
// 시간은 자물쇠를 실제로 만지는 동안만(ValveHelpWatcher), 오답은 서버 · 로컬 판정이 「틀렸다」고 한 것만 센다(통신 실패는 안 센다).
// 같은 틀린 답을 연달아 내면 한 번만 센다 — 자물쇠의 E 는 「답 내기」라 같은 답으로 E 를 거듭 누르면 금세 문턱을 넘었다(미르 11/10).
// 자판기 구역까지 전원이 들어온 뒤(fullPower)에만 센다 — 정답 공개로 분리수거 · 자판기를 건너뛰지 않게. 진행은 이 탭 메모리에만 둔다.
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";
import { findLockState, getLockState } from "@/props/combinationLockState";
import { hasFullPower } from "@/props/workLampPuzzle/workLampState";

import { addHint, flashHints, type Hint } from "./hintBox";
import { showToast } from "./toast";

/** 소화전 문 자물쇠 id 앞머리(station/corridor/wallCabinetId) */
export const isValveLockId = (id: string | null | undefined) => !!id?.startsWith("wallCabinet:hydrant:");

const STAGES = [
  { wrong: 3, ms: 60_000, goalMs: 120_000 },
  { wrong: 6, ms: 180_000, goalMs: 300_000 },
] as const;

/** 단계마다 주는 쪽지와 받은 순간의 한 줄 */
const HINTS: readonly { hint: Hint; toast: string }[] = [
  {
    hint: {
      id: "valve:help",
      name: "밸브 자물쇠 힌트",
      description:
        "밸브가 영어로 뭐지?\n\n소화전 손잡이의 이름을 영어 글자로 넣는 자물쇠다. 모르겠으면 검색해 봐도 좋다.",
      isPhysical: false,
    },
    toast: "힌트함 [H]에 「밸브 자물쇠 힌트」를 넣었다",
  },
  {
    hint: {
      id: "valve:answer",
      name: "정답 확인하기",
      description:
        "그래도 모르겠다면 아래 「정답 보기」를 눌러 확인할 수 있다.\n\n다음 무대에서는 동행에게 힌트를 물어볼 수도 있다.",
      spoiler: "VALVE",
      isPhysical: false,
    },
    toast: "힌트함 [H]에 「정답 확인하기」를 넣었다",
  },
];

export const VALVE_HINT_LINE = "힌트: 밸브가 영어로 뭐지?";
export const VALVE_ANSWER_LINE = "그래도 막혔다면 [H] 힌트함의 「정답 확인하기」";

let wrong = 0;
/** 바로 앞에 센 틀린 답(자물쇠 id + 글자) — 같은 답을 연달아 내면 다시 안 센다 */
let lastWrongAnswer: string | null = null;
let activeMs = 0;
/** 밸브가 다음 장치가 된 뒤 지난 시간(조작 중 · 자물쇠 중만) */
let goalMs = 0;
/** 지금 묻는 것이 자물쇠 안에서 나온 것인가 — 자물쇠에서 나가면 접는다. 밖(헤매는 시간)에서 나온 건 답할 때까지 남는다 */
let isOfferInLock = false;
/** 문턱을 넘어 받을 수 있게 된 힌트 수(0~2) */
let eligible = 0;
/** 실제로 준 힌트 수 — 자물쇠 안내 줄도 이만큼만 보인다 */
let delivered = 0;
/** 지금 묻고 있나 — 자물쇠 화면의 「추가 힌트를 받으시겠습니까?」 카드가 띄운다 */
let isOffering = false;
/** 밸브 자물쇠를 풀었다 — 그 뒤로는 묻지도 「받기」를 내밀지도 않는다(12회차 Codex) */
let isSolved = false;
const signal = createChangeSignal();

/** 지금 셀 때인가 — 완전 전원 뒤, 그 자물쇠가 아직 잠겨 있을 때 */
const isCounting = (id: string) => isValveLockId(id) && hasFullPower() && !getLockState(id)?.unlocked;
/** 자물쇠 밖에서 — 완전 전원 뒤, 밸브 자물쇠가 있고 아직 안 풀렸을 때(저장에서 풀린 채 되살아난 것도 안 센다) */
const isGoalPending = () => {
  if (isSolved || !hasFullPower()) return false;
  const valve = findLockState(isValveLockId);
  return !!valve && !valve.unlocked;
};

function advance(inLock: boolean) {
  const next = STAGES.reduce(
    (reached, rule, i) => (wrong >= rule.wrong || activeMs >= rule.ms || goalMs >= rule.goalMs ? i + 1 : reached),
    0,
  );
  if (next <= eligible) return;
  eligible = next;
  // 문턱을 넘을 때마다 아직 안 받은 첫 힌트를 묻는다 — 거절했어도 다음 문턱에서 한 번 더
  if (delivered < eligible) {
    isOffering = true;
    isOfferInLock = inLock;
  }
  signal.notify();
}

/** 아직 안 받은 첫 힌트를 준다 */
function deliverNext() {
  const next = HINTS[delivered];
  if (isSolved || delivered >= eligible || !next) return false;
  addHint(next.hint);
  delivered += 1;
  flashHints();
  showToast(next.toast, 5000);
  return true;
}

/** 「예」 */
export function acceptHintOffer() {
  if (!isOffering) return;
  isOffering = false;
  deliverNext();
  signal.notify();
}

/** 「아니요」 — 묻기만 접는다(힌트함 「받기」로 남는다) */
export function dismissHintOffer() {
  if (!isOffering) return;
  isOffering = false;
  signal.notify();
}

/** 자물쇠에서 나감 — 자물쇠 안에서 물은 것만 접는다(밖에서 물은 건 게임 화면에 그대로) */
export function leaveLockHintOffer() {
  if (isOffering && isOfferInLock) dismissHintOffer();
}

/** 밖에서 묻던 중 자물쇠를 열었다 — 그 카드는 자물쇠 화면에서 이어 묻고, 나가면 접는다 */
export function bindHintOfferToLock() {
  if (isOffering) isOfferInLock = true;
}

/** 힌트함 창의 「받기」 — 거절했던 것도 언제든 */
export function takeExtraHint() {
  isOffering = false;
  const isGiven = deliverNext();
  signal.notify();
  return isGiven;
}

/** 자물쇠 답을 낸 결과(useGameKeys) — 틀린 것만, 바로 앞 틀린 답과 같으면 안 센다. answer 는 낸 순간의 글자(늦은 판정이 와도 그때 답) */
export function noteValveAnswer(id: string, isCorrect: boolean, answer: string) {
  if (isCorrect && isValveLockId(id)) {
    isSolved = true;
    isOffering = false;
    signal.notify();
    return;
  }
  if (isCorrect || !isCounting(id)) return;
  const key = `${id}|${answer}`;
  if (key === lastWrongAnswer) return;
  lastWrongAnswer = key;
  wrong += 1;
  advance(true);
}

/** 자물쇠를 만지고 있던 시간을 더한다(ValveHelpWatcher) */
export function addValveActiveTime(id: string, ms: number) {
  if (!isCounting(id)) return;
  activeMs += ms;
  advance(true);
}

/** 밸브가 다음 장치가 된 뒤 시간을 더한다(ValveHelpWatcher — 게임 화면 조작 중 · 자물쇠 중) */
export function addValveGoalTime(ms: number, inLock: boolean) {
  if (!isGoalPending()) return;
  goalMs += ms;
  advance(inLock);
}

export const isHintOffering = () => isOffering;
/** 자물쇠 밖(게임 화면)에서 묻는 중인가 */
export const isRoamHintOffering = () => isOffering && !isOfferInLock;
export const useRoamHintOffering = () => useSyncExternalStore(signal.subscribe, isRoamHintOffering);
export const useHintOffering = () => useSyncExternalStore(signal.subscribe, isHintOffering);
export const useValveHintsDelivered = () => useSyncExternalStore(signal.subscribe, () => delivered);
/** 받을 수 있는데 아직 안 받은 힌트가 있다(힌트함 「받기」) */
export const useExtraHintAvailable = () =>
  useSyncExternalStore(signal.subscribe, () => !isSolved && eligible > delivered);

exposeDevHook("valveHelp", {
  get: () => ({ wrong, activeMs, goalMs, eligible, delivered, isOffering, isOfferInLock, isSolved }),
  /** 확인용: 밸브가 다음 장치가 된 뒤 시간을 앞당긴다(조건이 맞을 때만 센다) */
  addGoal: (ms: number) => addValveGoalTime(ms, false),
  accept: acceptHintOffer,
  dismiss: dismissHintOffer,
  take: takeExtraHint,
  reset: () => {
    wrong = 0;
    lastWrongAnswer = null;
    activeMs = 0;
    goalMs = 0;
    isOfferInLock = false;
    eligible = 0;
    delivered = 0;
    isOffering = false;
    isSolved = false;
    signal.notify();
  },
});
