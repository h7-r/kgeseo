/**
 * 세 사발의 달빛이 선바위에 모여 비추는 영상 — 아랑사가 떨어진 뒤의 밤들. 글은 없다. 함의 영상(ridge/shadowPlay)과 같은 판 · 같은 화풍.
 *   달 뜬 벼랑 위, 아비사가 물 세 그릇을 떠 놓고 빈다 → 벼랑 끝 바위 틈에서 긴 목이 달을 가리며 올라온다(구렁이)
 *   → 구렁이가 곁에 똬리를 틀고, 아비사가 손을 얹는다 → 길 쪽에서 횃불이 올라온다(마을 젊은이들). 아비사가 구렁이 앞을 막아선다
 *   → 물이 흔들려 그림이 깨진다. 그 뒤(굴림)는 보여 주지 않는다.
 * 구렁이가 올라온 벼랑 끝 바위 틈이 아랑사가 떨어진 자리다 — 발자국이 그리로 이어진다(FootTrail).
 * 시각은 초, 좌표는 그림판 px.
 */
import { FILM, camera, createFilmScreen, drawMist, drawRiver, finishFilm } from "../ridge/shadowPlay";
import {
  INK,
  RIM,
  STAND,
  bakeCliff,
  bakeGrain,
  bakeSky,
  drawGrass,
  drawPerson,
  hash,
  lerp,
  makeLayer,
  mixPose,
  smooth,
  walkPose,
  type Figure,
  type Pen,
  type Point,
  type Pose,
} from "../ridge/shadowPlayArt";

const W = FILM.width;
const H = FILM.height;
const DRAWS_PER_SECOND = 30;
/** 판 크기(미터) — 선바위 앞에 뜬다 */
const MOON_PLAY_PLANE = { width: 3.0, height: 1.69 };

/** 컷 시작 시각 · 끝 — 필름 시각(그림을 짠 빠르기) */
const CUT = { kneel: 0, rise: 3.0, touch: 5.7, torch: 8.0, tear: 10.0 };
const FILM_SECONDS = 11.7;
/** 화면에는 이만큼 느리게 튼다 — 컷마다 무슨 일인지 읽을 틈을 준다 */
const PACE = 1.3;
/** 트는 시간(초) · 빛이 약해지며 영상이 사라지는 시간(끝에서) */
export const MOON_PLAY_SECONDS = FILM_SECONDS * PACE;
export const MOON_PLAY_FADE = 1.4;
/** 소리 — at 은 트는 시각 */
export const MOON_PLAY_CUES: { at: number; sound: "우르릉" | "징" | "첨벙" | "전환"; shake?: number }[] = [
  { at: 0.1, sound: "징" },
  { at: (CUT.rise + 0.5) * PACE, sound: "우르릉" },
  { at: CUT.torch * PACE, sound: "전환" },
  { at: CUT.tear * PACE, sound: "첨벙", shake: 0.14 },
];

interface Layers {
  sky: HTMLCanvasElement;
  skyWide: HTMLCanvasElement;
  cliffWide: HTMLCanvasElement;
  cliffSide: HTMLCanvasElement;
  grain: HTMLCanvasElement;
  /** 깨지는 컷이 밀어 옮길 직전 그림 */
  held: ReturnType<typeof makeLayer>;
}

const ABISA: Figure = { kind: "woman", facing: 1, rim: 1 };
/** 무릎 꿇고 손을 모은다 */
const KNEEL: Pose = {
  torso: 0.16,
  head: 0.14,
  arms: { back: [0.7, 2.3], front: [0.75, 2.45] },
  legs: { back: [1.4, -1.5], front: [1.35, -1.45] },
};
/** 기척에 고개를 든다 */
const LOOK_UP: Pose = { ...KNEEL, torso: 0.06, head: -0.32 };
/** 무릎 꿇은 채 손을 내민다 */
const REACH: Pose = { ...KNEEL, torso: 0.28, head: -0.08, arms: { back: [0.7, 2.3], front: [1.25, 1.5] } };
/** 일어서서 두 팔을 벌려 막아선다 */
const GUARD: Pose = { ...STAND, torso: -0.04, head: 0.0, arms: { back: [-1.15, -1.35], front: [1.2, 1.4] } };
/** 무릎 꿇었을 때 엉덩이가 땅에서 뜨는 높이(키 비율) */
const KNEEL_HIP = 0.2;

