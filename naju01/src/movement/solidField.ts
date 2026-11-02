// 걷기 충돌 격자 — 화면에 실제로 선 물건(교체된 바위·나무 줄기·소품·사람)을 25 cm 칸에 구워 둔다.
// 예전 소품 충돌(propColliders)은 원본 표본 상자로 원기둥을 세워, 더 큰 교체 바위나 놓기·덮기 바위는 몰랐다.
// 칸마다 「물건이 차지한 높이 띠」를 몇 개 둔다. 물건 하나의 한 칸은 맨 아래~맨 위를 꽉 찬 띠로 본다(바위 속은 비어 있지 않다).
// 칸마다 그 칸이 땅 위로 솟은 높이로 셋으로 나눈다. 턱만 보면 둥근 큰 바위도 가장자리부터 계단처럼 걸어 올라가 버려서다.
//   낮은 칸(≤ PROP_STEP) — 그냥 걸어 넘는다 · 점프로 닿는 칸(≤ CLIMB_MAX) — 걸어서는 막히고 점프하면 올라선다
//   그보다 높은 칸 — 벽. 위에 올라서지 않는다(물건 하나로 정하면 천막 바닥 끈 같은 낮은 데까지 벽이 된다).
//   천막 지붕처럼 머리 위에만 있는 띠는 막지 않는다.
// 굽기는 프레임마다 몇 ms 씩 나눠 한다(교체본이 다 서는 데 수십 초 걸리고, 한 번에 구우면 화면이 멈춘다).
// 단위는 전부 미터.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

import { collectPublicSolids, publicSolidsVersion } from "../loaders/publicAssets";
import { METERS_PER_UNIT } from "../plan/sitePlan";

/** 저절로 올라서는 턱(m). 이보다 높으면 점프해야 오른다 */
export const PROP_STEP = 0.3;
/** 점프로 올라설 수 있는 물건 키(m) — 점프 최고점 0.55 m(본부실과 같은 JUMP_VELOCITY·GRAVITY) + 걸치는 턱 0.12 m */
export const CLIMB_MAX = 0.66;
/** 점프로 오르는 것·벽 위에서 한 칸 건너 허용하는 턱(m) — 둥근 바위 등을 따라 걷되 옆면을 계단처럼 오르지 않게 */
const SURFACE_STEP = 0.12;

const enum Kind {
  Low = 0,
  Climbable = 1,
  Wall = 2,
}
/** 이 높이(발 위)보다 낮게 걸친 띠만 몸을 막는다 — 머리 위 지붕·가지는 지나간다 */
const BODY_HEIGHT = 1.7;
/** 이보다 낮은 것(자갈·풀포기)은 굽지 않는다 */
const MIN_HEIGHT = 0.15;

const CELL = 0.25;
const X0 = -6;
const Z0 = -6;
const NX = Math.ceil((92 - X0) / CELL);
const NZ = Math.ceil((76 - Z0) / CELL);
const MAX_SPANS = 4;
/** 한 프레임에 굽는 데 쓰는 시간(ms) */
const FRAME_BUDGET_MS = 4;

// 땅·하늘·물·원경, 그리고 헤치고 지나가는 초목과 바닥에 붙은 흔적은 굽지 않는다
const SKIPPED_NAME =
  /^(ground|grass|path|slope|zone\.sides|connectorRamp|cliffFace|땅\.)|^(sky|distant|river|immersion|blocker|cliff|distortion)\.|원경|풀|잡초|꽃|덤불|수풀|잎더미|절벽머리|금줄|댕기|짚신|발자국|배자국|흙덩이|부러진가지|명패/;
const isSolidName = (name: string) => !!name && !SKIPPED_NAME.test(name.replace(/^AI허브:/, ""));
const isSolidMaterial = (material: THREE.Material | THREE.Material[]) => {
  const m = Array.isArray(material) ? material[0] : material;
  return !!m && !(m.alphaTest > 0) && !m.transparent;
};

type GroundAt = (x: number, z: number) => number;

interface Source {
  geometry: THREE.BufferGeometry;
  matrices: THREE.Matrix4[];
}

/** 칸마다 띠 [아래, 위] 를 최대 MAX_SPANS 개 */
class SpanGrid {
  readonly spans = new Float32Array(NX * NZ * MAX_SPANS * 2);
  readonly kinds = new Uint8Array(NX * NZ * MAX_SPANS);
  readonly counts = new Uint8Array(NX * NZ);

