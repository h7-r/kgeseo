/**
 * 증언 능선의 새들 — 돌로 굳은 솟대 새(조각상), 깨어난 진짜 오리(날개 따로), 팔각 열쇠. 단위는 미터, 꼭짓점 색.
 * 조각상은 날개를 활짝 편 채 굳은 새다 — 오리처럼 앉은 몸이 아니라 막 날아오르려는 모양(긴 날개 · 짧은 목).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { DUCK_SCALE, POLE_TOP } from "../../story/scene2";

// 노을빛 아래서도 돌로 읽히게 살짝 푸른 회색
const STONE_DARK = new THREE.Color("#7C838B");
const STONE_LIGHT = new THREE.Color("#C9CFD6");
/** 깎은 나무 빛 — 돌로 다시 칠할 때 밝기만 남는다(씬2 솟대와 같은 값) */
const CARVED = { wood: "#9A7A55", dark: "#735A3E", peg: "#7A6647", bill: "#C8A35E", eye: "#1E1A16" };

const prepare = (geometry: THREE.BufferGeometry) => {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.deleteAttribute("uv");
  if (!flat.attributes.normal) flat.computeVertexNormals();
  return flat;
};

function paint(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const c = new THREE.Color(color);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) c.toArray(colors, i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function round(radius: [number, number, number], at: [number, number, number], color: string, shape?: (v: THREE.Vector3) => void) {
  const geometry = new THREE.SphereGeometry(1, 16, 10);
  if (shape) {
    const p = geometry.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      shape(v.fromBufferAttribute(p, i));
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geometry.computeVertexNormals();
  }
  geometry.scale(...radius);
  geometry.translate(...at);
  return paint(prepare(geometry), color);
}

/** 머리 · 부리 자리(장대 끝 기준, 키우기 전) — 열쇠를 무는 자리가 여기서 나온다 */
const HEAD = { y: 0.074, z: 0.092 };
const BILL_LENGTH = 0.042;

/**
 * 한쪽 날개 — 어깨(원점)에서 +x 로 길게 뻗는 깃 판. 앞전은 둥글고 뒷전은 칼깃이 톱니처럼 갈라진다.
 * 두께가 있어 돌로 굳어도 판때기로 안 보인다
 */
function buildCarvedWing(span: number) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.026);
  shape.quadraticCurveTo(span * 0.4, 0.042, span * 0.8, 0.018);
  shape.quadraticCurveTo(span * 0.98, 0.004, span, -0.014);
  // 뒷전 칼깃 — 끝에서 어깨 쪽으로 잘게, 얕게 갈라진다
  const feathers = 9;
  const trailing = (x: number) => -0.024 - 0.016 * Math.sin((x / span) * Math.PI * 0.85);
  for (let k = 0; k < feathers; k++) {
    const t0 = 1 - k / feathers;
    const t1 = 1 - (k + 0.6) / feathers;
    shape.lineTo(span * t0 * 0.97, trailing(span * t0) - 0.007);
    shape.lineTo(span * t1, trailing(span * t1) + 0.003);
  }
  shape.lineTo(0, -0.03);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 6 });
  // 판(xy) → 날개(xz): 앞(+y)이 머리 쪽(+z)으로
  geometry.translate(0, 0, -0.004);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/**
 * 돌새 — 장대 끝(원점)에 얹힌 새. 날개를 위로 비스듬히 활짝 펴고(몸의 두 배 넘게), 목은 짧게 몸에 붙어
 * 머리가 앞을 본다. 부리는 짧고 뾰족하다. 앞은 +z. 표본 단위(솟대 키 1)
 */
