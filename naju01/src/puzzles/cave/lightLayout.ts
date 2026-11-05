/**
 * 진주 빛 잇기 — 자리표와 빛길 셈. AirStations 가 퍼즐로 쓰고, CaveWorld 는 이 자리와 빛길에 바위·자갈을 안 놓는다. 미터.
 * 조개 다섯이 모래 위에 입을 벌리고 있고 속마다 진주가 있다. 어미 진주만 스스로 빛난다.
 * 조개를 돌려 입이 「빛나는 진주」를 똑바로 향하면 그 사이에 빛줄기가 이어지고 그 조개의 진주도 빛난다.
 * 차례로 이어 큰 조개까지 닿으면 큰 조개가 열린다. 방향은 45° 여덟 칸: 0=동(+x) 1=남동 2=남(+z) 3=남서 4=서(−x) 5=북서 6=북(−z) 7=북동
 *
 *   어미(51.2,60.5) ↙ 조개1(48.2,63.5) → 조개2(51.2,63.5) ↓ 조개3(51.2,66) ← 조개4(48.2,66) ↓ 큰 조개(48.2,68.5)
 *   빛길끼리 안 엇갈리고, 자리끼리 2.5 m 넘게 떨어져 있다. 답은 각 조개가 앞 조개를 보는 방향 [7, 4, 6, 0].
 */
import * as THREE from "three";

import { floorY } from "./caveState";

export const FACINGS = 8;

export const LIGHT_SOURCE = { x: 51.2, z: 60.5 };
/** 돌리는 조개 넷 — start 는 처음 향한 쪽(답이 아닌 쪽) */
export const LIGHT_CLAMS = [
  { x: 48.2, z: 63.5, start: 3 },
  { x: 51.2, z: 63.5, start: 1 },
  { x: 51.2, z: 66.0, start: 4 },
  { x: 48.2, z: 66.0, start: 5 },
];
export const LIGHT_BIG = { x: 48.2, z: 68.5 };

/** 빛이 지나는 마디 차례 — 어미 → 조개 넷 → 큰 조개 */
const LIGHT_NODES = [LIGHT_SOURCE, ...LIGHT_CLAMS, LIGHT_BIG].map(({ x, z }) => ({ x, z }));

/** 방향 → 단위 벡터 */
const facingDir = (facing: number) => {
  const angle = (facing / FACINGS) * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle) };
};

/** from 에서 to 를 똑바로 보는 방향 칸. 자리표는 45° 격자에 맞춰 두었다 */
function facingToward(from: { x: number; z: number }, to: { x: number; z: number }) {
  const angle = Math.atan2(to.z - from.z, to.x - from.x);
  return ((Math.round((angle / (Math.PI * 2)) * FACINGS) % FACINGS) + FACINGS) % FACINGS;
}

/** 각 마디(조개1~4·큰 조개)가 앞 마디를 보는 방향 — 조개 넷의 답 + 큰 조개의 고정 방향 */
const LIGHT_REQUIRED = LIGHT_NODES.slice(1).map((node, i) => facingToward(node, LIGHT_NODES[i]));
export const LIGHT_ANSWER = LIGHT_REQUIRED.slice(0, LIGHT_CLAMS.length);
export const LIGHT_BIG_FACING = LIGHT_REQUIRED[LIGHT_REQUIRED.length - 1];

/** 퍼즐 자리나 빛길에서 margin 안이면 true — 장식을 비우는 데 쓴다 */
export function nearLightPuzzle(x: number, z: number, margin: number) {
  for (let i = 0; i < LIGHT_NODES.length; i++) {
    const node = LIGHT_NODES[i];
    if (Math.hypot(node.x - x, node.z - z) < margin + 0.8) return true;
    if (i === 0) continue;
    const previous = LIGHT_NODES[i - 1];
    const dx = previous.x - node.x;
    const dz = previous.z - node.z;
    const length2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - node.x) * dx + (z - node.z) * dz) / length2));
    if (Math.hypot(node.x + dx * t - x, node.z + dz * t - z) < margin) return true;
  }
  return false;
}

/** 조개 입은 −z 로 벌어진다 — 그쪽이 facing 을 향하게 돌리는 yaw */
export function facingYaw(facing: number) {
  const direction = facingDir(facing);
  return Math.atan2(-direction.x, -direction.z);
}

/** 진주 가운데 높이(바닥에서) — 조개마다 같아서 빛이 수평으로 간다 */
export const PEARL_Y = 0.17;

export const pearlAt = (node: { x: number; z: number }) =>
  new THREE.Vector3(node.x, floorY(node.x, node.z) + PEARL_Y, node.z);

interface BeamSegment {
  from: THREE.Vector3;
  to: THREE.Vector3;
}

/**
 * 빛 잇기 — 어미 진주에서 차례로. 조개 k 의 입이 앞 마디(빛나는 진주)를 똑바로 향해야만 그 사이에 빛줄기가 생기고
 * 그 진주가 빛난다. 앞이 안 이어졌으면 뒤는 아무것도 없다. 넷이 다 이어지면 큰 조개(고정)까지 마지막 줄기
 */
export function traceLight(facings: number[]): { segments: BeamSegment[]; lit: boolean[]; reached: boolean } {
  const segments: BeamSegment[] = [];
  const lit = LIGHT_CLAMS.map(() => false);
  for (let k = 0; k < LIGHT_CLAMS.length; k++) {
    if (facings[k] !== LIGHT_ANSWER[k]) break;
    lit[k] = true;
    segments.push({ from: pearlAt(LIGHT_NODES[k]), to: pearlAt(LIGHT_NODES[k + 1]) });
  }
  const reached = lit.every(Boolean);
  if (reached) segments.push({ from: pearlAt(LIGHT_NODES[LIGHT_CLAMS.length]), to: pearlAt(LIGHT_BIG) });
  return { segments, lit, reached };
}
