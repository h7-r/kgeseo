/** 소지품 물건의 모양 — 땅 위 · 손 · 제상 위에서 같이 쓴다. 미터, 바닥이 원점 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { makeToonMaterial } from "./materials";

import { EMBER, buildFishGeometry } from "./fishTrap/lightFish";
import { buildBronzeKey, buildClosedBox } from "./ridge/lockedBox";
import type { ItemKind } from "./inventory";

export interface ItemLook {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** 땅에서 띄울 높이(미터) — 모양의 바닥이 땅에 닿게 */
  lift: number;
  /** 실물 모형(GLB) — 있으면 다 읽힌 뒤 geometry 대신 이것을 그린다. size 는 가장 긴 변(미터) */
  model?: { url: string; size: number };
}

/** 쌀 자루 · 술병 옆선(미터). 아래에서 위로 */
const RICE_SACK_PROFILE: [number, number][] = [
  [0, 0],
  [0.09, 0],
  [0.12, 0.05],
  [0.1, 0.11],
  [0.04, 0.14],
  [0.055, 0.17],
  [0, 0.18],
];
const BOTTLE_PROFILE: [number, number][] = [
  [0, 0],
  [0.05, 0],
  [0.09, 0.05],
  [0.1, 0.11],
  [0.06, 0.18],
  [0.025, 0.24],
  [0.03, 0.27],
  [0, 0.27],
];

/** 옆선을 돌려 만든 그릇 모양 */
function buildLathe(profile: [number, number][]) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    14,
  );
}

export function buildItemLooks(): Record<ItemKind, ItemLook> {
  const fish = buildFishGeometry();
  fish.rotateZ(Math.PI / 2); // 옆으로 누워 있다
  return {
    lightFish: {
      geometry: fish,
      material: new THREE.MeshBasicMaterial({ color: EMBER.clone().multiplyScalar(2.4), toneMapped: false }),
      lift: 0.04,
    },
    rice: {
      geometry: buildLathe(RICE_SACK_PROFILE),
      material: makeToonMaterial("#E3DBC6", { side: THREE.DoubleSide }),
      lift: 0,
    },
    floatStone: {
      geometry: buildFloatStoneGeometry(),
      material: makeToonMaterial("#E2DCCD"),
      lift: 0.06,
    },
    makgeolli: {
      geometry: buildLathe(BOTTLE_PROFILE),
      material: makeToonMaterial("#EDE8DA", { side: THREE.DoubleSide }),
      lift: 0,
    },
    gearStone: {
      geometry: buildGearStoneGeometry(),
      // 물속 어둠에서도 찾아지게 살짝 빛난다
      material: makeToonMaterial("#55605F", { emissive: new THREE.Color("#0F2A30") }),
      lift: 0,
    },
    pearl: {
      geometry: new THREE.SphereGeometry(0.045, 20, 14).translate(0, 0.045, 0),
      material: makeToonMaterial("#EEF2F4", { emissive: new THREE.Color("#3C4A58") }),
      lift: 0,
    },
    bigPearl: {
      geometry: new THREE.SphereGeometry(0.1, 24, 16).translate(0, 0.1, 0),
      material: makeToonMaterial("#FFFFFF", { emissive: new THREE.Color("#8A8F94") }),
      lift: 0,
    },
    scale: {
      geometry: buildScaleGeometry(),
      // 어두운 석실에서도 보이게 스스로 조금 빛난다
      material: makeToonMaterial("#FFFFFF", {
        vertexColors: true,
        emissive: new THREE.Color("#1E4A66"),
        side: THREE.DoubleSide,
      }),
      lift: 0.02,
    },
    strawShoe: {
      geometry: buildStrawShoeGeometry(),
      material: makeToonMaterial("#A88E58"),
      lift: 0,
    },
    // 옻칠한 나무 함 — 색은 꼭짓점에 칠해 둔 대로(ridge/lockedBox)
    letterBox: {
      geometry: buildClosedBox(),
      material: makeToonMaterial("#FFFFFF", { vertexColors: true }),
      lift: 0,
    },
    // 땅에서 찾기 쉽게 청동이 살짝 빛난다
    bronzeKey: {
      geometry: buildBronzeKey(),
      material: makeToonMaterial("#FFFFFF", { vertexColors: true, emissive: new THREE.Color("#3A2A10") }),
      lift: 0,
    },
  };
}

/**
 * 푸른 눈물(아랑사가 남긴 것 · 이름은 눈물, 꼴은 비늘) — 손바닥만 한 방패꼴. 가운데 등줄이 솟고 양옆으로 결이 퍼지며, 끝이 둥글게 겹친다.
 * 등줄 쪽은 짙은 쪽빛, 가장자리로 갈수록 옅은 물빛으로 바랜다(꼭짓점 색). 미터, 밑이 원점. 살짝 기울여 세운다
 */
