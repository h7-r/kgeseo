/** 본부실(폐역) 방 치수와 색. 1 유닛 ≈ 0.30m. */

export const ROOM_W = 36; // x 폭 — 줄인 만큼은 전부 기차 쪽(+x)에서 뺐다
export const ROOM_D = 26; // z 깊이 — 줄인 만큼은 전부 캐비닛 쪽(+z)에서 뺐다
export const ROOM_H = 12; // 천장 높이

// 방 껍데기는 원점 대칭으로 그려진다. 한쪽 벽만 안으로 들이려고 방 전체를 옮긴다.
// 왼쪽 벽 x = -20, 앞쪽 벽 z = -14 는 그대로다.
export const ROOM_CX = -20 + ROOM_W / 2; // = -2
export const ROOM_CZ = -14 + ROOM_D / 2; // = -1

/** 플레이어가 넘을 수 없는 실제 벽 좌표. */
export const MIN_X = ROOM_CX - ROOM_W / 2;
export const MAX_X = ROOM_CX + ROOM_W / 2;
export const MIN_Z = ROOM_CZ - ROOM_D / 2;
export const MAX_Z = ROOM_CZ + ROOM_D / 2;

/** 폐역 톤 — 구조(가장 어두움) < 벽 < 바닥 < 천장 프레임, 골드만 따뜻한 포인트. */
export const PALETTE = {
  struct: "#3E444E", // 구조 기둥 · 문틀
  structDark: "#31363E", // 몰딩 · 걸레받이
  ceilingFrame: "#464C56", // 천장 대들보 — 천장보다 살짝 밝게
  gold: "#E0A94E", // 장비 · 조명 불빛
} as const;

// 충돌 박스와 RoomShell 의 모서리 기둥 메시가 같은 값을 써야 어긋나지 않는다.
export const CORNER_INSET = 0.455; // 벽면에서 기둥 중심까지
export const CORNER_SIZE = 0.8; // 기둥 한 변

export interface AreaBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const CORNER_BOXES: AreaBox[] = (
  [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const
).map(([sx, sz]) => {
  const cx = ROOM_CX + sx * (ROOM_W / 2 - CORNER_INSET);
  const cz = ROOM_CZ + sz * (ROOM_D / 2 - CORNER_INSET);
  const h = CORNER_SIZE / 2;
  return { minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h };
});
