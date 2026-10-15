/**
 * publicAssetPlacement.ts — 바꿔치기 · 덮기 · 놓기 세 가지 배치 계산 (옛 AI허브전시.jsx useFrame 안의 세 블록 이식)
 *   씬을 읽어 교체본 InstancedMesh 를 세운다. 원본 무리는 **건드리지 않고 압축만** 한다(compactOriginal) —
 *   편집(이동·지우기·복사)은 언제나 원본 무리 데이터로 하고, 교체본은 그걸 따라 그린다.
 *
 * [옛 이름 → 새 이름]
 *   길침범 → pathIntrusion · 길자리모으기 → collectPathPieces · 심어도되나 → canPlant · 선분거리 → segmentDistance
 *   서명 → signature · 배열번호 → arrayId · 후보 → candidates · 파일별 → byFile · 짝들 → lodPairs
 *   userData.원본행렬/원본번호들 → userData.publicAssetOriginal{matrices,ids,colors} (원본 메시에 이 층이 남기는 스냅샷)
 *   userData.무리이름/번호들/모양번호/교체본 → userData.groupId/ids/shapeIndex/publicAssetReplacement (편집기 집기 규약)
 */
import * as THREE from "three";

import { MESH_NAMES } from "../plan/meshNames";
import { PATHS, UNITS_PER_METER, ZONES } from "../plan/sitePlan";
import {
  buildInstancedMeshes,
  bundleBox,
  cloneBundle,
  cutFaceDirection,
  fitFootprint,
  fitHeight,
  hash01,
  normalizeToUnit,
  triangleCount,
  type Bundle,
} from "./publicAssetGeometry";
import type { CoverItem, PlaceItem, SwapItem } from "./publicAssetLoader";
import { hiddenCovers, publicAssetRegistry } from "./publicAssetManifest";

const U = UNITS_PER_METER;

/** 덮기 「대상」의 한글 이름 → TS 메시 이름. 표에 없는 이름은 그대로 찾는다 */
const COVER_TARGET_NAMES: Record<string, string> = {
  절벽면: MESH_NAMES.cliffFace,
  땅: MESH_NAMES.ground,
  길: MESH_NAMES.path,
};

/** 원경판 짝 — 0.5초마다 카메라 거리로 근경/원경 메시에 나눠 담는다 */
export interface LodPair {
  nearMeshes: THREE.InstancedMesh[];
  farMeshes: THREE.InstancedMesh[];
  nearMatrices: THREE.Matrix4[];
  farMatrices: THREE.Matrix4[];
  /** 자리(월드) */
  positions: THREE.Vector3[];
  idTable: Int32Array;
}

/** 세운 교체본 한 묶음(바꿔치기 한 항목 · 덮기 한 항목 · 놓기 한 항목) */
export interface BuiltEntry {
  signature: string;
  meshes: THREE.InstancedMesh[];
  triangles: number;
  label: string;
  lodPairs?: LodPair[];
  /** 놓기 「차단물」 — 치워지면 같이 가라앉는다 */
  blocker?: string | null;
  sinkStartedAt?: number | null;
  sinkDepth?: number;
  originalY?: number[];
}

/** 원본 메시에 남기는 스냅샷(압축 전 배열) */
interface OriginalSnapshot {
  matrices: Float32Array;
  ids: Int32Array;
  colors: Float32Array | null;
}

// ── 길 침범 검사 (10/14 미르: 「T4 하강로가 덮기 바위 속에 묻혀 카메라가 바위를 뚫고 지나간다」) ──
//   덮기 판 하나를 반지름 rm(m) 공으로 보고, 어느 통로든 길바닥+사람 키(2.2 m) 띠와 겹치면 세우지 않는다.
//   길 고도는 통로의 시작고도→끝고도를 길이 비율로 잇는다(길은 고른 비탈이다).
export function pathIntrusion(xm: number, ym: number, zm: number, rm: number): string | null {
  for (const T of PATHS) {
    const P = T.points;
    let walked = 0;
    let total = 0;
    for (let i = 0; i < P.length - 1; i++) total += Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, az] = P[i];
      const [bx, bz] = P[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const L = Math.hypot(dx, dz) || 1;
      const t = Math.max(0, Math.min(1, ((xm - ax) * dx + (zm - az) * dz) / (L * L)));
      const horizontal = Math.hypot(xm - (ax + dx * t), zm - (az + dz * t));
      const pathY = T.startElevation + (T.endElevation - T.startElevation) * ((walked + L * t) / (total || 1));
      walked += L;
      if (horizontal < T.width / 2 + 0.6 + rm * 0.7 && ym - rm * 0.7 < pathY + 2.2 && ym + rm * 0.7 > pathY - 0.3)
        return T.code;
    }
  }
  return null;
}

