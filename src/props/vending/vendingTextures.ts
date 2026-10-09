/**
 * 자판기 간판·버튼 이름표·광고·배수구·캔 라벨 텍스처.
 * 색과 글자가 Leva 로 바뀌므로 캐시하지 않고 자판기마다 만들어 내릴 때 버린다.
 */

import { makeTextureFromCanvas, createCanvas } from "@/engine/textures/canvas";

import { CAN_FLAVORS, VENDING_FONT_STACK, drawCanLabel, type CanFlavor } from "./canLabels";

/**
 * 간판 글자 판(COFFEE / COLD DRINKS).
 * 캔버스 높이(116)와 판 높이(0.52)는 짝이다 — 한쪽만 줄이면 글자가 세로로 눌린다.
 */
export function makeSignTexture(
  text: string,
  {
    background = "#c8362e",
    textColor = "#fff6e2",
    size = 96,
  }: { background?: string; textColor?: string; size?: number } = {},
) {
  const { canvas, g } = createCanvas(512, 116);
  g.fillStyle = background;
  g.fillRect(0, 0, canvas.width, canvas.height);
  const shade = g.createLinearGradient(0, 0, 0, canvas.height);
  shade.addColorStop(0, "rgba(255,255,255,0.12)");
  shade.addColorStop(1, "rgba(0,0,0,0.24)");
  g.fillStyle = shade;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = textColor;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const margin = 44;
  let fontSize = size;
  do {
    g.font = `800 ${fontSize}px ${VENDING_FONT_STACK}`;
    if (g.measureText(text).width <= canvas.width - margin) break;
    fontSize -= 4;
  } while (fontSize > 24);
  g.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  return makeTextureFromCanvas(canvas);
}

/** 버튼 이름표(밀크커피 등). 둥근 배경 + 광택 + 넘치면 줄이는 글자. */
export function makeButtonLabelTexture(
  text: string,
  { background = "#b23a2e", textColor = "#ffffff" }: { background?: string; textColor?: string } = {},
) {
  const { canvas, g } = createCanvas(224, 84);
  const fillRounded = () => {
    if (typeof g.roundRect === "function") {
      g.beginPath();
      g.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 14);
      g.fill();
    } else g.fillRect(0, 0, canvas.width, canvas.height);
  };
  g.fillStyle = background;
  fillRounded();
  // 위 밝고 아래 어두운 광택 — 버튼이 볼록해 보인다
  const gloss = g.createLinearGradient(0, 0, 0, canvas.height);
  gloss.addColorStop(0, "rgba(255,255,255,0.28)");
  gloss.addColorStop(0.5, "rgba(255,255,255,0)");
  gloss.addColorStop(1, "rgba(0,0,0,0.22)");
  g.fillStyle = gloss;
  fillRounded();
  g.fillStyle = textColor;
  g.textAlign = "center";
  g.textBaseline = "middle";
  let fontSize = 46;
  do {
    g.font = `800 ${fontSize}px ${VENDING_FONT_STACK}`;
    if (g.measureText(text).width <= canvas.width - 26) break;
    fontSize -= 2;
  } while (fontSize > 16);
  g.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  return makeTextureFromCanvas(canvas);
}

type PosterKind = "coffeePoster" | "coffeeAd" | "drinkAd";

