/**
 * publicAssetGeometry.ts — 공개 GLB 를 「재질별 지오메트리 묶음」으로 납작하게 만들고, 표본에 맞추는 기하 도구
 * (옛 AI허브전시.jsx 의 납작하게 · 맞추기 · 높이맞추기 · 단위로 · 잘린면방향 · 세우기 · 해시 이식)
 *
 * [옛 이름 → 새 이름]
 *   납작하게 → flattenGltf · 묶음 → Bundle · 묶음상자 → bundleBox · 맞추기 → fitFootprint · 높이맞추기 → fitHeight
 *   단위로 → normalizeToUnit · 잘린면방향 → cutFaceDirection · 세우기 → buildInstancedMeshes · 해시 → hash01
 *   면수 → triangleCount · 툰재질 → toonMaterials · userData.AI허브 → userData.publicAsset
 *   메시 이름 `AI허브:무리` 는 그대로 둔다 — immersion/windShader.findPlants 가 이 앞머리를 떼고 식물을 찾는다.
 */
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { TOON_GRADIENT } from "@/engine/toon";

/** 교체본 InstancedMesh 이름 앞머리 — windShader.findPlants 가 `AI허브:` 를 떼고 무리 이름을 본다 */
export const PUBLIC_ASSET_MESH_PREFIX = "AI허브:";

/** 재질 하나 + 그 재질이 그리는 지오메트리 */
export interface BundlePart {
  material: THREE.Material;
  geometry: THREE.BufferGeometry;
}
export type Bundle = BundlePart[];

type MaybeMapMaterial = THREE.Material & { map?: THREE.Texture | null; alphaTest: number; transparent: boolean };

// 같은 원본 재질 → 같은 툰 재질(파일이 여러 번 읽혀도 재질은 하나)
const toonMaterials = new Map<THREE.Material, THREE.MeshToonMaterial>();

/** GLB 하나를 「재질별 지오메트리 묶음」으로 납작하게 만든다(노드 변환을 지오에 굽는다) */
export function flattenGltf(gltf: GLTF): Bundle {
  gltf.scene.updateMatrixWorld(true);
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  gltf.scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    const g = mesh.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(k)) g.deleteAttribute(k);
    // ★ 경량본은 좌표가 **정수 양자화**(KHR_mesh_quantization)로 들어온다. 그대로 applyMatrix4 하면
    //   -1~1 로 잘려서 집이 상자 모양으로 찌그러진다(10/13 실제로 겪음) → Float32 로 푼 뒤 굽는다.
    for (const k of Object.keys(g.attributes)) {
      const a = g.attributes[k] as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
      if (
        a.array instanceof Float32Array &&
        !a.normalized &&
        !(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
      )
        continue;
      const f = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
      g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
    }
    g.applyMatrix4(mesh.matrixWorld);
    // 법선 없는 공개 3D 스캔(10/13 Sketchfab 일부)은 빛을 못 받아 새까맣게 나온다 → 다시 계산
    if (!g.attributes.normal) g.computeVertexNormals();
    const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MaybeMapMaterial;
    let key: THREE.Material = source;
    // ★ 툰판(10/13): 꼭짓점 색이 구워져 온 파일은 게임과 같은 툰 재질로 그린다.
    //   불투명은 면마다 각지게(toNonIndexed + 법선 다시) — 기존 그레이박스의 각진 저폴리 화풍과 맞춘다.
    //   잎 카드(알파)는 흰색+알파 텍스처를 모양(오려내기)으로만 쓴다.
    if (g.attributes.color) {
      const isAlpha = !!source?.map && (source.alphaTest > 0 || source.transparent);
      // 애니화본의 덩어리(재질 이름 「부드럽게」)는 매끈한 법선 그대로 — 각지게 만들면 구름 덩어리가 깨진다(10/14)
      const isSmooth = /부드럽게/.test(source?.name || "");
      if (!isAlpha && g.index && !isSmooth) {
        const n = g.toNonIndexed();
        g.dispose();
        n.computeVertexNormals();
        g.copy(n);
      } else if (!g.attributes.normal) g.computeVertexNormals();
      let toon = toonMaterials.get(source);
      if (!toon) {
        toon = new THREE.MeshToonMaterial({
          name: source?.name || "",
          vertexColors: true,
          gradientMap: TOON_GRADIENT,
          side: THREE.DoubleSide,
          map: isAlpha ? source.map : null,
          alphaTest: isAlpha ? 0.5 : 0,
        });
        toonMaterials.set(source, toon);
      }
      key = toon;
    }
    // 원본 FBX 재질은 전부 양면이다 — 단면이면 안쪽 면이 빠져 이상하게 보인다
    if (key && key.side !== THREE.DoubleSide) {
      key.side = THREE.DoubleSide;
      key.needsUpdate = true;
    }
    if (!byMaterial.has(key)) byMaterial.set(key, []);
    byMaterial.get(key)!.push(g);
  });
  return [...byMaterial].map(([material, gs]) => ({
    material,
    geometry: gs.length === 1 ? gs[0] : mergeGeometries(gs, false),
  }));
}

/** 묶음의 지오메트리만 복제(재질은 공유) — 자리마다 다르게 옮기고 키울 때 */
export const cloneBundle = (bundle: Bundle): Bundle =>
  bundle.map(({ material, geometry }) => ({ material, geometry: geometry.clone() }));

