// 밸브 힌트용 시간을 잰다(valveHelp). 게임 시계(gameSetTimeout)로 1초마다 더해서 모바일 멈춤 중에는 늘지 않는다. 그리는 것은 없다.
//   · 자물쇠를 만지는 시간 — 자물쇠 조작이 「진행 중」이고 창이 덮지 않았고 탭이 보일 때만
//   · 밸브가 다음 장치가 된 뒤 시간 — 게임 화면을 조작 중(roamActive: 창 · 자물쇠 · 연출 · 기차 아님)이거나 자물쇠를 만지는 동안(미르 11/10)
// 묻는 동안(「추가 힌트를 확인하시겠습니까?」)은 둘 다 안 센다 — 고민하는 동안 다음 문턱을 넘지 않게(12회차 Codex).
import { useEffect } from "react";

import { gameClearTimeout, gameSetTimeout } from "@/engine/input/gameClock";
import { useLockControl } from "@/props/combinationLockState";

import {
  addValveActiveTime,
  addValveGoalTime,
  bindHintOfferToLock,
  isValveLockId,
  leaveLockHintOffer,
  useHintOffering,
} from "./valveHelp";

const TICK_MS = 1000;

export default function ValveHelpWatcher({ covered, roamActive }: { covered: boolean; roamActive: boolean }) {
  const control = useLockControl();
  const id = control?.phase === "active" && isValveLockId(control.id) ? control.id : null;
  const isOffering = useHintOffering();

  // 자물쇠를 열면 밖에서 묻던 카드는 자물쇠 화면에서 이어 묻고, 자물쇠에서 나가면 자물쇠에서 물은 것만 접는다 — 힌트함 「받기」로 남는다(12회차)
  useEffect(() => {
    if (id) bindHintOfferToLock();
    else leaveLockHintOffer();
  }, [id]);

  useEffect(() => {
    const inLock = !!id && !covered;
    if (isOffering || (!inLock && !roamActive)) return;
    let timer: number | null = null;
    const tick = () => {
      if (document.visibilityState === "visible") {
        if (inLock && id) addValveActiveTime(id, TICK_MS);
        addValveGoalTime(TICK_MS, inLock);
      }
      timer = gameSetTimeout(tick, TICK_MS);
    };
    timer = gameSetTimeout(tick, TICK_MS);
    return () => gameClearTimeout(timer);
  }, [id, covered, isOffering, roamActive]);

  return null;
}
