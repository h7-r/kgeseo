/**
 * [E] 로 여닫는 것들의 열림 상태(소화전 문·배전반 문·차단기 스위치 등).
 * 자판기 문·덮개는 자판기만의 일이 얽혀 있어 vendingMachineState 가 들고 있다.
 * 여닫는 동안의 각도는 화면이 useFrame 에서 스스로 좁혀 가고, 여기는 열림/닫힘만 담는다.
 */
import { useSyncExternalStore } from "react";

import { playSound } from "@/audio/sound";
import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

/** 차단기 스위치 id 에 들어가는 표시. 스위치는 문 소리 대신 딸깍을 낸다. */
export const SWITCH_ID_MARK = ":switch:";

const openIds = new Set<string>();
const signal = createChangeSignal();

export const isOpen = (id: string) => openIds.has(id);

export function toggleHinge(id: string) {
  if (openIds.has(id)) openIds.delete(id);
  else openIds.add(id);
  signal.notify();
  const open = openIds.has(id);
  if (id.includes(SWITCH_ID_MARK)) playSound("button", { volume: 0.9 });
  else playSound(open ? "drawerOpen" : "drawerClose", { volume: 0.9 });
  return open;
}

export function closeHinge(id: string) {
  if (!openIds.delete(id)) return;
  signal.notify();
}

export const hingeStore = {
  version: signal.version,
  subscribe: signal.subscribe,
};

/** id 하나의 열림 여부를 구독한다(드물게 바뀌어 다시 그려도 괜찮다). */
export const useIsOpen = (id: string) => useSyncExternalStore(signal.subscribe, () => openIds.has(id));

// ── 덜컹 ── 잠겨서 안 열리는 문
// 아무 반응이 없으면 조작이 고장 난 줄 안다. 문이 흔들려야 "잠겼구나"로 읽힌다.
// 흔들림은 매 프레임 바뀌므로 시작 시각만 적고 화면이 useFrame 에서 계산한다.

const rattles = new Map<string, number>(); // id → 시작 시각(ms)
const RATTLE_SECONDS = 0.46;
const RATTLE_CYCLES = 3;
const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** 잠긴 문을 덜컹거리게 한다(이미 흔들리는 중이면 처음부터 다시). */
export function rattle(id: string | null | undefined) {
  if (!id) return;
  rattles.set(id, nowMs());
  playSound("locked", { volume: 0.9 });
}

/** 지금 흔들림 −1 ~ 1. 잦아드는 사인파 — 끝까지 같은 세기면 깃발로 보인다. */
export function rattleOffset(id: string | null | undefined) {
  const t0 = id ? rattles.get(id) : undefined;
  if (t0 === undefined || !id) return 0;
  const t = (nowMs() - t0) / 1000 / RATTLE_SECONDS;
  if (t >= 1) {
    rattles.delete(id);
    return 0;
  }
  const decay = (1 - t) * (1 - t);
  return Math.sin(t * Math.PI * 2 * RATTLE_CYCLES) * decay;
}

exposeDevHook("hinges", { isOpen, toggleHinge, closeHinge, rattle });
