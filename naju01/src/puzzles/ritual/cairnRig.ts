/**
 * 돌탑 여섯 — 돌 수가 다르고, 홈의 눈금 수와 같은 돌탑만 그 홈에 맞는다.
 * 끌면 눈 앞을 따라오고, 제물이 다 오르면 떠올라 머물다, 물굴에서 돌아오면 떨어져 넷이 무너진다.
 */
import * as THREE from "three";

import { makeToonMaterial } from "../materials";
import { M, groundY } from "../units";
import { NODES } from "./magicCircle";

/** 돌 수와 처음 자리(미터). 둘은 이미 제 홈에 서 있어 규칙을 보여 준다 */
const CAIRNS: { stones: number; x: number; z: number }[] = [
  { stones: 4, x: NODES[0].x, z: NODES[0].z },
  { stones: 3, x: NODES[3].x, z: NODES[3].z },
  { stones: 2, x: 41.3, z: 39.0 },
  { stones: 5, x: 48.7, z: 38.9 },
  { stones: 6, x: 48.6, z: 35.0 },
  { stones: 7, x: 44.9, z: 40.7 },
];
const STONE_COLORS = ["#8A8375", "#6E6A60", "#9A9284"];
/** 끄는 돌탑이 눈 앞 이만큼(미터)에서 따라온다 */
const DRAG_DISTANCE = 1.4;
/** 돌탑은 자갈밭 안에서만 끌린다 — 강이나 벼랑에 놓으면 다시 못 잡아 기우제가 막힌다 */
const CAIRN_AREA = { x: [35, 54.5], z: [31, 43.4] } as const;
/** 제물 셋이 오르면 돌탑이 이만큼(미터) 떠올라 허공에 머문다 · 떠오르는 시간(초) */
const HOVER = 0.45;
const HOVER_SECONDS = 3.2;
/** 물굴에서 돌아온 뒤 떨어지는 시간(초) */
const FALL_SECONDS = 0.3;
/** 물굴에서 돌아오면 무너져 있는 돌탑(차례 번호) — 여섯 중 넷 · 무너지는 시간(초) */
const COLLAPSED = [0, 2, 3, 5];
const COLLAPSE_SECONDS = 0.8;

export interface Cairn {
  stones: number;
  group: THREE.Group;
  /** 꼭대기 돌 — 맞으면 빛이 든다 */
  topMaterial: THREE.MeshToonMaterial;
  /** 지금 자리(미터) */
  position: THREE.Vector3;
  /** [E] 로 겨누는 가운데(유닛) */
  center: THREE.Vector3;
  height: number;
  /** 서 있는 홈 번호. 홈 밖이면 null */
  node: number | null;
  isLit: boolean;
  /** 덜컥임 0~1 */
  wobble: number;
}

interface StoneRest {
  position: THREE.Vector3;
  rotation: THREE.Euler;
}

/** 돌을 stones 개 쌓은 돌탑 — 아래가 넓고 위로 갈수록 작다. 미터, 바닥이 원점 */
function buildCairn(stones: number, materials: THREE.Material[], topMaterial: THREE.Material) {
  const group = new THREE.Group();
  let y = 0;
  for (let i = 0; i < stones; i++) {
    const t = i / Math.max(1, stones - 1);
    const radius = THREE.MathUtils.lerp(0.26, 0.11, t);
    const thickness = radius * (0.5 + ((i * 37) % 7) * 0.02);
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    geometry.scale(radius, thickness, radius * 0.88);
    const stone = new THREE.Mesh(geometry, i === stones - 1 ? topMaterial : materials[i % materials.length]);
    stone.position.set(Math.sin(i * 2.3) * 0.025, y + thickness * 0.85, Math.cos(i * 1.7) * 0.025);
    stone.rotation.y = i * 1.9;
    stone.castShadow = true;
    // 무너질 때 여기서 출발한다
    stone.userData.rest = { position: stone.position.clone(), rotation: stone.rotation.clone() } satisfies StoneRest;
    group.add(stone);
    y += thickness * 1.6;
  }
  return { group, height: y };
}

export function createCairns() {
  const stoneMaterials = STONE_COLORS.map((color) => makeToonMaterial(color));
  const cairns = CAIRNS.map(({ stones, x, z }): Cairn => {
    const topMaterial = makeToonMaterial(STONE_COLORS[0]);
    const { group, height } = buildCairn(stones, stoneMaterials, topMaterial);
    group.scale.setScalar(M);
    const node = NODES.findIndex((entry) => entry.x === x && entry.z === z);
    return {
      stones,
      group,
      topMaterial,
      position: new THREE.Vector3(x, 0, z),
      center: new THREE.Vector3(),
      height,
      node: node >= 0 ? node : null,
      isLit: node >= 0,
      wobble: 0,
    };
  });
  return { cairns, stoneMaterials };
}

