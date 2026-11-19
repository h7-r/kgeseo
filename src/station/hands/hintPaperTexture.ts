import type * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";
import { createLehmerRandom } from "@/engine/random";
import { makeCachedCanvasTexture, SIGN_FONT } from "@/engine/textures/canvas";
import { HYDRANT_LOCK_CLUES } from "@/props/hydrantCabinet/hydrantLockClue";
import { CAN_FLAVORS, type CanFlavor } from "@/props/vending/canLabels";

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

/** 종이에 그릴 캔 치수(캔버스 픽셀) — 다섯이 640 폭에 고르게 */
const CAN_W = 84;
const CAN_H = 150;
const CAN_TOP = 290;
const CAN_STEP = 120;
const BAND = 14;

/**
 * 색연필로 칠한 캔 하나와 그 아래 동그라미 번호 — 라벨 글자는 적지 않는다. 색으로 자판기 유리 안의 캔을 찾고,
 * 번호 자리의 글자를 읽어 와야 풀린다(hydrantLockClue). 단서가 없는 글자(null)는 빈 캔으로 둔다.
 */
function drawCanClue(
  g: CanvasRenderingContext2D,
  cx: number,
  flavor: CanFlavor | null,
  position: number | null,
  seed: number,
) {
  const random = createLehmerRandom(seed);
  const x = cx - CAN_W / 2;
  const y = CAN_TOP;
  const r = 14;
  const body = () => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + CAN_W - r, y);
    g.quadraticCurveTo(x + CAN_W, y, x + CAN_W, y + r);
    g.lineTo(x + CAN_W, y + CAN_H - r);
    g.quadraticCurveTo(x + CAN_W, y + CAN_H, x + CAN_W - r, y + CAN_H);
    g.lineTo(x + r, y + CAN_H);
    g.quadraticCurveTo(x, y + CAN_H, x, y + CAN_H - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  };
  if (flavor) {
    // 색연필 — 살짝 비친 종이색이 남게 반투명으로 두 번 칠한다
    g.globalAlpha = 0.78;
    g.fillStyle = flavor.background;
    body();
    g.fill();
    g.globalAlpha = 0.5;
    body();
    g.fill();
    g.globalAlpha = 1;
    // 라벨처럼 비스듬한 밝은 띠 — 자판기 캔과 같은 자리라 같은 물건으로 읽힌다
    g.save();
    body();
    g.clip();
    g.globalAlpha = 0.55;
    g.fillStyle = flavor.swoosh;
    g.beginPath();
    g.moveTo(x, y + CAN_H * 0.64);
    g.lineTo(x + CAN_W, y + CAN_H * 0.32);
    g.lineTo(x + CAN_W, y + CAN_H * 0.5);
    g.lineTo(x, y + CAN_H * 0.82);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
    // 위 · 아래 은색 테
    g.fillStyle = "rgba(150,154,160,0.9)";
    g.fillRect(x, y, CAN_W, BAND);
    g.fillRect(x, y + CAN_H - BAND, CAN_W, BAND);
    g.restore();
  }
  // 연필 외곽선 — 손으로 그린 듯 두 번 겹쳐
  g.strokeStyle = flavor ? "rgba(38,34,28,0.82)" : "rgba(38,34,28,0.4)";
  g.lineCap = "round";
  for (let pass = 0; pass < 2; pass++) {
    g.lineWidth = 3 - pass;
    g.save();
    g.translate((random() - 0.5) * 3, (random() - 0.5) * 3);
    if (!flavor) g.setLineDash([9, 7]);
    body();
    g.stroke();
    g.restore();
  }
  // 동그라미 번호 — 손글씨. 「몇 번째 글자」를 뜻한다
  const ny = y + CAN_H + 54;
  g.strokeStyle = "rgba(128,34,24,0.85)";
  g.lineWidth = 3.5;
  g.beginPath();
  g.arc(cx, ny, 27, 0, Math.PI * 2);
  g.stroke();
  if (position !== null) {
    g.fillStyle = "rgba(128,34,24,0.92)";
    g.textAlign = "center";
    g.font = `44px ${HAND_FONT}`;
    g.fillText(String(position), cx, ny + 3);
  }
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
  // 규칙은 종이에 적는다 — 「무엇을 해야 하는지」는 알려 주고, 「어느 글자인지」만 세계에서 읽게(나주 안내판 원칙)
  g.fillStyle = "rgba(34,31,27,0.9)";
  g.textAlign = "left";
  g.font = `44px ${HAND_FONT}`;
  g.fillText("소화전 자물쇠는 글자 다섯.", 58, 190);
  g.fillText("자판기 캔. 번호는 몇 번째 글자.", 58, 246);
  HYDRANT_LOCK_CLUES.forEach((clue, i) => {
    const cx = 80 + i * CAN_STEP;
    drawCanClue(g, cx, clue ? CAN_FLAVORS[clue.flavor] : null, clue ? clue.position : null, 2203 + i * 17);
  });
  g.textAlign = "center";
  g.font = `38px ${HAND_FONT}`;
  g.fillStyle = "rgba(70,60,44,0.86)";
  g.fillText("왼쪽부터 차례대로.", w / 2, 590);
  // 점검 불가 도장 — 캔 아래 빈자리에
  g.save();
  g.translate(150, 690);
  g.rotate(-0.16);
  g.strokeStyle = "rgba(142,38,28,0.62)";
  g.lineWidth = 4;
  g.strokeRect(-72, -28, 144, 56);
  g.fillStyle = "rgba(142,38,28,0.62)";
  g.textAlign = "center";
  g.font = `700 25px ${PRINT_FONT}`;
  g.fillText("점검 불가", 0, 2);
  g.restore();
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

// 회귀 · QA 에서 쪽지 그림을 PNG 로 꺼내 본다(그림은 게임 안에서만 그려진다)
exposeDevHook("hintPaperImage", { url: getHintPaperImageUrl });
