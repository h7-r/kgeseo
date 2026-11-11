/**
 * 영상의 그림 재료 — 관절이 있는 실루엣 인물과 배경 판.
 * 인물은 키 1 을 기준으로 관절 각으로 세운다(각은 라디안, 0 이 아래, + 가 앞 +x). 옷은 한복 — 사내는 저고리·바지, 여인은 저고리·치마와 댕기.
 * 먹빛 덩어리에 달빛 쪽 윤곽만 얇게 빛난다. 좌표는 그림판 px.
 */
import { createRandom } from "@/engine/random";

export type Pen = CanvasRenderingContext2D;
export type Point = [number, number];

export const INK = "#0B0605";
export const RIM = "#FFE4B8";

export function makeLayer(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, g: canvas.getContext("2d") as Pen };
}

export const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const hash = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/** 점들을 둥글게 잇는다 */
export function tracePath(g: Pen, points: Point[], isClosed: boolean) {
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  g.beginPath();
  if (isClosed) {
    const start = mid(points[points.length - 1], points[0]);
    g.moveTo(start[0], start[1]);
    points.forEach((point, i) => {
      const next = mid(point, points[(i + 1) % points.length]);
      g.quadraticCurveTo(point[0], point[1], next[0], next[1]);
    });
    g.closePath();
    return;
  }
  g.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length - 1; i++) {
    const next = mid(points[i], points[i + 1]);
    g.quadraticCurveTo(points[i][0], points[i][1], next[0], next[1]);
  }
  const last = points[points.length - 1];
  g.lineTo(last[0], last[1]);
}

/** 끝으로 갈수록 가늘어지는 마디 — 둥근 끝 */
function segment(g: Pen, from: Point, angle: number, length: number, wStart: number, wEnd: number): Point {
  const to: Point = [from[0] + Math.sin(angle) * length, from[1] + Math.cos(angle) * length];
  const nx = Math.cos(angle);
  const ny = -Math.sin(angle);
  g.beginPath();
  g.moveTo(from[0] + nx * wStart, from[1] + ny * wStart);
  g.lineTo(to[0] + nx * wEnd, to[1] + ny * wEnd);
  g.lineTo(to[0] - nx * wEnd, to[1] - ny * wEnd);
  g.lineTo(from[0] - nx * wStart, from[1] - ny * wStart);
  g.closePath();
  g.fill();
  g.beginPath();
  g.arc(from[0], from[1], wStart, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(to[0], to[1], wEnd, 0, Math.PI * 2);
  g.fill();
  return to;
}

/** 바람에 나부끼는 띠 — 머리끈 · 옷고름 */
export function drawStreamer(
  g: Pen,
  x: number,
  y: number,
  direction: number,
  length: number,
  width: number,
  time: number,
  flutter = 1,
) {
  const steps = 10;
  const top: Point[] = [];
  const bottom: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wave =
      Math.sin(t * 5.5 - time * 11) * length * 0.08 * t * flutter + Math.sin(t * 2 - time * 3) * length * 0.04 * t;
    const px = x + Math.cos(direction) * length * t - Math.sin(direction) * wave;
    const py = y + Math.sin(direction) * length * t + Math.cos(direction) * wave;
    const half = (width / 2) * (1 - t * 0.8);
    top.push([px - Math.sin(direction) * half, py + Math.cos(direction) * half]);
    bottom.unshift([px + Math.sin(direction) * half, py - Math.cos(direction) * half]);
  }
  tracePath(g, [...top, ...bottom], true);
  g.fill();
}

/** 관절 자세 — 각은 라디안. 어깨·팔꿈치는 위팔·아래팔의 절대각, 엉덩이·무릎은 허벅지·정강이의 절대각 */
export interface Pose {
  /** 몸통 기울기(0 곧게 · + 앞으로) · 머리 기울기 */
  torso: number;
  head: number;
  arms: { back: [number, number]; front: [number, number] };
  legs: { back: [number, number]; front: [number, number] };
}