export function buildScaleGeometry() {
  const length = 0.16;
  const width = 0.13;
  const rings = 18;
  const rays = 28;
  const positions: number[] = [];
  const colors: number[] = [];
  const deep = new THREE.Color("#1F4E7A");
  const mid = new THREE.Color("#3E8DB3");
  const pale = new THREE.Color("#BFE6EE");
  const tint = new THREE.Color();
  // 앞면 — 아래 뾰족한 밑동(t=0)에서 둥근 끝(t=1)으로, 옆으로는 −1~1
  const outline = (t: number) => Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.7 * (0.55 + 0.45 * t);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    for (let j = 0; j <= rays; j++) {
      const u = (j / rays) * 2 - 1;
      const half = outline(t) * width * 0.5;
      const x = u * half;
      const y = t * length;
      const ridge = (1 - Math.abs(u)) ** 1.6 * 0.012 * Math.sin(Math.PI * t);
      // 결 — 등줄에서 비스듬히 퍼지는 가는 홈
      const groove = 0.0015 * Math.sin((Math.abs(u) * 9 - t * 6) * Math.PI);
      const z = ridge + groove * (1 - Math.abs(u)) + 0.008 * (1 - u * u);
      positions.push(x, y, z);
      const edge = Math.abs(u) ** 1.4;
      tint
        .copy(deep)
        .lerp(mid, Math.min(1, edge * 1.3 + t * 0.2))
        .lerp(pale, Math.max(0, edge - 0.55) * 1.8 + (t > 0.9 ? (t - 0.9) * 4 : 0));
      // 결 따라 밝고 어두운 줄
      tint.multiplyScalar(0.92 + 0.16 * (0.5 + 0.5 * Math.sin((Math.abs(u) * 9 - t * 6) * Math.PI)));
      colors.push(tint.r, tint.g, tint.b);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < rays; j++) {
      const a = i * (rays + 1) + j;
      const b = a + rays + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const front = new THREE.BufferGeometry();
  front.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  front.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  front.setIndex(index);
  // 뒷면 — 같은 판을 뒤집어 붙인다(두께 2 mm)
  const back = front.clone();
  back.scale(1, 1, -0.3);
  back.translate(0, 0, -0.002);
  const backIndex = back.index!.array as ArrayLike<number>;
  const flipped: number[] = [];
  for (let k = 0; k < backIndex.length; k += 3) flipped.push(backIndex[k], backIndex[k + 2], backIndex[k + 1]);
  back.setIndex(flipped);
  const merged = mergeGeometries([front.toNonIndexed(), back.toNonIndexed()], false)!;
  front.dispose();
  back.dispose();
  merged.computeVertexNormals();
  merged.rotateX(-0.35);
  return merged;
}

/** 톱니돌 — 테두리에 톱니 여덟이 난 납작한 돌판. 미터, 바닥이 원점(눕혀 둔다). 고리문 홈에는 세워 끼운다 */
export function buildGearStoneGeometry() {
  const teeth = 8;
  const outer = 0.11;
  const inner = 0.085;
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a0 = (i / (teeth * 2)) * Math.PI * 2;
    const a1 = ((i + 0.55) / (teeth * 2)) * Math.PI * 2;
    const x0 = Math.cos(a0) * r;
    const y0 = Math.sin(a0) * r;
    const x1 = Math.cos(a1) * r;
    const y1 = Math.sin(a1) * r;
    if (i === 0) shape.moveTo(x0, y0);
    else shape.lineTo(x0, y0);
    shape.lineTo(x1, y1);
  }
  shape.closePath();
  const holeRadius = 0.028;
  const hole = new THREE.Path();
  hole.absarc(0, 0, holeRadius, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.045,
    bevelEnabled: true,
    bevelSize: 0.006,
    bevelThickness: 0.005,
    bevelSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2); // 눕힌다 — 두께가 위로
  geometry.computeBoundingBox();
  geometry.translate(0, -geometry.boundingBox!.min.y, 0);
  return geometry;
}

/** 짚신 — 앞이 둥근 납작한 바닥, 앞코 · 옆 고리 · 뒤꿈치 끈. 미터, 바닥이 원점, 앞이 +z */
export function buildStrawShoeGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.SphereGeometry(1, 16, 8).scale(0.055, 0.016, 0.13).translate(0, 0.016, 0));
  parts.push(new THREE.TorusGeometry(0.035, 0.008, 5, 12, Math.PI).rotateX(-Math.PI / 2).translate(0, 0.03, 0.08));
  for (const side of [-1, 1])
    parts.push(new THREE.TorusGeometry(0.02, 0.006, 4, 8).rotateY(Math.PI / 2).translate(side * 0.05, 0.03, 0.01));
  parts.push(
    new THREE.TorusGeometry(0.03, 0.007, 4, 10, Math.PI)
      .rotateX(-Math.PI / 2)
      .rotateY(Math.PI)
      .translate(0, 0.035, -0.1),
  );
  const flat = parts.map((g) => {
    const out = g.index ? g.toNonIndexed() : g;
    if (out.hasAttribute("uv")) out.deleteAttribute("uv");
    return out;
  });
  const merged = mergeGeometries(flat, false)!;
  parts.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  return merged;
}

/** 뜬 돌 — 납작하고 모난 부석. 미터, 가운데가 원점 */
export function buildFloatStoneGeometry() {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const position = geometry.attributes.position;
  // 둥글기만 하면 공 같다 — 꼭짓점을 들쭉날쭉하게. 이 도형은 면마다 꼭짓점을 따로 가져서,
  // 순번으로 흔들면 같은 자리의 점이 서로 다르게 움직여 면이 갈라진다 → 자리로 정한다
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    const hash = Math.sin(point.x * 12.9898 + point.y * 78.233 + point.z * 37.719) * 43758.5453;
    point.multiplyScalar(0.86 + 0.22 * (hash - Math.floor(hash)));
    position.setXYZ(i, point.x, point.y, point.z);
  }
  geometry.scale(0.16, 0.085, 0.13);
  geometry.computeVertexNormals();
  return geometry;
}
