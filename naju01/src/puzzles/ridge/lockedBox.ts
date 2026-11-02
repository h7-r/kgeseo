/**
 * 아랑사의 함 — 삼국 무렵 어촌에 어울리는 옻칠한 나무 함. 모서리마다 청동 감잡이, 앞에 청동 앞바탕과 고리,
 * 뚜껑에서 내려온 걸쇠가 고리에 걸리고 그 고리에 가로 자물통(빗장을 꿰어 잠그는 옛 자물쇠)이 채워져 있다.
 * 자물통 오른쪽 끝 구멍에 청동 열쇠를 꽂아 돌리면 빗장이 빠지고 뚜껑이 열린다.
 * 단위는 미터, 밑면 가운데가 원점, 앞은 +z. 꼭짓점 색.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const WOOD = "#3E2618";
const WOOD_LIGHT = "#5A3824";
const BRONZE = "#A87B3A";
const BRONZE_DARK = "#6E5024";
const HOLE = "#120C08";

/** 함 몸통 크기 */
export const BOX = { width: 0.3, height: 0.15, depth: 0.2 };
/** 뚜껑 두께 · 경첩(뒤 윗모서리) 자리 */
export const LID = { thickness: 0.045, hingeY: BOX.height, hingeZ: -BOX.depth / 2 };
/** 자물통 가운데(함 기준) — 앞바탕 고리에 꿰인다 */
export const LOCK_AT = new THREE.Vector3(0, BOX.height - 0.035, BOX.depth / 2 + 0.03);
/** 자물통 길이 — 열쇠 구멍은 +x 끝 */
export const LOCK_LENGTH = 0.085;

function paint(geometry: THREE.BufferGeometry, color: string) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.deleteAttribute("uv");
  if (!flat.attributes.normal) flat.computeVertexNormals();
  const c = new THREE.Color(color);
  const colors = new Float32Array(flat.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return flat;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: string) =>
  paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts, false)!;

/** 몸통 — 판자 결이 보이게 띠 둘, 모서리 감잡이 넷, 앞바탕과 고리 */
export function buildBoxBase() {
  const { width: w, height: h, depth: d } = BOX;
  const parts = [box(w, h, d, 0, h / 2, 0, WOOD)];
  // 속 — 뚜껑을 열면 보이는 어두운 안쪽(판 두께만 남기고 비어 보이게)
  parts.push(box(w - 0.024, 0.002, d - 0.024, 0, h + 0.001, 0, "#160D07"));
  // 판자 이음 띠
  for (const y of [0.05, 0.1]) parts.push(box(w + 0.002, 0.004, d + 0.002, 0, y, 0, WOOD_LIGHT));
  // 모서리 감잡이(ㄱ자 청동판)
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      parts.push(box(0.035, h * 0.9, 0.006, sx * (w / 2 - 0.0175), h * 0.47, sz * (d / 2 + 0.003), BRONZE));
      parts.push(box(0.006, h * 0.9, 0.035, sx * (w / 2 + 0.003), h * 0.47, sz * (d / 2 - 0.0175), BRONZE));
    }
  // 앞바탕 — 둥근 머리 판
  const plate = new THREE.CylinderGeometry(0.035, 0.035, 0.006, 16, 1);
  plate.rotateX(Math.PI / 2);
  plate.scale(1, 1.15, 1);
  plate.translate(0, h - 0.04, d / 2 + 0.004);
  parts.push(paint(plate, BRONZE));
  // 고리(배목) — 앞바탕에서 앞으로 나온 둥근 고리
  const staple = new THREE.TorusGeometry(0.012, 0.003, 6, 12);
  staple.translate(0, LOCK_AT.y, d / 2 + 0.018);
  parts.push(paint(staple, BRONZE_DARK));
  // 받침 발
  for (const sx of [-1, 1]) parts.push(box(0.03, 0.012, d * 0.9, sx * (w / 2 - 0.03), 0.006, 0, WOOD_LIGHT));
  return merge(parts);
}

