import * as THREE from "three";

import { createRandom } from "@/engine/random";

import { drawRoundStain, makeCanvasTexture } from "./canvas";

// 콘크리트 블록 벽·민바닥·천장(전부 코드로 그린다). 텍스처에는 밝기 무늬(≈0.78~1.0)만 그리고
// 실제 색은 재질 color, 명암은 실시간 조명이 정한다 — 밝게 그려도 방 분위기는 어둡게 남는다.

const BLOCK_W = 0.66; // 블록 한 장 ≈ 20cm
const BLOCK_H = 0.33; // ≈ 10cm
const WALL_COLUMNS = 8; // 텍스처 한 장에 들어가는 블록 수
const WALL_ROWS = 16;

/** 벽 텍스처 한 장이 덮는 실제 가로(유닛) */
export const WALL_TEXTURE_W = BLOCK_W * WALL_COLUMNS;
/** 벽 텍스처 한 장이 덮는 실제 세로(유닛) — 캔버스가 정사각이라 가로와 같게 맞췄다 */
export const WALL_TEXTURE_H = BLOCK_H * WALL_ROWS;
/** 바닥 판 한 칸(유닛, ≈1.8 m) */
export const FLOOR_TEXTURE_SIZE = 6;
/** 천장 텍스처 한 장이 덮는 크기(유닛) — 칸 하나 2유닛 ≈ 0.6 m */
export const CEILING_TEXTURE_SIZE = 8;

const gray = (v: number) => `rgb(${v | 0},${v | 0},${v | 0})`;

export interface WallTextureOptions {
  /** 텍스처 한 장에 들어가는 블록 수 */
  columns?: number;
  rows?: number;
  /** 한 줄씩 어긋나는 정도(0.5 = 막쌓기, 0 = 격자) */
  stagger?: number;
  /** 물자국을 세로로 흘릴지(벽) 둥글게 번지게 할지(천장) */
  drips?: boolean;
  /** 아래로 갈수록 짙어지는 때(천장에는 위아래가 없다) */
  grimeBottom?: boolean;
}

const wallTextureCache = new Map<string, THREE.CanvasTexture>();

