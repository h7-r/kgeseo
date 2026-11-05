import { useFrame } from "@react-three/fiber";
import { useEffect } from "react";

import { setElectricSound } from "@/audio/synthSounds";
import {
  CONDUIT_FLOW_SECONDS,
  HOSE_FLOW_SECONDS,
  VENDING_FRENZY_SECONDS,
  getHoseFlowStartedAt,
  getValveTurnedAt,
} from "@/props/panelWiringState";
import { FLOW_SECONDS, computeSurge, getPaintingStruckAt } from "@/props/workLampPuzzle/currentFlow";
import { getBinFlowStartedAt } from "@/props/workLampPuzzle/workLampState";

const TRAVEL_LEVEL = 0.42;
const BINS = ["general", "plastic"] as const;

/** 앞머리가 가는 동안의 소리 세기 */
function computeTravelLevel(now: number, startedAt: number, seconds: number) {
  return startedAt >= 0 && now >= startedAt && now - startedAt - seconds < 0 ? TRAVEL_LEVEL : 0;
}

/** 앞머리가 끝에 닿은 뒤의 세기 — 닿으면 세지고, 그 뒤 잦아들어 꺼진다 */
function computeArrivalSurge(now: number, startedAt: number, seconds: number, lingerSeconds: number) {
  const since = now - startedAt - seconds;
  if (startedAt < 0 || since < 0) return 0;
  return 1 - Math.min(1, Math.max(0, since - lingerSeconds) / 1.2);
}

/** 지금 흐르는 전류 중 가장 센 것을 소리에 싣는다 — 복도에 하나만 둔다 */
export default function ElectricSoundDriver() {
  // 탭을 숨기면 프레임이 멈춰 소리가 마지막 세기로 남는다 — 그때는 직접 끈다
  useEffect(() => {
    const silenceWhenHidden = () => {
      if (document.hidden) setElectricSound(0);
    };
    document.addEventListener("visibilitychange", silenceWhenHidden);
    return () => document.removeEventListener("visibilitychange", silenceWhenHidden);
  }, []);
  useFrame(() => {
    const now = performance.now() / 1000;
    let level = 0;
    let surge = 0;
    for (const bin of BINS) {
      const startedAt = getBinFlowStartedAt(bin);
      // 혼자 닿은 통은 그림에 불을 못 켠다 — 앞머리가 끝나면 조용해진다
      if (startedAt > 0 && now - startedAt < FLOW_SECONDS) level = Math.max(level, TRAVEL_LEVEL);
    }
    const struckSurge = computeSurge(now);
    if (now >= getPaintingStruckAt() && struckSurge > 0) {
      level = Math.max(level, struckSurge);
      surge = Math.max(surge, struckSurge);
    }
    const hoseStart = getHoseFlowStartedAt();
    const conduitStart = getValveTurnedAt();
    const hoseSurge = computeArrivalSurge(now, hoseStart, HOSE_FLOW_SECONDS, 0.8);
    const conduitSurge = computeArrivalSurge(now, conduitStart, CONDUIT_FLOW_SECONDS, VENDING_FRENZY_SECONDS);
    level = Math.max(
      level,
      hoseSurge,
      conduitSurge,
      computeTravelLevel(now, hoseStart, HOSE_FLOW_SECONDS),
      computeTravelLevel(now, conduitStart, CONDUIT_FLOW_SECONDS),
    );
    surge = Math.max(surge, hoseSurge, conduitSurge);
    setElectricSound(level, surge);
  });
  return null;
}
