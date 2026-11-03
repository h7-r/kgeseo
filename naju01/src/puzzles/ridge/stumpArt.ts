/** 통나무 걸상 윗면에 새긴 그림 — 해 · 달 · 물결 · 새 · 불. 단위는 그림판 px */
import { createCanvas, makeTextureFromCanvas } from "@/engine/textures/canvas";

export const STUMP_SYMBOLS = ["해", "달", "물결", "새", "불"] as const;

type Drawer = (g: CanvasRenderingContext2D) => void;

/** 해: 겹동그라미와 뾰족한 빛살 열둘 */
const drawSun: Drawer = (g) => {
  g.beginPath();
  g.arc(0, 0, 62, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(0, 0, 26, 0, Math.PI * 2);
  g.fill();
  for (let k = 0; k < 12; k++) {
    const angle = (k / 12) * Math.PI * 2;
    const length = k % 2 === 0 ? 160 : 130;
    g.beginPath();
    g.moveTo(Math.cos(angle - 0.12) * 88, Math.sin(angle - 0.12) * 88);
    g.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
    g.lineTo(Math.cos(angle + 0.12) * 88, Math.sin(angle + 0.12) * 88);
    g.closePath();
    g.fill();
  }
};

/** 달: 초승달과 끊어진 둥근 달무리 */
const drawMoon: Drawer = (g) => {
  g.beginPath();
  g.arc(-10, 0, 120, Math.PI * 0.28, Math.PI * 1.72);
  g.bezierCurveTo(-30, -70, -30, 70, Math.cos(Math.PI * 0.28) * 120 - 10, Math.sin(Math.PI * 0.28) * 120);
  g.closePath();
  g.fill();
  g.lineWidth = 7;
  for (let k = 0; k < 10; k++) {
    const start = (k / 10) * Math.PI * 2;
    g.beginPath();
    g.arc(0, 0, 160, start, start + 0.42);
    g.stroke();
  }
};

/** 물결: 끝이 동그랗게 말린 물결 세 겹 */
const drawWaves: Drawer = (g) => {
  for (let row = -1; row <= 1; row++) {
    const y = row * 62;
    g.beginPath();
    g.moveTo(-150, y + 20);
    for (let x = -150; x <= 150; x += 6) g.lineTo(x, y + Math.sin((x / 150) * Math.PI * 2) * 22);
    g.stroke();
    g.beginPath();
    g.arc(150, y - 12, 18, Math.PI * 0.6, Math.PI * 2.2);
    g.stroke();
  }
};

/** 새: 몸 · 머리 · 부리 · 깃 끝이 갈라진 날개 · 부채 꽁지 */
const drawBird: Drawer = (g) => {
  g.beginPath();
  g.ellipse(0, 20, 30, 70, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(0, -62, 26, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(-9, -84);
  g.lineTo(0, -122);
  g.lineTo(9, -84);
  g.fill();
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(side * 20, -10);
    g.quadraticCurveTo(side * 90, -90, side * 168, -70);
    // 깃 끝 — 톱니처럼 넷
    for (let f = 0; f < 4; f++) {
      g.lineTo(side * (150 - f * 30), -40 + f * 14);
      g.lineTo(side * (140 - f * 30), -54 + f * 14);
    }
    g.quadraticCurveTo(side * 60, 10, side * 20, 30);
    g.closePath();
    g.fill();
  }
  g.beginPath();
  g.moveTo(-14, 80);
  g.lineTo(-46, 150);
  g.lineTo(0, 132);
  g.lineTo(46, 150);
  g.lineTo(14, 80);
  g.closePath();
  g.fill();
};

/** 불: 불꽃 한 송이 — 바깥 혀가 왼쪽으로 휘어 솟고, 속에 작은 혀가 하나, 위로 불티 셋 */
const drawFire: Drawer = (g) => {
  const flame = (scale: number, lean: number) => {
    g.beginPath();
    g.moveTo(0, 150 * scale);
    g.bezierCurveTo(-120 * scale, 110 * scale, -118 * scale, -20 * scale, -40 * scale + lean, -90 * scale);
    g.bezierCurveTo(
      -10 * scale + lean,
      -125 * scale,
      10 * scale + lean,
      -150 * scale,
      -8 * scale + lean * 2,
      -200 * scale,
    );
    g.bezierCurveTo(50 * scale + lean, -140 * scale, 118 * scale, -40 * scale, 100 * scale, 40 * scale);
    g.bezierCurveTo(88 * scale, 110 * scale, 50 * scale, 150 * scale, 0, 150 * scale);
    g.closePath();
  };
  // 바깥 불꽃 — 테두리 선
  g.lineWidth = 14;
  flame(1, 0);
  g.stroke();
  // 속 불꽃 — 채운다(발광이 들면 여기가 가장 밝다)
  g.save();
  g.translate(8, 50);
  flame(0.5, 6);
  g.fill();
  g.restore();
  // 불티
  for (const [x, y, r] of [
    [-70, -190, 9],
    [36, -236, 7],
    [84, -168, 6],
  ]) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
};

const DRAWERS: Drawer[] = [drawSun, drawMoon, drawWaves, drawBird, drawFire];

/** 걸상 윗면 새김 — 두 겹 테두리 안에 그림 하나. 판 홈(어둡게) 아래로 밝은 턱, 빛이 들면 발광으로 희게 빛난다 */
export function makeStumpTopTexture(symbol: number) {
  const size = 512;
  const { canvas, g } = createCanvas(size, size);
  const mid = size / 2;
  g.lineCap = "round";
  g.lineJoin = "round";
  const carve = (color: string, dx: number, dy: number) => {
    g.save();
    g.translate(mid + dx, mid + dy);
    g.strokeStyle = color;
    g.fillStyle = color;
    // 두 겹 테두리
    g.lineWidth = 12;
    g.beginPath();
    g.arc(0, 0, 214, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 5;
    g.beginPath();
    g.arc(0, 0, 190, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 16;
    DRAWERS[symbol](g);
    g.restore();
  };
  carve("rgba(216,186,140,0.55)", 3, 4);
  carve("#1B1008", 0, 0);
  return makeTextureFromCanvas(canvas, 4);
}
