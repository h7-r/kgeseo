import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { createRandom } from "@/engine/random";

import type { WireShape } from "./workLampState";

/** 차단기함 문짝 두께 — 자물쇠를 문짝 앞면에 세울 때도 쓴다 */
export const BREAKER_DOOR_THICKNESS = 0.1;

/** 분리수거함 하나(실척 약 90 cm). 벽에 등을 대고 선다. */
export const BIN_SIZE = { depth: 1.25, width: 1.5, bodyHeight: 2.72 };

/** 그림 「막차」 캔버스 픽셀 크기 — 액자 비율도 이걸 따른다 */
export const PAINTING_WIDTH_PX = 2048;
export const PAINTING_HEIGHT_PX = 1366;

export interface GeometryPiece {
  geometry: THREE.BufferGeometry | null;
  position?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
}

/**
 * 원통·토러스·구가 섞인 조각을 하나로 합친다(buildMergedBoxes 는 상자 전용).
 * 셋 다 인덱스가 있어 섞어도 된다 — 인덱스 유무가 섞이면 mergeGeometries 가 null 을 주고
 * 그 null 이 메시에 들어가 화면이 통째로 검어진다.
 */
export function buildMergedGeometry(pieces: GeometryPiece[]): THREE.BufferGeometry | null {
  const placed: THREE.BufferGeometry[] = [];
  for (const { geometry, position = [0, 0, 0], rotation = [0, 0, 0], scale } of pieces) {
    if (!geometry) continue;
    const g = geometry.clone();
    if (scale) g.scale(scale[0], scale[1], scale[2]);
    if (rotation[0]) g.rotateX(rotation[0]);
    if (rotation[1]) g.rotateY(rotation[1]);
    if (rotation[2]) g.rotateZ(rotation[2]);
    g.translate(position[0], position[1], position[2]);
    placed.push(g);
  }
  if (!placed.length) return null;
  const merged = placed.length === 1 ? placed[0] : mergeGeometries(placed, false);
  if (merged !== placed[0]) for (const g of placed) g.dispose();
  return merged ?? null;
}

interface OpenBoxOptions {
  depth: number;
  height: number;
  width: number;
  wallThickness?: number;
  /** +1 이면 개구부가 +x 를 본다 */
  direction?: number;
}

/**
 * 앞이 뚫린 함 몸통 — 뒤판(x=0) + 테두리 네 벽. 속 찬 상자면 안에 넣은 부품이 하나도 안 보인다.
 * 판 다섯 장을 따로 두고 외곽선을 두르면 보는 각도마다 테두리가 떠 보여 한 덩어리로 합친다.
 */
export function buildOpenBoxGeometry({ depth, height, width, wallThickness = 0.05, direction = 1 }: OpenBoxOptions) {
  const d = direction;
  const innerHeight = Math.max(0.02, height - wallThickness * 2);
  return buildMergedGeometry([
    { geometry: new THREE.BoxGeometry(wallThickness, height, width), position: [d * (wallThickness / 2), 0, 0] },
    {
      geometry: new THREE.BoxGeometry(depth, wallThickness, width),
      position: [d * (depth / 2), (height - wallThickness) / 2, 0],
    },
    {
      geometry: new THREE.BoxGeometry(depth, wallThickness, width),
      position: [d * (depth / 2), -(height - wallThickness) / 2, 0],
    },
    {
      geometry: new THREE.BoxGeometry(depth, innerHeight, wallThickness),
      position: [d * (depth / 2), 0, (width - wallThickness) / 2],
    },
    {
      geometry: new THREE.BoxGeometry(depth, innerHeight, wallThickness),
      position: [d * (depth / 2), 0, -(width - wallThickness) / 2],
    },
  ]);
}

/**
 * 전선 끝 접속 모양 한 조각 — 넓은 면이 +x(앞)를 본다. −x 를 보는 함은 부르는 쪽이 y 축으로 π 돌린다.
 * 얇은 면이 위아래면 앞에서 옆면만 보여 셋이 같은 띠로 뭉갠다. 세모는 꼭짓점이 위로 오게 돌린다.
 */
