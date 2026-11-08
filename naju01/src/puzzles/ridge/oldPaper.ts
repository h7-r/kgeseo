/**
 * 궤 속 낡은 종이 — 누렇게 바랜 한지에 먹으로 쓴 글. 먹이 군데군데 지워져 흐리지만, 풀이에 꼭 필요한 말(하늘 · 땅 · 달 · 해 ·
 * 물결 · 새)은 또렷이 남아 있다. 글판 질감과 「읽기」 안내 문구를 같은 지움 자리에서 만든다.
 */
import { useSyncExternalStore } from "react";
import * as THREE from "three";

import { createChangeSignal } from "@/lib/changeSignal";

import { beginHold, endHold } from "../pointerHold";

/** 종이 글 — 일곱 줄(세로쓰기, 오른쪽부터). 장승 이름을 풀어 쓰고, 머리 고리 · 발 고리를 바로 짚어 준다 */
export const PAPER_LINES = [
  "진부촌 어귀 두 장승이 문을 지키니",
  "하늘 아래 장군 천하대장군은",
  "머리에 달을 이고 발로 물결을 밟고",
  "땅 아래 장군 지하여장군은",
  "머리에 해를 이고 발로 새를 딛는다",
  "고리 넷이 제자리를 찾으면 문이 눈을 뜨고",
  "그 밤 강을 건넌 이는 돌아오지 않았다",
];
/** 꼭 남겨야 하는 말 — 이것만 읽혀도 풀린다 */
const KEEP = ["하늘", "땅", "천하", "지하", "장군", "머리", "발", "달", "해", "물결", "새", "고리"];

/** 종이 전용 씨앗 난수 — 지워진 글자 자리가 풀이의 일부라 수열이 바뀌면 안 된다 */
function createPaperRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

/** 글자마다 남은 정도(0 지워짐 ~ 1 또렷) — 같은 씨앗이면 같은 자리 */
function fadeMap(seed: number) {
  const random = createPaperRandom(seed);
  return PAPER_LINES.map((line) => {
    const keep = new Array<boolean>(line.length).fill(false);
    for (const word of KEEP) {
      let at = line.indexOf(word);
      while (at >= 0) {
        for (let i = 0; i < word.length; i++) keep[at + i] = true;
        at = line.indexOf(word, at + 1);
      }
    }
    return [...line].map((ch, i) => {
      if (ch === " ") return 1;
      if (keep[i]) return 0.88 + random() * 0.12;
      const r = random();
      // 다섯에 하나쯤 거의 지워졌고, 나머지는 조금 흐릴 뿐 읽힌다
      return r < 0.2 ? 0.08 + random() * 0.1 : 0.5 + random() * 0.35;
    });
  });
}

const FADES = fadeMap(7301);

/** 읽히는 대로 — 지워진 글자는 ▫ */
const readableLines = () =>
  PAPER_LINES.map((line, k) => [...line].map((ch, i) => (FADES[k][i] < 0.2 ? "▫" : ch)).join(""));
/** 안내판에 보여 줄 한 줄 */
export const PAPER_READING = readableLines().join(" / ");

// 읽기 화면 — 종이를 손에 들고 읽는 동안 true(PaperReadHud 가 띄운다).
// 읽는 동안은 잠금을 풀어 둔다 — 첫 ESC 가 종이만 내려놓고 조작으로 돌아오게(pointerHold)
const paperSignal = createChangeSignal();
let isPaperOpen = false;
export const openPaper = () => {
  if (isPaperOpen) return;
  isPaperOpen = true;
  beginHold("paper", "interaction");
  paperSignal.notify();
};
export const closePaper = () => {
  if (!isPaperOpen) return;
  isPaperOpen = false;
  endHold("paper");
  paperSignal.notify();
};
export const usePaperOpen = () => useSyncExternalStore(paperSignal.subscribe, () => isPaperOpen);
export const isPaperOpenNow = () => isPaperOpen;
/** 힌트함에 넣는 쪽지 — 그림은 종이 그림판 그대로 */
export const PAPER_HINT = { id: "ridge-paper", name: "궤 속 낡은 종이", isPhysical: false as const };
export const paperHintDescription = () =>
  readableLines().join("\n") + "\n\n천하 = 하늘, 지하 = 땅. 장승마다 머리 고리 · 발 고리.";

let paperCanvas: HTMLCanvasElement | null = null;
/** 종이 그림판 — 한 번 그려 두고 질감과 읽기 화면이 같이 쓴다 */
export function getOldPaperCanvas() {
  paperCanvas ??= drawOldPaper();
  return paperCanvas;
}

