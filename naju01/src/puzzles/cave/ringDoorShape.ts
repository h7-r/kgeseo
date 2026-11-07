/**
 * 물레 고리문의 치수와 모양 — 돌바퀴 · 고리 셋 · 돌 물레(다이얼) · 톱니돌 홈 · 비석 자리, 그리고 그 geometry.
 * 좌표는 미터. 그림(질감 · 비석 글)은 ringDoorArt, 퍼즐 흐름은 RingDoor.
 */
import * as THREE from "three";

import { toRadians } from "@/engine/math";

import { DOOR, DOOR_CENTER_Y, FLOOR_Y, WHEEL_DEPTH, WHEEL_RADIUS } from "./caveState";

/** 고리 — 바깥 · 가운데 · 안쪽. 처음 틈 자리(도, 위가 0)와 다이얼 한 눈금에 도는 각 */
export const RINGS = [
  // 물레 한 눈금에 고리도 한 눈금(−10°). 틈이 가리키는 바퀴 숫자는 RingDoor 의 gapNotch
  { name: "바깥 고리", radius: 1.86, tube: 0.12, start: 260, perNotch: -10 },
  { name: "가운데 고리", radius: 1.5, tube: 0.105, start: 100, perNotch: -10 },
  { name: "안쪽 고리", radius: 1.14, tube: 0.1, start: 40, perNotch: -10 },
];
export const GAP_DEGREES = 42;
export const NOTCH_DEGREES = 10;
/** [E] 를 누르고 있을 때 한 눈금 넘어가는 데 걸리는 시간 */
export const NOTCH_SECONDS = 0.22;
export const FLOAT_SLOTS = 4;
/** 바퀴 가운데 — 앞면이 벽에서 바퀴 두께만큼 앞 */
export const WHEEL_CENTER = { x: DOOR.x, y: DOOR_CENTER_Y, z: DOOR.z - WHEEL_DEPTH / 2 };
/** 바퀴 얼굴 — 가운데 허브 · 고리 셋 · 숫자판 하나(둘씩 건너 큰 숫자, 눈금 36) · 둘레 돌테 */
export const NUMBER_RADIUS = 2.2;
export const RIM_RADIUS = WHEEL_RADIUS - 0.1;
export const NOTCHES = 36;
/** 풀리면 바퀴가 이만큼(미터) 굴러가 통로를 비운다 */
export const ROLL = 4.4;
export const ROLL_SECONDS = 3.4;
/** 구르기 전에 바퀴가 덜컹이며 떨리는 시간(초) — 물속 전체가 울린다 */
export const RATTLE_SECONDS = 1.1;
/** 돌 물레(다이얼) — 문을 보고 오른쪽(−x 쪽) 벽. 가운데 둥근 허브에 뜬 돌 모양 홈 넷이 모여 파여 있다 */
export const DIAL = {
  x: DOOR.x - 5.0,
  y: FLOOR_Y + 1.45,
  z: DOOR.z - 0.48,
  radius: 0.85,
  hubRadius: 0.44,
  depth: 0.2,
  socketRadius: 0.23,
};
/** 물레 둘레 손잡이 돌기 수 */
export const DIAL_GRIPS = 8;
/** 물레 앞면 새김 띠 — 안 · 바깥 반지름(물레 반지름에 대한 몫). 안쪽은 뜬 돌 홈 자리라 비운다 */
export const DIAL_FACE = { inner: 0.56, outer: 0.92 };
/** 톱니돌 홈 셋 — 물레 바로 옆 돌기둥에 세로로. 위부터 바깥 · 가운데 · 안쪽 */
export const GEAR_POST = { x: DOOR.x - 6.45, z: DOOR.z - 0.3 };
export const GEAR_Y = [FLOOR_Y + 1.85, FLOOR_Y + 1.4, FLOOR_Y + 0.95];
/** 석판 — 물레와 바퀴 사이 벽에 기대 서 있다(바퀴가 굴러가는 왼쪽은 비워 둔다) */
export const TABLET = { x: DOOR.x - 3.35, y: FLOOR_Y + 1.3, z: DOOR.z - 0.36 };
/** 문 앞 빛 자리 — 등불 모형 없이 빛만. 오른쪽은 굴러간 바퀴보다 바깥에 */
export const LIGHT_X = [DOOR.x - 5.0, DOOR.x + 5.0];
export const LIGHT_Y = DOOR_CENTER_Y + 1.6;
export const PANEL_RANGE = 7;
/** 켜진 빛 — 따뜻한 흰빛 */
export const GLOW = new THREE.Color("#F2E3B8");
export const DARK = new THREE.Color("#000000");
/** 고리 빛깔 — 얼굴보다 밝은 맨 돌. 문이 열리면 따뜻한 흰빛이 스민다 */
export const RING_COLOR = "#A4A398";
export const RING_LIT = new THREE.Color("#3C3830");

export const wrapDegrees = (deg: number) => ((deg % 360) + 360) % 360;

