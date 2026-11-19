// 다른 사람 몸통 — 내 **걷기 판정에만** 쓴다(usePlayer 의 ./collision 을 미리보기에서 바꿔 끼운 collisionWithPeople.ts).
// 본편 공용 충돌 목록(dynamicColliders)에는 올리지 않는다 — 카메라 붐·물건 놓기·든 물건·의자 끌기는 사람에게 걸리지 않고,
// 출구 통과도 걷기에서만 빠진다(Codex 08·10). 상자 크기·줄이기는 RemotePlayers 가 매 프레임 적는다.
import { PLAYER_RADIUS } from "@/engine/movement/constants";

export interface PersonBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** 연결 ID → 몸통 상자(통과 중이거나 내 몸 안까지 들어온 사람은 빠진다) */
export const personBoxes = new Map<string, PersonBox>();

/** 내 몸(반지름 PLAYER_RADIUS)이 이 자리에 서면 다른 사람과 겹치나 */
export function isBlockedByPerson(x: number, z: number): boolean {
  for (const box of personBoxes.values()) {
    if (
      x > box.minX - PLAYER_RADIUS &&
      x < box.maxX + PLAYER_RADIUS &&
      z > box.minZ - PLAYER_RADIUS &&
      z < box.maxZ + PLAYER_RADIUS
    ) {
      return true;
    }
  }
  return false;
}
