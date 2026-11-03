/**
 * 벽화 — 아랑사·아비사 이야기 네 장면을 회벽에 물감으로 그린 것처럼. 선 그림이 아니라 면을 칠하고,
 * 회벽 결 · 바랜 얼룩 · 금 · 떨어져 나간 자리까지 그려 오래된 벽화로 보이게 한다.
 * 장면: 달(보름달 뜬 밤 강) · 배(아비사가 노를 저어 건넘) · 구렁이(강에서 솟음) · 바위(바위 위의 아랑사).
 * 문 위 띠(RingDoor)와 석실 돌 상자 네 면(InnerChamber)이 같이 쓴다.
 */
import { createRandom } from "@/engine/random";
import { makeTextureFromCanvas } from "@/engine/textures/canvas";

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

/** 붓으로 칠한 면 — 같은 색을 밝고 어둡게 겹쳐 붓결을 낸다 */
function fillShape(g: Ctx, trace: (path: Ctx) => void, color: string, outline = true) {
  g.save();
  g.beginPath();
  trace(g);
  g.fillStyle = color;
  g.fill();
  // 붓결 — 같은 색을 조금 밝게·어둡게 겹친다
  g.clip();
  g.globalAlpha = 0.18;
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = i % 2 ? "#FFFFFF" : "#000000";
    g.lineWidth = 2 + (i % 3);
    g.beginPath();
    const y = (i / 26) * g.canvas.height * 1.2;
    g.moveTo(-20, y);
    g.bezierCurveTo(g.canvas.width * 0.3, y + 8, g.canvas.width * 0.6, y - 8, g.canvas.width + 20, y + 4);
    g.stroke();
  }
  g.restore();
  if (outline) {
    g.save();
    g.beginPath();
    trace(g);
    g.strokeStyle = PAINT.outline;
    g.globalAlpha = 0.75;
    g.lineWidth = 3;
    g.lineJoin = "round";
    g.stroke();
    g.restore();
  }
}

function ellipse(g: Ctx, x: number, y: number, rx: number, ry: number, rotation = 0) {
  g.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
}

/** 강 — 칸 아래쪽을 채우는 물결 띠(면) */
function drawRiver(g: Ctx, width: number, height: number, top: number) {
  fillShape(
    g,
    (path) => {
      path.moveTo(0, top);
      for (let x = 0; x <= width; x += 40) path.quadraticCurveTo(x + 10, top - 6, x + 20, top);
      path.lineTo(width, height);
      path.lineTo(0, height);
      path.closePath();
    },
    PAINT.river,
    false,
  );
  g.save();
  g.strokeStyle = PAINT.riverLight;
  g.globalAlpha = 0.75;
  g.lineWidth = 3;
  g.lineCap = "round";
  for (let row = 0; row < 4; row++) {
    const y = top + 14 + row * ((height - top - 14) / 4);
    g.beginPath();
    for (let x = (row % 2) * 24; x < width; x += 54) {
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 12, y - 7, x + 26, y);
    }
    g.stroke();
  }
  g.restore();
}

/** 밤하늘 — 칸 위쪽을 칠한다 */
function drawNight(g: Ctx, width: number, height: number) {
  const gradient = g.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, PAINT.nightDeep);
  gradient.addColorStop(1, PAINT.night);
  g.fillStyle = gradient;
  g.fillRect(0, 0, width, height);
}

