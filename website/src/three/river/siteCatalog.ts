import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { PropName } from "./najuProps";
import { PALETTE, riverCenterX } from "./world";

// 강가 자리 목록(Sites.tsx 가 그린다). 자리마다 「지금」 건물(코드로 빚은 단순한 덩어리)과 「옛날」 짝(게임 모형)이 같은 곳에 겹쳐 있고,
// 왜곡 솔기가 건물을 훑고 지나가며 한쪽을 다른 쪽으로 바꾼다. 끝까지 다 바뀌지 않고 반쯤에서 멈춘 자리가 있어
// 편의점 위에 초가지붕이 얹히고, 쇠 가로등 끝에서 횃불이 타는 — 지금과 옛날이 섞인 게임 세계가 된다.

/** 솔기가 훑는 방향. up: 옛 모습이 땅에서부터 차오른다 · down: 위에서부터 내려온다. */
export type SeamDirection = "up" | "down";

export type ModernKind = "store" | "busStop" | "lamp" | "apartment";

export interface SiteDefinition {
  modern: ModernKind | null;
  past: PropName | "torch" | null;
  /** 발이 놓이는 자리(월드). */
  position: THREE.Vector3;
  yaw: number;
  /** 옛 모형의 키(m). 지금 건물 크기에 맞춘다. */
  pastHeight: number;
  seam: SeamDirection;
  /** 이 진행도 구간에서 솔기가 지나간다. */
  from: number;
  to: number;
  /** 끝내 바뀌는 몫. 1 이면 다 옛 모습, 0.5 면 반반에서 멈춘다. */
  amount: number;
}

const shore = (side: -1 | 1, offset: number, z: number) => new THREE.Vector3(riverCenterX(z) + side * offset, 0.4, z);
// 건물 앞면은 모형 기준 -x. 오른쪽 둑은 그대로(0)면 강을, 왼쪽 둑은 반 바퀴 돌려야 강을 본다.
const FACE_RIVER_RIGHT = 0;
const FACE_RIVER_LEFT = Math.PI;
/** 사건 파일 무리는 강과 다가오는 카메라 사이를 보게 비튼다 — 유리 앞면과 간판이 화면에 잡힌다. */
const FACE_CAMERA_RIGHT = 0.95;

