/**
 * 비밀 복도의 캔버스 텍스처 — 벽함 라벨·비상계단 표지·형광등 확산판·낡은 문짝.
 * 표지판은 글자·기호를 폴리곤으로 깎지 않고 그린다. 대신 툰 테두리를 그림 안에 넣어야
 * 주변 물체의 외곽선과 굵기가 맞는다.
 */
import { makeRandom } from "@/engine/random";
import { cachedCanvasTexture } from "@/engine/textures/canvas";
import { SIGN_FONT } from "@/engine/textures/fonts";

/** 벽함 라벨 캔버스 비율(320×208). 라벨 판 크기를 이 비율로 맞춘다. */
export const LABEL_ASPECT = 208 / 320;
/** 비상계단 표지 캔버스 비율(512×176) */
export const EXIT_SIGN_ASPECT = 176 / 512;

/** 라벨 위 얼룩·긁힘. 새 표지판은 이 세계에 없다. */
function weatherLabel(g: CanvasRenderingContext2D, width: number, height: number, seed: number, strength = 1) {
  const rnd = makeRandom(seed);
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
export function panelLabelTexture(background = "#c9a83c", lineColor = "#131314", number = "N-3", grime = 1) {
  return cachedCanvasTexture(
    `panelLabel|${background}${lineColor}${number}${grime.toFixed(2)}`,
    (g, W, H) => {
      g.fillStyle = lineColor;
      g.fillRect(0, 0, W, H);
      g.fillStyle = background;
      g.fillRect(8, 8, W - 16, H - 16);

      // 경고 삼각형 — 글자를 못 읽어도 뜻이 통하는 국제 표준 기호
      const cx = 74,
        cy = 78,
        r = 46;
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

      weatherLabel(g, W, H, 4211, grime);
    },
    { width: 320, height: 208 },
  );
}

/** 소화전 라벨 — 붉은 바탕 + 흰 글자 */
export function hydrantLabelTexture(background = "#a5342a", lineColor = "#131314", grime = 1) {
  return cachedCanvasTexture(
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

      weatherLabel(g, W, H, 917, grime);
    },
    { width: 320, height: 208 },
  );
}

