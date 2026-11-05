import type * as THREE from "three";

import { createLehmerRandom } from "@/engine/random";
import { makeCachedCanvasTexture, SIGN_FONT } from "@/engine/textures/canvas";

let imageDataUrl: string | null = null;

const WIDTH = 640;
const HEIGHT = 800;
const HAND_FONT = `"Eonggeongkwi", ${SIGN_FONT}`;
const PRINT_FONT = SIGN_FONT;

/** 낡은 종이 — 얼룩 · 섬유 · 접힌 자국 · 그을린 가장자리 */
function drawAgedPaper(g: CanvasRenderingContext2D, w: number, h: number) {
  const random = createLehmerRandom(7321);
  g.fillStyle = "#d9c9a3";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = 50 + random() * 170;
    const stain = g.createRadialGradient(x, y, 0, x, y, r);
    const isDark = random() > 0.5;
    stain.addColorStop(0, isDark ? "rgba(120,88,44,0.14)" : "rgba(245,232,200,0.2)");
    stain.addColorStop(1, "rgba(120,88,44,0)");
    g.fillStyle = stain;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = "rgba(92,70,38,0.1)";
  g.lineWidth = 1;
  for (let i = 0; i < 900; i++) {
    const x = random() * w;
    const y = random() * h;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (random() - 0.5) * 18, y + (random() - 0.5) * 18);
    g.stroke();
  }
  // 네 번 접어 주머니에 넣었던 자국
  for (const [x0, y0, x1, y1] of [
    [0, h * 0.5, w, h * 0.49],
    [w * 0.5, 0, w * 0.51, h],
  ]) {
    g.strokeStyle = "rgba(70,50,26,0.3)";
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.strokeStyle = "rgba(255,246,222,0.42)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0 + 3, y0 + 3);
    g.lineTo(x1 + 3, y1 + 3);
    g.stroke();
  }
  // 커피 잔 자국
  g.strokeStyle = "rgba(92,52,20,0.26)";
  g.lineWidth = 8;
  g.beginPath();
  g.arc(w * 0.82, h * 0.86, 66, 0.4, Math.PI * 1.75);
  g.stroke();
  // 가장자리 그을음
  const edge = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.68);
  edge.addColorStop(0, "rgba(58,36,14,0)");
  edge.addColorStop(1, "rgba(58,36,14,0.62)");
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);
}

/** 연필로 슥슥 그린 손잡이 — 정답(VALVE)을 쓰지 않고 그림과 빈칸으로 유추하게 한다 */
function drawValveSketch(g: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  const random = createLehmerRandom(2203);
  g.strokeStyle = "rgba(38,34,28,0.86)";
  g.lineCap = "round";
  for (let pass = 0; pass < 3; pass++) {
    g.lineWidth = 3.2 - pass * 0.7;
    g.beginPath();
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2 + pass;
      const r = radius + (random() - 0.5) * 3.2 + pass * 1.2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 0.97;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.lineWidth = 5;
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2) + Math.PI / 4;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * radius * 0.2, cy + Math.sin(a) * radius * 0.2);
    g.lineTo(cx + Math.cos(a) * (radius - 3), cy + Math.sin(a) * (radius - 3));
    g.stroke();
  }
  g.fillStyle = "rgba(38,34,28,0.88)";
  g.beginPath();
  g.arc(cx, cy, radius * 0.2, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(cx, cy + radius);
  g.lineTo(cx, cy + radius * 1.45);
  g.stroke();
  // 돌리라는 화살표
  g.strokeStyle = "rgba(128,34,24,0.85)";
  g.lineWidth = 3.5;
  g.beginPath();
  g.arc(cx, cy, radius * 1.28, -Math.PI * 0.75, -Math.PI * 0.2);
  g.stroke();
  const tipX = cx + Math.cos(-Math.PI * 0.2) * radius * 1.28;
  const tipY = cy + Math.sin(-Math.PI * 0.2) * radius * 1.28;
  g.beginPath();
  g.moveTo(tipX, tipY);
  g.lineTo(tipX - 20, tipY - 8);
  g.moveTo(tipX, tipY);
  g.lineTo(tipX - 3, tipY - 22);
  g.stroke();
}

