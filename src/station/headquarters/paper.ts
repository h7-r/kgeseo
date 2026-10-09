import * as THREE from "three";

import { createRandom } from "@/engine/random";
import { drawGrain, makeCachedCanvasTexture } from "@/engine/textures/canvas";
import { TOON_GRADIENT } from "@/engine/toon";

import { BOARD_FONT_FAMILY, loadBoardFont } from "./handwriting";

// A4(210×297mm)를 씬 축척으로 — 책상 윗면 2.44 = 실제 0.73m 라 1m ≈ 3.34 유닛.
export const PAPER_W = 0.21 * 3.34;
export const PAPER_D = 0.297 * 3.34;

/** 글씨 종류. Leva 선택지 값이자 저장 데이터라 글자를 바꾸지 않는다. 0 = 섞기(시드로 하나를 뽑는다). */
export const PAPER_STYLES = ["섞기", "보고서", "표·서식", "손글씨메모", "체크리스트"];

/** 서류 더미가 책상 윗면 아래로 파묻히는 깊이. 0 이면 두 면이 같은 높이라 z-fighting 이 난다. */
export const PAPER_SINK_DEPTH = 0.01;

/** 포스트잇 파스텔 4색. 순서대로 돌려 쓴다. */
export const STICKY_COLORS = ["#F0E5A2", "#F2C9CF", "#C8E3BE", "#BFD5EC"];

/** 포스트잇 메모 — 이 방의 수사 내용과 이어지는 문구 */
export const STICKY_TEXTS = [
  ["완사천", "재확인"],
  ["187 → 190", "낙장?"],
  ["출처", "확인 요"],
  ["8/25", "재봉인"],
  ["지적도", "대조"],
];

// 바탕을 흰색으로 그려 재질 색(파스텔)과 곱하면 색종이에 쓴 글씨가 된다.
function drawSticky(g: CanvasRenderingContext2D, width: number, height: number, index: number) {
  g.clearRect(0, 0, width, height);
  g.fillStyle = "#FFFFFF";
  g.fillRect(0, 0, width, height);
  const lines = STICKY_TEXTS[index % STICKY_TEXTS.length];
  g.fillStyle = "#3E434D";
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((text, k) => {
    // 줄마다 크기·기울기를 달리해 갈겨 쓴 티를 낸다
    g.font = `400 ${Math.round(height * (k === 0 ? 0.21 : 0.18))}px ${BOARD_FONT_FAMILY}`;
    g.save();
    g.translate(width / 2, height * (0.38 + k * 0.26));
    g.rotate(-0.04 + k * 0.05);
    g.fillText(text, 0, 0);
    g.restore();
  });
  drawGrain(g, width, height, 300 + index, 0.5);
}

function makeStickyTexture(index: number): THREE.CanvasTexture {
  return makeCachedCanvasTexture(`sticky|${index}`, (g, width, height) => drawSticky(g, width, height, index), {
    width: 192,
    // 폰트 없이 먼저 그려 두고, 손글씨 폰트가 오면 다시 그린다.
    onCreate: (texture, canvas) => {
      void loadBoardFont().then(() => {
        const g = canvas.getContext("2d", { willReadFrequently: true });
        if (!g) return;
        drawSticky(g, canvas.width, canvas.height, index);
        texture.needsUpdate = true;
      });
    },
  });
}

const stickyMaterialCache = new Map<string, THREE.MeshToonMaterial[]>();

/** 포스트잇 상자 재질 6면. 윗면(BoxGeometry 2번)만 글씨 텍스처. 색×글 조합마다 한 벌. */
export function getStickyMaterials(colorIndex: number, textIndex: number): THREE.MeshToonMaterial[] {
  const key = `${colorIndex}-${textIndex}`;
  let materials = stickyMaterialCache.get(key);
  if (!materials) {
    const color = STICKY_COLORS[colorIndex];
    const side = new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT });
    const top = new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT, map: makeStickyTexture(textIndex) });
    materials = [side, side, top, side, side, side];
    stickyMaterialCache.set(key, materials);
  }
  return materials;
}

/**
 * 글이 적힌 A4. 진짜 글자 대신 글줄처럼 보이는 회색 막대를 그린다 — 게임 거리에서는 이게 더 자연스럽다.
 * style: 0 섞기 / 1 보고서 / 2 표·서식 / 3 손글씨메모 / 4 체크리스트
 */