/** 비상계단 유도등 표지. 흰 문 + 달려 나오는 초록 사람 + 글자. */
export function exitSignTexture(green = "#3f9e63", lineColor = "#131314") {
  return cachedCanvasTexture(
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
      const dx = 40,
        dy = 32,
        dw = 118,
        dh = 112;
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
      const rnd = makeRandom(4242);
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
        const x0 = rnd() * W,
          y0 = rnd() * H;
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

/**
 * 형광등 확산판(우유빛 아크릴). 얼룩과 죽은 벌레 자국이 낡음을 가장 빨리 말해 준다.
 * planeGeometry(폭, 길이) 의 UV 세로가 긴 쪽이라 캔버스도 세로로 길어야 한다 — 가로로 그리면 얼룩이 나뭇결처럼 늘어난다.
 */
export function fluorescentPanelTexture(seed = 1, grime = 1) {
  return cachedCanvasTexture(
    `fluorescentPanel|${seed}|${grime.toFixed(2)}`,
    (g, W, H) => {
      const rnd = makeRandom(seed * 977 + 13);
      const A = (v: number) => Math.min(0.85, v * grime);

      // 바탕은 밝아야 한다. 등은 주변보다 밝아서 등으로 읽힌다.
      g.fillStyle = "#f2f0e7";
      g.fillRect(0, 0, W, H);

      // 형광등 관 2줄 — 관 자리만 더 밝고 사이는 살짝 어둡다
      for (const cx of [W * 0.3, W * 0.7]) {
        const gr = g.createLinearGradient(cx - W * 0.22, 0, cx + W * 0.22, 0);
        gr.addColorStop(0, "rgba(255,255,255,0)");
        gr.addColorStop(0.5, "rgba(255,255,255,0.95)");
        gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr;
        g.fillRect(cx - W * 0.22, 8, W * 0.44, H - 16);
      }
      // 관 양 끝 소켓 자국
      for (const cx of [W * 0.3, W * 0.7])
        for (const cy of [16, H - 16]) {
          g.fillStyle = `rgba(70,66,58,${A(0.5)})`;
          g.fillRect(cx - 13, cy - 7, 26, 14);
        }

      // 누런 얼룩 — 군데군데만. 판 전체를 덮으면 나무가 된다.
      for (let i = 0; i < 30; i++) {
        const cx = rnd() * W,
          cy = rnd() * H,
          r = 14 + rnd() * 70;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, `rgba(122,112,88,${A(0.07 + rnd() * 0.1)})`);
        gr.addColorStop(1, "rgba(122,112,88,0)");
        g.fillStyle = gr;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }

      // 물 샌 자국
      for (let i = 0; i < 5; i++) {
        const cx = rnd() * W,
          cy = rnd() * H,
          rx = 16 + rnd() * 40,
          ry = rx * (0.7 + rnd() * 0.5);
        g.strokeStyle = `rgba(96,84,56,${A(0.26)})`;
        g.lineWidth = 2.5;
        g.beginPath();
        g.ellipse(cx, cy, rx, ry, rnd() * Math.PI, 0, Math.PI * 2);
        g.stroke();
      }

      // 튄 자국 — 덩어리만 있으면 점이고, 주변 방울이 붙어야 튄 것으로 읽힌다
      const splatter = (cx: number, cy: number, size: number) => {
        g.beginPath();
        const n = 11;
        for (let i = 0; i <= n; i++) {
          const angle = (i / n) * Math.PI * 2;
          const r = size * (0.5 + rnd() * 0.9);
          const px = cx + Math.cos(angle) * r;
          const py = cy + Math.sin(angle) * r * 1.2;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.fill();
        for (let k = 0; k < 12; k++) {
          const angle = rnd() * Math.PI * 2;
          const d = size * (1.1 + rnd() * 2.8);
          const r2 = size * (0.05 + rnd() * 0.2);
          g.beginPath();
          g.ellipse(
            cx + Math.cos(angle) * d,
            cy + Math.sin(angle) * d * 1.3,
            r2,
            r2 * (0.6 + rnd() * 0.9),
            rnd() * Math.PI,
            0,
            Math.PI * 2,
          );
          g.fill();
        }
      };
      for (let i = 0; i < 18; i++) {
        const brown = rnd() < 0.5 ? "72,58,36" : "54,48,40";
        g.fillStyle = `rgba(${brown},${A(0.22 + rnd() * 0.3)})`;
        splatter(10 + rnd() * (W - 20), 20 + rnd() * (H - 40), 3 + rnd() * 9);
      }

      // 흘러내린 자국
      for (let i = 0; i < 13; i++) {
        const x = 12 + rnd() * (W - 24);
        const y0 = 20 + rnd() * (H - 140);
        const len = 30 + rnd() * 90;
        const w2 = 1.5 + rnd() * 3.5;
        const gr = g.createLinearGradient(0, y0, 0, y0 + len);
        gr.addColorStop(0, `rgba(70,58,38,${A(0.3)})`);
        gr.addColorStop(1, "rgba(70,58,38,0)");
        g.fillStyle = gr;
        g.fillRect(x, y0, w2, len);
        g.fillStyle = `rgba(70,58,38,${A(0.28)})`;
        g.beginPath();
        g.ellipse(x + w2 / 2, y0 + len, w2 * 1.4, w2 * 1.9, 0, 0, Math.PI * 2);
        g.fill();
      }

      // 쌓인 먼지 — 경계가 울퉁불퉁해야 테두리 칠이 아니라 쌓인 것이 된다
      const dustBank = (axis: "horizontal" | "vertical", direction: number, thickness: number) => {
        g.fillStyle = `rgba(58,52,40,${A(0.3)})`;
        g.beginPath();
        if (axis === "horizontal") {
          const y0 = direction > 0 ? 0 : H;
          g.moveTo(0, y0);
          for (let x = 0; x <= W; x += 8) {
            const d = thickness * (0.45 + 0.55 * rnd());
            g.lineTo(x, y0 + direction * d);
          }
          g.lineTo(W, y0);
        } else {
          const x0 = direction > 0 ? 0 : W;
          g.moveTo(x0, 0);
          for (let y = 0; y <= H; y += 10) {
            const d = thickness * (0.45 + 0.55 * rnd());
            g.lineTo(x0 + direction * d, y);
          }
          g.lineTo(x0, H);
        }
        g.closePath();
        g.fill();
      };
      dustBank("horizontal", 1, 26);
      dustBank("horizontal", -1, 30);
      dustBank("vertical", 1, 22);
      dustBank("vertical", -1, 22);
      for (const [cx, cy] of [
        [0, 0],
        [W, 0],
        [0, H],
        [W, H],
      ]) {
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 70);
        gr.addColorStop(0, `rgba(48,42,32,${A(0.42)})`);
        gr.addColorStop(1, "rgba(48,42,32,0)");
        g.fillStyle = gr;
        g.fillRect(cx - 70, cy - 70, 140, 140);
      }

      // 죽은 벌레 — 트로프 골인 좌우 가장자리에 몰린다
      for (let i = 0; i < 62; i++) {
        const towardEdge = Math.pow(rnd(), 0.5);
        const x = rnd() < 0.5 ? 6 + (1 - towardEdge) * (W * 0.45) : W - 6 - (1 - towardEdge) * (W * 0.45);
        const y = 14 + rnd() * (H - 28);
        const r = 1.6 + rnd() * (rnd() < 0.15 ? 5.5 : 2.8);
        g.fillStyle = `rgba(34,29,22,${A(0.55 + rnd() * 0.4)})`;
        g.beginPath();
        g.ellipse(x, y, r * (0.4 + rnd() * 0.5), r, rnd() * Math.PI, 0, Math.PI * 2);
        g.fill();
        if (r > 3.2) {
          g.strokeStyle = `rgba(34,29,22,${A(0.5)})`;
          g.lineWidth = 1;
          for (let k = 0; k < 3; k++) {
            const angle = rnd() * Math.PI * 2;
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x + Math.cos(angle) * r * 1.8, y + Math.sin(angle) * r * 2.2);
            g.stroke();
          }
        }
      }

      // 거미줄 — 네 모서리에만 옅게
      g.strokeStyle = `rgba(150,146,134,${A(0.4)})`;
      g.lineWidth = 1;
      for (const [cx, cy] of [
        [6, 6],
        [W - 6, 6],
        [6, H - 6],
        [W - 6, H - 6],
      ])
        for (let k = 1; k <= 3; k++) {
          g.beginPath();
          g.arc(cx, cy, 10 + k * 9, 0, Math.PI * 2);
          g.stroke();
        }

      // 테두리 때 — 틀에 닿는 가장자리만
      const rim = (x0: number, y0: number, w: number, h: number, a: number) => {
        g.fillStyle = `rgba(40,35,27,${A(a)})`;
        g.fillRect(x0, y0, w, h);
      };
      for (let i = 0; i < 10; i++) {
        rim(0, 0, W, 2 + rnd() * 7, 0.12 + rnd() * 0.14);
        rim(0, H - (2 + rnd() * 7), W, 9, 0.12 + rnd() * 0.14);
        rim(0, 0, 2 + rnd() * 6, H, 0.1 + rnd() * 0.12);
        rim(W - (2 + rnd() * 6), 0, 8, H, 0.1 + rnd() * 0.12);
      }

      // 미세 점 — 밝기를 깎지 않을 만큼만
      for (let i = 0; i < 1500; i++) {
        g.fillStyle = `rgba(60,55,45,${A(0.04 + rnd() * 0.08)})`;
        g.fillRect(rnd() * W, rnd() * H, 1 + rnd(), 1 + rnd());
      }

      // 먼지 뭉치 — 흐린 큰 얼룩 안에 진한 심을 넣어야 덩어리로 보인다
      for (let i = 0; i < 14; i++) {
        const cx = rnd() * W,
          cy = rnd() * H,
          r = 8 + rnd() * 26;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, `rgba(52,47,38,${A(0.3 + rnd() * 0.2)})`);
        gr.addColorStop(0.6, `rgba(52,47,38,${A(0.14)})`);
        gr.addColorStop(1, "rgba(52,47,38,0)");
        g.fillStyle = gr;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
        g.fillStyle = `rgba(40,36,29,${A(0.35)})`;
        g.beginPath();
        g.ellipse(
          cx + (rnd() - 0.5) * r * 0.5,
          cy + (rnd() - 0.5) * r * 0.5,
          r * 0.22,
          r * 0.16,
          rnd() * Math.PI,
          0,
          Math.PI * 2,
        );
        g.fill();
      }

      // 툰 테두리선 — 외곽선은 실루엣 바깥만 두르므로 판과 틀이 만나는 안쪽 경계는 여기서 긋는다
      g.strokeStyle = "rgba(19,19,20,0.85)";
      g.lineWidth = 7;
      g.strokeRect(3.5, 3.5, W - 7, H - 7);
      g.strokeStyle = "rgba(19,19,20,0.35)";
      g.lineWidth = 2;
      g.strokeRect(11, 11, W - 22, H - 22);
    },
    { width: 160, height: 640 },
  );
}