// ── 풀·꽃 자리 거르기 (10/13 미르) ─────────────────────────────
//   ① 길 위에는 안 심는다: 도면 통로(T1~T4, 폭/2 + 0.6 m) · 편집으로 깐 「땅.길」 조각(상자 + 0.4 m)
//   ② 사람이 다니는 길목 곁(4 m 안)은 듬성듬성 — 멀어질수록 남긴다
//   ③ 구역 한가운데(가장자리에서 3 m 넘게 안쪽)는 무대라 35 % 만 — 외곽에 몰리게
//   결과는 자리 번호 해시로 정해 새로 고쳐도 같다.
function segmentDistance(x: number, z: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}

interface PathPiece {
  inverse: THREE.Matrix4;
  box: THREE.Box3;
}

/** 편집으로 깐 「땅.길」 조각(팔레트 소품)의 상자들 */
export function collectPathPieces(scene: THREE.Scene): PathPiece[] {
  const pieces: PathPiece[] = [];
  scene.traverse((o) => {
    if (!(o as THREE.InstancedMesh).isInstancedMesh || o.name !== "땅.길" || o.userData.publicAsset) return;
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    const A = originalMatrices(mesh);
    const n = A.length / 16;
    mesh.updateMatrixWorld(true);
    for (let i = 0; i < n; i++) {
      const M = new THREE.Matrix4().fromArray(A, i * 16);
      if (Math.abs(M.elements[0]) + Math.abs(M.elements[5]) + Math.abs(M.elements[10]) < 1e-6) continue;
      M.premultiply(mesh.matrixWorld);
      pieces.push({
        inverse: M.clone().invert(),
        box: box.clone().expandByScalar((0.4 * U) / Math.max(1e-6, new THREE.Vector3().setFromMatrixColumn(M, 0).length())),
      });
    }
  });
  return pieces;
}

/** 개발 확인용 — 놀이 구역(구역 사각형 + 6 m) 안에서 얼마나 남았나 [남김, 전체] · 무리별 [남김, 전체] */
export const grassThinning = { inZones: [0, 0] as [number, number], byGroup: {} as Record<string, [number, number]> };
const inPlayZone = (xm: number, zm: number) =>
  ZONES.some((v) => xm > v.x[0] - 6 && xm < v.x[1] + 6 && zm > v.z[0] - 6 && zm < v.z[1] + 6);
const countZone = (xm: number, zm: number, kept: boolean) => {
  if (!inPlayZone(xm, zm)) return;
  grassThinning.inZones[1]++;
  if (kept) grassThinning.inZones[0]++;
};

export function canPlant(
  xm: number,
  zm: number,
  id: number,
  pathPieces: PathPiece[],
  options: { 길곁?: number; 한가운데?: number } = {},
): boolean {
  let d = Infinity;
  for (const t of PATHS)
    for (let k = 1; k < t.points.length; k++)
      d = Math.min(d, segmentDistance(xm, zm, t.points[k - 1], t.points[k]) - (t.width ?? 3) / 2);
  const p = new THREE.Vector3();
  for (const g of pathPieces) {
    p.set(xm * U, 0, zm * U).applyMatrix4(g.inverse);
    if (p.x >= g.box.min.x && p.x <= g.box.max.x && p.z >= g.box.min.z && p.z <= g.box.max.z) {
      countZone(xm, zm, false);
      return false;
    }
  }
  if (d < 0.6) {
    countZone(xm, zm, false);
    return false;
  }
  const roadside = options.길곁 ?? 0.15;
  const middle = options.한가운데 ?? 0.35;
  let keep = Math.min(1, roadside + ((d - 0.6) / 3.4) * (1 - roadside));
  const zone = ZONES.find((v) => xm > v.x[0] && xm < v.x[1] && zm > v.z[0] && zm < v.z[1]);
  if (zone) {
    const inset = Math.min(xm - zone.x[0], zone.x[1] - xm, zm - zone.z[0], zone.z[1] - zm);
    if (inset > 3) keep *= middle;
  }
  const kept = hash01(id * 977 + 41) < keep;
  countZone(xm, zm, kept);
  return kept;
}

