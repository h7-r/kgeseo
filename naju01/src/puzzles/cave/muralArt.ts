/**
 * 벽화 — 아랑사·아비사 이야기 네 장면을 회벽에 물감으로 그린 것처럼. 선 그림이 아니라 면을 칠하고,
 * 회벽 결 · 바랜 얼룩 · 금 · 떨어져 나간 자리까지 그려 오래된 벽화로 보이게 한다.
 * 장면: 달(보름달 뜬 밤 강) · 배(아비사가 노를 저어 건넘) · 구렁이(강에서 솟음) · 바위(바위 위의 아랑사).
 * 문 위 띠(RingDoor)와 석실 돌 상자 네 면(InnerChamber)이 같이 쓴다.
 */
import * as THREE from "three";

import { createRandom } from "@/engine/random";

export type MuralScene = "달" | "배" | "구렁이" | "바위";
export const MURAL_ORDER: MuralScene[] = ["달", "배", "구렁이", "바위"];

/** 물감 — 오래돼 탁해진 석채 */
const PAINT = {
  plaster: "#CDBF9F",
  plasterDark: "#A8987A",
  night: "#2E3B52",
  nightDeep: "#1F2839",
  moon: "#F1E7C8",
  river: "#476A78",
  riverLight: "#8FB0B4",
  rock: "#6E6A62",
  rockLight: "#958F82",
  wood: "#7A5232",
  woodDark: "#4E3320",
  cloth: "#EDE6D3",
  red: "#A6402F",
  skin: "#D9B48C",
  hair: "#1E1A18",
  serpent: "#2F3A2E",
  serpentBelly: "#B9B08A",
  gold: "#C49A52",
  outline: "#2A2420",
};

type Ctx = CanvasRenderingContext2D;

/** 붓으로 칠한 면 — 가장자리가 살짝 흔들리고 안에 붓결 */
function fillShape(c: Ctx, path: (c: Ctx) => void, color: string, outline = true) {
  c.save();
  c.beginPath();
  path(c);
  c.fillStyle = color;
  c.fill();
  // 붓결 — 같은 색을 조금 밝게·어둡게 겹친다
  c.clip();
  c.globalAlpha = 0.18;
  for (let i = 0; i < 26; i++) {
    c.strokeStyle = i % 2 ? "#FFFFFF" : "#000000";
    c.lineWidth = 2 + (i % 3);
    c.beginPath();
    const y = (i / 26) * c.canvas.height * 1.2;
    c.moveTo(-20, y);
    c.bezierCurveTo(c.canvas.width * 0.3, y + 8, c.canvas.width * 0.6, y - 8, c.canvas.width + 20, y + 4);
    c.stroke();
  }
  c.restore();
  if (outline) {
    c.save();
    c.beginPath();
    path(c);
    c.strokeStyle = PAINT.outline;
    c.globalAlpha = 0.75;
    c.lineWidth = 3;
    c.lineJoin = "round";
    c.stroke();
    c.restore();
  }
}

function ellipse(c: Ctx, x: number, y: number, rx: number, ry: number, rotation = 0) {
  c.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
}

/** 강 — 칸 아래쪽을 채우는 물결 띠(면) */
function drawRiver(c: Ctx, w: number, h: number, top: number) {
  fillShape(
    c,
    (p) => {
      p.moveTo(0, top);
      for (let x = 0; x <= w; x += 40) p.quadraticCurveTo(x + 10, top - 6, x + 20, top);
      p.lineTo(w, h);
      p.lineTo(0, h);
      p.closePath();
    },
    PAINT.river,
    false,
  );
  c.save();
  c.strokeStyle = PAINT.riverLight;
  c.globalAlpha = 0.75;
  c.lineWidth = 3;
  c.lineCap = "round";
  for (let row = 0; row < 4; row++) {
    const y = top + 14 + row * ((h - top - 14) / 4);
    c.beginPath();
    for (let x = (row % 2) * 24; x < w; x += 54) {
      c.moveTo(x, y);
      c.quadraticCurveTo(x + 12, y - 7, x + 26, y);
    }
    c.stroke();
  }
  c.restore();
}

/** 밤하늘 — 칸 위쪽을 칠한다 */
function drawNight(c: Ctx, w: number, h: number) {
  const gradient = c.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, PAINT.nightDeep);
  gradient.addColorStop(1, PAINT.night);
  c.fillStyle = gradient;
  c.fillRect(0, 0, w, h);
}

