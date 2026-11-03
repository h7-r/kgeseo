/**
 * 강 밑 물고기 생김새 — 네 가지(은빛 피라미 · 줄무늬 쉬리 · 붕어 · 메기)의 크기 · 빛깔과 몸 한 덩이 지오.
 * 물고기 떼(Fishes) · 물고기 굴(FishBurrows) · 멸치 떼(SeaLife)가 같이 쓴다.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { FLOOR_Y, HALL } from "./caveState";

export interface Species {
  name: string;
  count: number;
  /** 몸길이(미터) */
  size: number;
  back: string;
  belly: string;
  fin: string;
  stripe?: string;
  stripes?: number;
  whiskers?: boolean;
  /** 몸높이 · 몸너비 배율 */
  tall: number;
  wide: number;
  /** 꼬리 흔드는 빠르기 · 헤엄 빠르기(m/s) */
  freq: number;
  speed: number;
  school: boolean;
  yMin: number;
  yMax: number;
  /** 돌아다니는 네모(미터) */
  region: { x: [number, number]; z: [number, number] };
}

const HALL_REGION = {
  x: [HALL.x[0] + 1, HALL.x[1] - 1] as [number, number],
  z: [HALL.z[0] + 1, HALL.z[1] - 1.5] as [number, number],
};
const WIDE_REGION = {
  x: [HALL.x[0] - 14, HALL.x[1] + 14] as [number, number],
  z: [HALL.z[0] - 1, HALL.z[1] + 18] as [number, number],
};

export const SPECIES: Species[] = [
  {
    name: "은빛 피라미",
    count: 40,
    size: 0.17,
    back: "#6F8A96",
    belly: "#EAF1F3",
    fin: "#CFE0E6",
    tall: 1.25,
    wide: 0.5,
    freq: 9,
    speed: 0.9,
    school: true,
    yMin: FLOOR_Y + 1.2,
    yMax: FLOOR_Y + 3.6,
    region: HALL_REGION,
  },
  {
    name: "줄무늬 쉬리",
    count: 14,
    size: 0.27,
    back: "#3E5A52",
    belly: "#DDE6D6",
    fin: "#C8D6C4",
    stripe: "#1F2E2A",
    stripes: 7,
    tall: 1.2,
    wide: 0.55,
    freq: 7,
    speed: 0.65,
    school: false,
    yMin: FLOOR_Y + 0.6,
    yMax: FLOOR_Y + 3.2,
    region: WIDE_REGION,
  },
  {
    name: "붕어",
    count: 6,
    size: 0.46,
    back: "#8A7A3C",
    belly: "#E8DFBE",
    fin: "#B89E58",
    tall: 1.65,
    wide: 0.6,
    freq: 5,
    speed: 0.42,
    school: false,
    yMin: FLOOR_Y + 0.4,
    yMax: FLOOR_Y + 1.8,
    region: WIDE_REGION,
  },
  {
    name: "메기",
    count: 2,
    size: 0.82,
    back: "#3A3F3A",
    belly: "#9FA596",
    fin: "#4E5450",
    whiskers: true,
    tall: 0.85,
    wide: 1.25,
    freq: 3.5,
    speed: 0.28,
    school: false,
    yMin: FLOOR_Y + 0.22,
    yMax: FLOOR_Y + 0.5,
    region: HALL_REGION,
  },
];

/** a~b 구간을 0~1 로 부드럽게 */
const smoothBetween = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type VertexPainter = (x: number, y: number, normalY: number) => THREE.Color;

/** 꼭짓점마다 색을 묻는다 */
function paintVertices(geometry: THREE.BufferGeometry, colorAt: VertexPainter) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const color = colorAt(position.getX(i), position.getY(i), normal.getY(i));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

const solidColor = (hex: string): VertexPainter => {
  const color = new THREE.Color(hex);
  return () => color;
};