export function buildConnectorGeometry(shape: WireShape, size = 1, thickness = 0.028) {
  let g: THREE.BufferGeometry;
  if (shape === "round") g = new THREE.CylinderGeometry(0.042 * size, 0.042 * size, thickness, 20);
  else if (shape === "square") g = new THREE.BoxGeometry(0.074 * size, thickness, 0.074 * size);
  else {
    // 면이 셋인 원기둥은 첫 꼭짓점이 +z 에 선다. −90° 돌려 두면 아래 z 축 회전 뒤 꼭짓점이 위로 간다.
    g = new THREE.CylinderGeometry(0.054 * size, 0.054 * size, thickness, 3);
    g.rotateY(-Math.PI / 2);
  }
  g.rotateZ(-Math.PI / 2);
  return g;
}

/** [반지름, 높이] 윤곽을 돌려 깎는다. */
export function buildLatheGeometry(profile: [number, number][], segments = 20) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)),
    segments,
  );
}

/** 위가 조금 넓은 상자 — 실물 분리수거함은 겹쳐 쌓으려고 아래가 좁다. */
export function buildTaperedBoxGeometry(width: number, height: number, depth: number, bottomScale = 0.9) {
  const g = new THREE.BoxGeometry(width, height, depth, 1, 4, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + height / 2) / height; // 0 = 바닥, 1 = 윗면
    const k = bottomScale + (1 - bottomScale) * t;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** 구겨진 휴지 뭉치 — 정이십면체를 흔들고 면을 쪼개 각진 주름을 낸다. */
export function buildCrumpledGeometry(radius: number, seed: number) {
  const g = new THREE.IcosahedronGeometry(radius, 2);
  const rnd = createRandom(seed);
  const pos = g.attributes.position;
  // 같은 꼭짓점이 면마다 따로 있어 자리로 묶어야 면이 안 찢어진다.
  const scales = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let k = scales.get(key);
    if (k === undefined) {
      k = 0.72 + rnd() * 0.5;
      scales.set(key, k);
    }
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.78, pos.getZ(i) * k);
  }
  const faceted = g.toNonIndexed();
  g.dispose();
  faceted.computeVertexNormals();
  return faceted;
}

/** 꺾이는 데를 둥글린 꺾은선 — 벽·천장을 타는 전선은 직각으로 붙어 가다 모서리에서 휜다. */
export function computeRoundedPolyline(points: THREE.Vector3Tuple[], radius = 0.25) {
  const corners = points.map((p) => new THREE.Vector3(...p));
  const path = new THREE.CurvePath<THREE.Vector3>();
  let from = corners[0].clone();
  for (let i = 1; i < corners.length - 1; i++) {
    const incoming = corners[i].clone().sub(corners[i - 1]);
    const outgoing = corners[i + 1].clone().sub(corners[i]);
    const r = Math.min(radius, incoming.length() / 2, outgoing.length() / 2);
    const a = corners[i].clone().addScaledVector(incoming.normalize(), -r);
    const b = corners[i].clone().addScaledVector(outgoing.normalize(), r);
    if (a.distanceTo(from) > 1e-4) path.add(new THREE.LineCurve3(from, a));
    path.add(new THREE.QuadraticBezierCurve3(a, corners[i].clone(), b));
    from = b;
  }
  path.add(new THREE.LineCurve3(from, corners[corners.length - 1].clone()));
  return path;
}

/**
 * 형광등이 켜지는 모양 [시각(초), 밝기]. 사이는 계단이다.
 * 방전이 잡힐 때까지 두어 번 껌뻑여야 오래 방치된 폐역의 전기로 읽힌다.
 */
const STARTUP_CURVE: [number, number][] = [
  [0.0, 0],
  [0.08, 0.85],
  [0.16, 0.05],
  [0.3, 0],
  [0.42, 1],
  [0.52, 0.1],
  [0.6, 0.35],
  [0.72, 1],
];

export function computeStartupBrightness(t: number) {
  if (t >= STARTUP_CURVE[STARTUP_CURVE.length - 1][0]) return 1;
  for (let i = STARTUP_CURVE.length - 1; i >= 0; i--) if (t >= STARTUP_CURVE[i][0]) return STARTUP_CURVE[i][1];
  return 0;
}
