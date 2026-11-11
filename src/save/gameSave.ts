/**
 * 계정별 게임 저장. 서버(/api/v1/me/game-save)가 쿠키 세션의 사용자 칸에만 읽고 쓴다.
 * 로그인하지 않았으면 조용히 꺼진다 — 게임은 저장 없이 그대로 돈다.
 * 본편과 나주는 페이지가 달라도 같은 저장본의 칸(section)을 나눠 쓴다.
 */
import { apiUrl } from "@/config/env";

const SAVE_URL = apiUrl("/api/v1/me/game-save");
const CHARACTER_URL = apiUrl("/api/v1/me/character");
const ME_URL = apiUrl("/api/v1/me");
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
/**
 * 개발 서버 `?fresh` 판인가 — 계정 저장뿐 아니라 서버 퍼즐 진행(플레이 세션)도 안 쓴다. 이미 푼 계정이면 서버가 아무 답이나
 * 「이미 완료」로 받아 밸브 자물쇠가 입력 없이 열렸다(미르 11/9, 튜토피드백 12회차)
 */
export const isFreshRun = () => IS_FRESH_RUN;

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
/** 지금 오가는 저장 요청 — 떠나기 전 저장(saveBeforeLeaving)이 그것을 기다린 뒤 최신 값으로 한 번 더 쓴다 */
let writing: Promise<void> | null = null;
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
    console.info(
      "[저장] ?fresh — 계정 저장을 읽지도 쓰지도 않고 처음부터 시작한다(개발 서버 전용 · 이 탭 동안, 끝내려면 ?fresh=0)",
    );
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

/**
 * 저장된 칸을 지운다(이 페이지가 쓰지 않는 칸만 — 등록된 칸은 다음 저장 때 다시 생긴다). 실제로 지워지려면 저장을 한 번 써야 한다
 * (saveBeforeLeaving). 기차 목적지 창 「처음부터 다시」가 나주 칸(naju.*)을 지울 때 쓴다(미르 11/10).
 * 지운 칸을 돌려준다 — 저장에 실패하면 restoreSavedSections 로 되돌린다(다음 자동 저장이 진행을 지워 버리지 않게)
 */
export function removeSavedSections(match: (name: string) => boolean): Record<string, unknown> {
  const removed: Record<string, unknown> = {};
  const next = { ...storedSections };
  for (const name of Object.keys(storedSections)) {
    if (!match(name) || sections.has(name)) continue;
    removed[name] = next[name];
    delete next[name];
  }
  storedSections = next;
  return removed;
}

/** removeSavedSections 로 지운 칸을 되돌린다(그사이 다시 생긴 칸은 그대로 둔다) */
export function restoreSavedSections(removed: Record<string, unknown>): void {
  storedSections = { ...removed, ...storedSections };
}

/** detachSaveSections 로 떼어 낸 것 — 되돌릴 때 그대로 넘긴다 */
export interface DetachedSaveSections {
  sections: Map<string, GameSaveSection>;
  stored: Record<string, unknown>;
}

/**
 * 이 페이지가 쓰는 칸까지 떼어 낸다 — 등록을 풀고 저장본에서도 지운다. 나주 멈춤 메뉴 「처음부터 다시」가 나주 페이지 안에서 나주 칸을
 * 지운 뒤 페이지를 새로 열 때 쓴다(미르 11/11). 등록을 풀어 두므로 그 뒤 자동 저장 · 떠날 때 저장(pagehide)이 지운 칸을 되살리지 않는다.
 * 저장에 실패하면 reattachSaveSections 로 되돌린다.
 */
export function detachSaveSections(match: (name: string) => boolean): DetachedSaveSections {
  const detached: DetachedSaveSections = { sections: new Map(), stored: {} };
  for (const [name, section] of sections) {
    if (!match(name)) continue;
    detached.sections.set(name, section);
    sections.delete(name);
  }
  const next = { ...storedSections };
  for (const name of Object.keys(storedSections)) {
    if (!match(name)) continue;
    detached.stored[name] = next[name];
    delete next[name];
  }
  storedSections = next;
  return detached;
}