  insert(cell: number, bottom: number, top: number, kind: Kind) {
    const base = cell * MAX_SPANS * 2;
    let n = this.counts[cell];
    // 겹치거나 5 cm 안으로 붙은 띠는 하나로 — 종류는 더 막는 쪽을 따른다
    for (let k = 0; k < n; k++) {
      const b = this.spans[base + k * 2];
      const t = this.spans[base + k * 2 + 1];
      if (bottom <= t + 0.05 && top >= b - 0.05) {
        this.spans[base + k * 2] = Math.min(b, bottom);
        this.spans[base + k * 2 + 1] = Math.max(t, top);
        this.kinds[cell * MAX_SPANS + k] = Math.max(this.kinds[cell * MAX_SPANS + k], kind);
        return;
      }
    }
    if (n < MAX_SPANS) {
      this.spans[base + n * 2] = bottom;
      this.spans[base + n * 2 + 1] = top;
      this.kinds[cell * MAX_SPANS + n] = kind;
      this.counts[cell] = n + 1;
      return;
    }
    // 꽉 찼으면 가장 가까운 띠에 붙인다
    let best = 0;
    let gap = Infinity;
    for (let k = 0; k < n; k++) {
      const d = Math.max(this.spans[base + k * 2] - top, bottom - this.spans[base + k * 2 + 1]);
      if (d < gap) {
        gap = d;
        best = k;
      }
    }
    n = best;
    this.spans[base + n * 2] = Math.min(this.spans[base + n * 2], bottom);
    this.spans[base + n * 2 + 1] = Math.max(this.spans[base + n * 2 + 1], top);
    this.kinds[cell * MAX_SPANS + n] = Math.max(this.kinds[cell * MAX_SPANS + n], kind);
  }
}

const cellOf = (x: number, z: number) => {
  const i = Math.floor((x - X0) / CELL);
  const j = Math.floor((z - Z0) / CELL);
  return i < 0 || j < 0 || i >= NX || j >= NZ ? -1 : j * NX + i;
};

/** 물건 하나를 칸에 굽는다 — 그 물건이 한 칸에서 차지한 맨 아래·맨 위만 모은다 */
class InstanceRaster {
  private stamp = new Int32Array(NX * NZ);
  private low = new Float32Array(NX * NZ);
  private high = new Float32Array(NX * NZ);
  private touched: number[] = [];
  private serial = 0;

  begin() {
    this.serial++;
    this.touched.length = 0;
  }

  point(x: number, z: number, y: number) {
    const cell = cellOf(x, z);
    if (cell < 0) return;
    if (this.stamp[cell] !== this.serial) {
      this.stamp[cell] = this.serial;
      this.low[cell] = y;
      this.high[cell] = y;
      this.touched.push(cell);
    } else if (y < this.low[cell]) this.low[cell] = y;
    else if (y > this.high[cell]) this.high[cell] = y;
  }

  triangle(a: number[], b: number[], c: number[]) {
    this.point(a[0], a[2], a[1]);
    this.point(b[0], b[2], b[1]);
    this.point(c[0], c[2], c[1]);
    // 모서리 — 세로 벽은 위에서 보면 넓이가 없어 모서리로만 칸을 잡는다
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const steps = Math.floor(Math.hypot(q[0] - p[0], q[2] - p[2]) / (CELL * 0.7));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        this.point(p[0] + (q[0] - p[0]) * t, p[2] + (q[2] - p[2]) * t, p[1] + (q[1] - p[1]) * t);
      }
    }
    // 넓은 면은 칸 가운데마다 높이를 잰다
    const minX = Math.min(a[0], b[0], c[0]);
    const maxX = Math.max(a[0], b[0], c[0]);
    const minZ = Math.min(a[2], b[2], c[2]);
    const maxZ = Math.max(a[2], b[2], c[2]);
    if (maxX - minX < CELL && maxZ - minZ < CELL) return;
    const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(det) < 1e-8) return;
    const i0 = Math.floor((minX - X0) / CELL);
    const i1 = Math.floor((maxX - X0) / CELL);
    const j0 = Math.floor((minZ - Z0) / CELL);
    const j1 = Math.floor((maxZ - Z0) / CELL);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = X0 + (i + 0.5) * CELL;
        const z = Z0 + (j + 0.5) * CELL;
        const w0 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det;
        const w1 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        this.point(x, z, w0 * a[1] + w1 * b[1] + w2 * c[1]);
      }
  }

  commit(grid: SpanGrid, groundAt: GroundAt) {
    for (const cell of this.touched) {
      const x = X0 + ((cell % NX) + 0.5) * CELL;
      const z = Z0 + (Math.floor(cell / NX) + 0.5) * CELL;
      const rise = this.high[cell] - groundAt(x, z);
      const kind = rise <= PROP_STEP ? Kind.Low : rise <= CLIMB_MAX ? Kind.Climbable : Kind.Wall;
      grid.insert(cell, this.low[cell], this.high[cell], kind);
    }
  }
}