export const SITES: readonly SiteDefinition[] = [
  // 사건 파일 — 오른쪽 둑의 편의점·버스 정류장·가로등이 차례로 바뀐다. 카메라가 이 무리를 화면 오른쪽에 둔다.
  {
    modern: "store",
    past: "house1",
    position: shore(1, 31, -36),
    yaw: FACE_CAMERA_RIGHT,
    pastHeight: 6.4,
    seam: "down",
    from: 0.14,
    to: 0.22,
    amount: 0.5,
  },
  {
    modern: "busStop",
    past: "house3",
    position: shore(1, 29, -16),
    yaw: FACE_CAMERA_RIGHT - 0.2,
    pastHeight: 3.4,
    seam: "up",
    from: 0.17,
    to: 0.25,
    amount: 1,
  },
  ...[-4, -26, -50, -72].map((z, i): SiteDefinition => ({
    modern: "lamp",
    past: "torch",
    position: shore(1, 25.5, z),
    yaw: FACE_RIVER_RIGHT,
    pastHeight: 3.4,
    seam: "down",
    from: 0.15 + i * 0.025,
    to: 0.2 + i * 0.025,
    // 둘은 횃불이 되고, 둘은 쇠기둥 끝에서 불이 탄다.
    amount: i % 2 ? 1 : 0.42,
  })),
  {
    modern: "apartment",
    past: null,
    position: shore(1, 52, -58),
    yaw: FACE_CAMERA_RIGHT - 0.3,
    pastHeight: 0,
    seam: "up",
    from: 0.18,
    to: 0.3,
    amount: 0.35,
  },
  // 강 위로 옛 나룻배가 떠오른다.
  {
    modern: null,
    past: "ferry",
    position: new THREE.Vector3(14, -0.25, -54),
    yaw: 0.65,
    pastHeight: 2.2,
    seam: "up",
    from: 0.2,
    to: 0.3,
    amount: 1,
  },
  // 지역·시나리오 — 왼쪽 둑. 카메라가 지나가며 이미 섞인 마을을 본다.
  {
    modern: "store",
    past: "house3",
    position: shore(-1, 32, -122),
    yaw: FACE_RIVER_LEFT,
    pastHeight: 6,
    seam: "down",
    from: 0.3,
    to: 0.42,
    amount: 0.55,
  },
  {
    modern: null,
    past: "house1",
    position: shore(-1, 34, -142),
    yaw: FACE_RIVER_LEFT + 0.3,
    pastHeight: 6,
    seam: "up",
    from: 0.3,
    to: 0.42,
    amount: 1,
  },
  ...[-112, -134, -156].map((z, i): SiteDefinition => ({
    modern: "lamp",
    past: "torch",
    position: shore(-1, 25.5, z),
    yaw: FACE_RIVER_LEFT,
    pastHeight: 3.4,
    seam: "down",
    from: 0.3 + i * 0.03,
    to: 0.36 + i * 0.03,
    amount: i % 2 ? 0.42 : 1,
  })),
  // 옛 마을 둘레의 나무 — 토막토막 돋아난다.
  ...(
    [
      [1, 44, -30],
      [1, 40, -8],
      [-1, 46, -128],
      [-1, 44, -160],
      [1, 46, -214],
    ] as const
  ).map(([side, offset, z], i): SiteDefinition => ({
    modern: null,
    past: "tree1",
    position: shore(side, offset, z),
    yaw: i * 1.9,
    pastHeight: 9 + (i % 2) * 3,
    seam: "up",
    from: z > -100 ? 0.2 : z > -180 ? 0.3 : 0.5,
    to: z > -100 ? 0.28 : z > -180 ? 0.4 : 0.6,
    amount: 1,
  })),
  // 마무리 — 앙암 곁 오른쪽 둑(가까운 능선이 끝나고 절벽이 시작되기 전 빈터).
  // 다 굳은 게임 세계에서 지금과 옛날이 나란히 선다.
  {
    modern: "apartment",
    past: null,
    position: shore(1, 66, -224),
    yaw: 0.5,
    pastHeight: 0,
    seam: "up",
    from: 0.5,
    to: 0.7,
    amount: 0.45,
  },
  {
    modern: "store",
    past: "house1",
    position: shore(1, 34, -206),
    yaw: 0.7,
    pastHeight: 6.4,
    seam: "down",
    from: 0.5,
    to: 0.66,
    amount: 0.5,
  },
  {
    modern: "busStop",
    past: "house3",
    position: shore(1, 32, -232),
    yaw: 0.6,
    pastHeight: 3.4,
    seam: "up",
    from: 0.52,
    to: 0.68,
    amount: 1,
  },
  ...[-196, -218, -242].map((z, i): SiteDefinition => ({
    modern: "lamp",
    past: "torch",
    position: shore(1, 25.5, z),
    yaw: FACE_RIVER_RIGHT,
    pastHeight: 3.4,
    seam: "down",
    from: 0.5 + i * 0.03,
    to: 0.56 + i * 0.03,
    amount: i % 2 ? 1 : 0.42,
  })),
];

// ── 지금 건물 — 단순한 덩어리. 면마다 색을 칠하고, 빛나는 면(창·간판)은 aGlow 로 표시한다. ──

const CONCRETE = new THREE.Color("#a7adb3");
const CONCRETE_DARK = new THREE.Color("#6f767e");
const STEEL = new THREE.Color("#6b7178");
const GLASS = new THREE.Color("#3a4654");
const LED = new THREE.Color("#dfe9f2");
const WARM = PALETTE.lamp;
const SIGN = PALETTE.seam;

function box(size: THREE.Vector3Tuple, at: THREE.Vector3Tuple, color: THREE.Color, glow = 0): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(...size).toNonIndexed();
  geometry.deleteAttribute("uv");
  geometry.translate(at[0], at[1] + size[1] / 2, at[2]);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) colors.set([color.r, color.g, color.b], i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aGlow", new THREE.BufferAttribute(new Float32Array(count).fill(glow), 1));
  return geometry;
}

/** 편의점 — 유리 앞면, 청록 간판 띠, 차양. 앞면이 -x(강 쪽)를 본다(yaw 로 돌린다). */
function store(): THREE.BufferGeometry {
  return merge([
    box([8, 4.6, 13], [0, 0, 0], CONCRETE),
    box([0.2, 3, 11], [-4.05, 0.2, 0], LED, 1.5),
    box([0.3, 0.9, 13.2], [-4.1, 3.4, 0], SIGN, 1.6),
    box([1.6, 0.18, 12], [-4.8, 3.1, 0], CONCRETE_DARK),
    box([1.4, 0.8, 1.4], [3, 4.6, -3], STEEL),
  ]);
}

