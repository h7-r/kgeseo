/**
 * 아랑사의 주머니 — 바위 사이에서 주운 삼베 주머니를 열면 접은 편지 두 장과 조가비 가락지 한 쌍이 나온다.
 * 편지는 누렇게 바랜 종이에 먹으로 쓴 글(세로쓰기, 오른쪽부터). 아비사에게 쓰고 끝내 건네지 못했다.
 *   첫째 장  안부 · 읽는 법(「뒷장은 줄 머리만 차례로 짚어 가면 속말이 있다」) · 가락지를 만든 사연
 *   둘째 장  긴 글. 줄 머리 글자만 오른쪽부터 이어 읽으면 숨긴 말이 나온다(마지막 스테이지의 실마리). 풀이는 여기 적지 않는다
 * 줄은 한 줄이 한 기둥이다. 띄어쓰기는 반 칸만 띄운다. 낱말이 기둥 끝에서 꺾여도 그대로 둔다 — 줄 머리를 맞추느라 그렇게 썼다.
 */
import { useSyncExternalStore } from "react";

import { createRandom } from "@/engine/random";
import { createChangeSignal } from "@/lib/changeSignal";

interface Letter {
  title: string;
  lines: string[];
  /** 끝에 낮춰 적는 이름 */
  sign?: string;
}

const LETTERS: Letter[] = [
  {
    title: "첫째 장",
    lines: [
      "아비사 보시오 그믐께 띄운 글은 받으셨소",
      "요 며칠 진부촌 사내들 눈이 사나워졌소",
      "나루에서 마주치면 침을 뱉고 지나가오",
      "남이 이 글을 볼까 저어되니 뒷장은",
      "늘 하던 대로 읽으시오 줄 머리만",
      "차례로 짚어 가면 내 속말이 거기 있소",
      "강조개 껍데기를 달포나 갈아서",
      "가락지 두 짝을 만들었소 굵은 것은",
      "내가 끼고 가는 것은 그대 손에 끼워",
      "주려 하오 이 주머니에 넣어 두었다가",
      "오늘 밤 달이 뜨면 바위 위에서 드리리다",
      "부디 몸조심하고 늦지 말고 오시오",
    ],
    sign: "택촌 아랑",
  },
  {
    title: "둘째 장",
    lines: [
      "나루에 배를 매어 두고 등잔 밑에서 이 글을 적소",
      "죽 쑬 붕어는 통발에 건져 두었으니 내일 아침에",
      "거르지 말고 아버님께 쑤어 드리시오 뜨거울 때",
      "든든히 잡수시면 오랜 병도 물러날 것이오",
      "구름이 달을 가려도 나는 건너가오 강물이 출",
      "렁여 배를 못 띄우는 밤이면 헤엄쳐서라도 가겠소",
      "이 강이 두 마을을 갈라놓았다 하나 노를 저어",
      "되돌아갈 때마다 물낯에 그대 얼굴이 어리오",
      "어머니는 강 건너 처녀를 잊으라 하시나 그대",
      "곁을 떠나서는 하루도 살 수가 없소 살을",
      "에는 바람이 부는 밤에도 그 바위로 오시오",
      "오늘도 달이 뜨면 물 세 그릇 떠 놓고 기다",
      "리시오 내 반드시 그대 곁으로 가겠소",
    ],
    sign: "아랑",
  },
];

/** 읽기 화면의 장 — 맨 앞은 주머니 속(편지 두 장과 가락지), 그 뒤로 편지 */
export const POUCH_PAGES = LETTERS.length + 1;
export const pageTitle = (page: number) => (page === 0 ? "주머니 속" : LETTERS[page - 1].title);

// 읽기 화면 — 주머니를 열어 든 동안 열려 있다(LetterReadHud 가 띄운다)
const signal = createChangeSignal();
let view = { isOpen: false, page: 0 };
let onClosed: (() => void) | null = null;