// ── 원본 무리 읽기 · 압축 ───────────────────────────────────
const arrayIds = new WeakMap<object, number>();
let arrayCounter = 0;
const arrayId = (a: object) => {
  if (!arrayIds.has(a)) arrayIds.set(a, ++arrayCounter);
  return arrayIds.get(a)!;
};

const snapshotOf = (o: THREE.InstancedMesh): OriginalSnapshot | undefined =>
  o.userData.publicAssetOriginal as OriginalSnapshot | undefined;
/** 압축 전 원본 배열(스냅샷이 있으면 그것) */
export const originalMatrices = (o: THREE.InstancedMesh): Float32Array =>
  snapshotOf(o)?.matrices ?? (o.instanceMatrix.array as Float32Array);
const originalIds = (o: THREE.InstancedMesh): Int32Array | null =>
  snapshotOf(o)?.ids ?? ((o.userData.ids as Int32Array | undefined) ?? null);

/**
 * 등록부에 든 무리의 원본 InstancedMesh 에서 교체본이 맡는 자리를 **앞으로 몰아 담아** 뺀다(count 를 줄인다).
 * InstanceGroupMesh 가 무리를 새로 담으면(userData.ids 가 새 배열) 다시 스냅샷을 뜨고 다시 압축한다.
 * 옛 공간그레이박스 무리 컴포넌트의 「교체로빠지나」 부분 — 거기선 색 배열은 안 눌렀는데 여기선 같이 눌러 색이 어긋나지 않게 했다.
 */
export function compactOriginal(o: THREE.InstancedMesh): boolean {
  const groupId = (o.userData.groupId as string | undefined) ?? o.name;
  if (!publicAssetRegistry.touches(groupId)) return false;
  const ids = o.userData.ids as Int32Array | undefined;
  if (!ids) return false;
  let snap = snapshotOf(o);
  if (!snap || snap.ids !== ids) {
    const n = ids.length;
    snap = {
      matrices: (o.instanceMatrix.array as Float32Array).slice(0, n * 16),
      ids,
      colors: o.instanceColor ? (o.instanceColor.array as Float32Array).slice(0, n * 3) : null,
    };
    o.userData.publicAssetOriginal = snap;
  } else return false; // 이미 이 배열로 압축했다
  const A = snap.matrices;
  const n = snap.ids.length;
  const kept = new Int32Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const off = k * 16;
    const sizeM =
      Math.max(
        Math.hypot(A[off], A[off + 1], A[off + 2]),
        Math.hypot(A[off + 4], A[off + 5], A[off + 6]),
        Math.hypot(A[off + 8], A[off + 9], A[off + 10]),
      ) / U;
    if (publicAssetRegistry.isReplaced(groupId, sizeM)) continue;
    (o.instanceMatrix.array as Float32Array).set(A.subarray(off, off + 16), j * 16);
    if (snap.colors && o.instanceColor) (o.instanceColor.array as Float32Array).set(snap.colors.subarray(k * 3, k * 3 + 3), j * 3);
    kept[j++] = snap.ids[k];
  }
  o.count = j;
  o.userData.ids = kept.subarray(0, j);
  // ids 를 새 배열로 바꿨으니 스냅샷 쪽 ids 도 그것을 가리키게 — 다음 틱에 「새 무리」로 오해하지 않게
  snap.ids = o.userData.ids as Int32Array;
  o.instanceMatrix.needsUpdate = true;
  if (o.instanceColor) o.instanceColor.needsUpdate = true;
  o.computeBoundingSphere();
  return true;
}

