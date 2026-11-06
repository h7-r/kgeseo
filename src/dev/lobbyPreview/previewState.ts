// 로비 실제 화면 미리보기(개발 전용)의 공용 상태 — Canvas 안(LobbyPreviewRig)과 밖(LobbyPreviewHud)이 같이 쓴다.
// 3단계(본부실 정식 연결) 전에 실제 본부실에서 입장·이동·인사·퇴장을 눈으로 보려는 장치다. 연결은 src/net/colyseus.ts 그대로.
import { useSyncExternalStore } from "react";

import { apiUrl, LOBBY_URL } from "@/config/env";
import { exposeDevHook } from "@/debug/devHooks";
import { createLobbyConnection, type LobbyLook, type LobbyPose, type LobbyStatus } from "@/net/colyseus";
import { characterToLobbyLook, defaultLobbyLook } from "@/net/lobbyLook";

/** 설계 1절 인사 문구(1~6) */
export const GREETINGS = ["안녕하세요", "반가워요", "나주 다녀올게요", "화이팅!", "고마워요", "잘 가요"] as const;
export const BUBBLE_MS = 3000;
export const GREET_COOLDOWN_MS = 3000;

const query = new URLSearchParams(window.location.search);
/** 캐릭터를 저장하지 않은 계정의 기본 외형 성별 — 두 창을 구별해 보려고 ?lobbyGender=masculine */
const fallbackGender: LobbyLook["gender"] = query.get("lobbyGender") === "masculine" ? "masculine" : "feminine";

/** 캐릭터를 저장하지 않은 계정의 기본 외형 — 머리를 바꿔 보려면 ?lobbyHair=hair.f.long 처럼 카탈로그 ID */
const previewLook = (): LobbyLook => {
  const look = defaultLobbyLook(fallbackGender);
  const hair = query.get("lobbyHair");
  return hair ? { ...look, hair } : look;
};

let myLook: LobbyLook = previewLook();
/** 보내는 자세 — 리그가 매 프레임 채운다 */
export const localPose: LobbyPose = { x: 0, y: 0, z: 0, ry: 0, gait: "idle" };

export const connection = createLobbyConnection({
  // 개발 미리보기 전용 — 빌드 값(VITE_LOBBY_URL)이 비어 있으면 로컬 로비(npm run dev)로 붙는다
  lobbyUrl: LOBBY_URL || "http://localhost:2567",
  apiUrl,
  getJoinOptions: () => ({ look: myLook, pose: { ...localPose } }),
});

/** 말풍선: 연결 ID → 문구·끝나는 때 */
export const bubbles = new Map<string, { text: string; until: number }>();
connection.onGreet(({ sid, id }) => {
  bubbles.set(sid, { text: GREETINGS[id - 1] ?? "?", until: Date.now() + BUBBLE_MS });
});

// --- 화면이 구독하는 작은 상태(로그인 · 연결 상태) ---
interface PreviewState {
  status: LobbyStatus;
  me: string;
  loggedIn: boolean;
}
let state: PreviewState = { status: connection.status(), me: "확인 중", loggedIn: false };
const listeners = new Set<() => void>();
const setState = (patch: Partial<PreviewState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};
connection.subscribe((status) => setState({ status }));
export const usePreviewState = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );

/** 로그인 상태와 저장된 캐릭터 외형을 읽는다(없으면 기본 착장) */
export async function refreshAccount() {
  try {
    const me = await fetch(apiUrl("/api/v1/me"), { credentials: "include" });
    if (!me.ok) {
      setState({ me: `로그인 안 됨(${me.status})`, loggedIn: false });
      return;
    }
    const body = (await me.json()) as { nickname: string };
    setState({ me: `로그인: ${body.nickname}`, loggedIn: true });
    const character = await fetch(apiUrl("/api/v1/me/character"), { credentials: "include" });
    const saved = character.ok ? ((await character.json()) as { appearance?: unknown } | null) : null;
    myLook = characterToLobbyLook(saved?.appearance) ?? previewLook();
  } catch {
    setState({ me: "API 접속 실패", loggedIn: false });
  }
}

export async function devLogin(email: string, password: string) {
  const response = await fetch(apiUrl("/api/v1/auth/login"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) setState({ me: `로그인 실패(${response.status})`, loggedIn: false });
  else await refreshAccount();
}

let lastGreetAt = -Infinity;
export function greet(id: number) {
  const now = Date.now();
  if (now - lastGreetAt < GREET_COOLDOWN_MS) return false;
  if (!connection.sendGreet(id)) return false;
  lastGreetAt = now;
  return true;
}

exposeDevHook("lobbyPreview", {
  status: () => connection.status(),
  players: () => [...connection.players().entries()].map(([sid, p]) => ({ sid, nickname: p.nickname, x: p.x, z: p.z })),
});
