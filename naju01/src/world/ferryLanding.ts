// Z1 의 배 대는 자리. 이름이 「나루터 · 시작 테라스」인데 물가에 아무것도 없으면 그냥 자갈밭이다.
// 말뚝과 널 몇 장이면 「여기서 배를 탄다」가 전해진다.
// 물 위라 사람이 갈 수 없는 자리(지면이 물로 돌려줌 → 낙하 복귀)라 충돌을 두지 않는다.
// 좌표·크기는 미터, 지오메트리만 유닛(× UNITS_PER_METER).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { makeRandom } from "@/engine/random";

import { FERRY_BOAT } from "../models/baked";
import { bakedModelGeometry } from "../models/bakedGeometry";
import { UNITS_PER_METER } from "../plan/sitePlan";
import { unindex } from "../story/pieceGeometry";
import { applyVertexColors } from "../terrain/ground";

const LANDING_STYLE = {
  stake: "#6A5947",
  stakeDark: "#3A3026",
  plank: "#7E6E58",
  plankDark: "#453A2C",
};

interface LandingOptions {
  /** 나루가 놓일 가로 범위 */
  xRange: [number, number];
  /** 물이 시작하는 Z */
  waterEdge: number;
  /** 물 쪽으로 나가는 길이 */
  reach?: number;
  floorHeight: number;
  seed?: number;
}

// 월드 좌표로 바로 굽는다 — 물가·바닥높이를 받아 그 자리에 말뚝을 박는다
function buildLanding({ xRange, waterEdge, reach = 3.2, floorHeight, seed = 8801 }: LandingOptions) {
  const random = makeRandom(seed);
  const pieces: THREE.BufferGeometry[] = [];
  const scratch = new THREE.Color();
  const stakeLight = new THREE.Color(LANDING_STYLE.stake);
  const stakeDark = new THREE.Color(LANDING_STYLE.stakeDark);
  const plankLight = new THREE.Color(LANDING_STYLE.plank);
  const plankDark = new THREE.Color(LANDING_STYLE.plankDark);

  const place = (
    geometry: THREE.BufferGeometry,
    position: [number, number, number],
    rotation: [number, number, number],
    color: THREE.Color,
  ) => {
    geometry.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(position[0] * UNITS_PER_METER, position[1] * UNITS_PER_METER, position[2] * UNITS_PER_METER),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    pieces.push(applyVertexColors(geometry, color));
  };

  const center = (xRange[0] + xRange[1]) / 2;
  const halfWidth = (xRange[1] - xRange[0]) / 2;

  // 말뚝 — 물 쪽으로 두 줄. 길이·기울기를 흩어야 박은 것으로 보인다.
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const z = waterEdge - 0.4 + reach * t;
    for (const side of [-1, 1]) {
      const x = center + side * (halfWidth - 0.25 - random() * 0.2);
      const height = 1.0 + random() * 0.75 + t * 0.35; // 물 쪽일수록 길게 박힌다
      const radius = 0.09 + random() * 0.05;
      place(
        unindex(
          new THREE.CylinderGeometry(
            radius * UNITS_PER_METER,
            radius * 1.2 * UNITS_PER_METER,
            height * UNITS_PER_METER,
            6,
            1,
          ),
        ),
        [x, floorHeight - 0.35 + height / 2, z],
        [(random() - 0.5) * 0.13, random() * Math.PI, (random() - 0.5) * 0.13],
        scratch
          .copy(stakeDark)
          .lerp(stakeLight, 0.35 + random() * 0.6)
          .clone(),
      );
    }
  }

  // 널 — 사이를 벌려 놔야 널로 보인다
  const plankCount = 4;
  for (let i = 0; i < plankCount; i++) {
    const width = (halfWidth * 2 - 0.5) / plankCount;
    const x = center - halfWidth + 0.25 + width * (i + 0.5);
    const length = reach + 0.9;
    place(
      unindex(new THREE.BoxGeometry(width * 0.82 * UNITS_PER_METER, 0.07 * UNITS_PER_METER, length * UNITS_PER_METER)),
      [x, floorHeight + 0.34 + (random() - 0.5) * 0.03, waterEdge - 0.6 + length / 2],
      [(random() - 0.5) * 0.02, (random() - 0.5) * 0.02, 0],
      scratch
        .copy(plankDark)
        .lerp(plankLight, 0.4 + random() * 0.55)
        .clone(),
    );
  }

  // 가로대 — 없으면 판자가 떠 있는 것처럼 보인다
  for (const t of [0.08, 0.62]) {
    place(
      unindex(new THREE.BoxGeometry(halfWidth * 2 * UNITS_PER_METER, 0.12 * UNITS_PER_METER, 0.14 * UNITS_PER_METER)),
      [center, floorHeight + 0.25, waterEdge - 0.4 + reach * t],
      [0, 0, 0],
      scratch.copy(stakeDark).lerp(stakeLight, 0.5).clone(),
    );
  }

  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}

