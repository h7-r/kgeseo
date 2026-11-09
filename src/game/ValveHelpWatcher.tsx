// 밸브 자물쇠를 만지는 동안의 시간을 잰다(valveHelp) — 자물쇠 조작이 「진행 중」이고 창이 덮지 않았고 탭이 보일 때만.
// 게임 시계(gameSetTimeout)로 1초마다 더해서 모바일 멈춤 중에는 늘지 않는다. 그리는 것은 없다.
import { useEffect } from "react";

import { gameClearTimeout, gameSetTimeout } from "@/engine/input/gameClock";
import { useLockControl } from "@/props/combinationLockState";

import { addValveActiveTime, dismissHintOffer, isValveLockId, useHintOffering } from "./valveHelp";

const TICK_MS = 1000;

export default function ValveHelpWatcher({ covered }: { covered: boolean }) {
  const control = useLockControl();
  const id = control?.phase === "active" && isValveLockId(control.id) ? control.id : null;
  // 추가 힌트를 묻는 동안은 시간을 안 센다 — 고민하는 동안 다음 문턱을 넘지 않게(12회차 Codex)
  const isOffering = useHintOffering();

  // 자물쇠에서 나가면 묻던 것을 접는다 — 힌트함 「받기」로 남는다(12회차)
  useEffect(() => {
    if (!id) dismissHintOffer();
  }, [id]);

  useEffect(() => {
    if (!id || covered || isOffering) return;
    let timer: number | null = null;
    const tick = () => {
      if (document.visibilityState === "visible") addValveActiveTime(id, TICK_MS);
      timer = gameSetTimeout(tick, TICK_MS);
    };
    timer = gameSetTimeout(tick, TICK_MS);
    return () => gameClearTimeout(timer);
  }, [id, covered, isOffering]);

  return null;
}