export const bundleBox = (bundle: Bundle): THREE.Box3 => {
  const box = new THREE.Box3();
  for (const { geometry } of bundle) {
    geometry.computeBoundingBox();
    if (geometry.boundingBox) box.union(geometry.boundingBox);
  }
  return box;
};

/** 원본 표본 지오의 바닥 크기·밑면에 맞춰 옮기고 키운다(바꿔치기용) */
export function fitFootprint(bundle: Bundle, sample: THREE.BufferGeometry) {
  sample.computeBoundingBox();
  const s = sample.boundingBox;
  if (!s) return;
  const sampleSpan = Math.max(s.max.x - s.min.x, s.max.z - s.min.z);
  const box = bundleBox(bundle);
  const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  if (!(span > 0) || !(sampleSpan > 0)) return;
  const factor = sampleSpan / span;
  const center = box.getCenter(new THREE.Vector3());
  const sampleCenter = s.getCenter(new THREE.Vector3());
  for (const { geometry } of bundle) {
    geometry.translate(-center.x, -box.min.y, -center.z);
    geometry.scale(factor, factor, factor);
    geometry.translate(sampleCenter.x, s.min.y, sampleCenter.z);
  }
}

/** 표본 키(높이)에 맞춘다 — 나무·풀처럼 「키」가 높이인 것(규약: 높이). 밑동을 표본 밑동에. */
export function fitHeight(bundle: Bundle, sample: THREE.BufferGeometry) {
  sample.computeBoundingBox();
  const s = sample.boundingBox;
  if (!s) return;
  const box = bundleBox(bundle);
  const factor = (s.max.y - s.min.y) / (box.max.y - box.min.y || 1);
  const center = box.getCenter(new THREE.Vector3());
  const sampleCenter = s.getCenter(new THREE.Vector3());
  for (const { geometry } of bundle) {
    geometry.translate(-center.x, -box.min.y, -center.z);
    geometry.scale(factor, factor, factor);
    geometry.translate(sampleCenter.x, s.min.y, sampleCenter.z);
  }
}

/** 가운데를 원점에, 가장 긴 변을 1 로(덮기용) */
export function normalizeToUnit(bundle: Bundle) {
  const box = bundleBox(bundle);
  const size = box.getSize(new THREE.Vector3());
  const factor = 1 / (Math.max(size.x, size.y, size.z) || 1);
  const center = box.getCenter(new THREE.Vector3());
  for (const { geometry } of bundle) {
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.scale(factor, factor, factor);
  }
}

/**
 * 스캔 바위의 **잘린 평면**(가장 넓은 평평한 면) 바깥 방향을 찾는다 — 면적 가중 법선을 방향 칸에 모아 가장 큰 칸.
 *   스캔은 밑면·뒷면이 칼로 자른 듯 평평하고 텍스처가 하얗게 비어 있다(10/13 사용자 지적: 「흰 면이 반듯하게 보인다」).
 *   그 면을 절벽 쪽으로 돌려 붙이고 벽 속에 묻으면 바위 결만 겉으로 보인다.
 */
export function cutFaceDirection(bundle: Bundle): THREE.Vector3 {
  const cells = new Map<string, { sum: THREE.Vector3; area: number }>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const nn = new THREE.Vector3();
  for (const { geometry } of bundle) {
    const P = geometry.attributes.position as THREE.BufferAttribute;
    const I = geometry.index;
    const count = I ? I.count : P.count;
    for (let t = 0; t < count; t += 3) {
      const i0 = I ? I.getX(t) : t;
      const i1 = I ? I.getX(t + 1) : t + 1;
      const i2 = I ? I.getX(t + 2) : t + 2;
      a.fromBufferAttribute(P, i0);
      b.fromBufferAttribute(P, i1);
      c.fromBufferAttribute(P, i2);
      nn.subVectors(c, b).cross(b.clone().sub(a)); // 면적 ×2 크기의 법선
      const area = nn.length();
      if (area < 1e-12) continue;
      nn.divideScalar(area);
      const key = `${Math.round(nn.x * 4)},${Math.round(nn.y * 4)},${Math.round(nn.z * 4)}`;
      const r = cells.get(key) || { sum: new THREE.Vector3(), area: 0 };
      r.sum.addScaledVector(nn, area);
      r.area += area;
      cells.set(key, r);
    }
  }
  let best: { sum: THREE.Vector3; area: number } | null = null;
  for (const r of cells.values()) if (!best || r.area > best.area) best = r;
  return best ? best.sum.clone().normalize() : new THREE.Vector3(0, -1, 0);
}

/** 같은 입력이면 같은 값 0~1 (새로고침해도 배치가 안 바뀌게) */
export const hash01 = (n: number): number => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};

export const triangleCount = (bundle: Bundle): number =>
  bundle.reduce(
    (s, { geometry }) => s + (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3,
    0,
  );

/** 묶음을 행렬 목록대로 InstancedMesh(재질마다 하나)로 세워 부모에 붙인다 */
export function buildInstancedMeshes(
  parent: THREE.Object3D,
  bundle: Bundle,
  matrices: THREE.Matrix4[],
  label: string,
): THREE.InstancedMesh[] {
  return bundle.map(({ material, geometry }) => {
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((M, i) => mesh.setMatrixAt(i, M));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = `${PUBLIC_ASSET_MESH_PREFIX}${label}`;
    mesh.userData.publicAsset = true;
    parent.add(mesh);
    return mesh;
  });
}
