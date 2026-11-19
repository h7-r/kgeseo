/**
 * 석실의 자리와 치수 — 받침 넷 · 돌 상자 · 진주 홈 · 등 · 석상 · 숨구멍 · 물길, 그리고 그 geometry. 미터.
 * 그림과 재질은 chamberArt, 퍼즐 흐름은 InnerChamber.
 */
import * as THREE from "three";

import { M } from "../units";
import { ARCH, CORRIDOR, INNER, INNER_FLOOR } from "./caveState";
import type { MuralScene } from "./muralArt";

/** 받침에 새겨진 그림 — 왼쪽부터. 일부러 뒤섞어 둔다 */
export const GLYPHS: MuralScene[] = ["구렁이", "바위", "달", "배"];
/** 벽화의 이야기 순서 */
export const ORDER: MuralScene[] = ["달", "배", "구렁이", "바위"];
export const MEANING: Record<MuralScene, string> = {
  달: "달이 차오르고",
  배: "배가 강을 건너고",
  구렁이: "구렁이가 오르고",
  바위: "바위가 된다",
};
export const PEDESTAL_Z = INNER.z[0] + 4;
export const PEDESTAL_X = [41.4, 43.8, 46.2, 48.6];
/** 눈높이 1.25 m 에서 그림판이 내려다보이게 낮다 */
export const PEDESTAL_HEIGHT = 0.62;
/** 누르면 머리판이 이만큼 내려갔다 올라온다 */
export const PRESS_DEPTH = 0.07;
/** 돌 상자 — 네 면에 벽화, 윗면에 둥근 구멍 */
export const BOX = {
  x: 45,
  z: INNER.z[1] - 1.1,
  width: 1.15,
  depth: 0.85,
  height: 0.78,
  plinth: 0.12,
  slab: 0.12,
  hole: 0.17,
};
export const BOX_TOP = BOX.plinth + BOX.height + BOX.slab;
type BoxSide = "front" | "left" | "right" | "back";
/** 네 면의 그림 — 앞(문 쪽) · 왼 · 오른 · 뒤 */
export const BOX_PANELS: { scene: MuralScene; side: BoxSide }[] = [
  { scene: "바위", side: "front" },
  { scene: "달", side: "left" },
  { scene: "배", side: "right" },
  { scene: "구렁이", side: "back" },
];
/** 비늘이 떠오르는 높이(상자 윗면에서) · 걸리는 초 · 보이는 크기 배율 */
export const SCALE_RISE = 0.6;
export const SCALE_RISE_SECONDS = 2.6;
export const SCALE_SHOWN = 1.8;
/** 유리 알 등 — 들머리 석상 옆 둘(들어서면 바로 켜진다) · 돌 상자 옆 하나(벽화 퍼즐을 풀면 켜진다) */
export const ORB_Y = 1.15;
/** 들어서면 들머리 등이 켜지며 방이 밝아지기까지(초) */
export const LIGHT_UP_SECONDS = 0.6;
/** 받침이 맞으면 돌 상자 한 면에 그 장면이 붓질처럼 그려진다(초) */
export const PAINT_SECONDS = 1.4;
/** 상자 옆 등 — 퍼즐을 푼 뒤 이만큼(초) 지나 켜진다 */
export const BOX_LAMP_DELAY = 0.6;
/** 아비사·아랑사 석상 — 들머리 양옆, 방 안쪽을 본다 */
export const STATUE_X = [INNER.x[0] + 2.2, INNER.x[1] - 2.2];
export const STATUE_Z = INNER.z[0] + 0.9;
export const LAMPS: { x: number; z: number; group: "entry" | "box" }[] = [
  { x: STATUE_X[0] + 1.05, z: STATUE_Z + 0.2, group: "entry" },
  { x: STATUE_X[1] - 1.05, z: STATUE_Z + 0.2, group: "entry" },
  { x: BOX.x + 1.7, z: BOX.z - 0.1, group: "box" },
];
/**
 * 진주 홈 — 상자 오른쪽 바위 면에 판 둥근 홈. 큰 진주를 끼우면 빛줄기가 상자 오른쪽 벽화로 흘러들어 상자가 환해지고 비늘이 떠오른다.
 * yaw 는 홈이 보는 쪽(받침 쪽 · 상자 쪽 사이)
 */
