// 안내판의 빛 외곽선. 지도·자물쇠·열쇠·로고를 그림으로 그린 뒤 경계를 따 닫힌 고리로 만든다.
// 모양마다 같은 칸에 같은 수의 점을 두면 점끼리 옮겨 가며 선이 끊기지 않고 다음 모양이 된다.

import * as THREE from "three";

import { DOKDO } from "./destinationData";
import { LOCK_ICON_PATH } from "./DestinationMap";
import { DOKDO_SIDE_OFFSET, KOREA_REGION_PATHS, mapX, mapY } from "./koreaMapGeometry";

const LOGO_FONT = "'Bebas Neue'";
/** 경계를 따는 해상도(그림 한 변 px) */
const TRACE_SIZE = 460;
/** 그릴 선분 총수. 많을수록 곡선이 매끈하다. */
const TOTAL_POINTS = 3600;
/** 이보다 짧은 고리(자잘한 섬·따낸 잡티)는 버린다(px) */
const MIN_LOOP_LENGTH = 16;
const MAX_LOOPS = 18;
const ALIGN_TRIES = 90;
/** 지도에서 땅이 있는 네모(지도 좌표). 이 안을 그림 한 장에 꽉 채운다. */
const MAP_BOX = { x: 110, y: 108, size: 580 };

type DrawShape = (g: CanvasRenderingContext2D, size: number) => void;

const drawMap: DrawShape = (g, size) => {
  const scale = size / MAP_BOX.size;
  g.scale(scale, scale);
  g.translate(-MAP_BOX.x, -MAP_BOX.y);
  // 안쪽 시도 경계가 사라지도록 면과 선을 같은 색으로 덮어 외곽만 남긴다.
  g.lineWidth = 2;
  g.lineJoin = "round";
  for (const { path } of KOREA_REGION_PATHS) {
    const region = new Path2D(path);
    g.fill(region);
    g.stroke(region);
  }
  g.beginPath();
  g.arc(mapX(DOKDO.lon) + DOKDO_SIDE_OFFSET, mapY(DOKDO.lat), 5, 0, Math.PI * 2);
  g.fill();
};

const drawLock: DrawShape = (g, size) => {
  const scale = size / 24;
  g.scale(scale, scale);
  g.fill(new Path2D(LOCK_ICON_PATH), "evenodd");
};

const drawKey: DrawShape = (g, size) => {
  // 칸 끝에 닿으면 윤곽이 닫히지 않아 넉넉히 안쪽에 그린다.
  const unit = size / 100;
  g.scale(unit, unit);
  g.translate(50, 50);
  g.rotate(Math.PI / 4);
  g.beginPath();
  g.arc(-36, 0, 21, 0, Math.PI * 2);
  g.moveTo(-26, 0);
  g.arc(-36, 0, 10, 0, Math.PI * 2, true);
  g.fill();
  g.fillRect(-17, -5, 66, 10);
  g.fillRect(24, 0, 9, 19);
  g.fillRect(40, 0, 9, 14);
};

const drawLogo: DrawShape = (g, size) => {
  g.textAlign = "center";
  g.textBaseline = "middle";
  // 글꼴이 대체되면 폭이 달라지므로 재서 맞춘다.
  g.font = `100px ${LOGO_FONT}, sans-serif`;
  const fontSize = (100 * size * 0.86) / g.measureText("LATENT").width;
  g.font = `${fontSize}px ${LOGO_FONT}, sans-serif`;
  g.fillText("LATENT", size / 2, size / 2 - fontSize * 0.52);
  g.fillText("SPACE", size / 2, size / 2 + fontSize * 0.52);
};

const SHAPES: readonly DrawShape[] = [drawMap, drawLock, drawKey, drawLogo];
export const OUTLINE_SHAPE_COUNT = SHAPES.length;

/** 점 [x, y] 를 차례로 이은 닫힌 고리 */
type Point = readonly [number, number];
type Loop = readonly Point[];
type Segment = readonly [Point, Point];

// 네 귀퉁이 안/밖 조합별로 어느 변과 어느 변을 잇는가. 변 번호: 0 위, 1 오른쪽, 2 아래, 3 왼쪽.
const MARCHING_EDGES: readonly (readonly number[])[] = [
  [],
  [3, 2],
  [2, 1],
  [3, 1],
  [0, 1],
  [3, 0, 2, 1],
  [0, 2],
  [3, 0],
  [3, 0],
  [0, 2],
  [3, 2, 0, 1],
  [0, 1],
  [3, 1],
  [2, 1],
  [3, 2],
  [],
];