export function buildCarvedDuckAtPoleTop() {
  const pieces: THREE.BufferGeometry[] = [];
  // 몸 — 가슴이 도톰하고 뒤로 갈수록 가늘다
  pieces.push(
    round([0.034, 0.03, 0.085], [0, 0.048, 0], CARVED.wood, (v) => {
      const rear = Math.max(0, -v.z);
      v.x *= 1 - 0.5 * rear;
      v.y *= 1 - 0.35 * rear;
      if (v.y < 0) v.y *= 0.8;
    }),
  );
  // 꽁지 — 뒤로 펼친 부채
  pieces.push(
    round([0.04, 0.007, 0.05], [0, 0.052, -0.11], CARVED.dark, (v) => {
      v.x *= 0.45 + 0.55 * Math.max(0, -v.z);
    }),
  );
  // 목은 짧게 — 가슴에서 바로 머리로
  pieces.push(round([0.022, 0.024, 0.026], [0, 0.062, 0.062], CARVED.wood));
  pieces.push(round([0.022, 0.022, 0.026], [0, HEAD.y, HEAD.z], CARVED.wood));
  // 짧고 뾰족한 부리
  const bill = new THREE.ConeGeometry(0.0075, BILL_LENGTH, 8);
  bill.rotateX(Math.PI / 2);
  bill.translate(0, HEAD.y - 0.004, HEAD.z + 0.02 + BILL_LENGTH / 2);
  pieces.push(paint(prepare(bill), CARVED.bill));
  for (const side of [-1, 1]) pieces.push(round([0.004, 0.004, 0.004], [side * 0.018, HEAD.y + 0.006, HEAD.z + 0.012], CARVED.eye));
  // 날개 — 어깨에서 위로 18° 들어 활짝(몸길이보다 길게). 끝이 살짝 뒤로 젖혀진다
  for (const side of [-1, 1]) {
    const wing = buildCarvedWing(0.17);
    wing.rotateY(0.14);
    wing.rotateZ(THREE.MathUtils.degToRad(18));
    if (side < 0) {
      wing.scale(-1, 1, 1);
      // 뒤집으면 면이 안팎으로 바뀐다 — 삼각형 순서를 되돌린다
      const position = wing.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < position.count; i += 3) {
        const x = position.getX(i + 1), y = position.getY(i + 1), z = position.getZ(i + 1);
        position.setXYZ(i + 1, position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2));
        position.setXYZ(i + 2, x, y, z);
      }
    }
    wing.translate(side * 0.022, 0.058, 0.008);
    pieces.push(paint(prepare(wing), CARVED.dark));
  }
  // 장대 끝이 배에 박힌 자리
  const peg = new THREE.CylinderGeometry(0.014, 0.018, 0.04, 8);
  peg.translate(0, 0.013, -0.005);
  pieces.push(paint(prepare(peg), CARVED.peg));
  const merged = mergeGeometries(pieces.map((piece) => (piece.index ? piece.toNonIndexed() : piece)), false)!;
  pieces.forEach((piece) => piece.dispose());
  merged.computeVertexNormals();
  // 장대 끝을 축으로 키운다 — 씬2 솟대 오리와 같은 배율
  merged.scale(DUCK_SCALE, DUCK_SCALE, DUCK_SCALE);
  return merged;
}

/** 돌빛으로 다시 칠한다 — 원래 색의 밝기를 살려 날개 결·눈이 남게 */
export function toStone(geometry: THREE.BufferGeometry) {
  const stone = geometry.clone();
  const color = stone.attributes.color as THREE.BufferAttribute;
  const c = new THREE.Color();
  for (let i = 0; i < color.count; i++) {
    c.fromBufferAttribute(color, i);
    const light = THREE.MathUtils.clamp((c.r * 0.3 + c.g * 0.59 + c.b * 0.11) * 1.9, 0, 1);
    c.copy(STONE_DARK).lerp(STONE_LIGHT, light);
    color.setXYZ(i, c.r, c.g, c.b);
  }
  return stone;
}

/** 부리 끝(장대 끝 기준, 표본 단위) — 열쇠를 무는 자리 */
export const BILL_TIP = new THREE.Vector3(0, (HEAD.y - 0.004) * DUCK_SCALE, (HEAD.z + 0.02 + BILL_LENGTH) * DUCK_SCALE);

/** 장대 — 씬2 솟대와 같은 굵기 · 밑동 돌무지(표본 단위, 키 1 기준) */
export function buildPole() {
  // 돌새와 한 몸으로 굳은 돌기둥
  const pole = paint(prepare(new THREE.CylinderGeometry(0.024, 0.044, POLE_TOP, 8, 1)), "#949AA1");
  pole.translate(0, POLE_TOP / 2, 0);
  const stones = [0, 1, 2, 3, 4].map((k) => {
    const a = (k / 5) * Math.PI * 2 + 0.4;
    const s = paint(prepare(new THREE.IcosahedronGeometry(0.045, 0)), "#6E6B66");
    s.translate(Math.cos(a) * 0.07, 0.025, Math.sin(a) * 0.07);
    return s;
  });
  return mergeGeometries([pole, ...stones], false)!;
}

/** 깃 판 하나 — 윤곽(x 바깥, z 앞)을 두께 있게 뽑고 x 를 따라 색을 칠한다. 원점이 붙는 자리 */
function featherPlate(outline: [number, number][], thickness: number, tone: (x: number) => THREE.Color) {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.4, bevelSize: thickness * 0.4, bevelSegments: 1, curveSegments: 4 });
  geometry.translate(0, 0, -thickness / 2);
  // 판(xy) → 날개(xz): +y 가 앞(+z), 두께는 아래로
  geometry.rotateX(Math.PI / 2);
  const flat = prepare(geometry);
  const position = flat.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) tone(position.getX(i)).toArray(colors, i * 3);
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return flat;
}

/**
 * 나는 오리(청둥오리) — 몸과 한쪽 날개(안쪽 · 바깥쪽 두 마디). 앞은 +z, 길이 약 1(표본) → 실제 크기는 부르는 쪽이 정한다.
 * 안쪽 날개는 어깨(원점)에서 +x 로, 바깥 날개는 팔꿈치(elbow)에서 이어진다 — 날갯짓 때 바깥 마디가 늦게 따라와 휜다.
 * 왼날개는 x 를 뒤집어 쓴다.
 */
