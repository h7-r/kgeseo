// Scene 02 「엇갈리는 증언」이 반드시 있어야 한다고 적은 것들. 씬1 과 같은 원칙(유형 수준까지만).
// 근거는 도면에 이미 적힌 것뿐이다: Z4 「진부촌 방향 증언 능선」, V3(65, 19), 차단물 B2(씬 2 끝에 무너짐).
// V3 의 숨길것이 「Z3 · Z2 사건 현장」이다 — 증언하는 자리에서는 사건 현장이 안 보인다.
// 그래서 증언이 엇갈린다. 여기 놓는 것은 전부 「여기서 사람들이 이야기를 나눴다」는 흔적이다.
// 솟대 꼭대기의 새가 제각각 다른 데를 봐서, 증언이 갈린다는 걸 눈으로 보여 준다.
// 한 덩이에 색이 여럿이라 표본에 진짜 색을 굽고 자리에는 색을 안 준다(주면 통째로 물든다).
// 단위는 도면 m. 표본은 높이 1.

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

const SCENE2_STYLE = {
  wood: "#7A6647", // 다듬은 소나무 — 평상 · 지게
  woodDark: "#4A3B27",
  oldWood: "#8B7A5C", // 볕에 바랜 평상 상판
  bark: "#5B4A33", // 통나무 걸상 옆면
  heartwood: "#C0A87E", // 그 걸상을 자른 단면
  onggi: "#5A3B2A", // 물동이 — 검붉은 질그릇
  onggiLight: "#8A5E42",
  straw: "#B9A472", // 새끼줄 · 이엉
  deadwood: "#6B5A42", // 나뭇짐
  bird: "#3B3B3E", // 솟대 위의 오리
};

/**
 * 평상 — 젊은이들이 모여 앉던 마루. 「여기서 말이 오갔다」의 본체(F-10).
 * 상판을 통판으로 두면 탁자가 되어 버려 널을 한 장씩 깐다 — 틈이 보여야 평상이다.
 */
export function buildPlatformBedPrototypes(count = 3, seed = 5201): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const halfWidth = 0.95 + random() * 0.2; // 높이 1 기준의 비율
    const halfDepth = 0.72 + random() * 0.15;
    const deckHeight = 0.62; // 걸터앉는 높이
    // 굵고 짧은 다리 — 가늘면 평상이 아니라 상이 된다
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = buildBox(0.13, deckHeight, 0.13);
        leg.translate(sx * (halfWidth - 0.12), deckHeight / 2, sz * (halfDepth - 0.12));
        pieces.push(applyColor(leg, SCENE2_STYLE.woodDark));
      }
    // 귀틀 — 널이 얹히는 테
    for (const sz of [-1, 1]) {
      const frame = buildBox(halfWidth * 2, 0.09, 0.1);
      frame.translate(0, deckHeight + 0.045, sz * (halfDepth - 0.05));
      pieces.push(applyColor(frame, SCENE2_STYLE.wood));
    }
    const boardCount = 7;
    for (let k = 0; k < boardCount; k++) {
      const t = (k + 0.5) / boardCount;
      const board = buildBox(halfWidth * 2 - 0.04, 0.055, (halfDepth * 2) / boardCount - 0.035);
      board.translate(
        0,
        deckHeight + 0.118 + (random() - 0.5) * 0.008, // 널마다 아주 살짝 들쭉날쭉
        -halfDepth + halfDepth * 2 * t,
      );
      pieces.push(applyColor(board, random() < 0.35 ? SCENE2_STYLE.wood : SCENE2_STYLE.oldWood));
    }
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

/**
 * 통나무 걸상 — 사람 수를 말해 준다. 걸상이 여럿이면 여럿이 앉은 자리다(F-10).
 * 옆은 껍질, 자른 면은 속살 — 두 색이라야 통나무로 읽힌다.
 */
export function buildStoolPrototypes(count = 4, seed = 5202): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const radius = 0.42 + random() * 0.12;
    const log = buildCylinder(radius, radius * 1.04, 1, 9);
    log.translate(0, 0.5, 0);
    // 반듯하면 사람이 놓은 게 아니라 자란 것처럼 보인다
    log.rotateX((random() - 0.5) * 0.12);
    log.rotateZ((random() - 0.5) * 0.12);
    pieces.push(applyColor(log, SCENE2_STYLE.bark));
    const cut = buildCylinder(radius * 0.99, radius * 0.99, 0.05, 9);
    cut.translate(0, 0.99, 0);
    pieces.push(applyColor(cut, SCENE2_STYLE.heartwood));
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

/**
 * 지게와 나뭇짐 — 젊은이들이 능선에 올라온 이유다. 나무하러 왔다가 무언가를 봤다.
 * 지게는 혼자 못 선다 — 작대기로 받쳐 기대 놓는다.
 */
