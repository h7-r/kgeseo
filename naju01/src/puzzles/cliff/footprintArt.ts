/**
 * 발자국 — 그림(짚신 자국 · 작은 신 자국 · 달리는 앞꿈치 · 미끄러진 자국)과, 길을 따라 땅에 찍는 판.
 * 한 무리의 발자국은 판 하나로 묶고, 찍힌 차례(aOrder 0~1)대로 드러난다 — 물이 번지며 하나씩 보인다.
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import * as THREE from "three";

import { createRandom } from "@/engine/random";

import { M } from "../units";
import { floorAt } from "./riteScene";

type Point = readonly [number, number];
/** 그림 칸 — 짚신(사내) · 작은 신(여인) · 달리는 앞꿈치 · 미끄러진 자국 */
type PrintTile = "sandal" | "small" | "toe" | "skid";
const TILES: PrintTile[] = ["sandal", "small", "toe", "skid"];
const TILE_SIZE = { width: 128, height: 256 };

/** 발자국 크기(미터) — 길이 · 너비 */
export const PRINT_SIZE = {
  arang: { length: 0.28, width: 0.118 },
  man: { length: 0.27, width: 0.122 },
  woman: { length: 0.215, width: 0.086 },
} as const;

// 그림판은 두 채널로 그린다 — 빨강은 눌린 자리(깊을수록 짙다), 초록은 달빛을 받는 테두리와 결.
const PRESS = (alpha: number) => `rgba(255,0,0,${alpha})`;
const RIM = (alpha: number) => `rgba(0,255,0,${alpha})`;

/**
 * 신 바닥 — 앞꿈치가 넓고 발허리가 안쪽으로 잘록하며 뒤꿈치가 둥글다(오른발 기준, 왼발은 뒤집어 찍는다). 위(−y)가 앞.
 * 짚신이라 삼은 결이 가로줄로 남는다. narrow 가 작으면 볼이 좁은 작은 신이다.
 */
function drawSole(g: CanvasRenderingContext2D, w: number, h: number, narrow: number) {
  const cx = w * 0.5;
  // 앞코와 뒤꿈치가 둥글게 닫힌다 — t 0 앞코 ~ 1 뒤꿈치
  const cap = (t: number) =>
    Math.sqrt(Math.max(0, 1 - (1 - Math.min(1, t / 0.2)) ** 2)) *
    Math.sqrt(Math.max(0, 1 - (Math.max(0, t - 0.8) / 0.2) ** 2));
  // 발 바깥(오른쪽) · 안쪽(왼쪽) 가장자리 — 바깥은 볼에서 뒤꿈치로 조금씩 좁아지고, 안쪽은 발허리가 잘록하다
  const outer = (t: number) => w * narrow * 0.31 * cap(t) * (1 - 0.3 * t * t);
  const inner = (t: number) =>
    w * narrow * cap(t) * (0.27 * (1 - 0.25 * t) - 0.11 * Math.exp(-(((t - 0.56) / 0.17) ** 2)));
  const yAt = (t: number) => h * (0.05 + 0.9 * t);
  const sole = new Path2D();
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (i === 0) sole.moveTo(cx + outer(t), yAt(t));
    else sole.lineTo(cx + outer(t), yAt(t));
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    sole.lineTo(cx - inner(t), yAt(t));
  }
  sole.closePath();
  g.fillStyle = PRESS(0.55);
  g.fill(sole);
  g.save();
  g.clip(sole);
  // 앞꿈치와 뒤꿈치가 더 깊이 눌렸다
  for (const [y, r] of [
    [0.27, 0.3],
    [0.84, 0.2],
  ]) {
    const press = g.createRadialGradient(cx, h * y, 0, cx, h * y, w * r * 1.5);
    press.addColorStop(0, PRESS(0.9));
    press.addColorStop(1, PRESS(0));
    g.fillStyle = press;
    g.fillRect(0, 0, w, h);
  }
  // 삼은 결 — 가로로 얕게
  g.strokeStyle = RIM(0.35);
  g.lineWidth = h * 0.008;
  for (let k = 0; k < 12; k++) {
    const y = h * (0.12 + k * 0.066);
    g.beginPath();
    g.moveTo(0, y);
    g.quadraticCurveTo(cx, y + h * 0.012, w, y);
    g.stroke();
  }
  g.restore();
  // 테두리 — 눌려 솟은 흙이 달빛을 받는다
  g.strokeStyle = RIM(0.95);
  g.lineWidth = w * 0.035;
  g.stroke(sole);
}

