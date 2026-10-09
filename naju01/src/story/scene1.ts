// Scene 01 「돌아오지 않은 약속」이 반드시 있어야 한다고 적은 것들(④ Scene 구성표).
// 전부 유형 수준이다 — instance_id·퍼즐 정답은 ④ §5 대로 여기서 정하지 않는다.
//   어부 생활(F-05) → 그물틀·통발·천막 · 만나 온 흔적(F-06) → 화톳불·돌탑 · 사건의 시작 → 구렁이
// 필수 단서는 Playable Core(Z1·Z3) 안에만 둔다(④ §0.5). 원경에는 하나도 없다.
// 무리 이름이 전부 `씬1.` 로 시작해, 씬 진행에 따른 켜고 끄기를 이름 앞머리로 할 수 있다.
// 단위는 도면 m. 표본은 키 1 이고 m 변환은 createInstanceGroup 이 한다.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { createRandom } from "@/engine/random";

import { FISH_TRAP, SERPENT, TENT } from "../models/baked";
import { buildBakedModelGeometry, findThinParts, findTongue, measureHead } from "../models/bakedGeometry";
import type { Spot } from "../placement/instanceGroups";
import { applyVertexColors } from "../terrain/ground";
import { placeOnGround, type SceneNote, type SceneSpotOptions } from "./pieceGeometry";

const SCENE1_STYLE = {
  pole: "#7A6647", // 그물틀·통발을 엮은 나무
  net: "#A9A489", // 볕에 바랜 삼줄
  bamboo: "#9A8757", // 통발 대오리 — 볕에 마른 빛
  // 천막은 한 덩이 안에 색이 둘이라 instanceColor 로는 못 준다 — 표본에 진짜 색을 굽는다
  tentCloth: "#9DA2A4",
  tentClothShade: "#5C6164",
  tentPole: "#7A6647",
  tentPoleDark: "#3E3327",
  stone: "#8A8375",
  stoneDark: "#4A463E",
  ash: "#3A3630",
  charcoal: "#241F1B",
  // 구렁이 바탕색. 표본은 명암을 비율로 굽고 이 색이 곱해진다 — 바탕이 가운데 밝기여야
  // 등(흑갈)과 배(누런 크림)의 폭이 나온다. 어두우면 몸 전체가 탄 통나무처럼 갇혔다.
  serpentBack: "#8A7C58",
};

// 기본 도형에는 uv 가 있고 직접 만든 면(그물)에는 없다. 섞어 합치면 mergeGeometries 가 null 을 낸다.
function tint(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("uv1");
  return applyVertexColors(geometry, new THREE.Color(color));
}

/** 물가에 그물을 널어 말리는 틀 — 어부가 사는 물가라는 신호(F-05). 키 1 · 밑동 원점. */
export function buildNetFramePrototypes(count = 3, seed = 1301): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const halfWidth = 0.55 + random() * 0.12;
    // 다리는 살짝 벌려 세운다. 곧게 서면 안 넘어질 이유가 없어 보인다.
    for (const s of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.028, 0.04, 1, 5, 1);
      leg.translate(0, 0.5, 0);
      leg.rotateZ(s * (0.1 + random() * 0.05));
      leg.translate(s * halfWidth, 0, (random() - 0.5) * 0.06);
      pieces.push(tint(leg.toNonIndexed(), SCENE1_STYLE.pole));
      leg.dispose();
    }
    const bar = new THREE.CylinderGeometry(0.026, 0.026, halfWidth * 2.1, 5, 1);
    bar.rotateZ(Math.PI / 2);
    bar.translate(0, 0.94, 0);
    pieces.push(tint(bar.toNonIndexed(), SCENE1_STYLE.pole));
    bar.dispose();
    // 널린 그물 — 아래로 처진 한 겹. 판판하면 천이 아니라 판때기다.
    const cells = 10;
    const positions: number[] = [];
    const sag = (t: number) => Math.sin(Math.PI * t) * (0.3 + random() * 0.05);
    for (let k = 0; k < cells; k++) {
      const t0 = k / cells;
      const t1 = (k + 1) / cells;
      const x0 = -halfWidth + 2 * halfWidth * t0;
      const x1 = -halfWidth + 2 * halfWidth * t1;
      const y0 = 0.92 - sag(t0);
      const y1 = 0.92 - sag(t1);
      const z = 0.02;
      positions.push(x0, 0.92, -z, x1, 0.92, -z, x0, y0, z);
      positions.push(x1, 0.92, -z, x1, y1, z, x0, y0, z);
    }
    const net = new THREE.BufferGeometry();
    net.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    net.computeVertexNormals();
    pieces.push(tint(net, SCENE1_STYLE.net));
    const merged = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    prototypes.push(merged);
  }
  return prototypes;
}