export function disposeCairns({ cairns, stoneMaterials }: ReturnType<typeof createCairns>) {
  stoneMaterials.forEach((material) => material.dispose());
  for (const cairn of cairns) {
    cairn.topMaterial.dispose();
    cairn.group.traverse((node) => (node as THREE.Mesh).geometry?.dispose());
  }
}

interface CairnFrame {
  camera: THREE.Camera;
  /** 끌고 있는 돌탑 번호 */
  dragging: number | null;
  time: number;
  dt: number;
  /** 제물 셋이 오른 때(초). 아직이면 음수 */
  riseAt: number;
  /** 물굴에서 돌아온 때(초). 아직이면 음수 */
  clearedAt: number;
  glowColor: THREE.Color;
}

/** 돌탑 한 프레임 — 끌림 · 떠오름 · 떨어짐 · 무너짐 · 덜컥임 · 꼭대기 빛 */
export function updateCairns(
  cairns: Cairn[],
  { camera, dragging, time, dt, riseAt, clearedAt, glowColor }: CairnFrame,
) {
  const follow = 1 - Math.exp(-dt * 10);
  cairns.forEach((cairn, index) => {
    if (index === dragging) {
      // 땅을 끌며 눈 앞으로 따라온다
      const forward = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
      const targetX = THREE.MathUtils.clamp(camera.position.x / M + forward.x * DRAG_DISTANCE, ...CAIRN_AREA.x);
      const targetZ = THREE.MathUtils.clamp(camera.position.z / M + forward.z * DRAG_DISTANCE, ...CAIRN_AREA.z);
      cairn.position.x += (targetX - cairn.position.x) * follow;
      cairn.position.z += (targetZ - cairn.position.z) * follow;
      cairn.wobble = Math.max(cairn.wobble, 0.25);
    }
    const ground = groundY(cairn.position.x, cairn.position.z);
    // 제물 셋이 오르면 떠올라 허공에 머물고(살짝 까딱), 물굴에서 돌아오자마자 떨어진다
    const rise = riseAt < 0 ? 0 : THREE.MathUtils.smootherstep((time - riseAt - index * 0.25) / HOVER_SECONDS, 0, 1);
    const fall = clearedAt < 0 ? 0 : THREE.MathUtils.clamp((time - clearedAt) / FALL_SECONDS, 0, 1);
    const hover = HOVER * rise * (1 - fall * fall) + (fall < 1 ? 0.06 * rise * Math.sin(time * 1.3 + index * 1.1) : 0);
    cairn.group.position.set(cairn.position.x * M, (ground + hover) * M, cairn.position.z * M);
    cairn.center.set(cairn.position.x * M, (ground + hover + cairn.height * 0.5) * M, cairn.position.z * M);
    // 넷은 떨어지며 무너진다 — 돌이 둘레로 흩어져 눕는다
    if (clearedAt >= 0 && COLLAPSED.includes(index)) {
      const tumble = THREE.MathUtils.smootherstep((time - clearedAt - 0.15) / COLLAPSE_SECONDS, 0, 1);
      cairn.group.children.forEach((stone, k) => {
        const rest = stone.userData.rest as StoneRest | undefined;
        if (!rest) return;
        const angle = index * 1.7 + k * 2.39;
        const reach = 0.25 + (k % 3) * 0.17;
        stone.position.set(
          THREE.MathUtils.lerp(rest.position.x, Math.cos(angle) * reach, tumble),
          THREE.MathUtils.lerp(rest.position.y, 0.04, tumble) + Math.sin(tumble * Math.PI) * 0.12 * (k / cairn.stones),
          THREE.MathUtils.lerp(rest.position.z, Math.sin(angle) * reach, tumble),
        );
        stone.rotation.set(
          rest.rotation.x + tumble * (0.8 + k * 0.3),
          rest.rotation.y + tumble * k,
          rest.rotation.z + tumble * (1.2 - k * 0.2),
        );
      });
    }
    cairn.wobble = Math.max(0, cairn.wobble - dt * 1.8);
    cairn.group.rotation.z = Math.sin(time * 26) * cairn.wobble * 0.05;
    // 맞은 돌탑 꼭대기에 빛이 든다
    const glow = cairn.isLit ? 0.55 + 0.15 * Math.sin(time * 2.4 + index) : 0;
    cairn.topMaterial.emissive.copy(glowColor).multiplyScalar(glow);
  });
}
