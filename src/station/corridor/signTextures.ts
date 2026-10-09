/**
 * 복도 표지판 텍스처 — 벽함 라벨·비상계단 유도등. 글자·기호를 폴리곤으로 깎지 않고 그린다.
 * 대신 툰 테두리를 그림 안에 넣어야 주변 물체의 외곽선과 굵기가 맞는다.
 */
import { createRandom } from "@/engine/random";
import { makeCachedCanvasTexture, SIGN_FONT } from "@/engine/textures/canvas";

/** 벽함 라벨 캔버스 비율(320×208). 라벨 판 크기를 이 비율로 맞춘다. */
export const LABEL_ASPECT = 208 / 320;
/** 비상계단 표지 캔버스 비율(512×176) */
export const EXIT_SIGN_ASPECT = 176 / 512;

/** 라벨 위 얼룩·긁힘. 새 표지판은 이 세계에 없다. */
function drawLabelWeathering(g: CanvasRenderingContext2D, width: number, height: number, seed: number, strength = 1) {
  const rnd = createRandom(seed);
  for (let i = 0; i < 26 * strength; i++) {
    g.globalAlpha = 0.05 + rnd() * 0.12;
    g.fillStyle = rnd() > 0.5 ? "#000000" : "#6b5a3a";
    const r = 4 + rnd() * 22;
    g.beginPath();
    g.arc(rnd() * width, rnd() * height, r, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 8 * strength; i++) {
    g.globalAlpha = 0.1 + rnd() * 0.18;
    g.strokeStyle = "#0d0f12";
    g.lineWidth = 0.8 + rnd() * 1.6;
    const y = rnd() * height;
    g.beginPath();
    g.moveTo(rnd() * width * 0.4, y);
    g.lineTo(rnd() * width * 0.6 + width * 0.4, y + (rnd() - 0.5) * 6);
    g.stroke();
  }
  g.globalAlpha = 1;
}

/** 배전반 라벨 — 노란 바탕 + 경고 삼각형 + 고압 문구 */
export function makePanelLabelTexture(background = "#c9a83c", lineColor = "#131314", number = "N-3", grime = 1) {
  return makeCachedCanvasTexture(
    `panelLabel|${background}${lineColor}${number}${grime.toFixed(2)}`,
    (g, W, H) => {
      g.fillStyle = lineColor;
      g.fillRect(0, 0, W, H);
      g.fillStyle = background;
      g.fillRect(8, 8, W - 16, H - 16);

      // 경고 삼각형 — 글자를 못 읽어도 뜻이 통하는 국제 표준 기호
      const cx = 74;
      const cy = 78;
      const r = 46;
      g.fillStyle = lineColor;
      g.beginPath();
      g.moveTo(cx, cy - r);
      g.lineTo(cx + r * 0.92, cy + r * 0.68);
      g.lineTo(cx - r * 0.92, cy + r * 0.68);
      g.closePath();
      g.fill();
      g.fillStyle = background;
      g.beginPath();
      g.moveTo(cx, cy - r + 12);
      g.lineTo(cx + r * 0.72, cy + r * 0.52);
      g.lineTo(cx - r * 0.72, cy + r * 0.52);
      g.closePath();
      g.fill();
      // 번개
      g.fillStyle = lineColor;
      g.beginPath();
      g.moveTo(cx + 6, cy - 26);
      g.lineTo(cx - 12, cy + 4);
      g.lineTo(cx - 1, cy + 4);
      g.lineTo(cx - 8, cy + 30);
      g.lineTo(cx + 13, cy - 4);
      g.lineTo(cx + 1, cy - 4);
      g.closePath();
      g.fill();

      g.fillStyle = lineColor;
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.font = `700 40px ${SIGN_FONT}`;
      g.fillText("고압 위험", 134, 58);
      g.font = `600 24px ${SIGN_FONT}`;
      g.fillText("관계자 외 취급금지", 134, 96);
      // 아래 띠 — 관리번호
      g.fillStyle = lineColor;
      g.fillRect(8, H - 56, W - 16, 48);
      g.fillStyle = background;
      g.font = `700 30px ${SIGN_FONT}`;
      g.fillText("배전반  " + number, 24, H - 31);

      drawLabelWeathering(g, W, H, 4211, grime);
    },
    { width: 320, height: 208 },
  );
}

/** 소화전 라벨 — 붉은 바탕 + 흰 글자 */
export function makeHydrantLabelTexture(background = "#a5342a", lineColor = "#131314", grime = 1) {
  return makeCachedCanvasTexture(
    `hydrantLabel|${background}${lineColor}${grime.toFixed(2)}`,
    (g, W, H) => {
      const white = "#f0ece4";
      g.fillStyle = lineColor;
      g.fillRect(0, 0, W, H);
      g.fillStyle = background;
      g.fillRect(8, 8, W - 16, H - 16);
      g.strokeStyle = white;
      g.lineWidth = 3;
      g.strokeRect(20, 20, W - 40, H - 40);

      g.fillStyle = white;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `800 74px ${SIGN_FONT}`;
      g.fillText("소화전", W / 2, 82);
      g.font = `600 26px ${SIGN_FONT}`;
      g.fillText("FIRE HOSE CABINET", W / 2, 136);
      // 유리 깨짐 안내 띠
      g.fillStyle = white;
      g.fillRect(28, 158, W - 56, 30);
      g.fillStyle = background;
      g.font = `700 20px ${SIGN_FONT}`;
      g.fillText("화재시 유리를 깨시오", W / 2, 174);

      drawLabelWeathering(g, W, H, 917, grime);
    },
    { width: 320, height: 208 },
  );
}

/** 비상계단 유도등 표지. 흰 문 + 달려 나오는 초록 사람 + 글자. */
export function makeExitSignTexture(green = "#3f9e63", lineColor = "#131314") {
  return makeCachedCanvasTexture(
    `exitSign|${green}|${lineColor}`,
    (g, W, H) => {
      const white = "#f2f6f1";

      // 툰 테두리 — 3D 모델에는 외곽선으로 넣는 굵은 선을 표지판에는 그림으로 넣는다
      g.fillStyle = lineColor;
      g.fillRect(0, 0, W, H);
      g.fillStyle = green;
      g.fillRect(9, 9, W - 18, H - 18);
      g.strokeStyle = white;
      g.lineWidth = 3;
      g.strokeRect(20, 20, W - 40, H - 40);

      // 문(흰 면) — 표준 비상구 픽토그램은 흰 바탕 위 초록 사람이다
      const dx = 40;
      const dy = 32;
      const dw = 118;
      const dh = 112;
      g.fillStyle = white;
      g.fillRect(dx, dy, dw, dh);
      g.strokeStyle = lineColor;
      g.lineWidth = 3;
      g.strokeRect(dx, dy, dw, dh);
      // 열린 쪽 문짝 두께
      g.fillStyle = white;
      g.fillRect(dx + dw, dy + dh - 26, 30, 12);
      g.strokeRect(dx + dw, dy + dh - 26, 30, 12);

      const drawPerson = (color: string, extra: number) => {
        g.fillStyle = color;
        g.strokeStyle = color;
        g.lineCap = "round";
        g.lineJoin = "round";
        g.beginPath();
        g.arc(78, 56, 13 + extra, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = 15 + extra * 2;
        g.beginPath();
        g.moveTo(80, 72);
        g.lineTo(96, 104);
        g.stroke();
        g.lineWidth = 11 + extra * 2;
        g.beginPath();
        g.moveTo(84, 80);
        g.lineTo(122, 84);
        g.moveTo(80, 78);
        g.lineTo(56, 92);
        g.stroke();
        g.lineWidth = 13 + extra * 2;
        g.beginPath();
        g.moveTo(96, 104);
        g.lineTo(126, 118);
        g.lineTo(146, 130);
        g.moveTo(96, 104);
        g.lineTo(70, 122);
        g.lineTo(52, 132);
        g.stroke();
      };
      // 어두운 색으로 두껍게 먼저 그리면 그게 외곽선이 된다
      drawPerson(lineColor, 2);
      drawPerson(green, 0);

      g.font = `bold 60px ${SIGN_FONT}`;
      g.textBaseline = "middle";
      g.lineJoin = "round";
      g.strokeStyle = lineColor;
      g.lineWidth = 8;
      g.strokeText("비상계단", 216, 78);
      g.fillStyle = white;
      g.fillText("비상계단", 216, 78);

      g.font = "600 24px 'Helvetica Neue', Arial, sans-serif";
      g.lineWidth = 6;
      g.strokeStyle = lineColor;
      g.strokeText("EXIT", 218, 126);
      g.fillStyle = white;
      g.fillText("EXIT", 218, 126);

      // 낡음 — 폐역이니 표지판도 깨끗하면 안 된다
      const rnd = createRandom(4242);
      g.globalAlpha = 0.16;
      g.fillStyle = "#0b1410";
      for (let i = 0; i < 90; i++) {
        const r = 1 + rnd() * 9;
        g.beginPath();
        g.arc(rnd() * W, rnd() * H, r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 0.22;
      g.strokeStyle = "#0b1410";
      g.lineWidth = 2;
      for (let i = 0; i < 7; i++) {
        const x0 = rnd() * W;
        const y0 = rnd() * H;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x0 + (rnd() - 0.5) * 120, y0 + (rnd() - 0.5) * 40);
        g.stroke();
      }
      g.globalAlpha = 1;
    },
    { width: 512, height: 176 },
  );
}