/** detachSaveSections 로 떼어 낸 칸을 다시 붙인다(값은 지금 게임 상태 그대로 — 다음 저장 때 다시 적힌다) */
export function reattachSaveSections(detached: DetachedSaveSections): void {
  for (const [name, section] of detached.sections) sections.set(name, section);
  storedSections = { ...detached.stored, ...storedSections };
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

/** 마지막으로 쓴 것과 같은지 보는 열쇠 — 단계만 바뀌어도(나주 → 로비) 다시 쓴다. 칸 값만 비교하면 단계 변경이 저장되지 않았다 */
const writtenKey = (state: string) => `${stage}\n${state}`;

/** 보내는 동안 또 쓰라고 했다 — 끝나면 그때 값으로 한 번 더 쓴다 */
let isFollowUpWanted = false;

function writeNow(keepalive: boolean): Promise<void> {
  if (!isLoggedIn || !stage) return writing ?? Promise.resolve();
  if (isWriting) {
    // 지금 오가는 요청은 그 전 값이다 — 끝난 뒤 최신 값을 놓치지 않게(본부실 첫 진입 단계가 묻히던 것, Codex 리뷰)
    isFollowUpWanted = true;
    return writing ?? Promise.resolve();
  }
  const state = collectState();
  const key = writtenKey(state);
  if (key === lastWritten) return Promise.resolve();
  isWriting = true;
  writing = sendState(state, key, keepalive).finally(() => {
    isWriting = false;
    writing = null;
    if (!isFollowUpWanted) return;
    isFollowUpWanted = false;
    // 뒤따르는 쓰기는 늘 keepalive — 떠나기 직전(pagehide · 본부실 첫 진입)에 부탁받은 것일 수 있어 창이 닫혀도 끝까지 가게(Codex 리뷰).
    // 본문은 떠날 때 저장(pagehide)과 같은 크기라 keepalive 한도 안이다
    void writeNow(true);
  });
  return writing;
}

async function sendState(state: string, key: string, keepalive: boolean): Promise<void> {
  // 보내는 동안 단계가 바뀌어도 이 요청은 모은 그때의 단계로 — 열쇠(key)와 본문이 같은 순간을 가리키게
  const sentStage = stage;
  try {
    const body = (rev: number) =>
      JSON.stringify({ revision: rev, schema_version: SCHEMA_VERSION, stage: sentStage, state: JSON.parse(state) });
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
      lastWritten = key;
    } else if (answer.status === 401) {
      isLoggedIn = false;
    }
  } catch {
    // 다음 차례에 다시 쓴다.
  }
}

/**
 * 페이지를 떠나기 직전(나주 → 로비) — 오가던 저장을 기다린 뒤 지금 값을 한 번 묶어 쓰고, 그 묶음이 실제로 저장됐는지 돌려준다.
 * 저장한 뒤 다시 모아 비교하지 않는다 — 창을 연 동안에도 매 프레임 바뀌는 칸(지게 짐 자리 등)이 있어 성공해도 실패로 보였다(Codex 리뷰).
 * 늦어도 timeoutMs 뒤에는 false 로 끝낸다(떠나는 사람을 붙잡지 않는다). null 이면 결과가 올 때까지 기다린다 — 「처음부터 다시」처럼
 * 시간 넘김을 실패로 보면 늦게 도착한 요청과 어긋나는 곳(Codex 리뷰). 로그인하지 않았으면 바로 false.
 */
export async function saveBeforeLeaving(timeoutMs: number | null = 2500): Promise<boolean> {
  if (!isLoggedIn) return false;
  window.clearTimeout(saveTimer);
  const save = (async () => {
    while (writing) await writing;
    if (!isLoggedIn || !stage) return false;
    const state = collectState();
    const key = writtenKey(state);
    if (key === lastWritten) return true;
    isWriting = true;
    writing = sendState(state, key, true).finally(() => {
      isWriting = false;
      writing = null;
    });
    await writing;
    return lastWritten === key;
  })();
  if (timeoutMs === null) return save;
  const timeout = new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([save, timeout]);
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
  // 「뒤로」로 브라우저가 기억해 둔 페이지(bfcache)가 되살아나면, 떠나기 전 저장본 · revision 을 그대로 쥐고 있다.
  // 그대로 쓰면 그 사이 다른 페이지(나주)가 저장한 진행을 옛 값으로 덮는다 — 409 도 최신 번호로 다시 써 이긴다
  // (11/11 플레이테스트 「뒤로 갔다 다시 들어오니 처음부터」). 쓰지 않고 새로 불러와 서버의 최신 저장으로 시작한다.
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    isLoggedIn = false;
    window.clearTimeout(saveTimer);
    window.location.reload();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") void writeNow(false);
  }, POSITION_SAVE_INTERVAL_MS);
}

/** 캐릭터를 서버에 둔다. 다른 기기에서도 같은 모습으로 시작한다. 서버에 저장됐으면 true(로그인 안 함 · 실패면 false) */
export async function saveCharacter(displayName: string, appearance: Record<string, unknown>): Promise<boolean> {
  if (!isLoggedIn) return false;
  try {
    const { status } = await requestJson(CHARACTER_URL, {
      method: "PUT",
      body: JSON.stringify({ display_name: displayName, appearance }),
    });
    return status >= 200 && status < 300;
  } catch {
    return false;
  }
}

/**
 * 로그인한 계정의 id — 캐릭터 생성 초안을 그 계정 것으로만 이어 만든다(같은 PC 다음 가입자에게 앞 사람 모습이 보였다, 미르 11/10).
 * 로그인 안 함 · 개발 서버 ?fresh(initGameSave 가 저장을 끈다) · 실패면 null.
 */
export async function loadAccountId(): Promise<string | null> {
  if (!isLoggedIn) return null;
  try {
    const { status, body } = await requestJson(ME_URL);
    const id = status === 200 && body && typeof body === "object" ? (body as { user_id?: unknown }).user_id : null;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
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
