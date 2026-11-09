/**
 * 함에서 솟은 빛 속의 영상 — 그날 밤이 영화처럼 컷으로 지나간다. 글은 없다.
 *   달 앞 벼랑을 초롱 들고 걷는 아랑사 → 벼랑 끝에 서서 강 건너를 본다(발치 바위에 번들거리는 소똥). 뒤 풀숲이 한 번 흔들린다
 *   → 뒤꿈치가 미끄러진다 → 풀숲에서 놀란 손들이 뻗어 나오지만 늦었다(셋은 골탕만 먹일 셈이었다) → 추락
 *   → 느려진 시간 속, 얼굴에서 눈물 한 방울이 달빛에 반짝이며 떠오른다 → 달아나는 셋의 뒷모습(어부 둘 · 댕기 여인)이 잠깐
 *   → 물보라 → 가라앉는 수면, 떠 있던 초롱이 꺼지고 빛이 약해지며 영상이 사라진다. 누가 밀었다거나 구렁이가 된 것은 안 보여 준다.
 * 판은 재생하는 동안만 올린다. 시각은 초.
 */
import * as THREE from "three";

import { M } from "../units";
import {
  INK,
  RIM,
  STAND,
  bakeCliff,
  bakeGrain,
  bakeSky,
  drawGrass,
  drawLantern,
  drawPerson,
  drawStreamer,
  hash,
  lerp,
  makeLayer,
  mixPose,
  smooth,
  tracePath,
  walkPose,
  type Figure,
  type Pen,
  type Pose,
} from "./shadowPlayArt";

/** 그림판 크기(px) — 바위 위 영상(cliff/moonPlay)도 같은 판에 그린다 */
export const FILM = { width: 1024, height: 576 };
const W = FILM.width;
const H = FILM.height;
const BAR = 0.08;
const DRAWS_PER_SECOND = 30;
/** 판 크기(미터) */
const PLANE = { width: 3.2, height: 1.8 };

/** 컷 시작 시각 */
const CUT = { walk: 0, edge: 1.7, slip: 3.7, hands: 4.25, fall: 4.95, tear: 5.75, flee: 7.0, impact: 7.75, after: 8.7 };
/** 풀숲이 흔들리는 때(벼랑 컷 안에서) */
const RUSTLE_AT = 1.3;
export const SHADOW_PLAY_SECONDS = 12.4;
/** 빛이 약해지며 영상이 사라지는 시간(끝에서) */
export const SHADOW_PLAY_FADE = 2.4;
export const SHADOW_PLAY_CUES: { at: number; sound: "우르릉" | "징" | "첨벙" | "전환"; shake?: number }[] = [
  { at: CUT.edge + RUSTLE_AT, sound: "우르릉" },
  { at: CUT.slip, sound: "징", shake: 0.16 },
  { at: CUT.impact, sound: "첨벙", shake: 0.3 },
];

interface Layers {
  sky: HTMLCanvasElement;
  skyWide: HTMLCanvasElement;
  cliffWide: HTMLCanvasElement;
  cliffSide: HTMLCanvasElement;
  grain: HTMLCanvasElement;
}

const ARANG: Figure = { kind: "man", facing: 1, rim: 1, lantern: true };

/** 바위 위에 번들거리는 소똥 — 납작하고 젖은 덩어리, 달빛이 비친다 */
function drawDung(g: Pen, x: number, y: number, size: number, shine: number) {
  g.fillStyle = "#1E1007";
  tracePath(
    g,
    [
      [x - size, y],
      [x - size * 0.5, y - size * 0.22],
      [x + size * 0.1, y - size * 0.28],
      [x + size * 0.8, y - size * 0.12],
      [x + size * 1.1, y + size * 0.05],
      [x + size * 0.4, y + size * 0.12],
      [x - size * 0.6, y + size * 0.1],
    ],
    true,
  );
  g.fill();
  g.fillStyle = `rgba(255,226,180,${0.55 * shine})`;
  g.beginPath();
  g.ellipse(x + size * 0.25, y - size * 0.14, size * 0.3, size * 0.05, -0.1, 0, Math.PI * 2);
  g.fill();
}

/** 강 — 달빛 줄기가 일렁이는 검은 물 */
export function drawRiver(g: Pen, top: number, moonX: number, time: number, strength = 1) {
  g.fillStyle = "#10070A";
  g.fillRect(0, top, W, H - top);
  for (let k = 0; k < 30; k++) {
    const depth = k / 30;
    const y = top + 3 + depth * (H - top);
    const spread = 16 + depth * 170;
    const x = moonX + Math.sin(k * 2.3 + time * 1.3) * spread * 0.4;
    const reach = spread * (0.5 + hash(k) * 0.6);
    g.fillStyle = `rgba(255,${190 - depth * 70},${120 - depth * 60},${(0.6 - depth * 0.35) * strength})`;
    g.fillRect(x - reach / 2, y, reach, 1.3 + depth * 2.2);
  }
}

