// 같은 방 사람들의 아바타 상자(AvatarLink) — 인사·맞기·주먹 동작을 걸려고 연결 ID 로 찾는다.
// 원격은 RemotePlayers 가 그릴 때 등록·해제하고, 나는 localPlayer(App 의 실제 상자)다.
import type { AvatarAction, AvatarLink } from "@/engine/avatarLink";

export const remoteLinks = new Map<string, AvatarLink>();

let serial = 0;

/** 한 번 트는 동작을 건다 — 같은 동작을 연달아 걸어도 회차가 바뀌어 처음부터 */
export function playAction(link: AvatarLink | null | undefined, kind: "emote" | "hit", steps: AvatarAction["steps"]) {
  if (!link) return;
  serial += 1;
  link[kind] = { serial, at: performance.now() / 1000, steps };
}

/** 남의 주먹 — 본편 펀치와 같은 통로(attackSerial 이 바뀌면 attackMotion 을 한 번) */
export function playPunch(link: AvatarLink | null | undefined, clip: string) {
  if (!link) return;
  link.attackMotion = clip;
  link.attackSerial = (link.attackSerial ?? 0) + 1;
}
