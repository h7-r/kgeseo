// 비탈길 낭떠러지 쪽에 세우는 나무 울타리 — 장식이 아니라 길의 가장자리를 읽게 해 주는 장치다.
// 쪽을 박아 넣지 않는다. 점마다 양쪽 낙차를 재서 더 깊이 떨어지는 쪽에 세운다(도면이 바뀌어도 따라온다).
// 판정은 안 건드린다 — 「절벽에서 발을 헛디디면 떨어진다」가 이 공간의 규칙이라 붙잡으면 그 규칙이 죽는다.
// 단위는 도면 m. 표본은 1 짜리이고 유닛 변환은 createInstanceGroup 이 한다(여기서 곱하면 두 번 곱해진다).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { makeRandom } from "@/engine/random";

import type { Spot } from "../placement/instanceGroups";
import type { HeightAt } from "../terrain/ground";
import type { CenterlinePoint } from "../terrain/terrain";

// 비바람 맞은 참나무. 너무 붉으면 새 목재, 너무 회색이면 돌이 된다.
export const WOOD_STYLE = {
  light: "#8A7350",
  dark: "#4A3B28",
};

// 눈으로 맞출 값(§9 미결값 성격)
export const FENCE_DIMENSIONS = {
  postSpacing: 1.6, // m — 좁으면 담이 되고 넓으면 줄이 된다
  postHeight: 0.95,
  postThickness: 0.115,
  railHeights: [0.42, 0.8], // 기둥 밑동에서 잰 높이(m)
  railThickness: 0.075,
  railWidth: 0.05,
  outset: 0.35, // 길 가장자리에서 더 바깥으로 미는 거리(m)
  maxSlope: 35, // ° — 기둥 사이가 이보다 가파르면 끊는다
  burial: 0.12, // 땅에 박는 깊이(안 그러면 떠 보인다)
};

/** 중심선 점 — 자리와 옆 방향 법선만 본다 */
type LinePoint = Pick<CenterlinePoint, "x" | "z" | "nx" | "nz">;

interface FencePath {
  width: number;
  centerline: LinePoint[];
}

interface FenceOptions {
  measuredPaths: FencePath[];
  groundHeight: HeightAt;
  /** 이만큼(m) 넘게 떨어지는 쪽에만 세운다 */
  minDrop?: number;
  /** 낙차를 재는 거리(m) — 길 가장자리에서 바깥으로 */
  lookout?: number;
  seed?: number;
}

export interface FenceLayout {
  posts: Spot[];
  /** 가로대 — size 가 길이다 */
  rails: Spot[];
}

interface GroundPoint {
  x: number;
  y: number;
  z: number;
}