/** 달리는 발 — 앞꿈치만 깊이 박히고 뒤로 흙이 밀렸다 */
function drawToe(g: CanvasRenderingContext2D, w: number, h: number) {
  const cx = w / 2;
  g.fillStyle = PRESS(0.95);
  g.beginPath();
  g.ellipse(cx, h * 0.3, w * 0.3, h * 0.17, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = RIM(0.95);
  g.lineWidth = w * 0.04;
  g.beginPath();
  g.ellipse(cx, h * 0.3, w * 0.3, h * 0.17, 0, Math.PI * 0.95, Math.PI * 2.05);
  g.stroke();
  // 뒤로 밀린 흙 — 가늘게 번진다
  const smear = g.createLinearGradient(0, h * 0.42, 0, h * 0.86);
  smear.addColorStop(0, PRESS(0.5));
  smear.addColorStop(1, PRESS(0));
  g.fillStyle = smear;
  g.beginPath();
  g.moveTo(cx - w * 0.24, h * 0.4);
  g.lineTo(cx + w * 0.24, h * 0.4);
  g.lineTo(cx + w * 0.08, h * 0.86);
  g.lineTo(cx - w * 0.08, h * 0.86);
  g.closePath();
  g.fill();
}

/** 미끄러진 자국 — 뒤꿈치가 길게 끌리며 흙을 갈랐다. 위(−y)가 벼랑 밖 */
function drawSkid(g: CanvasRenderingContext2D, w: number, h: number) {
  const random = createRandom(9107);
  const body = g.createLinearGradient(0, h, 0, 0);
  body.addColorStop(0, PRESS(0.95));
  body.addColorStop(0.8, PRESS(0.6));
  body.addColorStop(1, PRESS(0));
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(w * 0.34, h * 0.98);
  g.quadraticCurveTo(w * 0.26, h * 0.5, w * 0.4, h * 0.02);
  g.lineTo(w * 0.62, h * 0.02);
  g.quadraticCurveTo(w * 0.76, h * 0.5, w * 0.66, h * 0.98);
  g.closePath();
  g.fill();
  // 끌린 결 — 달빛이 줄줄이 걸린다
  for (let k = 0; k < 9; k++) {
    g.strokeStyle = RIM(0.5 + random() * 0.45);
    g.lineWidth = 1 + random() * 2.5;
    const x = w * (0.34 + random() * 0.32);
    g.beginPath();
    g.moveTo(x, h * (0.95 - random() * 0.2));
    g.lineTo(x + (random() - 0.5) * w * 0.08, h * (0.05 + random() * 0.3));
    g.stroke();
  }
}

let atlas: THREE.CanvasTexture | null = null;
/** 발자국 그림판 — 칸 넷이 가로로 나란하다. 검은 바탕에 두 채널을 더해 그린다 */
function getPrintAtlas() {
  if (atlas) return atlas;
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE.width * TILES.length;
  canvas.height = TILE_SIZE.height;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.globalCompositeOperation = "lighter";
  TILES.forEach((tile, index) => {
    g.save();
    g.translate(index * TILE_SIZE.width, 0);
    g.beginPath();
    g.rect(0, 0, TILE_SIZE.width, TILE_SIZE.height);
    g.clip();
    if (tile === "sandal") drawSole(g, TILE_SIZE.width, TILE_SIZE.height, 1);
    else if (tile === "small") drawSole(g, TILE_SIZE.width, TILE_SIZE.height, 0.86);
    else if (tile === "toe") drawToe(g, TILE_SIZE.width, TILE_SIZE.height);
    else drawSkid(g, TILE_SIZE.width, TILE_SIZE.height);
    g.restore();
  });
  atlas = new THREE.CanvasTexture(canvas);
  atlas.anisotropy = 4;
  return atlas;
}

export interface Print {
  x: number;
  z: number;
  /** 발끝이 보는 쪽(라디안, +z 에서 +x 쪽으로) */
  heading: number;
  length: number;
  width: number;
  tile: PrintTile;
  /** 왼발이면 그림을 뒤집는다 */
  isLeft: boolean;
}

/**
 * 길을 따라 걸은 발자국 — 보폭(stride)마다 왼발 · 오른발을 번갈아, 길 가운데에서 gait 만큼 벌려 찍는다.
 * from 은 첫 발까지의 거리. 끝점까지 남은 거리가 보폭보다 짧으면 거기서 멈춘다.
 */
export function walkAlong(
  path: readonly Point[],
  size: { length: number; width: number },
  { stride, gait, tile, from = stride / 2 }: { stride: number; gait: number; tile: PrintTile; from?: number },
): Print[] {
  const prints: Print[] = [];
  let walked = -from;
  let isLeft = true;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const span = Math.hypot(bx - ax, bz - az);
    const heading = Math.atan2(bx - ax, bz - az);
    while (walked + stride <= span) {
      walked += stride;
      const t = Math.max(0, walked) / span;
      const side = isLeft ? -1 : 1;
      prints.push({
        x: ax + (bx - ax) * t + Math.cos(heading) * gait * side,
        z: az + (bz - az) * t - Math.sin(heading) * gait * side,
        // 발끝이 바깥으로 살짝 벌어진다
        heading: heading + side * 0.09,
        ...size,
        tile,
        isLeft,
      });
      isLeft = !isLeft;
    }
    walked -= span;
  }
  return prints;
}