export const STAND: Pose = {
  torso: 0.04,
  head: 0.05,
  arms: { back: [0.3, 0.45], front: [1.25, 2.15] },
  legs: { back: [-0.12, -0.08], front: [0.14, 0.1] },
};

export function walkPose(phase: number): Pose {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  return {
    torso: 0.08,
    head: 0.02,
    arms: { back: [0.35 - s * 0.35, 0.5 - s * 0.3], front: [1.2, 2.1] },
    legs: { back: [-s * 0.5, -s * 0.5 + Math.max(0, -c) * 0.9], front: [s * 0.5, s * 0.5 + Math.max(0, c) * 0.9] },
  };
}

export function mixPose(a: Pose, b: Pose, t: number): Pose {
  const m = (x: number, y: number) => lerp(x, y, t);
  const pair = (p: [number, number], q: [number, number]): [number, number] => [m(p[0], q[0]), m(p[1], q[1])];
  return {
    torso: m(a.torso, b.torso),
    head: m(a.head, b.head),
    arms: { back: pair(a.arms.back, b.arms.back), front: pair(a.arms.front, b.arms.front) },
    legs: { back: pair(a.legs.back, b.legs.back), front: pair(a.legs.front, b.legs.front) },
  };
}

export interface Figure {
  kind: "man" | "woman";
  /** 바라보는 쪽(+1 오른쪽) · 달빛 드는 쪽(+1 오른쪽) */
  facing: 1 | -1;
  rim: 1 | -1;
  /** 앞팔 끝에 초롱을 들었나 */
  lantern?: boolean;
}