function drawHintPaper(g: CanvasRenderingContext2D, w: number, h: number) {
  drawAgedPaper(g, w, h);
  g.textBaseline = "middle";
  // 찍혀 나온 점검표 머리 — 위는 인쇄, 아래는 손글씨라 누군가 뜯어 쓴 종이로 읽힌다
  g.fillStyle = "rgba(52,44,32,0.86)";
  g.textAlign = "left";
  g.font = `700 32px ${PRINT_FONT}`;
  g.fillText("왜곡역 설비 점검표", 58, 72);
  g.font = `20px ${PRINT_FONT}`;
  g.fillText("제 3 복도 · 소방 / 전기", 58, 108);
  g.fillRect(58, 130, w - 116, 2.5);
  g.textAlign = "right";
  g.font = `20px ${PRINT_FONT}`;
  g.fillText("No. 0417", w - 58, 108);
  g.save();
  g.translate(w - 112, 330);
  g.rotate(-0.16);
  g.strokeStyle = "rgba(142,38,28,0.62)";
  g.lineWidth = 4;
  g.strokeRect(-72, -28, 144, 56);
  g.fillStyle = "rgba(142,38,28,0.62)";
  g.textAlign = "center";
  g.font = `700 25px ${PRINT_FONT}`;
  g.fillText("점검 불가", 0, 2);
  g.restore();
  g.fillStyle = "rgba(34,31,27,0.9)";
  g.textAlign = "left";
  g.font = `44px ${HAND_FONT}`;
  g.fillText("소화전 자물쇠는 글자로 연다.", 58, 190);
  g.fillText("이 손잡이 이름을 넣어 볼 것.", 58, 246);
  drawValveSketch(g, w / 2, 410, 96);
  g.textAlign = "center";
  g.font = `76px ${HAND_FONT}`;
  g.fillText("V  _  _  _  E", w / 2, 620);
  g.font = `38px ${HAND_FONT}`;
  g.fillStyle = "rgba(70,60,44,0.86)";
  g.fillText("다섯 글자. 앞뒤만 겨우 기억난다.", w / 2, 700);
}

/** 힌트 메모 텍스처. 손에 든 메모·바닥 메모·힌트함 그림이 한 캔버스를 같이 쓴다. */
export function makeHintPaperTexture(): THREE.CanvasTexture {
  return makeCachedCanvasTexture("hintPaper", (g, width, height) => drawHintPaper(g, width, height), {
    width: WIDTH,
    height: HEIGHT,
    willReadFrequently: false,
    onCreate: (texture, canvas) => {
      const keepImage = () => {
        try {
          imageDataUrl = canvas.toDataURL("image/png");
        } catch {
          imageDataUrl = null; // 캔버스를 못 읽는 환경 — 그림 없이 글만 뜬다
        }
      };
      keepImage();
      // 손글씨 글꼴은 늦게 온다 — 오면 다시 그려 손에 든 메모와 힌트함을 같이 바꾼다
      if (typeof document === "undefined") return;
      document.fonts
        .load(`44px "Eonggeongkwi"`)
        .then(() => {
          const context = canvas.getContext("2d");
          if (!context) return;
          drawHintPaper(context, canvas.width, canvas.height);
          texture.needsUpdate = true;
          keepImage();
        })
        .catch(() => {});
    },
  });
}

/** 힌트함(모달)에 띄울 PNG. 따로 그리면 손에 든 쪽지와 창 속 쪽지가 다른 그림이 된다. */
export function getHintPaperImageUrl(): string | null {
  makeHintPaperTexture();
  return imageDataUrl;
}