/** 사발 셋의 가로 자리(판 너비 비율) · 반지름(px) — 멀리 본 판 · 옆에서 본 판 */
const WIDE_BOWLS = { xs: [0.316, 0.35, 0.376], radii: [7.5, 6, 4.4] } as const;
const SIDE_BOWLS = { xs: [0.352, 0.4, 0.434], radii: [19, 14.5, 10.5] } as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 벼랑 윗면 높이 — 벼랑 그림(bakeCliff)은 끝으로 갈수록 살짝 올라간다. 멀리 본 판 · 옆에서 본 판 */
const wideGroundAt = (x: number) => H * 0.4 + (1 - x / (W * 0.46)) * H * 0.05;
const sideGroundAt = (x: number) => H * 0.5 + (1 - x / (W * 0.5)) * H * 2.2 * 0.05;

/** 무릎 꿇은 자세에서 앞손이 닿는 자리 — drawPerson 과 같은 셈(엉덩이가 원점, 오른쪽을 본다) */
function frontHandOf(x: number, hipY: number, size: number, pose: Pose): Point {
  const shoulderX = Math.sin(pose.torso) * 0.32 + 0.07;
  const shoulderY = -Math.cos(pose.torso) * 0.32 + 0.02;
  const [upper, lower] = pose.arms.front;
  return [
    x + (shoulderX + (Math.sin(upper) + Math.sin(lower)) * 0.17) * size,
    hipY + (shoulderY + (Math.cos(upper) + Math.cos(lower)) * 0.17) * size,
  ];
}

/** 받침 위 사발 — 먹빛 돌과 사발, 물에 달이 비치면 흰 점이 뜬다. flat 이면 넓고 낮은 너럭바위다 */
function drawBowlOnStone(g: Pen, x: number, groundY: number, r: number, shine: number, flat = false) {
  g.fillStyle = INK;
  const wide = flat ? r * 3.1 : r * 1.5;
  const tall = flat ? r * 0.85 : r * 1.25;
  // 받침 — 모가 난 돌
  g.beginPath();
  g.moveTo(x - wide, groundY + 3);
  g.lineTo(x - wide * 0.86, groundY - tall * 0.7);
  g.lineTo(x - wide * 0.35, groundY - tall);
  g.lineTo(x + wide * 0.5, groundY - tall * 0.94);
  g.lineTo(x + wide * 0.92, groundY - tall * 0.5);
  g.lineTo(x + wide, groundY + 3);
  g.closePath();
  g.fill();
  // 사발
  const rim = groundY - tall - r * 0.62;
  g.beginPath();
  g.moveTo(x - r, rim);
  g.quadraticCurveTo(x - r * 0.9, rim + r * 0.75, x - r * 0.3, rim + r * 0.72);
  g.lineTo(x + r * 0.3, rim + r * 0.72);
  g.quadraticCurveTo(x + r * 0.9, rim + r * 0.75, x + r, rim);
  g.closePath();
  g.fill();
  // 달빛 받은 전과 돌 윗모서리
  g.strokeStyle = RIM;
  g.globalAlpha = 0.8;
  g.lineWidth = Math.max(1, r * 0.09);
  g.beginPath();
  g.moveTo(x - r, rim);
  g.lineTo(x + r, rim);
  g.moveTo(x - wide * 0.35, groundY - tall);
  g.lineTo(x + wide * 0.5, groundY - tall * 0.94);
  g.stroke();
  g.globalAlpha = 1;
  if (shine <= 0) return;
  const glow = g.createRadialGradient(x, rim, 0, x, rim, r * 2.6);
  glow.addColorStop(0, `rgba(255,244,214,${0.9 * shine})`);
  glow.addColorStop(0.3, `rgba(255,214,150,${0.35 * shine})`);
  glow.addColorStop(1, "rgba(255,190,120,0)");
  g.fillStyle = glow;
  g.fillRect(x - r * 2.6, rim - r * 2.6, r * 5.2, r * 5.2);
}

/** 사발 셋 — 너럭바위 위 큰 사발 · 받침돌 위 사발 · 작은 사발 */
function drawThreeBowls(
  g: Pen,
  bowls: { xs: readonly number[]; radii: readonly number[] },
  groundAt: (x: number) => number,
  shine: (k: number) => number,
) {
  bowls.xs.forEach((bx, k) => drawBowlOnStone(g, W * bx, groundAt(W * bx), bowls.radii[k], shine(k), k === 0));
}