// 씬과 팔레트 썸네일이 각각 부른다. 나무/천 가르기가 무거워 한 번 구워 두고 돌려쓴다.
let tentCache: THREE.BufferGeometry[] | null = null;

/**
 * 천막 — 천은 회색빛, 기둥은 나무색. 모형에 재질이 없어 모양으로 가른다(findThinParts).
 * 진짜 색을 굽으므로 자리에 색을 주지 않는다(주면 두 색 모두에 곱해진다).
 */
export function buildTentPrototypes(): THREE.BufferGeometry[] {
  if (tentCache) return tentCache;
  const cloth = new THREE.Color(SCENE1_STYLE.tentCloth);
  const clothShade = new THREE.Color(SCENE1_STYLE.tentClothShade);
  const pole = new THREE.Color(SCENE1_STYLE.tentPole);
  const poleDark = new THREE.Color(SCENE1_STYLE.tentPoleDark);
  const scratch = new THREE.Color();
  tentCache = [
    buildBakedModelGeometry(TENT, {
      paint: (geometry, model, colors) => {
        const p = geometry.attributes.position;
        const nor = geometry.attributes.normal;
        const wood = findThinParts(geometry);
        const height = model.size.y || 1;
        for (let i = 0; i < p.count; i++) {
          // 위를 보는 면은 볕을 받고 아래를 보는 면은 그늘이다
          const facingUp = THREE.MathUtils.clamp(nor.getY(i) * 0.5 + 0.5, 0, 1);
          if (wood.has(i)) {
            // 세로 잔 나뭇결 — 없으면 플라스틱 막대처럼 보인다
            const grain = 0.5 + 0.5 * Math.sin(p.getY(i) * 210 + p.getX(i) * 37);
            scratch.copy(poleDark).lerp(pole, 0.3 + 0.62 * facingUp);
            scratch.multiplyScalar(0.92 + 0.13 * grain);
          } else {
            // 천은 처마 쪽으로 갈수록 어둡다
            const lower = 1 - THREE.MathUtils.clamp(p.getY(i) / height, 0, 1);
            scratch.copy(clothShade).lerp(cloth, 0.34 + 0.6 * facingUp);
            scratch.lerp(clothShade, lower * 0.35);
          }
          colors[i * 3] = scratch.r;
          colors[i * 3 + 1] = scratch.g;
          colors[i * 3 + 2] = scratch.b;
        }
      },
    }),
  ];
  return tentCache;
}

/** 통발 — 물가에 눕혀 둔다. 엮은 결이 있어 위아래 명암만으로 충분하다. */
export function buildFishTrapPrototypes(): THREE.BufferGeometry[] {
  return [buildBakedModelGeometry(FISH_TRAP, { bottom: 1.24, top: 0.72 })];
}

export function buildCairnPrototypes(count = 3, seed = 2203): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const layers = 5 + Math.floor(random() * 3);
    let y = 0;
    for (let k = 0; k < layers; k++) {
      const t = k / (layers - 1);
      const r = 0.28 * (1 - t * 0.62) * (0.85 + random() * 0.3);
      const h = 0.1 + random() * 0.07;
      const stone = new THREE.IcosahedronGeometry(r, 0);
      stone.scale(1, (h / 2 / r) * 1.6, 0.85 + random() * 0.3);
      stone.rotateY(random() * Math.PI * 2);
      stone.translate((random() - 0.5) * 0.05, y + h / 2, (random() - 0.5) * 0.05);
      pieces.push(tint(stone, random() < 0.5 ? SCENE1_STYLE.stone : SCENE1_STYLE.stoneDark));
      y += h * 0.92;
    }
    const merged = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    merged.computeBoundingBox();
    const top = merged.boundingBox?.max.y ?? 1;
    merged.scale(1 / top, 1 / top, 1 / top);
    prototypes.push(merged);
  }
  return prototypes;
}

/**
 * 돌을 둘러 불을 피운 자리. 다 타서 재만 남았다 — 밤마다 여기 있었다는 흔적(F-06).
 * 키 1 에 가로가 훨씬 넓다. 표본 자체를 넓게 만들어야 폭비로 늘이지 않아도 돌이 안 찌그러진다.
 */