/** 멈춰 선 두 발 — 나란히, facing 쪽을 본다 */
export function standAt(at: Point, facing: number, size: { length: number; width: number }, tile: PrintTile): Print[] {
  return [-1, 1].map((side) => ({
    x: at[0] + Math.cos(facing) * 0.1 * side,
    z: at[1] - Math.sin(facing) * 0.1 * side,
    heading: facing + side * 0.12,
    ...size,
    tile,
    isLeft: side < 0,
  }));
}

/** 발자국 무리를 판 하나로 — 찍힌 차례가 aOrder(0~1)로 들어간다 */
export function buildPrints(prints: Print[]) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const orders: number[] = [];
  const indices: number[] = [];
  prints.forEach((print, k) => {
    const forwardX = Math.sin(print.heading);
    const forwardZ = Math.cos(print.heading);
    const rightX = Math.cos(print.heading);
    const rightZ = -Math.sin(print.heading);
    const tile = TILES.indexOf(print.tile);
    const base = k * 4;
    // 모서리 — 뒤왼 · 뒤오른 · 앞왼 · 앞오른
    for (const [along, across] of [
      [-0.5, -0.5],
      [-0.5, 0.5],
      [0.5, -0.5],
      [0.5, 0.5],
    ]) {
      const x = print.x + forwardX * along * print.length + rightX * across * print.width;
      const z = print.z + forwardZ * along * print.length + rightZ * across * print.width;
      positions.push(x * M, (floorAt(x, z) + 0.016) * M, z * M);
      const u = print.isLeft ? 0.5 - across : 0.5 + across;
      uvs.push((tile + u) / TILES.length, along + 0.5);
      orders.push(prints.length > 1 ? k / (prints.length - 1) : 0);
    }
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("aOrder", new THREE.Float32BufferAttribute(orders, 1));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * 발자국 재질 — uReveal 이 차례를 지나가면 그 발자국이 드러난다(0 아무것도 · 1 전부).
 * uWet 0 이면 마른 흙에 희끗하게 남은 자국, 1 이면 젖은 흙에 눌린 자리에 달빛이 고인다.
 */
export function makePrintsMaterial(wet: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: getPrintAtlas() },
      uReveal: { value: 0 },
      uWet: { value: wet },
      uFlash: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aOrder;
      varying vec2 vUv;
      varying float vOrder;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vUv = uv;
        vOrder = aOrder;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uReveal;
      uniform float uWet;
      uniform float uFlash;
      uniform float uTime;
      varying vec2 vUv;
      varying float vOrder;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec4 print = texture2D(uMap, vUv);
        float press = print.r;
        float rim = print.g;
        // 차례가 오면 스르르 드러난다 — 맨 끝 발자국도 다 드러나게 조금 넘겨 잡는다
        float shown = smoothstep(vOrder * 0.92, vOrder * 0.92 + 0.08, uReveal);
        // 마른 흙 — 눌린 자리에 먼지가 희끗하게 앉았다
        vec3 dry = vec3(0.6, 0.62, 0.66);
        float dryAlpha = press * 0.42 + rim * 0.38;
        // 젖은 흙 — 눌린 자리는 물을 머금어 어둡고, 솟은 테두리와 결에만 달빛이 걸린다
        float glint = 0.75 + 0.25 * sin(uTime * 1.7 + vOrder * 31.0);
        float edge = clamp(rim * 1.15, 0.0, 1.0);
        vec3 wet = mix(vec3(0.02, 0.028, 0.045), vec3(0.6, 0.72, 0.98) * glint * (1.0 + uFlash), edge);
        float wetAlpha = max(press * 0.62, edge * 0.8);
        vec3 color = mix(dry, wet, uWet);
        float alpha = shown * mix(dryAlpha, wetAlpha, uWet);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(color, min(1.0, alpha));
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -5,
    polygonOffsetUnits: -5,
    toneMapped: false,
  });
}