export interface BuildContext {
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** 교체본을 담는 그룹 */
  parent: THREE.Object3D;
  /** parent.matrixWorld 의 역 — 월드 행렬을 parent 로컬로 */
  inverse: THREE.Matrix4;
}

interface Candidate {
  mesh: THREE.InstancedMesh;
  i: number;
  world: THREE.Matrix4;
  sizeM: number;
  id: number | undefined;
  shapeIndex: number | undefined;
  distance: number;
}

// ── 바꿔치기 ──
/** 같은 서명이면 "same", 세울 것이 없으면 null, 아니면 새로 세운 묶음 */
export function buildSwap(
  item: SwapItem,
  ctx: BuildContext,
  previous: BuiltEntry | undefined,
): BuiltEntry | "same" | null {
  if (!item.bundles.length) return null;
  const { scene, camera, parent, inverse } = ctx;
  // ★ 게임 쪽이 instanceMatrix·count 를 바꿔도(압축·원근 나눔) 서명이 흔들리지 않게 **원본 스냅샷**을 읽는다.
  //   비울 때도 그 배열이 아니라 count 로 비우므로 비운 자리는 서명에 안 드러난다 — 첫 서명을 지킨다.
  const originals: THREE.InstancedMesh[] = [];
  scene.traverse((o) => {
    if (!(o as THREE.InstancedMesh).isInstancedMesh || o.name !== item.target || o.userData.publicAsset) return;
    originals.push(o as THREE.InstancedMesh);
  });
  // ★ 서명에 **원본 배열의 정체**를 넣는다. 편집기로 옮기면 무리가 새 배열로 다시 서는데, 메시(uuid)와 개수는
  //   그대로라 예전 서명은 안 바뀌었다 → 교체본이 안 따라와 「선택·이동이 안 된다」(10/13).
  const signature = originals
    .map((o) => `${o.uuid}:${originalMatrices(o).length / 16}:${arrayId(originalIds(o) ?? originalMatrices(o))}`)
    .join(";");
  if (previous && previous.signature === signature) return "same";
  if (previous) for (const m of previous.meshes) { parent.remove(m); m.dispose(); }
  const candidates: Candidate[] = [];
  const t = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (const o of originals) {
    o.updateMatrixWorld(true);
    const A = originalMatrices(o);
    const ids = originalIds(o);
    for (let i = 0; i < A.length / 16; i++) {
      t.fromArray(A, i * 16);
      const world = new THREE.Matrix4().multiplyMatrices(o.matrixWorld, t);
      world.decompose(p, q, s);
      const sizeM = Math.max(s.x, s.y, s.z) / U;
      if (!(sizeM > 1e-4)) continue; // 이미 비운 자리
      candidates.push({
        mesh: o,
        i,
        world,
        sizeM,
        id: ids?.[i],
        shapeIndex: o.userData.shapeIndex as number | undefined,
        distance: p.distanceToSquared(camera.position),
      });
    }
  }
  let chosen = candidates;
  if (item.최소키 != null) chosen = chosen.filter((c) => c.sizeM >= item.최소키! && c.sizeM < (item.sizeUpper ?? Infinity));
  if (item.최대) chosen = [...chosen].sort((a, b) => a.distance - b.distance).slice(0, item.최대);
  if (item.길피하기) {
    const pathPieces = collectPathPieces(scene);
    const pos = new THREE.Vector3();
    const before = chosen.length;
    const options = typeof item.길피하기 === "object" ? item.길피하기 : {};
    chosen = chosen.filter((c) => {
      pos.setFromMatrixPosition(c.world);
      return canPlant(pos.x / U, pos.z / U, c.id ?? c.i, pathPieces, options);
    });
    grassThinning.byGroup[item.target] = [chosen.length, before]; // 개발 확인용 — [남김, 전체]
  }
  // ※ 원본은 건드리지 않는다 — 원본 무리는 등록부(publicAssetRegistry)대로 압축되어 그 자리를 스스로 뺀다
  // 자리마다 파일을 번갈아 — 파일별로 한 무리
  const byFile: Candidate[][] = item.bundles.map(() => []);
  // 파일 고르기는 **편집 번호**로 — 다른 것을 옮기거나 지워도 이 자리의 모양이 바뀌지 않는다
  chosen.forEach((c) => byFile[Math.floor(hash01((c.id ?? c.i) * 7919 + 17) * item.bundles.length)].push(c));
  const meshes: THREE.InstancedMesh[] = [];
  let triangles = 0;
  const lodPairs: LodPair[] = [];
  byFile.forEach((list, f) => {
    if (!list.length) return;
    const make = (source: Bundle) => {
      const bundle = cloneBundle(source);
      let matrices = list.map((c) => c.world.clone().premultiply(inverse));
      if (item.맞춤 === "실제") {
        const box = bundleBox(bundle);
        const center = box.getCenter(new THREE.Vector3());
        for (const { geometry } of bundle) geometry.translate(-center.x, -box.min.y - (item.묻기 ?? 0.15), -center.z);
        const [a, b] = item.배율 ?? [1, 1];
        const pp = new THREE.Vector3();
        const qq = new THREE.Quaternion();
        const ss = new THREE.Vector3();
        matrices = list.map((c, k) => {
          c.world.decompose(pp, qq, ss);
          const e = new THREE.Euler().setFromQuaternion(qq, "YXZ");
          const factor = U * (a + (b - a) * hash01(c.i * 131 + k));
          return new THREE.Matrix4()
            .compose(pp, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, e.y, 0)), new THREE.Vector3(factor, factor, factor))
            .premultiply(inverse);
        });
      } else if (item.맞춤 === "높이") fitHeight(bundle, list[0].mesh.geometry);
      else fitFootprint(bundle, list[0].mesh.geometry);
      // ★ 흔들기 — 같은 풀·꽃을 듬성듬성 여럿 놓을 때 **크기 · 바라보는 방향 · 살짝 기울기**를 자리마다 다르게 (10/13 미르)
      //   자리 번호로 정하므로 근경판·원경판이 같은 모양으로 맞물리고, 새로 고쳐도 바뀌지 않는다.
      //   manifest: "흔들기": { "배율": [최소, 최대], "기울기": 도 } — 회전은 늘 0~360°
      if (item.흔들기) {
        const [a, b] = item.흔들기.배율 ?? [0.75, 1.3];
        const tilt = THREE.MathUtils.degToRad(item.흔들기.기울기 ?? 5);
        const R = new THREE.Matrix4();
        const E = new THREE.Euler();
        matrices.forEach((M, k) => {
          const n = list[k].id ?? list[k].i;
          const factor = a + (b - a) * hash01(n * 31 + 7);
          E.set((hash01(n * 17 + 3) - 0.5) * 2 * tilt, hash01(n * 13 + 1) * Math.PI * 2, (hash01(n * 19 + 5) - 0.5) * 2 * tilt, "YXZ");
          M.multiply(R.makeRotationFromEuler(E).scale(new THREE.Vector3(factor, factor, factor)));
        });
      }
      // ★ 키 상한 — 잡초·꽃은 실제 크기에 한계가 있다. 넘는 자리는 상한까지 줄인다(10/13 미르).
      //   갈대처럼 긴 풀은 `긴풀` 에 파일 앞머리별 상한을 따로 준다. 단위 m.
      if (item.키상한m) {
        const fileName = item.files?.[f] ?? ""; // 근경·원경판 모두 같은 칸(f)의 파일
        let limit = item.키상한m;
        for (const [prefix, m] of Object.entries(item.긴풀 ?? {})) if (fileName.startsWith(prefix)) limit = m;
        const box = bundleBox(bundle);
        const height = box.max.y - box.min.y;
        const v = new THREE.Vector3();
        for (const M of matrices) {
          const realHeightM = (height * v.setFromMatrixColumn(M, 1).length()) / U;
          if (realHeightM > limit) M.multiply(new THREE.Matrix4().makeScale(limit / realHeightM, limit / realHeightM, limit / realHeightM));
        }
      }
      return { bundle, matrices };
    };
    const near = make(item.bundles[f]);
    const nearMeshes = buildInstancedMeshes(parent, near.bundle, near.matrices, item.target);
    // ★ 편집기가 교체본을 **원래 무리의 그 번호**로 집게 한다(선택·이동·수정 → edits.json → 원본이 다시 서면 교체본도 따라 선다)
    const idTable = Int32Array.from(list, (c) => c.id ?? -1);
    // ※ 「실제」 크기 맞춤은 행렬의 크기가 원본 `키` 와 달라서, 집어 옮기면 원본 키가 망가진다 → 편집 대상에서 뺀다
    const markEditable = (ms: THREE.InstancedMesh[], ids: Int32Array) => {
      if (item.맞춤 === "실제") return;
      for (const m of ms) {
        m.userData.groupId = item.target;
        m.userData.ids = ids;
        m.userData.shapeIndex = list[0].shapeIndex;
        m.userData.publicAssetReplacement = true;
      }
    };
    markEditable(nearMeshes, idTable);
    meshes.push(...nearMeshes);
    triangles += triangleCount(near.bundle) * list.length;
    const farBundle = item.farBundles?.[f];
    if (farBundle) {
      // 원경판 — 같은 자리 목록. 0.5초마다 카메라 거리로 나눠 담는다(publicAssets.tsx 「원근 나눔」)
      const far = make(farBundle);
      const farMeshes = buildInstancedMeshes(parent, far.bundle, far.matrices, `${item.target}·원경`);
      markEditable(farMeshes, idTable);
      meshes.push(...farMeshes);
      const positions = near.matrices.map((M) => new THREE.Vector3().setFromMatrixPosition(M).applyMatrix4(parent.matrixWorld));
      for (const m of [...nearMeshes, ...farMeshes]) m.userData.lodPaired = true;
      lodPairs.push({ nearMeshes, farMeshes, nearMatrices: near.matrices, farMatrices: far.matrices, positions, idTable });
    }
  });
  return { signature, meshes, triangles, lodPairs, label: `${item.target} ${chosen.length}개` };
}

