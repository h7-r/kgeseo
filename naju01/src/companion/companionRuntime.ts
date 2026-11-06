/**
 * 동행 NPC 의 실행 설정 · 한 벌뿐인 세션 · 대화 상태. 화면은 여기 훅만 쓴다.
 *
 * 주소 스위치
 *   ?npc=off                      동행 NPC 를 아예 띄우지 않는다
 *   ?npc-case=<id>&npc-version=<n> 대화에 쓸 케이스 · 게시 버전(없으면 VITE_NAJU_NPC_CASE_ID · VITE_NAJU_NPC_CONTENT_VERSION)
 *   ?npc-mock=<시나리오>           개발 서버 전용 모의 응답(devMock.ts) — 배포 빌드에는 들어가지 않는다
 *
 * 나주 콘텐츠가 게시되기 전에는 케이스 · 버전이 비어 있다 → 세션을 만들지 않고 말 걸기를 끈다(추종은 그대로).
 */
import { useSyncExternalStore } from "react";

import { ASSET_BASE, setAssetVersionPath } from "../../../shared/env.ts";
import { createCompanionDialog } from "./companionDialog.ts";
import { createCompanionSession, type CompanionSessionConfig, type KeyValueStore } from "./companionSession.ts";

const QUERY = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);

/**
 * 동행 NPC 를 그리는가. ?npc=off 면 끈다.
 * ?npc(값 없음 · off 가 아닌 값)는 샌드박스 NPC 개발 테스트(runtimeFlags.IS_NPC_TEST)라 동행은 띄우지 않는다 — 두 NPC 가 겹치지 않게.
 */
export const IS_COMPANION_ENABLED = !QUERY.has("npc");

/** 자막 이름 줄 — 동행 캐릭터 이름은 아직 정해지지 않았다(PM 결정 대기) */
export const COMPANION_NAME = "동행";

/** 개발 서버에서만 읽는다. 배포 빌드에서는 import.meta.env.DEV 가 false 라 늘 null 이다 */
export const MOCK_SCENARIO = import.meta.env.DEV ? QUERY.get("npc-mock") : null;

function readConfig(): CompanionSessionConfig | null {
  if (MOCK_SCENARIO !== null) return { caseId: "mock-naju-case", contentVersion: 1 };
  const caseId = QUERY.get("npc-case") ?? import.meta.env.VITE_NAJU_NPC_CASE_ID ?? "";
  const rawVersion = QUERY.get("npc-version") ?? import.meta.env.VITE_NAJU_NPC_CONTENT_VERSION ?? "";
  const contentVersion = Number(rawVersion);
  if (!caseId || !Number.isInteger(contentVersion) || contentVersion < 1) return null;
  return { caseId, contentVersion };
}

const memoryStorage = (): KeyValueStore => {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
};

function browserStorage(): KeyValueStore | null {
  // 모의 응답의 세션은 실제 기록과 섞지 않는다
  if (MOCK_SCENARIO !== null) return memoryStorage();
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const log = (level: "warn" | "error", message: string, detail?: unknown) => {
  // 서버 영문 detail 은 화면이 아니라 여기(콘솔)에만 남는다
  console[level](`[동행 NPC] ${message}`, detail ?? "");
};

/**
 * 세션에 고정된 판의 에셋 경로를 케이스 에셋 주소에 쓴다(asset_base_path, #47).
 * null 은 버전 없는 옛 세션 · 잘못된 case_id 다 — 빌드 기본 경로(VITE_DEFAULT_CASE_PATH)로 돌아가므로 CDN 빌드에서는 경고를 남긴다.
 * 본편 세션은 부르지 않는다 — 본편은 케이스 에셋을 안 읽고, 탭 저장소를 나주와 같이 써서 다른 케이스 경로가 넘어온다.
 */
function applyAssetBasePath(path: string | null) {
  if (path === null && ASSET_BASE)
    log("warn", "세션에 에셋 경로(asset_base_path)가 없어 빌드 기본 경로로 읽는다 — 게시 판과 다를 수 있다");
  setAssetVersionPath(path);
}

export const companionSession = createCompanionSession({
  config: IS_COMPANION_ENABLED ? readConfig() : null,
  storage: typeof window === "undefined" ? null : browserStorage(),
  log: (message, detail) => log("warn", message, detail),
  onAssetBasePath: applyAssetBasePath,
});

export const companionDialog = createCompanionDialog({ session: companionSession, log });

let started: Promise<unknown> | null = null;

/** 게임이 뜰 때 한 번. 모의 응답이면 먼저 깔고 세션을 연다 */
export function startCompanion() {
  started ??= (async () => {
    if (import.meta.env.DEV && MOCK_SCENARIO !== null) {
      const { installCompanionMock } = await import("./devMock");
      installCompanionMock(MOCK_SCENARIO);
    }
    return companionSession.start();
  })();
  return started;
}

export const useCompanionSession = () => useSyncExternalStore(companionSession.subscribe, companionSession.getStatus);
export const useCompanionDialog = () => useSyncExternalStore(companionDialog.subscribe, companionDialog.getState);
