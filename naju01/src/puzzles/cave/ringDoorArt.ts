/**
 * 물레 고리문의 그림 — 비석 둘(수수께끼 · 초성 풀이), 바퀴 얼굴 새김, 물레 앞면 새김.
 * 돌 면은 캔버스에 그려 질감으로 쓴다. 치수는 ringDoorShape.
 */
import * as THREE from "three";

import { toRadians } from "@/engine/math";
import { createRandom } from "@/engine/random";
import { makeTextureFromCanvas } from "@/engine/textures/canvas";

import { makeToonMaterial } from "../materials";
import { DIAL_FACE, DIAL_GRIPS, NOTCHES, NUMBER_RADIUS, RIM_RADIUS, RINGS, buildSteleGeometry } from "./ringDoorShape";

/**
 * 비석 글 — 고리문 여는 법을 돌려 말한 수수께끼. {말} 은 검은 네모로 지워져 있고, 왼쪽 작은 비석의
 * 초성 · 뜻풀이(지운 말이 나오는 차례대로)로 채운다. 채우고 나서도 한 번 더 풀어 읽어야 한다:
 *   뜬 돌 넷 → 물레 가운데 홈 · 이빨 난 돌 → 톱니돌 · 걸음 → 눈금 · 갈라진 입 → 고리의 틈 · 하늘 → 맨 위(0)
 */
const STELE_LINES = [
  "{뜬 돌} 넷이 물레의 심장을 채우면",
  "멈춘 물레가 비로소 숨을 쉰다.",
  "",
  "{이빨} 난 돌을 문 고리만이",
  "물레의 걸음을 따라 걷는다.",
  "",
  "고리마다 갈라진 {입}이 하나,",
  "그 입은 바깥 띠의 수를 가리킨다.",
  "가리킨 수만큼 걸음을 옮기면",
  "입은 비로소 {하늘}을 본다.",
  "",
  "셋이 함께 걸으면 길을 잃으니",
  "한 고리씩 데려가라.",
  "",
  "세 입이 모두 {하늘}을 우러를 때",
  "문은 굴러 길을 내어 준다.",
];
/** 작은 비석 — 지운 말의 초성 · 뜻풀이, 큰 비석에 나오는 차례대로 */
const HINT_ROWS: [string, string][] = [
  ["ㄸ ㄷ", "물이 차면 떠오르던 것"],
  ["ㅇ ㅃ", "톱니처럼 뾰족한 것"],
  ["ㅇ", "말이 나오는 곳, 갈라진 틈"],
  ["ㅎ ㄴ", "바퀴 꼭대기, 0 이 앉은 곳"],
];

/**
 * 비석 글꼴 — 송명체(OFL, public/fonts/song-myung-OFL.txt). 비석에 쓰는 글자만 남긴 부분 글꼴이라
 * 비석 글을 고치면 새 글자를 넣어 다시 잘라야 한다(빠진 글자는 기본 명조로 나온다)
 */
const STELE_FONT = "SongMyungStele";
const FONT_STACK = `"${STELE_FONT}","Nanum Myeongjo","AppleMyungjo","Batang",serif`;
let steleFontReady: Promise<void> | null = null;
function loadSteleFont() {
  steleFontReady ??= new FontFace(STELE_FONT, `url(${import.meta.env.BASE_URL}fonts/song-myung-stele.woff2)`)
    .load()
    .then((face) => {
      document.fonts.add(face);
    })
    .catch(() => {});
  return steleFontReady;
}

interface StoneGrain {
  seed: number;
  blotches: number;
  /** 얼룩 반지름(px) 최소 · 최대 */
  radius: [number, number];
  base: string;
  dark: string;
  light: string;
}