/** 앙암바위 실루엣 — 강가에 우뚝 */
function drawCrag(c: Ctx, x: number, base: number, width: number, height: number) {
  fillShape(
    c,
    (p) => {
      p.moveTo(x, base);
      p.lineTo(x + width * 0.1, base - height * 0.55);
      p.lineTo(x + width * 0.28, base - height * 0.9);
      p.lineTo(x + width * 0.5, base - height);
      p.lineTo(x + width * 0.72, base - height * 0.82);
      p.lineTo(x + width * 0.9, base - height * 0.45);
      p.lineTo(x + width, base);
      p.closePath();
    },
    PAINT.rock,
  );
  c.save();
  c.strokeStyle = PAINT.rockLight;
  c.globalAlpha = 0.6;
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(x + width * 0.3, base - height * 0.8);
  c.lineTo(x + width * 0.42, base - height * 0.35);
  c.moveTo(x + width * 0.6, base - height * 0.75);
  c.lineTo(x + width * 0.68, base - height * 0.3);
  c.stroke();
  c.restore();
}

/** 사람 — 흰 저고리. 아비사는 상투와 바지, 아랑사는 붉은 치마와 쪽 */
function drawPerson(c: Ctx, x: number, feet: number, height: number, kind: "아비사" | "아랑사") {
  const head = height * 0.13;
  const top = feet - height;
  if (kind === "아랑사") {
    // 붉은 치마 — 아래로 넓게 퍼진다
    fillShape(
      c,
      (p) => {
        p.moveTo(x - height * 0.09, top + height * 0.4);
        p.quadraticCurveTo(x - height * 0.24, feet - height * 0.1, x - height * 0.26, feet);
        p.lineTo(x + height * 0.26, feet);
        p.quadraticCurveTo(x + height * 0.24, feet - height * 0.1, x + height * 0.09, top + height * 0.4);
        p.closePath();
      },
      PAINT.red,
    );
  } else {
    // 바지 두 가랑이
    for (const side of [-1, 1])
      fillShape(
        c,
        (p) => {
          p.moveTo(x + side * height * 0.01, top + height * 0.5);
          p.lineTo(x + side * height * 0.14, top + height * 0.52);
          p.lineTo(x + side * height * 0.12, feet);
          p.lineTo(x + side * height * 0.03, feet);
          p.closePath();
        },
        PAINT.cloth,
      );
  }
  // 저고리
  fillShape(
    c,
    (p) => {
      p.moveTo(x - height * 0.12, top + head * 2);
      p.lineTo(x + height * 0.12, top + head * 2);
      p.lineTo(x + height * 0.14, top + height * (kind === "아랑사" ? 0.42 : 0.55));
      p.lineTo(x - height * 0.14, top + height * (kind === "아랑사" ? 0.42 : 0.55));
      p.closePath();
    },
    PAINT.cloth,
  );
  if (kind === "아랑사") {
    // 옷고름
    c.save();
    c.strokeStyle = PAINT.red;
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(x, top + head * 2.6);
    c.lineTo(x + height * 0.05, top + height * 0.38);
    c.stroke();
    c.restore();
  }
  // 얼굴 · 머리
  fillShape(c, (p) => ellipse(p, x, top + head, head * 0.78, head), PAINT.skin);
  if (kind === "아비사") {
    fillShape(c, (p) => ellipse(p, x, top + head * 0.25, head * 0.8, head * 0.42), PAINT.hair);
    fillShape(c, (p) => ellipse(p, x, top - head * 0.2, head * 0.28, head * 0.32), PAINT.hair);
  } else {
    fillShape(c, (p) => ellipse(p, x, top + head * 0.3, head * 0.85, head * 0.5), PAINT.hair);
    fillShape(c, (p) => ellipse(p, x + head * 0.6, top + head * 1.1, head * 0.42, head * 0.36), PAINT.hair);
  }
}

/** 장면 하나 — (0,0)~(w,h) 칸에 그린다 */
/** 작은 나룻배 — 멀리 보이는 아비사의 배(노 젓는 사람까지) */
function drawBoat(c: Ctx, x: number, water: number, width: number, withAbisa: boolean) {
  fillShape(
    c,
    (p) => {
      p.moveTo(x - width / 2, water - width * 0.02);
      p.quadraticCurveTo(x, water + width * 0.16, x + width / 2, water - width * 0.02);
      p.lineTo(x + width * 0.42, water - width * 0.1);
      p.lineTo(x - width * 0.42, water - width * 0.1);
      p.closePath();
    },
    PAINT.wood,
  );
  if (withAbisa) drawPerson(c, x, water - width * 0.1, width * 0.55, "아비사");
}

