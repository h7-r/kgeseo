// 내 플레이어 상자(App 이 만들어 이동·아바타가 함께 쓰는 AvatarLink) — 미리보기에서 내 아바타에 인사·맞기 동작을 걸려고 잡아 둔다.
// App 이 usePunch 에 넘기는 실제 ref 를 등록·해제한다(playerStateWithLobby.ts). 3단계에서는 App 이 직접 넘긴다.
import type { RefObject } from "react";

import type { AvatarLink } from "@/engine/avatarLink";

let current: RefObject<AvatarLink | null> | null = null;

export function registerLocalPlayer(ref: RefObject<AvatarLink | null>) {
  current = ref;
}

export function unregisterLocalPlayer(ref: RefObject<AvatarLink | null>) {
  if (current === ref) current = null;
}

/** 지금 내 상자. App 이 아직 안 그렸거나 내려갔으면 null */
export const localPlayer = (): AvatarLink | null => current?.current ?? null;