/** 사람 — 엉덩이가 원점, 키 1. 전체 회전은 바깥에서 건다. 초롱을 들면 앞손 자리를 돌려준다 */
export function drawPerson(
  g: Pen,
  x: number,
  y: number,
  size: number,
  pose: Pose,
  figure: Figure,
  time: number,
  rotation = 0,
) {
  g.save();
  g.translate(x, y);
  g.rotate(rotation);
  g.scale(size * figure.facing, size);
  const paint = (color: string, dx: number) => {
    g.save();
    g.translate(dx, 0);
    g.fillStyle = color;
    g.strokeStyle = color;
    const shoulder: Point = [Math.sin(pose.torso) * 0.32, -Math.cos(pose.torso) * 0.32];
    const neck: Point = [shoulder[0] + Math.sin(pose.torso) * 0.05, shoulder[1] - Math.cos(pose.torso) * 0.05];
    // 뒷다리 · 뒷팔
    const legs = (side: "back" | "front") => {
      const [thigh, shin] = pose.legs[side];
      const wide = figure.kind === "man" ? 0.095 : 0.075;
      const knee = segment(g, [side === "back" ? -0.04 : 0.04, 0.02], thigh, 0.25, wide, wide * 0.85);
      const ankle = segment(g, knee, shin, 0.23, wide * 0.8, 0.04);
      // 짚신 — 앞코가 앞으로
      g.beginPath();
      g.ellipse(ankle[0] + 0.035, ankle[1] + 0.02, 0.085, 0.028, 0.1, 0, Math.PI * 2);
      g.fill();
    };
    const arms = (side: "back" | "front") => {
      const [upper, lower] = pose.arms[side];
      const from: Point = [shoulder[0] + (side === "back" ? -0.07 : 0.07), shoulder[1] + 0.02];
      const elbow = segment(g, from, upper, 0.17, 0.075, 0.06);
      const hand = segment(g, elbow, lower, 0.17, 0.055, 0.03);
      return hand;
    };
    legs("back");
    arms("back");
    if (figure.kind === "woman") {
      // 치마 — 가슴 밑에서 발목까지 종처럼 퍼지고 바람에 접힌다
      const hem = 0.42 + Math.sin(time * 1.3) * 0.02;
      tracePath(
        g,
        [
          [shoulder[0] * 0.6 - 0.12, shoulder[1] * 0.6],
          [shoulder[0] * 0.6 + 0.12, shoulder[1] * 0.6],
          [0.2, 0.2],
          [hem * 0.55, 0.44],
          [hem * 0.42, 0.47],
          [0.06, 0.45],
          [-0.1, 0.47],
          [-hem * 0.5, 0.45],
          [-0.23, 0.2],
        ],
        true,
      );
      g.fill();
    } else {
      // 바지 — 통이 넓어 허벅지가 두툼하다
      tracePath(
        g,
        [
          [-0.14, 0.0],
          [0.14, 0.0],
          [0.16, 0.2],
          [-0.16, 0.2],
        ],
        true,
      );
      g.fill();
    }
    // 저고리 — 어깨에서 허리로, 밑이 살짝 퍼진다. 여인은 짧다
    const jacketBottom = figure.kind === "woman" ? 0.16 : 0.0;
    tracePath(
      g,
      [
        [shoulder[0] - 0.14, shoulder[1] - 0.02],
        [shoulder[0] + 0.14, shoulder[1] - 0.02],
        [shoulder[0] * 0.5 + 0.15, shoulder[1] * 0.5],
        [0.17, jacketBottom + 0.02],
        [-0.17, jacketBottom + 0.02],
        [shoulder[0] * 0.5 - 0.15, shoulder[1] * 0.5],
      ],
      true,
    );
    g.fill();
    // 옷고름
    drawStreamer(g, shoulder[0] * 0.5 + 0.08, shoulder[1] * 0.5 + 0.02, Math.PI / 2 + 0.3, 0.16, 0.025, time, 0.6);
    legs("front");
    const hand = arms("front");
    // 목 · 머리
    segment(g, shoulder, pose.torso + pose.head, 0.06, 0.04, 0.035);
    const headCenter: Point = [
      neck[0] + Math.sin(pose.torso + pose.head) * 0.07,
      neck[1] - Math.cos(pose.torso + pose.head) * 0.07,
    ];
    g.beginPath();
    g.ellipse(headCenter[0], headCenter[1], 0.068, 0.078, pose.head, 0, Math.PI * 2);
    g.fill();
    if (figure.kind === "man") {
      // 상투 · 머리띠(수건)
      g.beginPath();
      g.ellipse(headCenter[0] - 0.005, headCenter[1] - 0.085, 0.028, 0.034, 0, 0, Math.PI * 2);
      g.fill();
      drawStreamer(g, headCenter[0] - 0.06, headCenter[1] - 0.02, Math.PI + 0.35, 0.26, 0.026, time, 1.2);
    } else {
      // 쪽 진 머리 · 등 뒤로 늘어진 댕기
      g.beginPath();
      g.ellipse(headCenter[0] - 0.035, headCenter[1] - 0.04, 0.045, 0.035, 0.3, 0, Math.PI * 2);
      g.fill();
      drawStreamer(g, headCenter[0] - 0.05, headCenter[1] + 0.02, Math.PI / 2 + 0.45, 0.52, 0.03, time, 0.9);
    }
    g.restore();
    return hand;
  };
  // 달빛 윤곽 — 같은 그림을 빛 쪽으로 밀어 먼저 깔고 먹으로 덮는다
  paint(RIM, figure.rim * figure.facing * 0.008);
  const hand = paint(INK, 0);
  g.restore();
  return {
    x: x + hand[0] * figure.facing * size * Math.cos(rotation) - hand[1] * size * Math.sin(rotation),
    y: y + hand[0] * figure.facing * size * Math.sin(rotation) + hand[1] * size * Math.cos(rotation),
  };
}

