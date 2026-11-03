/** 돌새 곁 그림 — 돌판의 비늘 자국, 물동이에 비친 두 새와 구렁이, 돌판 모양. 단위는 미터 */
import * as THREE from "three";

import { createCanvas, makeTextureFromCanvas } from "@/engine/textures/canvas";

import { makeToonMaterial } from "../materials";

/** 돌판 윗면(땅 위 m) · 비늘이 눕는 자리 크기 */
export const SLAB_TOP = 0.09;
export const SCALE_SEAT = { length: 0.16, width: 0.13 };

/** 비늘 꼴 — itemLooks.buildScaleGeometry 와 같은 윤곽(밑동 t=0 → 둥근 끝 t=1) */
const outline = (t: number) => Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.7 * (0.55 + 0.45 * t);

/** 돌판에 판 비늘 자국 — 어두운 홈, 결 따라 가는 줄(화석처럼). 빛나는 정도는 발광으로 */
export function makeFossilTexture() {
  const size = 256;
  const { canvas, g } = createCanvas(size, size);
  const traceScale = (scale: number) => {
    const halfWidth = (SCALE_SEAT.width / SCALE_SEAT.length) * 0.5 * size * 0.86 * scale;
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      g.lineTo(size / 2 + outline(t) * halfWidth, size * (0.93 - t * 0.86 * scale));
    }
    for (let i = 40; i >= 0; i--) {
      const t = i / 40;
      g.lineTo(size / 2 - outline(t) * halfWidth, size * (0.93 - t * 0.86 * scale));
    }
    g.closePath();
  };
  // 밝은 턱 → 어두운 홈 → 결
  g.translate(2, 3);
  traceScale(1);
  g.fillStyle = "rgba(214,206,190,0.55)";
  g.fill();
  g.translate(-2, -3);
  traceScale(1);
  g.fillStyle = "#2A2622";
  g.fill();
  g.save();
  traceScale(1);
  g.clip();
  g.strokeStyle = "rgba(150,142,130,0.5)";
  g.lineWidth = 3;
  for (let k = -6; k <= 6; k++) {
    g.beginPath();
    g.moveTo(size / 2, size * 0.9);
    g.quadraticCurveTo(size / 2 + k * 10, size * 0.5, size / 2 + k * 18, size * 0.05);
    g.stroke();
  }
  g.restore();
  return makeTextureFromCanvas(canvas);
}

/** 물에 비친 그림 — 하늘빛 물, 가운데 두 새가 서로 마주 본다 */
export function makeReflectionTexture() {
  const size = 256;
  const { canvas, g } = createCanvas(size, size);
  const sky = g.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  sky.addColorStop(0, "#D8C2A4");
  sky.addColorStop(1, "#6E6458");
  g.fillStyle = sky;
  g.fillRect(0, 0, size, size);
  const drawBird = (x: number, facing: 1 | -1) => {
    g.save();
    g.translate(x, size / 2);
    g.scale(facing, 1);
    g.fillStyle = "rgba(34,30,26,0.82)";
    g.beginPath();
    g.ellipse(0, 0, 26, 12, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(24, -10, 9, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(31, -11);
    g.lineTo(46, -8);
    g.lineTo(31, -6);
    g.fill();
    // 위로 편 날개
    g.beginPath();
    g.moveTo(-8, -6);
    g.quadraticCurveTo(-20, -52, -46, -60);
    g.quadraticCurveTo(-24, -30, 10, -8);
    g.fill();
    g.beginPath();
    g.moveTo(-24, 0);
    g.lineTo(-44, -6);
    g.lineTo(-40, 6);
    g.fill();
    g.restore();
  };
  drawBird(size / 2 - 52, 1);
  drawBird(size / 2 + 52, -1);
  return makeTextureFromCanvas(canvas);
}

/** 새들이 떠난 뒤 물에 비친 그림 — 똬리를 틀고 고개를 든 구렁이 그림자 */
export function makeSerpentTexture() {
  const size = 256;
  const { canvas, g } = createCanvas(size, size);
  const sky = g.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  sky.addColorStop(0, "#CDB89C");
  sky.addColorStop(1, "#5E564C");
  g.fillStyle = sky;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = "rgba(30,26,22,0.85)";
  g.lineCap = "round";
  // 똬리 — 안으로 감기는 나선, 꼬리로 갈수록 가늘게
  const turns = 2.4;
  let previous: [number, number] | null = null;
  for (let i = 0; i <= 160; i++) {
    const t = i / 160;
    const angle = t * turns * Math.PI * 2;
    const radius = 78 - t * 60;
    const point: [number, number] = [
      size / 2 + Math.cos(angle) * radius,
      size / 2 + 18 + Math.sin(angle) * radius * 0.7,
    ];
    if (previous) {
      g.lineWidth = 22 - t * 16;
      g.beginPath();
      g.moveTo(previous[0], previous[1]);
      g.lineTo(point[0], point[1]);
      g.stroke();
    }
    previous = point;
  }
  // 목 · 머리 — 똬리 바깥에서 고개를 든다
  g.lineWidth = 20;
  g.beginPath();
  g.moveTo(size / 2 + 78, size / 2 + 18);
  g.quadraticCurveTo(size / 2 + 96, size / 2 - 40, size / 2 + 60, size / 2 - 76);
  g.stroke();
  g.fillStyle = "rgba(30,26,22,0.9)";
  g.beginPath();
  g.ellipse(size / 2 + 52, size / 2 - 84, 18, 12, -0.5, 0, Math.PI * 2);
  g.fill();
  return makeTextureFromCanvas(canvas);
}

/** 돌판 — 땅에 반쯤 묻힌 넓적한 돌. 윗면만 반반하다 */
export function buildSlab() {
  const geometry = new THREE.DodecahedronGeometry(1, 1);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    const bump = 1 + Math.sin(vertex.x * 4.3 + vertex.z * 5.9) * 0.07;
    position.setXYZ(i, vertex.x * 0.3 * bump, Math.min(vertex.y, 0.55) * 0.18 - 0.0, vertex.z * 0.24 * bump);
  }
  geometry.translate(0, SLAB_TOP - 0.55 * 0.18, 0);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, makeToonMaterial("#868A86"));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