export function buildBonfirePrototypes(count = 3, seed = 3307): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const radius = 2.6; // 키(돌 높이) 대비 가로 반지름
    const stoneCount = 9 + Math.floor(random() * 3);
    for (let k = 0; k < stoneCount; k++) {
      const a = (k / stoneCount) * Math.PI * 2 + (random() - 0.5) * 0.3;
      const r = radius * (0.9 + random() * 0.2);
      const stone = new THREE.IcosahedronGeometry(0.55 + random() * 0.2, 0);
      stone.scale(1, 0.8, 1);
      stone.rotateY(random() * Math.PI * 2);
      stone.translate(Math.cos(a) * r, 0.42, Math.sin(a) * r);
      pieces.push(tint(stone, random() < 0.5 ? SCENE1_STYLE.stone : SCENE1_STYLE.stoneDark));
    }
    const ash = new THREE.CircleGeometry(radius * 0.86, 12);
    ash.rotateX(-Math.PI / 2);
    ash.translate(0, 0.1, 0);
    pieces.push(tint(ash.toNonIndexed(), SCENE1_STYLE.ash));
    ash.dispose();
    for (let k = 0; k < 5; k++) {
      const coal = new THREE.IcosahedronGeometry(0.22 + random() * 0.18, 0);
      coal.scale(1, 0.45, 1);
      const a = random() * Math.PI * 2;
      const r = radius * 0.55 * random();
      coal.translate(Math.cos(a) * r, 0.16, Math.sin(a) * r);
      pieces.push(tint(coal, SCENE1_STYLE.charcoal));
    }
    const merged = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    prototypes.push(merged);
  }
  return prototypes;
}

/**
 * 구렁이 — 첫 등장, 정체 불명으로만 제시한다. 「구렁이 = 아랑사」를 확정하지 말라고 했으니
 * 사람을 떠올리게 하는 표식은 하나도 넣지 않는다. 길이 1 · 누워 있음 · 밑동 원점.
 * 색은 비율로 굽는다(바탕은 instanceColor) — 비율을 올리고 다른 채널을 눌러야 색이 난다.
 */
