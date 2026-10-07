import type * as THREE from "three";

import { TEXTURE_SCALE } from "@/engine/quality";
import { addGrain, cachedCanvasTexture } from "@/engine/textures/canvas";

import { BOARD_FONT_FAMILY, handRng } from "./handwriting";

/** 코르크판 가로 */
export const PIN_W = 3.6;
/** 코르크판 세로 */
export const PIN_H = 2.4;
/** 판 아랫변 높이 — 화이트보드와 같은 다리 높이 */
export const PIN_LIFT = 1.7;

export type PhotoKind = "spring" | "signboard" | "eastGateBridge" | "oldDocument" | "cadastralMap";
export type NoteKind = "distance" | "source" | "testimony" | "wordingMismatch";
export type CardKind = PhotoKind | NoteKind;

const NOTE_LINES: Record<NoteKind, string[]> = {
  distance: ["거리 불일치", "A판본 二里", "C판본 五里", "→ 어느 쪽?"],
  source: ["출처 미상", "구전만 존재", "문헌 기록 X"],
  testimony: ["증언 상충", "노인회 ≠", "시청 자료"],
  wordingMismatch: ["안내판 문구", "'샘' vs '내'", "표기 상이"],
};

const PHOTO_CAPTIONS: Record<PhotoKind, string> = {
  spring: "완사천 현장",
  signboard: "안내판 A · 문구",
  eastGateBridge: "나주 동문다리",
  oldDocument: "고문헌 사본",
  cadastralMap: "지적도 조각",
};

export const isNoteKind = (kind: CardKind): kind is NoteKind => kind in NOTE_LINES;

/** 코르크판 바탕 — 갈색에 자잘한 얼룩 */
export function corkTexture(): THREE.CanvasTexture {
  // 저사양 모드에서만 절반(1024→512). 그리기는 W/H 기준이라 비율은 그대로다.
  const width = Math.round(1024 * TEXTURE_SCALE);
  return cachedCanvasTexture(
    "pinCork",
    (g, W, H) => {
      g.fillStyle = "#A87B4E";
      g.fillRect(0, 0, W, H);
      const rnd = handRng(4242);
      for (let i = 0; i < 5200; i++) {
        const x = (rnd() + 0.5) * W;
        const y = (rnd() + 0.5) * H;
        const v = rnd();
        g.fillStyle = v > 0 ? `rgba(120,80,44,${0.1 + v * 0.5})` : `rgba(212,170,120,${0.1 - v * 0.5})`;
        g.beginPath();
        g.arc(x, y, 1 + (rnd() + 0.5) * 3, 0, Math.PI * 2);
        g.fill();
      }
    },
    { width, height: Math.round((width * PIN_H) / PIN_W) },
  );
}

function drawNote(g: CanvasRenderingContext2D, W: number, H: number, kind: NoteKind, rnd: () => number) {
  g.fillStyle = "#F3E9C6";
  g.fillRect(0, 0, W, H);
  g.font = `400 34px ${BOARD_FONT_FAMILY}`;
  g.fillStyle = "#2B3038";
  NOTE_LINES[kind].forEach((t, i) => {
    g.save();
    g.translate(24, 66 + i * 54);
    g.rotate(rnd() * 0.03);
    g.fillText(t, 0, 0);
    g.restore();
  });
}

