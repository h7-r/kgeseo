import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";

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
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export const overlayLayer = {
  get: (): Layer | null => openLayer,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** 다른 창이 열려 있으면 그냥 덮인다. */
  open(layer: Layer) {
    if (openLayer === layer) return;
    openLayer = layer;
    notify();
  },
  close() {
    if (openLayer === null) return;
    openLayer = null;
    notify();
  },
  /** 같은 창을 다시 부르면 닫힌다. */
  toggle(layer: Layer) {
    openLayer = openLayer === layer ? null : layer;
    notify();
  },
};

export const useOpenLayer = () => useSyncExternalStore(overlayLayer.subscribe, overlayLayer.get);

/** 아무 창이나 열려 있나 — 이동 입력을 막을지 정할 때 쓴다. */
export const useIsAnyLayerOpen = () => useSyncExternalStore(overlayLayer.subscribe, () => overlayLayer.get() !== null);

exposeDevHook("overlayLayer", overlayLayer);
