/**
 * 아랑사의 함 — 옻칠한 나무 함. 모서리마다 청동 감잡이, 앞에 청동 앞바탕과 고리,
 * 뚜껑에서 내려온 걸쇠가 고리에 걸리고 그 고리에 가로 자물통(빗장을 꿰어 잠그는 자물쇠)이 채워져 있다.
 * 자물통 오른쪽 끝 구멍에 청동 열쇠를 꽂아 돌리면 빗장이 빠지고 뚜껑이 열린다.
 * 단위는 미터, 밑면 가운데가 원점, 앞은 +z. 꼭짓점 색.
 */
import * as THREE from "three";

import { mergeParts, paintGeometry, paintedBox } from "./vertexPaint";

const WOOD = "#3E2618";
const WOOD_LIGHT = "#5A3824";
const BRONZE = "#A87B3A";
const BRONZE_DARK = "#6E5024";
const HOLE = "#120C08";

/** 함 몸통 크기 · 판 두께 · 속 바닥 높이 — 속이 비어 있어 뚜껑을 열면 바닥에 둔 것이 보인다 */
export const BOX = { width: 0.3, height: 0.15, depth: 0.2, wall: 0.012, floor: 0.012 };
/** 뚜껑 두께 · 경첩(뒤 윗모서리) 자리 */
export const LID = { thickness: 0.045, hingeY: BOX.height, hingeZ: -BOX.depth / 2 };
/** 자물통 가운데(함 기준) — 앞바탕 고리에 꿰인다 */
export const LOCK_AT = new THREE.Vector3(0, BOX.height - 0.035, BOX.depth / 2 + 0.03);
/** 자물통 길이 — 열쇠 구멍은 +x 끝 */
export const LOCK_LENGTH = 0.085;

/** 몸통 — 바닥 판과 벽 넷으로 속을 비운다. 판자 결이 보이게 띠 둘, 모서리 감잡이 넷, 앞바탕과 고리 */
export function buildBoxBase() {
  const { width, height, depth, wall, floor } = BOX;
  const parts = [paintedBox(width, floor, depth, 0, floor / 2, 0, WOOD)];
  for (const sz of [-1, 1]) parts.push(paintedBox(width, height, wall, 0, height / 2, sz * (depth - wall) * 0.5, WOOD));
  for (const sx of [-1, 1]) parts.push(paintedBox(wall, height, depth, sx * (width - wall) * 0.5, height / 2, 0, WOOD));
  // 속 바닥 — 옻칠이 닳은 어두운 안쪽
  parts.push(paintedBox(width - wall * 2, 0.001, depth - wall * 2, 0, floor + 0.0005, 0, "#160D07"));
  // 판자 이음 띠 — 네 벽 바깥에만 두른다(통판이면 속을 덮어 함 속이 막힌다)
  const band = 0.004;
  for (const y of [0.05, 0.1]) {
    for (const sz of [-1, 1])
      parts.push(paintedBox(width + band, band, band, 0, y, sz * (depth + band) * 0.5, WOOD_LIGHT));
    for (const sx of [-1, 1])
      parts.push(paintedBox(band, band, depth + band, sx * (width + band) * 0.5, y, 0, WOOD_LIGHT));
  }
  // 모서리 감잡이(ㄱ자 청동판)
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      parts.push(
        paintedBox(
          0.035,
          height * 0.9,
          0.006,
          sx * (width / 2 - 0.0175),
          height * 0.47,
          sz * (depth / 2 + 0.003),
          BRONZE,
        ),
      );
      parts.push(
        paintedBox(
          0.006,
          height * 0.9,
          0.035,
          sx * (width / 2 + 0.003),
          height * 0.47,
          sz * (depth / 2 - 0.0175),
          BRONZE,
        ),
      );
    }
  // 앞바탕 — 둥근 머리 판
  const plate = new THREE.CylinderGeometry(0.035, 0.035, 0.006, 16, 1);
  plate.rotateX(Math.PI / 2);
  plate.scale(1, 1.15, 1);
  plate.translate(0, height - 0.04, depth / 2 + 0.004);
  parts.push(paintGeometry(plate, BRONZE));
  // 고리(배목) — 앞바탕에서 앞으로 나온 둥근 고리
  const staple = new THREE.TorusGeometry(0.012, 0.003, 6, 12);
  staple.translate(0, LOCK_AT.y, depth / 2 + 0.018);
  parts.push(paintGeometry(staple, BRONZE_DARK));
  // 받침 발
  for (const sx of [-1, 1])
    parts.push(paintedBox(0.03, 0.012, depth * 0.9, sx * (width / 2 - 0.03), 0.006, 0, WOOD_LIGHT));
  return mergeParts(parts);
}