/** 앙암바위 실루엣 — 강가에 우뚝 */
function drawCrag(g: Ctx, x: number, base: number, width: number, height: number) {
  fillShape(
    g,
    (path) => {
      path.moveTo(x, base);
      path.lineTo(x + width * 0.1, base - height * 0.55);
      path.lineTo(x + width * 0.28, base - height * 0.9);
      path.lineTo(x + width * 0.5, base - height);
      path.lineTo(x + width * 0.72, base - height * 0.82);
      path.lineTo(x + width * 0.9, base - height * 0.45);
      path.lineTo(x + width, base);
      path.closePath();
    },
    PAINT.rock,
  );
  g.save();
  g.strokeStyle = PAINT.rockLight;
  g.globalAlpha = 0.6;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x + width * 0.3, base - height * 0.8);
  g.lineTo(x + width * 0.42, base - height * 0.35);
  g.moveTo(x + width * 0.6, base - height * 0.75);
  g.lineTo(x + width * 0.68, base - height * 0.3);
  g.stroke();
  g.restore();
}

/** 사람 — 흰 저고리. 아비사는 상투와 바지, 아랑사는 붉은 치마와 쪽 */
function drawPerson(g: Ctx, x: number, feet: number, height: number, kind: "아비사" | "아랑사") {
  const head = height * 0.13;
  const top = feet - height;
  if (kind === "아랑사") {
    // 붉은 치마 — 아래로 넓게 퍼진다
    fillShape(
      g,
      (path) => {
        path.moveTo(x - height * 0.09, top + height * 0.4);
        path.quadraticCurveTo(x - height * 0.24, feet - height * 0.1, x - height * 0.26, feet);
        path.lineTo(x + height * 0.26, feet);
        path.quadraticCurveTo(x + height * 0.24, feet - height * 0.1, x + height * 0.09, top + height * 0.4);
        path.closePath();
      },
      PAINT.red,
    );
  } else {
    // 바지 두 가랑이
    for (const side of [-1, 1])
      fillShape(
        g,
        (path) => {
          path.moveTo(x + side * height * 0.01, top + height * 0.5);
          path.lineTo(x + side * height * 0.14, top + height * 0.52);
          path.lineTo(x + side * height * 0.12, feet);
          path.lineTo(x + side * height * 0.03, feet);
          path.closePath();
        },
        PAINT.cloth,
      );
  }
  // 저고리
  fillShape(
    g,
    (path) => {
      path.moveTo(x - height * 0.12, top + head * 2);
      path.lineTo(x + height * 0.12, top + head * 2);
      path.lineTo(x + height * 0.14, top + height * (kind === "아랑사" ? 0.42 : 0.55));
      path.lineTo(x - height * 0.14, top + height * (kind === "아랑사" ? 0.42 : 0.55));
      path.closePath();
    },
    PAINT.cloth,
  );
  if (kind === "아랑사") {
    // 옷고름
    g.save();
    g.strokeStyle = PAINT.red;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(x, top + head * 2.6);
    g.lineTo(x + height * 0.05, top + height * 0.38);
    g.stroke();
    g.restore();
  }
  // 얼굴 · 머리
  fillShape(g, (path) => ellipse(path, x, top + head, head * 0.78, head), PAINT.skin);
  if (kind === "아비사") {
    fillShape(g, (path) => ellipse(path, x, top + head * 0.25, head * 0.8, head * 0.42), PAINT.hair);
    fillShape(g, (path) => ellipse(path, x, top - head * 0.2, head * 0.28, head * 0.32), PAINT.hair);
  } else {
    fillShape(g, (path) => ellipse(path, x, top + head * 0.3, head * 0.85, head * 0.5), PAINT.hair);
    fillShape(g, (path) => ellipse(path, x + head * 0.6, top + head * 1.1, head * 0.42, head * 0.36), PAINT.hair);
  }
}

/** 장면 하나 — (0,0)~(width,height) 칸에 그린다 */
/** 작은 나룻배 — 멀리 보이는 아비사의 배(노 젓는 사람까지) */
function drawBoat(g: Ctx, x: number, water: number, width: number, withAbisa: boolean) {
  fillShape(
    g,
    (path) => {
      path.moveTo(x - width / 2, water - width * 0.02);
      path.quadraticCurveTo(x, water + width * 0.16, x + width / 2, water - width * 0.02);
      path.lineTo(x + width * 0.42, water - width * 0.1);
      path.lineTo(x - width * 0.42, water - width * 0.1);
      path.closePath();
    },
    PAINT.wood,
  );
  if (withAbisa) drawPerson(g, x, water - width * 0.1, width * 0.55, "아비사");
}

