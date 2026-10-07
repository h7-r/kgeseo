import type * as THREE from "three";

import { makeRandom } from "@/engine/random";
import { addGrain, cachedCanvasTexture } from "@/engine/textures/canvas";

export interface TrainDoorTextureOptions {
  /** 손잡이 가운데 — 패널 안 0=왼쪽, 1=오른쪽 */
  handleX?: number;
  /** 손잡이 가운데 높이(0=위, 1=아래) */
  handleY?: number;
  handleWidth?: number;
  handleHeight?: number;
  /** 좌우 문틀 폭(각각). 판은 차체 구멍에 묶여 못 줄이니 문틀로 밝은 면을 좁혀 보이게 한다 */
  frameWidth?: number;
  frameColor?: string;
  /** 얼룩·기스 세기(0=깨끗) */
  wear?: number;
}

// 문 비율(폭 0.447 : 높이 0.655)
const WIDTH = 384;
const HEIGHT = 562;

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/**
 * 낡은 강철 미닫이 문. 플러시 패널 + 파묻힌 손잡이 포켓 + 아래 킥패널 이음선.
 * 색은 재질 color 가 입히므로 밝은 중립색으로 그린다. 한 짝을 0~1 UV 로 덮어 타일 반복이 없다.
 */
export function trainDoorTexture(
  seed = 1,
  {
    handleX = 0.78,
    handleY = 0.53,
    handleWidth = 0.072,
    handleHeight = 0.15,
    frameWidth = 0.1,
    frameColor = "#1c2027",
    wear = 1,
  }: TrainDoorTextureOptions = {},
): THREE.CanvasTexture {
  const key = `trainDoor|${seed}|${[handleX, handleY, handleWidth, handleHeight, frameWidth, wear]
    .map((v) => v.toFixed(3))
    .join(",")}|${frameColor}`;

  return cachedCanvasTexture(
    key,
    (g, W, H) => {
      const rnd = makeRandom(seed * 977 + 41);

      // 문 면(밝은 패널)이 차지하는 좌우 범위 — 양옆은 문틀이 먹는다.
      const jw = W * frameWidth;
      const L = jw;
      const R = W - jw;
      const PW = R - L;

      // ① 바탕 — 밝은 중립 강철
      g.fillStyle = "#d7dae0";
      g.fillRect(0, 0, W, H);
      for (let x = 0; x < W; x += 2) {
        const v = (rnd() - 0.5) * 8;
        g.fillStyle = `rgba(${Math.round(196 + v)},${Math.round(200 + v)},${Math.round(206 + v)},0.16)`;
        g.fillRect(x, 0, 1, H);
      }
      // 위에서 비스듬히 떨어지는 금속 광택
      const sheen = g.createLinearGradient(0, 0, W * 0.7, H);
      sheen.addColorStop(0, "rgba(255,255,255,0.1)");
      sheen.addColorStop(0.35, "rgba(255,255,255,0.03)");
      sheen.addColorStop(0.55, "rgba(0,0,0,0.03)");
      sheen.addColorStop(1, "rgba(0,0,0,0.08)");
      g.fillStyle = sheen;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 20; i++) {
        const cx = L + rnd() * PW;
        const cy = rnd() * H;
        const r = 60 + rnd() * 140;
        const tone = rnd() < 0.5 ? "255,255,255" : "40,44,52";
        const gradient = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        gradient.addColorStop(0, `rgba(${tone},${(0.03 + rnd() * 0.06).toFixed(3)})`);
        gradient.addColorStop(1, `rgba(${tone},0)`);
        g.fillStyle = gradient;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }

      // ② 아래 킥패널 이음선 — 패널 안쪽만
      const kickY = H * 0.82;
      g.strokeStyle = "rgba(30,33,39,0.42)";
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(L + 4, kickY);
      g.lineTo(R - 4, kickY);
      g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.28)";
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(L + 4, kickY + 2.6);
      g.lineTo(R - 4, kickY + 2.6);
      g.stroke();

      // ③ 파묻힌 손잡이 포켓
      const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
        g.beginPath();
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r);
        g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r);
        g.arcTo(x, y, x + w, y, r);
        g.closePath();
      };
      const pw = W * handleWidth;
      const ph = H * handleHeight;
      const pr = 9;
      const px = L + PW * handleX - pw / 2;
      const py = H * handleY - ph / 2;
      const pocket = g.createLinearGradient(0, py, 0, py + ph);
      pocket.addColorStop(0, "rgba(20,22,27,0.9)");
      pocket.addColorStop(1, "rgba(48,52,60,0.6)");
      roundRect(px, py, pw, ph, pr);
      g.fillStyle = pocket;
      g.fill();
      roundRect(px, py, pw, ph, pr);
      g.strokeStyle = "rgba(14,16,21,0.7)";
      g.lineWidth = 2.4;
      g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.42)";
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(px + pr, py + ph - 1.3);
      g.lineTo(px + pw - pr, py + ph - 1.3);
      g.moveTo(px + pw - 1.3, py + pr);
      g.lineTo(px + pw - 1.3, py + ph - pr);
      g.stroke();
      // 포켓 위쪽 가로 그립
      const bx = px + 4;
      const bw = pw - 8;
      const by = py + 6;
      const bh = 6;
      g.fillStyle = "rgba(70,75,84,0.92)";
      g.fillRect(bx, by, bw, bh);
      g.fillStyle = "rgba(210,214,220,0.6)";
      g.fillRect(bx, by, bw, 1.4);
      g.fillStyle = "rgba(14,16,21,0.6)";
      g.fillRect(bx, by + bh - 1.4, bw, 1.4);
      g.fillStyle = "rgba(10,12,16,0.5)";
      g.fillRect(bx, by + bh, bw, ph - bh - 11);

      // ④ 눌린 금속 — 한쪽은 그늘, 반대쪽은 반사
      const dent = (cx: number, cy: number, r: number, strength: number) => {
        const a = rnd() * Math.PI * 2;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        let gradient = g.createRadialGradient(
          cx + dx * r * 0.4,
          cy + dy * r * 0.4,
          0,
          cx + dx * r * 0.4,
          cy + dy * r * 0.4,
          r,
        );
        gradient.addColorStop(0, `rgba(22,25,31,${(0.24 * strength).toFixed(3)})`);
        gradient.addColorStop(1, "rgba(22,25,31,0)");
        g.fillStyle = gradient;
        g.fillRect(cx - r * 1.6, cy - r * 1.6, r * 3.2, r * 3.2);
        gradient = g.createRadialGradient(
          cx - dx * r * 0.4,
          cy - dy * r * 0.4,
          0,
          cx - dx * r * 0.4,
          cy - dy * r * 0.4,
          r * 0.8,
        );
        gradient.addColorStop(0, `rgba(255,255,255,${(0.2 * strength).toFixed(3)})`);
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gradient;
        g.fillRect(cx - r * 1.6, cy - r * 1.6, r * 3.2, r * 3.2);
      };
      for (let i = 0; i < 3; i++)
        dent(L + 20 + rnd() * (PW - 40), 40 + rnd() * (H - 80), 15 + rnd() * 18, (0.6 + rnd() * 0.4) * wear);
      dent(L + PW * (rnd() < 0.5 ? 0.2 : 0.8), H * (0.72 + rnd() * 0.14), 26 + rnd() * 12, 0.85 * wear);

      // ⑤ 흘러내린 때·녹물 + 번진 자국
      for (let i = 0; i < 10; i++) {
        const x = L + rnd() * PW;
        const y0 = rnd() * H * 0.5;
        const len = 50 + rnd() * 200;
        const w2 = 1 + rnd() * 2.4;
        const rgb = rnd() < 0.3 ? "96,60,32" : "40,44,52";
        const gradient = g.createLinearGradient(0, y0, 0, y0 + len);
        gradient.addColorStop(0, `rgba(${rgb},${((0.13 + rnd() * 0.1) * wear).toFixed(3)})`);
        gradient.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = gradient;
        g.fillRect(x, y0, w2, len);
      }
      for (let i = 0; i < 3; i++) {
        const cx = L + 20 + rnd() * (PW - 40);
        const cy = H * (0.55 + rnd() * 0.36);
        const k = 11 + rnd() * 18;
        const rgb = rnd() < 0.5 ? "76,52,30" : "36,40,48";
        g.fillStyle = `rgba(${rgb},${((0.08 + rnd() * 0.08) * wear).toFixed(3)})`;
        g.beginPath();
        const n = 12;
        for (let j = 0; j <= n; j++) {
          const a2 = (j / n) * Math.PI * 2;
          const r = k * (0.5 + rnd() * 0.9);
          const qx = cx + Math.cos(a2) * r;
          const qy = cy + Math.sin(a2) * r * 1.2;
          if (j === 0) g.moveTo(qx, qy);
          else g.lineTo(qx, qy);
        }
        g.closePath();
        g.fill();
      }

      // ⑥ 기스 — 패널 안 + 손잡이 둘레
      const scratch = (x: number, y: number, l: number, a2: number, isLight: boolean) => {
        g.strokeStyle = isLight
          ? `rgba(255,255,255,${((0.13 + rnd() * 0.14) * wear).toFixed(3)})`
          : `rgba(24,27,33,${((0.15 + rnd() * 0.15) * wear).toFixed(3)})`;
        g.lineWidth = 0.6 + rnd() * 1.0;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a2) * l, y + Math.sin(a2) * l);
        g.stroke();
      };
      for (let i = 0; i < 18; i++)
        scratch(
          L + rnd() * PW,
          rnd() * H,
          6 + rnd() * 26,
          (rnd() - 0.5) * 1.0 + (rnd() < 0.5 ? 0 : Math.PI / 2),
          rnd() < 0.5,
        );
      for (let i = 0; i < 12; i++)
        scratch(
          px + pw / 2 + (rnd() - 0.5) * pw * 3,
          py + ph / 2 + (rnd() - 0.5) * ph * 1.8,
          7 + rnd() * 20,
          rnd() * Math.PI * 2,
          rnd() < 0.55,
        );

      // ⑦ 킥패널 아래로 갈수록 진해지는 때
      const grime = g.createLinearGradient(0, H, 0, kickY - 20);
      grime.addColorStop(0, "rgba(20,22,27,0.4)");
      grime.addColorStop(1, "rgba(20,22,27,0)");
      g.fillStyle = grime;
      g.fillRect(L, kickY - 20, PW, H - (kickY - 20));

      // ⑧ 미세 알갱이
      for (let i = 0; i < 1100; i++) {
        g.fillStyle = `rgba(34,38,45,${(0.025 + rnd() * 0.05).toFixed(3)})`;
        g.fillRect(L + rnd() * PW, rnd() * H, 1 + rnd(), 1 + rnd());
      }
      addGrain(g, W, H, seed * 53 + 7, 0.4);

      // ⑨ 양옆 문틀 — 살짝 어둡게 해 밝은 문 면을 좁아 보이게 한다
      g.fillStyle = `rgba(${hexToRgb(frameColor)},0.82)`;
      g.fillRect(0, 0, jw, H);
      g.fillRect(R, 0, jw, H);

      // 딱딱한 검정 테두리 대신 네 변을 은은하게 어둡게 — 문이 프레임에 잠긴 듯 보인다.
      // 외곽선은 메시의 조절 가능한 한 줄이 맡는다.
      const edge = 22;
      const edgeShade = (
        x: number,
        y: number,
        w: number,
        h: number,
        x0: number,
        y0: number,
        x1: number,
        y1: number,
      ) => {
        const gradient = g.createLinearGradient(x0, y0, x1, y1);
        gradient.addColorStop(0, "rgba(8,10,14,0.42)");
        gradient.addColorStop(1, "rgba(8,10,14,0)");
        g.fillStyle = gradient;
        g.fillRect(x, y, w, h);
      };
      edgeShade(0, 0, W, edge, 0, 0, 0, edge); // 위
      edgeShade(0, H - edge, W, edge, 0, H, 0, H - edge); // 아래
      edgeShade(0, 0, edge, H, 0, 0, edge, 0); // 왼쪽
      edgeShade(W - edge, 0, edge, H, W, 0, W - edge, 0); // 오른쪽
    },
    { width: WIDTH, height: HEIGHT },
  );
}