export function buildSerpentPrototypes(): THREE.BufferGeometry[] {
  const body = buildBakedModelGeometry(SERPENT, {
    paint: (geometry, _model, colors) => {
      const p = geometry.attributes.position;
      const nor = geometry.attributes.normal;
      const { snout, side, headWidth, headLength, nose } = measureHead(geometry);
      // 혀뿌리가 입에 붙어 있어 길이만으로는 못 가른다. 넉넉히 번지게 두고 주둥이 앞쪽만 남긴다.
      const tongueWide = findTongue(geometry, { start: nose, length: headLength * 0.55 });
      const tongue = new Set<number>();
      {
        const q = new THREE.Vector3();
        for (const i of tongueWide) {
          q.set(p.getX(i), p.getY(i), p.getZ(i)).sub(nose);
          if (q.dot(snout) > -headLength * 0.52) tongue.add(i);
        }
      }

      // 눈은 머리에서 자리가 정해져 있으니 계산으로 놓고, 그 점에 가장 가까운 표면 점을 칠 중심으로 삼는다.
      // 표면 최댓값으로 찾으면 울퉁불퉁한 데로 튀어 좌우가 비대칭이 됐다.
      const up = new THREE.Vector3(0, 1, 0);
      // 머리폭만 하게(9 cm 쯤) 키워야 멀리서도 「눈이 있다」가 읽힌다
      const eyeSize = headWidth * 1.15;
      const pupil = eyeSize * 0.62;
      const normal = new THREE.Vector3();
      const scratch = new THREE.Vector3();
      const offset = new THREE.Vector3();
      // 코에서 주둥이 방향으로 물러난 축점 기준, 쪽 절반에서만 표면점을 고른다.
      // 띠 평균·반폭 상한은 둘 다 헛짚었다(목까지 물거나 메시 안쪽으로 들어갔다).
      const axisPoint = nose.clone().addScaledVector(snout, -headLength * 0.33);
      const eyeSpots = [-1, 1].map((sign) => {
        const ideal = axisPoint
          .clone()
          .addScaledVector(side, sign * headWidth * 0.95)
          .addScaledVector(up, headWidth * 0.35);
        const picked = ideal.clone();
        let nearest = Infinity;
        for (let i = 0; i < p.count; i++) {
          scratch.set(p.getX(i), p.getY(i), p.getZ(i));
          if (offset.copy(scratch).sub(axisPoint).dot(side) * sign <= 0) continue; // 이 쪽 절반만
          const d = scratch.distanceToSquared(ideal);
          if (d < nearest) {
            nearest = d;
            picked.copy(scratch);
          }
        }
        return { position: picked, outward: picked.clone().sub(axisPoint).normalize() };
      });
      const eyes = eyeSpots.map((e) => e.position);
      const eyeOutward = eyeSpots.map((e) => e.outward);

      const v = new THREE.Vector3();
      const fromNose = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i));

        // 또아리라 몸통이 전부 낮다 — 높이가 아니라 면이 보는 쪽으로 등/배를 가른다
        const facingUp = THREE.MathUtils.clamp(nor.getY(i) * 0.5 + 0.5, 0, 1);
        const t = Math.pow(facingUp, 0.8); // 0 = 배 · 1 = 등
        // 먹구렁이는 등이 흑갈색, 배가 누런 크림색이다. 등을 너무 어둡게 하면 해와 상쇄돼 평평해진다.
        const bright = 1.35 - 0.75 * t;
        let r = bright;
        let g = bright * (1 - 0.06 * t);
        let b = bright * (1 - 0.3 * t);
        b *= 1 - 0.22 * (1 - t);

        // 굵은 가로 띠. 모형은 길이 1 이라 주파수 56 이면 2.6 m 몸에서 한 줄이 29 cm 다.
        const band =
          Math.sin(v.x * 56 + v.z * 31) * 0.62 +
          Math.sin(v.z * 47 - v.y * 60) * 0.3 +
          Math.sin((v.x + v.z) * 165 + v.y * 90) * 0.12; // 띠 경계 흐트러뜨리기
        const darkness = THREE.MathUtils.smoothstep(band, -0.15, 0.5) * (0.3 + 0.7 * t);
        r *= 1 - 0.6 * darkness;
        g *= 1 - 0.56 * darkness;
        b *= 1 - 0.68 * darkness;

        // 비늘결 — 없으면 큰 얼룩만 있어 고무처럼 보인다
        const scale = 1 + 0.07 * Math.sin(v.x * 190) * Math.sin(v.z * 173) * Math.sin(v.y * 151);
        r *= scale;
        g *= scale;
        b *= scale;

        // 띠는 머리 하나에 한 주기뿐이라 머리는 따로 — 흰 아랫입술과 눈 뒤 어두운 줄
        const toNose = v.distanceTo(nose);
        if (toNose < headLength * 1.15) {
          const inHead = 1 - THREE.MathUtils.smoothstep(toNose, headLength * 0.7, headLength * 1.15);
          fromNose.copy(v).sub(nose);
          const below = THREE.MathUtils.clamp(-fromNose.dot(up) / (headWidth * 0.9), 0, 1);
          const lighten = below * inHead * 0.55;
          r *= 1 + lighten * 0.9;
          g *= 1 + lighten * 0.8;
          b *= 1 + lighten * 0.5;
          const back = -fromNose.dot(snout);
          const stripe =
            THREE.MathUtils.smoothstep(back, headLength * 0.34, headLength * 0.46) *
            (1 - THREE.MathUtils.smoothstep(back, headLength * 0.75, headLength * 1.05)) *
            THREE.MathUtils.clamp(fromNose.dot(up) / (headWidth * 0.7) + 0.35, 0, 1) *
            inHead;
          r *= 1 - 0.5 * stripe;
          g *= 1 - 0.48 * stripe;
          b *= 1 - 0.55 * stripe;
        }

        // 눈알은 칠한다(붙이지 않는다). 면이 눈과 같은 쪽을 볼 때만 — 거리만 보면 머리를 파고든다.
        for (let e = 0; e < 2; e++) {
          const d = v.distanceTo(eyes[e]);
          if (d >= eyeSize) continue;
          normal.set(nor.getX(i), nor.getY(i), nor.getZ(i));
          if (normal.dot(eyeOutward[e]) < 0.15) continue;
          const rim = THREE.MathUtils.smoothstep(d, eyeSize * 0.82, eyeSize);
          if (d < pupil) {
            // 몸통과 색조가 같으면 눈으로 안 갈린다 — 검은 알 + 가는 금테
            r = 0.1;
            g = 0.09;
            b = 0.08;
          } else {
            r = THREE.MathUtils.lerp(1.85, r, rim);
            g = THREE.MathUtils.lerp(1.55, g, rim);
            b = THREE.MathUtils.lerp(0.7, b, rim);
          }
          break;
        }

        if (tongue.has(i)) {
          r = 1.55;
          g = 0.24;
          b = 0.26;
        }

        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      }
    },
  });
  return [body];
}