/** 청사초롱 — 위 푸른 천, 아래 붉은 천이 실루엣에서는 먹으로, 속은 불빛 */
export function drawLantern(g: Pen, x: number, y: number, size: number, strength: number, swing = 0) {
  if (strength <= 0) return;
  g.save();
  g.translate(x, y);
  g.rotate(swing);
  const glow = g.createRadialGradient(0, size * 0.8, 0, 0, size * 0.8, size * 7);
  glow.addColorStop(0, `rgba(255,206,130,${0.9 * strength})`);
  glow.addColorStop(0.25, `rgba(255,150,70,${0.45 * strength})`);
  glow.addColorStop(1, "rgba(255,110,40,0)");
  g.fillStyle = glow;
  g.fillRect(-size * 7, -size * 6, size * 14, size * 14);
  // 손잡이 줄
  g.fillStyle = INK;
  g.fillRect(-size * 0.05, 0, size * 0.1, size * 0.4);
  // 한지 몸통 — 불빛이 비쳐 밝다. 전에는 먹색 몸통에 작은 불빛 점뿐이라 「고리 · 장신구」로 읽혔다(11/11 독해 시험)
  const body: [number, number][] = [
    [-size * 0.34, size * 0.4],
    [size * 0.34, size * 0.4],
    [size * 0.5, size * 1.0],
    [size * 0.34, size * 1.7],
    [-size * 0.34, size * 1.7],
    [-size * 0.5, size * 1.0],
  ];
  const paper = g.createRadialGradient(0, size * 1.05, 0, 0, size * 1.05, size * 0.75);
  paper.addColorStop(0, `rgba(255,244,206,${strength})`);
  paper.addColorStop(1, `rgba(255,176,86,${strength})`);
  g.fillStyle = paper;
  tracePath(g, body, true);
  g.fill();
  // 먹 테 · 살 · 위아래 마구리
  g.strokeStyle = INK;
  g.lineWidth = Math.max(1, size * 0.09);
  g.lineJoin = "round";
  tracePath(g, body, true);
  g.stroke();
  g.lineWidth = Math.max(0.8, size * 0.05);
  g.beginPath();
  g.moveTo(0, size * 0.4);
  g.lineTo(0, size * 1.7);
  g.stroke();
  g.fillStyle = INK;
  g.fillRect(-size * 0.4, size * 0.32, size * 0.8, size * 0.16);
  g.fillRect(-size * 0.4, size * 1.64, size * 0.8, size * 0.16);
  g.restore();
}

/** 풀잎 한 다발 — 앞경에 어둡게. 바람에 눕는다 */
export function drawGrass(g: Pen, x: number, baseY: number, height: number, count: number, seed: number, time: number) {
  g.fillStyle = INK;
  for (let k = 0; k < count; k++) {
    const dx = (hash(seed + k) - 0.5) * height * 1.8;
    const tall = height * (0.5 + hash(seed + k * 3) * 0.6);
    const bend = (0.12 + hash(seed + k * 7) * 0.3) * (1 + Math.sin(time * 2 + k) * 0.25);
    const width = 4 + hash(seed + k * 11) * 7;
    g.beginPath();
    g.moveTo(x + dx - width / 2, baseY);
    g.quadraticCurveTo(x + dx + bend * tall * 0.4, baseY - tall * 0.6, x + dx + bend * tall, baseY - tall);
    g.quadraticCurveTo(x + dx + bend * tall * 0.5 + width * 0.2, baseY - tall * 0.55, x + dx + width / 2, baseY);
    g.closePath();
    g.fill();
  }
}

