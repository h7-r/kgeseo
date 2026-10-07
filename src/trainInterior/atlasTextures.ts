import * as THREE from "three";

import { makeRandom } from "@/engine/random";
import { cachedCanvasTexture, drawRoundStain } from "@/engine/textures/canvas";

import { drawSpill } from "./surfaceTextures";

// 아틀라스: 한 장을 N×N 칸으로 나눠 칸마다 다른 무늬를 그리고, 물건마다 다른 칸을 쓴다(mergeBoxes 의 uvCell).
// 좌석마다 텍스처를 따로 만들면 메모리가 12배, 하나만 쓰면 다 같은 얼룩이 된다.
// 흰 바탕이라 재질 color 에 곱해진다 — 색은 재질이 정하고 여기서는 어둡게(때) 또는 밝게(폼)만 그린다.

const ATLAS_CELL = 256;

type DrawCell = (g: CanvasRenderingContext2D, cell: number, rnd: () => number) => void;

function drawAtlas(g: CanvasRenderingContext2D, grid: number, seedOf: (index: number) => number, drawCell: DrawCell) {
  const size = grid * ATLAS_CELL;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, size, size);
  for (let row = 0; row < grid; row++)
    for (let column = 0; column < grid; column++) {
      const rnd = makeRandom(seedOf(row * grid + column));
      g.save();
      // 칸 밖으로 무늬가 새지 않게 잘라 둔다.
      g.beginPath();
      g.rect(column * ATLAS_CELL, row * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL);
      g.clip();
      g.translate(column * ATLAS_CELL, row * ATLAS_CELL);
      drawCell(g, ATLAS_CELL, rnd);
      g.restore();
    }
}

function atlasTexture(grid: number, seedOf: (index: number) => number, drawCell: DrawCell): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = grid * ATLAS_CELL;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("2D 캔버스를 만들 수 없습니다.");
  drawAtlas(g, grid, seedOf, drawCell);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * 좌석 받침대의 금 간 플라스틱. 매끈한 단색이면 시트만 낡고 받침은 새것처럼 보인다.
 * 금은 나뭇가지처럼 갈라지니 재귀로 뻗고, 옆에 밝은 선을 하나 더 그어 갈라진 단면을 만든다.
 */
export function crackTexture(grid = 4): THREE.CanvasTexture {
  return atlasTexture(
    grid,
    (index) => index * 431 + 53,
    (g, cell, rnd) => {
      // 아주 옅은 도장면 결. 없으면 플라스틱이 너무 매끈하다
      for (let i = 0; i < 60; i++)
        drawRoundStain(g, cell, rnd() * cell, rnd() * cell, 10 + rnd() * 40, "80,76,70", 0.015 + rnd() * 0.02);

      const drawCrack = (x: number, y: number, angle: number, length: number, depth: number) => {
        if (depth <= 0 || length < 4) return;
        const nx = x + Math.cos(angle) * length,
          ny = y + Math.sin(angle) * length;
        const mx = (x + nx) / 2 + (rnd() - 0.5) * length * 0.3,
          my = (y + ny) / 2 + (rnd() - 0.5) * length * 0.3;
        g.strokeStyle = `rgba(24,20,16,${0.5 + depth * 0.08})`;
        g.lineWidth = 0.9 + depth * 0.35;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(mx, my, nx, ny);
        g.stroke();
        g.strokeStyle = "rgba(255,255,255,0.3)";
        g.lineWidth = 0.6;
        g.beginPath();
        g.moveTo(x + 0.8, y + 0.8);
        g.quadraticCurveTo(mx + 0.8, my + 0.8, nx + 0.8, ny + 0.8);
        g.stroke();
        drawCrack(nx, ny, angle + (rnd() - 0.5) * 1.1, length * 0.68, depth - 1);
        if (rnd() < 0.55) drawCrack(nx, ny, angle + (rnd() - 0.5) * 2.2, length * 0.5, depth - 1);
      };

      // 칸마다 1~3줄기. 가장자리에서 시작하는 게 자연스럽다
      const crackCount = 1 + ((rnd() * 3) | 0);
      for (let i = 0; i < crackCount; i++) {
        const edge = (rnd() * 4) | 0;
        let x: number, y: number;
        if (edge === 0) {
          x = rnd() * cell;
          y = 0;
        } else if (edge === 1) {
          x = cell;
          y = rnd() * cell;
        } else if (edge === 2) {
          x = rnd() * cell;
          y = cell;
        } else {
          x = 0;
          y = rnd() * cell;
        }
        drawCrack(x, y, rnd() * 6.2832, 30 + rnd() * 40, 3 + ((rnd() * 2) | 0));
      }

      // 모서리 도장 벗겨짐
      const chipCount = (rnd() * 4) | 0;
      for (let i = 0; i < chipCount; i++) {
        const nearSide = rnd() < 0.5;
        const x = nearSide ? (rnd() < 0.5 ? rnd() * 30 : cell - rnd() * 30) : rnd() * cell;
        const y = nearSide ? rnd() * cell : rnd() < 0.5 ? rnd() * 30 : cell - rnd() * 30;
        g.fillStyle = `rgba(60,54,46,${0.15 + rnd() * 0.15})`;
        g.beginPath();
        g.ellipse(x, y, 3 + rnd() * 6, 2 + rnd() * 4, rnd() * 3, 0, 6.2832);
        g.fill();
      }
    },
  );
}