function busStop(): THREE.BufferGeometry {
  return merge([
    box([3.2, 0.2, 7], [0, 2.8, 0], STEEL),
    box([0.15, 2.8, 0.15], [-1.4, 0, -3.2], STEEL),
    box([0.15, 2.8, 0.15], [-1.4, 0, 3.2], STEEL),
    box([0.12, 2.2, 6.4], [1.4, 0.4, 0], GLASS),
    box([0.1, 1.8, 2.2], [1.3, 0.7, -2], WARM, 1.4),
    box([0.9, 0.45, 4], [0.6, 0.5, 1], CONCRETE_DARK),
  ]);
}

function lamp(): THREE.BufferGeometry {
  return merge([
    box([0.22, 7, 0.22], [0, 0, 0], STEEL),
    box([1.8, 0.16, 0.2], [-0.8, 6.9, 0], STEEL),
    box([0.8, 0.22, 0.45], [-1.5, 6.75, 0], LED, 1),
  ]);
}

/** 아파트 한 동 — 창은 하나하나 얇은 판이라 켜진 창과 꺼진 창이 다르게 빛난다. */
function apartment(): THREE.BufferGeometry {
  const width = 26;
  const depth = 11;
  const floors = 12;
  const parts = [
    box([depth, floors * 2.8 + 0.6, width], [0, 0, 0], CONCRETE),
    box([depth + 0.6, 1, width + 0.6], [0, floors * 2.8 + 0.6, 0], CONCRETE_DARK),
  ];
  // 앞면(-x)과 옆면(+z) 두 면에 창을 낸다 — 비스듬히 봐도 아파트로 읽힌다.
  const isWindowLit = (floor: number, column: number, face: number) => {
    const lit = Math.sin(floor * 12.9898 + column * 78.233 + face * 37.7) * 43758.5453;
    // 밤이라도 창 대부분은 켜져 있어야 「사는 동네」로 읽힌다.
    return lit - Math.floor(lit) > 0.32;
  };
  for (let floor = 0; floor < floors; floor += 1) {
    const y = 1 + floor * 2.8;
    for (let column = 0; column < 7; column += 1) {
      const isLit = isWindowLit(floor, column, 0);
      const z = -width / 2 + 2 + column * ((width - 4) / 6);
      parts.push(box([0.12, 1.5, 2.2], [-depth / 2 - 0.06, y, z], isLit ? WARM : GLASS, isLit ? 1.3 : 0));
    }
    for (let column = 0; column < 3; column += 1) {
      const isLit = isWindowLit(floor, column, 1);
      const x = -depth / 2 + 2 + column * ((depth - 4) / 2);
      parts.push(box([2.2, 1.5, 0.12], [x, y, width / 2 + 0.06], isLit ? WARM : GLASS, isLit ? 1.3 : 0));
    }
  }
  return merge(parts);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  merged.computeBoundingBox();
  return merged;
}

export const MODERN_BUILDERS: Record<ModernKind, () => THREE.BufferGeometry> = { store, busStop, lamp, apartment };

/** 옛 가로등 짝 — 나무 기둥과 불 그릇. 불꽃은 빛 점(Sites 의 불빛)이 맡는다. */
export function createTorchGeometry(): THREE.BufferGeometry {
  const wood = new THREE.Color("#6a5540");
  return merge([
    box([0.2, 3.1, 0.2], [0, 0, 0], wood),
    box([0.55, 0.3, 0.55], [0, 3.1, 0], new THREE.Color("#3a2e22")),
  ]);
}

/** 지금 건물이 내는 빛의 자리(발 기준) — 가로등 머리, 편의점 유리 앞. */
export const MODERN_LIGHT: Partial<Record<ModernKind, THREE.Vector3>> = {
  lamp: new THREE.Vector3(-1.5, 6.7, 0),
  store: new THREE.Vector3(-6, 2.6, 0),
};

/** 횃불 불꽃의 자리(발 기준, 키 3.4 짜리 횃불). */
export const TORCH_FLAME = new THREE.Vector3(0, 3.7, 0);

/** 초가 처마 밑 등불의 자리(키 1 기준 — 옛 모형 키를 곱한다). 강 쪽(-x) 처마 끝. */
export const HOUSE_LANTERN = new THREE.Vector3(-0.75, 0.42, 0.2);
