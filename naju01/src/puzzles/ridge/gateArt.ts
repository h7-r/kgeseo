/** 진부촌 문의 그림 — 장승 고리 둘레의 새김, 장승 몸의 이름, 돌단. 단위는 미터 */
import * as THREE from "three";

import { createCanvas, makeTextureFromCanvas } from "@/engine/textures/canvas";

import { M } from "../units";
import { ALTAR } from "./ridgeShape";
import { makeVertexColorMaterial } from "./vertexPaint";

type Draw = (g: CanvasRenderingContext2D) => void;

/** 고리 그림 넷 — 칸 차례대로. 칸 한 변 cell, 가운데 mid 기준 */
function symbolDrawers(cell: number, mid: number): Draw[] {
  return [
    // 해 — 동그라미와 짧은 빛살 여덟
    (g) => {
      g.beginPath();
      g.arc(mid, mid, 20, 0, Math.PI * 2);
      g.stroke();
      for (let k = 0; k < 8; k++) {
        const angle = (k / 8) * Math.PI * 2;
        g.beginPath();
        g.moveTo(mid + Math.cos(angle) * 30, mid + Math.sin(angle) * 30);
        g.lineTo(mid + Math.cos(angle) * 44, mid + Math.sin(angle) * 44);
        g.stroke();
      }
    },
    // 달 — 초승달
    (g) => {
      g.beginPath();
      g.arc(mid, mid, 38, Math.PI * 0.3, Math.PI * 1.7);
      g.arc(mid + 18, mid, 30, Math.PI * 1.62, Math.PI * 0.38, true);
      g.closePath();
      g.fill();
    },
    // 물결 — 세 줄
    (g) => {
      for (let row = -1; row <= 1; row++) {
        g.beginPath();
        for (let x = 14; x <= cell - 14; x += 4) g.lineTo(x, mid + row * 22 + Math.sin(x * 0.11) * 7);
        g.stroke();
      }
    },
    // 새 — 날개 편 새 한 마리
    (g) => {
      g.beginPath();
      g.moveTo(14, mid - 4);
      g.quadraticCurveTo(40, mid - 34, mid, mid + 6);
      g.quadraticCurveTo(cell - 40, mid - 34, cell - 14, mid - 4);
      g.stroke();
      g.beginPath();
      g.arc(mid, mid + 12, 7, 0, Math.PI * 2);
      g.fill();
    },
  ];
}

/** 고리 둘레 그림 — 여덟 면 중 짝수 면에 그림, 홀수 면에 홈 두 줄. 나무 바탕에 판 홈(어둡게) + 아래 턱(밝게) */
export function makeRingTexture() {
  const cell = 128;
  const { canvas, g } = createCanvas(cell * 8, cell);
  g.fillStyle = "#7E5E40";
  g.fillRect(0, 0, canvas.width, canvas.height);
  // 결
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = `rgba(40,26,14,${0.08 + Math.random() * 0.1})`;
    g.lineWidth = 1 + Math.random() * 2;
    const y = Math.random() * cell;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= canvas.width; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
    g.stroke();
  }
  const carve = (draw: Draw, x: number) => {
    for (const [dx, dy, color] of [
      [1.5, 2.5, "rgba(214,184,140,0.6)"],
      [0, 0, "#22160C"],
    ] as const) {
      g.save();
      g.translate(x + dx, dy);
      g.strokeStyle = color;
      g.fillStyle = color;
      g.lineWidth = 7;
      g.lineCap = "round";
      g.lineJoin = "round";
      draw(g);
      g.restore();
    }
  };
  const mid = cell / 2;
  const symbols = symbolDrawers(cell, mid);
  for (let face = 0; face < 8; face++) {
    const x = face * cell;
    if (face % 2 === 0) carve(symbols[face / 2], x);
    else
      carve((ctx) => {
        for (const y of [mid - 16, mid + 16]) {
          ctx.beginPath();
          ctx.moveTo(26, y);
          ctx.lineTo(cell - 26, y);
          ctx.stroke();
        }
      }, x);
  }
  // 위아래 테 홈
  g.fillStyle = "#3A2614";
  g.fillRect(0, 0, canvas.width, 6);
  g.fillRect(0, cell - 6, canvas.width, 6);
  return makeTextureFromCanvas(canvas, 4);
}

/** 장승 몸에 새긴 이름 — 세로 글씨, 바탕은 비우고 판 홈만 */
export function makeNameTexture(name: string) {
  const { canvas, g } = createCanvas(128, 128 * name.length);
  // 칸(128)보다 넉넉히 작게 — 획 끝이 판 가장자리에서 잘리지 않게
  g.font = '800 84px "Nanum Myeongjo","AppleMyungjo","Batang",serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  [...name].forEach((ch, i) => {
    const y = 64 + i * 128;
    g.fillStyle = "rgba(200,168,124,0.55)";
    g.fillText(ch, 66, y + 3);
    g.fillStyle = "#170E07";
    g.fillText(ch, 64, y);
  });
  return makeTextureFromCanvas(canvas);
}

/** 돌단 — 땅에서 살짝 솟은 넓적한 바위. 윗면만 반듯하게 깎였다 */
export function buildAltar() {
  const geometry = new THREE.DodecahedronGeometry(1, 1);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    const bump = 1 + Math.sin(vertex.x * 5.1 + vertex.z * 3.7) * 0.06;
    vertex.set(vertex.x * 0.66 * bump, Math.min(vertex.y, 0.62) * 0.5, vertex.z * 0.52 * bump);
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  // 윗면(깎은 면)이 ALTAR.top 에 오게
  geometry.translate(0, ALTAR.top - 0.31, 0);
  geometry.computeVertexNormals();
  const colors = new Float32Array(position.count * 3);
  const base = new THREE.Color("#7C766C");
  const tone = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    tone.copy(base).offsetHSL(0, 0, Math.sin(i * 12.9898) * 0.5 * 0.06 + (y > ALTAR.top - 0.01 ? 0.06 : -0.02));
    tone.toArray(colors, i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geometry, makeVertexColorMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.scale.setScalar(M);
  return mesh;
}