// ── 덮기 (한 번만) ──
/** 대상 땅이 아직 안 섰으면 null — 다음 틱에 */
export function buildCover(
  item: CoverItem,
  index: number,
  ctx: BuildContext,
  cutFaces: Record<string, [number, number, number]> | null,
): BuiltEntry | null {
  if (!item.bundles.length) return null;
  const { scene, parent, inverse } = ctx;
  const targets: THREE.Mesh[] = [];
  for (const name of item.대상 || ["절벽면", "땅"]) {
    const meshName = COVER_TARGET_NAMES[name] ?? name;
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh && o.name === meshName && o.visible)
        targets.push(o as THREE.Mesh);
    });
    if (targets.length) break;
  }
  if (!targets.length) return null;
  const units = item.bundles.map((source, fileIndex) => {
    const bundle = cloneBundle(source);
    normalizeToUnit(bundle);
    // 축 순서 — 가장 얇은 축을 벽 법선에, 가장 긴 축을 벽 위쪽(세로 결)에 맞춘다.
    //   → 바위가 벽에 「판」처럼 겹겹이 붙어 암벽 피부가 된다(공처럼 박힌 돌이 아니라).
    const size = bundleBox(bundle).getSize(new THREE.Vector3()).toArray();
    const order = [0, 1, 2].sort((i, j) => size[i] - size[j]); // [얇은, 중간, 긴]
    // 잘린 면 붙이기용: 방향 d, d 방향으로의 앞끝·뒤끝, d 에 수직인 긴 축
    // 흰 잘린 면 방향 — manifest 「잘린면」에 오프라인으로 잰 값이 있으면 그것(텍스처 밝기로 찾은 것)을 쓴다
    const measured = cutFaces?.[(item.files || [])[fileIndex]];
    const d = measured ? new THREE.Vector3(...measured).normalize() : cutFaceDirection(bundle);
    let front = -Infinity;
    let back = Infinity;
    for (const { geometry } of bundle) {
      const P = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < P.count; i++) {
        const v = P.getX(i) * d.x + P.getY(i) * d.y + P.getZ(i) * d.z;
        if (v > front) front = v;
        if (v < back) back = v;
      }
    }
    const longAxis = new THREE.Vector3().setComponent(order[2], 1);
    if (Math.abs(longAxis.dot(d)) > 0.9) longAxis.set(0, 0, 0).setComponent(order[1], 1);
    longAxis.addScaledVector(d, -longAxis.dot(d)).normalize();
    return { bundle, order, thickness: size[order[0]], d, front, back, longAxis };
  });
  const ray = new THREE.Raycaster();
  const direction = new THREE.Vector3(0, 0, -1);
  const [x0, x1] = item.X;
  const [y0, y1] = item.Y;
  const gap = item.간격 ?? 3;
  const rowGap = item.세로간격 ?? gap * 0.8;
  const [small, big] = item.크기 ?? [2.5, 4.5];
  const byFile: THREE.Matrix4[][] = units.map(() => []);
  const coverIdsByFile: string[][] = units.map(() => []);
  const n = new THREE.Vector3();
  const up = new THREE.Vector3();
  const side = new THREE.Vector3();
  const axes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const basis = new THREE.Matrix4();
  const scale = new THREE.Matrix4();
  const seed = (item.씨 ?? 1) * 100003;
  let k = 0;
  let droppedForPath = 0;
  for (let y = y0; y <= y1; y += rowGap) {
    for (let x = x0; x <= x1; x += gap) {
      k++;
      // 정렬: 벽돌 쌓듯 줄마다 반 칸 어긋나게, 흔들림은 작게 — 실사 앙암바위의 큰 덩어리 + 세로 절리
      const row = Math.round((y - y0) / rowGap);
      const jitter = item.정렬 ? (item.흔들림 ?? 0.12) : 0.9;
      const jx = x + (item.정렬 && row % 2 ? gap / 2 : 0) + (hash01(seed + k * 3) - 0.5) * gap * jitter;
      const jy = y + (hash01(seed + k * 5) - 0.5) * rowGap * (item.정렬 ? jitter : 0.8);
      ray.set(new THREE.Vector3(jx * U, jy * U, (item.Z시작 ?? 34) * U), direction);
      const hit = ray.intersectObjects(targets, false)[0];
      if (!hit?.face) continue;
      n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
      if (n.z < 0) n.negate();
      if (Math.abs(n.y) >= (item.가파름 ?? 0.6)) continue; // 바닥·선반은 건너뛴다(사람·길)
      // 정렬: 맞은 면의 울퉁불퉁한 법선 대신 **절벽 전체의 방향**(74° 빗면, +Z)을 쓴다 → 판이 한 방향으로 나란히 선다
      if (item.정렬) n.set(0, 0.27, 0.96).normalize();
      // 절벽 띠(Z 범위, m) 밖에 맞은 것은 버린다 — 언덕길 비탈에 맞아 길을 막은 바위가 있었다(10/13)
      if (item.Z범위) {
        const zm = hit.point.z / U;
        if (zm < item.Z범위[0] || zm > item.Z범위[1]) continue;
      }
      // 사람이 Alt+클릭으로 뺀 판(로컬 기록)
      const coverId = `${index}-${k}`;
      if (hiddenCovers.has(coverId)) continue;
      const f = Math.floor(hash01(seed + k * 31) * units.length);
      const { order, thickness, d, front, back, longAxis } = units[f];
      const sizeU = (small + (big - small) * hash01(seed + k * 11)) * U; // 가장 긴 변(m→유닛)
      // 벽 위쪽 = 월드 위를 벽면에 투영 → 조금 비튼다
      up.set(0, 1, 0).addScaledVector(n, -n.y).normalize();
      up.applyAxisAngle(n, (hash01(seed + k * 13) - 0.5) * (item.비틀기 ?? 0.7));
      side.crossVectors(up, n);
      let spot: THREE.Vector3;
      if (item.잘린면붙이기) {
        // 로컬 [d, 긴축, d×긴축] → 월드 [−n(벽 속), 위, (−n)×위] — 잘린 면이 벽을 보고, 긴 축은 세로(절리)로
        const L = new THREE.Matrix4().makeBasis(d, longAxis, new THREE.Vector3().crossVectors(d, longAxis));
        const inward = n.clone().negate();
        const W = new THREE.Matrix4().makeBasis(inward, up, new THREE.Vector3().crossVectors(inward, up));
        basis.copy(W).multiply(L.clone().transpose());
        // 잘린 면을 벽면에서 (묻힘 × 두께) 만큼 더 안쪽에 둔다 → 겉으로는 바위 결만 남는다
        const depth = (front - back) * sizeU;
        spot = hit.point.clone().addScaledVector(n, front * sizeU - (item.묻힘 ?? 0.5) * depth);
      } else {
        // 바위 로컬 축(얇은/중간/긴) → 월드(법선/옆/위)
        axes[order[0]].copy(n);
        axes[order[1]].copy(side);
        axes[order[2]].copy(up);
        basis.makeBasis(axes[0], axes[1], axes[2]);
        if (basis.determinant() < 0) {
          axes[order[1]].negate();
          basis.makeBasis(axes[0], axes[1], axes[2]);
        }
        // 묻힘 = 두께 중 벽 안으로 들어가는 비율 (0.5 면 반쯤 튀어나옴)
        spot = hit.point.clone().addScaledVector(n, thickness * sizeU * (0.5 - (item.묻힘 ?? 0.5)));
      }
      // 길을 덮은 판은 버린다(T4 하강로 · 10/14)
      if (pathIntrusion(spot.x / U, spot.y / U, spot.z / U, sizeU / U / 2)) {
        droppedForPath++;
        continue;
      }
      scale.makeScale(sizeU, sizeU, sizeU);
      const M = new THREE.Matrix4().makeTranslation(spot.x, spot.y, spot.z).multiply(basis).multiply(scale);
      M.premultiply(inverse);
      byFile[f].push(M);
      coverIdsByFile[f].push(coverId);
    }
  }
  const meshes: THREE.InstancedMesh[] = [];
  let triangles = 0;
  let count = 0;
  byFile.forEach((list, f) => {
    if (!list.length) return;
    const built = buildInstancedMeshes(parent, units[f].bundle, list, "덮기");
    for (const m of built) m.userData.coverIds = [...coverIdsByFile[f]];
    meshes.push(...built);
    triangles += triangleCount(units[f].bundle) * list.length;
    count += list.length;
  });
  if (droppedForPath) console.info(`[publicAssets] 덮기${index}: 길을 덮은 판 ${droppedForPath}개 뺌`);
  return { signature: "", meshes, triangles, label: `덮기${index} ${count}개` };
}

