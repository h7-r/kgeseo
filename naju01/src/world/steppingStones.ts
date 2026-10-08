// 절벽 아래 물가에서 강 건너 택촌으로 가는 징검다리.
// 두 마을이 이어져 있다는 것이 화면에 서야 하는데(④ Scene 01), 그 이음은 약하다 —
// 교각을 쌓은 농다리가 아니라 큰 돌을 물바닥에 그냥 놓은 징검다리다.
//   낱개로 한 뼘씩 떨어져 · 크기 제각각에 납작 · 줄이 좌우로 굽고 · 가끔 두 장이 나란히 · 물 위로 한 뼘.
// 걷는 판정은 없다. 그림일 뿐이라 지금 밟으면 뚫고 물에 빠진다 — 붙이려면 도면·하네스를 건드려야 해 팀이 정한다.
// 표본은 밑동 원점 · Z 폭 1(누운 물건 규약). size = 디디는 쪽 길이.

import * as THREE from "three";

import { makeRandom } from "@/engine/random";

import type { Spot } from "../placement/instanceGroups";
import { RIVER } from "../plan/sitePlan";
import type { HeightAt } from "../terrain/ground";
import { farBankBendAt, riverBendAt } from "./river";

// 물에 씻겨 희끗한 화강암. 꼭짓점에는 비율만 굽는다.
export const STEPPING_STONE_STYLE = {
  stone: "#8D8B85",
  stoneDark: "#4E4C48",
};

/**
 * 디딤돌 — 물에 오래 씻겨 모서리가 닳고 윗면만 평평하다.
 * 상자를 흔들면 부서진 상자가 되므로 윗면은 거의 안 건드리고 옆구리만 크게 흔든다.
 */
export function steppingStonePrototypes(count = 6, seed = 6101): THREE.BufferGeometry[] {
  const random = makeRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const corners = 7 + Math.floor(random() * 4);
    const thickness = 0.42 + random() * 0.2;
    const widthRatio = 0.78 + random() * 0.34; // Z 대비 X 폭
    const top: THREE.Vector3[] = [];
    const bottom: THREE.Vector3[] = [];
    for (let k = 0; k < corners; k++) {
      const a = (k / corners) * Math.PI * 2 + (random() - 0.5) * 0.3;
      const r = 0.5 * (0.82 + random() * 0.28);
      // 윗면 — 평평하다. 높낮이를 아주 조금만
      top.push(new THREE.Vector3(Math.sin(a) * r * widthRatio, thickness * (0.94 + random() * 0.06), Math.cos(a) * r));
      // 밑면 — 좁고 들쭉날쭉하다. 물바닥에 박혀 안 보인다
      bottom.push(
        new THREE.Vector3(
          Math.sin(a) * r * widthRatio * (0.7 + random() * 0.2),
          random() * 0.06,
          Math.cos(a) * r * (0.7 + random() * 0.2),
        ),
      );
    }
    const positions: number[] = [];
    const shades: number[] = [];
    const addTriangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, shade: number) => {
      for (const q of [a, b, c]) {
        positions.push(q.x, q.y, q.z);
        shades.push(shade, shade, shade);
      }
    };
    const topCenter = new THREE.Vector3(0, thickness, 0);
    const bottomCenter = new THREE.Vector3(0, 0.02, 0);
    for (let k = 0; k < corners; k++) {
      const next = (k + 1) % corners;
      // 윗면은 볕을 정면으로 받아 가장 밝고, 옆구리는 물때가 앉아 어둡다
      addTriangle(topCenter, top[k], top[next], 1.0 + (random() - 0.5) * 0.08);
      addTriangle(top[k], bottom[k], bottom[next], 0.6 + random() * 0.12);
      addTriangle(top[k], bottom[next], top[next], 0.66 + random() * 0.12);
      // 밑면 — 거의 안 보이지만 뚫려 있으면 안 된다
      addTriangle(bottomCenter, bottom[next], bottom[k], 0.42);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(shades, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) continue;
    const length = Math.max(1e-6, bb.max.z - bb.min.z);
    geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    geometry.scale(1 / length, 1 / length, 1 / length);
    prototypes.push(geometry);
  }
  return prototypes;
}

