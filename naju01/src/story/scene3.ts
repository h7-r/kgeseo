// Scene 03 「앙암바위의 죽음」이 요구하는 것들. 씬1·2 와 같은 원칙(유형 수준까지만).
// 도면의 조사점 셋이 이미 추락의 세 토막이다 — (39, 11) 바위 위 · (51, 22) 벼랑 끝 · (52, 32) 14 m 아래.
// 새 이야기를 지어내지 않고 그 세 토막에 물건을 건다.
//   짚신 한 켤레를 둘로 쪼갠다 — 한 짝은 벼랑 끝, 한 짝은 아래. 글자 없이 「여기서 저기로 떨어졌다」.
//   댕기는 「혼자가 아니었다」를 말한다. 밤에 만나던 자리 자체는 씬1 의 화톳불·돌탑이 이미 세웠다.
//   벼랑 끝이 무너져 있어야 「여기가 무너졌다」는 사실 하나가 공간에 남는다.
// 색은 표본에 진짜로 굽는다(씬2 와 같은 이유). 단위는 도면 m, 표본은 높이 1.

import type * as THREE from "three";

import { createRandom } from "@/engine/random";

import type { Spot } from "../placement/instanceGroups";
import {
  applyColor,
  buildBall,
  buildBox,
  buildCylinder,
  mergePieces,
  placeOnGround,
  type SceneNote,
  type SceneSpotOptions,
} from "./pieceGeometry";

const SCENE3_STYLE = {
  straw: "#BCA575", // 삼은 지 오래된 짚신
  strawShade: "#8A7748",
  strap: "#6E5C3A", // 짚신을 발에 매는 들메끈
  ribbon: "#9E2B2B", // 붉은 댕기 — 자갈밭에서도 눈에 든다
  ribbonShade: "#5E1818",
  soil: "#7A6448", // 무너져 나간 마루 흙
  soilLight: "#9C8461",
  stone: "#8A8375",
  greenTwig: "#6B7A4A", // 부러지며 딸려 온 잎 붙은 가지
  heartwood: "#C9B994", // 부러진 자리의 흰 속 — 「방금 부러졌다」의 신호
  branch: "#5B4A33",
};

// 발 모양: 뒤꿈치(t=0)가 넓고, 볼(t≈0.35)이 가장 넓고, 코(t=1)가 좁다
const soleWidth = (t: number) => 0.34 + Math.sin((Math.min(t, 0.45) / 0.45) * Math.PI * 0.5) * 0.16 - t * 0.22;

/**
 * 짚신 — 바닥창 · 둘레 울 · 들메끈이 다 있어야 신으로 읽힌다(창만 있으면 깔창).
 * 왼짝·오른짝이 따로다. shapeIndex 0 = 왼짝, 1 = 오른짝(Z 를 뒤집는다).
 */
export function buildStrawShoePrototypes(count = 2, seed = 6301): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const side = i % 2 === 0 ? 1 : -1;
    // 길이 대 높이 비가 실물(약 4.2 : 1)과 맞아야 한다. applyBaseOrigin 이 높이로 나누므로 길이를 줄인다.
    const length = 0.45;
    // 마디를 나눠 짚을 삼은 결을 낸다
    const segments = 7;
    for (let k = 0; k < segments; k++) {
      const t = (k + 0.5) / segments;
      const sole = buildBox(soleWidth(t), 0.1, (length * 2.4) / segments - 0.04);
      sole.translate(0, 0.05, (-1.2 + 2.4 * t) * length);
      pieces.push(applyColor(sole, k % 2 ? SCENE3_STYLE.straw : SCENE3_STYLE.strawShade));
    }
    // 울 — 바닥 둘레의 낮은 턱. 없으면 깔창이다.
    for (const s of [-1, 1])
      for (let k = 0; k < 5; k++) {
        const t = (k + 0.5) / 5;
        const wall = buildBox(0.045, 0.11, (length * 2.2) / 5 - 0.03);
        wall.translate(s * (soleWidth(t) / 2 - 0.02), 0.12, (-1.1 + 2.2 * t) * length);
        pieces.push(applyColor(wall, SCENE3_STYLE.strawShade));
      }
    // 들메끈 — 한쪽이 풀려 늘어져 있다(벗겨진 신이다)
    const strap = buildCylinder(0.022, 0.022, 0.42, 4);
    strap.rotateZ(Math.PI / 2);
    strap.translate(0, 0.2, 0.15 * length);
    pieces.push(applyColor(strap, SCENE3_STYLE.strap));
    const loose = buildCylinder(0.02, 0.016, 0.5, 4);
    loose.rotateX(Math.PI / 2 - 0.25);
    loose.rotateY(side * (0.5 + random() * 0.3));
    loose.translate(side * 0.16, 0.05, -0.5 * length);
    pieces.push(applyColor(loose, SCENE3_STYLE.strap));
    // 뒤축 — 앞뒤를 갈라 준다
    const heel = buildBox(0.3, 0.16, 0.07);
    heel.translate(0, 0.13, -1.18 * length);
    pieces.push(applyColor(heel, SCENE3_STYLE.straw));
    const merged = mergePieces(pieces);
    if (side < 0) merged.scale(1, 1, -1); // 앞뒤 대칭이 아니라 뒤집어야 한다
    prototypes.push(merged);
  }
  return prototypes;
}

