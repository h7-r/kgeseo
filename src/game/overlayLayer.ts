import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

// 「한 번에 하나의 모달」(GRD-11 · CMN-035). 창마다 열림 상태를 따로 들면 무엇을 눌러야 닫히는지 모르게 된다.
export const LAYERS = {
  inventory: "inventory",
  notebook: "notebook",
  hint: "hint",
  pause: "pause",
  settings: "settings",
} as const;

export type Layer = (typeof LAYERS)[keyof typeof LAYERS];

let openLayer: Layer | null = null;
const signal = createChangeSignal();

export const overlayLayer = {
  get: (): Layer | null => openLayer,
  subscribe: signal.subscribe,
  /** 다른 창이 열려 있으면 그냥 덮인다. */
  open(layer: Layer) {
    if (openLayer === layer) return;
    openLayer = layer;
    signal.notify();
  },
  close() {
    if (openLayer === null) return;
    openLayer = null;
    signal.notify();
  },
  /** 같은 창을 다시 부르면 닫힌다. */
  toggle(layer: Layer) {
    openLayer = openLayer === layer ? null : layer;
    signal.notify();
  },
};

export const useOpenLayer = () => useSyncExternalStore(overlayLayer.subscribe, overlayLayer.get);

/** Leva 숫자칸·색칸 등에 타이핑하는 중인가 — 그때는 게임 키로 먹지 않는다(색 코드에 i 를 치면 소지품이 열린다). */
export const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

exposeDevHook("overlayLayer", overlayLayer);