/** 뚜껑 — 경첩이 원점(뒤 아랫모서리), 앞쪽으로 뻗는다. 앞에서 걸쇠가 내려와 고리에 걸린다 */
export function buildBoxLid() {
  const { width, depth } = BOX;
  const thickness = LID.thickness;
  const parts = [paintedBox(width + 0.012, thickness, depth + 0.012, 0, thickness / 2, depth / 2, WOOD)];
  // 뚜껑 위 청동 띠와 가운데 원판
  parts.push(paintedBox(width + 0.014, 0.004, 0.03, 0, thickness + 0.002, depth / 2, BRONZE));
  const knob = new THREE.CylinderGeometry(0.022, 0.022, 0.006, 14);
  knob.translate(0, thickness + 0.004, depth / 2);
  parts.push(paintGeometry(knob, BRONZE));
  // 걸쇠 — 앞 가운데에서 내려온 청동 혀
  parts.push(paintedBox(0.018, 0.05, 0.004, 0, -0.012, depth + 0.01, BRONZE));
  return mergeParts(parts);
}

/** 가로 자물통 — 원통 몸 + 위로 걸친 빗장. 가운데가 원점, 길이는 x 축, 열쇠 구멍은 +x 끝 */
export function buildPadlock() {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.CylinderGeometry(0.014, 0.014, LOCK_LENGTH, 12);
  body.rotateZ(Math.PI / 2);
  parts.push(paintGeometry(body, BRONZE));
  for (const sx of [-1, 1]) {
    const ring = new THREE.TorusGeometry(0.0145, 0.0025, 4, 12);
    ring.rotateY(Math.PI / 2);
    ring.translate(sx * (LOCK_LENGTH / 2 - 0.006), 0, 0);
    parts.push(paintGeometry(ring, BRONZE_DARK));
  }
  // 빗장 — 몸통 위로 ㄷ 자로 걸친다
  parts.push(paintedBox(LOCK_LENGTH * 0.8, 0.005, 0.005, 0, 0.026, 0, BRONZE_DARK));
  parts.push(paintedBox(0.005, 0.013, 0.005, -LOCK_LENGTH * 0.38, 0.019, 0, BRONZE_DARK));
  // 열쇠 구멍
  const hole = new THREE.CylinderGeometry(0.004, 0.004, 0.002, 8);
  hole.rotateZ(Math.PI / 2);
  hole.translate(LOCK_LENGTH / 2 + 0.001, 0, 0);
  parts.push(paintGeometry(hole, HOLE));
  return mergeParts(parts);
}

/** 소지품·손에 든 모양 — 닫힌 함 그대로(자물통까지) */
export function buildClosedBox() {
  const lid = buildBoxLid().translate(0, LID.hingeY, LID.hingeZ);
  const lock = buildPadlock().translate(LOCK_AT.x, LOCK_AT.y, LOCK_AT.z);
  return mergeParts([buildBoxBase(), lid, lock]);
}

/** 청동 열쇠 — 둥근 고리 손잡이 · 긴 대 · 끝의 납작한 날. 대는 +x 로 뻗고 고리가 원점 쪽. 바닥이 원점(눕혀 둔 자세) */
export function buildBronzeKey() {
  const parts: THREE.BufferGeometry[] = [];
  const bow = new THREE.TorusGeometry(0.02, 0.005, 6, 16);
  bow.rotateX(Math.PI / 2);
  bow.translate(-0.02, 0, 0);
  parts.push(paintGeometry(bow, BRONZE));
  const shaft = new THREE.CylinderGeometry(0.004, 0.004, 0.1, 8);
  shaft.rotateZ(Math.PI / 2);
  shaft.translate(0.05, 0, 0);
  parts.push(paintGeometry(shaft, BRONZE));
  // 날 — 끝에서 옆으로 꺾인 납작한 판
  parts.push(paintedBox(0.016, 0.003, 0.018, 0.092, 0, 0.009, BRONZE));
  parts.push(paintedBox(0.004, 0.003, 0.006, 0.086, 0, 0.02, BRONZE));
  return mergeParts(parts).translate(0, 0.006, 0);
}