/** 주머니를 연다. 다 읽고 접으면 whenClosed 를 한 번 부른다 */
export function openLetters(whenClosed?: () => void) {
  onClosed = whenClosed ?? null;
  view = { isOpen: true, page: 0 };
  signal.notify();
}
export function closeLetters() {
  if (!view.isOpen) return;
  view = { ...view, isOpen: false };
  signal.notify();
  const callback = onClosed;
  onClosed = null;
  callback?.();
}
/** 장을 넘긴다. 마지막 장에서 더 넘기면 접는다 */
export function turnLetter(step: number) {
  const page = view.page + step;
  if (page >= POUCH_PAGES) {
    closeLetters();
    return;
  }
  view = { ...view, page: Math.max(0, page) };
  signal.notify();
}
export const useLetterView = () => useSyncExternalStore(signal.subscribe, () => view);
/** 주머니 편지를 읽고 있다 — 그동안 알림은 줄을 선다(puzzles/interaction.ts) */
export const isLetterOpenNow = () => view.isOpen;

/** 힌트함에 넣는 쪽지 — 편지마다 하나. 그림은 종이 그림판 그대로 */
export const letterHints = () =>
  LETTERS.map((letter, index) => ({
    id: `cliff-letter-${index}`,
    name: `아랑사의 편지 · ${letter.title}`,
    description: letter.lines.join("\n") + (letter.sign ? `\n— ${letter.sign}` : ""),
    image: getLetterCanvas(index).toDataURL("image/png"),
    isPhysical: false as const,
  }));

const canvases: (HTMLCanvasElement | null)[] = LETTERS.map(() => null);
/** 종이 그림판 — 한 번 그려 두고 읽기 화면과 힌트함이 같이 쓴다 */
export function getLetterCanvas(index: number) {
  canvases[index] ??= drawLetter(LETTERS[index], 5200 + index * 37);
  return canvases[index];
}
let pouchCanvas: HTMLCanvasElement | null = null;
/** 주머니 속 그림 — 실물 모형을 놓고 찍은 것(pouchView)을 받아 둔다. 못 받았으면 편지 두 장만 놓은 그림으로 대신한다 */
export function setPouchCanvas(canvas: HTMLCanvasElement) {
  pouchCanvas = canvas;
}
/** 읽기 화면의 그 장 그림 */
export function getPageCanvas(page: number) {
  if (page > 0) return getLetterCanvas(page - 1);
  pouchCanvas ??= drawLettersOnly();
  return pouchCanvas;
}

const PAGE = { width: 1536, height: 1024 };
/** 종이가 그림판 가장자리에서 떨어진 여백(px) — 닳아 들쭉날쭉한 가장자리가 이 안에서 논다 */
const PAPER_INSET = 30;

/**
 * 편지 글씨 — 손글씨 글꼴(나눔손글씨 엉겅퀴체, public/fonts/nanum-handwriting-license.txt).
 * 다 읽히면 그려 둔 종이를 버려 다음에 펼 때 그 글씨로 다시 그린다. 못 읽으면 명조로 나온다
 */
const HAND_FONT = "Eonggeongkwi";
const FONT = `"${HAND_FONT}","Nanum Myeongjo","AppleMyungjo","Batang",serif`;
let handFontReady: Promise<void> | null = null;
export function loadLetterFont() {
  handFontReady ??= new FontFace(HAND_FONT, `url(${import.meta.env.BASE_URL}fonts/eonggeongkwi.woff2)`)
    .load()
    .then((face) => {
      document.fonts.add(face);
      canvases.fill(null);
    })
    .catch(() => {});
  return handFontReady;
}