export function drawMist(g: Pen, y: number, alpha: number, time: number) {
  for (let k = 0; k < 4; k++) {
    const x = ((time * (12 + k * 6) + k * 260) % (W + 500)) - 250;
    const cy = y + k * 14;
    const glow = g.createRadialGradient(x, cy, 0, x, cy, 280);
    glow.addColorStop(0, `rgba(255,190,130,${alpha})`);
    glow.addColorStop(1, "rgba(255,190,130,0)");
    g.save();
    g.translate(0, cy);
    g.scale(1, 0.18);
    g.translate(0, -cy);
    g.fillStyle = glow;
    g.fillRect(x - 280, cy - 280, 560, 560);
    g.restore();
  }
}

/** 카메라 — 가운데를 기준으로 당기고 밀고 살짝 흐른다 */
export function camera(g: Pen, zoom: number, dx: number, dy: number, roll = 0) {
  g.translate(W / 2 + dx, H / 2 + dy);
  g.rotate(roll);
  g.scale(zoom, zoom);
  g.translate(-W / 2, -H / 2);
}

// ── 컷 ──
/** 달 앞 벼랑 — 초롱 든 아랑사가 벼랑 위를 걸어온다. 카메라가 천천히 밀고 들어간다 */
function cutWalk(g: Pen, art: Layers, t: number) {
  g.save();
  camera(g, 1 + 0.08 * smooth(t / 1.7), -W * 0.03 * (t / 1.7), 0);
  g.drawImage(art.skyWide, 0, 0);
  drawRiver(g, H * 0.73, W * 0.63, t);
  drawMist(g, H * 0.72, 0.25, t);
  g.drawImage(art.cliffWide, 0, 0);
  const x = W * (0.2 + 0.11 * t);
  const size = H * 0.155;
  const hand = drawPerson(g, x, H * 0.405 - size * 0.5, size, walkPose(t * 7.5), ARANG, t);
  drawLantern(g, hand.x, hand.y, 4.2, 0.95, Math.sin(t * 7.5) * 0.15);
  g.restore();
}

/** 벼랑 끝 — 옆에서 본다. 강 건너를 바라보며 초롱을 든다. 발치 바위에 소똥이 번들거린다 */
function cutEdge(g: Pen, art: Layers, t: number, length: number) {
  const u = t / length;
  g.save();
  camera(g, 1.02 + 0.06 * u, -W * 0.02 * u, H * 0.1 + H * 0.01 * u);
  g.drawImage(art.sky, 0, 0);
  drawRiver(g, H * 0.76, W * 0.66, t, 0.8);
  drawMist(g, H * 0.75, 0.18, t);
  g.drawImage(art.cliffSide, 0, 0);
  const size = H * 0.4;
  const feetY = H * 0.5;
  const breathe = Math.sin(t * 1.6) * 0.012;
  const settle = smooth(t / 0.7);
  // 풀숲이 흔들리자 고개를 뒤로 돌린다
  const turn = smooth((t - RUSTLE_AT - 0.15) / 0.5) * (1 - smooth((t - RUSTLE_AT - 1.1) / 0.5));
  const pose = mixPose(
    walkPose(0.3),
    {
      ...STAND,
      torso: 0.1 + breathe - turn * 0.06,
      head: 0.06 - turn * 0.5,
      arms: { back: [0.2, 0.4], front: [1.35 + breathe, 2.0] },
    },
    settle,
  );
  const x = W * 0.43;
  drawDung(g, x + size * 0.14, feetY + size * 0.01, size * 0.1, 0.8 + Math.sin(t * 3) * 0.2);
  drawHidingBush(g, W * 0.16, feetY, size, t, Math.max(0, 1 - Math.abs(t - RUSTLE_AT - 0.2) / 0.45));
  const hand = drawPerson(g, x, feetY - size * 0.5, size, pose, ARANG, t);
  drawLantern(g, hand.x, hand.y, 12, 0.95, Math.sin(t * 2.2) * 0.05);
  g.restore();
}