/** 사진 속 대상. 추상적인 얼룩이 아니라 시나리오의 실제 대상 실루엣이라 작게 보여도 무엇인지 읽힌다. */
function drawPhotoSubject(
  g: CanvasRenderingContext2D,
  kind: PhotoKind,
  m: number,
  pw: number,
  ph: number,
  rnd: () => number,
) {
  if (kind === "spring") {
    // 샘 — 어두운 숲 아래 물줄기와 돌
    g.fillStyle = "#3E4A3C";
    g.fillRect(m, m, pw, ph * 0.5);
    g.fillStyle = "#55613F";
    g.fillRect(m, m + ph * 0.42, pw, ph * 0.22);
    g.fillStyle = "#7E9BAE";
    g.beginPath();
    g.moveTo(m, m + ph * 0.68);
    g.quadraticCurveTo(m + pw * 0.5, m + ph * 0.58, m + pw, m + ph * 0.74);
    g.lineTo(m + pw, m + ph);
    g.lineTo(m, m + ph);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(240,248,255,0.55)"; // 물결
    g.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const y = m + ph * (0.76 + i * 0.05);
      g.beginPath();
      g.moveTo(m + 14, y);
      g.lineTo(m + pw - 14, y + rnd() * 6);
      g.stroke();
    }
    g.fillStyle = "#8C8B84"; // 돌
    const stones: [number, number, number][] = [
      [0.24, 0.7, 20],
      [0.52, 0.76, 14],
      [0.74, 0.68, 17],
    ];
    stones.forEach(([fx, fy, r]) => {
      g.beginPath();
      g.ellipse(m + pw * fx, m + ph * fy, r, r * 0.62, 0, 0, Math.PI * 2);
      g.fill();
    });
  } else if (kind === "signboard") {
    // 관광 안내판 — 문구 줄 + 빨간 동그라미(불일치 지점)
    g.fillStyle = "#5E6A5A";
    g.fillRect(m, m, pw, ph);
    g.fillStyle = "#6B6257"; // 기둥
    g.fillRect(m + pw * 0.28, m + ph * 0.46, 10, ph * 0.5);
    g.fillRect(m + pw * 0.68, m + ph * 0.46, 10, ph * 0.5);
    g.fillStyle = "#E7E1CE"; // 판
    g.fillRect(m + pw * 0.16, m + ph * 0.12, pw * 0.68, ph * 0.4);
    g.fillStyle = "#3A3F47";
    for (let i = 0; i < 4; i++) {
      const y = m + ph * (0.2 + i * 0.08);
      g.fillRect(m + pw * 0.21, y, pw * (0.3 + (rnd() + 0.5) * 0.26), 5);
    }
    g.strokeStyle = "#C0392B";
    g.lineWidth = 4;
    g.beginPath();
    g.ellipse(m + pw * 0.45, m + ph * 0.37, 40, 17, 0, 0, Math.PI * 2);
    g.stroke();
  } else if (kind === "eastGateBridge") {
    // 아치 다리 — 하늘/물 사이에 걸린 실루엣
    g.fillStyle = "#6E7C8A";
    g.fillRect(m, m, pw, ph * 0.62);
    g.fillStyle = "#4C5C68";
    g.fillRect(m, m + ph * 0.62, pw, ph * 0.38);
    g.strokeStyle = "#2F343B";
    g.lineWidth = 12;
    g.beginPath(); // 아치
    g.moveTo(m + 12, m + ph * 0.66);
    g.quadraticCurveTo(m + pw * 0.5, m + ph * 0.24, m + pw - 12, m + ph * 0.66);
    g.stroke();
    g.lineWidth = 5;
    g.beginPath(); // 난간
    g.moveTo(m + 12, m + ph * 0.5);
    g.quadraticCurveTo(m + pw * 0.5, m + ph * 0.12, m + pw - 12, m + ph * 0.5);
    g.stroke();
    g.lineWidth = 3;
    for (let i = 1; i < 7; i++) {
      const fx = i / 7;
      const x0 = m + 12 + (pw - 24) * fx;
      const ya = m + ph * (0.5 - 0.38 * Math.sin(Math.PI * fx));
      const yb = m + ph * (0.66 - 0.42 * Math.sin(Math.PI * fx));
      g.beginPath();
      g.moveTo(x0, ya);
      g.lineTo(x0, yb);
      g.stroke();
    }
  } else if (kind === "oldDocument") {
    // 고문헌 — 누런 종이에 세로 글줄 + 붉은 낙관
    g.fillStyle = "#D9CDA8";
    g.fillRect(m, m, pw, ph);
    g.strokeStyle = "rgba(60,50,34,0.35)";
    g.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
      const x0 = m + pw * (0.1 + i * 0.12);
      g.beginPath();
      g.moveTo(x0, m + ph * 0.12);
      g.lineTo(x0, m + ph * 0.88);
      g.stroke();
    }
    g.fillStyle = "#3B3427";
    for (let i = 0; i < 7; i++) {
      const x0 = m + pw * (0.1 + i * 0.12) - 4;
      const n = 5 + Math.floor((rnd() + 0.5) * 4);
      for (let j = 0; j < n; j++) g.fillRect(x0, m + ph * (0.16 + j * 0.1), 9, 9 + (rnd() + 0.5) * 6);
    }
    g.fillStyle = "rgba(176,48,36,0.85)"; // 낙관
    g.fillRect(m + pw * 0.76, m + ph * 0.72, 30, 30);
  } else {
    // 지적도 조각 — 등고선과 붉은 X
    g.fillStyle = "#E4DFCD";
    g.fillRect(m, m, pw, ph);
    g.strokeStyle = "rgba(80,90,70,0.6)";
    g.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.ellipse(m + pw * 0.46, m + ph * 0.52, 26 + i * 22, 16 + i * 14, 0.3, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = "rgba(70,90,120,0.75)"; // 물길
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(m + 8, m + ph * 0.24);
    g.quadraticCurveTo(m + pw * 0.5, m + ph * 0.6, m + pw - 8, m + ph * 0.42);
    g.stroke();
    g.strokeStyle = "#C0392B";
    g.lineWidth = 6;
    const xc = m + pw * 0.46;
    const yc = m + ph * 0.52;
    g.beginPath();
    g.moveTo(xc - 16, yc - 16);
    g.lineTo(xc + 16, yc + 16);
    g.moveTo(xc + 16, yc - 16);
    g.lineTo(xc - 16, yc + 16);
    g.stroke();
  }
}