/** 지금 화면에 선 단단한 것들 — 원본 무리(교체 안 된 자리)와 교체본 */
function collectSources(scene: THREE.Scene): Source[] {
  const sources: Source[] = [];
  const isShown = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o.userData.publicAsset || !isShown(o)) return;
    if (!isSolidName(o.name) || !isSolidMaterial(mesh.material)) return;
    o.updateWorldMatrix(true, false);
    const instanced = o as THREE.InstancedMesh;
    const matrices: THREE.Matrix4[] = [];
    if (instanced.isInstancedMesh)
      for (let i = 0; i < instanced.count; i++) {
        const m = new THREE.Matrix4();
        instanced.getMatrixAt(i, m);
        matrices.push(m.premultiply(o.matrixWorld));
      }
    else matrices.push(o.matrixWorld.clone());
    if (matrices.length) sources.push({ geometry: mesh.geometry, matrices });
  });
  for (const solid of collectPublicSolids())
    if (isSolidName(solid.name) && isSolidMaterial(solid.material))
      sources.push({ geometry: solid.geometry, matrices: solid.matrices });
  return sources;
}

/** 다시 구울지 가르는 서명 — 보이는 무리와 그 개수, 교체본 판 번호 */
function signatureOf(scene: THREE.Scene) {
  let s = `v${publicSolidsVersion()}`;
  scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh || !isSolidName(o.name)) return;
    if (o.userData.publicAsset && o.userData.lodPaired) return; // 원근 나눔이 수시로 count 를 바꾼다
    s += `|${o.id}:${o.visible ? 1 : 0}:${o.userData.publicAsset ? "" : ((o as THREE.InstancedMesh).count ?? 1)}`;
  });
  return s;
}

/** 굽기 — 한 물건씩 내놓는 일감. 다 구우면 새 격자를 돌려준다 */
function* bake(sources: Source[], groundAt: GroundAt): Generator<void, SpanGrid> {
  const grid = new SpanGrid();
  const raster = new InstanceRaster();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const a: number[] = [0, 0, 0];
  const b: number[] = [0, 0, 0];
  const c: number[] = [0, 0, 0];
  for (const { geometry, matrices } of sources) {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const position = geometry.attributes.position;
    const index = geometry.index;
    const triangles = index ? index.count / 3 : position.count / 3;
    let world = new Float32Array(position.count * 3);
    for (const matrix of matrices) {
      box.copy(geometry.boundingBox!).applyMatrix4(matrix);
      const height = (box.max.y - box.min.y) * METERS_PER_UNIT;
      const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * METERS_PER_UNIT;
      const cx = ((box.min.x + box.max.x) / 2) * METERS_PER_UNIT;
      const cz = ((box.min.z + box.max.z) / 2) * METERS_PER_UNIT;
      if (height < MIN_HEIGHT || width > 40 || cellOf(cx, cz) < 0) continue;
      // 땅 위로 솟은 키 — 묻힌 밑동은 키에 넣지 않는다
      if (box.max.y * METERS_PER_UNIT - groundAt(cx, cz) < MIN_HEIGHT) continue;
      if (world.length < position.count * 3) world = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(matrix).multiplyScalar(METERS_PER_UNIT);
        world[i * 3] = v.x;
        world[i * 3 + 1] = v.y;
        world[i * 3 + 2] = v.z;
      }
      raster.begin();
      for (let t = 0; t < triangles; t++) {
        const i0 = index ? index.getX(t * 3) : t * 3;
        const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        a[0] = world[i0 * 3];
        a[1] = world[i0 * 3 + 1];
        a[2] = world[i0 * 3 + 2];
        b[0] = world[i1 * 3];
        b[1] = world[i1 * 3 + 1];
        b[2] = world[i1 * 3 + 2];
        c[0] = world[i2 * 3];
        c[1] = world[i2 * 3 + 1];
        c[2] = world[i2 * 3 + 2];
        raster.triangle(a, b, c);
      }
      raster.commit(grid, groundAt);
      yield;
    }
  }
  return grid;
}