/** 하늘 — 핏빛 노을 먹구름과 큰 달. 구름은 먹을 끈 붓자국 */
export function bakeSky(width: number, height: number, moon: { x: number; y: number; r: number }, seed: number) {
  const { canvas, g } = makeLayer(width, height);
  const sky = g.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#170504");
  sky.addColorStop(0.42, "#6A1E0E");
  sky.addColorStop(0.72, "#C9662A");
  sky.addColorStop(1, "#5E2410");
  g.fillStyle = sky;
  g.fillRect(0, 0, width, height);
  const halo = g.createRadialGradient(moon.x, moon.y, moon.r * 0.8, moon.x, moon.y, moon.r * 3.6);
  halo.addColorStop(0, "rgba(255,226,170,0.85)");
  halo.addColorStop(0.3, "rgba(255,170,90,0.35)");
  halo.addColorStop(1, "rgba(255,120,50,0)");
  g.fillStyle = halo;
  g.fillRect(0, 0, width, height);
  g.fillStyle = "#FFF1CF";
  g.beginPath();
  g.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
  g.fill();
  const random = createRandom(seed);
  g.fillStyle = "rgba(205,150,96,0.3)";
  for (let k = 0; k < 10; k++) {
    const a = random() * Math.PI * 2;
    const reach = random() * moon.r * 0.72;
    g.beginPath();
    g.ellipse(
      moon.x + Math.cos(a) * reach,
      moon.y + Math.sin(a) * reach,
      moon.r * (0.08 + random() * 0.2),
      moon.r * (0.05 + random() * 0.12),
      random() * 3,
      0,
      Math.PI * 2,
    );
    g.fill();
  }
  for (let k = 0; k < 60; k++) {
    const y = random() * height * 0.75;
    const x = random() * width;
    const length = width * (0.1 + random() * 0.45);
    const thick = 2 + random() * 18;
    g.fillStyle = `rgba(${18 + random() * 26},${5 + random() * 8},5,${0.14 + random() * 0.42})`;
    g.beginPath();
    g.moveTo(x - length / 2, y);
    g.quadraticCurveTo(x, y - thick, x + length / 2, y + random() * 8 - 4);
    g.quadraticCurveTo(x, y + thick * 0.7, x - length / 2, y);
    g.fill();
  }
  // 별
  for (let k = 0; k < 90; k++) {
    const x = random() * width;
    const y = random() * height * 0.45;
    g.fillStyle = `rgba(255,236,210,${0.2 + random() * 0.5})`;
    g.fillRect(x, y, 1 + random(), 1 + random());
  }
  return canvas;
}

/** 벼랑 — 왼쪽에서 edgeX 까지, 윗면이 topY. 켜켜이 결이 있고 끝에 달빛 선 */
export function bakeCliff(width: number, height: number, edgeX: number, topY: number, seed: number) {
  const { canvas, g } = makeLayer(width, height);
  const random = createRandom(seed);
  const top: Point[] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    top.push([edgeX * t, topY + (1 - t) * height * 0.05 + (random() - 0.5) * height * 0.014]);
  }
  const face: Point[] = [];
  const wall = 20;
  for (let i = 1; i <= wall; i++) {
    const t = i / wall;
    face.push([
      edgeX + (random() - 0.5) * width * 0.03 + Math.sin(t * 6) * width * 0.015 + t * width * 0.035,
      topY + t * (height - topY + 20),
    ]);
  }
  g.beginPath();
  g.moveTo(-20, height + 20);
  g.lineTo(-20, topY + height * 0.05);
  [...top, ...face].forEach(([x, y]) => g.lineTo(x, y));
  g.closePath();
  g.fillStyle = INK;
  g.fill();
  g.save();
  g.clip();
  for (let k = 0; k < 110; k++) {
    const x = random() * (edgeX + width * 0.06);
    const y = topY + random() * (height - topY);
    const reach = 20 + random() * 110;
    g.strokeStyle = `rgba(${80 + random() * 90},${36 + random() * 30},20,${0.08 + random() * 0.22})`;
    g.lineWidth = 0.6 + random() * 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - reach * 0.35, y + reach * (0.7 + random()));
    g.stroke();
  }
  g.restore();
  g.strokeStyle = RIM;
  g.globalAlpha = 0.75;
  g.lineWidth = 1.5;
  g.beginPath();
  [...top, ...face.slice(0, 7)].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.globalAlpha = 1;
  return canvas;
}

export function bakeGrain(size: number) {
  const { canvas, g } = makeLayer(size, size);
  const image = g.createImageData(size, size);
  const random = createRandom(7);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = random() * 255;
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = 14 + random() * 20;
  }
  g.putImageData(image, 0, 0);
  return canvas;
}
