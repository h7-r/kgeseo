import * as THREE from "three";

import type { DrawerOpening } from "@/lobby/interactions";

/** 서랍 칸 경계 y (모델 높이 1 기준, GLB 에서 잰 값). 홈이 얕아 어두운 방에서는 선을 그어야 칸이 보인다. */
export const CAB_SEAMS = [0.035, 0.28, 0.52, 0.745, 0.965];
/** 앞면 좌우 끝 */
export const CAB_FX = 0.17;
/** 앞면 평면(0.234)보다 살짝 앞 — 선이 면에 파묻히지 않게 */
export const CAB_FZ = 0.2395;
/** 서랍을 빼면 드러나는 구멍의 앞면. GLB 앞판(0.234)과 손잡이 돌기(~0.2455)를 통째로 덮어야 한다. */
export const CAB_SLOT_Z = 0.25;

/** 열린 서랍 한 칸. row 는 아래부터 0, amount 는 뺀 깊이(모델 높이 1 기준). */
export interface CabinetOpening extends DrawerOpening {
  hasPapers?: boolean;
}

/** 서랍 앞판·손잡이·라벨 꽂이 테두리 선분. 열린 칸의 선만 앞으로 나온다. */
export function cabinetLineGeometry(opening: CabinetOpening | null): THREE.BufferGeometry {
  const points: number[] = [];
  // LineSegments 는 점 2개씩 짝지어 긋는다 — 사각형 하나 = 선분 4개.
  const rect = (x0: number, y0: number, x1: number, y1: number, z: number) => {
    points.push(x0, y0, z, x1, y0, z, x1, y0, z, x1, y1, z, x1, y1, z, x0, y1, z, x0, y1, z, x0, y0, z);
  };
  for (let i = 0; i < 4; i++) {
    const y0 = CAB_SEAMS[i];
    const y1 = CAB_SEAMS[i + 1];
    const d = opening && opening.row === i ? opening.amount : 0;
    const z = d ? CAB_SLOT_Z + d + 0.0145 : CAB_FZ;
    rect(-CAB_FX, y0, CAB_FX, y1, z);
    const handleY = (y0 + y1) / 2 - 0.02;
    rect(-0.055, handleY - 0.017, 0.055, handleY + 0.017, z + 0.006);
    const labelY = (y0 + y1) / 2 + 0.052;
    rect(-0.04, labelY - 0.02, 0.04, labelY + 0.02, z + 0.002);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

/** 닫힌 캐비닛은 모두 이 한 벌을 같이 쓴다. */
export const CAB_LINE_GEO = cabinetLineGeometry(null);

interface CabinetOpenPlan {
  row: number;
  extent: "slight" | "wide";
  hasPapers?: boolean;
}

/** 캐비닛마다 기본으로 열어 둘 서랍. 12칸 중 3칸만 — 둘은 서류가 보이게 더 연다. */
export const CAB_OPEN_PLAN: CabinetOpenPlan[] = [
  { row: 0, extent: "slight" },
  // 허리 높이라 안이 잘 보인다
  { row: 2, extent: "wide", hasPapers: true },
  { row: 1, extent: "wide", hasPapers: true },
];