/**
 * 물을 끼얹은 흙 — 길을 따라 철썩철썩 떨어진 물 자국. 덩어리 여럿이 차례로 떨어져 번지고(uReveal 0~1),
 * 사이로 가는 물줄기가 잇고, 둘레에 잔물이 튄다. 가장자리는 들쭉날쭉하다.
 * length 길 길이 · halfWidth 판 반너비(미터) · seed 토막마다 다른 모양
 */
export function makeWetGroundMaterial(length: number, halfWidth: number, seed: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uReveal: { value: 0 },
      uLength: { value: length },
      uHalf: { value: halfWidth },
      uSeed: { value: seed },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uReveal;
      uniform float uLength;
      uniform float uHalf;
      uniform float uSeed;
      varying vec2 vUv;
      #include <logdepthbuf_pars_fragment>
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        #include <logdepthbuf_fragment>
        // 미터 — 길을 따라, 길을 가로질러
        vec2 p = vec2(vUv.x * uLength, (vUv.y - 0.5) * 2.0 * uHalf);
        // 가장자리가 고르지 않게 — 굵은 결 · 잔 결 두 겹으로 모양을 비튼다
        vec2 w = p + (vec2(noise(p * 7.0 + uSeed), noise(p * 7.0 + uSeed + 31.7)) - 0.5) * 0.18
                   + (vec2(noise(p * 21.0 + uSeed), noise(p * 21.0 + 9.0)) - 0.5) * 0.05;
        float thrown = uReveal * 1.12;
        // 끼얹은 물 — 던진 쪽을 따라 차례로 떨어져 번진다
        float wet = 0.0;
        for (int i = 0; i < 6; i++) {
          float fi = float(i);
          float h1 = hash(vec2(fi, uSeed));
          float h2 = hash(vec2(fi + 7.0, uSeed));
          float h3 = hash(vec2(fi + 13.0, uSeed));
          float at = (fi + 0.3 + 0.5 * h1) / 6.0;
          vec2 center = vec2(at * uLength, (h2 - 0.5) * uHalf * 0.75);
          vec2 radius = vec2(0.28 + 0.24 * h3, 0.15 + 0.17 * h1);
          float landed = smoothstep(at - 0.04, at + 0.1, thrown);
          vec2 d = (w - center) / (radius * (0.45 + 0.55 * landed));
          wet = max(wet, (1.0 - dot(d, d)) * step(0.001, landed));
        }
        float reached = 1.0 - smoothstep(thrown - 0.05, thrown, vUv.x);
        // 떨어진 자리 사이를 잇는 가는 물줄기
        float line = 1.0 - abs(w.y - 0.09 * sin(p.x * 2.3 + uSeed)) / 0.06;
        wet = max(wet, line * 0.55 * reached);
        float body = smoothstep(0.0, 0.3, wet);
        // 둘레로 튄 잔 물방울
        vec2 cell = floor(p / 0.11);
        vec2 inCell = fract(p / 0.11) - 0.5;
        float pick = hash(cell + uSeed);
        vec2 shift = (vec2(hash(cell + 3.1), hash(cell + 8.7)) - 0.5) * 0.6;
        float size = 0.08 + 0.2 * hash(cell + 5.3);
        float drop = smoothstep(size, size * 0.55, length(inCell - shift)) * step(0.6, pick) * reached;
        drop *= smoothstep(uHalf, uHalf * 0.7, abs(p.y));
        float ends = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.97, vUv.x);
        // 젖은 흙은 더 어둡고, 달빛이 옅게 돈다
        float sheen = noise(p * 5.0 + uSeed);
        float alpha = max(body, drop * 0.85) * ends * 0.46;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(mix(vec3(0.02, 0.028, 0.045), vec3(0.17, 0.23, 0.36), sheen * 0.3 * body), alpha);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    toneMapped: false,
  });
}