/** 투명도 경계를 선분으로 딴다(마칭 스퀘어). 사이값으로 보간해 계단이 지지 않는다. */
function traceEdges(alpha: Uint8ClampedArray, size: number): Segment[] {
  const at = (x: number, y: number) => alpha[(y * size + x) * 4 + 3] / 255;
  const cross = (a: number, b: number) => (a === b ? 0.5 : (0.5 - a) / (b - a));
  const segments: Segment[] = [];
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const tl = at(x, y),
        tr = at(x + 1, y),
        br = at(x + 1, y + 1),
        bl = at(x, y + 1);
      const kind = (tl > 0.5 ? 8 : 0) | (tr > 0.5 ? 4 : 0) | (br > 0.5 ? 2 : 0) | (bl > 0.5 ? 1 : 0);
      const edges = MARCHING_EDGES[kind];
      const point = (edge: number): Point => {
        if (edge === 0) return [x + cross(tl, tr), y];
        if (edge === 1) return [x + 1, y + cross(tr, br)];
        if (edge === 2) return [x + cross(bl, br), y + 1];
        return [x, y + cross(tl, bl)];
      };
      for (let i = 0; i < edges.length; i += 2) segments.push([point(edges[i]), point(edges[i + 1])]);
    }
  }
  return segments;
}

const pointKey = ([x, y]: Point) => `${x.toFixed(3)},${y.toFixed(3)}`;

/** 흩어진 선분을 끝점끼리 이어 닫힌 고리로 묶는다. 이웃 칸은 같은 값으로 교점을 구해 끝점이 정확히 만난다. */
function joinIntoLoops(segments: readonly Segment[]): Loop[] {
  const touching = new Map<string, number[]>();
  segments.forEach(([a, b], index) => {
    for (const point of [a, b]) {
      const key = pointKey(point);
      const list = touching.get(key);
      if (list) list.push(index);
      else touching.set(key, [index]);
    }
  });
  const isUsed = new Uint8Array(segments.length);
  const loops: Loop[] = [];
  segments.forEach(([first, second], startIndex) => {
    if (isUsed[startIndex]) return;
    isUsed[startIndex] = 1;
    const loop: Point[] = [first];
    let head = second;
    for (;;) {
      loop.push(head);
      const next = touching.get(pointKey(head))?.find((index) => !isUsed[index]);
      if (next === undefined) break;
      isUsed[next] = 1;
      const [a, b] = segments[next];
      head = pointKey(a) === pointKey(head) ? b : a;
    }
    loops.push(loop);
  });
  return loops;
}

function loopLength(loop: Loop) {
  let length = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, y0] = loop[i],
      [x1, y1] = loop[(i + 1) % loop.length];
    length += Math.hypot(x1 - x0, y1 - y0);
  }
  return length;
}

/** 감는 방향을 맞춘다. 반대면 옮겨 가는 동안 선이 꼬인다. */
function withSameWinding(loop: Loop): Loop {
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, y0] = loop[i],
      [x1, y1] = loop[(i + 1) % loop.length];
    area += x0 * y1 - x1 * y0;
  }
  return area < 0 ? [...loop].reverse() : loop;
}

/** 그림 한 장을 -1~1 평면의 고리들로 바꾼다. 긴 고리가 앞에 온다. */
function shapeToLoops(draw: DrawShape): Loop[] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TRACE_SIZE;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return [];
  g.fillStyle = g.strokeStyle = "#ffffff";
  draw(g, TRACE_SIZE);
  const toPlane = (value: number) => (value / TRACE_SIZE) * 2 - 1;
  return joinIntoLoops(traceEdges(g.getImageData(0, 0, TRACE_SIZE, TRACE_SIZE).data, TRACE_SIZE))
    .filter((loop) => loopLength(loop) >= MIN_LOOP_LENGTH)
    .sort((a, b) => loopLength(b) - loopLength(a))
    .slice(0, MAX_LOOPS)
    .map((loop) => withSameWinding(loop.map(([x, y]): Point => [toPlane(x), -toPlane(y)])));
}

/** 고리 둘레를 같은 간격의 점 count 개로 다시 찍는다. */
function resample(loop: Loop, count: number): Point[] {
  const step = loopLength(loop) / count;
  const points: Point[] = [];
  let walked = 0;
  for (let i = 0; i < loop.length && points.length < count; i++) {
    const [x0, y0] = loop[i],
      [x1, y1] = loop[(i + 1) % loop.length];
    const length = Math.hypot(x1 - x0, y1 - y0);
    while (walked <= length && points.length < count) {
      const t = length > 0 ? walked / length : 0;
      points.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      walked += step;
    }
    walked -= length;
  }
  while (points.length < count) points.push(points[points.length - 1]);
  return points;
}

/** 시작점을 돌려 앞 모양과 가장 가깝게 맞춘다. 안 맞추면 고리가 비틀리며 넘어간다. */
function alignTo(reference: readonly Point[], points: readonly Point[]): Point[] {
  const count = points.length;
  const sampleStep = Math.max(1, Math.floor(count / 48));
  let bestOffset = 0;
  let bestCost = Infinity;
  for (let attempt = 0; attempt < ALIGN_TRIES; attempt++) {
    const offset = Math.floor((attempt / ALIGN_TRIES) * count);
    let cost = 0;
    for (let i = 0; i < count; i += sampleStep) {
      const [x0, y0] = reference[i],
        [x1, y1] = points[(i + offset) % count];
      cost += (x1 - x0) ** 2 + (y1 - y0) ** 2;
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestOffset = offset;
    }
  }
  return points.map((_, i) => points[(i + bestOffset) % count]);
}