/** 물고기 한 마리 — 길이 1(꼬리 −0.5 · 코 +0.5), 머리는 +x. 몸통 · 꼬리 · 등 · 가슴 · 눈 · (수염) */
export function buildFishGeometry(species: Species) {
  const pieces: THREE.BufferGeometry[] = [];
  const back = new THREE.Color(species.back);
  const belly = new THREE.Color(species.belly);
  const stripe = new THREE.Color(species.stripe ?? species.back);
  const mixed = new THREE.Color();
  // 몸통 — 방추꼴. 꼬리자루는 가늘고 머리는 뭉툭하다
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18; // 꼬리 0 → 코 1
    const r = 0.115 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.75) * (0.3 + 0.7 * smoothBetween(0, 0.3, t));
    profile.push(new THREE.Vector2(Math.max(0.001, r), -0.5 + t));
  }
  profile[profile.length - 1].x = 0;
  const body = new THREE.LatheGeometry(profile, 16).rotateZ(-Math.PI / 2);
  body.scale(1, species.tall, species.wide);
  body.computeVertexNormals();
  pieces.push(
    paintVertices(body, (x, _y, normalY) => {
      mixed.copy(belly).lerp(back, smoothBetween(-0.35, 0.55, normalY));
      if (species.stripes) {
        const band = Math.sin(x * species.stripes * Math.PI * 1.6) > 0.35 && x < 0.3 ? 1 : 0;
        mixed.lerp(stripe, band * 0.75 * smoothBetween(-0.6, 0.1, normalY));
      }
      // 아가미 뒤 살짝 밝은 띠
      if (x > 0.18 && x < 0.24) mixed.lerp(belly, 0.25);
      return mixed.clone();
    }),
  );
  // 꼬리 — 두 갈래
  const tail = new THREE.Shape();
  tail.moveTo(-0.46, 0);
  tail.lineTo(-0.78, 0.2);
  tail.lineTo(-0.66, 0.02);
  tail.lineTo(-0.66, -0.02);
  tail.lineTo(-0.78, -0.2);
  tail.closePath();
  pieces.push(paintVertices(new THREE.ShapeGeometry(tail, 4), solidColor(species.fin)));
  // 등지느러미
  const dorsal = new THREE.Shape();
  dorsal.moveTo(-0.12, 0.1 * species.tall);
  dorsal.lineTo(0.12, 0.1 * species.tall);
  dorsal.lineTo(-0.02, 0.26 * species.tall);
  dorsal.lineTo(-0.2, 0.2 * species.tall);
  dorsal.closePath();
  pieces.push(paintVertices(new THREE.ShapeGeometry(dorsal, 4), solidColor(species.fin)));
  // 가슴지느러미 둘 — 옆으로 벌어진다
  for (const side of [-1, 1]) {
    const fin = new THREE.Shape();
    fin.moveTo(0, 0);
    fin.lineTo(-0.16, 0.05);
    fin.lineTo(-0.14, -0.06);
    fin.closePath();
    const finGeometry = new THREE.ShapeGeometry(fin, 4);
    finGeometry.rotateX(side * 1.1);
    finGeometry.rotateY(side * -0.5);
    finGeometry.translate(0.16, -0.03 * species.tall, side * 0.07 * species.wide);
    pieces.push(paintVertices(finGeometry, solidColor(species.fin)));
  }
  // 눈
  for (const side of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.024, 8, 6).translate(0.35, 0.03 * species.tall, side * 0.075 * species.wide);
    pieces.push(paintVertices(eye, solidColor("#101416")));
  }
  // 수염(메기)
  if (species.whiskers)
    for (const side of [-1, 1]) {
      const whisker = new THREE.CylinderGeometry(0.004, 0.009, 0.42, 4)
        .rotateZ(Math.PI / 2)
        .rotateY(side * 0.55)
        .translate(0.62, -0.02, side * 0.14);
      pieces.push(paintVertices(whisker, solidColor(species.belly)));
    }
  // uv 는 안 쓴다 — 조각마다 있거나 없어서 합칠 때 빼 둔다
  pieces.forEach((piece) => piece.deleteAttribute("uv"));
  const merged = mergeGeometries(pieces, false)!;
  pieces.forEach((piece) => piece.dispose());
  return merged;
}
