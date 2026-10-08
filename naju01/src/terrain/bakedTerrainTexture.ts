// Meshy 가 구운 지형 텍스처 세 장을 우리 지형 메시에 입히고 뗀다.
// Meshy 는 메시를 단위 상자로 정규화하고 정점도 용접해 돌려준다. 그 메시를 쓰면 좌표를 되돌리는 동안 판정과 어긋날 수 있다.
// 그런데 UV 는 넘긴 그대로(소수점까지) 돌아온다 — 그래서 기하는 버리고 그림만 우리 메시에 붙인다. 판정은 한 점도 안 건드린다.
// glTF 는 UV 원점이 왼쪽 위라 flipY 를 끈다. 원래 재질을 기억해 두었다가 끄면 그대로 되돌린다(Leva A/B).

import * as THREE from "three";

import { isMesh } from "../loaders/glbImport";
import { applyCellUv, applyRockUv, findCell, ROCK_TARGETS } from "./terrainAtlas";

const TEXTURE_URLS = {
  baseColor: new URL("../../assets/terrain/base-color.jpg", import.meta.url).href,
  roughnessMetalness: new URL("../../assets/terrain/roughness-metalness.jpg", import.meta.url).href,
  normal: new URL("../../assets/terrain/normal.jpg", import.meta.url).href,
};

let materialPromise: Promise<THREE.MeshStandardMaterial> | null = null;

function loadMaterial() {
  if (materialPromise) return materialPromise;
  const loader = new THREE.TextureLoader();
  const load = (url: string, colorSpace: THREE.ColorSpace) =>
    new Promise<THREE.Texture>((resolve, reject) =>
      loader.load(
        url,
        (t) => {
          t.flipY = false; // glTF 규약
          t.colorSpace = colorSpace;
          t.anisotropy = 8;
          t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
          resolve(t);
        },
        undefined,
        reject,
      ),
    );
  materialPromise = Promise.all([
    load(TEXTURE_URLS.baseColor, THREE.SRGBColorSpace),
    load(TEXTURE_URLS.roughnessMetalness, THREE.NoColorSpace),
    load(TEXTURE_URLS.normal, THREE.NoColorSpace),
  ]).then(([baseColor, roughnessMetalness, normal]) => {
    return new THREE.MeshStandardMaterial({
      map: baseColor,
      // glTF 규약: 같은 그림의 G 채널이 거칠기, B 채널이 금속
      roughnessMap: roughnessMetalness,
      metalnessMap: roughnessMetalness,
      roughness: 1,
      metalness: 1,
      normalMap: normal,
      // 정점색은 그늘 계수로 바꿔 쓴다(toShadeFactor)
      vertexColors: true,
    });
  });
  return materialPromise;
}

const savedMaterials = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
const savedColors = new WeakMap<THREE.BufferGeometry, THREE.TypedArray>();

/**
 * 정점색에서 밝기만 뽑아 평균으로 나눈다 — 색조는 빠지고 굴곡·접지 그늘(가짜 AO)만 남는 곱셈 계수가 된다.
 * 구운 그림엔 음영이 없어(remove_lighting) 정점색을 그냥 끄면 절벽이 평면처럼 보인다.
 */
function toShadeFactor(geo: THREE.BufferGeometry) {
  const c = geo.attributes.color;
  if (!c) return false;
  const n = c.count;
  const original = c.array.slice();
  let sum = 0;
  const brightness = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l = 0.2126 * c.getX(i) + 0.7152 * c.getY(i) + 0.0722 * c.getZ(i);
    // 정점색에 NaN 이 섞이면 계수가 통째로 NaN 이 되어 그 면이 검게 죽는다
    brightness[i] = Number.isFinite(l) ? l : 1;
    sum += brightness[i];
  }
  const mean = sum / Math.max(1, n) || 1;
  const factors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // 묶지 않으면 어두운 정점이 새까맣게 죽는다
    const r = brightness[i] / mean;
    const g = Number.isFinite(r) ? Math.min(1.25, Math.max(0.62, r)) : 1;
    factors[i * 3] = factors[i * 3 + 1] = factors[i * 3 + 2] = g;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(factors, 3));
  return original;
}

/** 씬의 지형 메시에 구운 재질을 입히거나(enabled) 원래대로 되돌린다. 손댄 메시 수를 돌려준다. */
export async function applyBakedTerrainTexture(scene: THREE.Object3D, enabled: boolean) {
  const material = enabled ? await loadMaterial() : null;
  let touched = 0;
  scene.traverse((o) => {
    if (!isMesh(o)) return;
    const geo = o.geometry;
    const cell = findCell(o.name);
    const isRock = !cell && ROCK_TARGETS.includes(o.name);
    if (!cell && !isRock) return;
    if (material) {
      if (!savedMaterials.has(o)) savedMaterials.set(o, o.material);
      // 지형은 내보낼 때와 같은 규칙으로, 흩어진 돌은 상자 투영으로
      if (!geo.userData.bakedUv) {
        if (cell) applyCellUv(geo, cell);
        else applyRockUv(geo);
        geo.userData.bakedUv = true;
      }
      if (!savedColors.has(geo)) {
        const original = toShadeFactor(geo);
        if (original) savedColors.set(geo, original);
      }
      o.material = material;
    } else {
      const saved = savedMaterials.get(o);
      if (saved) {
        o.material = saved;
        const original = savedColors.get(geo);
        if (original) {
          geo.setAttribute("color", new THREE.BufferAttribute(original, 3));
          savedColors.delete(geo);
        }
      }
    }
    touched++;
  });
  return touched;
}