export function buildFlyingDuck(isDrake: boolean) {
  const bodyColor = isDrake ? "#9A968E" : "#8A6B4A";
  const headColor = isDrake ? "#1F5A3A" : "#7A5A3A";
  const body = round([0.15, 0.12, 0.42], [0, 0, 0], bodyColor, (v) => {
    const rear = Math.max(0, -v.z);
    v.x *= 1 - 0.45 * rear;
    v.y *= 1 - 0.35 * rear;
    if (v.y < 0) v.y *= 0.85;
  });
  const back = round([0.11, 0.05, 0.3], [0, 0.07, -0.04], isDrake ? "#5E5A54" : "#6E5236");
  const chest = round([0.14, 0.11, 0.15], [0, -0.01, 0.26], isDrake ? "#6B4232" : "#8A6B4A");
  const neck = round([0.065, 0.075, 0.1], [0, 0.07, 0.39], headColor);
  const ring = round([0.07, 0.025, 0.05], [0, 0.03, 0.35], isDrake ? "#EDEBE4" : "#7A5A3A");
  const head = round([0.075, 0.08, 0.1], [0, 0.13, 0.47], headColor, (v) => {
    if (v.y > 0) v.z *= 0.9;
  });
  const bill = round([0.042, 0.018, 0.085], [0, 0.11, 0.58], "#D9A63A", (v) => {
    v.x *= 1 + 0.25 * Math.max(0, v.z);
    v.y *= 1 - 0.3 * Math.max(0, v.z);
  });
  const eyes = [-1, 1].map((side) => round([0.013, 0.013, 0.013], [side * 0.062, 0.15, 0.5], "#141210"));
  // 꽁지 — 부채처럼 편 깃 다섯, 수컷은 끝에 말린 깃
  const tailFeathers = [-2, -1, 0, 1, 2].map((k) =>
    round([0.03, 0.012, 0.11], [k * 0.035, 0.03, -0.5 + Math.abs(k) * 0.015], k === 0 ? "#2E2E30" : "#3A3A3C", (v) => {
      v.x += v.z * k * 0.18;
    }),
  );
  const curl = isDrake ? [round([0.018, 0.03, 0.018], [0, 0.07, -0.44], "#1E1E20")] : [];
  // 다리 — 날 때처럼 꽁지 밑으로 접어 붙였다. 주황 정강이와 물갈퀴 발
  const legs = [-1, 1].flatMap((side) => {
    const shin = new THREE.CylinderGeometry(0.011, 0.009, 0.16, 6);
    shin.rotateX(Math.PI / 2 - 0.35);
    shin.translate(side * 0.045, -0.085, -0.16);
    const foot = round([0.034, 0.005, 0.05], [side * 0.045, -0.11, -0.26], "#D9A63A", (v) => {
      // 뒤로 갈수록 넓게 벌어진 물갈퀴
      v.x *= 1 + 0.9 * Math.max(0, -v.z);
    });
    return [paint(prepare(shin), "#D9A63A"), foot];
  });
  const bodyGeometry = mergeGeometries([body, back, chest, neck, ring, head, bill, ...eyes, ...tailFeathers, ...curl, ...legs], false)!;

  // 날개 — 안쪽(덮깃 · 날개거울)과 바깥(칼깃이 갈라진 끝). 바깥 마디 끝은 뒤로 젖혀진다
  const elbow = 0.3;
  const coverts = isDrake ? new THREE.Color("#9C978E") : new THREE.Color("#8C6E4E");
  const speculum = new THREE.Color("#3A3F5A");
  const primary = new THREE.Color("#3E3A36");
  const innerTone = (x: number) => (x > 0.17 && x < 0.27 ? speculum : coverts);
  const inner = featherPlate(
    [
      [0, 0.13],
      [0.16, 0.15],
      [elbow + 0.01, 0.1],
      [elbow + 0.01, -0.12],
      [0.22, -0.2],
      [0.12, -0.21],
      [0.05, -0.19],
      [0, -0.13],
    ],
    0.014,
    innerTone,
  );
  // 바깥 — 칼깃 다섯이 끝에서 갈라진다
  const outerOutline: [number, number][] = [[0, 0.1]];
  outerOutline.push([0.14, 0.06], [0.3, -0.04], [0.38, -0.12]);
  for (let f = 0; f < 5; f++) {
    const x = 0.38 - f * 0.06;
    outerOutline.push([x - 0.015, -0.17 - f * 0.012], [x - 0.04, -0.13 - f * 0.01]);
  }
  outerOutline.push([0.06, -0.15], [0, -0.12]);
  const outer = featherPlate(outerOutline, 0.01, (x) => (x > 0.12 ? primary : coverts.clone().lerp(primary, 0.4)));
  return { body: bodyGeometry, inner, outer, elbow };
}
