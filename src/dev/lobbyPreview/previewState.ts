// 로비 실제 화면 미리보기(개발 전용)의 공용 상태 — Canvas 안(LobbyPreviewRig)과 밖(LobbyPreviewHud)이 같이 쓴다.
// 3단계(본부실 정식 연결) 전에 실제 본부실에서 입장·이동·인사·퇴장을 눈으로 보려는 장치다. 연결은 src/net/colyseus.ts 그대로.
import { useSyncExternalStore } from "react";

import { apiUrl, LOBBY_URL } from "@/config/env";
import { exposeDevHook } from "@/debug/devHooks";
import { playerView } from "@/engine/playerView";
import { PLAYER_MESHY_APPEARANCE_KEY } from "@/engine/storage";
import { readMeshAppearance } from "@/naju";
import { createLobbyConnection, type LobbyPose, type LobbyStatus } from "@/net/colyseus";
import { meshConfigToLobbyLook } from "@/net/lobbyLook";

import { playAction, playPunch, remoteLinks } from "./avatarLinks";
import { EMOTES, HIT_LINE, HIT_LINE_MS, HIT_REACTION, PUNCH_CLIPS } from "./emotes";
import { localPlayer } from "./localPlayer";
import { type HurtGender, playHurtVoice, preloadHurtVoices } from "./hurtVoice";
import { playThud } from "./thud";

/** 인사 문구(1~3) — 동작과 짝은 emotes.ts */
export const GREETINGS = EMOTES.map((emote) => emote.text);
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

const mySid = () => {
  const status = connection.status();
  return status.kind === "connected" ? status.sessionId : null;
};
/** 그 사람의 아바타 상자 — 나는 App 의 실제 상자, 남은 RemotePlayers 가 등록한 상자 */
const linkOf = (sid: string) => (sid === mySid() ? localPlayer() : (remoteLinks.get(sid) ?? null));

// 인사: 말풍선과 동작을 같이(서버가 돌려준 것만 — 쿨다운에 걸린 인사는 안 보인다)
connection.onGreet(({ sid, id }) => {
  const emote = EMOTES[id - 1];
  bubbles.set(sid, { text: emote?.text ?? "?", until: Date.now() + BUBBLE_MS });
  if (emote) playAction(linkOf(sid), "emote", emote.steps);
});

// --- 때리기 ---
/** 주먹을 내고 닿기까지(잽·크로스 클립에서 팔이 다 뻗는 때) 🟡 */
export const PUNCH_IMPACT_MS = 200;
/** 내 화면에서 상대를 고르는 거리·각도 — 서버는 2.8 유닛·±75° 로 다시 잰다 */
const PUNCH_REACH = 2.2;
const PUNCH_ARC = (60 * Math.PI) / 180;
/** 이 거리(유닛) 밖은 소리를 줄인다 */
const THUD_FULL_DISTANCE = 3;
const THUD_FADE_DISTANCE = 14;

// 미뤄 둔 일(주먹이 닿는 순간 보내기·맞는 동작) — 방을 나가면 모두 버린다
const timers = new Set<ReturnType<typeof setTimeout>>();
const later = (ms: number, run: () => void) => {
  const handle = setTimeout(() => {
    timers.delete(handle);
    run();
  }, ms);
  timers.add(handle);
};
connection.subscribe((status) => {
  if (status.kind === "connected") return;
  timers.forEach(clearTimeout);
  timers.clear();
});

const thudVolume = (attacker: string, target: string) => {
  const mine = mySid();
  if (attacker === mine || target === mine) return 1;
  const body = connection.players().get(target);
  if (!body) return 0;
  const distance = Math.hypot(body.x - playerView.eye.x, body.z - playerView.eye.z);
  return Math.max(0.15, Math.min(1, 1 - (distance - THUD_FULL_DISTANCE) / (THUD_FADE_DISTANCE - THUD_FULL_DISTANCE)));
};

/** 개발 훅용 — 최근 받은 인사·주먹(화면 확인) */
const recentEvents: string[] = [];
const noteEvent = (text: string) => {
  recentEvents.push(`${new Date().toISOString().slice(11, 23)} ${text}`);
  if (recentEvents.length > 20) recentEvents.shift();
};
connection.onGreet(({ sid, id }) => noteEvent(`greet ${sid}#${id}`));

/** 맞은 사람의 성별 — 나는 내 아바타 설정, 남은 방 상태의 외형(틀린 외형이면 받는 쪽 기본값처럼 남성) */
const genderOf = (sid: string): HurtGender => {
  if (sid === mySid())
    return readMeshAppearance(PLAYER_MESHY_APPEARANCE_KEY).gender === "feminine" ? "feminine" : "masculine";
  try {
    const look = JSON.parse(connection.players().get(sid)?.look ?? "") as { gender?: unknown };
    return look.gender === "feminine" ? "feminine" : "masculine";
  } catch {
    return "masculine";
  }
};

// 방에 붙으면 「윽」 음원을 미리 받아 둔다
connection.subscribe((status) => {
  if (status.kind === "connected") preloadHurtVoices();
});

connection.onPunch(({ sid, motion, hit }) => {
  noteEvent(`punch ${sid} ${motion}${hit ? ` hit ${hit}` : ""}`);
  const mine = mySid();
  // 내 주먹은 이미 돌고 있다 — 다시 틀지 않는다
  if (sid !== mine) playPunch(remoteLinks.get(sid), PUNCH_CLIPS[motion] ?? PUNCH_CLIPS.jab);
  if (!hit) return;
  // 남의 주먹은 지금 막 시작됐다 — 닿는 순간에 맞춘다. 내 주먹은 이미 닿았다
  later(sid === mine ? 0 : PUNCH_IMPACT_MS, () => {
    playAction(linkOf(hit), "hit", HIT_REACTION);
    bubbles.set(hit, { text: HIT_LINE, until: Date.now() + HIT_LINE_MS });
    const volume = thudVolume(sid, hit);
    playThud(volume);
    playHurtVoice(genderOf(hit), volume);
  });
});

/** 내가 주먹을 냈다(본편 usePunch 가 attackSerial 을 올림) — 닿는 순간에 앞쪽 가장 가까운 사람을 골라 한 번 보낸다 */
export function notePunch(motion: "jab" | "cross", isBlocked: () => boolean) {
  later(PUNCH_IMPACT_MS, () => {
    const mine = mySid();
    // 닿기 전(0.2초)에 컷신·화면창·자물쇠·기차·나주가 시작됐으면 보내지 않는다(Codex 10)
    if (!mine || isBlocked()) return;
    const facing = localPlayer()?.facing ?? playerView.bodyYaw;
    const eye = playerView.eye;
    let target: string | null = null;
    let nearest = PUNCH_REACH;
    for (const [sid, body] of connection.players()) {
      if (sid === mine || !body.placed) continue;
      const dx = body.x - eye.x;
      const dz = body.z - eye.z;
      const distance = Math.hypot(dx, dz);
      if (distance > nearest) continue;
      // 몸 방향 규약: 앞 = (sin f, cos f)
      if (distance > 0.3 && (Math.sin(facing) * dx + Math.cos(facing) * dz) / distance < Math.cos(PUNCH_ARC)) continue;
      target = sid;
      nearest = distance;
    }
    connection.sendPunch(motion, target);
  });
}

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
  /** 최근 받은 인사·주먹 */
  events: () => [...recentEvents],
  /** 내 아바타 상자를 잡았나(App 대역) */
  hasLocalPlayer: () => localPlayer() !== null,
});
