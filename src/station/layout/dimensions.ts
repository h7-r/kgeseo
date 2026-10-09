/** 본부실(폐역) 방 치수와 색. 1 유닛 ≈ 0.30m. */

export const HEADQUARTERS_W = 36; // x 폭
export const HEADQUARTERS_D = 26; // z 깊이
export const HEADQUARTERS_H = 12; // 천장 높이

// 방 껍데기는 중심 대칭으로 그려진다. 왼쪽 벽 x = -20, 앞쪽 벽 z = -14 를 기준으로 중심을 잡는다.
export const HEADQUARTERS_CENTER_X = -20 + HEADQUARTERS_W / 2; // = -2
export const HEADQUARTERS_CENTER_Z = -14 + HEADQUARTERS_D / 2; // = -1

/** 플레이어가 넘을 수 없는 실제 벽 좌표. */
export const HEADQUARTERS_MIN_X = HEADQUARTERS_CENTER_X - HEADQUARTERS_W / 2;
export const HEADQUARTERS_MAX_X = HEADQUARTERS_CENTER_X + HEADQUARTERS_W / 2;
export const HEADQUARTERS_MIN_Z = HEADQUARTERS_CENTER_Z - HEADQUARTERS_D / 2;
export const HEADQUARTERS_MAX_Z = HEADQUARTERS_CENTER_Z + HEADQUARTERS_D / 2;

/** 폐역 톤 — 구조(가장 어두움) < 벽 < 바닥 < 천장 프레임, 골드만 따뜻한 포인트. */
export const HEADQUARTERS_PALETTE = {
  struct: "#3E444E", // 구조 기둥 · 문틀
  structDark: "#31363E", // 몰딩 · 걸레받이
  ceilingFrame: "#464C56", // 천장 대들보 — 천장보다 살짝 밝게
  gold: "#E0A94E", // 장비 · 조명 불빛
} as const;

// 충돌 박스와 HeadquartersShell 의 모서리 기둥 메시가 같은 값을 써야 어긋나지 않는다.
export const CORNER_INSET = 0.455; // 벽면에서 기둥 중심까지
export const CORNER_SIZE = 0.8; // 기둥 한 변

interface AreaBox {
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
  const cx = HEADQUARTERS_CENTER_X + sx * (HEADQUARTERS_W / 2 - CORNER_INSET);
  const cz = HEADQUARTERS_CENTER_Z + sz * (HEADQUARTERS_D / 2 - CORNER_INSET);
  const h = CORNER_SIZE / 2;
  return { minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h };
});