/**
 * 장면 하나 — (0,0)~(width,height) 칸에. 전부 아랑사(붉은 치마)와 아비사(배 젓는 어부)의 이야기로:
 *   달   보름달 아래 강 건너 둘 — 아랑사는 바위 위에서 기다리고, 아비사의 배가 건너온다
 *   배   아비사가 노를 저어 건너가고, 저편 둑에서 아랑사가 손을 흔든다
 *   구렁이 구렁이가 솟아 아비사의 배를 덮친다
 *   바위 바위 위의 아랑사가 돌이 되어 가고, 빈 배만 강에 떠 있다
 */
function drawScene(g: Ctx, scene: MuralScene, width: number, height: number) {
  const river = height * 0.68;
  drawNight(g, width, height);
  if (scene === "달") {
    // 보름달과 달무리, 강에 비친 달빛
    const glow = g.createRadialGradient(width * 0.5, height * 0.32, 0, width * 0.5, height * 0.32, height * 0.42);
    glow.addColorStop(0, "rgba(241,231,200,0.5)");
    glow.addColorStop(1, "rgba(241,231,200,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, width, height);
    fillShape(g, (path) => ellipse(path, width * 0.5, height * 0.32, height * 0.2, height * 0.2), PAINT.moon);
    drawCrag(g, width * 0.04, river + 4, width * 0.22, height * 0.4);
    drawCrag(g, width * 0.76, river + 4, width * 0.2, height * 0.3);
    // 왼쪽 바위 위의 아랑사 — 강 건너를 본다
    drawPerson(g, width * 0.15, river + 4 - height * 0.4, height * 0.26, "아랑사");
    drawRiver(g, width, height, river);
    // 건너오는 아비사의 배
    drawBoat(g, width * 0.62, river + height * 0.12, width * 0.26, true);
    g.save();
    g.fillStyle = PAINT.moon;
    g.globalAlpha = 0.55;
    for (let i = 0; i < 5; i++)
      g.fillRect(width * 0.5 - height * (0.12 - i * 0.018), river + 14 + i * 16, height * (0.24 - i * 0.036), 5);
    g.restore();
  } else if (scene === "배") {
    drawRiver(g, width, height, river);
    // 나룻배 — 나무결
    fillShape(
      g,
      (path) => {
        path.moveTo(width * 0.16, river - 4);
        path.quadraticCurveTo(width * 0.5, river + height * 0.16, width * 0.84, river - 4);
        path.lineTo(width * 0.78, river - height * 0.07);
        path.lineTo(width * 0.22, river - height * 0.07);
        path.closePath();
      },
      PAINT.wood,
    );
    g.save();
    g.strokeStyle = PAINT.woodDark;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(width * 0.24, river - height * 0.03);
    g.quadraticCurveTo(width * 0.5, river + height * 0.07, width * 0.76, river - height * 0.03);
    g.stroke();
    g.restore();
    drawPerson(g, width * 0.5, river - height * 0.07, height * 0.42, "아비사");
    // 저편 둑의 아랑사 — 작게, 손을 흔든다
    drawCrag(g, width * 0.78, river + 2, width * 0.2, height * 0.16);
    drawPerson(g, width * 0.88, river + 2 - height * 0.16, height * 0.2, "아랑사");
    // 노
    g.save();
    g.strokeStyle = PAINT.woodDark;
    g.lineWidth = 7;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(width * 0.56, river - height * 0.32);
    g.lineTo(width * 0.78, river + height * 0.12);
    g.stroke();
    g.restore();
    fillShape(
      g,
      (path) => ellipse(path, width * 0.8, river + height * 0.14, width * 0.04, height * 0.02, 0.6),
      PAINT.woodDark,
      false,
    );
  } else if (scene === "구렁이") {
    drawRiver(g, width, height, river);
    // 구렁이 — 강에서 S 자로 솟아 고개를 든다. 굵은 몸에 비늘 무늬, 배는 누렇다
    const body = (path: Ctx) => {
      path.moveTo(width * 0.18, river + height * 0.18);
      path.bezierCurveTo(
        width * 0.32,
        river - height * 0.35,
        width * 0.6,
        river + height * 0.15,
        width * 0.68,
        river - height * 0.35,
      );
      path.bezierCurveTo(
        width * 0.72,
        river - height * 0.5,
        width * 0.8,
        river - height * 0.55,
        width * 0.82,
        river - height * 0.5,
      );
    };
    g.save();
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = PAINT.outline;
    g.lineWidth = height * 0.15;
    g.beginPath();
    body(g);
    g.stroke();
    g.strokeStyle = PAINT.serpent;
    g.lineWidth = height * 0.12;
    g.beginPath();
    body(g);
    g.stroke();
    g.strokeStyle = PAINT.serpentBelly;
    g.globalAlpha = 0.7;
    g.lineWidth = height * 0.035;
    g.setLineDash([height * 0.04, height * 0.03]);
    g.beginPath();
    body(g);
    g.stroke();
    g.restore();
    fillShape(
      g,
      (path) => ellipse(path, width * 0.84, river - height * 0.52, height * 0.1, height * 0.065, -0.3),
      PAINT.serpent,
    );
    fillShape(
      g,
      (path) => ellipse(path, width * 0.87, river - height * 0.55, height * 0.018, height * 0.018),
      PAINT.gold,
      false,
    );
    // 구렁이 아래 아비사의 배 — 기우뚱 덮친다
    g.save();
    g.translate(width * 0.3, river + height * 0.1);
    g.rotate(-0.22);
    drawBoat(g, 0, 0, width * 0.3, true);
    g.restore();
    // 물보라
    g.save();
    g.fillStyle = PAINT.cloth;
    g.globalAlpha = 0.7;
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      ellipse(
        g,
        width * 0.18 + (i - 4) * height * 0.035,
        river + height * 0.08 - Math.abs(i - 4) * -height * 0.01 - (4 - Math.abs(i - 4)) * height * 0.025,
        height * 0.018,
        height * 0.03,
      );
      g.fill();
    }
    g.restore();
  } else {
    // 바위 위의 아랑사 — 바위가 되어 간다
    drawRiver(g, width, height, river);
    drawCrag(g, width * 0.22, river + height * 0.08, width * 0.56, height * 0.55);
    drawPerson(g, width * 0.5, river + height * 0.08 - height * 0.53, height * 0.3, "아랑사");
    // 빈 배만 강에 — 아비사는 없다
    drawBoat(g, width * 0.14, river + height * 0.14, width * 0.2, false);
    // 달빛 한 줄기가 그녀에게
    g.save();
    const beam = g.createLinearGradient(width * 0.5, 0, width * 0.5, height * 0.35);
    beam.addColorStop(0, "rgba(241,231,200,0.35)");
    beam.addColorStop(1, "rgba(241,231,200,0)");
    g.fillStyle = beam;
    g.beginPath();
    g.moveTo(width * 0.42, 0);
    g.lineTo(width * 0.58, 0);
    g.lineTo(width * 0.54, height * 0.35);
    g.lineTo(width * 0.46, height * 0.35);
    g.closePath();
    g.fill();
    g.restore();
  }
}

