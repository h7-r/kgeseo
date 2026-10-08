// 초가집 마당을 두르는 싸리울. 마을은 집이 아니라 마당과 울이 만든다.
// fences 는 길을 따라가는 울타리라 규칙이 다르다. 표본과 치수만 같이 쓴다 — 같은 목수가 세운 것처럼.
// 마당 반쪽 = min(집 폭 × 0.85, 이웃까지 × 0.45). 이웃도 제 몫을 가져가 합쳐도 0.9 라 절대 안 닿는다.
// 사방을 두르면 상자로 보여, 마을 한복판을 향한 한 면을 비운다(사립문 쪽).

import * as THREE from "three";

import { makeRandom } from "@/engine/random";

import type { Spot } from "../placement/instanceGroups";
import type { HeightAt } from "../terrain/ground";
import { FENCE_DIMENSIONS, WOOD_STYLE, type FenceLayout } from "./fences";

interface Point {
  x: number;
  z: number;
}

// 가운데를 두르는 네모에서 열린쪽(라디안, +Z 기준)에 가장 가까운 변을 뺀 ㄷ 자 선
function yardOutline(center: Point, half: Point, openDirection: number, rotation: number): Point[] {
  // 집이 비스듬하면 마당도 비스듬하다
  const corners = [
    [-half.x, -half.z],
    [half.x, -half.z],
    [half.x, half.z],
    [-half.x, half.z],
  ].map(([a, c]) => ({
    x: center.x + a * Math.cos(rotation) + c * Math.sin(rotation),
    z: center.z - a * Math.sin(rotation) + c * Math.cos(rotation),
  }));
  const edges = [0, 1, 2, 3].map((i) => {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const mx = (a.x + b.x) / 2 - center.x;
    const mz = (a.z + b.z) / 2 - center.z;
    return { a, b, angle: Math.atan2(mx, mz) };
  });
  const angleGap = (u: number, v: number) => Math.abs(((u - v + Math.PI) % (Math.PI * 2)) - Math.PI);
  let removed = 0;
  for (let i = 1; i < 4; i++)
    if (angleGap(edges[i].angle, openDirection) < angleGap(edges[removed].angle, openDirection)) removed = i;
  // ㄷ 자가 이어지도록 뺀 변 다음부터 돌린다
  const start = (removed + 1) % 4;
  const line: Point[] = [];
  for (let k = 0; k < 4; k++) {
    const i = (start + k) % 4;
    if (i === removed) continue;
    if (!line.length) line.push(edges[i].a);
    line.push(edges[i].b);
  }
  return line;
}

interface VillageFenceOptions {
  /** distantLandscape 가 내는 집 자리와 같은 모양 */
  houseSpots?: Spot[] | null;
  groundHeight?: HeightAt | null;
  /** 초가집 모형은 가로가 키의 1.72 배다(nature 에서 맞춰 굽는다) */
  houseWidthRatio?: number;
  seed?: number;
}

export function villageFenceSpots({
  houseSpots,
  groundHeight = null,
  houseWidthRatio = 1.72,
  seed = 7731,
}: VillageFenceOptions = {}): FenceLayout {
  const posts: Spot[] = [];
  const rails: Spot[] = [];
  if (!houseSpots?.length) return { posts, rails };
  const random = makeRandom(seed);
  // fences 와 같은 색 규칙 — 같은 마을의 같은 나무다
  const light = new THREE.Color(WOOD_STYLE.light);
  const dark = new THREE.Color(WOOD_STYLE.dark);
  const scratch = new THREE.Color();
  const woodColor = () =>
    scratch
      .copy(dark)
      .lerp(light, 0.35 + random() * 0.6)
      .getHex();

  let cx = 0;
  let cz = 0;
  for (const h of houseSpots) {
    cx += h.x;
    cz += h.z;
  }
  cx /= houseSpots.length;
  cz /= houseSpots.length;

  for (const house of houseSpots) {
    let neighbor = Infinity;
    for (const other of houseSpots)
      if (other !== house) neighbor = Math.min(neighbor, Math.hypot(house.x - other.x, house.z - other.z));
    // 집마다 가로세로가 달라 자리의 widthRatio·depthRatio 로 잰다
    const size = house.size ?? 3;
    const houseWidth = size * (house.widthRatio || houseWidthRatio);
    const houseDepth = size * (house.depthRatio || houseWidthRatio * 0.8);
    const houseSpan = Math.max(houseWidth, houseDepth);
    const halfYard = Math.min(houseSpan * 0.85, neighbor * 0.45);
    // 마당이 집보다 커야 한다 — 안 그러면 울이 지붕 밑을 뚫고 나온다. 비스듬한 모서리까지 24 % 여유를 둔다.
    // 빽빽한 진부촌에선 몇 채가 여기 걸리는데, 그 편이 도리어 마을답다.
    if (halfYard < houseWidth * 0.68 || halfYard < houseDepth * 0.68) continue;
    const half = {
      x: halfYard,
      // 세로를 조금 눌러 정사각형이 아니게 — 단 집을 깔면 안 된다
      z: Math.max(halfYard * (0.78 + random() * 0.3), houseDepth * 0.68),
    };
    const openDirection = Math.atan2(cx - house.x, cz - house.z);
    const line = yardOutline(house, half, openDirection, house.rotation ?? 0);

    const points: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      const edgeLength = Math.hypot(b.x - a.x, b.z - a.z);
      const cells = Math.max(1, Math.round(edgeLength / FENCE_DIMENSIONS.postSpacing));
      for (let k = 0; k < cells; k++) {
        const t = k / cells;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        points.push({ x, z, y: groundHeight ? groundHeight(x, z) : (house.y ?? 0) });
      }
      if (i === line.length - 2)
        points.push({ x: b.x, z: b.z, y: groundHeight ? groundHeight(b.x, b.z) : (house.y ?? 0) });
    }
    for (const q of points)
      posts.push({
        x: q.x,
        y: q.y - FENCE_DIMENSIONS.burial,
        z: q.z,
        size: FENCE_DIMENSIONS.postHeight * (0.9 + random() * 0.2),
        rotation: (random() - 0.5) * 0.6,
        tilt: (random() - 0.5) * 0.09,
        tilt2: (random() - 0.5) * 0.09,
        widthRatio: FENCE_DIMENSIONS.postThickness / FENCE_DIMENSIONS.postHeight,
        depthRatio: FENCE_DIMENSIONS.postThickness / FENCE_DIMENSIONS.postHeight,
        color: woodColor(),
      });
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const flat = Math.hypot(dx, dz);
      if (flat < 0.05) continue;
      for (const h of FENCE_DIMENSIONS.railHeights) {
        const ay = a.y + h;
        const by = b.y + h;
        const length = Math.hypot(flat, by - ay) * 1.04;
        rails.push({
          x: (a.x + b.x) / 2,
          y: (ay + by) / 2,
          z: (a.z + b.z) / 2,
          size: length,
          // 막대는 국소 +Z 로 누워 있다. 길이 축은 depthRatio 이고 heightRatio 를 안 주면 키가 길이만큼 커진다.
          rotation: Math.atan2(dx, dz),
          tilt: -Math.atan2(by - ay, flat),
          tilt2: 0,
          widthRatio: FENCE_DIMENSIONS.railWidth / length,
          heightRatio: FENCE_DIMENSIONS.railThickness / length,
          depthRatio: 1,
          color: woodColor(),
        });
      }
    }
  }
  return { posts, rails };
}
