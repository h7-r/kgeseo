/**
 * 다시 접속하면 로비로(미르 11/10) — 하던 게임(나주 · 기차)으로 바로 들어가지 않고 로비(= 합동수사본부, 역의 본부실)에서 시작한다.
 * 다시 할지는 사용자가 기차의 목적지 창(케이스 목록)에서 고른다. 그 창이 하던 케이스의 진행률을 보여 준다.
 *
 *   웹사이트 「플레이하기」 → /character-creation → 저장 단계가 본부실 · 기차 · 나주면 `/?entry=lobby`
 *   나주 설정 창 · 멈춤 화면 「로비로 나가기」 → `/?entry=lobby`
 *   App 이 처음 그릴 때 이 표시를 한 번 읽어 본부실 로비 자리에서 시작하고, 주소에서 지운다.
 * 튜토리얼 중인 사람은 로비(본부실)가 아직 안 열렸다 — 지금처럼 나갔던 자리에서 튜토리얼을 잇는다.
 * 주소만으로 로비를 열지 않게 저장 단계도 함께 본다. 로그인하지 않은 사람은 저장이 없으므로, 나주에서 「로비로 나가기」를 누른
 * 그 탭에만 잠깐 표시(sessionStorage)를 남겨 받는다(Codex 리뷰 — 안 그러면 튜토리얼 처음으로 돌아갔다).
 * React · 별칭을 쓰지 않는다(node --test).
 */
import type { GameStage } from "./gameSave.ts";

export const LOBBY_ENTRY_PARAM = "entry";
export const LOBBY_ENTRY_VALUE = "lobby";
/** 로비로 들어가는 주소 */
export const LOBBY_PATH = `/?${LOBBY_ENTRY_PARAM}=${LOBBY_ENTRY_VALUE}`;

/** 로비에서 시작하는 저장 단계 — 본부실에 한 번이라도 들어선 뒤 */
const LOBBY_STAGES: ReadonlySet<GameStage> = new Set<GameStage>(["headquarters", "train", "naju"]);

export const isLobbyStage = (stage: GameStage | null): boolean => stage !== null && LOBBY_STAGES.has(stage);

/** 이 주소 · 저장 단계(또는 방금 나주에서 나온 표시)면 로비 자리에서 시작한다 */
export function wantsLobbyEntry(search: string, stage: GameStage | null, isReturning = false): boolean {
  return (
    new URLSearchParams(search).get(LOBBY_ENTRY_PARAM) === LOBBY_ENTRY_VALUE && (isLobbyStage(stage) || isReturning)
  );
}

// ── 나주 → 로비 이동 표시(이 탭에만, 잠깐) ──
const RETURN_KEY = "kgeseo.lobbyReturn";
/** 이만큼(ms) 안에 도착해야 받는다 — 오래된 표시로 나중에 아무 때나 로비가 열리지 않게 */
const RETURN_TTL_MS = 60_000;

/** 나주에서 로비로 떠나기 직전에 남긴다 */
export function markLobbyReturn(now = Date.now()): void {
  try {
    window.sessionStorage.setItem(RETURN_KEY, String(now));
  } catch {
    // 저장소가 막혔으면 저장 단계로만 판단한다
  }
}

/** 방금 나주에서 나왔나(읽기만 — 지우는 것은 clearLobbyReturn) */
export function peekLobbyReturn(now = Date.now()): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(RETURN_KEY));
    return at > 0 && now - at < RETURN_TTL_MS;
  } catch {
    return false;
  }
}

export function clearLobbyReturn(): void {
  try {
    window.sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // 없으면 그만
  }
}

/** 로비 표시를 뺀 주소(경로 · 다른 질의 · 해시는 그대로) — 새로고침하면 그때 저장된 자리로 잇게 */
export function withoutLobbyEntry(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(LOBBY_ENTRY_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * 로비에 서는 자리(미터) — 본부실 서쪽 벽(x −20)의 비밀 복도 문(z 4)으로 막 들어선 곳에서 방 안쪽(+x)을 본다.
 * 본부실은 x −20~16 · z −14~12 이고 기차도 이 방에 있다. 카메라 yaw −π/2 = +x 를 본다(three.js 0 = −z).
 */
export const LOBBY_SPOT = { x: -13, z: 4, yaw: -Math.PI / 2 } as const;