/** 미끄러짐 — 뒤꿈치가 소똥을 밟아 앞으로 쭉 밀려 나간다. 세상이 기울고 초롱이 튄다 */
function cutSlip(g: Pen, art: Layers, t: number, length: number) {
  const u = t / length;
  g.save();
  camera(g, 1.1 + u * 0.08, -W * 0.05 * u, H * 0.1 + H * 0.03 * u, -0.05 * u);
  g.drawImage(art.sky, 0, 0);
  drawRiver(g, H * 0.76, W * 0.66, 3 + t, 0.8);
  g.drawImage(art.cliffSide, 0, 0);
  const size = H * 0.4;
  const feetY = H * 0.5 + u * size * 0.1;
  const slid = u * size * 0.3;
  const pose: Pose = {
    torso: lerp(0.1, -0.55, smooth(u)),
    head: lerp(0.06, -0.2, u),
    arms: {
      back: [lerp(0.2, 2.9, smooth(u * 1.3)), lerp(0.4, 2.2, u)],
      front: [lerp(1.35, 2.6, smooth(u)), lerp(2.0, 1.9, u)],
    },
    legs: {
      back: [lerp(-0.12, -0.6, u), lerp(-0.08, 0.3, u)],
      front: [lerp(0.14, 1.25, smooth(u * 1.2)), lerp(0.1, 1.2, smooth(u))],
    },
  };
  const x = W * 0.43 + slid;
  drawHidingBush(g, W * 0.16, H * 0.5, size, 3.7 + t, 0.5 + u * 0.5);
  drawDung(g, W * 0.43 + size * 0.14, H * 0.5 + size * 0.01, size * 0.1, 0.5);
  // 뭉개진 똥이 뒤꿈치를 따라 번진다
  g.fillStyle = "rgba(30,16,7,0.8)";
  g.beginPath();
  g.ellipse(
    W * 0.43 + size * 0.14 + slid * 0.5,
    H * 0.5 + size * 0.015,
    slid * 0.5 + 4,
    size * 0.012,
    0,
    0,
    Math.PI * 2,
  );
  g.fill();
  const hand = drawPerson(g, x, feetY - size * 0.5, size, pose, ARANG, t);
  // 초롱이 손을 떠나 날아오른다
  const fly = smooth((u - 0.45) / 0.55);
  drawLantern(g, hand.x + fly * size * 0.3, hand.y - fly * size * 0.25, 12, 0.95, -fly * 1.4);
  // 돌가루
  for (let k = 0; k < 8; k++) {
    const age = u * (0.8 + hash(k) * 0.6);
    g.fillStyle = `rgba(40,26,14,${1 - age})`;
    g.beginPath();
    g.arc(
      W * 0.43 + size * 0.2 + hash(k + 3) * 60 * age,
      H * 0.5 - 40 * age + 160 * age * age,
      1.5 + hash(k + 5) * 2.5,
      0,
      Math.PI * 2,
    );
    g.fill();
  }
  g.restore();
}

