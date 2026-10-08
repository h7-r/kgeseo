/**
 * 번호 자물쇠의 모양 계산. 축: 몸통은 xy 평면에 서고 다이얼 면이 +z, 고리는 +y 로 올라간다.
 * GLB 가 아니라 코드로 만드는 이유: 다이얼이 칸마다 따로 돌아야 하고, 화면 보며 비율을 맞춰야 한다.
 */
import * as THREE from "three";
import type { Vector3Tuple } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { makeRandom } from "@/engine/random";
import { cachedCanvasTexture, SIGN_FONT } from "@/engine/textures/canvas";

function mergeAndDispose(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}

// 몸통 — 좌우 두 덩이. 가운데는 다이얼이 통째로 채운다
// 통으로 막으면 몸통 앞면이 다이얼을 가려 얇은 조각만 삐져나온다.

/** 덩이 하나의 가로. 몸통과 표식 자리가 같은 값을 봐야 표식이 덩이 밖으로 안 나간다. */
export const computeLobeWidth = ({ width, height, dialWidth }: { width: number; height: number; dialWidth: number }) =>
  Math.max(height * 0.55, (width - dialWidth) / 2);

/**
 * 모서리를 깎은 양 = 앞면 평평한 부분이 윤곽에서 들어간 거리.
 * 앞면에 새기는 것은 이만큼 안으로 들어와야 한다 — 베벨 위는 면이 물러나 있어 떠 보인다.
 */
export const computeBevel = ({ height, depth, lobeWidth }: { height: number; depth: number; lobeWidth: number }) =>
  Math.max(0.0005, Math.min(height * 0.09, depth * 0.18, (lobeWidth - height * 0.2) / 2.2));

interface LobeOptions {
  lobeWidth: number;
  height: number;
  depth: number;
  side: number;
  sideRoundness?: number;
}

function lobeGeometry({ lobeWidth, height, depth, side, sideRoundness = 1 }: LobeOptions) {
  // 베벨은 윤곽을 바깥으로 부풀린다. 미리 안으로 줄여 놔야 최종 크기가 맞고 다이얼을 안 가린다.
  const bevel = computeBevel({ height, depth, lobeWidth });
  const r = Math.max(0.0005, height / 2 - bevel);
  const inner = bevel;
  const outer = lobeWidth - bevel;
  // 1 이면 반원, 0 이면 각진 네모. 그 사이는 모서리만 둥근 네모로 한 식에 이어 놓았다.
  const round = Math.min(r * Math.max(0, Math.min(1, sideRoundness)), Math.max(0, (outer - inner) * 0.98));
  const center = Math.max(inner + 0.0002, outer - round);
  const shape = new THREE.Shape();
  shape.moveTo(inner, -r);
  shape.lineTo(center, -r);
  if (round > 0.0002) {
    shape.absarc(center, -r + round, round, -Math.PI / 2, 0, false);
    shape.lineTo(outer, r - round);
    shape.absarc(center, r - round, round, 0, Math.PI / 2, false);
  } else {
    shape.lineTo(outer, -r);
    shape.lineTo(outer, r);
  }
  shape.lineTo(inner, r);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 16,
  });
  g.translate(0, 0, -depth / 2 + bevel);
  // 거울로 뒤집으면 면이 뒤집혀 안쪽이 보인다 — 왼쪽 덩이는 돌려서 만든다.
  if (side < 0) g.rotateY(Math.PI);
  return g;
}

/** 상자+원기둥을 이어 붙이지 않고 윤곽을 뽑는다. 붙이면 속에 남은 마구리가 주름선으로 앞면에 그려진다. */
export function bodyGeometry({
  width,
  height,
  depth,
  dialWidth,
  sideRoundness,
}: {
  width: number;
  height: number;
  depth: number;
  dialWidth: number;
  sideRoundness: number;
}) {
  const lobeWidth = computeLobeWidth({ width, height, dialWidth });
  return mergeAndDispose(
    [-1, 1].map((side) => {
      const g = lobeGeometry({ lobeWidth, height, depth, side, sideRoundness });
      g.translate((side * dialWidth) / 2, 0, 0);
      return g;
    }),
  );
}

interface MarkerShape {
  length: number;
  headLength: number;
  headHalf: number;
  tailHalf: number;
}

/**
 * 읽는 줄 표식 "→". 세 줄이 같이 보이는데 맞춰야 하는 건 정면 한 줄이라 가리켜 준다.
 * 왼쪽에만 둔다(양쪽이면 과녁 무늬가 된다). 앞면에 칠한 듯 납작해야 손가락·걸쇠에 안 걸린다.
 */