export const SOCKET = { x: 43.75, y: 0.98, z: 86.1, yaw: Math.atan2(0.8, -0.6), radius: 0.125, depth: 0.26 };
/** 끼운 진주의 빛이 상자에 닿기까지 · 상자가 다 밝아지기까지 · 비늘이 떠오르기 시작하는 때(초, 끼운 때부터) */
export const BEAM_TRAVEL = 0.7;
export const BOX_LIGHT_UP = 1.6;
export const SCALE_DELAY = 1.5;
export const EXIT = { x: 45, y: INNER_FLOOR + 1.3, z: INNER.z[1] - 0.05 };
/** 바위 틈 숨구멍 — 진주 쪽(늘 공기가 샌다) */
export const CRACK = { x: 48.6, z: 84.6 };
/**
 * 받침 퍼즐을 푸는 동안 숨을 채우는 작은 바위 틈 숨구멍 둘 — 석실 입구 양옆 모서리(들어서면 바로 옆 벽 앞).
 * 예전엔 끝 받침 바로 옆(0.7 m) → 11/10 받침 줄 앞 2 m 였는데도 「눌러야 하는 버튼들이랑 너무 가깝다」(미르 11/11) — 받침을 누르는 거리
 * (reach 2.8 m)와 숨 반경(0.9 m)을 더해도 닿지 않게 끝 받침에서 3.8 m(나주지역막기 01회차 Codex). 숨을 채우는 자리에서는 받침을 못 누른다
 */
export const PEDESTAL_VENT = { x: 40.5, z: 76.3 };
export const PEDESTAL_VENT_EAST = { x: 49.5, z: 76.3 };
/** 받침 너머 어둠 — 넷을 다 맞히기 전에는 이 z 부터 안쪽이 보이지 않는다 · 걷히는 시간(초) */
export const BACK_DARK_Z = PEDESTAL_Z + 1.0;
export const BACK_REVEAL_SECONDS = 1.8;
/** 물길에 빨려 드는 시간(초) — 끌려가며 흔들리고, 눈앞이 두 번 캄캄하게 깜빡이고, 하얗게 덮인 뒤 강가로 */
export const SUCK_SECONDS = 2.0;
/** 바위 틈 안쪽으로 이만큼(미터) 더 끌려 들어간다 */
export const SUCK_DEPTH = 1.3;
/** 캄캄하게 깜빡이는 때(빨려 드는 진행도) · 한 번의 길이 */
export const BLINKS = [0.36, 0.6];
export const BLINK_WIDTH = 0.075;
/** 물살에 실려 나와 닿는 강가 자리(미터) */
export const SHORE = { x: CORRIDOR.x, z: 43.2 };
export const PANEL_RANGE = 6;
const CURRENT_COUNT = 120;
/** 아치 위 벽화 — 석실 쪽 벽. 띠 하나에 네 장면(가로 8:1) */
export const MURAL = {
  width: 8.4,
  height: 1.05,
  bottom: INNER_FLOOR + ARCH.straight + ARCH.halfWidth + 0.2,
  z: INNER.z[0] + 0.03,
};
/** 진주 빛이 벽화를 드러내는 거리(미터) */
export const PEARL_REACH = 5.5;
export const LAMP_OFF = new THREE.Color("#3A3934");
export const LAMP_ON = new THREE.Color("#FFF6E0");

/** 겨누는 자리(유닛) — 받침 넷 · 돌 상자 · 진주 홈 · 떠오른 비늘 · 물길 */
export const CHAMBER_SPOTS = {
  pedestals: PEDESTAL_X.map((x) => new THREE.Vector3(x * M, (INNER_FLOOR + PEDESTAL_HEIGHT) * M, PEDESTAL_Z * M)),
  box: new THREE.Vector3(BOX.x * M, (INNER_FLOOR + BOX_TOP) * M, BOX.z * M),
  socket: new THREE.Vector3(SOCKET.x * M, (INNER_FLOOR + SOCKET.y) * M, SOCKET.z * M),
  scale: new THREE.Vector3(BOX.x * M, (INNER_FLOOR + BOX_TOP + SCALE_RISE) * M, BOX.z * M),
  exit: new THREE.Vector3(EXIT.x * M, EXIT.y * M, EXIT.z * M),
};