/**
 * 댕기 — 땅에 떨어진 천은 판판하지 않다. 마디마다 꺾고 비틀어야 천이 된다.
 * 자갈밭이 전부 누런 잿빛이라 붉어야 눈에 든다. 마디가 많으면 밧줄이 되어 뱀처럼 보였다.
 */
export function buildHairRibbonPrototypes(count = 3, seed = 6302): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    let x = 0;
    let z = 0;
    let angle = random() * Math.PI;
    const segments = 7;
    for (let k = 0; k < segments; k++) {
      const length = 0.34 + random() * 0.12;
      angle += (random() - 0.5) * 1.5;
      // 손가락 두어 개 너비. 넓으면 머플러다.
      const strip = buildBox(0.13, 0.055 + random() * 0.03, length);
      strip.rotateX((random() - 0.5) * 0.5); // 접힌 데가 살짝 뜬다
      strip.rotateY(angle);
      strip.translate(x, 0.035, z);
      pieces.push(applyColor(strip, k % 3 === 1 ? SCENE3_STYLE.ribbonShade : SCENE3_STYLE.ribbon));
      x += Math.sin(angle) * length * 0.88;
      z += Math.cos(angle) * length * 0.88;
    }
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

/**
 * 무너진 마루의 흙덩이. 돌을 더 뿌리면 발치너덜·틈바위에 섞여 버린다.
 * 갓 떨어져 나온 흙은 속이 밝다 — 그 색 차이가 「최근」을 말한다.
 */
export function buildDirtClodPrototypes(count = 4, seed = 6303): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const clodCount = 4 + Math.floor(random() * 4);
    for (let k = 0; k < clodCount; k++) {
      const r = 0.2 + random() * 0.3;
      const clod = buildBall(r, 0);
      // 찌그러뜨린다 — 정이십면체 그대로면 공깃돌이다
      clod.scale(0.7 + random() * 0.7, 0.5 + random() * 0.4, 0.7 + random() * 0.7);
      clod.rotateY(random() * 6.3);
      clod.rotateZ((random() - 0.5) * 0.8);
      clod.translate((random() - 0.5) * 1.4, r * 0.42 + random() * 0.12, (random() - 0.5) * 1.4);
      // 큰 덩이는 겉흙(어둡다), 부서진 작은 것은 속흙(밝다)
      pieces.push(
        applyColor(clod, r > 0.33 ? SCENE3_STYLE.soil : random() < 0.3 ? SCENE3_STYLE.stone : SCENE3_STYLE.soilLight),
      );
    }
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

