/**
 * 퍼즐 부품 안에만 있던 도중 값을 저장본에 남긴다.
 * 부품은 게임이 그려질 때 recall 로 값을 받고, 값이 바뀌면 remember 로 적거나 track 으로 읽는 법만 알려 둔다.
 */
import { useCallback, useState, type SetStateAction } from "react";

import { registerSaveSection, scheduleGameSave } from "@/save/gameSave";

let memory: Record<string, unknown> = {};
const trackers = new Map<string, () => unknown>();

export function registerPuzzleMemory(): void {
  registerSaveSection("naju.puzzleMemory", {
    read: () => {
      for (const [key, read] of trackers) {
        const value = read();
        // 아직 만들어지지 않은 물건이면 저장된 값을 그대로 둔다.
        if (value !== undefined) memory[key] = value;
      }
      return memory;
    },
    apply: (value) => {
      memory = value as Record<string, unknown>;
    },
  });
}

export function recall<T>(key: string, fallback: T): T {
  return key in memory ? (memory[key] as T) : fallback;
}

export function remember(key: string, value: unknown): void {
  memory[key] = value;
  scheduleGameSave();
}

/** 프레임마다 바뀌는 값은 저장할 때만 읽는다. */
export function track(key: string, read: () => unknown): () => void {
  trackers.set(key, read);
  return () => {
    trackers.delete(key);
  };
}

/** 저장되는 useState. 부품 초기값이 곧 저장값이다. */
export function useRememberedState<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() =>
    recall(key, typeof initial === "function" ? (initial as () => T)() : initial),
  );
  const set = useCallback(
    (next: SetStateAction<T>) => {
      setValue((previous) => {
        const resolved = typeof next === "function" ? (next as (old: T) => T)(previous) : next;
        remember(key, resolved);
        return resolved;
      });
    },
    [key],
  );
  return [value, set] as const;
}