export function markerGeometry({ length, headLength, headHalf, tailHalf }: MarkerShape) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(-headLength, headHalf);
  shape.lineTo(-headLength, tailHalf);
  shape.lineTo(-length, tailHalf);
  shape.lineTo(-length, -tailHalf);
  shape.lineTo(-headLength, -tailHalf);
  shape.lineTo(-headLength, -headHalf);
  shape.closePath();
  return new THREE.ShapeGeometry(shape, 1);
}

/** 고리 — 반원 + 두 다리. 오른쪽이 긴(고정) 다리, 왼쪽이 풀면 먼저 빠지는 짧은 다리다. */
export function shackleGeometry({
  radius,
  thickness,
  leg,
  longLegRatio = 1,
  shortLegRatio = 1,
}: {
  radius: number;
  thickness: number;
  leg: number;
  longLegRatio?: number;
  shortLegRatio?: number;
}) {
  // 토러스 0~π 는 위쪽 반원이다.
  const pieces: THREE.BufferGeometry[] = [new THREE.TorusGeometry(radius, thickness, 10, 26, Math.PI)];
  for (const s of [-1, 1]) {
    const length = s > 0 ? leg * longLegRatio : leg * shortLegRatio;
    const c = new THREE.CylinderGeometry(thickness, thickness, length, 12, 1);
    // 위쪽 끝을 굵기 절반만큼 반원 속에 물려 이음매를 감춘다.
    c.translate(s * radius, thickness / 2 - length / 2, 0);
    pieces.push(c);
  }
  return mergeAndDispose(pieces);
}

// 걸쇠 판
// 실물은 구멍 뚫린 철판 두 장을 마주 물리고 그 구멍으로 쇠막대가 지난다.
// 판은 y-z 평면에 서고 구멍 축이 x, 원점은 큰 구멍 한가운데다 — 쇠막대 길 위에 얹기 쉽다.

interface LatchPlateShape {
  holeRadius: number;
  plateHalfWidth: number;
  length: number;
  thickness: number;
  wing: number;
  screwCount: number;
  screwRadius: number;
  screwOnWing?: boolean;
}

interface ScrewSpot {
  position: Vector3Tuple;
  axis: "x" | "z";
}

/** 나사 자리. 판을 뚫는 식과 같은 계산이라야 판을 고칠 때 나사만 엉뚱한 데 남지 않는다. */
export function screwSpots({
  plateHalfWidth,
  length,
  thickness,
  wing,
  screwCount,
  screwRadius,
  screwOnWing,
}: LatchPlateShape): ScrewSpot[] {
  const n = Math.max(0, Math.round(screwCount));
  const hasWing = wing > thickness;
  const onWing = screwOnWing ?? hasWing;
  const spots: ScrewSpot[] = [];
  if (n === 0) return spots;
  if (onWing && hasWing) {
    const x0 = -thickness / 2,
      x1 = wing - thickness / 2;
    for (let i = 0; i < n; i++) {
      const x = x0 + (x1 - x0) * ((i + 1) / (n + 1));
      if (x - screwRadius < x0 + thickness || x + screwRadius > x1 - thickness * 0.5) continue;
      // 날개는 x-y 평면, 두께가 z → 나사 축도 z
      spots.push({ position: [x, 0, -length + thickness / 2], axis: "z" });
    }
  } else if (!onWing) {
    const X = length - Math.max(screwRadius * 1.8, plateHalfWidth * 0.7);
    for (let i = 0; i < n; i++) {
      const Y = n === 1 ? 0 : (i / (n - 1) - 0.5) * (plateHalfWidth * 1.1);
      if (X - screwRadius < plateHalfWidth || X + screwRadius > length - thickness * 0.5) continue;
      // 판을 돌려 세워서 모양 X → −z, 두께 → x → 나사 축은 x
      spots.push({ position: [0, Y, -X], axis: "x" });
    }
  }
  return spots;
}

/** 나사 머리를 앞뒤로 하나씩. 구멍만 있으면 나사가 빠진 자리로 보인다. */
export function screwGeometry(spots: ScrewSpot[], screwRadius: number, thickness: number) {
  if (!spots.length) return null;
  const pieces: THREE.BufferGeometry[] = [];
  for (const { position, axis } of spots) {
    for (const s of [-1, 1]) {
      const g = new THREE.CylinderGeometry(screwRadius * 1.55, screwRadius * 1.15, screwRadius * 0.9, 12, 1);
      if (axis === "x") g.rotateZ(Math.PI / 2);
      else g.rotateX(Math.PI / 2);
      const d = thickness / 2 + screwRadius * 0.45;
      g.translate(position[0] + (axis === "x" ? s * d : 0), position[1], position[2] + (axis === "z" ? s * d : 0));
      pieces.push(g);
    }
  }
  return mergeAndDispose(pieces);
}

