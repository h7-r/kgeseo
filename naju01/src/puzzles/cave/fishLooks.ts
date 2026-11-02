/**
 * 강 밑 물고기 생김새 — 네 가지(은빛 피라미 · 줄무늬 쉬리 · 붕어 · 메기)의 크기·빛깔과 몸 한 덩이 지오.
 * 물고기 떼(Fishes)와 물고기 굴 퍼즐(AirStations)이 같이 쓴다.
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

const HALL_REGION = { x: [HALL.x[0] + 1, HALL.x[1] - 1] as [number, number], z: [HALL.z[0] + 1, HALL.z[1] - 1.5] as [number, number] };
const WIDE_REGION = { x: [HALL.x[0] - 14, HALL.x[1] + 14] as [number, number], z: [HALL.z[0] - 1, HALL.z[1] + 18] as [number, number] };

export const SPECIES: Species[] = [
  { name: "은빛 피라미", count: 40, size: 0.17, back: "#6F8A96", belly: "#EAF1F3", fin: "#CFE0E6", tall: 1.25, wide: 0.5, freq: 9, speed: 0.9, school: true, yMin: FLOOR_Y + 1.2, yMax: FLOOR_Y + 3.6, region: HALL_REGION },
  { name: "줄무늬 쉬리", count: 14, size: 0.27, back: "#3E5A52", belly: "#DDE6D6", fin: "#C8D6C4", stripe: "#1F2E2A", stripes: 7, tall: 1.2, wide: 0.55, freq: 7, speed: 0.65, school: false, yMin: FLOOR_Y + 0.6, yMax: FLOOR_Y + 3.2, region: WIDE_REGION },
  { name: "붕어", count: 6, size: 0.46, back: "#8A7A3C", belly: "#E8DFBE", fin: "#B89E58", tall: 1.65, wide: 0.6, freq: 5, speed: 0.42, school: false, yMin: FLOOR_Y + 0.4, yMax: FLOOR_Y + 1.8, region: WIDE_REGION },
  { name: "메기", count: 2, size: 0.82, back: "#3A3F3A", belly: "#9FA596", fin: "#4E5450", whiskers: true, tall: 0.85, wide: 1.25, freq: 3.5, speed: 0.28, school: false, yMin: FLOOR_Y + 0.22, yMax: FLOOR_Y + 0.5, region: HALL_REGION },
];

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function paint(geometry: THREE.BufferGeometry, color: (x: number, y: number, ny: number) => THREE.Color) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const c = color(position.getX(i), position.getY(i), normal.getY(i));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

const flat = (color: string) => {
  const c = new THREE.Color(color);
  return () => c;
};

/** 물고기 한 마리 — 길이 1(꼬리 −0.5 · 코 +0.5), 머리는 +x. 몸통 · 꼬리 · 등 · 가슴 · 눈 · (수염) */
export function buildFishGeometry(s: Species) {
  const pieces: THREE.BufferGeometry[] = [];
  const back = new THREE.Color(s.back);
  const belly = new THREE.Color(s.belly);
  const stripe = new THREE.Color(s.stripe ?? s.back);
  const tmp = new THREE.Color();
  // 몸통 — 방추꼴. 꼬리자루는 가늘고 머리는 뭉툭하다
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18; // 꼬리 0 → 코 1
    const r = 0.115 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.75) * (0.3 + 0.7 * smooth(0, 0.3, t));
    profile.push(new THREE.Vector2(Math.max(0.001, r), -0.5 + t));
  }
  profile[profile.length - 1].x = 0;
  const body = new THREE.LatheGeometry(profile, 16).rotateZ(-Math.PI / 2);
  body.scale(1, s.tall, s.wide);
  body.computeVertexNormals();
  pieces.push(
    paint(body, (x, _y, ny) => {
      tmp.copy(belly).lerp(back, smooth(-0.35, 0.55, ny));
      if (s.stripes) {
        const band = Math.sin(x * s.stripes * Math.PI * 1.6) > 0.35 && x < 0.3 ? 1 : 0;
        tmp.lerp(stripe, band * 0.75 * smooth(-0.6, 0.1, ny));
      }
      // 아가미 뒤 살짝 밝은 띠
      if (x > 0.18 && x < 0.24) tmp.lerp(belly, 0.25);
      return tmp.clone();
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
  pieces.push(paint(new THREE.ShapeGeometry(tail, 4), flat(s.fin)));
  // 등지느러미
  const dorsal = new THREE.Shape();
  dorsal.moveTo(-0.12, 0.1 * s.tall);
  dorsal.lineTo(0.12, 0.1 * s.tall);
  dorsal.lineTo(-0.02, 0.26 * s.tall);
  dorsal.lineTo(-0.2, 0.2 * s.tall);
  dorsal.closePath();
  pieces.push(paint(new THREE.ShapeGeometry(dorsal, 4), flat(s.fin)));
  // 가슴지느러미 둘 — 옆으로 벌어진다
  for (const side of [-1, 1]) {
    const fin = new THREE.Shape();
    fin.moveTo(0, 0);
    fin.lineTo(-0.16, 0.05);
    fin.lineTo(-0.14, -0.06);
    fin.closePath();
    const g = new THREE.ShapeGeometry(fin, 4);
    g.rotateX(side * 1.1);
    g.rotateY(side * -0.5);
    g.translate(0.16, -0.03 * s.tall, side * 0.07 * s.wide);
    pieces.push(paint(g, flat(s.fin)));
  }
  // 눈
  for (const side of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.024, 8, 6).translate(0.35, 0.03 * s.tall, side * 0.075 * s.wide);
    pieces.push(paint(eye, flat("#101416")));
  }
  // 수염(메기)
  if (s.whiskers)
    for (const side of [-1, 1]) {
      const whisker = new THREE.CylinderGeometry(0.004, 0.009, 0.42, 4).rotateZ(Math.PI / 2).rotateY(side * 0.55).translate(0.62, -0.02, side * 0.14);
      pieces.push(paint(whisker, flat(s.belly)));
    }
  // uv 는 안 쓴다 — 조각마다 있거나 없어서 합칠 때 빼 둔다
  pieces.forEach((g) => g.deleteAttribute("uv"));
  const merged = mergeGeometries(pieces, false)!;
  pieces.forEach((g) => g.dispose());
  return merged;
}