/** 돌결 — 잿빛 바탕에 밝고 어두운 얼룩. 돌려주는 난수는 이어서 쓴다 */
function drawStoneGrain(g: CanvasRenderingContext2D, width: number, height: number, grain: StoneGrain) {
  const random = createRandom(grain.seed);
  g.fillStyle = grain.base;
  g.fillRect(0, 0, width, height);
  for (let i = 0; i < grain.blotches; i++) {
    const x = random() * width;
    const y = random() * height;
    const r = grain.radius[0] + random() * (grain.radius[1] - grain.radius[0]);
    const blotch = g.createRadialGradient(x, y, 0, x, y, r);
    blotch.addColorStop(0, random() < 0.5 ? grain.dark : grain.light);
    blotch.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = blotch;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return random;
}

/** 새김 — 같은 그림을 밝은 턱(오른쪽 아래로 비껴)과 어두운 홈으로 두 번 그린다 */
function carve(
  g: CanvasRenderingContext2D,
  draw: () => void,
  width: number,
  offset: [number, number],
  light: string,
  ink: string,
) {
  g.lineCap = "round";
  g.lineJoin = "round";
  g.save();
  g.translate(offset[0], offset[1]);
  g.strokeStyle = light;
  g.fillStyle = light;
  g.lineWidth = width;
  draw();
  g.restore();
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineWidth = width;
  draw();
}

/** 돌 면 그림판 — 잿빛 바탕에 얼룩 · 잔 알갱이 · 이끼 낀 밑동, 그리고 새긴 글을 그리는 붓 */
function makeStoneFace(width: number, height: number, seed: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d")!;
  const random = drawStoneGrain(g, width, height, {
    seed,
    blotches: (width * height) / 9000,
    radius: [30, 150],
    base: "#8E938B",
    dark: "rgba(40,46,44,0.09)",
    light: "rgba(210,214,204,0.1)",
  });
  const moss = g.createLinearGradient(0, height, 0, height * 0.78);
  moss.addColorStop(0, "rgba(70,86,62,0.6)");
  moss.addColorStop(1, "rgba(70,86,62,0)");
  g.fillStyle = moss;
  g.fillRect(0, height * 0.78, width, height * 0.22);
  const image = g.getImageData(0, 0, width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    const grain = (random() - 0.5) * 20;
    image.data[i] += grain;
    image.data[i + 1] += grain;
    image.data[i + 2] += grain;
  }
  g.putImageData(image, 0, 0);
  const font = (size: number, weight: number) => `${weight} ${size}px ${FONT_STACK}`;
  /** 새긴 글 — 홈(어둡게)을 먼저, 그 아래 오른쪽으로 빛 받는 턱(밝게) */
  const carveText = (
    text: string,
    x: number,
    y: number,
    size: number,
    weight = 800,
    align: CanvasTextAlign = "center",
  ) => {
    g.font = font(size, weight);
    g.textAlign = align;
    g.textBaseline = "middle";
    g.fillStyle = "rgba(235,238,228,0.7)";
    g.fillText(text, x + 2, y + 2.5);
    g.fillStyle = "#0E1110";
    g.fillText(text, x, y);
    g.lineWidth = 1.2;
    g.strokeStyle = "#0E1110";
    g.strokeText(text, x, y);
  };
  /** 한 줄 — {말} 은 그 너비만큼 검은 네모로 지운다 */
  const carveLine = (line: string, cx: number, y: number, size: number) => {
    g.font = font(size, 800);
    const parts = line.split(/(\{[^}]+\})/).filter(Boolean);
    const widthOf = (part: string) =>
      g.measureText(part.startsWith("{") ? part.slice(1, -1) : part).width + (part.startsWith("{") ? size * 0.3 : 0);
    let x = cx - parts.reduce((sum, part) => sum + widthOf(part), 0) / 2;
    for (const part of parts) {
      const partWidth = widthOf(part);
      if (part.startsWith("{")) {
        g.fillStyle = "#0B0D0C";
        g.fillRect(x + 2, y - size * 0.52, partWidth - 4, size * 1.04);
      } else carveText(part, x, y, size, 800, "left");
      x += partWidth;
    }
  };
  return { canvas, g, carveText, carveLine };
}

function makeSteleMaterials(canvas: HTMLCanvasElement, width: number, height: number) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.repeat.set(1 / width, 1 / height);
  texture.offset.set(0.5, 0);
  // 물속 어스름에서도 글이 읽히게 돌 면이 스스로 조금 밝다
  const textMaterial = makeToonMaterial("#FFFFFF", {
    map: texture,
    emissive: new THREE.Color("#FFFFFF"),
    emissiveMap: texture,
    emissiveIntensity: 0.32,
  });
  return { texture, textMaterial, sideMaterial: makeToonMaterial("#6E736C") };
}

/** 비석 하나 — 글을 그리고, 글꼴이 다 읽히면 같은 자리에 다시 그린다 */
function buildCarvedStele(width: number, height: number, depth: number, draw: () => HTMLCanvasElement) {
  const canvas = document.createElement("canvas");
  const materials = makeSteleMaterials(canvas, width, height);
  const redraw = () => {
    const face = draw();
    canvas.width = face.width;
    canvas.height = face.height;
    canvas.getContext("2d")!.drawImage(face, 0, 0);
  };
  redraw();
  void loadSteleFont().then(() => {
    redraw();
    materials.texture.needsUpdate = true;
  });
  return { geometry: buildSteleGeometry(width, height, depth), ...materials };
}