export interface SolidField {
  /** 다 구운 격자가 있는가 — 없으면 옛 소품 충돌을 쓴다 */
  isReady(): boolean;
  /** 발 높이 footY 로 (x, z) 에 반지름 radius 몸을 세우면 막히는가 */
  blockedAt(x: number, z: number, footY: number, radius: number): boolean;
  /** 막는 띠가 발보다 얼마나 높이 솟았나(m, 안 막히면 0) — 이미 박혀 있을 때 더 깊이 들어가는지 견준다 */
  depthAt(x: number, z: number, footY: number, radius: number): number;
  /** (x, z) 에서 발을 올려놓을 수 있는 가장 높은 물건 꼭대기(≤ maxY). 없으면 -Infinity */
  supportAt(x: number, z: number, maxY: number): number;
}

/**
 * 움직이는 물건(퍼즐 수레·그 위의 궤) — 격자에 굽지 않고 상자로 따로 본다. 점프로 오르는 칸과 같은 규칙이다.
 * yaw 는 three 의 rotation.y 와 같다(halfX 는 로컬 x 반폭, halfZ 는 로컬 z 반폭). bottom·top 은 월드 높이(m). 퍼즐이 매 프레임 고쳐 쓴다.
 */
export interface DynamicSolid {
  x: number;
  z: number;
  yaw: number;
  halfX: number;
  halfZ: number;
  bottom: number;
  top: number;
  enabled: boolean;
  /** false 면 막기만 하고 위에 서지 못한다(가는 장대 끝 등) */
  walkable?: boolean;
}
const dynamicSolids = new Set<DynamicSolid>();
export function addDynamicSolid(solid: DynamicSolid) {
  dynamicSolids.add(solid);
  return () => {
    dynamicSolids.delete(solid);
  };
}
/** 상자와 원(반지름 radius)이 겹치나 */
function touchesBox(box: DynamicSolid, x: number, z: number, radius: number) {
  const c = Math.cos(box.yaw);
  const s = Math.sin(box.yaw);
  const dx = x - box.x;
  const dz = z - box.z;
  // three 의 rotation.y 를 거꾸로 돌린다
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const nx = Math.max(-box.halfX, Math.min(lx, box.halfX));
  const nz = Math.max(-box.halfZ, Math.min(lz, box.halfZ));
  return (lx - nx) ** 2 + (lz - nz) ** 2 <= radius * radius;
}