/** 종이 질감 — 누런 바탕 · 얼룩 · 접힌 자국 · 먹글(지움 정도대로) */
export function makeOldPaperTexture() {
  const texture = new THREE.CanvasTexture(getOldPaperCanvas());
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function drawOldPaper() {
  const width = 1536;
  const height = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d")!;
  const random = createPaperRandom(4211);
  // 바탕 — 가장자리로 갈수록 누렇고 어둡다
  const base = g.createRadialGradient(width / 2, height / 2, 80, width / 2, height / 2, width * 0.72);
  base.addColorStop(0, "#E6D7B4");
  base.addColorStop(0.7, "#D9C49A");
  base.addColorStop(1, "#B59A6C");
  g.fillStyle = base;
  g.fillRect(0, 0, width, height);
  // 얼룩
  for (let i = 0; i < 70; i++) {
    const x = random() * width;
    const y = random() * height;
    const r = 20 + random() * 120;
    const stain = g.createRadialGradient(x, y, 0, x, y, r);
    stain.addColorStop(0, `rgba(120,86,40,${0.05 + random() * 0.12})`);
    stain.addColorStop(1, "rgba(120,86,40,0)");
    g.fillStyle = stain;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // 섬유 결
  for (let i = 0; i < 900; i++) {
    g.strokeStyle = `rgba(255,248,230,${0.05 + random() * 0.08})`;
    g.lineWidth = 1;
    const x = random() * width;
    const y = random() * height;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (random() - 0.5) * 40, y + (random() - 0.5) * 6);
    g.stroke();
  }
  // 접힌 자국 — 가로 둘 · 세로 하나
  g.strokeStyle = "rgba(90,62,30,0.28)";
  g.lineWidth = 3;
  for (const y of [height * 0.34, height * 0.67]) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(width, y + (random() - 0.5) * 10);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(width * 0.5, 0);
  g.lineTo(width * 0.5 + (random() - 0.5) * 12, height);
  g.stroke();
  // 닳은 귀퉁이
  g.fillStyle = "rgba(110,80,44,0.35)";
  for (const [x, y] of [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ]) {
    g.beginPath();
    g.arc(x, y, 40 + random() * 30, 0, Math.PI * 2);
    g.fill();
  }
  // 붉은 낙관 — 왼쪽 아래
  g.save();
  g.translate(130, height - 150);
  g.rotate(-0.08);
  g.fillStyle = "rgba(150,40,34,0.55)";
  g.fillRect(-44, -44, 88, 88);
  g.fillStyle = "rgba(214,196,160,0.9)";
  g.font = '800 54px "Nanum Myeongjo","AppleMyungjo","Batang",serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("鎭", 0, 2);
  g.restore();
  // 먹글 — 세로쓰기 일곱 줄, 오른쪽부터. 장군마다 세 줄이 한 묶음이라 묶음 사이를 벌린다. 글자마다 남은 정도로 흐리게, 번진 테두리
  g.font = '700 60px "Nanum Myeongjo","AppleMyungjo","Batang",serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  const columnGap = 150;
  const columnX = (k: number) => width / 2 + (columnGap * (PAPER_LINES.length - 1)) / 2 - k * columnGap;
  PAPER_LINES.forEach((line, k) => {
    const x = columnX(k);
    const chars = [...line].filter((ch) => ch !== " ");
    const fades = [...line]
      .map((ch, i) => (ch === " " ? null : FADES[k][i]))
      .filter((fade): fade is number => fade !== null);
    const step = 58;
    const top = 90 + (k === 0 || k >= 5 ? 20 : 0);
    chars.forEach((ch, i) => {
      const y = top + i * step;
      const fade = fades[i];
      // 번짐
      g.fillStyle = `rgba(40,30,22,${fade * 0.25})`;
      g.fillText(ch, x + 2, y + 2);
      g.fillText(ch, x - 1, y + 1);
      g.fillStyle = `rgba(28,20,14,${fade})`;
      g.fillText(ch, x, y);
      // 지워진 글자는 먹 자국만 흐릿하게
      if (fade < 0.2) {
        g.fillStyle = `rgba(60,44,30,${0.08 + random() * 0.08})`;
        g.beginPath();
        g.ellipse(x + (random() - 0.5) * 20, y, 28, 18, random(), 0, Math.PI * 2);
        g.fill();
      }
    });
  });
  // 글 위에 번진 얼룩 — 물이 들어 먹이 뭉개진 자리. 첫 줄 · 끝 두 줄과 줄 아래쪽에만 두어 풀이 말은 가리지 않는다
  for (const [k, yRatio, r] of [
    [0, 0.42, 110],
    [5, 0.7, 120],
    [6, 0.3, 95],
    [2, 0.86, 70],
    [4, 0.9, 60],
  ] as const) {
    const x = columnX(k) + (random() - 0.5) * 30;
    const y = height * yRatio;
    const stain = g.createRadialGradient(x, y, r * 0.2, x, y, r);
    stain.addColorStop(0, "rgba(118,84,42,0.62)");
    stain.addColorStop(0.6, "rgba(118,84,42,0.38)");
    stain.addColorStop(1, "rgba(118,84,42,0)");
    g.fillStyle = stain;
    g.beginPath();
    g.ellipse(x, y, r * (0.8 + random() * 0.4), r * (0.6 + random() * 0.4), random(), 0, Math.PI * 2);
    g.fill();
  }
  return canvas;
}