// ── 놓기 (한 번만) — 땅 높이에 밑면을 붙여 세운다. 키m = 실제 높이(m) ──
export function buildPlace(
  item: PlaceItem,
  index: number,
  ctx: BuildContext,
  groundAt: (x: number, z: number) => { y: number } | null | undefined,
): BuiltEntry | null {
  if (!item.bundles.length) return null;
  const { parent, inverse } = ctx;
  const bundle = cloneBundle(item.bundles[0]);
  const box = bundleBox(bundle);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  for (const { geometry } of bundle) geometry.translate(-center.x, -box.min.y, -center.z);
  const factor = ((item.키m ?? 1) * U) / (size.y || 1);
  const matrices: THREE.Matrix4[] = [];
  for (const [x, z, rotationDeg = 0, heightFactor = 1] of item.자리 || []) {
    const ground = groundAt(x, z);
    if (!ground) continue;
    const sc = factor * heightFactor;
    const M = new THREE.Matrix4()
      .makeTranslation(x * U, (ground.y - (item.묻힘m ?? 0)) * U, z * U)
      .multiply(new THREE.Matrix4().makeRotationY((rotationDeg * Math.PI) / 180))
      .multiply(new THREE.Matrix4().makeScale(sc, sc, sc));
    M.premultiply(inverse);
    matrices.push(M);
  }
  if (!matrices.length) return null;
  const meshes = buildInstancedMeshes(parent, bundle, matrices, "놓기");
  // 「차단물」이 적힌 놓기(10/14) — 그 차단물의 겉돌이다. 씬이 끝나 차단물이 치워지면 같이 가라앉아 사라진다.
  return {
    signature: "",
    meshes,
    triangles: triangleCount(bundle) * matrices.length,
    label: `놓기${index} ${matrices.length}개`,
    blocker: item.차단물 ?? null,
    sinkStartedAt: null,
    sinkDepth: ((item.키m ?? 1) * 1.6 + 1) * U,
  };
}