/**
 * 장면 넷 — 전부 아랑사(붉은 치마)와 아비사(배 젓는 어부)의 이야기로:
 *   달   보름달 아래 강 건너 둘 — 아랑사는 바위 위에서 기다리고, 아비사의 배가 건너온다
 *   배   아비사가 노를 저어 건너가고, 저편 둑에서 아랑사가 손을 흔든다
 *   구렁이 구렁이가 솟아 아비사의 배를 덮친다
 *   바위 바위 위의 아랑사가 돌이 되어 가고, 빈 배만 강에 떠 있다
 */
function drawScene(c: Ctx, scene: MuralScene, w: number, h: number) {
  const river = h * 0.68;
  drawNight(c, w, h);
  if (scene === "달") {
    // 보름달과 달무리, 강에 비친 달빛
    const glow = c.createRadialGradient(w * 0.5, h * 0.32, 0, w * 0.5, h * 0.32, h * 0.42);
    glow.addColorStop(0, "rgba(241,231,200,0.5)");
    glow.addColorStop(1, "rgba(241,231,200,0)");
    c.fillStyle = glow;
    c.fillRect(0, 0, w, h);
    fillShape(c, (p) => ellipse(p, w * 0.5, h * 0.32, h * 0.2, h * 0.2), PAINT.moon);
    drawCrag(c, w * 0.04, river + 4, w * 0.22, h * 0.4);
    drawCrag(c, w * 0.76, river + 4, w * 0.2, h * 0.3);
    // 왼쪽 바위 위의 아랑사 — 강 건너를 본다
    drawPerson(c, w * 0.15, river + 4 - h * 0.4, h * 0.26, "아랑사");
    drawRiver(c, w, h, river);
    // 건너오는 아비사의 배
    drawBoat(c, w * 0.62, river + h * 0.12, w * 0.26, true);
    c.save();
    c.fillStyle = PAINT.moon;
    c.globalAlpha = 0.55;
    for (let i = 0; i < 5; i++) c.fillRect(w * 0.5 - h * (0.12 - i * 0.018), river + 14 + i * 16, h * (0.24 - i * 0.036), 5);
    c.restore();
  } else if (scene === "배") {
    drawRiver(c, w, h, river);
    // 나룻배 — 나무결
    fillShape(
      c,
      (p) => {
        p.moveTo(w * 0.16, river - 4);
        p.quadraticCurveTo(w * 0.5, river + h * 0.16, w * 0.84, river - 4);
        p.lineTo(w * 0.78, river - h * 0.07);
        p.lineTo(w * 0.22, river - h * 0.07);
        p.closePath();
      },
      PAINT.wood,
    );
    c.save();
    c.strokeStyle = PAINT.woodDark;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(w * 0.24, river - h * 0.03);
    c.quadraticCurveTo(w * 0.5, river + h * 0.07, w * 0.76, river - h * 0.03);
    c.stroke();
    c.restore();
    drawPerson(c, w * 0.5, river - h * 0.07, h * 0.42, "아비사");
    // 저편 둑의 아랑사 — 작게, 손을 흔든다
    drawCrag(c, w * 0.78, river + 2, w * 0.2, h * 0.16);
    drawPerson(c, w * 0.88, river + 2 - h * 0.16, h * 0.2, "아랑사");
    // 노
    c.save();
    c.strokeStyle = PAINT.woodDark;
    c.lineWidth = 7;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(w * 0.56, river - h * 0.32);
    c.lineTo(w * 0.78, river + h * 0.12);
    c.stroke();
    c.restore();
    fillShape(c, (p) => ellipse(p, w * 0.8, river + h * 0.14, w * 0.04, h * 0.02, 0.6), PAINT.woodDark, false);
  } else if (scene === "구렁이") {
    drawRiver(c, w, h, river);
    // 구렁이 — 강에서 S 자로 솟아 고개를 든다. 굵은 몸에 비늘 무늬, 배는 누렇다
    const body = (p: Ctx) => {
      p.moveTo(w * 0.18, river + h * 0.18);
      p.bezierCurveTo(w * 0.32, river - h * 0.35, w * 0.6, river + h * 0.15, w * 0.68, river - h * 0.35);
      p.bezierCurveTo(w * 0.72, river - h * 0.5, w * 0.8, river - h * 0.55, w * 0.82, river - h * 0.5);
    };
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = PAINT.outline;
    c.lineWidth = h * 0.15;
    c.beginPath();
    body(c);
    c.stroke();
    c.strokeStyle = PAINT.serpent;
    c.lineWidth = h * 0.12;
    c.beginPath();
    body(c);
    c.stroke();
    c.strokeStyle = PAINT.serpentBelly;
    c.globalAlpha = 0.7;
    c.lineWidth = h * 0.035;
    c.setLineDash([h * 0.04, h * 0.03]);
    c.beginPath();
    body(c);
    c.stroke();
    c.restore();
    fillShape(c, (p) => ellipse(p, w * 0.84, river - h * 0.52, h * 0.1, h * 0.065, -0.3), PAINT.serpent);
    fillShape(c, (p) => ellipse(p, w * 0.87, river - h * 0.55, h * 0.018, h * 0.018), PAINT.gold, false);
    // 구렁이 아래 아비사의 배 — 기우뚱 덮친다
    c.save();
    c.translate(w * 0.3, river + h * 0.1);
    c.rotate(-0.22);
    drawBoat(c, 0, 0, w * 0.3, true);
    c.restore();
    // 물보라
    c.save();
    c.fillStyle = PAINT.cloth;
    c.globalAlpha = 0.7;
    for (let i = 0; i < 9; i++) {
      c.beginPath();
      ellipse(c, w * 0.18 + (i - 4) * h * 0.035, river + h * 0.08 - Math.abs(i - 4) * -h * 0.01 - (4 - Math.abs(i - 4)) * h * 0.025, h * 0.018, h * 0.03);
      c.fill();
    }
    c.restore();
  } else {
    // 바위 위의 아랑사 — 바위가 되어 간다
    drawRiver(c, w, h, river);
    drawCrag(c, w * 0.22, river + h * 0.08, w * 0.56, h * 0.55);
    drawPerson(c, w * 0.5, river + h * 0.08 - h * 0.53, h * 0.3, "아랑사");
    // 빈 배만 강에 — 아비사는 없다
    drawBoat(c, w * 0.14, river + h * 0.14, w * 0.2, false);
    // 달빛 한 줄기가 그녀에게
    c.save();
    const beam = c.createLinearGradient(w * 0.5, 0, w * 0.5, h * 0.35);
    beam.addColorStop(0, "rgba(241,231,200,0.35)");
    beam.addColorStop(1, "rgba(241,231,200,0)");
    c.fillStyle = beam;
    c.beginPath();
    c.moveTo(w * 0.42, 0);
    c.lineTo(w * 0.58, 0);
    c.lineTo(w * 0.54, h * 0.35);
    c.lineTo(w * 0.46, h * 0.35);
    c.closePath();
    c.fill();
    c.restore();
  }
}

