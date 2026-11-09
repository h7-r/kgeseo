// 밸브(소화전) 자물쇠에서 오래 막힌 사람에게 단계별로 돕는다 — 미르 플레이 시험 메모(11/8): 「밸브를 보고 스펠링을 추론해내지
// 못하는 사람들은 튜토공간을 벗어나는 것이 불가능」 → 오래 막히면 「밸브가 영어로 뭐지?」, 그래도 못 풀면 「정답 확인하기」
// (튜토피드백 검토 01회차).
//   ① 오답 3번 또는 자물쇠를 만진 시간 60초 → 「밸브 자물쇠 힌트」(자물쇠 안내에 한 줄 + 힌트함 쪽지)
//   ② 오답 6번 또는 180초 → 「정답 확인하기」(창에서 「정답 보기」를 눌러야 보인다 — 새 쪽지는 자동으로 펼쳐지므로)
// 문턱을 넘으면 넣지 않고 먼저 묻는다 — 「추가 힌트를 받으시겠습니까?」(미르 11/9: 시간이 걸려도 제 힘으로 풀고 싶은 사람에게
// 선택지를, 튜토피드백 12회차). 문턱을 넘을 때마다 아직 안 받은 첫 힌트를 한 번 묻고, 거절하면 다음 문턱까지 다시 안 묻는다.
// 거절한 것도 힌트함 창의 「받기」로 언제든 받는다.
// 시간은 자물쇠를 실제로 만지는 동안만(ValveHelpWatcher), 오답은 서버 · 로컬 판정이 「틀렸다」고 한 것만 센다(통신 실패는 안 센다).
// 자판기 구역까지 전원이 들어온 뒤(fullPower)에만 센다 — 정답 공개로 분리수거 · 자판기를 건너뛰지 않게. 진행은 이 탭 메모리에만 둔다.
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";
import { getLockState } from "@/props/combinationLockState";
import { hasFullPower } from "@/props/workLampPuzzle/workLampState";

import { addHint, flashHints, type Hint } from "./hintBox";
import { showToast } from "./toast";

/** 소화전 문 자물쇠 id 앞머리(station/corridor/wallCabinetId) */
export const isValveLockId = (id: string | null | undefined) => !!id?.startsWith("wallCabinet:hydrant:");

const STAGES = [
  { wrong: 3, ms: 60_000 },
  { wrong: 6, ms: 180_000 },
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
let activeMs = 0;
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

function advance() {
  const next = STAGES.reduce((reached, rule, i) => (wrong >= rule.wrong || activeMs >= rule.ms ? i + 1 : reached), 0);
  if (next <= eligible) return;
  eligible = next;
  // 문턱을 넘을 때마다 아직 안 받은 첫 힌트를 묻는다 — 거절했어도 다음 문턱에서 한 번 더
  if (delivered < eligible) isOffering = true;
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

/** 「아니요」 · 자물쇠에서 나감 — 묻기만 접는다(힌트함 「받기」로 남는다) */
export function dismissHintOffer() {
  if (!isOffering) return;
  isOffering = false;
  signal.notify();
}

/** 힌트함 창의 「받기」 — 거절했던 것도 언제든 */
export function takeExtraHint() {
  isOffering = false;
  const isGiven = deliverNext();
  signal.notify();
  return isGiven;
}

/** 자물쇠 답을 낸 결과(useGameKeys) — 틀린 것만 센다 */
export function noteValveAnswer(id: string, isCorrect: boolean) {
  if (isCorrect && isValveLockId(id)) {
    isSolved = true;
    isOffering = false;
    signal.notify();
    return;
  }
  if (isCorrect || !isCounting(id)) return;
  wrong += 1;
  advance();
}

/** 자물쇠를 만지고 있던 시간을 더한다(ValveHelpWatcher) */
export function addValveActiveTime(id: string, ms: number) {
  if (!isCounting(id)) return;
  activeMs += ms;
  advance();
}

export const isHintOffering = () => isOffering;
export const useHintOffering = () => useSyncExternalStore(signal.subscribe, isHintOffering);
export const useValveHintsDelivered = () => useSyncExternalStore(signal.subscribe, () => delivered);
/** 받을 수 있는데 아직 안 받은 힌트가 있다(힌트함 「받기」) */
export const useExtraHintAvailable = () =>
  useSyncExternalStore(signal.subscribe, () => !isSolved && eligible > delivered);

exposeDevHook("valveHelp", {
  get: () => ({ wrong, activeMs, eligible, delivered, isOffering, isSolved }),
  accept: acceptHintOffer,
  dismiss: dismissHintOffer,
  take: takeExtraHint,
  reset: () => {
    wrong = 0;
    activeMs = 0;
    eligible = 0;
    delivered = 0;
    isOffering = false;
    isSolved = false;
    signal.notify();
  },
});