/** 하단 광고판·커피 포스터. 브랜드 대신 오리지널 일러스트. */
export function makePosterTexture({
  kind,
  width = 360,
  height = 420,
}: {
  kind: PosterKind;
  width?: number;
  height?: number;
}) {
  const w = width;
  const h = height;
  const { canvas, g } = createCanvas(w, h);

  const star = (x: number, y: number, r: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.closePath();
    g.fill();
  };

  if (kind === "coffeePoster" || kind === "coffeeAd") {
    const isAd = kind === "coffeeAd";
    const bg = g.createLinearGradient(0, 0, 0, h);
    if (isAd) {
      bg.addColorStop(0, "#e6ad44");
      bg.addColorStop(1, "#bd7a1c");
    } else {
      bg.addColorStop(0, "#4c3019");
      bg.addColorStop(1, "#21120a");
    }
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * (isAd ? 0.42 : 0.46);
    const R = w * 0.2;
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.beginPath();
    g.ellipse(cx, cy + R * 1.05, R * 1.7, R * 0.42, 0, 0, 7);
    g.fill();
    g.strokeStyle = isAd ? "#f0e6d5" : "#e7ddc9";
    g.lineWidth = R * 0.22;
    g.beginPath();
    g.arc(cx + R * 0.95, cy, R * 0.55, -1.1, 1.1);
    g.stroke();
    g.fillStyle = isAd ? "#f4ecdd" : "#efe7d8";
    g.beginPath();
    g.moveTo(cx - R, cy - R * 0.55);
    g.lineTo(cx + R, cy - R * 0.55);
    g.lineTo(cx + R * 0.78, cy + R * 0.85);
    g.lineTo(cx - R * 0.78, cy + R * 0.85);
    g.closePath();
    g.fill();
    g.fillStyle = "#3a2212";
    g.beginPath();
    g.ellipse(cx, cy - R * 0.55, R * 0.98, R * 0.3, 0, 0, 7);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.10)";
    g.beginPath();
    g.ellipse(cx - R * 0.3, cy - R * 0.62, R * 0.35, R * 0.1, 0, 0, 7);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = R * 0.11;
    g.lineCap = "round";
    for (const dx of [-R * 0.35, R * 0.35]) {
      g.beginPath();
      const sx = cx + dx;
      const sy = cy - R * 0.95;
      g.moveTo(sx, sy);
      g.bezierCurveTo(sx - R * 0.4, sy - R * 0.6, sx + R * 0.4, sy - R * 1.0, sx, sy - R * 1.7);
      g.stroke();
    }
    if (isAd) {
      g.fillStyle = "#3d2410";
      for (const [bx, by] of [
        [w * 0.2, h * 0.8],
        [w * 0.78, h * 0.78],
      ]) {
        g.beginPath();
        g.ellipse(bx, by, R * 0.34, R * 0.22, 0.5, 0, 7);
        g.fill();
        g.strokeStyle = "#1f1207";
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(bx - R * 0.24, by - R * 0.14);
        g.lineTo(bx + R * 0.24, by + R * 0.14);
        g.stroke();
      }
    }
    g.fillStyle = isAd ? "#3a2412" : "#f0e6d5";
    g.textAlign = "center";
    g.font = `800 ${Math.round(w * 0.11)}px ${VENDING_FONT_STACK}`;
    g.fillText(isAd ? "FRESH BREW" : "HOT COFFEE", cx, h * (isAd ? 0.93 : 0.86));
  } else {
    // 가로로 넓은 광고 — 왼쪽 캔 + 오른쪽 큰 글자
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#37b06a");
    bg.addColorStop(1, "#1c7d54");
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    star(w * 0.07, h * 0.22, h * 0.09, "rgba(255,255,255,0.5)");
    star(w * 0.95, h * 0.18, h * 0.07, "rgba(255,255,255,0.4)");
    star(w * 0.9, h * 0.82, h * 0.08, "rgba(255,255,255,0.35)");
    const ccx = w * 0.19;
    const cw = h * 0.36;
    const ch = h * 0.66;
    const ctop = h * 0.17;
    g.fillStyle = "#e9eef2";
    g.beginPath();
    if (typeof g.roundRect === "function") g.roundRect(ccx - cw / 2, ctop, cw, ch, 12);
    else g.rect(ccx - cw / 2, ctop, cw, ch);
    g.fill();
    // 라벨이 파란색인 것이 소화전 퍼즐의 힌트다 — 파란 캔을 사라.
    g.fillStyle = "#1b4fb0";
    g.fillRect(ccx - cw / 2, ctop + ch * 0.36, cw, ch * 0.28);
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `800 ${Math.round(cw * 0.5)}px ${VENDING_FONT_STACK}`;
    g.fillText("?", ccx, ctop + ch * 0.5);
    g.fillStyle = "#c7ced4";
    g.beginPath();
    g.ellipse(ccx, ctop, cw / 2, cw * 0.16, 0, 0, 7);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.6)";
    for (const [dx, dy, dr] of [
      [0.32, 0.34, 6],
      [0.34, 0.62, 5],
      [0.29, 0.8, 4],
    ]) {
      g.beginPath();
      g.arc(w * dx, h * dy, dr, 0, 7);
      g.fill();
    }
    // 정답을 직접 주지 않고 '막히면 파란 캔' 을 유추하게 한다
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `800 ${Math.round(h * 0.2)}px ${VENDING_FONT_STACK}`;
    g.fillText("NEED A HINT?", w * 0.62, h * 0.4);
    g.font = `800 ${Math.round(h * 0.28)}px ${VENDING_FONT_STACK}`;
    g.fillText("GO BLUE", w * 0.62, h * 0.68);
  }

  // 비스듬히 봐도 글자가 안 뭉개진다
  return makeTextureFromCanvas(canvas, 8);
}

/** 컵 받침의 배수 그레이트(동심원 + 방사선). */
export function makeDrainTexture() {
  const { g, canvas } = createCanvas(128, 128);
  g.fillStyle = "#0e1013";
  g.fillRect(0, 0, 128, 128);
  const cx = 64;
  const cy = 64;
  g.fillStyle = "#2a2e34";
  g.beginPath();
  g.arc(cx, cy, 60, 0, 7);
  g.fill();
  g.fillStyle = "#141619";
  g.beginPath();
  g.arc(cx, cy, 52, 0, 7);
  g.fill();
  g.strokeStyle = "#3c424a";
  g.lineWidth = 3;
  for (let r = 12; r <= 48; r += 9) {
    g.beginPath();
    g.arc(cx, cy, r, 0, 7);
    g.stroke();
  }
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI / 6) * i;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8);
    g.lineTo(cx + Math.cos(a) * 50, cy + Math.sin(a) * 50);
    g.stroke();
  }
  return makeTextureFromCanvas(canvas);
}

function makeCanLabelTexture(flavor: CanFlavor) {
  const { canvas, g } = createCanvas(512, 220);
  drawCanLabel(g, 0, 0, canvas.width, canvas.height, flavor);
  return makeTextureFromCanvas(canvas);
}

export const makeCanLabelTextures = () => CAN_FLAVORS.map(makeCanLabelTexture);
