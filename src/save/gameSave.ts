/**
 * 계정별 게임 저장. 서버(/api/v1/me/game-save)가 쿠키 세션의 사용자 칸에만 읽고 쓴다.
 * 로그인하지 않았으면 조용히 꺼진다 — 게임은 저장 없이 그대로 돈다.
 * 본편과 나주는 페이지가 달라도 같은 저장본의 칸(section)을 나눠 쓴다.
 */
import { apiUrl } from "@/config/env";

const SAVE_URL = apiUrl("/api/v1/me/game-save");
const CHARACTER_URL = apiUrl("/api/v1/me/character");
const SCHEMA_VERSION = 1;
const SAVE_DELAY_MS = 1500;
const POSITION_SAVE_INTERVAL_MS = 10_000;
/**
 * 개발 서버에서 주소에 ?fresh — 계정 저장을 읽지도 쓰지도 않고 손님처럼 처음부터 시작한다(미르 11/9 「중간부터 이어져 시험을 못 한다」).
 * 계정 저장본은 그대로 남는다(이 판의 진행은 어디에도 안 남는다). 배포 빌드에서는 무시한다.
 * 탭에 기억해(sessionStorage) 그 탭에서는 페이지를 넘어가도(기차 → 나주처럼 주소를 새로 만드는 이동) 이어진다 — 주소에서 빠져도
 * 계정 저장을 다시 켜지 않게(Codex 리뷰 c349d7e). 끝내려면 ?fresh=0 이나 탭을 닫는다.
 */
const FRESH_RUN_KEY = "kgeseo.freshRun";

function readFreshRun(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  const query = new URLSearchParams(window.location.search);
  const asked = query.get("fresh");
  try {
    if (asked === "0") {
      window.sessionStorage.removeItem(FRESH_RUN_KEY);
      return false;
    }
    if (asked !== null) {
      window.sessionStorage.setItem(FRESH_RUN_KEY, "1");
      return true;
    }
    return window.sessionStorage.getItem(FRESH_RUN_KEY) === "1";
  } catch {
    return asked !== null && asked !== "0";
  }
}

const IS_FRESH_RUN = readFreshRun();

export type GameStage = "character" | "tutorial" | "headquarters" | "train" | "naju";

export interface GameSaveSection {
  /** 지금 값. JSON 으로 옮길 수 있어야 한다. */
  read: () => unknown;
  /** 저장된 값을 넣는다. 게임 화면을 그리기 전에 부른다. */
  apply?: (value: unknown) => void;
}

interface SaveEnvelope {
  revision: number;
  stage: GameStage;
  state: { sections?: Record<string, unknown> };
}

const sections = new Map<string, GameSaveSection>();
let storedSections: Record<string, unknown> = {};
let revision = 0;
let stage: GameStage | null = null;
let isLoggedIn = false;
let lastWritten = "";
let saveTimer = 0;
let isWriting = false;
let isListening = false;

async function requestJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const text = await response.text();
  try {
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: response.status, body: null };
  }
}

/** 게임을 그리기 전에 한 번 부른다. 서버가 안 되면 저장 없이 시작한다. */
export async function initGameSave(): Promise<void> {
  if (IS_FRESH_RUN) {
    isLoggedIn = false;
    console.info("[저장] ?fresh — 계정 저장을 읽지도 쓰지도 않고 처음부터 시작한다(개발 서버 전용 · 이 탭 동안, 끝내려면 ?fresh=0)");
    return;
  }
  try {
    const { status, body } = await requestJson(SAVE_URL);
    isLoggedIn = status === 200;
    if (!isLoggedIn || !body) return;
    const saved = body as SaveEnvelope;
    revision = saved.revision;
    stage = saved.stage;
    storedSections = saved.state.sections ?? {};
  } catch {
    isLoggedIn = false;
  }
}

/** 이어서 시작할 단계. 저장이 없으면 null. */
export const getSavedStage = (): GameStage | null => stage;
export const isGameSaveEnabled = (): boolean => isLoggedIn;

/** 칸을 등록하고, 저장된 값이 있으면 바로 넣는다. */
export function registerSaveSection(name: string, section: GameSaveSection): void {
  sections.set(name, section);
  if (name in storedSections) section.apply?.(storedSections[name]);
}

/** 저장된 칸 값을 읽기만 한다(시작 자리처럼 그릴 때 한 번 쓰는 값). */
export function readSavedSection<T>(name: string): T | null {
  return name in storedSections ? (storedSections[name] as T) : null;
}

export function setGameStage(next: GameStage): void {
  if (stage === next) return;
  stage = next;
  scheduleGameSave();
}

function collectState(): string {
  // 이 페이지가 모르는 칸(본편에서 본 나주 칸 등)은 그대로 남긴다.
  const merged: Record<string, unknown> = { ...storedSections };
  for (const [name, section] of sections) merged[name] = section.read();
  storedSections = merged;
  return JSON.stringify({ sections: merged });
}

async function writeNow(keepalive: boolean): Promise<void> {
  if (!isLoggedIn || !stage || isWriting) return;
  const state = collectState();
  if (state === lastWritten) return;
  isWriting = true;
  try {
    const body = (rev: number) =>
      JSON.stringify({ revision: rev, schema_version: SCHEMA_VERSION, stage, state: JSON.parse(state) });
    let answer = await requestJson(SAVE_URL, { method: "PUT", body: body(revision), keepalive });
    // 다른 창이 먼저 저장했으면 지금 플레이 중인 이쪽 값을 최신 번호로 한 번 더 쓴다.
    if (answer.status === 409) {
      const conflict = (answer.body as { detail?: { revision?: number } } | null)?.detail;
      answer = await requestJson(SAVE_URL, {
        method: "PUT",
        body: body(conflict?.revision ?? revision),
        keepalive,
      });
    }
    if (answer.status === 200) {
      revision = (answer.body as SaveEnvelope).revision;
      lastWritten = state;
    } else if (answer.status === 401) {
      isLoggedIn = false;
    }
  } catch {
    // 다음 차례에 다시 쓴다.
  } finally {
    isWriting = false;
  }
}

/** 값이 바뀌었을 때 부른다. 잠깐 모아서 한 번만 쓴다. */
export function scheduleGameSave(): void {
  if (!isLoggedIn) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void writeNow(false), SAVE_DELAY_MS);
}

/** 페이지를 옮기기 직전처럼 바로 써야 할 때. */
export function flushGameSave(): Promise<void> {
  window.clearTimeout(saveTimer);
  return writeNow(true);
}

/** 창을 닫거나 숨길 때와 일정 간격으로 저장한다. 창이 꺼져도 마지막 값이 남게 한다. */
export function startGameSaveLoop(): void {
  if (!isLoggedIn || isListening) return;
  isListening = true;
  const flush = () => void flushGameSave();
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") void writeNow(false);
  }, POSITION_SAVE_INTERVAL_MS);
}

/** 캐릭터를 서버에 둔다. 다른 기기에서도 같은 모습으로 시작한다. */
export function saveCharacter(displayName: string, appearance: Record<string, unknown>): void {
  if (!isLoggedIn) return;
  void requestJson(CHARACTER_URL, {
    method: "PUT",
    body: JSON.stringify({ display_name: displayName, appearance }),
  }).catch(() => {});
}

export async function loadCharacter(): Promise<Record<string, unknown> | null> {
  if (!isLoggedIn) return null;
  try {
    const { status, body } = await requestJson(CHARACTER_URL);
    return status === 200 && body ? ((body as { appearance: Record<string, unknown> }).appearance ?? null) : null;
  } catch {
    return null;
  }
}
