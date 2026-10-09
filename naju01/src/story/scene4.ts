// Scene 04 「지워진 기억」이 요구하는 것들. 씬1~3 과 같은 원칙(유형 수준까지만).
// 조사점이 둘뿐이고 Z 가 같다 — (18, 42.5) Z1 나루터 물가 · (54, 42.5) Z2 자갈밭 물가.
// 「둘을 견주라」다. 그래서 두 자리에 똑같은 흔적을 놓는다 — 기억이 한 벌 더 찍혀 있다.
// 사람이 두 번 한 일은 절대 똑같지 않다. 똑같다는 것 자체가 단서다. 어느 쪽이 진짜인지는 정하지 않는다.
// 물건이 아니라 자국만 놓는다(배 한 척을 더 놓으면 그냥 배가 둘인 맵이다).
// 인스턴스로는 땅을 못 파므로 밀려난 두둑을 세워 패인 것으로 읽히게 한다.
// 색은 표본에 진짜로 굽는다. 단위는 도면 m, 표본은 높이 1.

import type * as THREE from "three";

import { createRandom } from "@/engine/random";

import type { Spot } from "../placement/instanceGroups";
import {
  applyColor,
  buildBox,
  buildCylinder,
  buildRing,
  mergePieces,
  placeOnGround,
  type SceneNote,
  type SceneSpotOptions,
} from "./pieceGeometry";

const SCENE4_STYLE = {
  wetSoil: "#5E5445", // 물가의 젖은 바닥 — 마른 데보다 어둡다
  pushedSoil: "#8D8168", // 끌리며 양옆으로 밀려난 두둑 — 속이 드러나 밝다
  smoothed: "#6E6553", // 배 밑이 쓸고 간 가운데
  stake: "#6B5942",
  stakeDark: "#3E3327",
  rope: "#A89A74",
  frayed: "#C7BC9A", // 끊어진 자리의 풀린 올 — 밝다
};

/**
 * 배를 물에서 뭍으로 끌어올린 자국. +Z 가 물 쪽이고 뭍 쪽(−Z)에서 끝난다.
 * 가운데 반질한 띠 + 앞으로 갈수록 두꺼워지는 두둑 둘. 길이 대 높이 비가 50 : 1 은 넘어야 연석이 아니라 자국이다.
 */
export function buildBoatMarkPrototypes(count = 3, seed = 7401): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const length = 7.0 + random() * 1.6; // 높이 1 기준 → 비 약 58 : 1
    const width = 0.62 + random() * 0.12;
    const segments = 11;
    for (let k = 0; k < segments; k++) {
      const t = (k + 0.5) / segments; // 0 = 물 쪽, 1 = 뭍 쪽
      const z = (0.5 - t) * length;
      const middle = buildBox(width, 0.03, length / segments - 0.02);
      middle.rotateY((random() - 0.5) * 0.05);
      middle.translate((random() - 0.5) * 0.06, 0.015, z);
      pieces.push(applyColor(middle, SCENE4_STYLE.smoothed));
      for (const s of [-1, 1]) {
        const thickness = 0.05 + t * 0.06 + random() * 0.02;
        const ridge = buildBox(0.22 + t * 0.12, thickness, length / segments - 0.02);
        ridge.rotateZ(s * 0.25);
        ridge.rotateY((random() - 0.5) * 0.08);
        ridge.translate(s * (width / 2 + 0.12), thickness * 0.45, z);
        pieces.push(applyColor(ridge, random() < 0.35 ? SCENE4_STYLE.wetSoil : SCENE4_STYLE.pushedSoil));
      }
    }
    // 배 고물이 멈춘 자리 — 흙이 한 번 더 쌓인다
    const end = buildBox(width + 0.5, 0.09, 0.32);
    end.translate(0, 0.045, -0.5 * length - 0.1);
    pieces.push(applyColor(end, SCENE4_STYLE.pushedSoil));
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

/** 배를 매던 말뚝. 풀린 밧줄이면 「배가 떠났다」, 끊어진 밧줄은 「뭔가 잘못됐다」다. */
export function buildStakePrototypes(count = 3, seed = 7402): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const post = buildCylinder(0.085, 0.11, 1, 7);
    post.translate(0, 0.5, 0);
    post.rotateZ((random() - 0.5) * 0.22); // 물에 밀려 기울었다
    pieces.push(applyColor(post, SCENE4_STYLE.stake));
    // 쳐서 박은 머리라 뭉개져 있다
    const head = buildCylinder(0.13, 0.1, 0.11, 7);
    head.translate(0, 0.99, 0);
    pieces.push(applyColor(head, SCENE4_STYLE.stakeDark));
    for (let k = 0; k < 3; k++) {
      const coil = buildRing(0.125, 0.028);
      coil.rotateX(Math.PI / 2 + (random() - 0.5) * 0.12);
      coil.translate(0, 0.62 + k * 0.075, 0);
      pieces.push(applyColor(coil, SCENE4_STYLE.rope));
    }
    // 늘어진 끝 — 땅으로 흘러내린다
    let x = 0.12;
    let z = 0.02;
    let y = 0.6;
    for (let k = 0; k < 5; k++) {
      const length = 0.24 + random() * 0.1;
      const strand = buildCylinder(0.026, 0.024, length, 4);
      const slope = 0.5 + k * 0.22;
      strand.rotateX(Math.PI / 2);
      strand.rotateZ(-slope);
      strand.rotateY(0.6 + (random() - 0.5) * 0.5);
      strand.translate(x, y, z);
      pieces.push(applyColor(strand, SCENE4_STYLE.rope));
      x += Math.cos(slope) * length * 0.8;
      z += 0.05;
      y -= Math.sin(slope) * length * 0.8;
      if (y < 0.05) y = 0.05;
    }
    // 풀린 올 — 이 한 조각이 「풀렸다」와 「끊겼다」를 가른다
    for (let k = 0; k < 4; k++) {
      const fiber = buildCylinder(0.009, 0.005, 0.13 + random() * 0.07, 3);
      fiber.rotateZ(Math.PI / 2 - (random() - 0.5) * 0.9);
      fiber.rotateY(random() * 6.3);
      fiber.translate(x + 0.06, y + 0.02, z);
      pieces.push(applyColor(fiber, SCENE4_STYLE.frayed));
    }
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