function createQueries(holder: { grid: SpanGrid | null }): SolidField {
  /** 몸 원과 겹치는 칸의 띠 중 막는 것들의 (꼭대기 − 발) 가장 큰 값 */
  const depth = (x: number, z: number, footY: number, radius: number, firstOnly: boolean) => {
    let deepest = 0;
    for (const box of dynamicSolids) {
      if (!box.enabled || !touchesBox(box, x, z, radius)) continue;
      if (box.top > footY + SURFACE_STEP && box.bottom < footY + BODY_HEIGHT) {
        if (firstOnly) return 1;
        deepest = Math.max(deepest, box.top - footY);
      }
    }
    const grid = holder.grid;
    if (!grid) return deepest;
    const i0 = Math.floor((x - radius - X0) / CELL);
    const i1 = Math.floor((x + radius - X0) / CELL);
    const j0 = Math.floor((z - radius - Z0) / CELL);
    const j1 = Math.floor((z + radius - Z0) / CELL);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        if (i < 0 || j < 0 || i >= NX || j >= NZ) continue;
        // 칸 사각형과 몸 원이 겹치나
        const nx = Math.max(X0 + i * CELL, Math.min(x, X0 + (i + 1) * CELL));
        const nz = Math.max(Z0 + j * CELL, Math.min(z, Z0 + (j + 1) * CELL));
        if ((nx - x) ** 2 + (nz - z) ** 2 > radius * radius) continue;
        const cell = j * NX + i;
        const base = cell * MAX_SPANS * 2;
        for (let k = 0; k < grid.counts[cell]; k++) {
          const bottom = grid.spans[base + k * 2];
          const top = grid.spans[base + k * 2 + 1];
          const step = grid.kinds[cell * MAX_SPANS + k] === Kind.Low ? PROP_STEP : SURFACE_STEP;
          if (top > footY + step && bottom < footY + BODY_HEIGHT) {
            if (firstOnly) return 1;
            deepest = Math.max(deepest, top - footY);
          }
        }
      }
    return deepest;
  };
  return {
    isReady: () => !!holder.grid,
    blockedAt: (x, z, footY, radius) => depth(x, z, footY, radius, true) > 0,
    depthAt: (x, z, footY, radius) => depth(x, z, footY, radius, false),
    supportAt(x, z, maxY) {
      let best = -Infinity;
      for (const box of dynamicSolids)
        if (box.enabled && box.walkable !== false && box.top <= maxY && box.top > best && touchesBox(box, x, z, 0)) best = box.top;
      const grid = holder.grid;
      const cell = cellOf(x, z);
      if (!grid || cell < 0) return best;
      const base = cell * MAX_SPANS * 2;
      for (let k = 0; k < grid.counts[cell]; k++) {
        if (grid.kinds[cell * MAX_SPANS + k] === Kind.Wall) continue; // 벽 위에는 서지 않는다
        const top = grid.spans[base + k * 2 + 1];
        if (top <= maxY && top > best) best = top;
      }
      return best;
    },
  };
}

/** 퍼즐(수레 등)이 걷기 충돌을 같이 본다 — 걷기 훅이 만든 것 하나 */
export const solidQueries: { current: SolidField | null } = { current: null };

/** 씬을 지켜보다 물건이 바뀌면 나눠 다시 굽는다. 굽는 동안은 앞서 구운 격자를 그대로 쓴다 */
export function useSolidField(groundAt: GroundAt): SolidField {
  const scene = useThree((state) => state.scene);
  const [holder] = useState<{ grid: SpanGrid | null }>(() => ({ grid: null }));
  const queries = useMemo(() => createQueries(holder), [holder]);
  useEffect(() => {
    solidQueries.current = queries;
    return () => {
      if (solidQueries.current === queries) solidQueries.current = null;
    };
  }, [queries]);
  const baking = useRef<{
    job: Generator<void, SpanGrid> | null;
    signature: string;
    pendingSignature: string;
    checkedAt: number;
  }>({ job: null, signature: "", pendingSignature: "", checkedAt: -99 });

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuSolid", {
      ...queries,
      /** 그 칸의 띠 [아래, 위, 종류] */
      spansAt: (x: number, z: number) => {
        const grid = holder.grid;
        const cell = cellOf(x, z);
        if (!grid || cell < 0) return [];
        return Array.from({ length: grid.counts[cell] }, (_, k) => [
          +grid.spans[cell * MAX_SPANS * 2 + k * 2].toFixed(2),
          +grid.spans[cell * MAX_SPANS * 2 + k * 2 + 1].toFixed(2),
          grid.kinds[cell * MAX_SPANS + k],
        ]);
      },
      rebake: () => {
        baking.current.signature = "";
        baking.current.checkedAt = -99;
      },
    });
  }, [queries, holder]);

  useFrame(({ clock }) => {
    const s = baking.current;
    if (s.job) {
      const started = performance.now();
      while (performance.now() - started < FRAME_BUDGET_MS) {
        const step = s.job.next();
        if (step.done) {
          holder.grid = step.value;
          s.signature = s.pendingSignature;
          s.job = null;
          break;
        }
      }
      return;
    }
    // 1.5 초마다 바뀐 게 있나 본다
    if (clock.elapsedTime - s.checkedAt < 1.5) return;
    s.checkedAt = clock.elapsedTime;
    const signature = signatureOf(scene);
    if (signature === s.signature) return;
    s.pendingSignature = signature;
    s.job = bake(collectSources(scene), groundAt);
  });

  return queries;
}
