// 게임 공간 전체를 캐릭터와 같은 cel 질감으로 — 런타임에서만 바꾼다.
// PBR 질감은 GLB 가 물고 오는 MeshStandardMaterial(지형·모형·바위)이라 컴포넌트를 고쳐서는 못 잡는다.
// 씬을 훑어 표준/물리/램버트/퐁 재질을 MeshToonMaterial 로 갈아 끼우고, 이미 툰인 재질은 같은 그라디언트 맵으로 계단만 맞춘다.
// 건드리지 않는 것: 플레이어 캐릭터(avatar/toonMaterial 이 맡는다)와 외곽선 껍데기, Basic(하늘·구름·라벨), Shader,
// 결·잔결 셰이더 훅이 붙은 재질.

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";

import { TOON_UNIFORMS_KEY, toonGradientMap } from "../avatar/toonMaterial";
import { isMesh } from "../loaders/glbImport";

type ConvertibleMaterial = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | THREE.MeshPhongMaterial;

const CONVERTIBLE_TYPES = new Set([
  "MeshStandardMaterial",
  "MeshPhysicalMaterial",
  "MeshLambertMaterial",
  "MeshPhongMaterial",
]);

const isConvertible = (m: THREE.Material): m is ConvertibleMaterial => CONVERTIBLE_TYPES.has(m.type);

const materialList = (object: THREE.Mesh) => (Array.isArray(object.material) ? object.material : [object.material]);

// NPC 모형(아비사·어부 등) 같은 SkinnedMesh 는 세계와 같이 바꿔야 질감이 맞는다
function shouldSkip(object: THREE.Mesh) {
  if (object.name.includes("outline")) return true;
  return materialList(object).some((m) => m?.userData[TOON_UNIFORMS_KEY]);
}

function toToon(source: ConvertibleMaterial, gradientMap: THREE.Texture) {
  const material = new THREE.MeshToonMaterial({
    map: source.map ?? null,
    color: source.color ? source.color.clone() : new THREE.Color(0xffffff),
    vertexColors: source.vertexColors,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    alphaMap: source.alphaMap ?? null,
    side: source.side,
    emissive: source.emissive ? source.emissive.clone() : new THREE.Color(0x000000),
    emissiveMap: source.emissiveMap ?? null,
    emissiveIntensity: source.emissiveIntensity ?? 1,
    // 구운 그늘(AO·라이트맵)은 형태를 잡아 주므로 남긴다. 법선·거칠기·금속·환경맵은 버린다.
    aoMap: source.aoMap ?? null,
    aoMapIntensity: source.aoMapIntensity ?? 1,
    lightMap: source.lightMap ?? null,
    lightMapIntensity: source.lightMapIntensity ?? 1,
    fog: source.fog,
    depthWrite: source.depthWrite,
    depthTest: source.depthTest,
    toneMapped: source.toneMapped,
    gradientMap,
  });
  material.name = `${source.name || "재질"}_세계툰`;
  material.userData.worldToonSource = source;
  return material;
}

interface WorldToonStats {
  meshes: number;
  materials: number;
  rampMaterials: number;
}

/** 씬 전체를 툰으로. 여러 번 불러도 된다 — 나중에 들어온 메시만 추가로 바꾼다. */
function applyWorldToon(scene: THREE.Object3D, { steps, threshold }: { steps: number; threshold: number }) {
  const gradientMap = toonGradientMap(steps, threshold);
  // 같은 재질을 나눠 쓰는 메시는 툰 재질도 하나로
  const converted = new Map<THREE.Material, THREE.MeshToonMaterial>();
  const changedMeshes: { object: THREE.Mesh; original: THREE.Material | THREE.Material[] }[] = [];
  const rampChanged: { material: THREE.MeshToonMaterial; originalMap: THREE.Texture | null }[] = [];

  const update = () => {
    scene.traverse((object) => {
      if (!isMesh(object) || shouldSkip(object)) return;
      let changed = false;
      const next = materialList(object).map((m: THREE.Material) => {
        if (!m) return m;
        if (m.userData.worldToonSource) return m; // 이미 우리가 바꾼 것
        if (m.userData[TOON_UNIFORMS_KEY]) return m; // 캐릭터 툰 재질
        if ((m as THREE.MeshToonMaterial).isMeshToonMaterial) {
          const toonMaterial = m as THREE.MeshToonMaterial;
          if (toonMaterial.gradientMap !== gradientMap && !toonMaterial.userData.worldToonRamp) {
            rampChanged.push({ material: toonMaterial, originalMap: toonMaterial.gradientMap });
            toonMaterial.userData.worldToonRamp = true;
            toonMaterial.gradientMap = gradientMap;
            toonMaterial.needsUpdate = true;
          }
          return m;
        }
        if (!isConvertible(m)) return m; // Basic·Shader 등
        if (m.userData.groundGrainAttached || m.userData.waterRipplesAttached) return m; // 셰이더 훅이 붙은 재질
        let toon = converted.get(m);
        if (!toon) {
          toon = toToon(m, gradientMap);
          converted.set(m, toon);
        }
        changed = true;
        return toon;
      });
      if (!changed) return;
      changedMeshes.push({ object, original: object.material });
      object.material = Array.isArray(object.material) ? next : next[0];
    });
  };

  const restore = () => {
    changedMeshes.forEach(({ object, original }) => {
      // 그 사이 다른 코드(구운 지형 스위치 등)가 재질을 바꿨으면 그쪽을 존중한다
      if (materialList(object).every((m) => m?.userData.worldToonSource)) object.material = original;
    });
    changedMeshes.length = 0;
    converted.forEach((toon) => toon.dispose());
    converted.clear();
    rampChanged.forEach(({ material, originalMap }) => {
      material.gradientMap = originalMap;
      delete material.userData.worldToonRamp;
      material.needsUpdate = true;
    });
    rampChanged.length = 0;
  };

  const stats = (): WorldToonStats => ({
    meshes: changedMeshes.length,
    materials: converted.size,
    rampMaterials: rampChanged.length,
  });

  update();
  return { update, restore, stats };
}

interface WorldToonProps {
  enabled?: boolean;
  steps?: number;
  threshold?: number;
  intervalMs?: number;
}

/**
 * 씬 안에 두면 알아서 돈다. 소품·지형·NPC 가 나중에 로드되므로 주기적으로 다시 훑는다.
 * useFrame 에 걸면 뒤에 들어온 NPC 를 놓쳐 PBR 로 남는다 — 타이머로 훑고 바뀌면 invalidate.
 */
export default function WorldToon({ enabled = true, steps = 3, threshold = 0.5, intervalMs = 500 }: WorldToonProps) {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!enabled) return undefined;
    const handle = applyWorldToon(scene, { steps, threshold });
    // 콘솔에서 __game.worldToon.stats() 로 몇 개를 바꿨는지, scene 으로 남은 재질을 훑어볼 수 있다
    if (import.meta.env.DEV) exposeDevHook("worldToon", { ...handle, scene });
    const timer = setInterval(() => {
      const before = handle.stats();
      handle.update();
      const after = handle.stats();
      if (after.meshes !== before.meshes || after.rampMaterials !== before.rampMaterials) invalidate();
    }, intervalMs);
    return () => {
      clearInterval(timer);
      handle.restore();
      invalidate();
    };
  }, [scene, invalidate, enabled, steps, threshold, intervalMs]);
  return null;
}