/** 면 하나의 자리와 돌림 — 그림이 보는 사람 왼쪽부터 읽히게(면의 u 가 보는 사람 오른쪽으로 가게) */
export function panelPose(side: BoxSide): { position: [number, number, number]; rotation: number; width: number } {
  const y = BOX.plinth + BOX.height / 2;
  const off = 0.004;
  if (side === "front") return { position: [0, y, -BOX.depth / 2 - off], rotation: Math.PI, width: BOX.width - 0.12 };
  if (side === "back") return { position: [0, y, BOX.depth / 2 + off], rotation: 0, width: BOX.width - 0.12 };
  if (side === "left")
    return { position: [-BOX.width / 2 - off, y, 0], rotation: -Math.PI / 2, width: BOX.depth - 0.12 };
  return { position: [BOX.width / 2 + off, y, 0], rotation: Math.PI / 2, width: BOX.depth - 0.12 };
}

/** 물살 알갱이 — 방 안 여기저기서 출발해 물길 구멍으로 빨려 든다. 자리는 매 프레임 다시 쓴다 */
export function buildCurrent() {
  const seeds = Array.from({ length: CURRENT_COUNT }, (_, i) => {
    const angle = (i / CURRENT_COUNT) * Math.PI * 2 * 7.3;
    return {
      angle,
      radius: 0.25 + (((i * 37) % 100) / 100) * 1.1,
      depth: 0.4 + (((i * 53) % 100) / 100) * 2.2,
      phase: ((i * 71) % 100) / 100,
    };
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(CURRENT_COUNT * 3), 3));
  return { seeds, geometry };
}
export type Current = ReturnType<typeof buildCurrent>;

/** 진주 홈 돌 — 모난 돌판에 둥근 굴을 뚫고(속 원통 · 둥근 바닥), 앞면이 +z. 미터, 굴 입구 가운데가 원점 */
export function buildSocketStone() {
  const shape = new THREE.Shape();
  const corners = 11;
  for (let i = 0; i < corners; i++) {
    const a = (i / corners) * Math.PI * 2;
    const r = 1 + 0.16 * Math.sin(i * 2.7 + 0.4) + 0.08 * Math.cos(i * 5.1);
    const x = Math.cos(a) * 0.44 * r;
    const y = Math.sin(a) * 0.5 * r - 0.05;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, SOCKET.radius, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const stone = new THREE.ExtrudeGeometry(shape, {
    depth: SOCKET.depth,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 2,
    curveSegments: 20,
  });
  stone.translate(0, 0, -SOCKET.depth);
  const sleeve = new THREE.CylinderGeometry(
    SOCKET.radius - 0.003,
    SOCKET.radius - 0.003,
    SOCKET.depth + 0.1,
    20,
    1,
    true,
  );
  sleeve.rotateX(Math.PI / 2);
  sleeve.translate(0, 0, -SOCKET.depth / 2 + 0.02);
  const cup = new THREE.SphereGeometry(SOCKET.radius - 0.002, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  cup.rotateX(-Math.PI / 2);
  cup.translate(0, 0, -SOCKET.depth + 0.01);
  return { stone, sleeve, cup };
}

/** 상자 윗돌 — 가운데 둥근 구멍이 뚫린 판(미터, 밑면이 원점) */
export function buildSlabGeometry() {
  const width = BOX.width + 0.08;
  const depth = BOX.depth + 0.08;
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -depth / 2);
  shape.lineTo(width / 2, -depth / 2);
  shape.lineTo(width / 2, depth / 2);
  shape.lineTo(-width / 2, depth / 2);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, BOX.hole, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: BOX.slab,
    bevelEnabled: true,
    bevelSize: 0.012,
    bevelThickness: 0.012,
    bevelSegments: 1,
    curveSegments: 32,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