/** 뚜껑 — 경첩이 원점(뒤 아랫모서리), 앞쪽으로 뻗는다. 앞에서 걸쇠가 내려와 고리에 걸린다 */
export function buildBoxLid() {
  const { width: w, depth: d } = BOX;
  const t = LID.thickness;
  const parts = [box(w + 0.012, t, d + 0.012, 0, t / 2, d / 2, WOOD)];
  // 뚜껑 위 청동 띠와 가운데 원판
  parts.push(box(w + 0.014, 0.004, 0.03, 0, t + 0.002, d / 2, BRONZE));
  const knob = new THREE.CylinderGeometry(0.022, 0.022, 0.006, 14);
  knob.translate(0, t + 0.004, d / 2);
  parts.push(paint(knob, BRONZE));
  // 걸쇠 — 앞 가운데에서 내려온 청동 혀
  parts.push(box(0.018, 0.05, 0.004, 0, -0.012, d + 0.01, BRONZE));
  return merge(parts);
}

/** 가로 자물통 — 원통 몸 + 위로 걸친 빗장. 가운데가 원점, 길이는 x 축, 열쇠 구멍은 +x 끝 */
export function buildPadlock() {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.CylinderGeometry(0.014, 0.014, LOCK_LENGTH, 12);
  body.rotateZ(Math.PI / 2);
  parts.push(paint(body, BRONZE));
  for (const sx of [-1, 1]) {
    const ring = new THREE.TorusGeometry(0.0145, 0.0025, 4, 12);
    ring.rotateY(Math.PI / 2);
    ring.translate(sx * (LOCK_LENGTH / 2 - 0.006), 0, 0);
    parts.push(paint(ring, BRONZE_DARK));
  }
  // 빗장 — 몸통 위로 ㄷ 자로 걸친다
  parts.push(box(LOCK_LENGTH * 0.8, 0.005, 0.005, 0, 0.026, 0, BRONZE_DARK));
  parts.push(box(0.005, 0.013, 0.005, -LOCK_LENGTH * 0.38, 0.019, 0, BRONZE_DARK));
  // 열쇠 구멍
  const hole = new THREE.CylinderGeometry(0.004, 0.004, 0.002, 8);
  hole.rotateZ(Math.PI / 2);
  hole.translate(LOCK_LENGTH / 2 + 0.001, 0, 0);
  parts.push(paint(hole, HOLE));
  return merge(parts);
}

/** 접힌 편지 한 장 — 뚜껑이 열리면 보인다 */
export function buildLetter() {
  const letter = paint(new THREE.BoxGeometry(0.17, 0.008, 0.11).translate(0, BOX.height + 0.006, 0), "#E9E1CC");
  // 접힌 자국 · 끈
  const fold = paint(new THREE.BoxGeometry(0.172, 0.009, 0.003).translate(0, BOX.height + 0.006, 0), "#C9BFA4");
  const tie = paint(new THREE.BoxGeometry(0.012, 0.01, 0.112).translate(0.03, BOX.height + 0.007, 0), "#8E2F2A");
  return merge([letter, fold, tie]);
}

/** 소지품·손에 든 모양 — 닫힌 함 그대로(자물통까지) */
export function buildClosedBox() {
  const lid = buildBoxLid().translate(0, LID.hingeY, LID.hingeZ);
  const lock = buildPadlock().translate(LOCK_AT.x, LOCK_AT.y, LOCK_AT.z);
  return merge([buildBoxBase(), lid, lock]);
}

/** 청동 열쇠 — 둥근 고리 손잡이 · 긴 대 · 끝의 납작한 날. 대는 +x 로 뻗고 고리가 원점 쪽. 바닥이 원점(눕혀 둔 자세) */
export function buildBronzeKey() {
  const parts: THREE.BufferGeometry[] = [];
  const bow = new THREE.TorusGeometry(0.02, 0.005, 6, 16);
  bow.rotateX(Math.PI / 2);
  bow.translate(-0.02, 0, 0);
  parts.push(paint(bow, BRONZE));
  const shaft = new THREE.CylinderGeometry(0.004, 0.004, 0.1, 8);
  shaft.rotateZ(Math.PI / 2);
  shaft.translate(0.05, 0, 0);
  parts.push(paint(shaft, BRONZE));
  // 날 — 끝에서 옆으로 꺾인 납작한 판
  parts.push(box(0.016, 0.003, 0.018, 0.092, 0, 0.009, BRONZE));
  parts.push(box(0.004, 0.003, 0.006, 0.086, 0, 0.02, BRONZE));
  return merge(parts).translate(0, 0.006, 0);
}