/** 부러진 생가지 — 떨어지며 훑고 내려온 경로. 흰 속살이 「방금 꺾인 가지」를 가른다. */
export function buildBrokenBranchPrototypes(count = 3, seed = 6304): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const length = 2.6 + random() * 0.8;
    const limb = buildCylinder(0.075, 0.13, length, 6);
    limb.rotateZ(Math.PI / 2);
    limb.rotateY((random() - 0.5) * 0.3);
    limb.translate(0, 0.13, 0);
    pieces.push(applyColor(limb, SCENE3_STYLE.branch));
    const core = buildCylinder(0.075, 0.075, 0.09, 6);
    core.rotateZ(Math.PI / 2);
    core.translate(length / 2, 0.13, 0);
    pieces.push(applyColor(core, SCENE3_STYLE.heartwood));
    // 잔가지 — 없으면 몽둥이다
    for (let k = 0; k < 4; k++) {
      const t = (k + 0.6) / 5;
      const twig = buildCylinder(0.035, 0.015, 0.55 + random() * 0.4, 4);
      twig.rotateZ(Math.PI / 2 - (0.5 + random() * 0.6));
      twig.rotateY(random() * 6.3);
      twig.translate(-length / 2 + length * t, 0.16, 0);
      pieces.push(applyColor(twig, SCENE3_STYLE.branch));
    }
    // 아직 푸른 잎 — 시든 잎이면 오래된 가지가 된다
    for (let k = 0; k < 9; k++) {
      const leaf = buildBox(0.26, 0.03, 0.38);
      leaf.rotateY(random() * 6.3);
      leaf.rotateX((random() - 0.5) * 0.7);
      leaf.translate((random() - 0.5) * length * 0.9, 0.16 + random() * 0.22, (random() - 0.5) * 1.1);
      pieces.push(applyColor(leaf, SCENE3_STYLE.greenTwig));
    }
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

type Scene3PropKey = "strawShoe" | "hairRibbon" | "dirtClod" | "brokenBranch";

export const SCENE3_NOTES: Record<Scene3PropKey, SceneNote> = {
  strawShoe: { text: "짚신 한 짝 · 나머지 짝은 14 m 아래에 있다 (F-07)", color: "#F2C89A" },
  hairRibbon: { text: "댕기 · 그 자리에 둘이 있었다 (F-06)", color: "#F2C89A" },
  dirtClod: { text: "무너진 마루 · 여기가 추락 시작점이다", color: "#B9E0C8" },
  brokenBranch: { text: "부러진 생가지 · 떨어지며 훑고 내려온 자국", color: "#CFE3B8" },
};

// 마루 띠(z 25.2~26.4)는 통째로 바위벽이라 거기 놓으면 파묻혀 안 보인다.
// 사람이 설 수 있는 벼랑 끝은 z ≈ 24.0~24.5 다(씬1 화톳불·돌탑도 같은 띠).
// (39, 11) 은 일부러 비워 둔다 — 그 서사는 씬1 이 이미 세웠고, 무엇을 둘지는 퍼즐이 정해진 뒤의 일이다.
export function computeScene3Spots({ heightAt }: SceneSpotOptions): Record<Scene3PropKey, Spot[]> {
  return {
    // shapeIndex 를 손으로 준다. 안 주면 번호 순서에 따라 같은 짝이 둘 나올 수 있다.
    strawShoe: placeOnGround(heightAt, [
      // 벼랑 끝 바위 사이 빈 자리 — 벗겨져 남은 짝
      { x: 50.0, z: 24.2, size: 0.06, shapeIndex: 0, rotation: 2.35 },
      // 14 m 아래 조사점 그 자리. 바위벽을 치고 튕겨 나가 X 가 2 m 바깥으로 밀렸다.
      { x: 52.0, z: 32.0, size: 0.06, shapeIndex: 1, rotation: 4.1 },
    ]),

    // 짚신에서 1.5 m — 한눈에 둘이 한 자리로 잡히는 거리
    hairRibbon: placeOnGround(heightAt, [{ x: 48.6, z: 24.1, size: 0.05, shapeIndex: 0, rotation: 1.2 }]),

    // 한 군데가 무너졌다로 읽혀야 한다. z 25.9 를 넘기면 렌더 지면보다 판정 지면이 낮아져 묻힌다.
    dirtClod: placeOnGround(heightAt, [
      { x: 50.3, z: 25.5, size: 0.55, shapeIndex: 0, rotation: 0.4 },
      { x: 48.9, z: 25.2, size: 0.36, shapeIndex: 1, rotation: 2.2 },
      { x: 51.6, z: 25.7, size: 0.33, shapeIndex: 2, rotation: 4.9 },
      // 발치의 부스러기 — 위 셋과 같은 밝은 흙이라 색으로 짝이 지어진다
      { x: 51.4, z: 30.6, size: 0.42, shapeIndex: 3, rotation: 1.6 },
      { x: 52.8, z: 31.2, size: 0.3, shapeIndex: 0, rotation: 3.4 },
    ]),

    brokenBranch: placeOnGround(heightAt, [
      { x: 51.2, z: 31.6, size: 0.26, shapeIndex: 0, rotation: 0.9 },
      { x: 53.1, z: 32.6, size: 0.22, shapeIndex: 1, rotation: 2.6 },
    ]),
  };
}
