import { makeCachedCanvasTexture, SIGN_FONT } from "@/engine/textures/canvas";
import { createRandom } from "@/engine/random";

import type { TrashBin } from "./workLampState";

/** 통 몸통의 결 — 긁힘 · 바닥 때 · 흘러내린 얼룩 · 구청 스티커 */
export function makeBinBodyTexture(bin: TrashBin) {
  const isPlastic = bin === "plastic";
  return makeCachedCanvasTexture(
    `workLampBinBody|${bin}`,
    (g, W, H) => {
      g.fillStyle = isPlastic ? "#2d64a8" : "#50574d";
      g.fillRect(0, 0, W, H);
      const rnd = createRandom(isPlastic ? 311 : 313);
      // 사출 성형 세로 결
      for (let x = 0; x < W; x += 6) {
        g.fillStyle = `rgba(255,255,255,${0.015 + rnd() * 0.02})`;
        g.fillRect(x, 0, 2, H);
      }
      // 흘러내린 얼룩
      for (let i = 0; i < 14; i++) {
        const x = rnd() * W,
          y0 = rnd() * H * 0.5,
          length = 60 + rnd() * 220;
        const gradient = g.createLinearGradient(0, y0, 0, y0 + length);
        gradient.addColorStop(0, "rgba(20,18,12,0)");
        gradient.addColorStop(0.3, "rgba(20,18,12,0.22)");
        gradient.addColorStop(1, "rgba(20,18,12,0)");
        g.fillStyle = gradient;
        g.fillRect(x, y0, 2 + rnd() * 4, length);
      }
      // 발에 차이고 물걸레에 젖은 아랫단
      const grime = g.createLinearGradient(0, H * 0.72, 0, H);
      grime.addColorStop(0, "rgba(28,24,18,0)");
      grime.addColorStop(1, "rgba(28,24,18,0.55)");
      g.fillStyle = grime;
      g.fillRect(0, H * 0.72, W, H * 0.28);
      g.strokeStyle = "rgba(230,235,240,0.18)";
      g.lineWidth = 1;
      for (let i = 0; i < 40; i++) {
        const x = rnd() * W,
          y = rnd() * H,
          l = 6 + rnd() * 30,
          a = (rnd() - 0.5) * 0.9;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
      // 반쯤 뜯긴 관리 스티커
      g.save();
      g.translate(W * 0.72, H * 0.1);
      g.rotate(-0.06);
      g.fillStyle = "#e9e4d2";
      g.fillRect(-40, -14, 80, 28);
      g.fillStyle = "#b8b19a";
      g.beginPath();
      g.moveTo(22, -14);
      g.lineTo(40, -14);
      g.lineTo(40, 6);
      g.closePath();
      g.fill();
      g.fillStyle = "#3a3a36";
      g.font = `bold 12px ${SIGN_FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("왜곡역 관리", -4, -3);
      g.font = `9px ${SIGN_FONT}`;
      g.fillText("No. 0" + (isPlastic ? "7" : "6"), -4, 9);
      g.restore();
    },
    { width: 256, height: 512, willReadFrequently: false, anisotropy: 4 },
  );
}

/** 통 앞 표지 — 색 띠 · 그림 기호 · 배출 요령 */
export function makeBinSignTexture(bin: TrashBin) {
  const isPlastic = bin === "plastic";
  return makeCachedCanvasTexture(
    `workLampBinSign|${bin}`,
    (g, W, H) => {
      const band = isPlastic ? "#1f5fae" : "#3d4439";
      g.fillStyle = "#ecebe4";
      g.fillRect(0, 0, W, H);
      g.strokeStyle = "#171819";
      g.lineWidth = 10;
      g.strokeRect(5, 5, W - 10, H - 10);
      // 윗단 띠 — 멀리서도 통이 갈린다
      g.fillStyle = band;
      g.fillRect(10, 10, W - 20, 150);
      g.fillStyle = "#f7f8f9";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `900 ${isPlastic ? 86 : 74}px ${SIGN_FONT}`;
      g.fillText(isPlastic ? "플라스틱" : "일반쓰레기", W / 2, 72);
      g.font = `bold 26px ${SIGN_FONT}`;
      g.fillText(isPlastic ? "PLASTIC · 재활용" : "GENERAL WASTE · 종량제", W / 2, 132);
      g.save();
      g.translate(W / 2, 330);
      g.fillStyle = isPlastic ? "#dbe6f4" : "#dcdfd6";
      g.beginPath();
      g.arc(0, 0, 130, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = band;
      g.lineWidth = 12;
      g.stroke();
      g.fillStyle = band;
      g.strokeStyle = band;
      g.lineJoin = "round";
      g.lineCap = "round";
      if (isPlastic) {
        // 삼각형 둘레를 도는 순환 화살표 셋
        for (let k = 0; k < 3; k++) {
          g.save();
          g.rotate((k * Math.PI * 2) / 3);
          g.lineWidth = 16;
          g.beginPath();
          g.moveTo(-58, 38);
          g.lineTo(0, -62);
          g.stroke();
          g.beginPath();
          g.moveTo(-18, -66);
          g.lineTo(14, -48);
          g.lineTo(-8, -30);
          g.fill();
          g.restore();
        }
        g.font = `900 40px ${SIGN_FONT}`;
        g.fillText("PET", 0, 8);
      } else {
        // 묶은 종량제 봉투
        g.lineWidth = 12;
        g.beginPath();
        g.moveTo(-62, -20);
        g.quadraticCurveTo(-72, 70, -40, 86);
        g.lineTo(40, 86);
        g.quadraticCurveTo(72, 70, 62, -20);
        g.closePath();
        g.stroke();
        g.beginPath();
        g.moveTo(-30, -20);
        g.quadraticCurveTo(-34, -70, 0, -58);
        g.quadraticCurveTo(34, -70, 30, -20);
        g.stroke();
        g.font = `900 34px ${SIGN_FONT}`;
        g.fillText("종량제", 0, 36);
      }
      g.restore();
      g.fillStyle = "#1b1d21";
      g.font = `bold 30px ${SIGN_FONT}`;
      g.fillText(isPlastic ? "비우고 · 헹구고 · 뚜껑 닫아서" : "재활용 안 되는 것만", W / 2, 510);
      g.font = `24px ${SIGN_FONT}`;
      g.fillStyle = "#3a3d42";
      g.fillText(isPlastic ? "PET · PP · PE 용기류" : "휴지 · 마스크 · 나무젓가락 · 깨진 그릇", W / 2, 556);
      const rnd = createRandom(isPlastic ? 91 : 93);
      g.globalAlpha = 0.18;
      for (let i = 0; i < 60; i++) {
        g.fillStyle = rnd() > 0.5 ? "#2b2a25" : "#efe6c8";
        g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 30, 1 + rnd() * 3);
      }
      g.globalAlpha = 1;
    },
    { width: 512, height: 640, willReadFrequently: false, anisotropy: 8 },
  );
}

/** 통 둘레 바닥에 흘러 말라붙은 얼룩 */
export function makeFloorStainTexture() {
  return makeCachedCanvasTexture(
    "workLampBinStain",
    (g) => {
      const rnd = createRandom(404);
      for (let i = 0; i < 9; i++) {
        const x = 60 + rnd() * 136,
          y = 60 + rnd() * 136,
          r = 20 + rnd() * 60;
        const gradient = g.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, "rgba(22,18,12,0.5)");
        gradient.addColorStop(0.7, "rgba(22,18,12,0.28)");
        gradient.addColorStop(1, "rgba(22,18,12,0)");
        g.fillStyle = gradient;
        g.beginPath();
        g.ellipse(x, y, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2);
        g.fill();
      }
    },
    { width: 256, willReadFrequently: false, anisotropy: null },
  );
}

type PrintKind = "water" | "detergent" | "yogurt" | "cup" | "sleeve";

const PRINT_SIZE: Record<PrintKind, [number, number]> = {
  water: [256, 64],
  detergent: [256, 256],
  yogurt: [256, 64],
  cup: [256, 128],
  sleeve: [128, 64],
};

/** 쓰레기에 붙은 작은 인쇄물 — 상표 띠 · 세제 라벨 · 컵 무늬 · 젓가락 봉지 */
export function makePrintTexture(kind: PrintKind) {
  const [width, height] = PRINT_SIZE[kind];
  return makeCachedCanvasTexture(
    `workLampPrint|${kind}`,
    (g) => {
      if (kind === "water") {
        const gradient = g.createLinearGradient(0, 0, 0, 64);
        gradient.addColorStop(0, "#1f78c9");
        gradient.addColorStop(1, "#0f4f93");
        g.fillStyle = gradient;
        g.fillRect(0, 0, 256, 64);
        g.fillStyle = "#ffffff";
        g.fillRect(0, 44, 256, 5);
        g.font = `900 30px ${SIGN_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("맑은샘물", 70, 24);
        g.fillText("맑은샘물", 196, 24);
        g.font = `12px ${SIGN_FONT}`;
        g.fillText("500mL · 먹는샘물", 128, 56);
      } else if (kind === "detergent") {
        g.fillStyle = "#f6f7f9";
        g.beginPath();
        g.ellipse(128, 128, 118, 100, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#e8452f";
        g.font = `900 52px ${SIGN_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("싹싹", 128, 104);
        g.fillStyle = "#1d4f9c";
        g.font = `bold 30px ${SIGN_FONT}`;
        g.fillText("액체세제", 128, 152);
        g.font = `16px ${SIGN_FONT}`;
        g.fillText("2.5L · 드럼 겸용", 128, 186);
      } else if (kind === "cup") {
        // 역 매점 도자기 컵 — 크림 바탕에 파란 띠 둘, 때가 탄 자국
        g.fillStyle = "#f1ede2";
        g.fillRect(0, 0, 256, 128);
        g.fillStyle = "#2f5d9e";
        g.fillRect(0, 18, 256, 9);
        g.fillRect(0, 34, 256, 4);
        g.font = `bold 22px ${SIGN_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("왜곡역", 64, 78);
        g.fillText("왜곡역", 192, 78);
        const rnd = createRandom(77);
        g.fillStyle = "rgba(96,78,52,0.22)";
        for (let i = 0; i < 18; i++) g.fillRect(rnd() * 256, 90 + rnd() * 38, 6 + rnd() * 40, 2 + rnd() * 6);
      } else if (kind === "sleeve") {
        // 찢긴 나무젓가락 종이 봉지
        g.fillStyle = "#f4efe3";
        g.fillRect(0, 0, 128, 64);
        g.fillStyle = "#c9372c";
        g.fillRect(0, 0, 128, 10);
        g.fillRect(0, 54, 128, 10);
        g.font = `bold 15px ${SIGN_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("왜곡역 식당", 64, 32);
      } else {
        g.fillStyle = "#f3efe6";
        g.fillRect(0, 0, 256, 64);
        g.fillStyle = "#d8233b";
        g.font = `900 26px ${SIGN_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("요구르트", 64, 30);
        g.fillText("요구르트", 192, 30);
      }
    },
    { width, height, willReadFrequently: false, anisotropy: 4 },
  );
}
