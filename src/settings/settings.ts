import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { readMigrated, writeStorage } from "@/engine/storage";

// 같은 출처라 나주(/naju01/)도 이 값을 읽는다.
const STORAGE_KEY = "kgeseo.settings.v1";
const LEGACY_STORAGE_KEY = "kgeseo.설정.v1";

export type Resolution = "auto" | "low" | "medium" | "high" | "max";

export interface Settings {
  /** 0 ~ 1 */
  bgmVolume: number;
  /** 0 ~ 1. 모든 효과음이 지나는 마스터 볼륨 */
  sfxVolume: number;
  /** 0.6 ~ 1.4 화면 밝기 배율 */
  brightness: number;
  resolution: Resolution;
  /** 0.4 ~ 2 마우스 시점 회전 빠르기 */
  sensitivity: number;
}

export const DEFAULT_SETTINGS: Settings = {
  // naju01 로딩영상도 0.6 을 기본으로 쓴다.
  bgmVolume: 0.6,
  sfxVolume: 0.65,
  brightness: 1,
  resolution: "auto",
  sensitivity: 1,
};

export const RESOLUTION_OPTIONS: readonly Resolution[] = ["auto", "low", "medium", "high", "max"];

export const RESOLUTION_LABELS: Record<Resolution, string> = {
  auto: "자동",
  low: "낮음",
  medium: "보통",
  high: "높음",
  max: "최고",
};

// 「자동」은 App 이 원래 쓰던 dpr 을 그대로 쓴다.
export const RESOLUTION_DPR: Record<Exclude<Resolution, "auto">, number> = {
  low: 0.75,
  medium: 1,
  high: 1.5,
  max: 2,
};

const LEGACY_FIELDS: Record<string, keyof Settings> = {
  배경음악: "bgmVolume",
  효과음: "sfxVolume",
  밝기: "brightness",
  해상도: "resolution",
  감도: "sensitivity",
};

const LEGACY_RESOLUTIONS: Record<string, Resolution> = {
  자동: "auto",
  낮음: "low",
  보통: "medium",
  높음: "high",
  최고: "max",
};

function isResolution(value: unknown): value is Resolution {
  return typeof value === "string" && (RESOLUTION_OPTIONS as readonly string[]).includes(value);
}

/** 옛 한글 필드 이름으로 저장된 값도 영어 필드로 옮겨 읽는다. */
function normalize(raw: unknown): Partial<Settings> {
  if (typeof raw !== "object" || raw === null) return {};
  const result: Partial<Settings> = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = LEGACY_FIELDS[key] ?? key;
    if (field === "resolution") {
      const resolution = typeof value === "string" ? (LEGACY_RESOLUTIONS[value] ?? value) : value;
      if (isResolution(resolution)) result.resolution = resolution;
    } else if (
      (field === "bgmVolume" || field === "sfxVolume" || field === "brightness" || field === "sensitivity") &&
      typeof value === "number"
    ) {
      result[field] = value;
    }
  }
  return result;
}

function readSettings(): Settings {
  try {
    const raw: unknown = JSON.parse(readMigrated(STORAGE_KEY, LEGACY_STORAGE_KEY) || "{}");
    return { ...DEFAULT_SETTINGS, ...normalize(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current: Settings = typeof window === "undefined" ? { ...DEFAULT_SETTINGS } : readSettings();
const listeners = new Set<(settings: Settings) => void>();

export const settingsStore = {
  get: (): Settings => current,
  subscribe(listener: (settings: Settings) => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const useSettings = () => useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.get);

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  // 사생활 보호 창 등에서 저장이 막혀도 이번 판에는 먹는다.
  writeStorage(STORAGE_KEY, JSON.stringify(current));
  for (const listener of listeners) listener(current);
}

export function resetSettings() {
  updateSettings({ ...DEFAULT_SETTINGS });
}

exposeDevHook("settings", { get: settingsStore.get, update: updateSettings, reset: resetSettings });