export function latchPlateGeometry({
  holeRadius,
  plateHalfWidth,
  length,
  thickness,
  wing,
  screwCount,
  screwRadius,
  screwOnWing,
}: LatchPlateShape) {
  const n = Math.max(0, Math.round(screwCount));
  const hasWing = wing > thickness;
  // 나사는 판을 대는 면에 박힌다 — ㄱ자면 날개에, 평판이면 구멍 없는 네모 끝에.
  const onWing = screwOnWing ?? hasWing;

  const body = new THREE.Shape();
  body.absarc(0, 0, plateHalfWidth, Math.PI / 2, Math.PI * 1.5, false);
  body.lineTo(length, -plateHalfWidth);
  body.lineTo(length, plateHalfWidth);
  body.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, holeRadius, 0, Math.PI * 2, true);
  body.holes.push(hole);
  if (!onWing && n > 0) {
    const x = length - Math.max(screwRadius * 1.8, plateHalfWidth * 0.7);
    for (let i = 0; i < n; i++) {
      const y = n === 1 ? 0 : (i / (n - 1) - 0.5) * (plateHalfWidth * 1.1);
      if (x - screwRadius < plateHalfWidth || x + screwRadius > length - thickness * 0.5) continue;
      const p = new THREE.Path();
      p.absarc(x, y, screwRadius, 0, Math.PI * 2, true);
      body.holes.push(p);
    }
  }
  const g = new THREE.ExtrudeGeometry(body, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 16,
  });
  g.translate(0, 0, -thickness / 2);
  g.rotateY(Math.PI / 2); // 모양 X → −z, 두께 → x (구멍 축이 x)
  const pieces: THREE.BufferGeometry[] = [g];

  if (hasWing) {
    // ㄱ자로 꺾인 날개 — 문에 닿는 면. 이미 x-y 평면에 두께가 z 라 돌리지 않는다.
    const w = new THREE.Shape();
    const x0 = -thickness / 2,
      x1 = wing - thickness / 2;
    w.moveTo(x0, -plateHalfWidth);
    w.lineTo(x1, -plateHalfWidth);
    w.lineTo(x1, plateHalfWidth);
    w.lineTo(x0, plateHalfWidth);
    w.closePath();
    if (onWing && n > 0) {
      for (let i = 0; i < n; i++) {
        const x = x0 + (x1 - x0) * ((i + 1) / (n + 1));
        if (x - screwRadius < x0 + thickness || x + screwRadius > x1 - thickness * 0.5) continue;
        const p = new THREE.Path();
        p.absarc(x, 0, screwRadius, 0, Math.PI * 2, true);
        w.holes.push(p);
      }
    }
    const wingGeometry = new THREE.ExtrudeGeometry(w, {
      depth: thickness,
      bevelEnabled: false,
      curveSegments: 12,
    });
    wingGeometry.translate(0, 0, -length);
    pieces.push(wingGeometry);
  }
  if (pieces.length === 1) return pieces[0];
  return mergeAndDispose(pieces);
}

/**
 * 다이얼 글자 띠. 원기둥 uv 는 축을 따라 v 라 그대로 씌우면 글자가 90° 눕는다 — 칸마다 uv 를 직접 물린다.
 * 점(θ, x) = (x, R sinθ, R cosθ), θ=0 이 정면(+z).
 */
