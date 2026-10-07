// 그림 「막차」 두 장 — 창이 전부 꺼진 밤 풍경(바탕)과 불 든 창만 그린 투명한 한 장(창빛).
// 전류가 닿아야 창빛이 얹혀 어느 창이 켜지는지는 전기가 와야 안다.
import { cachedCanvasTexture } from "@/engine/textures/canvas";
import { makeRandom } from "@/engine/random";

import { PAINTING_HEIGHT_PX, PAINTING_WIDTH_PX } from "./dimensions";
import { SIGN_FONT } from "@/engine/textures/fonts";
import { LAST_TRAIN_PASSENGERS, WINDOW_COUNT } from "./workLampState";

interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 객차 창 여섯(그림 픽셀). 바탕·창빛이 같은 값을 봐야 빛이 창에 맞는다. 양 끝 문 사이에 들어간다.
const CAR_WINDOWS: WindowRect[] = Array.from({ length: WINDOW_COUNT }, (_, i) => ({
  x: 384 + i * 222,
  y: 606,
  w: 180,
  h: 150,
}));

/** 창 안에 앉은 사람 — 가운데는 창틀 살이 가르므로 좌우로만 앉힌다 */
function drawSeatedPerson(g: CanvasRenderingContext2D, w: WindowRect, i: number, color: string) {
  const px = w.x + w.w * [0.3, 0.7, 0.27][i % 3];
  g.fillStyle = color;
  g.beginPath();
  g.arc(px, w.y + w.h * 0.44, 17, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(px - 30, w.y + w.h);
  g.lineTo(px - 24, w.y + w.h * 0.62);
  g.quadraticCurveTo(px, w.y + w.h * 0.54, px + 24, w.y + w.h * 0.62);
  g.lineTo(px + 30, w.y + w.h);
  g.closePath();
  g.fill();
}

/** 그린 그림에서 색을 떠서 짧은 붓질로 다시 얹는다 */
function addBrushStrokes(g: CanvasRenderingContext2D, W: number, H: number, seed: number, count = 36000) {
  const source = g.getImageData(0, 0, W, H).data;
  const rnd = makeRandom(seed);
  g.save();
  g.lineCap = "round";
  for (let i = 0; i < count; i++) {
    const x = rnd() * W,
      y = rnd() * H;
    const k = ((y | 0) * W + (x | 0)) * 4;
    const jitter = (rnd() - 0.5) * 18;
    const r = Math.min(255, Math.max(0, source[k] + jitter));
    const gg = Math.min(255, Math.max(0, source[k + 1] + jitter));
    const b = Math.min(255, Math.max(0, source[k + 2] + jitter * 1.2));
    // 대체로 가로 — 아래(승강장)는 원근을 따라 기운다
    const angle = (rnd() - 0.5) * 0.7 + (y > H * 0.78 ? (x / W - 0.5) * 0.5 : 0);
    // 16 px 넘게 끌면 경계를 가로질러 어두운 털이 선다
    const length = 4 + rnd() * 8;
    g.strokeStyle = `rgba(${r | 0},${gg | 0},${b | 0},${0.22 + rnd() * 0.25})`;
    g.lineWidth = 1.5 + rnd() * 2.5;
    g.beginPath();
    g.moveTo(x - (Math.cos(angle) * length) / 2, y - (Math.sin(angle) * length) / 2);
    g.lineTo(x + (Math.cos(angle) * length) / 2, y + (Math.sin(angle) * length) / 2);
    g.stroke();
  }
  g.restore();
}

/** 바탕 — 밤 승강장에 선 막차. 창은 전부 꺼져 있다. */
export function lastTrainBackgroundTexture() {
  return cachedCanvasTexture(
    "workLampPaintingBackground",
    (g, W, H) => {
      const rnd = makeRandom(1987);

      // ── 하늘 — 위는 먹색 남빛, 지평선은 먼 읍내 불빛에 탁한 자줏빛 ──
      const sky = g.createLinearGradient(0, 0, 0, H * 0.62);
      sky.addColorStop(0, "#070c1a");
      sky.addColorStop(0.45, "#16233f");
      sky.addColorStop(0.8, "#34405e");
      sky.addColorStop(1, "#5b4f5e");
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      const moonX = 1640,
        moonY = 210;
      const halo = g.createRadialGradient(moonX, moonY, 40, moonX, moonY, 520);
      halo.addColorStop(0, "rgba(236,226,188,0.42)");
      halo.addColorStop(0.25, "rgba(160,170,190,0.16)");
      halo.addColorStop(1, "rgba(120,130,160,0)");
      g.fillStyle = halo;
      g.fillRect(0, 0, W, H * 0.7);
      // 별 — 크기를 달리하고 밝은 몇은 십자 반짝임
      for (let i = 0; i < 320; i++) {
        const x = rnd() * W,
          y = rnd() * H * 0.45;
        const glow = rnd();
        g.fillStyle = `rgba(225,232,248,${0.25 + glow * 0.6})`;
        const r = glow > 0.96 ? 2.6 : glow > 0.8 ? 1.6 : 1;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        if (glow > 0.975) {
          g.strokeStyle = "rgba(225,232,248,0.5)";
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x - 9, y);
          g.lineTo(x + 9, y);
          g.moveTo(x, y - 9);
          g.lineTo(x, y + 9);
          g.stroke();
        }
      }
      // 구름 — 달빛에 윗면만 밝다
      for (let b = 0; b < 9; b++) {
        const cx = rnd() * W,
          cy = 120 + rnd() * 330,
          spread = 260 + rnd() * 420;
        for (let k = 0; k < 26; k++) {
          const x = cx + (rnd() - 0.5) * spread,
            y = cy + (rnd() - 0.5) * 50;
          const rx = 40 + rnd() * 90,
            ry = 14 + rnd() * 26;
          const gradient = g.createLinearGradient(0, y - ry, 0, y + ry);
          gradient.addColorStop(0, "rgba(120,132,160,0.22)");
          gradient.addColorStop(1, "rgba(20,26,44,0.22)");
          g.fillStyle = gradient;
          g.beginPath();
          g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.fillStyle = "#f2e9c6";
      g.beginPath();
      g.arc(moonX, moonY, 66, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(190,176,130,0.45)";
      for (const [dx, dy, r] of [
        [-18, -10, 16],
        [14, 18, 11],
        [22, -22, 8],
        [-8, 26, 7],
      ]) {
        g.beginPath();
        g.arc(moonX + dx, moonY + dy, r, 0, Math.PI * 2);
        g.fill();
      }

      // ── 먼 산 세 겹 — 멀수록 하늘빛에 묻힌다 ──
      const ridge = (base: number, rise: number, color: string, seed: number) => {
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(0, H);
        for (let x = 0; x <= W; x += 8) {
          const y =
            base -
            rise *
              (0.5 +
                0.3 * Math.sin(x * 0.0021 + seed) +
                0.15 * Math.sin(x * 0.0063 + seed * 2) +
                0.05 * Math.sin(x * 0.021 + seed * 3));
          g.lineTo(x, y);
        }
        g.lineTo(W, H);
        g.fill();
      };
      ridge(640, 190, "#2a3350", 1.2);
      ridge(700, 150, "#1d2640", 2.7);
      // 둘째 겹 산자락의 읍내 불빛
      for (let i = 0; i < 70; i++) {
        const x = rnd() * W,
          y = 660 + rnd() * 70;
        g.fillStyle = `rgba(255,${(190 + rnd() * 50) | 0},120,${0.35 + rnd() * 0.5})`;
        g.fillRect(x, y, 2 + rnd() * 3, 2);
      }
      ridge(760, 90, "#131a2c", 4.1);
      const haze = g.createLinearGradient(0, 700, 0, 1000);
      haze.addColorStop(0, "rgba(90,100,130,0)");
      haze.addColorStop(1, "rgba(90,100,130,0.22)");
      g.fillStyle = haze;
      g.fillRect(0, 700, W, 300);

      // ── 선로 · 자갈 ──
      g.fillStyle = "#181b21";
      g.fillRect(0, 985, W, 70);
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = `rgba(${(90 + rnd() * 60) | 0},${(90 + rnd() * 55) | 0},${(95 + rnd() * 50) | 0},0.5)`;
        g.fillRect(rnd() * W, 990 + rnd() * 62, 2 + rnd() * 3, 2);
      }
      for (const y of [1003, 1040]) {
        g.fillStyle = "#2c3038";
        g.fillRect(0, y, W, 9);
        g.fillStyle = "#a8b3c6";
        g.fillRect(0, y, W, 2);
      }

      drawCarriage(g, rnd);
      drawPlatform(g, W, H);

      // ── 유화 마감 — 붓결 · 캔버스 결 · 가장자리 어둡게 · 니스 누런 기 ──
      addBrushStrokes(g, W, H, 1987);
      g.globalAlpha = 0.05;
      for (let y = 0; y < H; y += 3) {
        g.fillStyle = y % 6 ? "#000" : "#fff";
        g.fillRect(0, y, W, 1);
      }
      for (let x = 0; x < W; x += 3) {
        g.fillStyle = x % 6 ? "#000" : "#fff";
        g.fillRect(x, 0, 1, H);
      }
      g.globalAlpha = 1;
      const vignette = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.5)");
      g.fillStyle = vignette;
      g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(200,170,90,0.07)";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(220,205,160,0.7)";
      g.font = `italic 34px Georgia, serif`;
      g.textAlign = "right";
      g.fillText("H.Y. '87", W - 110, H - 40);
    },
    {
      width: PAINTING_WIDTH_PX,
      height: PAINTING_HEIGHT_PX,
      willReadFrequently: true,
      anisotropy: 8,
      onCreate: (texture) => {
        texture.generateMipmaps = true;
      },
    },
  );
}

const CAR = { x0: 190, x1: 1880, top: 540, bottom: 968 };

/** 객차 — 옛 비둘기호 도색. 창은 전부 꺼져 있고 사람은 달빛 실루엣으로 보인다. */
function drawCarriage(g: CanvasRenderingContext2D, rnd: () => number) {
  const car = CAR;
  g.fillStyle = "#3b4146";
  g.beginPath();
  g.moveTo(car.x0 - 8, car.top + 26);
  g.quadraticCurveTo(car.x0 + 20, car.top - 26, car.x0 + 90, car.top - 30);
  g.lineTo(car.x1 - 90, car.top - 30);
  g.quadraticCurveTo(car.x1 - 20, car.top - 26, car.x1 + 8, car.top + 26);
  g.closePath();
  g.fill();
  g.fillStyle = "rgba(170,180,200,0.35)"; // 지붕 모서리 달빛
  g.fillRect(car.x0 + 90, car.top - 30, car.x1 - car.x0 - 180, 4);
  for (let x = car.x0 + 180; x < car.x1 - 150; x += 230) {
    g.fillStyle = "#2a2f33";
    g.fillRect(x, car.top - 52, 90, 24);
    g.fillStyle = "rgba(170,180,200,0.3)";
    g.fillRect(x, car.top - 52, 90, 3);
  }
  // 윗단 크림 · 아랫단 짙은 청록 · 붉은 가는 띠
  const upper = g.createLinearGradient(0, car.top, 0, 800);
  upper.addColorStop(0, "#d9cfae");
  upper.addColorStop(1, "#b7ab89");
  g.fillStyle = upper;
  g.fillRect(car.x0, car.top + 10, car.x1 - car.x0, 790 - car.top);
  const lower = g.createLinearGradient(0, 800, 0, car.bottom);
  lower.addColorStop(0, "#2f5e66");
  lower.addColorStop(1, "#1a3439");
  g.fillStyle = lower;
  g.fillRect(car.x0, 800, car.x1 - car.x0, car.bottom - 800);
  g.fillStyle = "#a8322b";
  g.fillRect(car.x0, 792, car.x1 - car.x0, 10);
  const sheen = g.createLinearGradient(0, car.top + 10, 0, car.top + 70);
  sheen.addColorStop(0, "rgba(255,250,230,0.35)");
  sheen.addColorStop(1, "rgba(255,250,230,0)");
  g.fillStyle = sheen;
  g.fillRect(car.x0, car.top + 10, car.x1 - car.x0, 60);
  g.fillStyle = "rgba(170,210,215,0.18)";
  g.fillRect(car.x0, 842, car.x1 - car.x0, 12);
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.fillRect(car.x0, 930, car.x1 - car.x0, 38);
  // 양 끝 — 둥글게 말려 들어가는 그늘
  for (const [x, side] of [
    [car.x0, 1],
    [car.x1, -1],
  ]) {
    const gradient = g.createLinearGradient(x, 0, x + side * 70, 0);
    gradient.addColorStop(0, "rgba(0,0,0,0.4)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gradient;
    g.fillRect(side > 0 ? x : x - 70, car.top + 10, 70, car.bottom - car.top - 10);
  }
  g.strokeStyle = "rgba(60,55,40,0.45)";
  g.lineWidth = 2;
  for (let x = car.x0 + 125; x < car.x1; x += 250) {
    g.beginPath();
    g.moveTo(x + 202, car.top + 12);
    g.lineTo(x + 202, car.bottom);
    g.stroke();
  }
  g.fillStyle = "rgba(60,55,40,0.5)";
  for (let x = car.x0 + 20; x < car.x1 - 10; x += 26) {
    g.beginPath();
    g.arc(x, car.top + 22, 2, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(x, 956, 2, 0, Math.PI * 2);
    g.fill();
  }
  // 창 밑에서 흘러내린 녹물
  for (let i = 0; i < 40; i++) {
    const x = car.x0 + rnd() * (car.x1 - car.x0),
      y = 760 + rnd() * 20,
      length = 40 + rnd() * 140;
    const gradient = g.createLinearGradient(0, y, 0, y + length);
    gradient.addColorStop(0, "rgba(120,70,40,0.35)");
    gradient.addColorStop(1, "rgba(120,70,40,0)");
    g.fillStyle = gradient;
    g.fillRect(x, y, 2 + rnd() * 3, length);
  }
  for (const x of [car.x0 + 50, car.x1 - 150]) {
    g.fillStyle = "#c6bb98";
    g.fillRect(x, car.top + 30, 100, car.bottom - car.top - 40);
    g.strokeStyle = "#2c2c26";
    g.lineWidth = 4;
    g.strokeRect(x, car.top + 30, 100, car.bottom - car.top - 40);
    g.beginPath();
    g.moveTo(x + 50, car.top + 30);
    g.lineTo(x + 50, car.bottom - 10);
    g.stroke();
    g.fillStyle = "#11151b";
    g.fillRect(x + 12, car.top + 60, 30, 90);
    g.fillRect(x + 58, car.top + 60, 30, 90);
    g.fillStyle = "#8d8f8a";
    g.fillRect(x - 6, 700, 5, 150);
    g.fillRect(x + 101, 700, 5, 150);
  }
  CAR_WINDOWS.forEach((w, i) => {
    g.fillStyle = "rgba(60,50,30,0.35)";
    g.fillRect(w.x - 16, w.y - 14, w.w + 32, w.h + 30);
    g.fillStyle = "#2b2b24";
    g.fillRect(w.x - 10, w.y - 10, w.w + 20, w.h + 20);
    const glass = g.createLinearGradient(w.x, w.y, w.x + w.w, w.y + w.h);
    glass.addColorStop(0, "#1a2130");
    glass.addColorStop(1, "#0b0e14");
    g.fillStyle = glass;
    g.fillRect(w.x, w.y, w.w, w.h);
    g.fillStyle = "rgba(40,46,58,0.8)";
    g.fillRect(w.x + 12, w.y + 86, 62, 64);
    g.fillRect(w.x + 106, w.y + 86, 62, 64);
    // 불이 꺼져도 보이게 — 「사람 있는 창은 켠다」가 풀리려면 바탕에 있어야 한다
    if (LAST_TRAIN_PASSENGERS[i] === "1") drawSeatedPerson(g, w, i, "rgba(150,168,196,0.62)");
    g.fillStyle = "rgba(120,96,70,0.55)";
    g.fillRect(w.x, w.y, w.w, 26 + ((w.x * 7) % 30));
    g.fillStyle = "rgba(200,215,240,0.14)";
    g.beginPath();
    g.moveTo(w.x + 30, w.y + w.h);
    g.lineTo(w.x + 70, w.y + w.h);
    g.lineTo(w.x + 150, w.y);
    g.lineTo(w.x + 110, w.y);
    g.fill();
    g.fillStyle = "#2b2b24";
    g.fillRect(w.x + w.w / 2 - 4, w.y, 8, w.h);
  });
  g.fillStyle = "#f1ede0";
  g.fillRect(990, 812, 150, 40);
  g.strokeStyle = "#1c1c1a";
  g.lineWidth = 3;
  g.strokeRect(990, 812, 150, 40);
  g.fillStyle = "#1c1c1a";
  g.font = `bold 26px ${SIGN_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("막차 ▸ 왜곡", 1065, 833);
  g.fillStyle = "#d9cfae";
  g.font = `bold 22px ${SIGN_FONT}`;
  g.fillText("비둘기 1987", car.x0 + 340, 900);
  g.fillStyle = "#0f1115";
  g.fillRect(car.x0 + 10, car.bottom, car.x1 - car.x0 - 20, 22);
  for (const bx of [420, 1640]) {
    g.fillStyle = "#171a1f";
    g.fillRect(bx - 130, 970, 260, 34);
    for (const wx of [bx - 80, bx + 80]) {
      g.fillStyle = "#0c0e11";
      g.beginPath();
      g.arc(wx, 1005, 40, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(160,170,190,0.45)";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(wx, 1005, 32, Math.PI * 1.1, Math.PI * 1.7);
      g.stroke();
      g.fillStyle = "#3a3f47";
      g.beginPath();
      g.arc(wx, 1005, 10, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = "#2d3239";
    g.lineWidth = 5;
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.moveTo(bx - 20 + k * 12, 972);
      g.lineTo(bx - 14 + k * 12, 998);
      g.stroke();
    }
  }
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.fillRect(car.x0, car.bottom - 30, car.x1 - car.x0, 30);
}

/** 승강장 — 원근 타일 · 점자 블록 · 물웅덩이, 앞쪽 기둥 · 역 이름판 · 가로등 · 기다리는 사람 */
function drawPlatform(g: CanvasRenderingContext2D, W: number, H: number) {
  const floor = g.createLinearGradient(0, 1055, 0, H);
  floor.addColorStop(0, "#3f444c");
  floor.addColorStop(1, "#23262c");
  g.fillStyle = floor;
  g.fillRect(0, 1055, W, H - 1055);
  g.strokeStyle = "rgba(20,22,26,0.6)";
  g.lineWidth = 2;
  const vanishX = W / 2;
  for (let x = -W; x < W * 2; x += 150) {
    g.beginPath();
    g.moveTo(vanishX + (x - vanishX) * 0.35, 1060);
    g.lineTo(x, H);
    g.stroke();
  }
  for (let k = 0; k < 7; k++) {
    const y = 1060 + Math.pow(k / 7, 1.7) * (H - 1060);
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.fillStyle = "#c9ad3e";
  g.fillRect(0, 1060, W, 34);
  g.fillStyle = "rgba(90,70,20,0.55)";
  for (let x = 10; x < W; x += 22)
    for (const y of [1068, 1084]) {
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }
  g.fillStyle = "#e6e0cc";
  g.fillRect(0, 1055, W, 5);
  // 물웅덩이 — 객차를 거꾸로 비춘다
  g.save();
  g.beginPath();
  g.ellipse(1180, 1230, 330, 52, 0, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = "#1c2230";
  g.fillRect(800, 1170, 760, 130);
  g.fillStyle = "rgba(200,190,160,0.25)";
  g.fillRect(800, 1178, 760, 20);
  g.fillStyle = "rgba(47,94,102,0.4)";
  g.fillRect(800, 1198, 760, 30);
  g.restore();
  g.strokeStyle = "rgba(180,190,210,0.25)";
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(1180, 1230, 330, 52, 0, 0, Math.PI * 2);
  g.stroke();

  g.fillStyle = "#0d1016";
  g.fillRect(0, 0, W, 64);
  for (const x of [70, 1960]) {
    g.fillRect(x - 22, 0, 44, H);
    g.fillStyle = "rgba(160,170,190,0.18)";
    g.fillRect(x + 14, 0, 5, H);
    g.fillStyle = "#0d1016";
  }
  g.fillStyle = "#0d1016";
  g.fillRect(1790, 64, 4, 70);
  g.fillRect(1946, 64, 4, 70);
  g.fillStyle = "#e9ecef";
  g.fillRect(1760, 134, 220, 96);
  g.strokeStyle = "#1a3a8c";
  g.lineWidth = 8;
  g.strokeRect(1764, 138, 212, 88);
  g.fillStyle = "#172033";
  g.font = `900 48px ${SIGN_FONT}`;
  g.fillText("왜 곡", 1870, 176);
  g.font = `bold 18px ${SIGN_FONT}`;
  g.fillText("WAEGOK", 1870, 212);
  g.fillStyle = "#0d1016";
  g.fillRect(170, 380, 10, 700);
  g.fillRect(140, 370, 70, 16);
  const lampGlow = g.createRadialGradient(175, 395, 4, 175, 395, 230);
  lampGlow.addColorStop(0, "rgba(255,236,190,0.9)");
  lampGlow.addColorStop(0.1, "rgba(255,226,170,0.4)");
  lampGlow.addColorStop(1, "rgba(255,226,170,0)");
  g.fillStyle = lampGlow;
  g.fillRect(0, 160, 420, 500);
  g.fillStyle = "rgba(255,230,180,0.06)";
  g.beginPath();
  g.moveTo(150, 392);
  g.lineTo(200, 392);
  g.lineTo(340, 1070);
  g.lineTo(40, 1070);
  g.fill();
  // 우산을 든 뒷모습
  g.fillStyle = "#0a0c11";
  g.beginPath();
  g.ellipse(310, 1025, 28, 34, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(270, 1060);
  g.quadraticCurveTo(310, 1040, 350, 1060);
  g.lineTo(362, 1250);
  g.lineTo(258, 1250);
  g.fill();
  g.fillRect(272, 1250, 30, 70);
  g.fillRect(318, 1250, 30, 70);
  g.strokeStyle = "#0a0c11";
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(350, 1110);
  g.lineTo(390, 930);
  g.stroke();
  g.beginPath();
  g.moveTo(310, 950);
  g.quadraticCurveTo(390, 860, 480, 945);
  g.closePath();
  g.fill();
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.beginPath();
  g.ellipse(310, 1322, 70, 12, 0, 0, Math.PI * 2);
  g.fill();
}

/** 창빛 — 불 든 창 · 새어 나온 빛 · 웅덩이에 비친 빛만. 켜진 창은 스위치 무늬("101101")를 그대로 따른다. */
export function lastTrainWindowLightTexture(switchKey: string | null) {
  const lit = String(switchKey ?? "").padStart(CAR_WINDOWS.length, "0");
  return cachedCanvasTexture(
    `workLampPaintingLights|${lit}`,
    (g) => {
      const rnd = makeRandom(88);
      CAR_WINDOWS.forEach((w, i) => {
        if (lit[i] !== "1") return;
        const cx = w.x + w.w / 2,
          cy = w.y + w.h / 2;
        const bloom = g.createRadialGradient(cx, cy, 20, cx, cy, 240);
        bloom.addColorStop(0, "rgba(255,200,110,0.55)");
        bloom.addColorStop(1, "rgba(255,200,110,0)");
        g.fillStyle = bloom;
        g.fillRect(cx - 260, cy - 260, 520, 520);
        const room = g.createLinearGradient(0, w.y, 0, w.y + w.h);
        room.addColorStop(0, "#fff1c4");
        room.addColorStop(1, "#ffc567");
        g.fillStyle = room;
        g.fillRect(w.x, w.y, w.w, w.h);
        // 사람은 승객이 있는 창에만 — 빈 창은 좌석만 환하다
        g.fillStyle = "rgba(120,80,40,0.55)";
        g.fillRect(w.x + 12, w.y + 86, 62, 64);
        g.fillRect(w.x + 106, w.y + 86, 62, 64);
        if (LAST_TRAIN_PASSENGERS[i] === "1") drawSeatedPerson(g, w, i, "rgba(70,45,25,0.85)");
        g.strokeStyle = "rgba(110,80,50,0.6)";
        g.lineWidth = 3;
        for (let k = 0; k < 3; k++) {
          const x = w.x + 32 + k * 58;
          g.beginPath();
          g.moveTo(x, w.y);
          g.lineTo(x, w.y + 30);
          g.stroke();
          g.beginPath();
          g.arc(x, w.y + 36, 6, 0, Math.PI * 2);
          g.stroke();
        }
        g.fillStyle = "rgba(210,120,60,0.6)";
        g.fillRect(w.x, w.y, w.w, 26 + ((w.x * 7) % 30));
        g.fillStyle = "rgba(43,43,36,0.9)";
        g.fillRect(w.x + w.w / 2 - 4, w.y, 8, w.h);
        // 승강장으로 쏟아진 빛 — 창 모양이 비스듬히 늘어진다
        const spill = g.createLinearGradient(0, 1060, 0, 1300);
        spill.addColorStop(0, "rgba(255,205,120,0.38)");
        spill.addColorStop(1, "rgba(255,205,120,0)");
        g.fillStyle = spill;
        g.beginPath();
        g.moveTo(w.x - 10, 1058);
        g.lineTo(w.x + w.w + 10, 1058);
        g.lineTo(w.x + w.w + 90, 1300);
        g.lineTo(w.x - 60, 1300);
        g.fill();
        g.fillStyle = "rgba(255,190,110,0.18)";
        g.fillRect(w.x - 20, w.y + w.h + 10, w.w + 40, 30);
      });
      g.save();
      g.beginPath();
      g.ellipse(1180, 1230, 330, 52, 0, 0, Math.PI * 2);
      g.clip();
      CAR_WINDOWS.forEach((w, i) => {
        if (lit[i] !== "1") return;
        for (let k = 0; k < 6; k++) {
          g.fillStyle = `rgba(255,205,120,${0.25 + rnd() * 0.25})`;
          g.fillRect(w.x + (rnd() - 0.5) * 10, 1196 + k * 7, w.w, 3);
        }
      });
      g.restore();
    },
    { width: PAINTING_WIDTH_PX, height: PAINTING_HEIGHT_PX, willReadFrequently: false, anisotropy: 8 },
  );
}