/** 폴라로이드 사진 한 장 */
function drawPhoto(
  g: CanvasRenderingContext2D,
  W: number,
  H: number,
  kind: PhotoKind,
  seed: number,
  rnd: () => number,
) {
  g.fillStyle = "#F6F4EE";
  g.fillRect(0, 0, W, H);
  const m = 16;
  const pw = W - m * 2;
  const ph = H - m * 2 - 44;
  g.save();
  g.beginPath();
  g.rect(m, m, pw, ph);
  g.clip();
  drawPhotoSubject(g, kind, m, pw, ph, rnd);
  g.restore();

  // 오래된 사진 느낌 — 살짝 바랜 톤과 테두리
  g.fillStyle = "rgba(226,214,184,0.16)";
  g.fillRect(m, m, pw, ph);
  g.strokeStyle = "rgba(0,0,0,0.3)";
  g.lineWidth = 2;
  g.strokeRect(m, m, pw, ph);

  g.font = `400 30px ${BOARD_FONT_FAMILY}`;
  g.fillStyle = "#2B3038";
  g.textAlign = "center";
  g.fillText(PHOTO_CAPTIONS[kind], W / 2, H - 14);

  addGrain(g, W, H, seed * 17 + 5, 1.0); // 오래 붙어 있던 사진의 손때·바램
}

/** 핀에 꽂힌 카드 한 장(사진 또는 메모) */
export function pinCardTexture(kind: CardKind, seed: number): THREE.CanvasTexture {
  const isNote = isNoteKind(kind);
  return cachedCanvasTexture(
    `pinCard|${kind}|${seed}`,
    (g, W, H) => {
      const rnd = handRng(seed);
      if (isNoteKind(kind)) drawNote(g, W, H, kind, rnd);
      else drawPhoto(g, W, H, kind, seed, rnd);
    },
    { width: 320, height: isNote ? 300 : 250 },
  );
}