/** 닳은 종이 가장자리 — 네 변을 따라 조금씩 들고 나고, 군데군데 뜯겨 나갔다 */
function tracePaperEdge(g: CanvasRenderingContext2D, width: number, height: number, random: () => number) {
  const inset = PAPER_INSET;
  const corners: [number, number][] = [
    [inset, inset],
    [width - inset, inset],
    [width - inset, height - inset],
    [inset, height - inset],
  ];
  g.beginPath();
  corners.forEach(([fromX, fromY], side) => {
    const [toX, toY] = corners[(side + 1) % 4];
    const length = Math.hypot(toX - fromX, toY - fromY);
    const steps = Math.round(length / 34);
    // 안쪽을 보는 쪽 — 뜯긴 자리는 안으로 팬다
    const inwardX = -(toY - fromY) / length;
    const inwardY = (toX - fromX) / length;
    let bite = 0;
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      // 귀퉁이는 둥글게 닳았다
      const corner = Math.max(0, 1 - Math.min(t, 1 - t) * steps * 0.5) * 14;
      if (random() > 0.93) bite = 8 + random() * 16;
      bite *= 0.55;
      const push = (random() - 0.5) * 7 + corner + bite;
      const x = fromX + (toX - fromX) * t + inwardX * push;
      const y = fromY + (toY - fromY) * t + inwardY * push;
      if (side === 0 && k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  });
  g.closePath();
}

/**
 * 종이 — 주머니에 접혀 있던 누런 한지. 가장자리는 닳아 들쭉날쭉하고 그을린 듯 어둡다. 닥 섬유가 길게 비치고,
 * 세로로 두 번 · 가로로 한 번 접힌 금을 따라 한쪽은 그늘지고 한쪽은 빛을 받는다. 아래 귀퉁이에 강물이 스몄다 마른 자국.
 */
function drawPaper(g: CanvasRenderingContext2D, width: number, height: number, random: () => number) {
  g.save();
  tracePaperEdge(g, width, height, random);
  g.clip();

  const base = g.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, "#E8DAB6");
  base.addColorStop(0.5, "#E2D2AA");
  base.addColorStop(1, "#D3BF92");
  g.fillStyle = base;
  g.fillRect(0, 0, width, height);
  // 얼룩덜룩한 바탕 — 크고 옅은 얼룩이 겹친다
  for (let i = 0; i < 90; i++) {
    const x = random() * width;
    const y = random() * height;
    const r = 60 + random() * 220;
    const isLight = random() > 0.55;
    const blot = g.createRadialGradient(x, y, 0, x, y, r);
    blot.addColorStop(
      0,
      isLight ? `rgba(255,248,226,${0.05 + random() * 0.07})` : `rgba(128,94,48,${0.03 + random() * 0.06})`,
    );
    blot.addColorStop(1, "rgba(128,94,48,0)");
    g.fillStyle = blot;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // 닥 섬유 — 길고 가늘게 휘어 비친다. 밝은 것과 어두운 것이 섞였다
  for (let i = 0; i < 520; i++) {
    const x = random() * width;
    const y = random() * height;
    const length = 30 + random() * 120;
    const angle = random() * Math.PI;
    g.strokeStyle =
      random() > 0.35 ? `rgba(255,250,234,${0.06 + random() * 0.1})` : `rgba(96,70,36,${0.05 + random() * 0.08})`;
    g.lineWidth = 0.6 + random() * 1.1;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(
      x + Math.cos(angle) * length * 0.5 + (random() - 0.5) * 30,
      y + Math.sin(angle) * length * 0.5 + (random() - 0.5) * 30,
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
    );
    g.stroke();
  }
  // 티 — 종이에 박힌 잔 부스러기
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(84,60,30,${0.05 + random() * 0.12})`;
    g.fillRect(random() * width, random() * height, 1 + random() * 1.6, 1 + random() * 1.6);
  }

  // 접힌 금 — 금을 사이에 두고 한쪽 면은 그늘, 한쪽 면은 빛. 금 자체는 닳아 희끗하다
  const crease = (x0: number, y0: number, x1: number, y1: number) => {
    const isVertical = Math.abs(x1 - x0) < Math.abs(y1 - y0);
    const span = 46;
    const shade = isVertical
      ? g.createLinearGradient(x0 - span, 0, x0 + span, 0)
      : g.createLinearGradient(0, y0 - span, 0, y0 + span);
    shade.addColorStop(0, "rgba(70,48,22,0)");
    shade.addColorStop(0.46, "rgba(70,48,22,0.16)");
    shade.addColorStop(0.5, "rgba(60,40,18,0.3)");
    shade.addColorStop(0.54, "rgba(255,250,232,0.24)");
    shade.addColorStop(1, "rgba(255,250,232,0)");
    g.fillStyle = shade;
    if (isVertical) g.fillRect(x0 - span, 0, span * 2, height);
    else g.fillRect(0, y0 - span, width, span * 2);
    g.strokeStyle = "rgba(250,244,226,0.5)";
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x0, y0);
    for (let k = 1; k <= 12; k++)
      g.lineTo(x0 + ((x1 - x0) * k) / 12 + (random() - 0.5) * 3, y0 + ((y1 - y0) * k) / 12 + (random() - 0.5) * 3);
    g.stroke();
  };
  crease(width * 0.335, 0, width * 0.34, height);
  crease(width * 0.665, 0, width * 0.66, height);
  crease(0, height * 0.5, width, height * 0.505);
  // 접힌 금이 만나는 자리는 닳아 구멍이 날 듯 엷다
  for (const x of [width * 0.337, width * 0.662]) {
    const worn = g.createRadialGradient(x, height * 0.502, 0, x, height * 0.502, 26);
    worn.addColorStop(0, "rgba(255,250,236,0.55)");
    worn.addColorStop(1, "rgba(255,250,236,0)");
    g.fillStyle = worn;
    g.fillRect(x - 26, height * 0.502 - 26, 52, 52);
  }

  // 강물이 스몄다 마른 자국 — 아래 귀퉁이가 누렇게 젖었다 말랐고, 마른 가장자리에 물띠가 흐릿하게 남았다
  g.save();
  g.filter = "blur(5px)";
  for (const [x, y, radius, strength] of [
    [0.05, 0.98, 310, 0.16],
    [0.11, 1.02, 215, 0.1],
  ]) {
    const tide = g.createRadialGradient(width * x, height * y, radius * 0.2, width * x, height * y, radius);
    tide.addColorStop(0, `rgba(104,84,54,${strength})`);
    tide.addColorStop(0.88, `rgba(104,84,54,${strength * 0.7})`);
    tide.addColorStop(0.95, `rgba(92,70,40,${strength * 1.5})`);
    tide.addColorStop(1, "rgba(104,84,54,0)");
    g.fillStyle = tide;
    g.fillRect(0, height * 0.4, width * 0.5, height * 0.6);
  }
  g.restore();
  // 곰팡이 점
  for (let i = 0; i < 26; i++) {
    const x = random() * width;
    const y = random() * height;
    const r = 3 + random() * 9;
    const spot = g.createRadialGradient(x, y, 0, x, y, r);
    spot.addColorStop(0, `rgba(118,78,34,${0.2 + random() * 0.2})`);
    spot.addColorStop(1, "rgba(118,78,34,0)");
    g.fillStyle = spot;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.restore();

  // 가장자리 — 닳은 선을 따라 안으로 그을린 듯 어둡고, 맨 끝은 섬유가 풀려 희끗하다
  g.save();
  tracePaperEdge(g, width, height, createRandom(1));
  g.clip();
  g.lineJoin = "round";
  // 띠가 지지 않게 흐려서 겹친다 — 넓고 옅게, 좁고 짙게, 맨 끝은 희끗하게
  for (const [lineWidth, blur, color] of [
    [90, 34, "rgba(118,84,40,0.34)"],
    [30, 12, "rgba(98,66,30,0.36)"],
    [5, 1.5, "rgba(246,238,216,0.55)"],
  ] as const) {
    tracePaperEdge(g, width, height, createRandom(1));
    g.filter = `blur(${blur}px)`;
    g.lineWidth = lineWidth;
    g.strokeStyle = color;
    g.stroke();
  }
  g.restore();
}

/** 한 줄이 차지하는 칸 수 — 띄어쓰기는 반 칸 */
const columnUnits = (text: string) => [...text].reduce((sum, ch) => sum + (ch === " " ? 0.5 : 1), 0);

/** 아랑사의 표시 — 붓으로 그은 물고기 한 마리. 이름 곁에 찍는다 */
function drawFishMark(g: CanvasRenderingContext2D, x: number, y: number, size: number) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.25);
  g.strokeStyle = "rgba(30,22,16,0.82)";
  g.lineCap = "round";
  g.lineWidth = size * 0.09;
  g.beginPath();
  g.moveTo(-size * 0.5, 0);
  g.quadraticCurveTo(-size * 0.05, -size * 0.42, size * 0.42, 0);
  g.quadraticCurveTo(-size * 0.05, size * 0.4, -size * 0.5, 0);
  g.moveTo(size * 0.42, 0);
  g.lineTo(size * 0.7, -size * 0.26);
  g.moveTo(size * 0.42, 0);
  g.lineTo(size * 0.72, size * 0.24);
  g.stroke();
  g.fillStyle = "rgba(30,22,16,0.82)";
  g.beginPath();
  g.arc(-size * 0.26, -size * 0.05, size * 0.045, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawLetter(letter: Letter, seed: number) {
  const { width, height } = PAGE;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d")!;
  // 가장자리 모양은 씨앗 하나로 — 바탕과 그을림이 같은 선을 따라야 한다
  drawPaper(g, width, height, createRandom(1));
  const random = createRandom(seed);

  // 먹글 — 세로쓰기, 오른쪽부터. 잔글씨로 빽빽하게 — 가장 긴 줄이 종이 안에 들게 글자 사이를 맞춘다
  const count = letter.lines.length + (letter.sign ? 1 : 0);
  const gap = Math.min(108, (width - 300) / Math.max(1, count - 1));
  const size = 40;
  const top = 108;
  const longest = Math.max(...letter.lines.map(columnUnits));
  const step = Math.min(size * 0.98, (height - top - 96) / longest);
  const right = width / 2 + (gap * (count - 1)) / 2;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const writeColumn = (text: string, x: number, from: number, scale = 1) => {
    let y = from;
    // 붓에 먹을 찍으면 짙고, 쓸수록 옅어지다 다시 찍는다
    let load = 1;
    // 줄이 곧지 않다 — 내려가며 조금씩 한쪽으로 쏠린다
    const drift = (random() - 0.5) * 0.02;
    [...text].forEach((ch, i) => {
      if (ch === " ") {
        y += step * 0.5 * scale;
        return;
      }
      // 줄 머리는 붓을 눌러 조금 짙고 굵다
      const isHead = i === 0 && scale === 1;
      if (isHead || load < 0.62 + random() * 0.1) load = 1;
      const ink = isHead ? 1 : 0.55 + 0.42 * load;
      load -= 0.05 + random() * 0.05;
      const px = size * scale * (isHead ? 1.1 : 0.94 + random() * 0.1);
      g.save();
      g.translate(x + (y - from) * drift + (random() - 0.5) * 3, y + (random() - 0.5) * 2);
      g.rotate((random() - 0.5) * 0.07);
      g.font = `700 ${px}px ${FONT}`;
      // 번짐 — 종이가 먹을 조금 빨아들였다
      g.filter = "blur(1.6px)";
      g.fillStyle = `rgba(52,38,26,${ink * 0.3})`;
      g.fillText(ch, 0.6, 0.8);
      g.filter = "none";
      g.fillStyle = `rgba(26,19,14,${ink * 0.92})`;
      g.strokeStyle = `rgba(26,19,14,${ink * (isHead ? 0.9 : 0.5)})`;
      g.lineWidth = isHead ? 1.5 : 0.8;
      g.strokeText(ch, 0, 0);
      g.fillText(ch, 0, 0);
      g.restore();
      y += step * scale;
    });
    return y;
  };
  letter.lines.forEach((line, k) => writeColumn(line, right - k * gap, top));
  if (letter.sign) {
    const signX = right - letter.lines.length * gap;
    const end = writeColumn(letter.sign, signX, height * 0.6, 0.92);
    drawFishMark(g, signX, end + 34, 46);
  }
  return canvas;
}

/**
 * 주머니 속 그림을 못 받았을 때(모형을 못 읽음) 대신 쓰는 그림 — 어두운 바닥에 편지 두 장만 비스듬히 겹쳐 놓는다
 */
function drawLettersOnly() {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE.width;
  canvas.height = PAGE.height;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#14172A";
  g.fillRect(0, 0, PAGE.width, PAGE.height);
  LETTERS.forEach((_, index) => {
    g.save();
    g.translate(PAGE.width * (0.42 + 0.16 * index), PAGE.height * (0.46 + 0.08 * index));
    g.rotate(index === 0 ? -0.09 : 0.06);
    g.drawImage(getLetterCanvas(index), -PAGE.width * 0.3, -PAGE.height * 0.3, PAGE.width * 0.6, PAGE.height * 0.6);
    g.restore();
  });
  return canvas;
}
