/**
 * 마이페이지가 읽는 내 게임 데이터. 셋 다 로그인 쿠키로만 열리는 /me 아래라 서버가 이 계정 것만 돌려준다.
 * 화면이 다른 사람 값을 들고 있지 않게 들고 있던 값은 화면 쪽 상태로만 두고 따로 저장하지 않는다.
 */
import { apiUrl } from "@/config/env";
import {
  summarizeMyProgress,
  type CharacterBody,
  type GameSaveBody,
  type MyProgress,
  type OwnedItemBody,
} from "@/lib/myProgress";

export type MyProgressResult =
  | { status: "ready"; progress: MyProgress }
  /** 로그인이 풀렸다 */
  | { status: "signedOut" }
  /** 서버에 못 닿았다 */
  | { status: "error" };

class SignedOutError extends Error {}

/** 본문이 없으면(아직 저장이 없음) null. 401 이면 로그아웃으로 알린다 */
async function getMine<T>(path: string): Promise<T | null> {
  const response = await fetch(apiUrl(path), { credentials: "include", cache: "no-store" });
  if (response.status === 401) throw new SignedOutError();
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  const text = await response.text();
  return text ? (JSON.parse(text) as T | null) : null;
}

export async function fetchMyProgress(): Promise<MyProgressResult> {
  try {
    const [save, items, character] = await Promise.all([
      getMine<GameSaveBody>("/api/v1/me/game-save"),
      getMine<OwnedItemBody[]>("/api/v1/me/items"),
      getMine<CharacterBody>("/api/v1/me/character"),
    ]);
    return { status: "ready", progress: summarizeMyProgress(save, items ?? [], character) };
  } catch (error) {
    return error instanceof SignedOutError ? { status: "signedOut" } : { status: "error" };
  }
}