export function fenceSpots({
  measuredPaths,
  groundHeight,
  minDrop = 0.8,
  lookout = 1.5,
  seed = 771103,
}: FenceOptions): FenceLayout {
  const random = makeRandom(seed);
  const posts: Spot[] = [];
  const rails: Spot[] = [];
  const light = new THREE.Color(WOOD_STYLE.light);
  const dark = new THREE.Color(WOOD_STYLE.dark);
  const scratch = new THREE.Color();
  const woodColor = () =>
    scratch
      .copy(dark)
      .lerp(light, 0.35 + random() * 0.6)
      .getHex();

  for (const path of measuredPaths) {
    const halfWidth = path.width / 2;
    // 중심선을 0.4 m 로 훑어 점마다 어느 쪽이 낭떠러지인지 본다
    const dense = resample(path.centerline, 0.4);
    // 바깥선을 먼저 만들고 그 위에서 간격을 잡는다. 중심선 점을 바로 이으면
    // 스위치백 모서리에서 법선이 뒤집혀 가로대가 길을 가로질러 날아갔다.
    const runs: { side: number; points: { x: number; z: number }[] }[] = [];
    let current: (typeof runs)[number] | null = null;
    for (const p of dense) {
      const inside = groundHeight(p.x, p.z);
      const d = halfWidth + lookout;
      const left = groundHeight(p.x - p.nx * d, p.z - p.nz * d) - inside;
      const right = groundHeight(p.x + p.nx * d, p.z + p.nz * d) - inside;
      const side = right < left ? 1 : -1; // 더 깊이 떨어지는 쪽
      if (Math.min(left, right) > -minDrop) {
        current = null; // 여기는 안 떨어진다 — 구간을 끊는다
        continue;
      }
      const distance = halfWidth + FENCE_DIMENSIONS.outset;
      const outer = { x: p.x + p.nx * distance * side, z: p.z + p.nz * distance * side };
      // 모서리에서 바깥선 자체가 건너뛰면 거기서 끊는다 — 한 칸 벌어지는 편이 길 위로 널을 걸치는 것보다 낫다
      const previous = current?.points[current.points.length - 1];
      const hasJumped = previous && Math.hypot(outer.x - previous.x, outer.z - previous.z) > 0.8;
      if (!current || current.side !== side || hasJumped) {
        current = { side, points: [] };
        runs.push(current);
      }
      current.points.push(outer);
    }

    // 이웃한 기둥끼리만 가로대를 건다
    for (const run of runs) {
      const spots = resampleOnLine(run.points, FENCE_DIMENSIONS.postSpacing);
      if (spots.length < 2) continue; // 기둥 하나짜리는 울타리로 안 보인다
      const grounded = spots.map((q) => ({ ...q, y: groundHeight(q.x, q.z) }));
      // 기둥 사이가 너무 가파르면 끊는다. 진짜 울타리는 벼랑 끝까지 널을 끌고 내려가지 않는다.
      for (const pieceRun of splitAtSteep(grounded, FENCE_DIMENSIONS.maxSlope)) {
        if (pieceRun.length < 2) continue;
        for (const q of pieceRun) {
          // 손으로 박은 것처럼 조금씩 흔든다 — 자로 잰 듯하면 공장 울타리가 된다
          posts.push({
            x: q.x,
            y: q.y - FENCE_DIMENSIONS.burial,
            z: q.z,
            size: FENCE_DIMENSIONS.postHeight * (0.92 + random() * 0.16),
            rotation: (random() - 0.5) * 0.5,
            tilt: (random() - 0.5) * 0.07,
            tilt2: (random() - 0.5) * 0.07,
            widthRatio: FENCE_DIMENSIONS.postThickness / FENCE_DIMENSIONS.postHeight,
            depthRatio: FENCE_DIMENSIONS.postThickness / FENCE_DIMENSIONS.postHeight,
            color: woodColor(),
          });
        }
        for (let i = 0; i < pieceRun.length - 1; i++) {
          const a = pieceRun[i];
          const b = pieceRun[i + 1];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const flat = Math.hypot(dx, dz);
          if (flat < 0.05) continue;
          for (const h of FENCE_DIMENSIONS.railHeights) {
            const ay = a.y + h;
            const by = b.y + h;
            const length = Math.hypot(flat, by - ay);
            rails.push({
              x: (a.x + b.x) / 2,
              y: (ay + by) / 2,
              z: (a.z + b.z) / 2,
              size: length * 1.04, // 기둥 속으로 조금 물려 이음매가 안 벌어지게
              // 막대는 국소 +Z 로 누워 있다. YXZ 순서라 방위(Y)를 먼저 돌리고 그 방위에서 기울인다(X).
              rotation: Math.atan2(dx, dz),
              tilt: -Math.atan2(by - ay, flat),
              tilt2: 0,
              // 길이 축은 depthRatio(Z) 다. heightRatio 를 안 주면 기본 1 이라 키가 길이만큼 커진다.
              widthRatio: FENCE_DIMENSIONS.railWidth / (length * 1.04),
              heightRatio: FENCE_DIMENSIONS.railThickness / (length * 1.04),
              depthRatio: 1,
              color: woodColor(),
            });
          }
        }
      }
    }
  }
  return { posts, rails };
}

// 기둥 줄을 너무 가파른 이음매에서 잘라 여러 조각으로 돌려준다
function splitAtSteep(points: GroundPoint[], maxAngle: number): GroundPoint[][] {
  const limit = Math.tan((maxAngle * Math.PI) / 180);
  const runs: GroundPoint[][] = [];
  let current: GroundPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const a = points[i - 1];
      const b = points[i];
      const flat = Math.hypot(b.x - a.x, b.z - a.z);
      if (flat > 1e-6 && Math.abs(b.y - a.y) / flat > limit) {
        runs.push(current);
        current = [];
      }
    }
    current.push(points[i]);
  }
  runs.push(current);
  return runs;
}

