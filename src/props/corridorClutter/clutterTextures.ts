import { createRandom } from "@/engine/random";
import { makeTextureFromCanvas, createCanvas } from "@/engine/textures/canvas";
import { CAN_FLAVORS, drawCanLabel } from "@/props/vending/canLabels";

import { CAN_ATLAS_COLUMNS, CAN_ATLAS_ROWS, PAPER_CELL, PAPER_COLUMNS, PAPER_ROWS } from "./clutterGeometry";

const PAPER_FONT = "'Malgun Gothic', system-ui, sans-serif";

function drawBar(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

/**
 * 영수증·전단지·신문 조각·낡은 종이. 백지는 종이로 안 보인다 — 인쇄된 줄이 있어야 종이로 읽힌다.
 * 글자는 몇 개만 쓰고 나머지는 줄로 흉내 낸다. 멀리서는 같고 가까이서는 '영수증이구나' 가 온다.
 */
export function makePaperAtlasTexture() {
  const S = 256;
  const { canvas, g } = createCanvas(PAPER_COLUMNS * S, PAPER_ROWS * S);
  const r = createRandom(31337);
  const cellOrigin = (i: number) => [(i % PAPER_COLUMNS) * S, Math.floor(i / PAPER_COLUMNS) * S];

  // 영수증 — 감열지. 상호, 점선, 품목 줄, 합계, 바코드
  {
    const [ox, oy] = cellOrigin(PAPER_CELL.receipt);
    g.save();
    g.translate(ox, oy);
    g.fillStyle = "#e8e4d9";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#3a3630";
    g.textAlign = "center";
    g.font = `700 26px ${PAPER_FONT}`;
    g.fillText("나주역 매점", S / 2, 34);
    g.font = `16px ${PAPER_FONT}`;
    g.fillText("TEL 061-330-****", S / 2, 56);
    for (let i = 0; i < 2; i++) drawBar(g, 18, 70 + i * 6, S - 36, 2, "#8d887c");
    g.textAlign = "left";
    g.font = `15px ${PAPER_FONT}`;
    let y = 96;
    for (const [name, price] of [
      ["캔커피", "1,200"],
      ["생수", "900"],
      ["샌드위치", "3,500"],
      ["담배", "4,500"],
      ["봉투", "100"],
    ]) {
      g.fillText(name, 22, y);
      g.textAlign = "right";
      g.fillText(price, S - 22, y);
      g.textAlign = "left";
      y += 22;
    }
    drawBar(g, 18, y - 8, S - 36, 2, "#8d887c");
    g.font = `700 19px ${PAPER_FONT}`;
    g.fillText("합계", 22, y + 20);
    g.textAlign = "right";
    g.fillText("10,200", S - 22, y + 20);
    for (let i = 0; i < 40; i++) drawBar(g, 30 + i * 5, S - 40, 1 + r() * 3, 26, "#2c2924");
    g.restore();
  }

  // 전단지 — 큰 제목 띠 + 본문 줄 + 그림 자리
  {
    const [ox, oy] = cellOrigin(PAPER_CELL.flyer);
    g.save();
    g.translate(ox, oy);
    g.fillStyle = "#ddd7c6";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#8e3b2f";
    g.fillRect(0, 18, S, 52);
    g.fillStyle = "#f4efe2";
    g.textAlign = "center";
    g.font = `800 34px ${PAPER_FONT}`;
    g.fillText("임대 문의", S / 2, 54);
    g.fillStyle = "#c9c2b0";
    g.fillRect(20, 86, 96, 74);
    g.fillStyle = "#4a453b";
    for (let i = 0; i < 6; i++) drawBar(g, 128, 92 + i * 13, 108 - r() * 26, 5, "#5a5449");
    for (let i = 0; i < 5; i++) drawBar(g, 20, 176 + i * 14, S - 40 - r() * 60, 5, "#5a5449");
    g.restore();
  }

  // 신문 조각 — 단이 나뉜 촘촘한 줄 + 사진
  {
    const [ox, oy] = cellOrigin(PAPER_CELL.newspaper);
    g.save();
    g.translate(ox, oy);
    g.fillStyle = "#d8d3c3";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#2f2b25";
    g.textAlign = "left";
    g.font = `800 24px ${PAPER_FONT}`;
    g.fillText("폐선 구간 정비", 16, 34);
    drawBar(g, 14, 44, S - 28, 2, "#4a453b");
    g.fillStyle = "#b9b3a2";
    g.fillRect(14, 54, 104, 66);
    for (let column = 0; column < 2; column++) {
      const x = 14 + column * 118;
      const y0 = column === 0 ? 128 : 54;
      for (let i = 0; i < (column === 0 ? 8 : 14); i++) drawBar(g, x, y0 + i * 11, 104 - r() * 22, 4, "#544f45");
    }
    g.restore();
  }

  // 낡은 종이 — 거의 지워진 줄 몇 개
  {
    const [ox, oy] = cellOrigin(PAPER_CELL.oldPaper);
    g.save();
    g.translate(ox, oy);
    g.fillStyle = "#cfc8b6";
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 9; i++) drawBar(g, 24 + r() * 20, 40 + i * 22, 120 + r() * 80, 4, "#6b6558");
    g.restore();
  }

  // 공통 때 — 새 종이가 바닥에 있으면 어색하다
  g.globalCompositeOperation = "multiply";
  for (let i = 0; i < 70; i++) {
    const R = 8 + r() * 46;
    g.fillStyle = `rgba(${(120 + r() * 50) | 0},${(100 + r() * 40) | 0},${(70 + r() * 30) | 0},${0.08 + r() * 0.22})`;
    g.beginPath();
    g.arc(r() * canvas.width, r() * canvas.height, R, 0, 7);
    g.fill();
  }
  g.fillStyle = "rgba(150,145,132,0.35)";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.globalCompositeOperation = "source-over";

  return makeTextureFromCanvas(canvas);
}

/** 캔 라벨 6종을 한 장에 모으고 때를 입힌다 — 새 캔 그림 그대로면 갓 뽑은 캔이 바닥에 놓인 꼴이다. */
export function makeCanAtlasTexture() {
  const cellWidth = 256;
  const cellHeight = 128;
  const { canvas, g } = createCanvas(CAN_ATLAS_COLUMNS * cellWidth, CAN_ATLAS_ROWS * cellHeight);
  CAN_FLAVORS.forEach((flavor, i) => {
    const cx = (i % CAN_ATLAS_COLUMNS) * cellWidth;
    const cy = Math.floor(i / CAN_ATLAS_COLUMNS) * cellHeight;
    drawCanLabel(g, cx, cy, cellWidth, cellHeight, flavor);
  });
  const rnd = createRandom(20260910);
  g.globalCompositeOperation = "multiply";
  g.fillStyle = "rgba(150,148,140,0.55)";
  g.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 260; i++) {
    const a = 0.05 + rnd() * 0.18;
    g.fillStyle = `rgba(70,66,58,${a})`;
    const w = 4 + rnd() * 40;
    g.fillRect(rnd() * canvas.width, rnd() * canvas.height, w, 1 + rnd() * 5);
  }
  g.globalCompositeOperation = "source-over";
  // 긁혀 벗겨진 금속 — 밝은 실선
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(205,208,212,${0.15 + rnd() * 0.35})`;
    g.lineWidth = 0.6 + rnd() * 1.4;
    const x = rnd() * canvas.width;
    const y = rnd() * canvas.height;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 34, y + (rnd() - 0.5) * 8);
    g.stroke();
  }
  return makeTextureFromCanvas(canvas);
}
