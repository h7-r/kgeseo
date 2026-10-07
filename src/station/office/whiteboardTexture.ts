import type * as THREE from "three";

import { TEXTURE_SCALE } from "@/engine/quality";
import { addGrain, cachedCanvasTexture } from "@/engine/textures/canvas";

import { BOARD_FONT_FAMILY, handRng, loadBoardFont } from "./handwriting";

/** 판 가로(유닛) ≈ 1.8m */
export const BOARD_W = 5.0;
/** 판 세로 ≈ 1.1m */
export const BOARD_H = 3.0;
/** 판 아랫변 높이(다리 길이) */
export const BOARD_LIFT = 1.7;

type Point = [number, number];
type MapNode = [number, number, string, string];
type CheckKind = "check" | "empty" | "cross";

/** 「왜곡」합동수사본부 브리핑 보드 그림. 글꼴이 오기 전·후 두 번 그린다. */
function drawBoard(g: CanvasRenderingContext2D, W: number, H: number) {
  const ink = "#2B3038";
  const navy = "#3C4A63";
  const red = "#C0392B";
  const blue = "#3D5A9E";
  const green = "#7BAE5B";

  const rnd = handRng(20260827);
  g.clearRect(0, 0, W, H);
  g.fillStyle = "#F3F1EA";
  g.fillRect(0, 0, W, H);
  g.lineJoin = "round";
  g.lineCap = "round";

  // 덩어리마다 살짝 기울이고 흔든다. 손글씨 글꼴이 작게 나와 1.25배 키운다.
  const text = (
    t: string,
    x: number,
    y: number,
    size: number,
    color = ink,
    weight = "400",
    align: CanvasTextAlign = "left",
  ) => {
    g.save();
    g.translate(x + rnd() * 3, y + rnd() * 3);
    g.rotate(rnd() * 0.016); // ±0.5°
    g.font = `${weight} ${Math.round(size * 1.25)}px ${BOARD_FONT_FAMILY}`;
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = "alphabetic";
    g.fillText(t, 0, 0);
    g.restore();
  };

  // 자로 그은 직선 대신 살짝 휜 선. 길수록 조금 더 흔들린다.
  const line = (x1: number, y1: number, x2: number, y2: number, color: string, w = 2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const seg = Math.max(2, Math.min(9, Math.round(len / 90)));
    const amp = Math.min(3.5, 1 + len / 260);
    g.strokeStyle = color;
    g.lineWidth = w;
    g.beginPath();
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const off = i === 0 || i === seg ? 0 : rnd() * amp * 2;
      const px = x1 + dx * t + nx * off;
      const py = y1 + dy * t + ny * off;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.stroke();
  };

  const rect = (x: number, y: number, w: number, h: number, color: string, lw = 3) => {
    line(x, y, x + w, y, color, lw);
    line(x + w, y, x + w, y + h, color, lw);
    line(x + w, y + h, x, y + h, color, lw);
    line(x, y + h, x, y, color, lw);
  };

  // 반지름을 양쪽으로 흔든다 — 한쪽으로만 흔들면 커지기만 하고 삐뚤어지진 않는다.
  const circle = (cx0: number, cy0: number, r: number, color: string, lw = 3, from = 0, to = Math.PI * 2) => {
    g.strokeStyle = color;
    g.lineWidth = lw;
    g.beginPath();
    const steps = 44;
    for (let i = 0; i <= steps; i++) {
      const a = from + ((to - from) * i) / steps;
      const rr = r + (rnd() - 0.5) * (r * 0.075);
      const px = cx0 + Math.cos(a) * rr;
      const py = cy0 + Math.sin(a) * rr;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.stroke();
  };
  const dot = (x: number, y: number, r: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };

  // 머리
  text("「왜곡」합동수사본부", 46, 88, 64, ink, "700");
  line(46, 112, 720, 112, ink, 6);
  g.fillStyle = navy;
  g.fillRect(770, 26, W - 770 - 40, 80);
  text("Case 01 나주 브리핑 : 완사천 전승 왜곡 사건", 800, 82, 40, "#F3F1EA", "600");

  line(470, 140, 470, H - 46, "#C9C6BD", 3);
  line(1478, 140, 1478, H - 46, "#C9C6BD", 3);

  // 왼쪽 칸
  text("수사 개시 : 2026.08.25", 46, 180, 36, ink, "600");
  line(46, 196, 430, 196, ink, 3);

  text("나주 미니 왜곡 지도", 60, 268, 34, ink, "600");
  rect(46, 292, 400, 300, ink, 3);
  const mcx = 220;
  const mcy = 448;
  const mapPins: Point[] = [
    [80, 340],
    [410, 350],
    [95, 545],
    [415, 535],
    [270, 315],
    [320, 570],
  ];
  mapPins.forEach(([x, y], i) => {
    line(mcx, mcy, x, y, i % 2 ? blue : red, 2);
    dot(x, y, 5, ink);
  });
  line(62, 390, 432, 500, green, 9);
  circle(mcx, mcy, 38, red, 4);
  text("나주통상", 110, 336, 20, ink);
  text("나주통장", 54, 540, 20, ink);
  text("1:2,500", 356, 580, 20, "#7A7770");

  text("수사 가설 타임라인", 46, 690, 36, ink, "600");
  line(46, 706, 430, 706, ink, 3);
  ["의도적인 정보 은폐?", "시간에 의한 정보 소실?", "우연한 기록 오류?", "전승 간의 모순?"].forEach((t, i) => {
    const y = 782 + i * 84;
    dot(70, y - 11, 21, navy);
    text(String(i + 1), 70, y - 2, 26, "#F3F1EA", "700", "center");
    text(t, 104, y, 30, ink);
  });
  text("(예: A, B판본 vs. C판본)", 104, 1148, 24, "#7A7770");

  // 가운데 지도
  text("사건 발생 : 20XX년 X월 X일", 520, 180, 36, ink, "600");
  text("(추정 왜곡 시점)", 906, 178, 24, "#7A7770");
  const cx = 960;
  const cy = 560;
  g.strokeStyle = "#B9CBDA";
  g.lineWidth = 44;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(560, 250);
  g.quadraticCurveTo(900, 470, 1120, 560);
  g.quadraticCurveTo(1290, 630, 1400, 790);
  g.stroke();

  g.strokeStyle = green;
  g.globalAlpha = 0.5;
  line(640, 690, 1330, 330, green, 16);
  line(690, 320, 1350, 700, green, 16);
  g.globalAlpha = 1;

  const nodes: MapNode[] = [
    [690, 270, "나주문장", blue],
    [1090, 232, "나주통상", green],
    [1300, 288, "공사산", red],
    [1372, 462, "영산산", green],
    [1338, 742, "명산통", blue],
    [634, 500, "나주문장", red],
    [830, 806, "", blue],
    [1170, 838, "", red],
  ];
  nodes.forEach(([x, y, label, color]) => {
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, cy);
    g.quadraticCurveTo((cx + x) / 2 + 34, (cy + y) / 2 - 34, x, y);
    g.stroke();
    dot(x, y, 9, "#4A4F58");
    if (label) text(label, x + 16, y + 8, 24, ink, "600");
  });

  // 펜으로 원을 그리면 정확히 안 닫히고 끝이 살짝 지나친다 — 한 바퀴보다 조금 더 돌린다.
  circle(cx, cy, 104, red, 8, -0.22, Math.PI * 2 + 0.4);
  dot(cx, cy, 11, ink);
  text("완사천", cx + 26, cy + 11, 32, ink, "700");

  text("나주 동문다리의", 690, 186, 24, ink);
  text("귀신 시간 해곡", 690, 218, 24, ink);
  text("도물 묵은 강감찬", 1206, 186, 24, ink);
  text("실존 인물 부회담", 1206, 218, 24, ink);
  text("도물 묵은 강감찬", 1206, 420, 24, ink);
  text("실존 인물 부회담", 1206, 452, 24, ink);
  text("Domeul meogeun Kang Gam-chan", 596, 962, 26, ink, "600");
  text("실존 인물 부회담", 668, 998, 24, ink);
  text("정보 간극 발생", 1130, 962, 28, red, "700");
  text("정보 간극 발생 지점", 540, 1090, 28, ink, "600");
  text("(information gap)", 540, 1126, 24, "#7A7770");

  // 오른쪽 체크리스트
  text("미스터리 조사 체크리스트", 1512, 180, 36, ink, "600");
  line(1512, 196, W - 46, 196, ink, 3);
  const items: [string, CheckKind][] = [
    ["완사천의 실제 위치 확인", "check"],
    ["거리 간 정보 모순 해결", "empty"],
    ["전승 출처의 진위 파악", "empty"],
    ["안내판 문구 불일치 원인", "cross"],
    ["기록 보드 정보 정밀 분석", "empty"],
    ["주민 증언의 신뢰도 평가", "cross"],
  ];
  items.forEach(([t, kind], i) => {
    const y = 268 + i * 82;
    rect(1516, y - 28, 32, 32, ink, 3);
    if (kind === "check") {
      g.strokeStyle = green;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(1522, y - 13);
      g.lineTo(1531, y - 2);
      g.lineTo(1546, y - 24);
      g.stroke();
    } else if (kind === "cross") {
      g.strokeStyle = red;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(1520, y - 24);
      g.lineTo(1544, y);
      g.moveTo(1544, y - 24);
      g.lineTo(1520, y);
      g.stroke();
    }
    text(t, 1566, y, 30, ink);
  });
  line(1512, 812, W - 46, 812, "#C9C6BD", 3);
  text("모든 정보가 모순적이다.", 1512, 880, 31, ink, "600");
  text("진실은 왜곡된 기억 속에 있다.", 1512, 926, 31, ink, "600");
  text("흐려진 지역의 진실을 복원해", 1512, 1082, 28, ink);
  text("사람과 장소를 되찾는다.", 1512, 1124, 28, ink);

  // 지우개로 쓸고 간 흐릿한 띠 — 화이트보드에서 제일 눈에 띄는 흔적
  const sweep = handRng(7788);
  g.save();
  for (let i = 0; i < 9; i++) {
    const x = sweep() * W;
    const y = sweep() * H;
    const w2 = W * (0.08 + sweep() * 0.16);
    const h2 = 18 + sweep() * 40;
    const gradient = g.createLinearGradient(x, y, x + w2, y);
    gradient.addColorStop(0, "rgba(180,178,168,0)");
    gradient.addColorStop(0.5, `rgba(176,174,164,${0.1 + sweep() * 0.1})`);
    gradient.addColorStop(1, "rgba(180,178,168,0)");
    g.fillStyle = gradient;
    g.save();
    g.translate(x, y);
    g.rotate((sweep() - 0.5) * 0.28);
    g.fillRect(0, 0, w2, h2);
    g.restore();
  }
  g.restore();
  addGrain(g, W, H, 20260828, 0.75);
}

/** 화이트보드 판 텍스처. 글꼴 없이 먼저 그려 두고, 손글씨 글꼴이 오면 다시 그려 갈아 끼운다. */
export function whiteboardTexture(): THREE.CanvasTexture {
  // 저사양 모드에서만 절반(2048→1024). 그리기는 캔버스 크기 기준이라 비율은 그대로다.
  const width = Math.round(2048 * TEXTURE_SCALE);
  return cachedCanvasTexture("whiteboard", drawBoard, {
    width,
    height: Math.round((width * BOARD_H) / BOARD_W),
    onCreate: (texture, canvas) => {
      void loadBoardFont().then(() => {
        const g = canvas.getContext("2d");
        if (!g) return;
        drawBoard(g, canvas.width, canvas.height);
        texture.needsUpdate = true;
      });
    },
  });
}
