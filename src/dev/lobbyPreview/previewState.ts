// 로비 실제 화면 미리보기(개발 전용)의 공용 상태 — Canvas 안(LobbyPreviewRig)과 밖(LobbyPreviewHud)이 같이 쓴다.
// 3단계(본부실 정식 연결) 전에 실제 본부실에서 입장·이동·인사·퇴장을 눈으로 보려는 장치다. 연결은 src/net/colyseus.ts 그대로.
import { useSyncExternalStore } from "react";

import { apiUrl, LOBBY_URL } from "@/config/env";
import { exposeDevHook } from "@/debug/devHooks";
import { PLAYER_MESHY_APPEARANCE_KEY } from "@/engine/storage";
import { readMeshAppearance } from "@/naju";
import { createLobbyConnection, type LobbyPose, type LobbyStatus } from "@/net/colyseus";
import { meshConfigToLobbyLook } from "@/net/lobbyLook";

/** 설계 1절 인사 문구(1~6) */
export const GREETINGS = ["안녕하세요", "반가워요", "나주 다녀올게요", "화이팅!", "고마워요", "잘 가요"] as const;
export const BUBBLE_MS = 3000;
export const GREET_COOLDOWN_MS = 3000;

/** 보내는 자세 — 리그가 매 프레임 채운다 */
export const localPose: LobbyPose = { x: 0, y: 0, z: 0, ry: 0, gait: "idle" };

export const connection = createLobbyConnection({
  // 개발 미리보기 전용 — 빌드 값(VITE_LOBBY_URL)이 비어 있으면 로컬 로비(npm run dev)로 붙는다
  lobbyUrl: LOBBY_URL || "http://localhost:2567",
  apiUrl,
  // 외형은 내 화면의 아바타와 같은 저장값(useLobbyAvatar 가 읽는 브라우저 저장소)에서 입장 때마다 만든다.
  // 서버 캐릭터를 따로 조회하지 않으니 조회가 끝나기 전에 입장해도 어긋나지 않는다.
  // 꾸미기 패널은 「외형 저장」을 눌러야 저장소에 적힌다 — 저장하지 않은 변경은 내 화면에만 보이고 남에게는 안 간다.
  // 저장한 변경도 다음 입장부터 반영된다(방 상태의 look 은 입장 때 한 번 정해진다). 3단계는 useLobbyAvatar 상태를 읽는다.
  // look 에 없는 값(주먹 쥔 손)과 생성 화면 범위 밖 체형(기본 모습의 팔 길이 0.7 → 0.78 등)은 남에게 다르게 보인다.
  getJoinOptions: () => ({
    look: meshConfigToLobbyLook(readMeshAppearance(PLAYER_MESHY_APPEARANCE_KEY)),
    pose: { ...localPose },
  }),
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

/** 로그인 상태를 읽는다(입장권은 로그인 쿠키로 받는다) */
export async function refreshAccount() {
  try {
    const me = await fetch(apiUrl("/api/v1/me"), { credentials: "include" });
    if (!me.ok) {
      setState({ me: `로그인 안 됨(${me.status})`, loggedIn: false });
      return;
    }
    const body = (await me.json()) as { nickname: string };
    setState({ me: `로그인: ${body.nickname}`, loggedIn: true });
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

/** 개발 훅용 — 방 상태 look 의 머리 ID(틀리면 "") */
const hairOf = (look: string) => {
  try {
    const hair = (JSON.parse(look) as { hair?: unknown }).hair;
    return typeof hair === "string" ? hair : "";
  } catch {
    return "";
  }
};

exposeDevHook("lobbyPreview", {
  status: () => connection.status(),
  players: () =>
    [...connection.players().entries()].map(([sid, p]) => ({
      sid,
      nickname: p.nickname,
      x: p.x,
      z: p.z,
      hair: hairOf(p.look),
    })),
  /** 지금 보내는 내 자세(컷신 중에는 멈춘 값) */
  pose: () => ({ ...localPose }),
});
