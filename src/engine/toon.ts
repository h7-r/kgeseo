import * as THREE from "three";

/**
 * 셀셰이딩 계단 텍스처. 빛의 세기를 steps 칸으로 딱딱 끊는다.
 * floor 는 가장 어두운 칸의 밝기(0~255) — 굴곡진 물건은 0 이면 그늘이 새까만 얼룩이 된다.
 */
export function makeToonGradientTexture(steps = 3, floor = 0): THREE.DataTexture {
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

// 공용 계단은 256 칸으로 잡는다(만화 화풍의 칠한 계단도 같은 칸 수) — 화풍을 바꿀 때 같은 크기 안에서 값만 갈아 끼워야 GPU 텍스처를 다시 안 잡는다.
const RAMP_WIDTH = 256;

/**
 * 공용 계단의 모양.
 *   classic    본편 원래 — 밝기 0 · 0.5 · 1, 경계 1/3 · 2/3
 *   naju       나주맵 세계 툰 그대로 — 밝기 0.36 · 0.68 · 1, 경계 0.36 · 0.5
 *   najuIndoor 실내용 나주 계단 — 빛을 등진 면(dotNL < 0)엔 0, 받는 쪽은 나주처럼 0.62 · 1 두 칸.
 *              나주의 0.36 바닥은 해 하나뿐인 야외용이다 — 실내 스탠드·작업등 빛이 물건 뒷면으로 새어 하얗게 탄다.
 *              그늘을 띄우는 일은 간접광 색과 밝은 조(engine/manga)가 맡는다
 */
export type ToonRampStyle = "classic" | "naju" | "najuIndoor";

const RAMP_LEVELS: Record<ToonRampStyle, readonly [number, number, number]> = {
  classic: [0, 0.5, 1],
  naju: [0.36, 0.68, 1],
  najuIndoor: [0, 0.62, 1],
};
const RAMP_EDGES: Record<ToonRampStyle, readonly [number, number]> = {
  classic: [1 / 3, 2 / 3],
  naju: [0.36, 0.5],
  najuIndoor: [0.5, 0.6],
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * 계단 위치 x(0~1, dotNL·0.5+0.5)의 밝기.
 * brush 는 밝은 쪽에 붓으로 칠한 듯한 완만한 기울기(0 = 계단 그대로). 나주 경계에서 지워지는 기차의 찌그러짐·낡음 음영을 살린다.
 */
function rampValue(style: ToonRampStyle, brush: number, x: number) {
  const levels = RAMP_LEVELS[style];
  const [low, high] = RAMP_EDGES[style];
  const step = x < low ? levels[0] : x < high ? levels[1] : levels[2];
  return step * (1 - brush + brush * smoothstep(0.5, 1, x));
}

function fillRamp(data: Uint8Array, style: ToonRampStyle, brush: number) {
  for (let i = 0; i < RAMP_WIDTH; i++) {
    // Uint8Array 가 소수를 버린다 — 원래 세 칸 텍스처(127)와 같은 값이 나온다
    data[i] = rampValue(style, brush, (i + 0.5) / RAMP_WIDTH) * 255;
  }
}

function makeSharedRamp(): THREE.DataTexture {
  const data = new Uint8Array(RAMP_WIDTH);
  fillRamp(data, "classic", 0);
  const map = new THREE.DataTexture(data, RAMP_WIDTH, 1, THREE.RedFormat);
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.NearestFilter;
  map.needsUpdate = true;
  return map;
}

/** 모든 toon 메시가 함께 쓰는 그라디언트. */
export const TOON_GRADIENT = makeSharedRamp();

let currentRamp = "classic|0";

/**
 * 공용 계단 모양을 바꾼다. 재질은 그대로 두고 텍스처 값만 다시 올린다(셰이더 재컴파일 없음).
 * 빛마다 도는 계단이라 붓 기울기도 셰이더 셈 대신 여기 굽는다 — 셰이더에서 하면 스탠드가 많은 본부실이 빛 수만큼 느려졌다.
 */
export function setToonRamp(style: ToonRampStyle, brush = 0) {
  const key = `${style}|${brush}`;
  if (key === currentRamp) return;
  currentRamp = key;
  fillRamp(TOON_GRADIENT.image.data as Uint8Array, style, brush);
  TOON_GRADIENT.needsUpdate = true;
}

/** 외곽선 기본 굵기(px). */
export const OUTLINE_THICKNESS = 3;
/** 완전 검정보다 살짝 뜬 먹색이 화풍에 부드럽게 어울린다. */
export const OUTLINE_COLOR = "#2E3440";

/** 물건 하나의 선 설정. Leva 폴더에서 buildOutlineSchema() 로 펼치고 pickOutlineValues() 로 꺼낸다. */
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