/** 틈이 위(0도)에 오게 돌려 둔 고리 — 30° 마다 홈줄이 파여 있다(꼭짓점 색). 각도는 mesh.rotation.z 로만 준다 */
export function buildRing(radius: number, tube: number) {
  const geometry = new THREE.TorusGeometry(radius, tube, 12, 96, Math.PI * 2 - toRadians(GAP_DEGREES));
  geometry.rotateZ(Math.PI / 2 + toRadians(GAP_DEGREES) / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const angle = Math.atan2(position.getY(i), position.getX(i));
    const along = (((angle / (Math.PI / 6)) % 1) + 1) % 1;
    const groove = along < 0.08 || along > 0.92 ? 0.62 : 1;
    // 앞면(−z)은 조금 밝게 — 돌의 결
    const front = position.getZ(i) < 0 ? 1.04 : 0.92;
    const shade = groove * front;
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** 톱니돌 꼴(미터) — itemLooks 의 톱니돌과 같은 셈을 scale 배로. 끼운 돌이 위아래 뒤집혀 서므로 flipY 로 맞춘다 */
function gearOutline(scale: number, flipY: boolean, flipX = false) {
  const TEETH = 8;
  const points: THREE.Vector2[] = [];
  for (let i = 0; i < TEETH * 2; i++) {
    const r = (i % 2 === 0 ? 0.11 : 0.085) * scale;
    for (const step of [i, i + 0.55]) {
      const a = (step / (TEETH * 2)) * Math.PI * 2;
      points.push(new THREE.Vector2(Math.cos(a) * r * (flipX ? -1 : 1), Math.sin(a) * r * (flipY ? -1 : 1)));
    }
  }
  return points;
}

/**
 * 톱니 홈 — 돌기둥 앞면에 덧댄 모난 돌판에 톱니돌 꼴 구멍을 판다. 앞이 −z, 기둥 면이 z 0.
 * 바닥은 같은 톱니 꼴의 그늘진 돌
 */
export function buildGearSocketGeometry() {
  const outline = new THREE.Shape();
  const corners = 9;
  for (let i = 0; i < corners; i++) {
    const a = (i / corners) * Math.PI * 2 + 0.2;
    const r = 1 + 0.1 * Math.sin(i * 2.3 + 1) + 0.06 * Math.cos(i * 4.1);
    const x = Math.cos(a) * 0.215 * r;
    const y = Math.sin(a) * 0.2 * r;
    if (i === 0) outline.moveTo(x, y);
    else outline.lineTo(x, y);
  }
  outline.closePath();
  // 구멍은 끼운 돌보다 조금 넉넉하게
  outline.holes.push(new THREE.Path(gearOutline(1.38, true)));
  const plate = new THREE.ExtrudeGeometry(outline, {
    depth: 0.06,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.014,
    bevelSegments: 2,
    curveSegments: 8,
  });
  plate.translate(0, 0, -0.06);
  // 바닥 — 앞(−z)을 보게 돌리면 좌우가 뒤집히므로 미리 뒤집어 그린다
  const floor = new THREE.ShapeGeometry(new THREE.Shape(gearOutline(1.42, true, true)));
  floor.rotateY(Math.PI);
  floor.translate(0, 0, -0.004);
  return { plate, floor };
}

/** 물레 통돌 — 가장자리가 둥글게 깎인 두툼한 맷돌꼴. 앞면(−z)은 가운데가 살짝 오목하다. 미터, 가운데가 원점 */
export function buildDialStone() {
  const r = DIAL.radius;
  const t = DIAL.depth / 2 + 0.03;
  const profile: [number, number][] = [
    [0, -t + 0.03],
    [r * 0.55, -t],
    [r - 0.06, -t + 0.005],
    [r, -t + 0.06],
    [r + 0.01, 0],
    [r, t - 0.06],
    [r - 0.06, t],
    [0, t],
  ];
  const geometry = new THREE.LatheGeometry(
    profile.map(([x, y]) => new THREE.Vector2(x, y)),
    48,
  );
  // 돌림축(y)을 앞뒤(z)로 눕힌다
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** 위가 둥근 어깨인 두꺼운 돌(미터, 박힌 밑동이 원점). 앞면(−z)에 글 — 뚜껑 UV 가 판 크기에 맞게 늘어난다 */
export function buildSteleGeometry(width: number, height: number, depth: number) {
  const half = width / 2;
  const shape = new THREE.Shape();
  const left = [-half, -half * 0.94, -half * 1.04, -half * 0.98, -half, -half * 0.92];
  shape.moveTo(-half, 0);
  left.forEach((x, i) => shape.lineTo(x, (i / (left.length - 1)) * (height - 0.35 * width)));
  shape.quadraticCurveTo(-half * 0.92, height - 0.05 * width, -0.05 * width, height);
  shape.lineTo(0.06 * width, height - 0.02 * width);
  shape.quadraticCurveTo(half * 0.94, height - 0.08 * width, half * 0.98, height - 0.38 * width);
  [half, half * 0.96, half * 1.02, half * 0.98, half]
    .reverse()
    .forEach((x, i, all) => shape.lineTo(x, ((all.length - 1 - i) / (all.length - 1)) * (height - 0.4 * width)));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.04,
    bevelSegments: 2,
    curveSegments: 10,
  });
  geometry.translate(0, 0, -depth / 2);
  // 앞면(+z 뚜껑)을 −z 로 — 돌리면 글이 뒤집히지 않는다
  geometry.rotateY(Math.PI);
  return geometry;
}