// 바깥선 위에서 일정 간격으로 점을 다시 뽑는다. 끝점은 반드시 넣어야 구간 끝에서 어정쩡하게 안 끊긴다.
function resampleOnLine(points: { x: number; z: number }[], spacing: number): { x: number; z: number }[] {
  if (points.length < 2) return points.slice();
  const result = [points[0]];
  let carried = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 1e-9) continue;
    let remaining = spacing - carried;
    let t = 0;
    while (remaining <= L - t) {
      t += remaining;
      result.push({ x: a.x + ((b.x - a.x) * t) / L, z: a.z + ((b.z - a.z) * t) / L });
      remaining = spacing;
      carried = 0;
    }
    carried += L - t;
  }
  const end = points[points.length - 1];
  const last = result[result.length - 1];
  // 끝이 바로 옆이면 겹치니 넣지 않는다
  if (Math.hypot(end.x - last.x, end.z - last.z) > spacing * 0.35) result.push(end);
  return result;
}

// 선을 따라 일정 간격으로 점을 다시 뽑는다. 법선도 같이 옮긴다.
function resample(line: LinePoint[], spacing: number): LinePoint[] {
  const result: LinePoint[] = [];
  let leftover = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 1e-6) continue;
    let t = leftover;
    while (t <= L) {
      const k = t / L;
      result.push({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, nx: a.nx, nz: a.nz });
      t += spacing;
    }
    leftover = t - L;
  }
  return result;
}

// 무리(InstancedMesh)로 세워야 길 위에 어긋나게 선 기둥 하나를 집어 치울 수 있다

/** 각진 기둥 — 밑동 원점, 높이 1, 가로세로 1. 곧은 각기둥은 플라스틱처럼 보여 위로 살짝 가늘게. */
export function postPrototypes(count = 4, seed = 3301): THREE.BufferGeometry[] {
  const random = makeRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const geometry = new THREE.CylinderGeometry(0.38, 0.5, 1, 5, 1);
    // 위쪽을 도끼로 친 것처럼 꼭짓점을 조금 흔든다
    const p = geometry.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const isTop = p.getY(k) > 0;
      p.setX(k, p.getX(k) * (1 + (random() - 0.5) * 0.12));
      p.setZ(k, p.getZ(k) * (1 + (random() - 0.5) * 0.12));
      if (isTop) p.setY(k, p.getY(k) + (random() - 0.5) * 0.06);
    }
    geometry.translate(0, 0.5, 0);
    geometry.computeVertexNormals();
    prototypes.push(geometry.toNonIndexed());
    geometry.dispose();
  }
  return prototypes;
}

/** 가로대 — 국소 +Z 로 누운 길이 1 짜리 각재. 원점이 한가운데. */
export function railPrototypes(count = 3, seed = 5507): THREE.BufferGeometry[] {
  const random = makeRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const geometry = new THREE.BoxGeometry(1, 1, 1, 1, 1, 3);
    const p = geometry.attributes.position;
    for (let k = 0; k < p.count; k++) {
      // 길이 방향(Z)은 안 건드린다 — 건드리면 이음매가 벌어진다
      p.setX(k, p.getX(k) * (1 + (random() - 0.5) * 0.18));
      p.setY(k, p.getY(k) * (1 + (random() - 0.5) * 0.18));
    }
    geometry.computeVertexNormals();
    prototypes.push(geometry.toNonIndexed());
    geometry.dispose();
  }
  return prototypes;
}

/** 팔레트용 「울타리 한 칸」 — 기둥 둘 + 가로대 둘. 밑동 원점, 높이 1. */
export function fenceSectionPrototypes(count = 3, seed = 9109): THREE.BufferGeometry[] {
  const random = makeRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  const posts = postPrototypes(count, seed + 1);
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const span = 1.7; // 높이 1 기준 칸 너비
    for (const s of [-0.5, 0.5]) {
      const post = posts[i].clone();
      post.scale(0.12, 1, 0.12);
      post.translate(0, 0, s * span);
      pieces.push(post);
    }
    for (const h of [0.44, 0.82]) {
      const rail = new THREE.BoxGeometry(0.055, 0.08, span + 0.12);
      rail.translate(0, h * (0.95 + random() * 0.1), 0);
      pieces.push(rail.toNonIndexed());
      rail.dispose();
    }
    const merged = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    merged.computeVertexNormals();
    prototypes.push(merged);
  }
  posts.forEach((g) => g.dispose());
  return prototypes;
}
