/**
 * 숨구멍 — 배 옆 젖은 모래에 난 작은 구멍 일곱. 속에 든 것이 숨을 쉴 때마다 물을 찔끔 뿜는다.
 * 잇달아 세 번 뿜는 구멍만 조개다. 한 번은 게, 두 번은 갯지렁이 — 아랑사가 호미 자루에 새겨 둔 셈법.
 * 자리와 뿜는 때를 정하고, 구멍 자국 · 물줄기 · 게 모양을 만든다. 미터.
 */
import * as THREE from "three";

import { createRandom } from "@/engine/random";
import { TOON_GRADIENT } from "@/engine/toon";

import { makeToonMaterial } from "../materials";

/** 구멍 반지름(미터) · 둘레 모래 알갱이 */
const HOLE_RADIUS = 0.03;
const CRUMB = new THREE.IcosahedronGeometry(0.011, 0);

type Puffs = 1 | 2 | 3;

export interface BreathHole {
  /** 파는 자리(DIG_SPOT)에서의 어긋남(미터) */
  dx: number;
  dz: number;
  /** 잇달아 뿜는 수 — 3 이 조개 */
  puffs: Puffs;
  /** 바퀴 안에서 뿜기 시작하는 때(초) */
  phase: number;
}

/** 구멍 일곱 — 조개 셋 · 게 둘 · 갯지렁이 둘. 배와 길을 비킨 맨모래에 흩어 둔다(먼저 파 놓은 구덩이도 비킨다) */
export const HOLES: BreathHole[] = [
  { dx: 0.7, dz: -0.8, puffs: 3, phase: 0.3 },
  { dx: 0.1, dz: -0.4, puffs: 1, phase: 1.9 },
  { dx: -1.0, dz: -0.7, puffs: 2, phase: 3.1 },
  { dx: 0.2, dz: 0.4, puffs: 3, phase: 2.4 },
  { dx: -1.1, dz: 0.2, puffs: 1, phase: 0.9 },
  { dx: 0.75, dz: 0.35, puffs: 2, phase: 3.8 },
  { dx: -0.6, dz: 0.8, puffs: 3, phase: 1.2 },
];
export const CLAM_HOLES = HOLES.filter((hole) => hole.puffs === 3).length;

/** 한 바퀴(초) · 잇단 뿜기 사이 · 한 줄기가 올랐다 지는 시간 */
const PUFF_CYCLE = 4.8;
const PUFF_GAP = 0.4;
const PUFF_SECONDS = 0.44;
/** 물줄기 높이(미터) · 줄기 한 가닥의 점 수 */
export const PUFF_HEIGHT = 0.24;
export const JET_POINTS = 6;

/** 구멍이 지금 뿜는 세기(0~1). 바퀴마다 puffs 번 잇달아 */
export function puffAt(hole: BreathHole, time: number) {
  const t = (time + hole.phase) % PUFF_CYCLE;
  for (let i = 0; i < hole.puffs; i++) {
    const since = t - i * PUFF_GAP;
    if (since >= 0 && since < PUFF_SECONDS) return Math.sin((since / PUFF_SECONDS) * Math.PI);
  }
  return 0;
}

/** 구멍 자국 — 들쭉날쭉한 작은 구멍. 가장자리는 모래로 스며들어 테두리가 없고, 파낸 모래 알갱이가 둘레에 흩어져 있다. 바닥이 원점 */
export function buildHoleMark(seed: number) {
  const group = new THREE.Group();
  const random = createRandom(seed * 97 + 11);
  const rays = 14;
  const positions = [0, 0, 0];
  const colors = [...new THREE.Color("#1E1A15").toArray(), 1];
  const edge = Array.from({ length: rays }, () => 0.75 + random() * 0.5);
  // 안쪽 고리(어둠의 끝) · 바깥 고리(모래로 사라짐)
  for (const [radius, tone, alpha] of [
    [HOLE_RADIUS, "#2C261E", 0.95],
    [HOLE_RADIUS * 2.1, "#5A5244", 0],
  ] as const) {
    const color = new THREE.Color(tone);
    for (let k = 0; k < rays; k++) {
      const a = (k / rays) * Math.PI * 2;
      positions.push(Math.cos(a) * radius * edge[k], 0, Math.sin(a) * radius * edge[k]);
      colors.push(color.r, color.g, color.b, alpha);
    }
  }
  const index: number[] = [];
  for (let k = 0; k < rays; k++) {
    const next = (k + 1) % rays;
    index.push(0, 1 + next, 1 + k);
    index.push(1 + k, 1 + next, 1 + rays + k);
    index.push(1 + next, 1 + rays + next, 1 + rays + k);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  group.add(
    new THREE.Mesh(
      geometry,
      new THREE.MeshToonMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        gradientMap: TOON_GRADIENT,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    ),
  );
  const sand = makeToonMaterial("#8A8170");
  for (let k = 0; k < 5; k++) {
    const crumb = new THREE.Mesh(CRUMB, sand);
    const a = random() * Math.PI * 2;
    const reach = HOLE_RADIUS * (1.5 + random() * 1.1);
    const size = 0.5 + random() * 0.8;
    crumb.position.set(Math.cos(a) * reach, 0.002, Math.sin(a) * reach);
    crumb.scale.set(size, size * 0.6, size);
    group.add(crumb);
  }
  return group;
}

/** 게 — 납작한 몸통에 집게 둘, 다리 여섯. 앞이 +z, 바닥이 원점 */
export function buildCrab() {
  const shell = makeToonMaterial("#7A4A36");
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), shell);
  body.scale.set(0.062, 0.028, 0.046);
  body.position.y = 0.03;
  group.add(body);
  for (const side of [-1, 1]) {
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 6), shell);
    claw.position.set(side * 0.05, 0.03, 0.045);
    claw.rotation.set(Math.PI / 2, 0, side * 0.5);
    group.add(claw);
    for (let k = 0; k < 3; k++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.003, 0.05, 5), shell);
      leg.position.set(side * 0.065, 0.02, 0.02 - k * 0.022);
      leg.rotation.z = side * 1.1;
      group.add(leg);
    }
  }
  group.traverse((node) => {
    node.castShadow = true;
  });
  return group;
}
