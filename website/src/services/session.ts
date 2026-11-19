import { useEffect, useState } from "react";

import { createStore, useStore } from "@/app/siteState";
import { apiUrl } from "@/config/env";

/**
 * 로그인 세션(화면용). 진짜 세션은 서버 쿠키(waegok_session · HttpOnly · 14일)에 있고,
 * 여기는 서버가 확인해 준 사용자를 이 탭의 sessionStorage 에 비춰 두는 거울이다.
 *
 * - 로그인 여부는 서버 /me 만 믿는다. 이 탭에는 만료 시간이 없다 — 서버가 401 을 주면 그때 끝난 것으로 본다(11/18, 2시간 TTL 제거).
 * - /me · /me/* 를 부르는 곳은 401 을 받으면 endLocalSession() 을 부른다(마이페이지 진행 · 내 문의 · 복원).
 * - sessionStorage 는 탭마다 따로라 'storage' 이벤트가 안 울린다. 다른 탭에는 localStorage 신호(waegok.sessionSignal)로 알린다.
 * - 보안 장치가 아니라 화면 흐름용 잠금이다. 실제로 막는 것은 서버다.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  region?: string;
  joinedAt?: number;
  isTest?: boolean;
  /** "local" · "google" · "naver" */
  provider?: string;
  /** 소셜 계정 프로필 사진 주소 */
  picture?: string;
}

interface StoredSession extends SessionUser {
  /** 이 탭에 적은 시각. 같은 계정으로 다시 로그인한 것도 바뀐 것으로 보려고 둔다(만료 판정에는 쓰지 않는다). */
  signedInAt: number;
}

/** 이 탭의 사용자(sessionStorage) */
const STORAGE_KEY = "waegok.session";
/** 이 브라우저에서 로그인한 적이 있다는 표식(localStorage). 새 탭이 서버 답을 기다릴지 정할 때만 본다. */
const HINT_KEY = "waegok.sessionHint";
/** 다른 탭에 보내는 신호(localStorage). 값이 바뀌어야 울리므로 시각을 함께 적는다. */
const SIGNAL_KEY = "waegok.sessionSignal";
/** 서버 로그아웃이 닿지 않았다는 표식(localStorage). 다음 방문에 다시 시도하고, 그동안 복원하지 않는다. */
const LOGOUT_PENDING_KEY = "waegok.logoutPending";
const CHANGE_EVENT = "site:sessionchange";
/** 탭이 다시 보일 때 서버 재확인은 이 간격보다 자주 하지 않는다. */
const RECHECK_MIN_MS = 10 * 1000;

type TabSignal = "signedIn" | "signedOut";

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== "object" || value === null) return false;
  const session = value as Record<string, unknown>;
  return (
    typeof session.id === "string" &&
    typeof session.email === "string" &&
    typeof session.name === "string" &&
    typeof session.signedInAt === "number"
  );
}

function readSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session: unknown = JSON.parse(raw);
    // 모양이 어긋난 값(옛 판 · 손댄 값)은 없는 것으로 보고 지운다.
    if (!isStoredSession(session) || (import.meta.env.PROD && session.isTest)) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    // 사생활 보호 모드 등에서 저장소가 막히면 로그아웃 상태로 본다.
    return null;
  }
}

/** 지금 로그인한 사용자. 없으면 null. */
export function getSessionUser(): SessionUser | null {
  return readSession();
}

const notifyChange = () => window.dispatchEvent(new Event(CHANGE_EVENT));

// ── localStorage 표식 — 저장소가 막혀도 화면 흐름은 이어 간다 ──

function readFlag(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeFlag(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 무시
  }
}

const hasSessionHint = () => readFlag(HINT_KEY) !== null;
const isLogoutPending = () => readFlag(LOGOUT_PENDING_KEY) !== null;

function signalOtherTabs(kind: TabSignal) {
  writeFlag(SIGNAL_KEY, JSON.stringify({ kind, at: Date.now() }));
}

function parseTabSignal(raw: string | null): TabSignal | null {
  if (!raw) return null;
  try {
    const { kind } = JSON.parse(raw) as { kind?: unknown };
    return kind === "signedIn" || kind === "signedOut" ? kind : null;
  } catch {
    return null;
  }
}

