import { useEffect, useState } from "react";

/**
 * 로그인 세션. 인증 서버가 붙기 전까지 sessionStorage 에만 둔다.
 * 화면 흐름을 위한 잠금일 뿐 보안 장치가 아니다 — 실제 검증은 서버 토큰이 해야 한다.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  region?: string;
  joinedAt?: number;
  isTest?: boolean;
}

interface StoredSession extends SessionUser {
  signedInAt: number;
}

const STORAGE_KEY = "waegok.session";
const CHANGE_EVENT = "site:sessionchange";
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const EXPIRY_CHECK_MS = 60 * 1000;

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
    // 모양이 어긋난 값은 만료된 세션처럼 지운다.
    if (!isStoredSession(session) || !session.signedInAt || Date.now() - session.signedInAt > SESSION_TTL_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    // 사생활 보호 모드 등에서 저장소가 막히면 로그아웃 상태로 본다.
    return null;
  }
}

/** 지금 로그인한 사용자. 없거나 만료됐으면 null. */
export function getSessionUser(): SessionUser | null {
  return readSession();
}

export function signIn(user: SessionUser) {
  // 비밀번호 해시 같은 값이 실수로 섞이지 않게 필요한 필드만 골라 담는다.
  const session: StoredSession = {
    id: user.id,
    email: user.email,
    name: user.name,
    region: user.region,
    joinedAt: user.joinedAt,
    isTest: user.isTest,
    signedInAt: Date.now(),
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // 저장이 막혀도 화면 흐름은 이어 간다.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function signOut() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 무시
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** 로그인 상태를 구독한다. 만료와 다른 탭의 로그아웃도 따라간다. */
export function useSessionUser(): SessionUser | null {
  const [session, setSession] = useState(readSession);

  useEffect(() => {
    const refresh = () =>
      setSession((prev) => {
        const next = readSession();
        const unchanged = prev?.email === next?.email && prev?.signedInAt === next?.signedInAt;
        return unchanged ? prev : next;
      });

    const timer = window.setInterval(refresh, EXPIRY_CHECK_MS);
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return session;
}