/** 여러 음료를 섞어 좌석마다 다른 느낌이 나게 한다. */
const SPILL_COLORS = [
  "88,60,36", // 커피
  "116,74,42", // 믹스커피·홍차
  "58,40,28", // 진하게 마른 커피
  "120,54,44", // 콜라·간장
  "134,72,58", // 주스(붉은)
  "150,120,60", // 오렌지·기름때(누런)
  "78,84,92", // 물때(회)
  "92,74,96", // 포도·와인(자줏빛)
];

/** 좌석 천 — 코듀로이 결, 반들거림, 흘린 얼룩, 뜯어진 시트. 좌석 색은 Leva 「좌석천색」이 정한다. */
export function seatFabricTexture(grid = 4): THREE.CanvasTexture {
  return atlasTexture(
    grid,
    (index) => index * 761 + 17,
    (g, cell, rnd) => {
      // 세로 골 — 천이라는 걸 알려 준다
      for (let x = 0; x < cell; x += 7) {
        g.fillStyle = "rgba(96,90,82,0.07)";
        g.fillRect(x, 0, 2.5, cell);
        g.fillStyle = "rgba(255,255,255,0.06)";
        g.fillRect(x + 2.5, 0, 1, cell);
      }
      // 미세한 점 노이즈. 없으면 플라스틱처럼 매끈해 보인다
      for (let i = 0; i < 520; i++) {
        g.fillStyle = `rgba(110,104,96,${0.02 + rnd() * 0.03})`;
        g.fillRect(rnd() * cell, rnd() * cell, 1, 1 + rnd() * 1.4);
      }
      // 몸이 닿아 반들거리는 가운데
      const worn = g.createRadialGradient(cell / 2, cell * 0.55, 0, cell / 2, cell * 0.55, cell * 0.5);
      worn.addColorStop(0, "rgba(255,255,255,0.10)");
      worn.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = worn;
      g.fillRect(0, 0, cell, cell);

      // 전부 얼룩투성이면 가짜로 보인다. 완전히 깨끗한 자리는 드물게.
      const spillCount = rnd() < 0.15 ? 0 : rnd() < 0.7 ? 1 : 2;
      for (let i = 0; i < spillCount; i++) {
        const x = 34 + rnd() * (cell - 68),
          y = 28 + rnd() * (cell - 78), // 아래로 흘러내릴 여백
          size = 16 + rnd() * 26;
        const rgb = SPILL_COLORS[(rnd() * SPILL_COLORS.length) | 0];
        drawSpill(g, x, y, size, rgb, rnd);
      }

      // 뜯어진 시트 0~2개 — 찢긴 구멍 + 드러난 폼 + 삐져나온 실밥
      const tearCount = rnd() < 0.72 ? 1 + ((rnd() * 2) | 0) : 0;
      for (let i = 0; i < tearCount; i++) {
        const x = 40 + rnd() * (cell - 80),
          y = 40 + rnd() * (cell - 80),
          len = 22 + rnd() * 44,
          angle = rnd() * 6.2832;
        g.save();
        g.translate(x, y);
        g.rotate(angle);
        g.fillStyle = "rgba(22,18,14,0.88)";
        g.beginPath();
        const points = 9;
        for (let k = 0; k <= points; k++) {
          const a = (k / points) * 6.2832;
          const rr = (k % 2 ? len * 0.14 : len * 0.5) * (0.55 + rnd() * 0.55);
          const px = Math.cos(a) * rr * 1.7,
            py = Math.sin(a) * rr * 0.45;
          if (k) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.closePath();
        g.fill();
        g.fillStyle = "rgba(214,198,156,0.92)";
        g.beginPath();
        for (let k = 0; k <= 7; k++) {
          const a = (k / 7) * 6.2832;
          const rr = len * 0.3 * (0.5 + rnd() * 0.5);
          const px = Math.cos(a) * rr * 1.5,
            py = Math.sin(a) * rr * 0.4;
          if (k) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.closePath();
        g.fill();
        g.fillStyle = "rgba(120,104,70,0.4)";
        g.beginPath();
        g.ellipse(0, len * 0.08, len * 0.3, len * 0.1, 0, 0, 6.2832);
        g.fill();
        g.strokeStyle = "rgba(38,32,26,0.6)";
        g.lineWidth = 1;
        for (let k = 0; k < 6; k++) {
          const a = (rnd() - 0.5) * 3.2;
          g.beginPath();
          g.moveTo((rnd() - 0.5) * len, 0);
          g.lineTo(Math.cos(a) * len * 0.7, Math.sin(a) * len * 0.3 - rnd() * 7);
          g.stroke();
        }
        g.restore();
      }

      // 앉는 면 앞쪽이 제일 더럽다
      const grime = g.createLinearGradient(0, cell * 0.62, 0, cell);
      grime.addColorStop(0, "rgba(0,0,0,0)");
      grime.addColorStop(1, "rgba(48,42,34,0.2)");
      g.fillStyle = grime;
      g.fillRect(0, cell * 0.62, cell, cell * 0.38);
    },
  );
}

/**
 * 깨진 형광등 커버. 충격점에서 방사형으로 쪼개진 파편, 떨어져 나간 구멍, 그을음을 칸마다 다르게 그린다.
 * 흰 바탕에 곱해지므로 켜진 등이든 꺼진 등이든 금·구멍이 어둡게 보인다.
 */
export function brokenLampTexture(grid = 4): THREE.CanvasTexture {
  return cachedCanvasTexture(
    `trainBrokenLamp|${grid}`,
    (g) =>
      drawAtlas(
        g,
        grid,
        (index) => index * 271 + 89,
        (g, cell, rnd) => {
          // 관 여러 개의 세로 결
          for (let x = 0; x < cell; x += cell / 4) {
            g.fillStyle = "rgba(180,180,175,0.06)";
            g.fillRect(x, 0, cell / 4 - 2, cell);
            g.fillStyle = "rgba(0,0,0,0.03)";
            g.fillRect(x - 1, 0, 2, cell);
          }

          // 누렇게 뜬 그을음·벌레 자국
          const sootCount = 1 + ((rnd() * 3) | 0);
          for (let i = 0; i < sootCount; i++)
            drawRoundStain(
              g,
              cell,
              rnd() * cell,
              rnd() * cell,
              20 + rnd() * 50,
              rnd() < 0.5 ? "150,130,70" : "60,54,44",
              0.06 + rnd() * 0.08,
            );

          // 충격점. 거미줄이 아니라 큰 파편으로 쪼개진다 — 방사 균열 사이사이가 조각 하나다.
          const cx = cell * (0.32 + rnd() * 0.36),
            cy = cell * (0.32 + rnd() * 0.36);
          const rayCount = 5 + ((rnd() * 3) | 0);
          const angles: number[] = [];
          for (let i = 0; i < rayCount; i++) angles.push((i / rayCount) * 6.2832 + (rnd() - 0.5) * 0.7);
          angles.sort((a, b) => a - b);
          const reach = cell * 1.5; // 칸 밖까지 채우고 clip 으로 자른다

          // 조각마다 밝기를 미세하게 달리해 다른 각도로 튀어나온 유리처럼. 일부는 빠져 구멍이 된다.
          for (let i = 0; i < angles.length; i++) {
            const a1 = angles[i],
              a2 = angles[(i + 1) % angles.length] + (i + 1 >= angles.length ? 6.2832 : 0);
            const isMissing = rnd() < 0.22;
            g.beginPath();
            g.moveTo(cx, cy);
            // 바깥 경계를 살짝 울퉁불퉁하게
            const segments = 3;
            for (let k = 0; k <= segments; k++) {
              const a = a1 + ((a2 - a1) * k) / segments;
              const rr = reach * (0.85 + rnd() * 0.3);
              g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
            }
            g.closePath();
            if (isMissing) {
              g.fillStyle = "rgba(16,14,12,0.82)";
            } else {
              const tint = (rnd() - 0.55) * 0.14; // -0.08 ~ +0.06
              const v = Math.round(255 * (1 + tint));
              g.fillStyle = `rgba(${v},${v},${Math.round(v * 0.99)},0.9)`;
            }
            g.fill();
          }

          // 조각 경계 — 어두운 금 + 옆에 밝은 단면
          for (const a of angles) {
            const rr = reach;
            const ex = cx + Math.cos(a) * rr,
              ey = cy + Math.sin(a) * rr;
            const mx = cx + Math.cos(a) * rr * 0.5 + (rnd() - 0.5) * 12,
              my = cy + Math.sin(a) * rr * 0.5 + (rnd() - 0.5) * 12;
            g.strokeStyle = "rgba(32,30,26,0.65)";
            g.lineWidth = 1 + rnd() * 1.2;
            g.beginPath();
            g.moveTo(cx, cy);
            g.quadraticCurveTo(mx, my, ex, ey);
            g.stroke();
            g.strokeStyle = "rgba(255,255,255,0.4)";
            g.lineWidth = 0.6;
            g.beginPath();
            g.moveTo(cx + 0.9, cy + 0.9);
            g.quadraticCurveTo(mx + 0.9, my + 0.9, ex + 0.9, ey + 0.9);
            g.stroke();
          }

          // 완전히 부서진 중심
          g.fillStyle = "rgba(14,12,10,0.7)";
          g.beginPath();
          g.arc(cx, cy, 3 + rnd() * 4, 0, 6.2832);
          g.fill();
        },
      ),
    { width: grid * ATLAS_CELL, anisotropy: null },
  );
}

/** 입구 반대편 창밖 — 이미지 없이 거의 검정에 아주 희미한 빛 두 점. */
export function darkOutsideTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D 캔버스를 만들 수 없습니다.");
  g.fillStyle = "#070910";
  g.fillRect(0, 0, 256, 256);
  for (const [x, y, r, a] of [
    [70, 95, 140, 0.16],
    [185, 150, 100, 0.1],
  ]) {
    const gradient = g.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(120,132,152,${a})`);
    gradient.addColorStop(1, "rgba(120,132,152,0)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 256, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
