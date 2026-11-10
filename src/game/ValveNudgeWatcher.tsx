// 밸브로 돌아가자는 안내(valveTurnNudge)에 시간을 넣는다 — 게임 시계(gameSetTimeout)로 1초마다, 게임 화면을 조작 중이고 탭이 보일 때만.
// 조작 중이 아닐 때도 배선이 바뀌면(관창을 뽑음 · 다시 꽂음) 바로 처음부터로 맞춘다 — 1초 사이의 뽑기 · 다시 꽂기를 놓치지 않게(Codex 01회차).
// 그리는 것은 없다.
import { useEffect } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { gameClearTimeout, gameSetTimeout } from "@/engine/input/gameClock";
import { getHoseFlowStartedAt, getValveTurnedAt, usePanelWiring } from "@/props/panelWiringState";

import { addValveNudgeTime, peekValveNudge, settleValveNudge, syncValveNudgeCharge } from "./valveTurnNudge";

const TICK_MS = 1000;

export default function ValveNudgeWatcher({ roamActive }: { roamActive: boolean }) {
  usePanelWiring();
  const hoseStartedAt = getHoseFlowStartedAt();

  const isTurned = getValveTurnedAt() >= 0;

  useEffect(() => {
    syncValveNudgeCharge();
  }, [hoseStartedAt]);

  useEffect(() => {
    if (isTurned) settleValveNudge();
  }, [isTurned]);

  useEffect(() => {
    if (!roamActive) return;
    let timer: number | null = null;
    const tick = () => {
      if (document.visibilityState === "visible") addValveNudgeTime(TICK_MS);
      timer = gameSetTimeout(tick, TICK_MS);
    };
    timer = gameSetTimeout(tick, TICK_MS);
    return () => gameClearTimeout(timer);
  }, [roamActive]);

  return null;
}

exposeDevHook("valveNudge", { peek: peekValveNudge });