/** 콘크리트 블록 벽. 옵션을 주면 천장에도 쓴다(기본값은 벽 그대로). */
export function makeWallTexture(seed: number, wear = 0.7, options: WallTextureOptions = {}): THREE.CanvasTexture {
  const { columns = WALL_COLUMNS, rows = WALL_ROWS, stagger = 0.5, drips = true, grimeBottom = true } = options;
  const cacheKey = `${seed}|${wear}|${columns}|${rows}|${stagger}|${drips}|${grimeBottom}`;
  const cached = wallTextureCache.get(cacheKey);
  if (cached) return cached;
  const texture = makeCanvasTexture(1024, (g, S) => {
    const rnd = createRandom(seed);
    const bw = S / columns;
    const bh = S / rows;
    const joint = 4; // 줄눈 두께 px ≈ 1cm

    g.fillStyle = gray(196); // 줄눈 바탕 — 블록보다 어둡다
    g.fillRect(0, 0, S, S);

    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * bw * stagger;
      for (let c = -1; c < columns; c++) {
        let v = 240 + (rnd() - 0.5) * 11; // 블록마다 톤이 조금씩 다르다
        const pick = rnd();
        if (pick < 0.07)
          v -= 11; // 가끔 유난히 때 탄 블록
        else if (pick > 0.93) v += 8; // 가끔 유난히 밝은 블록
        g.fillStyle = gray(v);
        const x = c * bw + offset;
        // 캔버스 밖으로 나가는 블록은 반대쪽에도 그려야 이어진다
        for (const dx of [0, S]) g.fillRect(x + dx + joint / 2, r * bh + joint / 2, bw - joint, bh - joint);
      }
    }

    // 콘크리트 특유의 얼룩덜룩함
    for (let i = 0; i < 24; i++)
      drawRoundStain(
        g,
        S,
        rnd() * S,
        rnd() * S,
        50 + rnd() * 150,
        rnd() < 0.62 ? "58,58,58" : "255,255,255",
        0.03 + rnd() * 0.05,
      );

    if (drips) {
      for (let i = 0; i < 7; i++) {
        const x = rnd() * S;
        const w = 6 + rnd() * 26;
        const y0 = rnd() * S * 0.45;
        const length = S * (0.25 + rnd() * 0.6);
        const gradient = g.createLinearGradient(0, y0, 0, y0 + length);
        gradient.addColorStop(0, "rgba(64,62,58,0)");
        gradient.addColorStop(0.3, `rgba(64,62,58,${0.05 + rnd() * 0.08})`);
        gradient.addColorStop(1, "rgba(64,62,58,0)");
        g.fillStyle = gradient;
        for (const dx of [-S, 0]) g.fillRect(x + dx, y0, w, length);
      }
    } else {
      // 스며들어 번진 자국 — 가운데는 옅고 가장자리 테두리가 진하다
      for (let i = 0; i < 6; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const R = 45 + rnd() * 130;
        for (const dx of [-S, 0, S])
          for (const dy of [-S, 0, S]) {
            const gradient = g.createRadialGradient(x + dx, y + dy, R * 0.2, x + dx, y + dy, R);
            gradient.addColorStop(0, "rgba(70,66,58,0.09)");
            gradient.addColorStop(0.75, "rgba(70,66,58,0.05)");
            gradient.addColorStop(1, "rgba(70,66,58,0)");
            g.fillStyle = gradient;
            g.beginPath();
            g.arc(x + dx, y + dy, R, 0, 6.2832);
            g.fill();
            g.strokeStyle = "rgba(66,62,54,0.1)";
            g.lineWidth = 2.5;
            g.beginPath();
            g.arc(x + dx, y + dy, R * (0.72 + rnd() * 0.2), 0, 6.2832);
            g.stroke();
          }
      }
    }

    // 위 얼룩·물자국은 더러움이고, 아래 셋은 세월이다.
    if (wear > 0) {
      const a = wear;

      // 페인트 벗겨짐 — 너덜너덜한 조각 속으로 더 어두운 바탕이 드러난다
      for (let i = 0; i < Math.round(9 * a); i++) {
        const cx0 = rnd() * S;
        const cy0 = rnd() * S;
        const R = 18 + rnd() * 46;
        for (const dx of [-S, 0, S]) {
          g.beginPath();
          const n = 12;
          for (let k = 0; k <= n; k++) {
            const th = (k / n) * Math.PI * 2;
            // 반지름을 크게 흔들어 뜯어진 모양으로
            const rr = R * (0.55 + rnd() * 0.75);
            const px = cx0 + dx + Math.cos(th) * rr;
            const py = cy0 + Math.sin(th) * rr * 0.8;
            if (k) g.lineTo(px, py);
            else g.moveTo(px, py);
          }
          g.closePath();
          g.fillStyle = `rgba(120,114,104,${0.16 + rnd() * 0.14})`;
          g.fill();
        }
      }

      // 실금 — 마디마다 꺾이며 대체로 아래로
      for (let i = 0; i < Math.round(7 * a); i++) {
        const px = rnd() * S;
        const py = rnd() * S;
        const heading = (rnd() - 0.5) * 1.1 + Math.PI / 2;
        g.strokeStyle = `rgba(74,70,64,${0.22 + rnd() * 0.2})`;
        g.lineWidth = 1 + rnd() * 1.2;
        for (const dx of [-S, 0, S]) {
          g.beginPath();
          g.moveTo(px + dx, py);
          let qx = px + dx;
          let qy = py;
          const segments = 5 + ((rnd() * 5) | 0);
          for (let k = 0; k < segments; k++) {
            const L = 14 + rnd() * 40;
            const th = heading + (rnd() - 0.5) * 0.9;
            qx += Math.cos(th) * L;
            qy += Math.sin(th) * L;
            g.lineTo(qx, qy);
          }
          g.stroke();
        }
      }

      // 바닥에서 올라온 때 — 습기가 아래부터 먹는다
      if (grimeBottom) {
        const bottom = g.createLinearGradient(0, S * 0.55, 0, S);
        bottom.addColorStop(0, "rgba(58,54,48,0)");
        bottom.addColorStop(1, `rgba(58,54,48,${0.1 * a})`);
        g.fillStyle = bottom;
        g.fillRect(0, S * 0.55, S, S * 0.45);
      }
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  wallTextureCache.set(cacheKey, texture);
  return texture;
}

const floorTextureCache = new Map<number, THREE.CanvasTexture>();

/** 민바닥 콘크리트. 텍스처 한 장이 곧 판 한 칸이다(테두리에 줄눈). */
export function makeFloorTexture(seed: number): THREE.CanvasTexture {
  const cached = floorTextureCache.get(seed);
  if (cached) return cached;
  const texture = makeCanvasTexture(1024, (g, S) => {
    const rnd = createRandom(seed + 5100);
    g.fillStyle = gray(242);
    g.fillRect(0, 0, S, S);

    // 미장 자국 — 크고 옅은 얼룩을 겹친다
    for (let i = 0; i < 64; i++)
      drawRoundStain(
        g,
        S,
        rnd() * S,
        rnd() * S,
        40 + rnd() * 210,
        rnd() < 0.55 ? "70,68,64" : "255,255,255",
        0.02 + rnd() * 0.045,
      );

    // 자잘한 기포·찍힌 자국
    g.fillStyle = "rgba(96,94,90,0.30)";
    for (let i = 0; i < 290; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 0.8 + rnd() * 2.2;
      g.beginPath();
      g.arc(x, y, r, 0, 6.2832);
      g.fill();
    }
    for (let i = 0; i < 44; i++) drawRoundStain(g, S, rnd() * S, rnd() * S, 4 + rnd() * 8, "80,78,74", 0.14);

    // 판 경계 줄눈과 그 옆의 살짝 어두운 띠
    drawRoundStain(g, S, 0, S / 2, 26, "90,88,84", 0.06);
    drawRoundStain(g, S, S / 2, 0, 26, "90,88,84", 0.06);
    g.strokeStyle = "rgba(126,124,120,0.55)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, 1.5);
    g.lineTo(S, 1.5);
    g.moveTo(1.5, 0);
    g.lineTo(1.5, S);
    g.stroke();
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  floorTextureCache.set(seed, texture);
  return texture;
}

/** 천장 — 벽과 같은 그리기 코드를 크고 반듯한 격자로. 물자국은 번지고 아래 때는 없다. */
export function makeCeilingTexture(seed: number, wear = 0.7): THREE.CanvasTexture {
  return makeWallTexture(seed + 4400, wear, {
    columns: 4,
    rows: 4,
    stagger: 0,
    drips: false,
    grimeBottom: false,
  });
}
