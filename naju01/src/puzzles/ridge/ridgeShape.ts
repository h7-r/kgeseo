/**
 * 증언 능선(Z4) 3스테이지 — 자리와 장막 모양. 좌표는 전부 미터.
 * 장막은 Z4 평지를 감싼 둥근 사각형이다. 진부촌 문(장승 둘)은 동쪽 가장자리에 걸려 「두 공간 사이」에 선다.
 */

/** 장막 — 둥근 사각형(모서리 반지름 r). 내려가는 길(T2)·올라가는 길(T3)·동쪽 내리막을 모두 바깥에 둔다 */
export const CURTAIN = { x: [62.8, 76.8] as const, z: [8.5, 31.5] as const, r: 3.2, height: 15 };
const CENTER_X = (CURTAIN.x[0] + CURTAIN.x[1]) / 2;
const CENTER_Z = (CURTAIN.z[0] + CURTAIN.z[1]) / 2;
const HALF_X = (CURTAIN.x[1] - CURTAIN.x[0]) / 2;
const HALF_Z = (CURTAIN.z[1] - CURTAIN.z[0]) / 2;
export const RIDGE_CENTER = { x: CENTER_X, z: CENTER_Z };

/** 둥근 사각형까지의 부호 있는 거리 — 안이면 음수 */
export function curtainDistance(x: number, z: number) {
  const qx = Math.abs(x - CENTER_X) - (HALF_X - CURTAIN.r);
  const qz = Math.abs(z - CENTER_Z) - (HALF_Z - CURTAIN.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - CURTAIN.r;
}
export const isInsideCurtain = (x: number, z: number, inset = 0) => curtainDistance(x, z) < -inset;

/** 둘레 길이 */
const STRAIGHT_X = 2 * (HALF_X - CURTAIN.r);
const STRAIGHT_Z = 2 * (HALF_Z - CURTAIN.r);
const ARC = (Math.PI / 2) * CURTAIN.r;
export const CURTAIN_PERIMETER = 2 * (STRAIGHT_X + STRAIGHT_Z) + 4 * ARC;

/** 둘레 위 0~1 자리 → 점과 바깥 법선. 북쪽(−z) 변 서쪽 끝에서 시계 방향(+x 쪽)으로 돈다 */
export function curtainPoint(t: number, out: { x: number; z: number; nx: number; nz: number }) {
  let d = (((t % 1) + 1) % 1) * CURTAIN_PERIMETER;
  const ix = HALF_X - CURTAIN.r;
  const iz = HALF_Z - CURTAIN.r;
  // 변 넷과 모서리 넷을 차례로: 북 변 → 북동 → 동 변 → 남동 → 남 변 → 남서 → 서 변 → 북서
  const pieces: [number, (s: number) => [number, number, number, number]][] = [
    [STRAIGHT_X, (s) => [-ix + s, -iz - CURTAIN.r, 0, -1]],
    [ARC, (s) => corner(ix, -iz, -Math.PI / 2 + s / CURTAIN.r)],
    [STRAIGHT_Z, (s) => [ix + CURTAIN.r, -iz + s, 1, 0]],
    [ARC, (s) => corner(ix, iz, s / CURTAIN.r)],
    [STRAIGHT_X, (s) => [ix - s, iz + CURTAIN.r, 0, 1]],
    [ARC, (s) => corner(-ix, iz, Math.PI / 2 + s / CURTAIN.r)],
    [STRAIGHT_Z, (s) => [-ix - CURTAIN.r, iz - s, -1, 0]],
    [ARC, (s) => corner(-ix, -iz, Math.PI + s / CURTAIN.r)],
  ];
  for (const [length, at] of pieces) {
    if (d <= length) {
      const [x, z, nx, nz] = at(d);
      out.x = CENTER_X + x;
      out.z = CENTER_Z + z;
      out.nx = nx;
      out.nz = nz;
      return out;
    }
    d -= length;
  }
  return curtainPoint(0, out);
}
function corner(cx: number, cz: number, angle: number): [number, number, number, number] {
  const nx = Math.cos(angle);
  const nz = Math.sin(angle);
  return [cx + nx * CURTAIN.r, cz + nz * CURTAIN.r, nx, nz];
}

/** 둘레에서 (x, z) 에 가장 가까운 자리(0~1) — 새가 장막을 뚫고 나가는 곳 */
export function nearestCurtainT(x: number, z: number) {
  const p = { x: 0, z: 0, nx: 0, nz: 0 };
  let best = 0;
  let bestDistance = Infinity;
  for (let k = 0; k < 240; k++) {
    curtainPoint(k / 240, p);
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = k / 240;
    }
  }
  return best;
}

/** 진부촌 문 — 장승 둘 사이(edits.json 「소품.장승」 더함 자리와 같다). 시공간 틈이 여기 열린다 */
export const GATE = {
  center: { x: 75.35, z: 12.05 },
  /** 두 장승을 잇는 방향(문 폭) */
  posts: [
    { x: 75.21, z: 10.71 },
    { x: 75.49, z: 13.38 },
  ],
  /** 횃불 둘(「소품.횃불」 고침 자리) — 불꽃 높이는 땅 위 m */
  torches: [
    { x: 75.47, z: 13.99 },
    { x: 74.78, z: 10.3 },
  ],
  flameHeight: 2.05,
};

/** 궤를 올리는 돌단 — 두 장승 사이, 틈(문 가운데 줄)보다 반 걸음 안쪽 · 윗면 높이(땅 위 m) */
export const ALTAR = { x: GATE.center.x - 0.6, z: GATE.center.z, top: 0.3 };

/** 돌새 두 마리 — 씬2 솟대 0·1 번(edits.json 「씬2.솟대」 고침 자리). 실제 자리는 그려진 솟대에서 다시 읽는다 */
export const STATUE_IDS = [0, 1] as const;
/** 오른쪽(문을 등지고 볼 때) 돌새 — 부리에 열쇠를 물고 있다 */
export const KEY_STATUE = 1;

/** 수레·궤 처음 자리 — 바퀴 자국이 문에서 수레까지 이어진다 */
export const CART_START = { x: 70.6, z: 14.2, yaw: 2.6 };
export const CHEST_START = { x: 68.4, z: 18.6, yaw: 0.4 };
/** 바퀴 자국 — 문에서 수레까지(도면 m) */
export const RUT_PATH: [number, number][] = [
  [75.6, 12.0],
  [73.8, 12.6],
  [72.2, 13.4],
  [70.6, 14.2],
];