export function buildAFrameCarrierPrototypes(count = 3, seed = 5203): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const spread = 0.17 + random() * 0.03;
    // 새 둘 — 위로 갈수록 모인다
    for (const s of [-1, 1]) {
      const rail = buildCylinder(0.035, 0.045, 1, 5);
      rail.translate(0, 0.5, 0);
      rail.rotateZ(s * 0.075);
      rail.translate(s * spread, 0, 0);
      pieces.push(applyColor(rail, SCENE2_STYLE.wood));
    }
    // 세장 셋 — 두 새를 가로로 묶는다
    for (const h of [0.28, 0.52, 0.76]) {
      const rung = buildCylinder(0.026, 0.026, spread * 2.1, 5);
      rung.rotateZ(Math.PI / 2);
      rung.translate(0, h, 0.012);
      pieces.push(applyColor(rung, SCENE2_STYLE.woodDark));
    }
    const prop = buildCylinder(0.024, 0.03, 1.02, 5);
    prop.translate(0, 0.51, 0);
    prop.rotateX(-0.33);
    prop.translate(0, 0, 0.2);
    pieces.push(applyColor(prop, SCENE2_STYLE.wood));
    // 짐이 없으면 「나무하러 왔다」가 안 읽힌다
    const stickCount = 9 + Math.floor(random() * 4);
    for (let k = 0; k < stickCount; k++) {
      const length = 0.55 + random() * 0.35;
      const stick = buildCylinder(0.014 + random() * 0.008, 0.01, length, 4);
      stick.rotateZ(Math.PI / 2 + (random() - 0.5) * 0.3);
      stick.rotateY((random() - 0.5) * 0.5);
      stick.translate((random() - 0.5) * 0.12, 0.62 + (random() - 0.5) * 0.3, -0.1 - random() * 0.12);
      pieces.push(applyColor(stick, SCENE2_STYLE.deadwood));
    }
    const rope = buildCylinder(0.017, 0.017, spread * 2.4, 5);
    rope.rotateZ(Math.PI / 2);
    rope.translate(0, 0.6, -0.12);
    pieces.push(applyColor(rope, SCENE2_STYLE.straw));
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

/**
 * 물동이 — 「아비사 = 진부촌 처녀」(F-01)가 자리를 얻는 물건. 지게만 있으면 능선이 남자들만의 자리가 된다.
 * 배가 부르고 아가리가 좁은 옹기. 원통은 통이지 옹기가 아니다.
 */
export function buildWaterJarPrototypes(count = 3, seed = 5204): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const belly = buildBall(0.5, 1);
    belly.scale(1, 0.92, 1);
    belly.translate(0, 0.5, 0);
    pieces.push(applyColor(belly, SCENE2_STYLE.onggi));
    const foot = buildCylinder(0.3, 0.26, 0.09, 9);
    foot.translate(0, 0.045, 0);
    pieces.push(applyColor(foot, SCENE2_STYLE.onggi));
    const neck = buildCylinder(0.24, 0.3, 0.16, 9);
    neck.translate(0, 0.96, 0);
    pieces.push(applyColor(neck, SCENE2_STYLE.onggiLight));
    const lip = buildCylinder(0.27, 0.27, 0.04, 9);
    lip.translate(0, 1.03, 0);
    pieces.push(applyColor(lip, SCENE2_STYLE.onggiLight));
    // 똬리 — 머리에 이는 짚 고리. 하나 걸러 옆에 벗어 둔다.
    if (i % 2 === 0) {
      const pad = buildCylinder(0.26, 0.26, 0.06, 9);
      pad.rotateZ(0.5 + random() * 0.3);
      pad.translate(0.66, 0.05, 0.1);
      pieces.push(applyColor(pad, SCENE2_STYLE.straw));
    }
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