/** 물에 뜬 달이 일렁이는 정도 */
const shimmer = (t: number) => (k: number) => 0.75 + 0.25 * Math.sin(t * 3 + k * 2);

/** 굵기가 줄어드는 몸 — 점들을 따라 원을 촘촘히 찍는다(from 굵기 → to 굵기) */
function strokeBody(g: Pen, points: Point[], from: number, to: number) {
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
    for (let k = 0; k < steps; k++) {
      const u = (i + k / steps) / (points.length - 1);
      g.beginPath();
      g.arc(lerp(ax, bx, k / steps), lerp(ay, by, k / steps), lerp(from, to, u), 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** S 자로 휜 목 — 밑동에서 머리까지, 가운데 두 점으로 좌우로 한 번씩 휜다 */
function neckPoints(base: Point, bendA: Point, bendB: Point, head: Point, count = 26): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const u = 1 - t;
    const weights = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    points.push([
      weights[0] * base[0] + weights[1] * bendA[0] + weights[2] * bendB[0] + weights[3] * head[0],
      weights[0] * base[1] + weights[1] * bendA[1] + weights[2] * bendB[1] + weights[3] * head[1],
    ]);
  }
  return points;
}

/** 구렁이 머리 — 목 끝에서 보는 쪽으로 납작하고 길쭉한 머리. tongue 가 크면 혀를 날름인다 */
function drawSerpentHead(g: Pen, at: Point, angle: number, size: number, tongue: number) {
  g.save();
  g.translate(at[0], at[1]);
  g.rotate(angle);
  g.beginPath();
  g.moveTo(-size * 1.0, -size * 0.62);
  g.quadraticCurveTo(size * 0.3, -size * 1.05, size * 1.5, -size * 0.5);
  g.quadraticCurveTo(size * 2.3, -size * 0.2, size * 2.35, size * 0.08);
  g.quadraticCurveTo(size * 2.2, size * 0.34, size * 1.5, size * 0.42);
  g.quadraticCurveTo(size * 0.3, size * 0.78, -size * 1.0, size * 0.62);
  g.closePath();
  g.fill();
  if (tongue > 0) {
    g.lineWidth = Math.max(1, size * 0.13);
    g.strokeStyle = g.fillStyle;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(size * 2.3, size * 0.1);
    g.lineTo(size * (2.3 + 1.0 * tongue), size * 0.18);
    g.lineTo(size * (2.3 + 1.5 * tongue), -size * 0.05);
    g.moveTo(size * (2.3 + 1.0 * tongue), size * 0.18);
    g.lineTo(size * (2.3 + 1.5 * tongue), size * 0.45);
    g.stroke();
  }
  g.restore();
}

/** 긴 목과 머리 — 달빛 윤곽을 먼저 깔고 먹으로 덮는다. look 은 머리가 보는 각(라디안, 0 오른쪽 · π 왼쪽) */
function drawNeck(g: Pen, points: Point[], thick: number, look: number, tongue: number) {
  const head = points[points.length - 1];
  for (const [color, dx, dy] of [
    [RIM, 2.2, -1.4],
    [INK, 0, 0],
  ] as const) {
    g.save();
    g.translate(dx, dy);
    g.fillStyle = color;
    strokeBody(g, points, thick, thick * 0.7);
    drawSerpentHead(g, head, look, thick * 0.92, color === INK ? tongue : 0);
    g.restore();
  }
  // 눈 — 달빛 한 점. 머리 위쪽(왼쪽을 볼 때도 위에 오게 뒤집는다)
  const up = Math.cos(look) < 0 ? 1 : -1;
  g.fillStyle = "rgba(255,236,190,0.95)";
  g.beginPath();
  g.arc(
    head[0] + Math.cos(look) * thick * 1.05 - Math.sin(look) * thick * 0.32 * up,
    head[1] + Math.sin(look) * thick * 1.05 + Math.cos(look) * thick * 0.32 * up,
    thick * 0.15,
    0,
    Math.PI * 2,
  );
  g.fill();
}

/** 똬리 — 겹쳐 쌓인 고리 셋. 맨 위 고리 가운데가 목 밑동이다 */
function drawCoil(g: Pen, x: number, groundY: number, size: number): Point {
  const rings: [number, number, number][] = [
    [size * 0.62, size * 0.15, 0],
    [size * 0.48, size * 0.14, size * 0.2],
    [size * 0.33, size * 0.13, size * 0.39],
  ];
  for (const [color, dx, dy] of [
    [RIM, 2.2, -1.4],
    [INK, 0, 0],
  ] as const) {
    g.fillStyle = color;
    for (const [rx, ry, lift] of rings) {
      g.beginPath();
      g.ellipse(x + dx, groundY - ry - lift + dy, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // 꼬리 끝 — 고리 밖으로 가늘게 빠진다
  g.fillStyle = INK;
  strokeBody(
    g,
    neckPoints(
      [x + size * 0.5, groundY - size * 0.08],
      [x + size * 0.7, groundY - size * 0.02],
      [x + size * 0.9, groundY],
      [x + size * 1.05, groundY - size * 0.1],
      8,
    ),
    size * 0.06,
    size * 0.015,
  );
  return [x, groundY - size * 0.52];
}

/** 벼랑 끝 바위 둘 — 그 사이가 틈이다. 구렁이가 여기서 올라온다 */
function drawEdgeRocks(g: Pen, groundAt: (x: number) => number, scale: number) {
  g.fillStyle = INK;
  const rocks: [number, number, number][] = [
    [0.452, 0.034, 0.2],
    [0.499, 0.024, 0.13],
  ];
  for (const [cx, half, tall] of rocks) {
    const x = W * cx;
    const base = groundAt(x) + 4;
    const w = W * half;
    const h = scale * tall;
    g.beginPath();
    g.moveTo(x - w, base);
    g.lineTo(x - w * 0.85, base - h * 0.55);
    g.lineTo(x - w * 0.3, base - h);
    g.lineTo(x + w * 0.35, base - h * 0.92);
    g.lineTo(x + w * 0.8, base - h * 0.45);
    g.lineTo(x + w, base);
    g.closePath();
    g.fill();
    g.strokeStyle = RIM;
    g.globalAlpha = 0.7;
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x - w * 0.3, base - h);
    g.lineTo(x + w * 0.35, base - h * 0.92);
    g.lineTo(x + w * 0.8, base - h * 0.45);
    g.stroke();
    g.globalAlpha = 1;
  }
}

/** 횃불 — 자루와 일렁이는 불꽃, 둘레 불빛 */
function drawTorch(g: Pen, x: number, y: number, size: number, time: number, seed: number) {
  const flicker = 0.8 + 0.2 * Math.sin(time * 17 + seed * 3) * Math.sin(time * 7.3 + seed);
  const glow = g.createRadialGradient(x, y, 0, x, y, size * 7);
  glow.addColorStop(0, `rgba(255,210,140,${0.85 * flicker})`);
  glow.addColorStop(0.25, `rgba(255,140,60,${0.4 * flicker})`);
  glow.addColorStop(1, "rgba(255,100,30,0)");
  g.fillStyle = glow;
  g.fillRect(x - size * 7, y - size * 7, size * 14, size * 14);
  g.strokeStyle = INK;
  g.lineWidth = size * 0.28;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x - size * 0.5, y + size * 2.6);
  g.stroke();
  g.fillStyle = `rgba(255,236,190,${flicker})`;
  g.beginPath();
  g.moveTo(x - size * 0.5, y + size * 0.1);
  g.quadraticCurveTo(
    x - size * 0.7,
    y - size * 0.9,
    x + Math.sin(time * 9 + seed) * size * 0.3,
    y - size * (1.5 + 0.3 * flicker),
  );
  g.quadraticCurveTo(x + size * 0.7, y - size * 0.8, x + size * 0.5, y + size * 0.1);
  g.closePath();
  g.fill();
}

/** 무릎 꿇은(또는 일어서는) 아비사 — 치마가 땅에 퍼지도록 땅선 아래를 자른다. hip 은 엉덩이가 땅에서 뜬 높이(키 비율) */
function drawOnGround(
  g: Pen,
  x: number,
  groundY: number,
  size: number,
  pose: Pose,
  time: number,
  hip = KNEEL_HIP,
  figure = ABISA,
) {
  g.save();
  g.beginPath();
  g.rect(0, 0, W, groundY + 1);
  g.clip();
  drawPerson(g, x, groundY - size * hip, size, pose, figure, time);
  g.restore();
}

// ── 컷 ──
/** 달 뜬 벼랑 위 — 아비사가 걸어와 물 세 그릇 앞에 무릎을 꿇는다. 물에 달이 내려앉는다 */
function cutKneel(g: Pen, art: Layers, t: number) {
  const u = t / CUT.rise;
  g.save();
  camera(g, 1 + 0.07 * smooth(u), -W * 0.025 * u, 0);
  g.drawImage(art.skyWide, 0, 0);
  drawRiver(g, H * 0.73, W * 0.63, t);
  drawMist(g, H * 0.72, 0.22, t);
  g.drawImage(art.cliffWide, 0, 0);
  const size = H * 0.17;
  const arrive = smooth(clamp01(t / 1.5));
  const kneel = smooth(clamp01((t - 1.5) / 0.7));
  const x = W * lerp(0.13, 0.262, arrive);
  const moon = smooth(clamp01((t - 2.0) / 0.8));
  drawEdgeRocks(g, wideGroundAt, size * 0.9);
  drawThreeBowls(g, WIDE_BOWLS, wideGroundAt, (k) => moon * shimmer(t)(k));
  const pose = kneel > 0 ? mixPose(walkPose(1.5 * 7), KNEEL, kneel) : walkPose(t * 7);
  drawOnGround(g, x, wideGroundAt(x), size, pose, t, lerp(0.5, KNEEL_HIP, kneel));
  g.restore();
}

/** 옆에서 가까이 — 무릎 꿇은 아비사와 세 그릇. 벼랑 끝 바위 틈에서 긴 목이 달을 가리며 올라온다 */
function cutRise(g: Pen, art: Layers, t: number, length: number) {
  const u = t / length;
  g.save();
  camera(g, 1.02 + 0.05 * u, -W * 0.015 * u, H * 0.1 + H * 0.008 * u);
  g.drawImage(art.sky, 0, 0);
  drawRiver(g, H * 0.76, W * 0.66, t, 0.8);
  drawMist(g, H * 0.75, 0.16, t);
  const size = H * 0.42;
  // 구렁이 — 벼랑 끝 두 바위 사이에서 올라온다. 벼랑과 바위를 나중에 그려 밑동이 가려진다
  const rise = smooth(clamp01((t - 0.4) / 1.9));
  if (rise > 0) {
    const gapX = W * 0.478;
    const ground = sideGroundAt(gapX);
    const sway = Math.sin(t * 1.5) * size * 0.05;
    const base: Point = [gapX + size * 0.04, ground + size * 0.5];
    const head: Point = [gapX - size * 0.06 + sway, ground + size * 0.2 - rise * size * 1.12];
    const span = base[1] - head[1];
    drawNeck(
      g,
      neckPoints(
        base,
        [gapX + size * 0.26 - sway, base[1] - span * 0.3],
        [gapX - size * 0.2 + sway * 2, base[1] - span * 0.7],
        head,
      ),
      size * 0.085,
      Math.PI + 0.3 - rise * 0.25,
      clamp01(Math.sin(t * 5) * 2 - 1),
    );
  }
  g.drawImage(art.cliffSide, 0, 0);
  drawEdgeRocks(g, sideGroundAt, size);
  drawThreeBowls(g, SIDE_BOWLS, sideGroundAt, shimmer(t));
  // 아비사 — 빌다가, 무언가 올라오는 기척에 고개를 든다
  const notice = smooth(clamp01((t - 1.5) / 0.6));
  const x = W * 0.255;
  drawOnGround(g, x, sideGroundAt(x), size, mixPose(KNEEL, LOOK_UP, notice), t);
  drawGrass(g, W * 0.07, H * 0.99, H * 0.3, 9, 61, t);
  g.restore();
}

/** 더 가까이 — 구렁이가 곁에 똬리를 틀고 고개를 숙인다. 아비사가 그 머리에 손을 얹는다 */
function cutTouch(g: Pen, art: Layers, t: number, length: number) {
  const u = t / length;
  g.save();
  camera(g, 1.16 + 0.05 * u, W * 0.05 - W * 0.01 * u, H * 0.11);
  g.drawImage(art.sky, 0, 0);
  drawRiver(g, H * 0.76, W * 0.66, t, 0.8);
  drawMist(g, H * 0.75, 0.16, t);
  g.drawImage(art.cliffSide, 0, 0);
  const size = H * 0.42;
  drawEdgeRocks(g, sideGroundAt, size);
  drawThreeBowls(g, SIDE_BOWLS, sideGroundAt, shimmer(t));
  const reach = smooth(clamp01((t - 0.2) / 1.1));
  const bow = smooth(clamp01((t - 0.5) / 1.2));
  const pose = mixPose(LOOK_UP, REACH, reach);
  const x = W * 0.255;
  const ground = sideGroundAt(x);
  const palm = frontHandOf(x, ground - size * KNEEL_HIP, size, pose);
  // 구렁이 — 사발 너머에 똬리를 틀고, 목을 S 자로 세웠다가 아비사의 손바닥 밑으로 머리를 내린다
  const coilX = W * 0.475;
  const neckBase = drawCoil(g, coilX, sideGroundAt(coilX), size * 0.46);
  const raised: Point = [coilX - size * 0.22, neckBase[1] - size * 0.62];
  const lowered: Point = [palm[0] + size * 0.16, palm[1] + size * 0.07];
  const head: Point = [lerp(raised[0], lowered[0], bow), lerp(raised[1], lowered[1], bow) + Math.sin(t * 1.4) * 2];
  drawNeck(
    g,
    neckPoints(
      neckBase,
      [coilX + size * 0.2, neckBase[1] - size * lerp(0.35, 0.45, bow)],
      [coilX - size * lerp(0.3, 0.05, bow), neckBase[1] - size * lerp(0.5, 0.62, bow)],
      head,
    ),
    size * 0.07,
    Math.PI + lerp(0.15, -0.25, bow),
    0,
  );
  drawOnGround(g, x, ground, size, pose, t);
  drawGrass(g, W * 0.04, H * 0.99, H * 0.3, 9, 61, t);
  g.restore();
}

/** 다시 멀리 — 길 쪽에서 횃불 넷이 올라온다. 아비사가 일어나 구렁이 앞을 막아서고, 구렁이는 고개를 쳐든다 */
function cutTorch(g: Pen, art: Layers, t: number) {
  const u = clamp01(t / (CUT.tear - CUT.torch));
  g.save();
  camera(g, 1.07 - 0.05 * u, W * 0.02 * u, 0);
  g.drawImage(art.skyWide, 0, 0);
  drawRiver(g, H * 0.73, W * 0.63, t);
  drawMist(g, H * 0.72, 0.22, t);
  g.drawImage(art.cliffWide, 0, 0);
  const size = H * 0.17;
  drawEdgeRocks(g, wideGroundAt, size * 0.9);
  drawThreeBowls(g, WIDE_BOWLS, wideGroundAt, () => 0.7);
  // 구렁이 — 아비사 뒤에서 높이 고개를 든다
  const rear = smooth(clamp01(t / 0.8));
  const coilX = W * 0.415;
  const neckBase = drawCoil(g, coilX, wideGroundAt(coilX), size * 0.6);
  const head: Point = [coilX - size * 0.2 + Math.sin(t * 2.2) * 3, neckBase[1] - size * lerp(0.3, 0.95, rear)];
  const span = neckBase[1] - head[1];
  drawNeck(
    g,
    neckPoints(
      neckBase,
      [coilX + size * 0.3, neckBase[1] - span * 0.3],
      [coilX - size * 0.45, neckBase[1] - span * 0.7],
      head,
    ),
    size * 0.085,
    Math.PI + 0.12,
    clamp01(Math.sin(t * 6) * 2 - 1),
  );
  // 아비사 — 횃불 쪽을 보고 팔을 벌린다
  const stand = smooth(clamp01(t / 0.5));
  const abisaX = W * 0.345;
  drawOnGround(g, abisaX, wideGroundAt(abisaX), size, mixPose(REACH, GUARD, stand), t, lerp(KNEEL_HIP, 0.5, stand), {
    kind: "woman",
    facing: -1,
    rim: 1,
  });
  // 횃불 든 사내들 — 왼쪽 길에서 하나씩
  for (let k = 0; k < 4; k++) {
    const show = smooth(clamp01(u * 2.4 - k * 0.3));
    if (show <= 0) continue;
    const x = W * (-0.03 + 0.047 * (3 - k)) + show * W * 0.08;
    const tall = size * (1.05 - k * 0.03);
    // 다 올라오면 걸음을 멈추고 선다
    const stride = mixPose(walkPose(t * 6 + k * 1.7), STAND, smooth(clamp01((show - 0.8) / 0.2)));
    const hand = drawPerson(
      g,
      x,
      wideGroundAt(x) - tall * 0.5,
      tall,
      { ...stride, arms: { back: [0.3, 0.4], front: [2.3, 2.9] } },
      { kind: "man", facing: 1, rim: -1 },
      t,
    );
    drawTorch(g, hand.x + 2, hand.y - size * 0.12, size * 0.075, t, k);
  }
  g.restore();
}

/** 물이 흔들린다 — 직전 그림이 줄마다 밀리고 금이 가며 꺼진다 */
function cutTear(g: Pen, art: Layers, t: number) {
  const u = clamp01(t / (FILM_SECONDS - CUT.tear));
  const { canvas } = art.held;
  const band = 5;
  for (let y = 0; y < H; y += band) {
    const wave = Math.sin(y * 0.055 - t * 16) * (10 + 70 * u) * u + (hash(y + Math.floor(t * 40)) - 0.5) * 40 * u * u;
    g.globalAlpha = (1 - smooth(clamp01((u - 0.35) / 0.65))) * (0.75 + 0.25 * hash(y * 3 + Math.floor(t * 30)));
    g.drawImage(canvas, 0, y, W, band, wave, y, W, band);
  }
  g.globalAlpha = 1;
  // 금 — 물낯이 깨지듯 흰 금이 번쩍 지나간다
  const flash = 1 - smooth(clamp01(t / 0.5));
  if (flash > 0) {
    g.strokeStyle = `rgba(255,246,224,${0.9 * flash})`;
    g.lineWidth = 2.5;
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      let x = W * (0.3 + hash(k) * 0.4);
      let y = H * 0.1;
      g.moveTo(x, y);
      for (let step = 0; step < 9; step++) {
        x += (hash(k * 13 + step) - 0.5) * 90;
        y += H * 0.09;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }
}

export function createMoonPlay() {
  const { canvas, g, texture, material, mesh } = createFilmScreen(MOON_PLAY_PLANE.width, MOON_PLAY_PLANE.height);
  let layers: Layers | null = null;
  let lastDraw = -1;

  /** 배경 판을 미리 굽는다 — 사발을 처음 올릴 때 불러 영상이 뜰 때 멈칫하지 않게 */
  const prepare = () => {
    layers ??= {
      sky: bakeSky(W, H, { x: W * 0.66, y: H * 0.4, r: H * 0.27 }, 57),
      skyWide: bakeSky(W, H, { x: W * 0.63, y: H * 0.44, r: H * 0.22 }, 59),
      cliffWide: bakeCliff(W, H, W * 0.46, H * 0.4, 31),
      cliffSide: bakeCliff(W, H * 2.2, W * 0.5, H * 0.5, 37),
      grain: bakeGrain(256),
      held: makeLayer(W, H),
    };
    return layers;
  };

  /** 그 순간의 컷을 그려 올린다 — seconds 는 틀기 시작한 뒤 흐른 시간 */
  const draw = (seconds: number) => {
    const frame = Math.floor(seconds * DRAWS_PER_SECOND);
    if (frame === lastDraw) return;
    lastDraw = frame;
    const time = seconds / PACE;
    const art = prepare();
    g.save();
    g.clearRect(0, 0, W, H);
    if (time < CUT.rise) cutKneel(g, art, time);
    else if (time < CUT.touch) cutRise(g, art, time - CUT.rise, CUT.touch - CUT.rise);
    else if (time < CUT.torch) cutTouch(g, art, time - CUT.touch, CUT.torch - CUT.touch);
    else if (time < CUT.tear) {
      cutTorch(g, art, time - CUT.torch);
      // 깨지는 컷이 쓸 그림 — 마지막 장을 남겨 둔다
      art.held.g.clearRect(0, 0, W, H);
      art.held.g.drawImage(canvas, 0, 0);
    } else cutTear(g, art, time - CUT.tear);
    g.restore();
    finishFilm(g, art.grain, time, frame, [CUT.rise, CUT.touch, CUT.torch]);
    texture.needsUpdate = true;
  };

  return { mesh, material, texture, draw, prepare, canvas };
}