/** 모양 네 개를 담은 지오메트리. 어느 모양을 보여 줄지는 셰이더가 고른다. */
export async function buildOutlineGeometry(): Promise<THREE.BufferGeometry> {
  // 글꼴이 늦게 오면 로고만 기본 글꼴로 따인다. 못 받아도 멈추지 않는다.
  await document.fonts.load(`100px ${LOGO_FONT}`, "LATENT").catch(() => undefined);

  const shapes = SHAPES.map(shapeToLoops);
  const slotCount = Math.max(...shapes.map((loops) => loops.length));
  // 칸마다 그 칸을 가장 길게 쓰는 모양 기준으로 점을 나눠 준다.
  const slotLengths = Array.from({ length: slotCount }, (_, slot) =>
    Math.max(...shapes.map((loops) => (loops[slot] ? loopLength(loops[slot]) : 0))),
  );
  const lengthSum = slotLengths.reduce((sum, length) => sum + length, 0);
  const slotPoints = slotLengths.map((length) => Math.max(6, Math.round((length / lengthSum) * TOTAL_POINTS)));
  const count = slotPoints.reduce((sum, points) => sum + points, 0);
  const vertexCount = count * 4;

  const geometry = new THREE.BufferGeometry();
  let previous: Point[][] | null = null;
  shapes.forEach((loops, shapeIndex) => {
    const data = new Float32Array(vertexCount * 4);
    const main = loops[0];
    const current = slotPoints.map((points, slot) => {
      const loop = loops[slot];
      if (loop) {
        const sampled = resample(loop, points);
        return previous ? alignTo(previous[slot], sampled) : sampled;
      }
      // 이 모양에 없는 칸은 큰 고리 위 한 점으로 접어 둔다. 다음 모양에서 거기서 자라난다.
      const anchor = main[Math.floor((slot / slotCount) * main.length)];
      return Array.from({ length: points }, () => anchor);
    });
    let segment = 0;
    for (const points of current) {
      points.forEach((point, i) => {
        const next = points[(i + 1) % points.length];
        for (let corner = 0; corner < 4; corner++) data.set([...point, ...next], (segment * 4 + corner) * 4);
        segment++;
      });
    }
    geometry.setAttribute(`aShape${shapeIndex}`, new THREE.BufferAttribute(data, 4));
    previous = current;
  });

  const corner = new Float32Array(vertexCount * 2);
  const index = new Uint32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const base = i * 4;
    corner.set([0, -1, 0, 1, 1, -1, 1, 1], base * 2);
    index.set([base, base + 2, base + 1, base + 1, base + 2, base + 3], i * 6);
  }
  geometry.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
  // 자리는 셰이더가 정하지만 three 는 position 이 있어야 그린다.
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

export const OUTLINE_VERTEX_SHADER = /* glsl */ `
  attribute vec4 aShape0;
  attribute vec4 aShape1;
  attribute vec4 aShape2;
  attribute vec4 aShape3;
  attribute vec2 aCorner;
  uniform vec4 uFrom;
  uniform vec4 uTo;
  uniform float uMix;
  uniform float uWidth;
  varying float vY;

  vec4 pick(vec4 weight) {
    return aShape0 * weight.x + aShape1 * weight.y + aShape2 * weight.z + aShape3 * weight.w;
  }

  // 낮은 곳부터 바뀌어 빛이 아래에서 위로 훑는다. 끝점이 자기 높이로 계산해 이웃 선분과 어긋나지 않는다.
  float progressAt(float y) {
    float start = (y * 0.5 + 0.5) * 0.45;
    return smoothstep(start, start + 0.55, uMix);
  }

  void main() {
    vec4 from = pick(uFrom);
    vec4 to = pick(uTo);
    vec4 segment = vec4(
      mix(from.xy, to.xy, progressAt(from.y)),
      mix(from.zw, to.zw, progressAt(from.w))
    );

    vec2 along = segment.zw - segment.xy;
    vec2 direction = along / max(length(along), 0.00001);
    vec2 normal = vec2(-direction.y, direction.x);
    vec2 point = mix(segment.xy, segment.zw, aCorner.x);
    // 끝을 조금 늘려 선분 사이 틈을 메운다.
    point += normal * aCorner.y * uWidth + direction * (aCorner.x * 2.0 - 1.0) * uWidth;

    vY = point.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 0.0, 1.0);
  }
`;

export const OUTLINE_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uBandColor;
  varying float vY;

  void main() {
    // 흰 선을 타고 푸른 띠가 아래에서 위로 올라간다.
    float wave = fract(vY * 0.8 - uTime * 0.45);
    float band = smoothstep(0.55, 0.95, wave) * smoothstep(1.0, 0.95, wave);
    gl_FragColor = vec4(mix(vec3(1.0), uBandColor, band), uOpacity);
    #include <colorspace_fragment>
  }
`;