/**
 * 물가로 걸어간 발자국 한 줄 — 한 인스턴스가 한 줄 전체다. 하나씩 두면 편집기에서 「한 사람이 걸어간 줄」이 부서진다.
 * 땅을 못 파므로 테두리만 도드라진 얕은 테로. 줄은 물까지 안 간다 — 돌아 나온 자국이 없는 것이 요점이다.
 */
export function buildFootprintPrototypes(count = 3, seed = 7403): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const steps = 7;
    const stride = 0.62;
    const gap = 0.13; // 좌우 발 사이
    for (let k = 0; k < steps; k++) {
      const s = k % 2 ? 1 : -1;
      const z = (k - (steps - 1) / 2) * stride;
      const x = s * gap + (random() - 0.5) * 0.06;
      const angle = (random() - 0.5) * 0.3;
      // 앞이 좁고 뒤가 둥근 타원 테를 여섯 도막으로. 발 길이 0.25 m 쯤에 맞춘 반지름이다.
      for (let j = 0; j < 6; j++) {
        const u = (j / 6) * Math.PI * 2;
        const rx = 0.075;
        const rz = 0.155;
        const piece = buildBox(0.07, 0.045 + random() * 0.02, 0.12);
        piece.rotateY(u + angle);
        piece.translate(
          x + Math.sin(u) * rx * Math.cos(angle) + Math.cos(u) * rz * Math.sin(angle),
          0.022,
          z + Math.cos(u) * rz * Math.cos(angle) - Math.sin(u) * rx * Math.sin(angle),
        );
        pieces.push(applyColor(piece, SCENE4_STYLE.pushedSoil));
      }
      // 테 안쪽 — 젖어 있어 둘레보다 어둡다
      const inner = buildBox(0.12, 0.02, 0.24);
      inner.rotateY(angle);
      inner.translate(x, 0.01, z);
      pieces.push(applyColor(inner, SCENE4_STYLE.wetSoil));
    }
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

type Scene4PropKey = "boatMark" | "stake" | "footprint";

export const SCENE4_NOTES: Record<Scene4PropKey, SceneNote> = {
  boatMark: { text: "배를 끌어올린 자국 · 배는 없다", color: "#B9E0C8" },
  stake: { text: "말뚝과 끊어진 밧줄 · 풀린 게 아니라 끊겼다", color: "#F2C89A" },
  footprint: { text: "물가로 간 발자국 · 돌아 나온 자국이 없다", color: "#CFE3B8" },
};

// 두 자리는 일부러 같은 값이다(size·shapeIndex·서로 간 거리). 흔들고 싶은 손이 가도 그러면 장치가 죽는다.
// 회전만 다르다 — 두 물가 선 방향이 달라 회전까지 같으면 한쪽 자국이 물가를 비스듬히 가로질러 도리어 안 닮아 보인다.
function traceSet(cx: number, cz: number, rotation: number, shapeIndex: number) {
  return {
    // size 는 높이만 정한다. 넓고 긴 것은 폭비·깊이비로 따로 늘린다(높이 0.085 · 가로 1.3 · 길이 4.8 m).
    boatMark: { x: cx, z: cz, size: 0.085, widthRatio: 2.4, depthRatio: 1.5, shapeIndex, rotation },
    // 자국의 뭍 쪽 끝에서 1.2 m — 배를 매던 자리
    stake: {
      x: cx - Math.sin(rotation) * 1.2,
      z: cz - Math.cos(rotation) * 1.2,
      size: 0.95,
      shapeIndex,
      rotation: rotation + 0.4,
    },
    // 자국 옆 1.6 m 를 나란히 간다. 겹치면 둘 다 안 읽힌다.
    footprint: {
      x: cx + Math.cos(rotation) * 1.6,
      z: cz - Math.sin(rotation) * 1.6,
      size: 0.05,
      shapeIndex,
      rotation,
    },
  };
}

export function computeScene4Spots({ heightAt }: SceneSpotOptions): Record<Scene4PropKey, Spot[]> {
  // 도면의 물가 선 기울기에서 잡은 방향. Z1 쪽은 X 축과 거의 나란하고 Z2 쪽은 절벽 따라 조금 돈다.
  const landing = traceSet(18, 42.5, 0.06, 0);
  const gravel = traceSet(54, 42.5, -0.42, 0);

  return {
    boatMark: placeOnGround(heightAt, [landing.boatMark, gravel.boatMark]),
    stake: placeOnGround(heightAt, [landing.stake, gravel.stake]),
    footprint: placeOnGround(heightAt, [landing.footprint, gravel.footprint]),
  };
}
