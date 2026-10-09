import * as THREE from "three";

import { createRandom } from "@/engine/random";
import { drawGrain, drawRoundStain, makeCanvasTexture } from "@/engine/textures/canvas";

// 역의 낡은 느낌은 색이 아니라 캔버스로 그린 질감(벗겨진 페인트·물자국·때)에서 나온다.
// 같은 도구로 기차용 무늬를 그린다. 역의 블록 무늬는 기차 벽에 있으면 이상해서 쓰지 않는다.

const wallTextureCache = new Map<string, THREE.CanvasTexture>();

/** 객차 벽. 금속판을 세로로 이어 붙인 이음매와 리벳이 있어야 콘크리트가 아니라 차량 내부로 읽힌다. */
export function makeTrainWallTexture(seed: number, wear = 1): THREE.CanvasTexture {
  const key = `${seed}|${wear}`;
  const cached = wallTextureCache.get(key);
  if (cached) return cached;
  const texture = makeCanvasTexture(1024, (g, S) => {
    const rnd = createRandom(seed * 331 + 17);
    // 실제 색은 재질 color 가 곱해서 정한다.
    g.fillStyle = "rgb(238,238,238)";
    g.fillRect(0, 0, S, S);

    // 세로 패널 이음매 8칸. 양옆 음영으로 판이 떠 보이게
    const cell = S / 8;
    for (let i = 0; i <= 8; i++) {
      const x = i * cell;
      g.fillStyle = "rgba(120,118,114,0.45)";
      g.fillRect(x - 1.5, 0, 3, S);
      g.fillStyle = "rgba(255,255,255,0.30)";
      g.fillRect(x + 1.5, 0, 3, S);
      g.fillStyle = "rgba(150,148,144,0.10)";
      g.fillRect(x - 10, 0, 8, S);
    }

    // 리벳
    for (let i = 0; i <= 8; i++) {
      const x = i * cell;
      for (let y = 14; y < S; y += 46) {
        g.fillStyle = "rgba(120,118,114,0.5)";
        g.beginPath();
        g.arc(x, y, 2.6, 0, 6.2832);
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.45)";
        g.beginPath();
        g.arc(x - 0.8, y - 0.8, 1.4, 0, 6.2832);
        g.fill();
      }
    }

    // 벗겨져 밑칠이 드러난 자리. 고르게 어둡게 칠하면 '세월'이 아니라 '더러움'이 된다.
    const peelCount = Math.round(18 * wear);
    for (let i = 0; i < peelCount; i++) {
      const x = rnd() * S,
        y = rnd() * S,
        w = 8 + rnd() * 54,
        h = 6 + rnd() * 30;
      g.save();
      g.translate(x, y);
      g.rotate((rnd() - 0.5) * 1.2);
      g.fillStyle = `rgba(126,116,102,${0.1 + rnd() * 0.16})`;
      g.beginPath();
      // 타원이면 스티커처럼 보여 꼭짓점을 흔든다.
      const points = 7;
      for (let k = 0; k <= points; k++) {
        const a = (k / points) * 6.2832;
        const r = 1 + (rnd() - 0.5) * 0.5;
        const px = (Math.cos(a) * w * r) / 2;
        const py = (Math.sin(a) * h * r) / 2;
        if (k === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.restore();
    }

    // 흘러내린 물자국
    const dripCount = Math.round(9 * wear);
    for (let i = 0; i < dripCount; i++) {
      const x = rnd() * S;
      const y0 = rnd() * S * 0.4;
      const length = S * (0.25 + rnd() * 0.5);
      const w = 3 + rnd() * 9;
      const gradient = g.createLinearGradient(0, y0, 0, y0 + length);
      gradient.addColorStop(0, `rgba(108,96,78,${0.16 * wear})`);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gradient;
      g.fillRect(x, y0, w, length);
    }

    // 발끝 높이가 제일 더럽다.
    const grime = g.createLinearGradient(0, S * 0.62, 0, S);
    grime.addColorStop(0, "rgba(0,0,0,0)");
    grime.addColorStop(1, `rgba(58,50,40,${0.3 * wear})`);
    g.fillStyle = grime;
    g.fillRect(0, S * 0.62, S, S * 0.38);

    // 갈라진 페인트. 어두운 금 옆의 밝은 선이 갈라진 단면의 입체감을 준다.
    const drawCrack = (x: number, y: number, angle: number, length: number, depth: number) => {
      if (depth <= 0 || length < 5) return;
      const nx = x + Math.cos(angle) * length,
        ny = y + Math.sin(angle) * length;
      const mx = (x + nx) / 2 + (rnd() - 0.5) * length * 0.35,
        my = (y + ny) / 2 + (rnd() - 0.5) * length * 0.35;
      g.strokeStyle = `rgba(70,66,58,${(0.28 + depth * 0.06) * wear})`;
      g.lineWidth = 0.8 + depth * 0.4;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(mx, my, nx, ny);
      g.stroke();
      g.strokeStyle = `rgba(255,255,255,${0.3 * wear})`;
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(x + 0.9, y + 0.9);
      g.quadraticCurveTo(mx + 0.9, my + 0.9, nx + 0.9, ny + 0.9);
      g.stroke();
      drawCrack(nx, ny, angle + (rnd() - 0.5) * 1.0, length * 0.7, depth - 1);
      if (rnd() < 0.5) drawCrack(nx, ny, angle + (rnd() - 0.5) * 2.1, length * 0.5, depth - 1);
    };
    const crackCount = Math.round(4 * wear);
    for (let i = 0; i < crackCount; i++)
      drawCrack(rnd() * S, rnd() * S, rnd() * 6.2832, 60 + rnd() * 90, 3 + ((rnd() * 2) | 0));

    // 통째로 떨어져 나간 페인트 조각
    const chipCount = Math.round(6 * wear);
    for (let i = 0; i < chipCount; i++) {
      const x = rnd() * S,
        y = rnd() * S,
        r0 = 6 + rnd() * 22;
      g.fillStyle = `rgba(120,112,100,${(0.12 + rnd() * 0.12) * wear})`;
      g.beginPath();
      const points = 5 + ((rnd() * 3) | 0);
      for (let k = 0; k <= points; k++) {
        const a = (k / points) * 6.2832;
        const rr = r0 * (0.5 + rnd() * 0.7);
        const px = x + Math.cos(a) * rr,
          py = y + Math.sin(a) * rr;
        if (k) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = `rgba(255,255,255,${0.2 * wear})`;
      g.lineWidth = 0.8;
      g.stroke();
    }

    drawGrain(g, S, S, seed, wear);
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  wallTextureCache.set(key, texture);
  return texture;
}

const floorTextureCache = new Map<number, THREE.CanvasTexture>();

/** 리놀륨 바닥 — 미끄럼 방지 홈, 때, 발자국, 흘린 얼룩, 긁힘, 형광등 유리 파편. */
export function makeTrainFloorTexture(seed: number): THREE.CanvasTexture {
  const cached = floorTextureCache.get(seed);
  if (cached) return cached;
  const texture = makeCanvasTexture(1024, (g, S) => {
    const rnd = createRandom(seed * 577 + 41);
    g.fillStyle = "rgb(236,236,236)";
    g.fillRect(0, 0, S, S);

    // 세로로 촘촘한 미끄럼 방지 홈 — 객차 바닥의 상징 같은 무늬
    for (let x = 0; x < S; x += 13) {
      g.fillStyle = "rgba(120,118,114,0.22)";
      g.fillRect(x, 0, 4, S);
      g.fillStyle = "rgba(255,255,255,0.16)";
      g.fillRect(x + 4, 0, 2, S);
    }
    for (let i = 0; i < 60; i++)
      drawRoundStain(
        g,
        S,
        rnd() * S,
        rnd() * S,
        30 + rnd() * 160,
        rnd() < 0.7 ? "58,50,38" : "255,255,255",
        0.03 + rnd() * 0.07,
      );

    // 신발 자국 — 발바닥 + 뒤꿈치
    for (let i = 0; i < 22; i++) {
      const x = rnd() * S,
        y = rnd() * S,
        angle = rnd() * 6.2832,
        sc = 0.7 + rnd() * 0.8;
      g.save();
      g.translate(x, y);
      g.rotate(angle);
      g.fillStyle = `rgba(46,40,32,${0.1 + rnd() * 0.12})`;
      g.beginPath();
      g.ellipse(0, 0, 8 * sc, 16 * sc, 0, 0, 6.2832);
      g.fill();
      g.beginPath();
      g.ellipse(0, 22 * sc, 6 * sc, 8 * sc, 0, 0, 6.2832);
      g.fill();
      g.restore();
    }

    for (let i = 0; i < 5; i++) {
      const kind = rnd();
      const rgb = kind < 0.5 ? "70,48,28" : kind < 0.8 ? "58,64,72" : "90,74,40";
      drawSpill(g, rnd() * S, rnd() * S * 0.9, 25 + rnd() * 45, rgb, rnd);
    }

    // 끌린 자국
    for (let i = 0; i < 140; i++) {
      g.strokeStyle = `rgba(90,84,74,${0.06 + rnd() * 0.14})`;
      g.lineWidth = 0.7 + rnd() * 1.6;
      const x = rnd() * S,
        y = rnd() * S,
        L = 8 + rnd() * 70,
        a = rnd() * 6.2832;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
      g.stroke();
    }

    // 형광등에서 떨어진 유리 파편 — 각진 조각 + 반짝임 + 옅은 그림자
    for (let i = 0; i < 70; i++) {
      const x = rnd() * S,
        y = rnd() * S,
        sz = 1.5 + rnd() * 6;
      g.fillStyle = `rgba(214,222,230,${0.14 + rnd() * 0.2})`;
      g.beginPath();
      const points = 3 + ((rnd() * 2) | 0);
      for (let k = 0; k <= points; k++) {
        const a = (k / points) * 6.2832 + rnd() * 0.6;
        const rr = sz * (0.5 + rnd() * 0.8);
        const px = x + Math.cos(a) * rr,
          py = y + Math.sin(a) * rr;
        if (k) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.closePath();
      g.fill();
      if (rnd() < 0.6) {
        g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.4})`;
        g.beginPath();
        g.arc(x + (rnd() - 0.5) * sz, y + (rnd() - 0.5) * sz, 0.6 + rnd() * 0.9, 0, 6.2832);
        g.fill();
      }
      g.fillStyle = "rgba(40,36,30,0.12)";
      g.beginPath();
      g.ellipse(x + sz * 0.5, y + sz * 0.6, sz * 0.9, sz * 0.5, 0, 0, 6.2832);
      g.fill();
    }

    drawGrain(g, S, S, seed + 90, 1.3);
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  floorTextureCache.set(seed, texture);
  return texture;
}

/**
 * 흘린 음료 자국 하나. 둥근 원은 인위적이다 — 불규칙하게 번지고, 마르며 테두리가 진해지고(커피링),
 * 아래로 흘러내리고, 방울이 튀어야 흘린 자국으로 읽힌다.
 */
export function drawSpill(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  rgb: string,
  rnd: () => number,
) {
  const N = 14;
  // 몸통과 링이 같은 아메바 모양을 쓰게 외곽 반지름을 한 번만 정한다.
  const radii: number[] = [];
  for (let k = 0; k < N; k++) radii.push(size * (0.5 + rnd() * 0.6));
  const tracePath = (scale: number, sag: number) => {
    g.beginPath();
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * 6.2832;
      const rr = radii[k % N] * scale;
      const py = Math.sin(a) * rr * (Math.sin(a) > 0 ? sag : 1); // 아래로 처짐
      const x = cx + Math.cos(a) * rr,
        y = cy + py;
      if (k) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
  };
  g.save();
  g.filter = "blur(2.5px)";
  tracePath(1.18, 1.28);
  g.fillStyle = `rgba(${rgb},0.045)`;
  g.fill();
  tracePath(1.0, 1.18);
  g.fillStyle = `rgba(${rgb},0.085)`;
  g.fill();
  tracePath(0.62, 1.12);
  g.fillStyle = `rgba(${rgb},0.11)`;
  g.fill();
  g.filter = "none";
  // 커피링 — 마른 가장자리가 제일 진하다
  tracePath(1.0, 1.18);
  g.strokeStyle = `rgba(${rgb},0.3)`;
  g.lineWidth = 1.3 + rnd() * 1.2;
  g.stroke();
  g.restore();

  // 흘러내린 줄기는 0~1 가닥. 많으면 지저분해진다.
  const streakCount = rnd() < 0.5 ? 1 : 0;
  for (let i = 0; i < streakCount; i++) {
    const sx = cx + (rnd() - 0.5) * size * 0.9;
    const sy = cy + size * 0.55;
    const len = size * (0.5 + rnd() * 1.3);
    const w = 1.5 + rnd() * 3;
    const gradient = g.createLinearGradient(0, sy, 0, sy + len);
    gradient.addColorStop(0, `rgba(${rgb},0.16)`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gradient;
    g.beginPath();
    g.moveTo(sx - w, sy);
    g.quadraticCurveTo(sx - w * 0.2, sy + len * 0.5, sx - w * 0.15, sy + len);
    g.lineTo(sx + w * 0.15, sy + len);
    g.quadraticCurveTo(sx + w * 0.2, sy + len * 0.5, sx + w, sy);
    g.closePath();
    g.fill();
    g.fillStyle = `rgba(${rgb},0.14)`;
    g.beginPath();
    g.arc(sx, sy + len, w * 0.8, 0, 6.2832);
    g.fill();
  }

  // 튄 방울은 절반만, 2~3개만 가까이. 많으면 점 노이즈로 보인다.
  if (rnd() < 0.5) {
    const dropCount = 2 + ((rnd() * 2) | 0);
    for (let i = 0; i < dropCount; i++) {
      const a = rnd() * 6.2832,
        d = size * (0.6 + rnd() * 0.6);
      const bx = cx + Math.cos(a) * d,
        by = cy + Math.sin(a) * d * 0.85;
      g.fillStyle = `rgba(${rgb},${0.1 + rnd() * 0.14})`;
      g.beginPath();
      g.arc(bx, by, 0.6 + rnd() * 1.6, 0, 6.2832);
      g.fill();
    }
  }
}