/** 솟대 — 마을 어귀의 장대. 꼭대기 오리는 +Z 를 보고, 어디를 볼지는 자리의 rotation 이 정한다. */
export function buildBirdPolePrototypes(count = 3, seed = 5205): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    // 아주 가늘고 길다. 굵으면 장승이 된다.
    const pole = buildCylinder(0.022, 0.042, 0.9, 6);
    pole.translate(0, 0.45, 0);
    pole.rotateZ((random() - 0.5) * 0.05);
    pieces.push(applyColor(pole, SCENE2_STYLE.wood));
    // 밑동 돌무지 — 장대만 꽂으면 땅에 꽂힌 막대기다
    for (let k = 0; k < 5; k++) {
      const stone = buildBall(0.035 + random() * 0.025, 0);
      const a = (k / 5) * Math.PI * 2 + random();
      stone.translate(Math.cos(a) * 0.07, 0.025, Math.sin(a) * 0.07);
      pieces.push(applyColor(stone, SCENE2_STYLE.woodDark));
    }
    const body = buildBall(0.075, 0);
    body.scale(0.75, 0.62, 1.5);
    body.translate(0, 0.94, -0.02);
    pieces.push(applyColor(body, SCENE2_STYLE.bird));
    const neck = buildCylinder(0.018, 0.022, 0.075, 5);
    neck.translate(0, 0.975, 0.055);
    pieces.push(applyColor(neck, SCENE2_STYLE.bird));
    const head = buildBall(0.038, 0);
    head.translate(0, 1.01, 0.062);
    pieces.push(applyColor(head, SCENE2_STYLE.bird));
    const beak = buildCylinder(0.009, 0.017, 0.07, 4);
    beak.rotateX(Math.PI / 2);
    beak.translate(0, 1.005, 0.115);
    pieces.push(applyColor(beak, SCENE2_STYLE.straw));
    // 꽁지가 없으면 앞뒤가 안 갈려 어디를 보는지 모른다
    const tail = buildBox(0.05, 0.016, 0.085);
    tail.rotateX(-0.3);
    tail.translate(0, 0.955, -0.105);
    pieces.push(applyColor(tail, SCENE2_STYLE.bird));
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

type Scene2PropKey = "platformBed" | "stool" | "aFrameCarrier" | "waterJar" | "birdPole";

export const SCENE2_NOTES: Record<Scene2PropKey, SceneNote> = {
  platformBed: { text: "평상 · 젊은이들이 모여 말이 오간 자리 (F-10)", color: "#CFE3B8" },
  stool: { text: "통나무 걸상 · 여럿이 둘러앉았다는 표시", color: "#CFE3B8" },
  aFrameCarrier: { text: "지게·나뭇짐 · 능선에 올라온 이유 (F-10)", color: "#CFE3B8" },
  waterJar: { text: "물동이 · 아비사가 여기 있었다 (F-01)", color: "#F2C89A" },
  birdPole: { text: "솟대 · 나란히 선 둘이 서로 다른 쪽을 본다 = 엇갈리는 증언", color: "#B9E0C8" },
};

// 자리는 팀이 편집기로 다시 짠 Z4 를 구운 값(소수 둘째 자리, 편집본과 차이 최대 0.5 cm).
// 능선 한 무리(x 71.7~74.5, 진부촌 문 바로 앞)와 Z1 나루터 낱개 — 강가와 능선의 말이 다른 게 이 씬의 뼈대다.
export function computeScene2Spots({ heightAt }: SceneSpotOptions): Record<Scene2PropKey, Spot[]> {
  return {
    platformBed: placeOnGround(heightAt, [
      { x: 74.03, z: 16.65, size: 0.53, widthRatio: 3.3, depthRatio: 2.5, rotation: 4.61 },
    ]),

    // 한 줄로 앉아 같은 쪽을 본다 — 다들 무언가를 보고 있었다
    stool: placeOnGround(heightAt, [
      { x: 71.94, z: 16.37, size: 0.44, shapeIndex: 0, rotation: 0.3 },
      { x: 71.82, z: 18.07, size: 0.41, shapeIndex: 1, rotation: 1.7 },
      { x: 71.76, z: 17.15, size: 0.46, shapeIndex: 2, rotation: 2.9 },
      { x: 72.01, z: 15.43, size: 0.4, shapeIndex: 3, rotation: 4.4 },
      { x: 71.67, z: 19.93, size: 0.45, shapeIndex: 1, rotation: 5.6 },
    ]),

    // 길이 올라오는 쪽에 짐을 내려놓는다. 둘이라야 「둘이 함께 올라왔다」 — 증언자가 여럿이다.
    aFrameCarrier: placeOnGround(heightAt, [
      { x: 72.02, z: 22.12, size: 1.35, shapeIndex: 0, rotation: 2.1 },
      { x: 73.36, z: 22.73, size: 1.28, shapeIndex: 1, rotation: 3.3 },
    ]),

    waterJar: placeOnGround(heightAt, [
      { x: 74.08, z: 19.86, size: 0.52, shapeIndex: 0, rotation: 0.9 },
      { x: 10.9, z: 32.4, size: 0.5, shapeIndex: 1, rotation: 2.4 },
    ]),

    // 회전이 이 장치의 전부다 — 강(서남) · 절벽 위(서북) · 능선(동, 나루터에 선 것).
    // 나란히 선 둘이 서로 다른 데를 보는 것이 멀리 떨어진 둘보다 훨씬 잘 읽힌다.
    birdPole: placeOnGround(heightAt, [
      { x: 74.51, z: 20.89, size: 3.2, shapeIndex: 0, rotation: -1.01 },
      { x: 74.38, z: 22.21, size: 3.0, shapeIndex: 1, rotation: -1.75 },
      { x: 10.2, z: 31.2, size: 3.1, shapeIndex: 2, rotation: 1.9 },
    ]),
  };
}