/** 오래된 회벽 — 바랜 얼룩, 금, 칠이 떨어져 회벽이 드러난 자리 */
function weather(c: Ctx, w: number, h: number, seed: number) {
  const random = createRandom(seed);
  c.save();
  // 전체를 조금 바래게
  c.fillStyle = PAINT.plaster;
  c.globalAlpha = 0.16;
  c.fillRect(0, 0, w, h);
  // 얼룩
  for (let i = 0; i < 30; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = 20 + random() * 80;
    const stain = c.createRadialGradient(x, y, 0, x, y, r);
    stain.addColorStop(0, random() < 0.5 ? "rgba(60,48,30,0.16)" : "rgba(235,225,200,0.14)");
    stain.addColorStop(1, "rgba(0,0,0,0)");
    c.globalAlpha = 1;
    c.fillStyle = stain;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // 칠이 떨어진 자리 — 회벽이 드러난다
  for (let i = 0; i < 9; i++) {
    const x = random() * w;
    const y = random() < 0.5 ? random() * h * 0.2 : h - random() * h * 0.25;
    c.globalAlpha = 0.85;
    c.fillStyle = random() < 0.5 ? PAINT.plaster : PAINT.plasterDark;
    c.beginPath();
    c.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const r = 8 + random() * 26;
      c.lineTo(x + Math.cos(a) * r * 1.4, y + Math.sin(a) * r);
    }
    c.closePath();
    c.fill();
  }
  // 금
  c.strokeStyle = "rgba(30,24,18,0.55)";
  c.lineWidth = 1.6;
  for (let i = 0; i < 6; i++) {
    let x = random() * w;
    let y = random() * h;
    c.beginPath();
    c.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += (random() - 0.5) * 60;
      y += 10 + random() * 24;
      c.lineTo(x, y);
    }
    c.stroke();
  }
  // 회벽 알갱이
  const image = c.getImageData(0, 0, w, h);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (random() - 0.5) * 22;
    image.data[i] += n;
    image.data[i + 1] += n;
    image.data[i + 2] += n;
  }
  c.putImageData(image, 0, 0);
  c.restore();
}