function drawPaper(g: CanvasRenderingContext2D, width: number, height: number, seed: number, style: number) {
  const rnd = createRandom(seed * 131 + style * 7 + 1);

  g.fillStyle = "#FFFFFF";
  g.fillRect(0, 0, width, height);

  const margin = 26;
  const textWidth = width - margin * 2;
  const layout = style === 0 ? 1 + ((rnd() * 4) | 0) : style;

  // 메모지에는 제목이 없다.
  let y = 30;
  if (layout !== 3) {
    g.fillStyle = "#6B7280";
    g.fillRect(margin, y, textWidth * (0.4 + rnd() * 0.25), 9);
    g.fillStyle = "#B9BEC7";
    g.fillRect(margin, y + 18, textWidth * (0.24 + rnd() * 0.2), 5);
    g.fillStyle = "#9AA0AA";
    g.fillRect(margin, y + 32, textWidth, 1);
    y += 46;
  } else {
    y = 42;
  }

  // 연하고 성기게 — 빽빽하면 멀리서 시끄럽다.
  const line = (top: number, lineWidth: number, isDark: boolean) => {
    g.fillStyle = isDark ? "#A9AEB8" : "#D6DAE1";
    g.fillRect(margin, top, lineWidth, 3);
  };
  const table = (top: number, rows: number, rowHeight: number) => {
    g.lineWidth = 1;
    g.strokeStyle = "#D8DCE3";
    for (let r = 0; r <= rows; r++) {
      g.beginPath();
      g.moveTo(margin, top + r * rowHeight);
      g.lineTo(margin + textWidth, top + r * rowHeight);
      g.stroke();
    }
    [0, 0.32, 0.6, 0.8, 1].forEach((f) => {
      g.beginPath();
      g.moveTo(margin + textWidth * f, top);
      g.lineTo(margin + textWidth * f, top + rows * rowHeight);
      g.stroke();
    });
    for (let r = 0; r < rows; r++)
      [0.03, 0.35, 0.63, 0.83].forEach((f) => {
        g.fillStyle = r === 0 ? "#A9AEB8" : "#CDD2D9";
        g.fillRect(margin + textWidth * f, top + r * rowHeight + 4, textWidth * (0.07 + rnd() * 0.13), 3);
      });
    return top + rows * rowHeight;
  };

  if (layout === 1) {
    if (rnd() < 0.22) y = table(y, 3, 15) + 22;
    while (y < height - margin) {
      if (rnd() < 0.2) {
        y += 16;
        continue;
      }
      line(y, textWidth * (0.4 + rnd() * 0.55), rnd() < 0.1);
      y += 15;
    }
  } else if (layout === 2) {
    while (y < height - margin - 20) {
      y = table(y, 3 + ((rnd() * 3) | 0), 16) + 26;
      if (rnd() < 0.35) {
        line(y, textWidth * 0.35, true);
        y += 16;
      }
    }
  } else if (layout === 3) {
    g.lineCap = "round";
    while (y < height - margin) {
      const length = textWidth * (0.35 + rnd() * 0.6);
      // 줄마다 왼쪽 여백이 다르다 = 손글씨 티
      const indent = margin + rnd() * 10;
      g.strokeStyle = rnd() < 0.25 ? "#8492AD" : "#A9B3C6";
      g.lineWidth = 1.6 + rnd() * 0.9;
      g.beginPath();
      g.moveTo(indent, y);
      for (let segmentX = indent; segmentX < indent + length; segmentX += 12)
        g.quadraticCurveTo(segmentX + 6, y + (rnd() - 0.5) * 7, segmentX + 12, y);
      g.stroke();
      if (rnd() < 0.12) {
        g.strokeStyle = "#6B7A96";
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(indent, y - 1);
        g.lineTo(indent + length * 0.7, y - 1);
        g.stroke();
      }
      y += 19 + rnd() * 7;
    }
    if (rnd() < 0.6) {
      g.strokeStyle = "#5A6B8C";
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(
        margin + textWidth * (0.25 + rnd() * 0.5),
        60 + rnd() * (height - 140),
        26 + rnd() * 14,
        14 + rnd() * 8,
        (rnd() - 0.5) * 0.5,
        0,
        Math.PI * 2,
      );
      g.stroke();
    }
  } else {
    while (y < height - margin) {
      g.strokeStyle = "#9AA0AA";
      g.lineWidth = 1.5;
      g.strokeRect(margin, y - 6, 9, 9);
      if (rnd() < 0.45) {
        g.strokeStyle = "#66707F";
        g.beginPath();
        g.moveTo(margin + 1.5, y - 4.5);
        g.lineTo(margin + 7.5, y + 1.5);
        g.moveTo(margin + 7.5, y - 4.5);
        g.lineTo(margin + 1.5, y + 1.5);
        g.stroke();
      }
      g.fillStyle = rnd() < 0.2 ? "#A9AEB8" : "#D6DAE1";
      g.fillRect(margin + 16, y - 3, (textWidth - 16) * (0.3 + rnd() * 0.6), 3);
      y += 21;
    }
  }

  // 진하면 더러운 종이가 된다.
  drawGrain(g, width, height, seed * 131 + style * 7 + 3, 0.55);
}

/** 글줄 텍스처. 스타일당 8종이면 충분히 다양해 보인다. */
export function makePaperTexture(seed: number, style: number): THREE.CanvasTexture {
  const variant = seed % 8;
  return makeCachedCanvasTexture(
    `paper|${style}-${variant}`,
    (g, width, height) => drawPaper(g, width, height, variant + 1, style),
    // A4 비율(1 : 1.414)
    { width: 256, height: 362, anisotropy: null },
  );
}
