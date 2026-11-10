// 소화전 밸브로 돌아가자는 안내 — 밸브에 전기가 닿은 뒤 오래 헤맬 때만 띄운다(미르 11/10 「밸브 자체에 빛나는 효과만, 바닥 표시랑
// 텍스트 안내는 지우고, 30초간 밸브 작동 안 시키고 헤매면 텍스트」). 그리는 것은 없다 — 시간은 ValveNudgeWatcher 가 1초씩 넣는다.
//
// 세는 시간 = 게임 화면을 조작 중(창 · 자물쇠 · 연출 · 기차 아님 · 탭이 보임)이고 밸브를 돌릴 수 있는 동안(Codex 01회차).
//   · 멈춘 동안(창 · 연출 · 숨긴 탭 · 모바일 멈춤)은 쌓은 시간을 그대로 두고 세지만 않는다.
//   · 관창을 뽑았다 다시 꽂으면(전류 출발 시각이 바뀜) 처음부터 — 그동안 띄운 안내도 거둔다.
//   · 밸브를 돌리면 끝 — 떠 있던 안내도 거둔다.
// 띄우는 때 = 쌓인 시간 30초 · 그 뒤 실제로 띄운 때부터 60초마다(놓친 사람을 위해). 다른 안내가 떠 있으면 다음 초로 미룬다.
// 저장하지 않는다 — 회로 · 관창 · 밸브도 저장되지 않아 본부실 전 재접속은 튜토리얼 처음부터다.
import { isHingeOpen } from "@/props/hingeState";
import { canTurnValve, getHoseFlowStartedAt, getValveTurnedAt } from "@/props/panelWiringState";

import { clearToast, isToastShowing, showToast } from "./toast";

export const FIRST_NUDGE_MS = 30_000;
export const REPEAT_NUDGE_MS = 60_000;
const NUDGE_SHOW_MS = 6000;

/** 문이 열려 있으면 빛나는 밸브가 보인다 · 닫혀 있으면 빛이 문 뒤에 가린다(Codex 01회차) */
export const VALVE_NUDGE_OPEN = "빛나는 소화전 밸브로 돌아가 [E]로 열자";
export const VALVE_NUDGE_CLOSED = "소화전함 문을 열고 안쪽 밸브를 [E]로 열자";
const NUDGES = [VALVE_NUDGE_OPEN, VALVE_NUDGE_CLOSED] as const;

/** 소화전함 문 id — HoseValve 가 알려 준다(문 상태로 글을 고른다) */
let cabinetId: string | null = null;
/** 지금 센 시간이 어느 전류(출발 시각)의 것인지 */
let chargeOf = -1;
let roamMs = 0;
let nextAt = FIRST_NUDGE_MS;

export function registerValveCabinet(id: string): () => void {
  cabinetId = id;
  return () => {
    if (cabinetId === id) cabinetId = null;
  };
}

/** 전류가 바뀌었으면(꽂음 · 뽑음) 처음부터 — 배선이 바뀔 때마다 · 매 초 부른다 */
export function syncValveNudgeCharge() {
  const startedAt = getHoseFlowStartedAt();
  if (startedAt === chargeOf) return;
  chargeOf = startedAt;
  roamMs = 0;
  nextAt = FIRST_NUDGE_MS;
  clearToast(NUDGES);
}

/** 밸브를 돌렸다 — 떠 있던 안내를 바로 거둔다(곧 자판기 연출이라 조작 중이 아니어서 1초 셈이 멈춘다) */
export function settleValveNudge() {
  clearToast(NUDGES);
}

/** 게임 화면을 조작 중인 1초 */
export function addValveNudgeTime(ms: number) {
  syncValveNudgeCharge();
  if (getValveTurnedAt() >= 0) {
    clearToast(NUDGES);
    return;
  }
  // 전류가 아직 호스를 타고 오는 중 · 관창을 안 꽂음 — 셀 것이 없다
  if (!canTurnValve()) return;
  roamMs += ms;
  if (roamMs < nextAt || isToastShowing()) return;
  const isDoorOpen = cabinetId === null || isHingeOpen(cabinetId);
  showToast(isDoorOpen ? VALVE_NUDGE_OPEN : VALVE_NUDGE_CLOSED, NUDGE_SHOW_MS, { emphasis: "hint" });
  nextAt = roamMs + REPEAT_NUDGE_MS;
}

/** 시험용 — 지금 쌓인 시간 · 다음 안내 시각 */
export const peekValveNudge = () => ({ roamMs, nextAt, chargeOf });