/** 장면 칸을 감싸는 테 — 황토 띠에 검은 줄 */
function frame(c: Ctx, x: number, y: number, w: number, h: number) {
  c.save();
  c.strokeStyle = PAINT.gold;
  c.lineWidth = 10;
  c.strokeRect(x + 5, y + 5, w - 10, h - 10);
  c.strokeStyle = PAINT.outline;
  c.lineWidth = 2;
  c.strokeRect(x + 12, y + 12, w - 24, h - 24);
  c.restore();
}

function toTexture(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** 긴 띠 — 네 장면을 왼쪽부터 이야기 순서로. 가로:세로 = ratio */
export function makeMuralStripTexture(ratio: number, seed = 911) {
  const h = 256;
  const w = Math.round(h * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d", { willReadFrequently: true })!;
  c.fillStyle = PAINT.plaster;
  c.fillRect(0, 0, w, h);
  const pad = 18;
  const cell = (w - pad * 2) / MURAL_ORDER.length;
  MURAL_ORDER.forEach((scene, i) => {
    c.save();
    c.translate(pad + i * cell + 10, pad + 10);
    c.beginPath();
    c.rect(0, 0, cell - 20, h - pad * 2 - 20);
    c.clip();
    drawScene(c, scene, cell - 20, h - pad * 2 - 20);
    c.restore();
    frame(c, pad + i * cell, pad, cell, h - pad * 2);
  });
  weather(c, w, h, seed);
  return toTexture(canvas);
}

/** 한 장면 — 돌 상자 한 면에 붙인다. 가로:세로 = ratio */
export function makeMuralPanelTexture(scene: MuralScene, ratio: number, seed = 1) {
  const h = 256;
  const w = Math.round(h * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d", { willReadFrequently: true })!;
  c.fillStyle = PAINT.plaster;
  c.fillRect(0, 0, w, h);
  c.save();
  c.translate(18, 18);
  c.beginPath();
  c.rect(0, 0, w - 36, h - 36);
  c.clip();
  drawScene(c, scene, w - 36, h - 36);
  c.restore();
  frame(c, 8, 8, w - 16, h - 16);
  weather(c, w, h, seed);
  return toTexture(canvas);
}

/**
 * 돌에 새긴 띠 — 아치 위 벽에 직접 새기고 물감이 거의 다 씻겨 나간 부조. 액자 테 없이 장면 사이는 파인 골,
 * 그림은 밝기 차를 홈과 도드라짐(양각)으로 바꿔 돌결 위에 얹고, 바랜 물감은 조금만 남긴다. 가장자리는 부서져 맨 돌로 녹아든다.
 * 칸 배치는 makeMuralStripTexture 와 같다(여백 18 · 네 칸) — 진주 빛 셰이더가 같은 셈을 쓴다
 */
export function makeMuralReliefTexture(ratio: number, seed = 911) {
  const h = 256;
  const w = Math.round(h * ratio);
  const paint = document.createElement("canvas");
  paint.width = w;
  paint.height = h;
  const p = paint.getContext("2d", { willReadFrequently: true })!;
  p.fillStyle = PAINT.plaster;
  p.fillRect(0, 0, w, h);
  const pad = 18;
  const cell = (w - pad * 2) / MURAL_ORDER.length;
  MURAL_ORDER.forEach((scene, i) => {
    p.save();
    p.translate(pad + i * cell + 10, pad + 10);
    p.beginPath();
    p.rect(0, 0, cell - 20, h - pad * 2 - 20);
    p.clip();
    drawScene(p, scene, cell - 20, h - pad * 2 - 20);
    p.restore();
  });
  const source = p.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = (source[i * 4] * 0.3 + source[i * 4 + 1] * 0.59 + source[i * 4 + 2] * 0.11) / 255;
  const at = (x: number, y: number) => lum[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];

  const random = createRandom(seed);
  // 돌결 — 큰 얼룩(성긴 격자를 부드럽게 이은 것) + 잔 알갱이
  const GRID = 24;
  const gw = Math.ceil(w / GRID) + 2;
  const gh = Math.ceil(h / GRID) + 2;
  const blotch = Array.from({ length: gw * gh }, () => random());
  const smoothAt = (x: number, y: number) => {
    const gx = x / GRID;
    const gy = y / GRID;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const v = (i: number, j: number) => blotch[(y0 + j) * gw + (x0 + i)];
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    return (v(0, 0) * (1 - sx) + v(1, 0) * sx) * (1 - sy) + (v(0, 1) * (1 - sx) + v(1, 1) * sx) * sy;
  };
  // 부서진 가장자리 — 안쪽 사각을 들쭉날쭉하게. 밖은 맨 돌
  const inset = 10;
  const ragged = (t: number, k: number) => 6 * Math.sin(t * 0.045 + k) + 4 * Math.sin(t * 0.13 + k * 2.3) + 3 * (smoothAt(t, k * 30) - 0.5) * 2;

  const out = p.createImageData(w, h);
  const stone = [96, 104, 102];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const grain = (random() - 0.5) * 18;
      const b = (smoothAt(x, y) - 0.5) * 34;
      let r = stone[0] + b + grain;
      let g = stone[1] + b + grain;
      let bl = stone[2] + b * 0.9 + grain;
      const inside =
        x > inset + ragged(y, 1) && x < w - inset - ragged(y, 2) && y > inset + ragged(x, 3) && y < h - inset - ragged(x, 4);
      if (inside) {
        // 양각 — 왼쪽 위에서 빛이 드는 것처럼. 밝기 차가 큰 데(선·윤곽)가 깊게 파인다
        const relief = (at(x - 2, y - 2) - at(x + 2, y + 2)) * 150;
        const L = lum[i];
        const shade = 0.78 + 0.34 * (L - 0.5);
        r = r * shade + relief;
        g = g * shade + relief;
        bl = bl * shade + relief;
        // 바랜 물감 — 붉은 댕기 · 달 · 물빛만 희미하게 남는다
        const pr = source[i * 4];
        const pg = source[i * 4 + 1];
        const pb = source[i * 4 + 2];
        const sat = (Math.max(pr, pg, pb) - Math.min(pr, pg, pb)) / 255;
        const keep = 0.16 + 0.22 * sat;
        r = r * (1 - keep) + pr * 0.62 * keep;
        g = g * (1 - keep) + pg * 0.62 * keep;
        bl = bl * (1 - keep) + pb * 0.62 * keep;
      }
      out.data[i * 4] = r;
      out.data[i * 4 + 1] = g;
      out.data[i * 4 + 2] = bl;
      out.data[i * 4 + 3] = 255;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d")!;
  c.putImageData(out, 0, 0);
  // 장면 사이 파인 골 — 어두운 골에 아래쪽 밝은 턱
  const groove = (x0: number, y0: number, x1: number, y1: number) => {
    c.lineCap = "round";
    c.strokeStyle = "rgba(20,24,24,0.75)";
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
    c.strokeStyle = "rgba(190,196,188,0.28)";
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(x0 + 2.5, y0 + 2.5);
    c.lineTo(x1 + 2.5, y1 + 2.5);
    c.stroke();
  };
  for (let i = 1; i < MURAL_ORDER.length; i++) {
    const x = pad + i * cell;
    groove(x, pad + 4 + random() * 6, x + (random() - 0.5) * 3, h - pad - 4 - random() * 6);
  }
  // 금 · 떨어져 나간 조각
  c.strokeStyle = "rgba(18,20,20,0.6)";
  c.lineWidth = 1.4;
  for (let i = 0; i < 7; i++) {
    let x = random() * w;
    let y = random() < 0.5 ? 0 : random() * h;
    c.beginPath();
    c.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      x += (random() - 0.5) * 50;
      y += 8 + random() * 20;
      c.lineTo(x, y);
    }
    c.stroke();
  }
  return toTexture(canvas);
}