// ── 이 탭의 세션 쓰기 · 지우기 ──

/** 서버가 확인해 준 사용자를 이 탭에 적는다. 비밀번호 해시 같은 값이 섞이지 않게 필요한 필드만 담는다. */
function writeSession(user: SessionUser) {
  const session: StoredSession = {
    id: user.id,
    email: user.email,
    name: user.name,
    region: user.region,
    joinedAt: user.joinedAt,
    isTest: user.isTest,
    provider: user.provider,
    picture: user.picture,
    signedInAt: Date.now(),
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // 저장이 막혀도 화면 흐름은 이어 간다.
  }
  writeFlag(HINT_KEY, "1");
  notifyChange();
}

function clearStoredSession() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 무시
  }
  writeFlag(HINT_KEY, null);
  notifyChange();
}

/** 로그인(이 탭에서 사람이 했다). 다른 탭도 서버에 다시 물어 따라오게 한다. */
export function signIn(user: SessionUser) {
  if (import.meta.env.PROD && user.isTest) return;
  // 새로 로그인하면 서버 쿠키가 새것으로 바뀐다 — 못 보낸 옛 로그아웃은 더 할 일이 없다.
  writeFlag(LOGOUT_PENDING_KEY, null);
  writeSession(user);
  signalOtherTabs("signedIn");
}

/**
 * 서버가 「세션 없음(401)」이라고 답했을 때 부른다 — 이 탭의 로그인 표시를 거둔다.
 * 시연용 테스트 계정은 서버에 없는 계정이라 그대로 둔다.
 */
export function endLocalSession() {
  const local = readSession();
  if (local?.isTest) return;
  // 새 탭처럼 적힌 것이 없어도 표식은 거둔다 — 다음 새 탭이 서버 답을 기다리지 않게.
  if (local) clearStoredSession();
  else writeFlag(HINT_KEY, null);
  // 쿠키는 탭이 함께 쓰니 다른 탭도 끝난 것이다.
  signalOtherTabs("signedOut");
}

// ── 서버와 맞추기 ──

type MeAnswer = { kind: "signedIn"; user: SessionUser } | { kind: "signedOut" } | { kind: "unreachable" };

/** GET /me. 쿠키가 살아 있으면 사용자, 401 이면 signedOut, 못 닿거나 다른 오류면 unreachable. */
async function askServer(): Promise<MeAnswer> {
  try {
    const response = await fetch(apiUrl("/api/v1/me"), { credentials: "include", cache: "no-store" });
    if (response.status === 401) return { kind: "signedOut" };
    if (!response.ok) return { kind: "unreachable" };
    const me = (await response.json()) as { user_id: string; email: string; nickname: string; region: string | null };
    return {
      kind: "signedIn",
      // provider · picture 는 /me 가 주지 않으니 이 탭에 있던 값을 이어 쓴다.
      user: { ...readSession(), id: me.user_id, email: me.email, name: me.nickname, region: me.region ?? "" },
    };
  } catch {
    return { kind: "unreachable" };
  }
}

