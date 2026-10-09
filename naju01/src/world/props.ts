// 여기저기 갖다 쓸 물건(횃불·장승·비석·무덤·명패)의 표본.
// 배치할 때마다 새로 만들면 곳마다 모양이 다르고 편집으로 옮긴 뒤 무엇이었는지 되짚을 수 없다 —
// 몇 벌 미리 만들어 인스턴스로 돌려쓴다. 비율만 다루고(높이 1 · 밑동 원점) 실치수는 자리의 키가 정한다.

import * as THREE from "three";

import { createRandom } from "@/engine/random";

import { buildBall, buildBox, buildCylinder, mergePieces, prepareForMerge } from "../story/pieceGeometry";
import { applyVertexColors } from "../terrain/ground";

/** 횃불 — 기둥 + 감은 천 + 불꽃. 불꽃은 밝은 색이라 밤이 아니어도 빛나는 것으로 읽힌다. */
export function buildTorchPrototypes(count = 3, seed = 3302): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const wood = new THREE.Color("#5A4A38").offsetHSL(0, 0, (random() - 0.5) * 0.12);
    const cloth = new THREE.Color("#8A7550");
    const pole = buildCylinder(0.035, 0.05, 1.55, 6);
    pole.translate(0, 0.78, 0);
    pieces.push(applyVertexColors(pole, wood));
    const wrap = buildCylinder(0.085, 0.075, 0.26, 6);
    wrap.translate(0, 1.62, 0);
    pieces.push(applyVertexColors(wrap, cloth));
    // 불꽃 — 겹친 뿔 셋
    const flameColors = [new THREE.Color("#FFD166"), new THREE.Color("#FF9E3D"), new THREE.Color("#FFF0C2")];
    for (let k = 0; k < 3; k++) {
      const h = 0.34 - k * 0.08;
      const cone = prepareForMerge(new THREE.ConeGeometry(0.09 - k * 0.02, h, 5));
      cone.rotateY(random() * Math.PI);
      cone.translate((random() - 0.5) * 0.03, 1.78 + k * 0.05 + h / 2, (random() - 0.5) * 0.03);
      pieces.push(applyVertexColors(cone, flameColors[k]));
    }
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

/** 장승 — 얼굴이 실루엣의 전부다. 눈두덩·코·벌린 입·관만 있으면 장승으로 읽힌다. */
export function buildGuardianPostPrototypes(count = 3, seed = 3303): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const bodyColor = new THREE.Color("#6B5942").offsetHSL(0, 0, (random() - 0.5) * 0.1);
    const dark = new THREE.Color("#3A2F22");
    const body = buildCylinder(0.16, 0.2, 2.1, 7);
    body.translate(0, 1.05, 0);
    pieces.push(applyVertexColors(body, bodyColor));
    const crown = buildCylinder(0.1, 0.19, 0.3, 7);
    crown.translate(0, 2.22, 0);
    pieces.push(applyVertexColors(crown, bodyColor));
    for (const side of [-1, 1]) {
      const brow = buildBox(0.11, 0.07, 0.06);
      brow.translate(side * 0.075, 1.72, 0.17);
      pieces.push(applyVertexColors(brow, dark));
    }
    const nose = buildBox(0.08, 0.34, 0.1);
    nose.translate(0, 1.55, 0.19);
    pieces.push(applyVertexColors(nose, bodyColor));
    const mouth = buildBox(0.24, 0.09, 0.06);
    mouth.translate(0, 1.3, 0.18);
    pieces.push(applyVertexColors(mouth, dark));
    // 입 안의 흰 이 둘이 장승의 인상을 만든다
    for (const side of [-1, 1]) {
      const tooth = buildBox(0.05, 0.05, 0.04);
      tooth.translate(side * 0.06, 1.31, 0.2);
      pieces.push(applyVertexColors(tooth, new THREE.Color("#D8CFBC")));
    }
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

/** 비석 — 받침돌 + 몸돌 + 지붕돌. 몸돌만 세우면 그냥 판때기다. */
export function buildStelePrototypes(count = 3, seed = 3304): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const stone = new THREE.Color("#9A968C").offsetHSL(0, 0, (random() - 0.5) * 0.12);
    const dark = new THREE.Color("#6E6A61");
    const base = buildBox(0.62, 0.16, 0.44);
    base.translate(0, 0.08, 0);
    pieces.push(applyVertexColors(base, dark));
    const body = buildBox(0.4, 1.25, 0.16);
    body.translate(0, 0.16 + 0.63, 0);
    pieces.push(applyVertexColors(body, stone));
    const roof = buildBox(0.56, 0.13, 0.3);
    roof.rotateZ((random() - 0.5) * 0.03);
    roof.translate(0, 1.48, 0);
    pieces.push(applyVertexColors(roof, dark));
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

/** 무덤 — 봉분 + 상돌. 봉분만 있으면 그냥 언덕이다. */
export function buildGravePrototypes(count = 3, seed = 3305): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const grass = new THREE.Color("#67704B").offsetHSL(0, 0, (random() - 0.5) * 0.08);
    const stone = new THREE.Color("#9A968C");
    // 봉분은 납작하다(폭이 높이의 세 배쯤). 공에 가까우면 거대한 초록 구슬로 보인다.
    const mound = buildBall(1, 1);
    mound.scale(1.55, 0.5, 1.4);
    pieces.push(applyVertexColors(mound, grass));
    const altar = buildBox(0.55, 0.1, 0.34);
    altar.translate(0, 0.02, 1.62);
    pieces.push(applyVertexColors(altar, stone));
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

/** 마을 명패 — 기둥 둘 + 가로판. 어귀에서 「여기부터 진부촌」을 말한다. */
export function buildVillageSignPrototypes(count = 2, seed = 3306): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const wood = new THREE.Color("#6A5947").offsetHSL(0, 0, (random() - 0.5) * 0.1);
    const board = new THREE.Color("#8B7A5E");
    for (const side of [-1, 1]) {
      const post = buildCylinder(0.05, 0.06, 2.0, 5);
      post.translate(side * 0.62, 1.0, 0);
      pieces.push(applyVertexColors(post, wood));
    }
    const plate = buildBox(1.55, 0.42, 0.07);
    plate.translate(0, 1.72, 0);
    pieces.push(applyVertexColors(plate, board));
    const rim = buildBox(1.62, 0.06, 0.09);
    rim.translate(0, 1.96, 0);
    pieces.push(applyVertexColors(rim, wood));
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}