export function dialBandGeometry({ slotCount, radius, width }: { slotCount: number; radius: number; width: number }) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const pieces = 3; // 칸 하나를 몇 조각으로 — 많을수록 둥글다
  const point = (a: number, x: number): Vector3Tuple => [x, radius * Math.sin(a), radius * Math.cos(a)];
  const normal = (a: number): Vector3Tuple => [0, Math.sin(a), Math.cos(a)];
  for (let k = 0; k < slotCount; k++) {
    for (let s = 0; s < pieces; s++) {
      const t0 = (k + s / pieces) / slotCount;
      const t1 = (k + (s + 1) / pieces) / slotCount;
      const a0 = t0 * Math.PI * 2;
      const a1 = t1 * Math.PI * 2;
      const A = point(a0, -width / 2),
        B = point(a1, -width / 2);
      const C = point(a1, width / 2),
        D = point(a0, width / 2);
      // u 는 좌우(축), v 는 위아래(둘레) — 그래야 글자가 선다.
      const uA = [0, t0],
        uB = [0, t1],
        uC = [1, t1],
        uD = [1, t0];
      // A→C→B 순서로 감아야 면이 바깥을 본다. 거꾸로 감으면 글자가 통째로 안 보인다.
      const triangles: [Vector3Tuple, Vector3Tuple, number[]][] = [
        [A, normal(a0), uA],
        [C, normal(a1), uC],
        [B, normal(a1), uB],
        [A, normal(a0), uA],
        [D, normal(a0), uD],
        [C, normal(a1), uC],
      ];
      for (const [v, n, uv] of triangles) {
        positions.push(...v);
        normals.push(...n);
        uvs.push(...uv);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/** 칸마다 지름이 조금 작은 속심 원기둥. 글자 띠와 붙으면 깜빡이므로 확실히 안쪽에 둔다. */
export function dialCoreGeometry(rowCount: number, dialRadius: number, slotWidth: number) {
  const pieces: THREE.BufferGeometry[] = [];
  for (let i = 0; i < rowCount; i++) {
    const c = new THREE.CylinderGeometry(dialRadius * 0.86, dialRadius * 0.86, slotWidth * 0.94, 16, 1);
    c.rotateZ(Math.PI / 2); // 축을 x(좌우)로
    c.translate((i - (rowCount - 1) / 2) * slotWidth, 0, 0);
    pieces.push(c);
  }
  return mergeAndDispose(pieces);
}

/** 칸 사이·양 끝의 얇은 테. 다섯 칸이 한 덩어리로 보이면 몇 번째를 돌리는지 헷갈린다. */
export function dialDividerGeometry(
  rowCount: number,
  dialRadius: number,
  slotWidth: number,
  dividerWidth: number,
  dividerHeight: number,
) {
  const pieces: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= rowCount; i++) {
    const g = new THREE.CylinderGeometry(
      dialRadius * dividerHeight,
      dialRadius * dividerHeight,
      Math.max(0.0002, slotWidth * dividerWidth),
      18,
      1,
    );
    g.rotateZ(Math.PI / 2);
    g.translate((i - rowCount / 2) * slotWidth, 0, 0);
    pieces.push(g);
  }
  return mergeAndDispose(pieces);
}

/**
 * 줄마다 다른 글자 세트. 다섯 줄이 한 세트를 같이 쓰면 같은 글자가 나란히 서서 찍기 쉬워진다.
 * 정답 글자는 반드시 넣고, 나머지 미끼와 끼울 자리는 씨로 정한다(씨가 같으면 늘 같다).
 */
export function makeRowGlyphs({
  answer,
  rowCount,
  glyphsPerRow,
  glyphPool,
  seed,
}: {
  answer: string;
  rowCount: number;
  glyphsPerRow: number;
  glyphPool: string;
  seed: number;
}): string[] {
  const pool = [
    ...new Set(
      String(glyphPool ?? "")
        .toUpperCase()
        .split("")
        .filter((c) => c.trim()),
    ),
  ];
  const answerText = String(answer ?? "").toUpperCase();
  return Array.from({ length: Math.max(1, rowCount) }, (_, i) => {
    const random = makeRandom(seed * 1013 + i * 7919 + 17);
    const own = answerText[i] || null;
    const rest = pool.filter((c) => c !== own);
    // 피셔-예이츠 — 앞에서부터 뽑으면 겹치지 않는다
    for (let k = rest.length - 1; k > 0; k--) {
      const j = Math.floor(random() * (k + 1));
      [rest[k], rest[j]] = [rest[j], rest[k]];
    }
    const picked = rest.slice(0, Math.max(1, glyphsPerRow - (own ? 1 : 0)));
    if (own) picked.splice(Math.floor(random() * (picked.length + 1)), 0, own);
    return picked.join("");
  });
}

const BAND_SLOT_PX = 128;

/** 글자 띠 텍스처 — 칸마다 글자 하나. v 가 위로 가므로 캔버스에서는 아래부터 쌓는다. */
export function dialBandTexture(glyphs: string, background: string, glyphColor: string) {
  const count = glyphs.length;
  return cachedCanvasTexture(
    `padlockBand|${glyphs}|${background}|${glyphColor}`,
    (g, w, h) => {
      g.fillStyle = background;
      g.fillRect(0, 0, w, h);
      g.fillStyle = glyphColor;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `800 ${Math.round(BAND_SLOT_PX * 0.72)}px ${SIGN_FONT}`;
      for (let k = 0; k < count; k++) {
        g.fillText(glyphs[k], w / 2, h * (1 - (k + 0.5) / count));
      }
    },
    { width: 100, height: BAND_SLOT_PX * count },
  );
}

/**
 * 칸 k 를 정면(+z)으로 돌리는 각도.
 * rotateX(φ) 는 점을 θ−φ 자리로 옮기므로 θ 에 있는 칸을 정면에 두려면 φ = θ 다(빼지 않는다).
 */
export const dialSlotAngle = (k: number, slotCount: number) => ((k + 0.5) / slotCount) * Math.PI * 2;