/** 큰 비석 — 지운 말이 섞인 수수께끼. 테두리 · 제목 없이 글만 */
export function buildStele() {
  return buildCarvedStele(1.0, 2.0, 0.22, () => {
    const face = makeStoneFace(640, 1280, 4127);
    const { g } = face;
    // 제목 없이 어깨 바로 밑에서부터
    STELE_LINES.forEach((line, i) => {
      if (line) face.carveLine(line, 320, 196 + i * 42, 31);
    });
    // 금 — 위 귀퉁이에서 내려온 금 하나
    g.strokeStyle = "rgba(20,22,22,0.6)";
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(560, 120);
    [
      [540, 190],
      [552, 260],
      [530, 330],
      [538, 380],
    ].forEach(([x, y]) => g.lineTo(x, y));
    g.stroke();
    return face.canvas;
  });
}

/** 작은 비석 — 큰 비석 왼쪽. 지운 말의 초성 · 뜻풀이 */
export function buildHintStele() {
  return buildCarvedStele(0.62, 1.15, 0.16, () => {
    const face = makeStoneFace(400, 742, 9113);
    HINT_ROWS.forEach(([initials, meaning], i) => {
      const y = 112 + i * 118;
      // 초성 한 줄, 그 밑에 뜻풀이 — 넷이 비석 위쪽 가운데에 모이게
      face.carveText(initials, 200, y, 46);
      face.carveText(meaning, 200, y + 50, 27, 700);
    });
    return face.canvas;
  });
}