/**
 * 팔레트용 나루터 표본 — 길이 1 · 밑동 원점. 자리·크기·방위는 인스턴스가 갖는다.
 * 국소 +Z(물 쪽)로 뻗고 원점은 뭍 쪽 끝 지면이다. 반대편 물가에는 rotation π 로 돌린다.
 * 균등 축소라 size(= 나루 길이 m) 하나만 주면 비례가 유지된다.
 */
export function landingPrototypes(count = 3, seed = 8801): THREE.BufferGeometry[] {
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const width = 4.6 + (i % 3) * 0.7; // 널 너비를 조금씩 달리한다
    const geometry = buildLanding({
      xRange: [-width / 2, width / 2],
      waterEdge: 0,
      reach: 3.2 + (i % 2) * 0.8,
      floorHeight: 0,
      seed: seed + i * 137,
    });
    if (!geometry) continue;
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) continue;
    const length = Math.max(1e-6, bb.max.z - bb.min.z);
    // y 는 floorHeight 0 이라 이미 지면이 0 이다
    geometry.translate(-(bb.min.x + bb.max.x) / 2, 0, -bb.min.z);
    geometry.scale(1 / length, 1 / length, 1 / length);
    prototypes.push(geometry);
  }
  return prototypes;
}

// 표본을 미리 잠그지 않는다 — 잠긴 정도는 배마다 달라 자리의 y 로 정한다.
// 0 이어도 아래 translate 는 남긴다 — 법선을 다시 정규화하므로 빼면 그림이 비트 단위로 달라진다.
const SUBMERGE_RATIO = 0;
// 배 밑동 이만큼은 젖은 빛으로 칠한다. 모양은 안 건드린다.
const WET_RATIO = 0.22;

/**
 * 나룻배 — Meshy 모형. 길이 1 · 밑동 원점이라 자리의 size 에 실제 길이(m)를 주면 맞는다.
 * 다른 모형과 달리 진짜 색을 굽는다. 이미 놓인 배들의 편집 기록에 흰색이 들어 있어,
 * 비율만 구우면 그 배들이 새하얗게 나온다.
 */
export function ferryBoatPrototype(): THREE.BufferGeometry {
  const plank = new THREE.Color(LANDING_STYLE.plank);
  const plankDark = new THREE.Color(LANDING_STYLE.plankDark);
  const underwater = new THREE.Color(LANDING_STYLE.stakeDark);
  const scratch = new THREE.Color();
  const geometry = bakedModelGeometry(FERRY_BOAT, {
    paint: (surface, model, colors) => {
      const p = surface.attributes.position;
      const nor = surface.attributes.normal;
      const height = model.size.y || 1;
      const waterline = height * WET_RATIO;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const z = p.getZ(i);
        // 길이 방향 잔 널결 — 없으면 통짜 나무토막으로 보인다
        const grain = 0.5 + 0.5 * Math.sin(z * 96 + y * 31);
        const facingUp = THREE.MathUtils.clamp(nor.getY(i) * 0.5 + 0.5, 0, 1);
        scratch.copy(plankDark).lerp(plank, 0.25 + 0.6 * facingUp);
        scratch.multiplyScalar(0.9 + 0.14 * grain);
        if (y < waterline) scratch.lerp(underwater, THREE.MathUtils.clamp((waterline - y) / waterline, 0, 1) * 0.7);
        colors[i * 3] = scratch.r;
        colors[i * 3 + 1] = scratch.g;
        colors[i * 3 + 2] = scratch.b;
      }
    },
  });
  geometry.translate(0, -(FERRY_BOAT.size.y || 1) * SUBMERGE_RATIO, 0);
  return geometry;
}