/** 벼랑 위 풀숲 — 셋이 숨은 덤불. shake 가 크면 거세게 흔들리고 머리 둘이 살짝 비친다 */
function drawHidingBush(g: Pen, x: number, baseY: number, size: number, time: number, shake: number) {
  g.save();
  const sway = Math.sin(time * 2.1) * 0.06 + Math.sin(time * 23) * 0.22 * shake;
  g.translate(x, baseY);
  g.transform(1, 0, sway, 1, 0, 0);
  g.translate(-x, -baseY);
  drawGrass(g, x - size * 0.2, baseY + 2, size * 0.78, 26, 5, time);
  drawGrass(g, x + size * 0.25, baseY + 2, size * 0.7, 22, 13, time);
  const peek = smooth(shake / 0.6) * (1 - smooth((shake - 0.85) / 0.15));
  g.fillStyle = INK;
  for (const [dx, h] of [
    [-0.12, 0.66],
    [0.14, 0.7],
  ] as const) {
    g.beginPath();
    g.ellipse(x + dx * size, baseY - size * h - peek * size * 0.05, size * 0.045, size * 0.05, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** 손이 뻗어 나온다 — 풀숲에서 팔 셋이 벼랑 끝으로 급히 뻗는다. 손가락을 벌린 채. reach 0~1 */
function drawReachingArms(
  g: Pen,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  size: number,
  reach: number,
  time: number,
) {
  const arms: [number, number, number][] = [
    [-0.08, -0.06, 0],
    [0.1, 0.02, 0.08],
    [-0.22, 0.1, 0.16],
  ];
  for (const [ox, oy, delay] of arms) {
    const r = smooth((reach - delay) / (1 - delay));
    if (r <= 0) continue;
    const sx = fromX + ox * size;
    const sy = fromY + oy * size;
    const ex = sx + (toX - sx) * (0.55 + 0.45 * r) + Math.sin(time * 30) * 3 * (1 - r);
    const ey = sy + (toY - sy) * (0.55 + 0.45 * r);
    const dx = ex - sx;
    const dy = ey - sy;
    const len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    g.fillStyle = INK;
    g.strokeStyle = INK;
    g.lineCap = "round";
    const elbowX = sx + dx * 0.5;
    const elbowY = sy + dy * 0.5 - len * (0.28 - r * 0.14);
    g.lineWidth = size * 0.13;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(elbowX, elbowY);
    g.stroke();
    g.lineWidth = size * 0.095;
    g.beginPath();
    g.moveTo(elbowX, elbowY);
    g.lineTo(ex, ey);
    g.stroke();
    g.beginPath();
    g.ellipse(ex, ey, size * 0.055, size * 0.042, angle, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = size * 0.022;
    for (let f = 0; f < 5; f++) {
      const spread = (f - 2) * 0.28 * r;
      const length = size * (0.075 + (f === 2 ? 0.015 : 0) - (f === 0 ? 0.02 : 0));
      g.beginPath();
      g.moveTo(ex, ey);
      g.lineTo(ex + Math.cos(angle + spread) * length, ey + Math.sin(angle + spread) * length);
      g.stroke();
    }
  }
}

/** 손 — 미끄러진 몸은 벌써 벼랑 밖으로 넘어가고, 풀숲에서 놀란 손들이 뻗어 나오지만 닿지 않는다 */
function cutHands(g: Pen, art: Layers, t: number, length: number) {
  const u = t / length;
  g.save();
  camera(g, 1.16, -W * 0.06, H * 0.12, -0.04);
  g.drawImage(art.sky, 0, 0);
  drawRiver(g, H * 0.76, W * 0.66, 4 + t, 0.8);
  g.drawImage(art.cliffSide, 0, 0);
  const size = H * 0.4;
  const feetY = H * 0.5;
  const fall = u * u;
  drawPerson(
    g,
    W * 0.43 + size * 0.42 + u * size * 0.25,
    feetY - size * 0.3 + fall * size * 0.9,
    size,
    fallingPose(u * 0.4),
    { ...ARANG, lantern: false },
    t,
    0.2 + u * 0.9,
  );
  drawLantern(g, W * 0.43 + size * 0.6 + u * size * 0.3, feetY - size * 0.9 + u * size * 0.5, 12, 0.95, -1.4 - u * 2);
  // 풀숲에서 몸을 반쯤 일으킨 셋 — 어깨까지만 풀 위로
  const rise = smooth(u / 0.4);
  for (const [dx, scale, kind] of [
    [-0.12, 0.9, "man"],
    [0.1, 0.85, "woman"],
    [-0.02, 0.95, "man"],
  ] as const) {
    const figure: Figure = { kind, facing: 1, rim: 1 };
    const pose: Pose = {
      ...STAND,
      torso: 0.55,
      head: -0.1,
      arms: STAND.arms,
      legs: { back: [-0.9, 0.9], front: [0.8, 1.5] },
    };
    drawPerson(g, W * 0.18 + dx * size, feetY - size * scale * 0.2 - rise * size * 0.12, size * scale, pose, figure, t);
  }
  drawHidingBush(g, W * 0.16, feetY, size, 4.3 + t, 0.9);
  const reach = smooth(u / 0.5);
  const armFrom = [W * 0.21, feetY - size * 0.62] as const;
  const armTo = [W * 0.21 + size * 0.62, feetY - size * 0.4] as const;
  for (let k = 3; k >= 1; k--) {
    g.save();
    g.globalAlpha = 0.14;
    drawReachingArms(g, armFrom[0], armFrom[1], armTo[0], armTo[1], size, Math.max(0, reach - k * 0.12), t);
    g.restore();
  }
  drawReachingArms(g, armFrom[0], armFrom[1], armTo[0], armTo[1], size, reach, t);
  g.restore();
}

/** 달아남 — 낮은 뒷모습. 셋이 풀을 헤치고 달빛 쪽으로 달아난다. 아주 잠깐 */
function cutFlee(g: Pen, art: Layers, t: number, length: number) {
  const u = t / length;
  g.save();
  camera(g, 1.06 + u * 0.03, W * 0.01 * u, 0);
  g.drawImage(art.skyWide, 0, 0);
  g.filter = "blur(1.5px)";
  g.drawImage(art.cliffWide, -W * 0.1, H * 0.02);
  g.filter = "none";
  g.restore();
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(0, H);
  g.lineTo(0, H * 0.72);
  g.quadraticCurveTo(W * 0.5, H * 0.62, W, H * 0.7);
  g.lineTo(W, H);
  g.closePath();
  g.fill();
  const runners: { x: number; depth: number; figure: Figure; phase: number }[] = [
    { x: W * 0.38, depth: 0.0, figure: { kind: "man", facing: 1, rim: 1 }, phase: 0.2 },
    { x: W * 0.52, depth: 0.25, figure: { kind: "woman", facing: 1, rim: 1 }, phase: 2.1 },
    { x: W * 0.64, depth: 0.12, figure: { kind: "man", facing: 1, rim: 1 }, phase: 4.0 },
  ];
  for (const { x, depth, figure, phase } of runners) {
    const gone = u * (0.9 - depth * 0.5);
    const size = H * (0.5 - depth * 0.12) * (1 - gone * 0.55);
    const stride = t * 13 + phase;
    const pose = walkPose(stride);
    pose.torso = 0.3;
    pose.legs.back[0] *= 1.6;
    pose.legs.front[0] *= 1.6;
    pose.arms.back[0] -= 0.8;
    pose.arms.front = [0.9 + Math.sin(stride) * 0.6, 1.9];
    const bob = Math.abs(Math.sin(stride)) * size * 0.03;
    const y = H * (0.78 - depth * 0.08) - gone * H * 0.22 - size * 0.5 + bob;
    drawPerson(g, x + (x - W * 0.5) * gone * 0.4, y, size, pose, figure, t, 0.08);
  }
  drawGrass(g, W * 0.1, H * 1.0, H * 0.4, 30, 3, t);
  drawGrass(g, W * 0.42, H * 1.02, H * 0.36, 30, 9, t);
  drawGrass(g, W * 0.8, H * 1.0, H * 0.42, 32, 29, t);
}

/** 떨어지는 몸 — 등이 꺾인 채 돌며 아래로. 빛 쪽 윤곽과 지나온 궤적이 남는다 */
function fallingPose(u: number): Pose {
  return {
    torso: -0.6 + Math.sin(u * 4) * 0.2,
    head: -0.35,
    arms: { back: [2.9 - u * 0.6, 2.4], front: [2.5 + Math.sin(u * 6) * 0.3, 1.8] },
    legs: { back: [-0.8 + Math.sin(u * 5) * 0.2, 0.2], front: [0.9, 1.1 + Math.sin(u * 7) * 0.2] },
  };
}

/** 추락 — 벼랑 끝에서 쏟아져 내려간다. 카메라가 따라 내려가고 벼랑이 위로 흐른다. 궤적이 꼬리처럼 남는다 */
function cutFall(g: Pen, art: Layers, t: number, length: number) {
  const u = t / length;
  const bodyX = (v: number) => W * 0.56 + v * W * 0.1;
  const bodyY = (v: number) => H * 0.42 + v * v * H * 1.25;
  const follow = (bodyY(u) - H * 0.45) * 0.85;
  g.save();
  camera(g, 1.0, 0, -follow);
  g.drawImage(art.sky, 0, -H * 0.1 + follow * 0.85);
  drawRiver(g, H * 1.55, W * 0.66, 4 + t, 0.7);
  g.drawImage(art.cliffSide, 0, 0);
  const size = H * 0.4;
  for (let k = 6; k >= 1; k--) {
    const back = u - k * 0.04;
    if (back < 0) continue;
    g.save();
    g.globalAlpha = 0.11 * (1 - k / 7);
    drawPerson(g, bodyX(back), bodyY(back), size, fallingPose(back), { ...ARANG, lantern: false }, t, 0.3 + back * 2.4);
    g.restore();
  }
  const lx = W * 0.5 + Math.sin(u * 4) * 20;
  const ly = H * 0.4 + u * u * H * 1.0;
  for (let k = 0; k < 18; k++) {
    const back = k / 18;
    g.fillStyle = `rgba(255,${190 - back * 90},90,${(1 - back) * 0.85})`;
    g.beginPath();
    g.arc(lx + Math.sin(k * 3 + t * 9) * back * 30, ly - back * 170, (1 - back) * 3.2, 0, Math.PI * 2);
    g.fill();
  }
  drawLantern(g, lx, ly, 10, 0.95, u * 3);
  drawPerson(g, bodyX(u), bodyY(u), size, fallingPose(u), { ...ARANG, lantern: false }, t, 0.3 + u * 2.4);
  g.restore();
}

/** 느려진 시간 — 얼굴 가까이. 눈가에서 눈물 한 방울이 떠올라 달빛에 반짝인다 */
function cutTear(g: Pen, art: Layers, t: number, length: number) {
  const u = t / length;
  g.save();
  camera(g, 1.0, 0, 0, 0.9);
  g.filter = "blur(2px)";
  g.drawImage(art.sky, -W * 0.45, -H * 0.55, W * 1.9, H * 1.9);
  g.filter = "none";
  g.restore();
  // 뒤로 흐르는 머리끈 · 옷자락
  g.fillStyle = INK;
  drawStreamer(g, W * 0.52, H * 0.4, -2.2, H * 0.9, H * 0.07, t, 0.8);
  drawStreamer(g, W * 0.48, H * 0.42, -2.6, H * 0.7, H * 0.05, t + 0.5, 0.8);
  // 얼굴 — 옆얼굴, 하늘을 보며 뒤로 젖혀진 채. 뒤통수 · 이마 · 콧마루 · 인중 · 입술 · 턱 · 목
  const cx = W * 0.5;
  const cy = H * 0.6;
  const size = H * 0.5;
  g.save();
  g.translate(cx, cy);
  g.rotate(-0.42);
  g.scale(size, size);
  const profile: [number, number][] = [
    [0.02, -0.56],
    [0.2, -0.47],
    [0.27, -0.31],
    [0.255, -0.2],
    [0.36, -0.02],
    [0.445, 0.075],
    [0.35, 0.115],
    [0.34, 0.165],
    [0.385, 0.2],
    [0.33, 0.235],
    [0.375, 0.285],
    [0.3, 0.335],
    [0.335, 0.425],
    [0.22, 0.5],
    [0.1, 0.545],
    [0.1, 0.63],
    [0.145, 0.68],
    [0.1, 0.8],
    [0.26, 1.1],
  ];
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(-0.6, 1.1);
  g.quadraticCurveTo(-0.5, 0.4, -0.38, 0.05);
  g.quadraticCurveTo(-0.48, -0.3, -0.3, -0.5);
  g.quadraticCurveTo(-0.15, -0.6, 0.02, -0.56);
  for (const [x, y] of profile) g.lineTo(x, y);
  g.closePath();
  g.fill();
  g.beginPath();
  g.ellipse(-0.1, -0.65, 0.085, 0.07, 0.2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = RIM;
  g.lineWidth = 0.012;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  profile.slice(0, 15).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.lineWidth = 0.014;
  g.beginPath();
  g.moveTo(0.1, -0.15);
  g.quadraticCurveTo(0.18, -0.2 + u * 0.03, 0.245, -0.14);
  g.stroke();
  g.lineWidth = 0.016;
  g.beginPath();
  g.moveTo(0.08, -0.27);
  g.quadraticCurveTo(0.18, -0.32, 0.265, -0.27);
  g.stroke();
  g.restore();
  // 눈물이 떠나는 자리 — 돌린 얼굴 좌표를 화면으로
  const eyeX = cx + (0.245 * Math.cos(-0.42) - -0.14 * Math.sin(-0.42)) * size;
  const eyeY = cy + (0.245 * Math.sin(-0.42) + -0.14 * Math.cos(-0.42)) * size;
  // 눈물 — 눈가에서 떨어져 나와 떨어지는 몸보다 느리게, 위로 흘러간다
  const born = smooth((u - 0.15) / 0.2);
  if (born > 0) {
    const tx = eyeX + (u - 0.15) * size * 0.25;
    const ty = eyeY - smooth((u - 0.2) / 0.8) * size * 0.7;
    const r = size * 0.028 * born;
    const glow = g.createRadialGradient(tx, ty, 0, tx, ty, r * 6);
    glow.addColorStop(0, "rgba(220,240,255,0.9)");
    glow.addColorStop(0.3, "rgba(160,210,255,0.35)");
    glow.addColorStop(1, "rgba(120,180,255,0)");
    g.fillStyle = glow;
    g.fillRect(tx - r * 6, ty - r * 6, r * 12, r * 12);
    g.fillStyle = "rgba(236,246,255,0.95)";
    g.beginPath();
    g.moveTo(tx, ty - r * 1.9);
    g.quadraticCurveTo(tx + r * 1.1, ty - r * 0.2, tx, ty + r);
    g.quadraticCurveTo(tx - r * 1.1, ty - r * 0.2, tx, ty - r * 1.9);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.beginPath();
    g.ellipse(tx - r * 0.3, ty - r * 0.4, r * 0.25, r * 0.4, 0.3, 0, Math.PI * 2);
    g.fill();
    // 반짝임
    g.strokeStyle = "rgba(255,255,255,0.75)";
    g.lineWidth = 1.2;
    const spark = r * 4 * Math.max(0, Math.sin(u * 9));
    g.beginPath();
    g.moveTo(tx - spark, ty);
    g.lineTo(tx + spark, ty);
    g.moveTo(tx, ty - spark);
    g.lineTo(tx, ty + spark);
    g.stroke();
  }
}

/** 물보라 — 건너편에서. 검은 물이 깨지며 부드러운 물기둥과 안개가 솟고 고리가 번진다 */
function cutImpact(g: Pen, art: Layers, t: number) {
  g.save();
  camera(g, 1.0 + smooth(t / 1) * 0.04, 0, 0);
  g.drawImage(art.sky, 0, -H * 0.12);
  const waterY = H * 0.66;
  drawRiver(g, waterY, W * 0.66, 7 + t, 0.9);
  const cx = W * 0.5;
  const fade = 1 - smooth((t - 0.45) / 0.5);
  // 물기둥 — 둥근 안개 덩이가 위로 겹겹이 솟아 기둥을 이룬다. 가운데가 가장 높고, 옆은 늦게 낮게
  const plumes: [number, number, number, number][] = [
    [0, 0.6, 0.065, 0],
    [-0.07, 0.38, 0.035, 0.05],
    [0.08, 0.42, 0.035, 0.07],
    [-0.14, 0.2, 0.028, 0.12],
    [0.15, 0.22, 0.028, 0.1],
  ];
  for (const [dx, tall, wide, delay] of plumes) {
    const grow = 1 - (1 - Math.min(1, Math.max(0, t - delay) / 0.5)) ** 3;
    const up = grow * H * tall * (1 + (1 - fade) * 0.3);
    const x = cx + dx * W;
    const r = W * wide * (0.9 + (1 - fade) * 0.9);
    for (let k = 0; k < 9; k++) {
      const h = k / 8;
      const y = waterY - up * h;
      const rr = r * (1.1 - h * 0.45) * (0.8 + hash(k + dx * 50) * 0.4);
      const sway = Math.sin(k * 1.7 + t * 6) * rr * 0.25 * h;
      const blob = g.createRadialGradient(x + sway, y, 0, x + sway, y, rr);
      blob.addColorStop(0, `rgba(244,247,250,${(0.8 - h * 0.35) * fade})`);
      blob.addColorStop(0.55, `rgba(216,228,238,${(0.4 - h * 0.18) * fade})`);
      blob.addColorStop(1, "rgba(200,216,230,0)");
      g.fillStyle = blob;
      g.fillRect(x + sway - rr, y - rr, rr * 2, rr * 2);
    }
    const mist = g.createRadialGradient(x, waterY - up * 0.45, 0, x, waterY - up * 0.45, r * 2.4 + up * 0.35);
    mist.addColorStop(0, `rgba(230,238,245,${0.16 * fade})`);
    mist.addColorStop(1, "rgba(220,230,240,0)");
    g.fillStyle = mist;
    g.fillRect(x - r * 3 - up, waterY - up * 1.5, r * 6 + up * 2, up * 1.7);
  }
  // 물방울 — 날아가는 쪽으로 길게 늘어난 가닥
  for (let k = 0; k < 80; k++) {
    const dir = (hash(k) - 0.5) * 2;
    const speed = 0.5 + hash(k + 5) * 0.9;
    const vx = dir * 240 * speed;
    const vy = -(H * 1.6 * speed) + H * 4.6 * t;
    const x = cx + vx * Math.min(1, t * 1.5);
    const y = waterY - (H * 1.6 * t * speed - H * 2.3 * t * t);
    if (y > waterY) continue;
    const r = 1.2 + hash(k + 9) * 3;
    const len = Math.min(26, Math.hypot(vx, vy) * 0.03);
    const a = Math.atan2(vy, vx * 1.5);
    g.strokeStyle = `rgba(240,246,250,${0.55 + hash(k + 2) * 0.35})`;
    g.lineCap = "round";
    g.lineWidth = r;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - Math.cos(a) * len, y - Math.sin(a) * len);
    g.stroke();
  }
  // 수면 거품
  g.fillStyle = `rgba(236,242,246,${0.45 * fade})`;
  g.beginPath();
  g.ellipse(cx, waterY + 5, W * 0.11 * Math.min(1, t * 2.5), W * 0.018, 0, 0, Math.PI * 2);
  g.fill();
  // 고리
  g.strokeStyle = "rgba(255,214,160,0.7)";
  for (let k = 0; k < 4; k++) {
    const age = t - k * 0.18;
    if (age <= 0) continue;
    g.globalAlpha = Math.max(0, 1 - age / 1.1);
    g.lineWidth = 2.5 - k * 0.4;
    g.beginPath();
    g.ellipse(cx, waterY + 6, age * W * 0.22, age * W * 0.035, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.globalAlpha = 1;
  if (t < 0.12) {
    g.fillStyle = `rgba(255,248,232,${1 - t / 0.12})`;
    g.fillRect(-W, -H, W * 3, H * 3);
  }
  g.restore();
}

/** 뒤 — 잔물결이 가라앉고, 떠 있던 초롱이 물결에 흔들리다 꺼진다. 달만 남는다 */
function cutAfter(g: Pen, art: Layers, t: number, length: number) {
  const u = t / length;
  g.save();
  camera(g, 1.0 + u * 0.03, 0, -H * 0.02 * u);
  g.drawImage(art.sky, 0, -H * 0.12);
  const waterY = H * 0.66;
  drawRiver(g, waterY, W * 0.66, 8 + t, 0.9);
  const cx = W * 0.5;
  g.strokeStyle = "rgba(255,214,160,0.5)";
  for (let k = 0; k < 6; k++) {
    const age = t + 0.6 - k * 0.3;
    if (age <= 0) continue;
    g.globalAlpha = Math.max(0, 1 - age / 2.6);
    g.lineWidth = 1.6;
    g.beginPath();
    g.ellipse(cx, waterY + 6, age * W * 0.18, age * W * 0.028, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.globalAlpha = 1;
  // 떠 있는 초롱 — 기울어 떠다니다 불이 꺼진다
  const light = 1 - smooth((t - 1.0) / 1.2);
  const bob = Math.sin(t * 2.1) * 4;
  g.save();
  g.translate(cx + W * 0.06 + t * 8, waterY + 14 + bob);
  g.rotate(1.25 + Math.sin(t * 1.4) * 0.08);
  drawLantern(g, 0, 0, 9, light * 0.9);
  g.restore();
  // 초롱이 물에 비친 빛
  g.fillStyle = `rgba(255,190,120,${0.3 * light})`;
  g.beginPath();
  g.ellipse(cx + W * 0.06 + t * 8, waterY + 30, 50, 6, 0, 0, Math.PI * 2);
  g.fill();
  drawMist(g, waterY + 10, 0.14, 8 + t);
  g.restore();
}

/** 영상을 올릴 판 — 그림판 · 질감 · 늘 맨 위에 그리는 재질. 크기는 미터 */
export function createFilmScreen(width: number, height: number) {
  const { canvas, g } = makeLayer(W, H);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width * M, height * M), material);
  mesh.visible = false;
  mesh.renderOrder = 8;
  return { canvas, g, texture, material, mesh };
}

/**
 * 한 장을 필름처럼 마무리한다 — 색 누르기 · 알갱이 · 가장자리 어둠 · 컷 넘김 · 처음 밝아짐 · 위아래 띠 · 판 가장자리 풀기.
 * cuts 는 컷이 바뀌는 시각들(그때 한 장 어둡게 넘어간다)
 */
export function finishFilm(g: Pen, grain: HTMLCanvasElement, time: number, frame: number, cuts: number[]) {
  // 색 — 그늘은 푸르게, 빛은 호박빛으로 눌러 필름 느낌
  g.save();
  g.globalCompositeOperation = "soft-light";
  const grade = g.createLinearGradient(0, 0, 0, H);
  grade.addColorStop(0, "rgba(40,60,110,0.55)");
  grade.addColorStop(0.5, "rgba(255,170,90,0.25)");
  grade.addColorStop(1, "rgba(30,40,90,0.6)");
  g.fillStyle = grade;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "overlay";
  const dx = Math.floor(hash(frame) * 256);
  const dy = Math.floor(hash(frame + 3) * 256);
  for (let x = -dx; x < W; x += 256) for (let y = -dy; y < H; y += 256) g.drawImage(grain, x, y);
  g.restore();
  const vignette = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.62);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.55)");
  g.fillStyle = vignette;
  g.fillRect(0, 0, W, H);
  // 컷이 바뀔 때 한 장 어둡게 — 필름이 넘어간다
  for (const at of cuts) {
    const since = time - at;
    if (since >= 0 && since < 0.06) {
      g.fillStyle = `rgba(0,0,0,${0.7 * (1 - since / 0.06)})`;
      g.fillRect(0, 0, W, H);
    }
  }
  // 처음엔 어둠에서 밝아진다. 끝은 까매지지 않고 판 자체가 빛과 함께 옅어진다(BoxOpening)
  const open = smooth(time / 0.6);
  if (open < 1) {
    g.fillStyle = `rgba(2,3,6,${1 - open})`;
    g.fillRect(0, 0, W, H);
  }
  g.fillStyle = "#030202";
  g.fillRect(0, 0, W, H * BAR);
  g.fillRect(0, H * (1 - BAR), W, H * BAR);
  // 판 가장자리를 빛 속으로 풀어 준다
  g.globalCompositeOperation = "destination-in";
  const edgeX = g.createLinearGradient(0, 0, W, 0);
  edgeX.addColorStop(0, "rgba(0,0,0,0)");
  edgeX.addColorStop(0.03, "rgba(0,0,0,1)");
  edgeX.addColorStop(0.97, "rgba(0,0,0,1)");
  edgeX.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = edgeX;
  g.fillRect(0, 0, W, H);
  const edgeY = g.createLinearGradient(0, 0, 0, H);
  edgeY.addColorStop(0, "rgba(0,0,0,0)");
  edgeY.addColorStop(0.03, "rgba(0,0,0,1)");
  edgeY.addColorStop(0.97, "rgba(0,0,0,1)");
  edgeY.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = edgeY;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "source-over";
}

export function createShadowPlay() {
  const { canvas, g, texture, material, mesh } = createFilmScreen(PLANE.width, PLANE.height);

  let layers: Layers | null = null;
  let lastDraw = -1;

  /** 배경 판을 미리 굽는다 — 함이 놓일 때 불러 처음 그릴 때 멈칫하지 않게 */
  const prepare = () => {
    layers ??= {
      sky: bakeSky(W, H, { x: W * 0.66, y: H * 0.4, r: H * 0.27 }, 41),
      skyWide: bakeSky(W, H, { x: W * 0.63, y: H * 0.44, r: H * 0.22 }, 43),
      cliffWide: bakeCliff(W, H, W * 0.46, H * 0.4, 11),
      cliffSide: bakeCliff(W, H * 2.2, W * 0.5, H * 0.5, 23),
      grain: bakeGrain(256),
    };
    return layers;
  };

  /** 그 순간의 컷을 그려 올린다 */
  const draw = (time: number) => {
    const frame = Math.floor(time * DRAWS_PER_SECOND);
    if (frame === lastDraw) return;
    lastDraw = frame;
    const art = prepare();
    g.save();
    g.clearRect(0, 0, W, H);
    if (time < CUT.edge) cutWalk(g, art, time);
    else if (time < CUT.slip) cutEdge(g, art, time - CUT.edge, CUT.slip - CUT.edge);
    else if (time < CUT.hands) cutSlip(g, art, time - CUT.slip, CUT.hands - CUT.slip);
    else if (time < CUT.fall) cutHands(g, art, time - CUT.hands, CUT.fall - CUT.hands);
    else if (time < CUT.tear) cutFall(g, art, time - CUT.fall, CUT.tear - CUT.fall);
    else if (time < CUT.flee) cutTear(g, art, time - CUT.tear, CUT.flee - CUT.tear);
    else if (time < CUT.impact) cutFlee(g, art, time - CUT.flee, CUT.impact - CUT.flee);
    else if (time < CUT.after) cutImpact(g, art, time - CUT.impact);
    else cutAfter(g, art, time - CUT.after, SHADOW_PLAY_SECONDS - CUT.after);
    g.restore();
    finishFilm(g, art.grain, time, frame, [CUT.edge, CUT.hands, CUT.fall, CUT.flee, CUT.impact]);
    texture.needsUpdate = true;
  };

  return { mesh, material, texture, draw, prepare, canvas };
}