/** 둘레를 따라 겹쳐 이는 반달 물결 */
function traceWaves(
  g: CanvasRenderingContext2D,
  center: number,
  waves: number,
  inner: number,
  outer: number,
  lift: number,
) {
  for (let k = 0; k < waves; k++) {
    g.beginPath();
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const a = ((k + t) / waves) * Math.PI * 2;
      const r = inner + (outer - inner) * Math.sin(t * Math.PI) * lift;
      const x = center + Math.cos(a) * r;
      const y = center + Math.sin(a) * r;
      if (t === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
}

/**
 * 물레 앞면 새김 — 바깥에 물결무늬 띠, 그 안에 물레를 따라 도는 물고기 넷, 손잡이마다 이어지는 짧은 홈,
 * 안쪽 가장자리에 테 홈. 어두운 홈과 아래쪽 밝은 턱으로 판 듯이. 평면 UV(가운데가 0.5)
 */
export function makeDialFaceTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const center = size / 2;
  /** 물레 반지름에 대한 몫 → 그림판 toPixels(바깥 반지름 = DIAL_FACE.outer) */
  const toPixels = (fractionOfDial: number) => (fractionOfDial / DIAL_FACE.outer) * (size / 2);
  drawStoneGrain(g, size, size, {
    seed: 7319,
    blotches: 40,
    radius: [20, 90],
    base: "#6D7169",
    dark: "rgba(30,34,32,0.12)",
    light: "rgba(200,204,196,0.1)",
  });
  const groove = (draw: () => void, width: number) =>
    carve(g, draw, width, [1.6, 2], "rgba(205,210,200,0.32)", "#1A1D1C");
  const circle = (r: number) => () => {
    g.beginPath();
    g.arc(center, center, r, 0, Math.PI * 2);
    g.stroke();
  };
  // 테 홈 — 바깥 · 물결 띠 안쪽 · 안쪽
  groove(circle(toPixels(0.92)), 4);
  groove(circle(toPixels(0.8)), 3);
  groove(circle(toPixels(0.57)), 4);
  // 물결무늬 — 바깥 띠를 따라
  groove(() => traceWaves(g, center, 28, toPixels(0.81), toPixels(0.91), 0.85), 2.5);
  // 손잡이로 이어지는 짧은 홈 여덟
  groove(() => {
    for (let k = 0; k < DIAL_GRIPS; k++) {
      const a = (k / DIAL_GRIPS) * Math.PI * 2;
      g.beginPath();
      g.moveTo(center + Math.cos(a) * toPixels(0.6), center + Math.sin(a) * toPixels(0.6));
      g.lineTo(center + Math.cos(a) * toPixels(0.76), center + Math.sin(a) * toPixels(0.76));
      g.stroke();
    }
  }, 3);
  // 물고기 넷 — 홈 사이에서 한 방향으로 물레를 따라 돈다
  groove(() => {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / DIAL_GRIPS;
      const r = toPixels(0.685);
      const x = center + Math.cos(a) * r;
      const y = center + Math.sin(a) * r;
      g.save();
      g.translate(x, y);
      g.rotate(a + Math.PI / 2);
      g.beginPath();
      g.ellipse(0, 0, 17, 7, 0, 0, Math.PI * 2);
      g.moveTo(-17, 0);
      g.lineTo(-27, -8);
      g.lineTo(-27, 8);
      g.closePath();
      g.moveTo(9, -2);
      g.arc(9, -2, 1.2, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }, 2.5);
  return makeTextureFromCanvas(canvas, 4);
}

/**
 * 바퀴 얼굴 — 돌에 새긴 한 장. 바깥 테에 물결, 숫자 띠(짝수는 숫자 · 홀수는 짧은 금), 고리 셋이 도는 자리마다 파인 홈,
 * 가운데에 서로 꼬리를 무는 물고기 한 쌍. 어두운 홈과 아래쪽 밝은 턱으로 판 듯이.
 * 판은 앞(−z)을 보게 y 로 반 바퀴 돌려 붙이므로, 바퀴 자리(x)는 그림에서 좌우를 뒤집어 놓는다
 */
export function makeWheelFaceTexture() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const faceRadius = RIM_RADIUS - 0.06;
  const toPixels = (meters: number) => (meters / faceRadius) * (size / 2);
  /** 바퀴 자리(미터, 바퀴 기준) → 그림 자리 */
  const spot = (x: number, y: number) => [size / 2 - toPixels(x), size / 2 - toPixels(y)] as const;
  drawStoneGrain(g, size, size, {
    seed: 5821,
    blotches: 90,
    radius: [30, 150],
    base: "#5F6662",
    dark: "rgba(28,32,30,0.14)",
    light: "rgba(196,200,190,0.1)",
  });
  const groove = (draw: () => void, width: number) =>
    carve(g, draw, width, [2, 2.5], "rgba(205,210,200,0.3)", "#151817");
  const ring = (r: number) => () => {
    g.beginPath();
    g.arc(size / 2, size / 2, toPixels(r), 0, Math.PI * 2);
    g.stroke();
  };
  // 바깥 테 — 두 줄 사이에 물결
  groove(ring(faceRadius - 0.04), 5);
  groove(ring(NUMBER_RADIUS + 0.2), 4);
  groove(() => traceWaves(g, size / 2, 44, toPixels(NUMBER_RADIUS + 0.22), toPixels(faceRadius - 0.06), 0.8), 3);
  // 숫자 띠 — 짝수 눈금에 숫자, 홀수 눈금에 짧은 금. 숫자는 늘 바로 서 있다
  groove(ring(NUMBER_RADIUS - 0.2), 4);
  for (let n = 0; n < NOTCHES; n++) {
    const a = Math.PI / 2 - toRadians(n * 10);
    if (n % 2 === 1) {
      groove(() => {
        const [x0, y0] = spot(Math.cos(a) * (NUMBER_RADIUS - 0.08), Math.sin(a) * (NUMBER_RADIUS - 0.08));
        const [x1, y1] = spot(Math.cos(a) * (NUMBER_RADIUS + 0.08), Math.sin(a) * (NUMBER_RADIUS + 0.08));
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }, 4);
      continue;
    }
    const [x, y] = spot(Math.cos(a) * NUMBER_RADIUS, Math.sin(a) * NUMBER_RADIUS);
    g.font = `700 ${n === 0 ? 62 : 50}px "${STELE_FONT}","Nanum Myeongjo","AppleMyungjo",serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "rgba(205,210,200,0.35)";
    g.fillText(String(n), x + 2, y + 2.5);
    g.fillStyle = n === 0 ? "#E8E2D2" : "#151817";
    g.fillText(String(n), x, y);
  }
  // 고리 셋이 도는 자리 — 파인 홈(고리보다 조금 넓게)
  for (const ringSpec of RINGS) groove(ring(ringSpec.radius), toPixels(ringSpec.tube * 2.3));
  g.globalAlpha = 1;
  // 가운데 — 서로 꼬리를 무는 물고기 한 쌍
  const fish = (angle: number) => () => {
    g.save();
    g.translate(size / 2, size / 2);
    g.rotate(angle);
    g.beginPath();
    g.ellipse(0, -toPixels(0.42), toPixels(0.3), toPixels(0.11), 0, 0, Math.PI * 2);
    g.moveTo(-toPixels(0.3), -toPixels(0.42));
    g.lineTo(-toPixels(0.46), -toPixels(0.55));
    g.lineTo(-toPixels(0.46), -toPixels(0.29));
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(toPixels(0.17), -toPixels(0.45), toPixels(0.022), 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  groove(fish(0), 5);
  groove(fish(Math.PI), 5);
  groove(ring(0.16), 4);
  return makeTextureFromCanvas(canvas, 8);
}