interface SteppingStoneOptions {
  x?: number;
  /** 돌 한 칸(중심 사이). 촘촘하면 돌이 붙어 돌길로 보인다 — 돌 사이로 물이 지나가야 징검다리다 */
  step?: number;
  /** 수면 위로 나오는 높이 */
  aboveWater?: number;
  /** 줄이 좌우로 굽는 폭 — 자로 그은 징검다리는 없다 */
  sway?: number;
  seed?: number;
  groundHeight?: HeightAt | null;
  /** 이 너머로는 groundHeight 를 믿으면 안 된다 */
  coreZEnd?: number;
}

interface SteppingStoneLayout {
  stones: Spot[];
  measurements: { startZ: number; endZ: number; length: number; step: number; stoneCount: number };
}

/**
 * x 자리에서 이쪽 물가 → 건너 물가를 잇는다. 물가 위치는 river 의 굽이 함수에서 그대로 가져온다 —
 * 강 모양을 고치면 징검다리가 저절로 따라와야 한다.
 */
export function steppingStoneSpots({
  x: centerX = 46.2,
  step = 1.75,
  aboveWater = 0.3,
  sway = 0.9,
  seed = 6301,
  groundHeight = null,
  coreZEnd = 50,
}: SteppingStoneOptions = {}): SteppingStoneLayout {
  const random = makeRandom(seed);
  const nearBank = RIVER.zStart + riverBendAt(centerX);
  const farBank = RIVER.zStart + RIVER.farBankWidth + 3 + farBankBendAt(centerX);
  // 양끝을 뭍으로 조금 물린다 — 물가에서 딱 끝나면 끊어진 다리로 보인다
  const startZ = nearBank - 1.6;
  const endZ = farBank + 1.4;
  const length = endZ - startZ;
  const count = Math.max(3, Math.round(length / step));
  const actualStep = length / count;

  // 주기가 다른 사인 둘을 겹쳐야 되돌아오는 느낌이 안 난다
  const bend = (t: number) =>
    centerX + Math.sin(t * Math.PI * 1.7 + 0.4) * sway + Math.sin(t * Math.PI * 4.3) * sway * 0.35;

  const stones: Spot[] = [];
  for (let k = 0; k <= count; k++) {
    const t = k / count;
    const z = startZ + length * t;
    const x = bend(t);
    // 양끝 돌만 땅높이를 따르고 가운데는 물바닥(0)이다. 코어 밖에서 groundHeight 를 부르면
    // 엉뚱한 값이 나와 돌이 물속으로 가라앉는다. 건너편(z > 77)은 수면과 같다.
    const isOnLand = k <= 1 || k >= count - 1;
    const floor = groundHeight && isOnLand && z <= coreZEnd ? groundHeight(x, z) : 0;
    const size = 1.35 + random() * 0.55;
    // 두께가 표본마다 달라 윗면이 aboveWater 에 오도록 넉넉히 내려 박는다 — 조금 파묻혀야 놓은 돌로 보인다
    stones.push({
      x,
      z,
      y: floor + aboveWater - size * 0.42,
      size,
      // 사람이 디디기 좋게 놓은 것이라 줄을 따라 가지런하고 조금씩만 틀어진다.
      // 아무 방향으로 돌리면 줄 방향으로 짧아진 돌 자리에 구멍 같은 틈이 벌어진다.
      rotation: (random() - 0.5) * 0.9,
      tilt: (random() - 0.5) * 0.13,
      tilt2: (random() - 0.5) * 0.13,
      widthRatio: 0.9 + random() * 0.4,
      depthRatio: 0.9 + random() * 0.3,
      color: STEPPING_STONE_STYLE.stone,
    });
    // 가끔 옆에 한 장 더 — 비켜 서는 자리
    if (k > 1 && k < count - 1 && random() < 0.22) {
      const offset = (random() < 0.5 ? -1 : 1) * (1.05 + random() * 0.3);
      const sideSize = 1.2 + random() * 0.45;
      stones.push({
        x: x + offset,
        z: z + (random() - 0.5) * 0.3,
        y: aboveWater - sideSize * 0.42,
        size: sideSize,
        rotation: (random() - 0.5) * 1.0,
        tilt: (random() - 0.5) * 0.15,
        tilt2: (random() - 0.5) * 0.15,
        widthRatio: 0.9 + random() * 0.35,
        depthRatio: 0.9 + random() * 0.3,
        color: STEPPING_STONE_STYLE.stone,
      });
    }
  }
  return { stones, measurements: { startZ, endZ, length, step: actualStep, stoneCount: stones.length } };
}