/** 오래된 회벽 — 바랜 얼룩, 금, 칠이 떨어져 회벽이 드러난 자리 */
function drawWeathering(g: Ctx, width: number, height: number, seed: number) {
  const random = createRandom(seed);
  g.save();
  // 전체를 조금 바래게
  g.fillStyle = PAINT.plaster;
  g.globalAlpha = 0.16;
  g.fillRect(0, 0, width, height);
  // 얼룩
  for (let i = 0; i < 30; i++) {
    const x = random() * width;
    const y = random() * height;
    const r = 20 + random() * 80;
    const stain = g.createRadialGradient(x, y, 0, x, y, r);
    stain.addColorStop(0, random() < 0.5 ? "rgba(60,48,30,0.16)" : "rgba(235,225,200,0.14)");
    stain.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = 1;
    g.fillStyle = stain;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // 칠이 떨어진 자리 — 회벽이 드러난다
  for (let i = 0; i < 9; i++) {
    const x = random() * width;
    const y = random() < 0.5 ? random() * height * 0.2 : height - random() * height * 0.25;
    g.globalAlpha = 0.85;
    g.fillStyle = random() < 0.5 ? PAINT.plaster : PAINT.plasterDark;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const r = 8 + random() * 26;
      g.lineTo(x + Math.cos(a) * r * 1.4, y + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  }
  // 금
  g.strokeStyle = "rgba(30,24,18,0.55)";
  g.lineWidth = 1.6;
  for (let i = 0; i < 6; i++) {
    let x = random() * width;
    let y = random() * height;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += (random() - 0.5) * 60;
      y += 10 + random() * 24;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // 회벽 알갱이
  const image = g.getImageData(0, 0, width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (random() - 0.5) * 22;
    image.data[i] += n;
    image.data[i + 1] += n;
    image.data[i + 2] += n;
  }
  g.putImageData(image, 0, 0);
  g.restore();
}

/** 장면 칸을 감싸는 테 — 황토 띠에 검은 줄 */
function drawFrame(g: Ctx, x: number, y: number, width: number, height: number) {
  g.save();
  g.strokeStyle = PAINT.gold;
  g.lineWidth = 10;
  g.strokeRect(x + 5, y + 5, width - 10, height - 10);
  g.strokeStyle = PAINT.outline;
  g.lineWidth = 2;
  g.strokeRect(x + 12, y + 12, width - 24, height - 24);
  g.restore();
}

/** 긴 띠 — 네 장면을 왼쪽부터 이야기 순서로. 가로:세로 = ratio */
export function makeMuralStripTexture(ratio: number, seed = 911) {
  const height = 256;
  const width = Math.round(height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = PAINT.plaster;
  g.fillRect(0, 0, width, height);
  const pad = 18;
  const cell = (width - pad * 2) / MURAL_ORDER.length;
  MURAL_ORDER.forEach((scene, i) => {
    g.save();
    g.translate(pad + i * cell + 10, pad + 10);
    g.beginPath();
    g.rect(0, 0, cell - 20, height - pad * 2 - 20);
    g.clip();
    drawScene(g, scene, cell - 20, height - pad * 2 - 20);
    g.restore();
    drawFrame(g, pad + i * cell, pad, cell, height - pad * 2);
  });
  drawWeathering(g, width, height, seed);
  return makeTextureFromCanvas(canvas, 4);
}

/** 한 장면 — 돌 상자 한 면에 붙인다. 가로:세로 = ratio */
export function makeMuralPanelTexture(scene: MuralScene, ratio: number, seed = 1) {
  const height = 256;
  const width = Math.round(height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = PAINT.plaster;
  g.fillRect(0, 0, width, height);
  g.save();
  g.translate(18, 18);
  g.beginPath();
  g.rect(0, 0, width - 36, height - 36);
  g.clip();
  drawScene(g, scene, width - 36, height - 36);
  g.restore();
  drawFrame(g, 8, 8, width - 16, height - 16);
  drawWeathering(g, width, height, seed);
  return makeTextureFromCanvas(canvas, 4);
}

/**
 * 돌에 새긴 띠 — 아치 위 벽에 직접 새기고 물감이 거의 다 씻겨 나간 부조. 액자 테 없이 장면 사이는 파인 골,
 * 그림은 밝기 차를 홈과 도드라짐(양각)으로 바꿔 돌결 위에 얹고, 바랜 물감은 조금만 남긴다. 가장자리는 부서져 맨 돌로 녹아든다.
 * 칸 배치는 makeMuralStripTexture 와 같다(여백 18 · 네 칸) — 진주 빛 셰이더가 같은 셈을 쓴다
 */
export function makeMuralReliefTexture(ratio: number, seed = 911) {
  const height = 256;
  const width = Math.round(height * ratio);
  const paint = document.createElement("canvas");
  paint.width = width;
  paint.height = height;
  const sketch = paint.getContext("2d", { willReadFrequently: true })!;
  sketch.fillStyle = PAINT.plaster;
  sketch.fillRect(0, 0, width, height);
  const pad = 18;
  const cell = (width - pad * 2) / MURAL_ORDER.length;
  MURAL_ORDER.forEach((scene, i) => {
    sketch.save();
    sketch.translate(pad + i * cell + 10, pad + 10);
    sketch.beginPath();
    sketch.rect(0, 0, cell - 20, height - pad * 2 - 20);
    sketch.clip();
    drawScene(sketch, scene, cell - 20, height - pad * 2 - 20);
    sketch.restore();
  });
  const source = sketch.getImageData(0, 0, width, height).data;
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++)
    lum[i] = (source[i * 4] * 0.3 + source[i * 4 + 1] * 0.59 + source[i * 4 + 2] * 0.11) / 255;
  const at = (x: number, y: number) =>
    lum[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];

  const random = createRandom(seed);
  // 돌결 — 큰 얼룩(성긴 격자를 부드럽게 이은 것) + 잔 알갱이
  const GRID = 24;
  const gw = Math.ceil(width / GRID) + 2;
  const gh = Math.ceil(height / GRID) + 2;
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
  const ragged = (t: number, k: number) =>
    6 * Math.sin(t * 0.045 + k) + 4 * Math.sin(t * 0.13 + k * 2.3) + 3 * (smoothAt(t, k * 30) - 0.5) * 2;

  const out = sketch.createImageData(width, height);
  const stone = [96, 104, 102];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const grain = (random() - 0.5) * 18;
      const b = (smoothAt(x, y) - 0.5) * 34;
      let r = stone[0] + b + grain;
      let g = stone[1] + b + grain;
      let bl = stone[2] + b * 0.9 + grain;
      const inside =
        x > inset + ragged(y, 1) &&
        x < width - inset - ragged(y, 2) &&
        y > inset + ragged(x, 3) &&
        y < height - inset - ragged(x, 4);
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
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d")!;
  g.putImageData(out, 0, 0);
  // 장면 사이 파인 골 — 어두운 골에 아래쪽 밝은 턱
  const groove = (x0: number, y0: number, x1: number, y1: number) => {
    g.lineCap = "round";
    g.strokeStyle = "rgba(20,24,24,0.75)";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.strokeStyle = "rgba(190,196,188,0.28)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x0 + 2.5, y0 + 2.5);
    g.lineTo(x1 + 2.5, y1 + 2.5);
    g.stroke();
  };
  for (let i = 1; i < MURAL_ORDER.length; i++) {
    const x = pad + i * cell;
    groove(x, pad + 4 + random() * 6, x + (random() - 0.5) * 3, height - pad - 4 - random() * 6);
  }
  // 금 · 떨어져 나간 조각
  g.strokeStyle = "rgba(18,20,20,0.6)";
  g.lineWidth = 1.4;
  for (let i = 0; i < 7; i++) {
    let x = random() * width;
    let y = random() < 0.5 ? 0 : random() * height;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      x += (random() - 0.5) * 50;
      y += 8 + random() * 20;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return makeTextureFromCanvas(canvas, 4);
}