/** POST /me/logout 이 204 로 끝났는가. 서버가 꺼져 있거나 거절하면 false. */
async function requestServerLogout(): Promise<boolean> {
  try {
    const response = await fetch(apiUrl("/api/v1/me/logout"), {
      method: "POST",
      keepalive: true,
      credentials: "include",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 로그아웃. 이 탭과 다른 탭은 바로 로그아웃으로 보이고, 서버 세션은 204 를 받아 확인한다.
 * 서버에 닿지 않으면 표식을 남겨 다음 방문에 다시 보내고, 그동안 쿠키로 되살아나지 않게 막는다.
 */
export async function signOut(): Promise<boolean> {
  clearStoredSession();
  signalOtherTabs("signedOut");
  const isConfirmed = await requestServerLogout();
  writeFlag(LOGOUT_PENDING_KEY, isConfirmed ? null : "1");
  return isConfirmed;
}

// 서버에 로그인 여부를 묻는 중인가 — 새 탭의 보호 화면이 403 을 미리 보이지 않게 이걸 본다.
const restoreStateStore = createStore<"idle" | "restoring" | "done">("idle");
let lastRestoreAt = 0;

/**
 * 부팅 · 탭이 다시 보일 때 서버와 맞춘다. 쿠키가 살아 있으면 로그인을 이어 주고(새 탭 포함),
 * 서버가 끝났다고 하면 이 탭도 로그아웃한다. 서버에 못 닿으면 그대로 둔다(시연용 테스트 계정).
 */
export async function restoreServerSession(): Promise<void> {
  restoreStateStore.set("restoring");
  lastRestoreAt = Date.now();
  try {
    // 못 보낸 로그아웃이 있으면 그것부터 — 될 때까지는 /me 를 묻지 않는다(로그아웃하려던 사람이 다시 로그인되면 안 된다).
    if (isLogoutPending()) {
      if (await requestServerLogout()) writeFlag(LOGOUT_PENDING_KEY, null);
      return;
    }
    const answer = await askServer();
    if (answer.kind === "signedIn") writeSession(answer.user);
    else if (answer.kind === "signedOut") endLocalSession();
  } finally {
    restoreStateStore.set("done");
  }
}

/**
 * 게임으로 떠나기 직전에 서버 세션을 한 번 확인한다. 끊겨 있으면(다른 탭 로그아웃 · 쿠키 만료) 로그아웃하고 false.
 * 서버에 못 닿으면 true — 게임 문지기가 다시 본다. 테스트 계정은 서버에 없으니 묻지 않는다.
 * 살아 있을 때 이 탭에 다시 적지는 않는다 — 적으면 사용자 값이 바뀌어 부른 쪽이 또 부를 수 있다.
 */
export async function confirmServerSession(): Promise<boolean> {
  if (readSession()?.isTest) return true;
  const answer = await askServer();
  if (answer.kind !== "signedOut") return true;
  endLocalSession();
  return false;
}

/**
 * 서버에 묻는 중이라 로그인 여부를 아직 모르는가. 이 브라우저에서 로그인한 적이 있을 때만 참이다 —
 * 처음 온 사람은 기다릴 것 없이 바로 로그아웃 화면을 본다. 쓰는 쪽은 이 탭의 사용자(useSessionUser)를 먼저 본다.
 */
export function useSessionChecking(): boolean {
  const state = useStore(restoreStateStore, "idle");
  return state === "restoring" && hasSessionHint();
}

// ── 다른 탭 · 탭 전환 따라가기 ──

function handleStorageSignal(event: StorageEvent) {
  if (event.key !== SIGNAL_KEY) return;
  const signal = parseTabSignal(event.newValue);
  // 다른 탭의 로그아웃은 서버 응답을 기다리지 않고 바로 따라간다(그쪽이 쿠키를 끝낸다).
  if (signal === "signedOut" && readSession()) clearStoredSession();
  // 다른 탭의 로그인은 서버에 물어 같은 사용자를 받는다.
  else if (signal === "signedIn") void restoreServerSession();
}

function handleVisible() {
  if (document.visibilityState !== "visible") return;
  // 로그인 상태로 보이는 탭만 — 쿠키가 사라졌는지(만료 · 삭제 · 다른 기기 로그아웃) 서버에 다시 묻는다.
  if (!readSession() || Date.now() - lastRestoreAt < RECHECK_MIN_MS) return;
  void restoreServerSession();
}

/** 부팅 때 한 번. 다른 탭의 로그인 · 로그아웃 신호와 탭이 다시 보일 때를 듣는다(앱이 살아 있는 동안 계속). */
export function startSessionWatch(): void {
  window.addEventListener("storage", handleStorageSignal);
  document.addEventListener("visibilitychange", handleVisible);
}

/** 로그인 상태를 구독한다. 이 탭의 변화와 다른 탭의 신호(startSessionWatch)가 모두 여기로 모인다. */
export function useSessionUser(): SessionUser | null {
  const [session, setSession] = useState(readSession);

  useEffect(() => {
    const refresh = () =>
      setSession((prev) => {
        const next = readSession();
        const unchanged = prev?.email === next?.email && prev?.signedInAt === next?.signedInAt;
        return unchanged ? prev : next;
      });

    window.addEventListener(CHANGE_EVENT, refresh);
    return () => window.removeEventListener(CHANGE_EVENT, refresh);
  }, []);

  return session;
}
