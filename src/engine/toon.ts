import * as THREE from "three";

/**
 * 셀셰이딩 계단 텍스처. 빛의 세기를 steps 칸으로 딱딱 끊는다.
 * floor 는 가장 어두운 칸의 밝기(0~255) — 굴곡진 물건은 0 이면 그늘이 새까만 얼룩이 된다.
 */
export function makeToonGradient(steps = 3, floor = 0): THREE.DataTexture {
  const colors = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    colors[i] = floor + (255 - floor) * (i / (steps - 1));
  }
  const map = new THREE.DataTexture(colors, steps, 1, THREE.RedFormat);
  // Linear 로 두면 계단 사이가 도로 매끈해져 셀셰이딩이 사라진다.
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.NearestFilter;
  map.needsUpdate = true;
  return map;
}

/** 모든 toon 메시가 함께 쓰는 그라디언트. */
export const TOON_GRADIENT = makeToonGradient(3);

/** 외곽선 기본 굵기(px). */
export const OUTLINE_THICKNESS = 3;
/** 완전 검정보다 살짝 뜬 먹색이 화풍에 부드럽게 어울린다. */
export const OUTLINE_COLOR = "#2E3440";

/** 물건 하나의 선 설정. Leva 폴더에서 outlineSchema() 로 펼치고 pickOutline() 으로 꺼낸다. */
export interface OutlineValues {
  /** 실루엣 둘레(뒤집어 부풀린 껍데기) */
  outline: boolean;
  outlineWidth: number;
  outlineColor: string;
  /** 면이 꺾이는 모서리(EdgesGeometry). 외곽선이 못 그리는 안쪽 모서리를 채운다. */
  crease: boolean;
  /** 이보다 더 꺾인 모서리만 그린다 — 낮을수록 선이 많다. */
  creaseAngle: number;
  creaseColor: string;
}
