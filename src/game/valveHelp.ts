// 밸브(소화전) 자물쇠에서 오래 막힌 사람에게 단계별로 돕는다 — 미르 플레이 시험 메모(11/8): 「밸브를 보고 스펠링을 추론해내지
// 못하는 사람들은 튜토공간을 벗어나는 것이 불가능」 → 오래 막히면 「밸브가 영어로 뭐지?」, 그래도 못 풀면 「정답 확인하기」
// (튜토피드백 검토 01회차).
//   ① 오답 3번 또는 자물쇠를 만진 시간 60초 → 자물쇠 안내에 한 줄 + 힌트함 쪽지
//   ② 오답 6번 또는 180초 → 힌트함에 「정답 확인하기」(창에서 「정답 보기」를 눌러야 보인다 — 새 쪽지는 자동으로 펼쳐지므로)
// 시간은 자물쇠를 실제로 만지는 동안만(ValveHelpWatcher), 오답은 서버 · 로컬 판정이 「틀렸다」고 한 것만 센다(통신 실패는 안 센다).
// 자판기 구역까지 전원이 들어온 뒤(fullPower)에만 센다 — 정답 공개로 분리수거 · 자판기를 건너뛰지 않게. 진행은 이 탭 메모리에만 둔다.
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";
import { getLockState } from "@/props/combinationLockState";
import { hasFullPower } from "@/props/workLampPuzzle/workLampState";

import { addHint, flashHints } from "./hintBox";
import { showToast } from "./toast";

/** 소화전 문 자물쇠 id 앞머리(station/corridor/wallCabinetId) */
export const isValveLockId = (id: string | null | undefined) => !!id?.startsWith("wallCabinet:hydrant:");

const STAGES = [
  { wrong: 3, ms: 60_000 },
  { wrong: 6, ms: 180_000 },
] as const;

export const VALVE_HINT_LINE = "힌트: 밸브가 영어로 뭐지?";
export const VALVE_ANSWER_LINE = "그래도 막혔다면 [H] 힌트함의 「정답 확인하기」";

let wrong = 0;
let activeMs = 0;
let stage = 0;
const signal = createChangeSignal();

/** 지금 셀 때인가 — 완전 전원 뒤, 그 자물쇠가 아직 잠겨 있을 때 */
const isCounting = (id: string) => isValveLockId(id) && hasFullPower() && !getLockState(id)?.unlocked;

function advance() {
  const next = STAGES.reduce((reached, rule, i) => (wrong >= rule.wrong || activeMs >= rule.ms ? i + 1 : reached), 0);
  if (next <= stage) return;
  if (stage < 1) {
    addHint({
      id: "valve:help",
      name: "밸브 자물쇠 힌트",
      description:
        "밸브가 영어로 뭐지?\n\n소화전 손잡이의 이름을 영어 글자로 넣는 자물쇠다. 모르겠으면 검색해 봐도 좋다.",
      isPhysical: false,
    });
  }
  if (next >= 2) {
    addHint({
      id: "valve:answer",
      name: "정답 확인하기",
      description:
        "그래도 모르겠다면 아래 「정답 보기」를 눌러 확인할 수 있다.\n\n다음 무대에서는 동행에게 힌트를 물어볼 수도 있다.",
      spoiler: "VALVE",
      isPhysical: false,
    });
  }
  flashHints();
  showToast(
    next >= 2 ? "그래도 막혔다면 — 힌트함 [H]의 「정답 확인하기」" : "막혔다면 — 힌트함 [H]에 새 쪽지가 생겼다",
    5000,
  );
  stage = next;
  signal.notify();
}

/** 자물쇠 답을 낸 결과(useGameKeys) — 틀린 것만 센다 */
export function noteValveAnswer(id: string, isCorrect: boolean) {
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

export const useValveHelpStage = () => useSyncExternalStore(signal.subscribe, () => stage);

exposeDevHook("valveHelp", {
  get: () => ({ wrong, activeMs, stage }),
  reset: () => {
    wrong = 0;
    activeMs = 0;
    stage = 0;
    signal.notify();
  },
});