type Scene1PropKey = "netFrame" | "fishTrap" | "bonfire" | "cairn" | "serpent" | "tent";

// 이 그레이박스는 팀이 띄워 놓고 걸어 보는 물건이라, 소스를 안 여는 사람에게도 「왜 여기 있나」를 보여 준다
export const SCENE1_NOTES: Record<Scene1PropKey, SceneNote> = {
  netFrame: { text: "그물틀 · 어부가 사는 물가라는 표시 (F-05)", color: "#CFE3B8" },
  fishTrap: { text: "통발 · 첫 씬의 「만질 수 있다」 학습용", color: "#CFE3B8" },
  bonfire: { text: "화톳불 자리 · 두 사람이 만나 온 흔적 (F-06)", color: "#F2C89A" },
  cairn: { text: "돌탑 · 그 흔적을 「사람이 남겼다」로 못박는 것", color: "#F2C89A" },
  serpent: { text: "구렁이 · 사건의 시작 (F-09) · 아직 유형만 확정", color: "#B9E0C8" },
  tent: { text: "천막 · 물때를 기다리며 머무는 자리 (F-05)", color: "#CFE3B8" },
};

// 자리는 팀이 편집기(E)로 옮긴 결과를 구운 것이다. 편집이 살아 있으면 edits.json 이 덮는다.
export function computeScene1Spots({ heightAt }: SceneSpotOptions): Record<Scene1PropKey, Spot[]> {
  return {
    // 강가에 한 채만 서서 배·통발·화톳불과 함께 물가 한쪽에 생활 구역을 이룬다
    netFrame: placeOnGround(heightAt, [{ x: 26.541, z: 43.033, size: 1.55, rotation: 1.387, widthRatio: 1.35 / 1.55 }]),

    // 집어 보고 뒤집어 볼 수 있는 물건 — 이 방은 만질 수 있다는 것을 첫 씬에서 가르친다.
    // 색을 반드시 준다. 표본은 비율만 굽고, 안 주면 흰색이 채워져 새하얗게 나온다.
    fishTrap: placeOnGround(heightAt, [
      { x: 19.6, z: 41.9, size: 0.95, rotation: 0.9, color: SCENE1_STYLE.bamboo },
      { x: 20.5, z: 42.3, size: 0.88, rotation: 1.6, color: SCENE1_STYLE.bamboo },
      { x: 19.0, z: 42.5, size: 0.92, rotation: 0.2, tilt: 0.35, color: SCENE1_STYLE.bamboo },
    ]),

    // 같은 흔적이 두 군데 있어야 「오가던 자리」가 되고, 둘을 잇는 선이 아랑사–아비사의 동선이 된다
    bonfire: placeOnGround(heightAt, [
      // 물가 — 아비사가 배를 기다리며 불을 피운 자리
      { x: 23.991, z: 42.503, size: 0.26, rotation: 0.5 },
      // 앙암바위 위 — 밤마다 만나던 자리. V2 시점에서 보여 씬 3 에서 다시 눈에 든다.
      { x: 44.7, z: 24.4, size: 0.28, rotation: 1.1 },
    ]),

    // 자연물 사이에서 유일하게 의도가 보이는 물건. 화톳불 곁에 하나씩 두어 같은 사람의 자리로 짝짓는다.
    cairn: placeOnGround(heightAt, [
      { x: 25.756, z: 41.864, size: 0.82, rotation: 0.7, widthRatio: 0.62, depthRatio: 0.62 },
      { x: 47.4, z: 23.7, size: 0.95, rotation: 2.1, widthRatio: 0.6, depthRatio: 0.6 },
    ]),

    // 물때를 기다리는 어부는 물가를 못 떠난다 — 그늘 한 채가 있어야 그 기다림이 그림이 된다
    tent: placeOnGround(heightAt, [{ x: 27.4, z: 40.6, size: 2.6, rotation: -0.5 }]),

    // 또아리 모형이라 size 2.6 은 몸 길이가 아니라 또아리 지름이다(풀면 7~8 m).
    // 생활 구역 바로 앞이라 사람의 자리와 구렁이가 한 화면에 잡힌다. T1 들머리(28, 36.5)와는 5 m 넘게 떨어져 있다.
    // 색은 흰색 — 구운 모형(색이 입혀진 것)에 곱해진다.
    serpent: placeOnGround(heightAt, [{ x: 22.667, z: 39.839, size: 2.6, rotation: 3.601, color: "#FFFFFF" }]),
  };
}