/**
 * 낡은 문짝. 낡음은 어둡게가 아니라 얼룩덜룩하게다 — 균일하게 어두우면 새 문을 어두운 데 둔 것으로 보인다.
 * 캔버스는 문 비율(폭 3 : 높이 6.4)에 맞춘 세로로 긴 256×544.
 */
export function wornDoorTexture(seed = 1, grime = 1) {
  return cachedCanvasTexture(
    `wornDoor|${seed}|${grime.toFixed(2)}`,
    (g, W, H) => {
      const rnd = makeRandom(seed * 613 + 29);
      const A = (v: number) => Math.min(0.92, v * grime);

      g.fillStyle = "#9b968b";
      g.fillRect(0, 0, W, H);

      // 넓게 겹친 색 얼룩 — 세월의 바탕
      for (let i = 0; i < 46; i++) {
        const cx = rnd() * W,
          cy = rnd() * H,
          r = 20 + rnd() * 120;
        const tone = rnd() < 0.5 ? "76,72,64" : "150,146,136";
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, `rgba(${tone},${A(0.08 + rnd() * 0.16)})`);
        gr.addColorStop(1, `rgba(${tone},0)`);
        g.fillStyle = gr;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }

      // 페인트 벗겨짐 — 테두리 한 줄이 있어야 얼룩이 아니라 떨어져 나간 단차로 보인다
      const peel = (cx: number, cy: number, size: number) => {
        g.beginPath();
        const n = 9 + Math.floor(rnd() * 6);
        for (let i = 0; i <= n; i++) {
          const angle = (i / n) * Math.PI * 2;
          const r = size * (0.35 + rnd() * 0.95);
          const px = cx + Math.cos(angle) * r;
          const py = cy + Math.sin(angle) * r * 1.3;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.fillStyle = `rgba(96,88,74,${A(0.55)})`;
        g.fill();
        g.strokeStyle = `rgba(52,47,39,${A(0.6)})`;
        g.lineWidth = 1.6;
        g.stroke();
      };
      for (let i = 0; i < 26; i++) {
        // 발에 차이고 물이 닿는 아래쪽이 더 벗겨진다
        const towardBottom = Math.pow(rnd(), 0.6);
        peel(6 + rnd() * (W - 12), 20 + towardBottom * (H - 30), 4 + rnd() * 16);
      }

      // 녹물·빗물 흘러내린 자국
      for (let i = 0; i < 22; i++) {
        const x = rnd() * W;
        const y0 = rnd() * H * 0.55;
        const len = 60 + rnd() * 260;
        const w2 = 1 + rnd() * 4;
        const rust = rnd() < 0.45 ? "104,66,34" : "62,58,48";
        const gr = g.createLinearGradient(0, y0, 0, y0 + len);
        gr.addColorStop(0, `rgba(${rust},${A(0.32)})`);
        gr.addColorStop(1, `rgba(${rust},0)`);
        g.fillStyle = gr;
        g.fillRect(x, y0, w2, len);
      }

      // 물 차오른 자국 — 문 아랫부분이 젖었다 마른 흔적
      for (let k = 0; k < 3; k++) {
        const base = H - 40 - k * 34 - rnd() * 20;
        g.beginPath();
        g.moveTo(0, H);
        g.lineTo(0, base);
        for (let x = 0; x <= W; x += 7) g.lineTo(x, base + (rnd() - 0.5) * 12);
        g.lineTo(W, H);
        g.closePath();
        g.fillStyle = `rgba(70,60,44,${A(0.16)})`;
        g.fill();
      }

      // 아래쪽 때
      const gb = g.createLinearGradient(0, H, 0, H * 0.6);
      gb.addColorStop(0, `rgba(38,34,27,${A(0.55)})`);
      gb.addColorStop(1, "rgba(38,34,27,0)");
      g.fillStyle = gb;
      g.fillRect(0, H * 0.6, W, H * 0.4);

      // 긁힘 — 어두운 얼룩만 있으면 평평해 보인다
      for (let i = 0; i < 40; i++) {
        const x = rnd() * W,
          y = rnd() * H;
        const angle = (rnd() - 0.5) * 0.8 + (rnd() < 0.5 ? 0 : Math.PI / 2);
        const l = 6 + rnd() * 40;
        g.strokeStyle = rnd() < 0.5 ? `rgba(190,186,176,${A(0.25)})` : `rgba(46,42,35,${A(0.3)})`;
        g.lineWidth = 0.8 + rnd() * 1.4;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(angle) * l, y + Math.sin(angle) * l);
        g.stroke();
      }

      // 튄 자국
      for (let i = 0; i < 10; i++) {
        g.fillStyle = `rgba(58,50,36,${A(0.3)})`;
        const cx = rnd() * W,
          cy = rnd() * H,
          k = 2 + rnd() * 7;
        g.beginPath();
        const n = 10;
        for (let j = 0; j <= n; j++) {
          const angle = (j / n) * Math.PI * 2;
          const r = k * (0.5 + rnd() * 0.9);
          const px = cx + Math.cos(angle) * r,
            py = cy + Math.sin(angle) * r;
          if (j === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.fill();
        for (let m = 0; m < 8; m++) {
          const angle = rnd() * Math.PI * 2,
            d = k * (1.2 + rnd() * 2.4),
            r2 = k * 0.12;
          g.beginPath();
          g.arc(cx + Math.cos(angle) * d, cy + Math.sin(angle) * d, r2, 0, Math.PI * 2);
          g.fill();
        }
      }

      for (let i = 0; i < 2200; i++) {
        g.fillStyle = `rgba(50,46,38,${A(0.05 + rnd() * 0.1)})`;
        g.fillRect(rnd() * W, rnd() * H, 1 + rnd(), 1 + rnd());
      }

      // 툰 테두리
      g.strokeStyle = "rgba(19,19,20,0.8)";
      g.lineWidth = 8;
      g.strokeRect(4, 4, W - 8, H - 8);
    },
    { width: 256, height: 544 },
  );
}
