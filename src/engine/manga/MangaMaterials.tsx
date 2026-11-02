import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

import { compensate, lampPartColor, paletteColor, textureAverage, vertexColorAverage } from "./palette";
import { paintToonMaterial, zoneKeyUniforms } from "./paintedToon";
import { onMangaSweepRequest } from "./sweepSignal";
import { flattenTexture, releaseFlattened, type FlattenSettings } from "./textureFlatten";

// 구역·들 물건·기차 안이 늦게 붙는다. 씬에 물건이 붙으면(childadded) 다음 확인 때 훑는다 — 늘 훑으면 본부실이 느려졌다.
const CHECK_MS = 100;
// 표식을 못 다는 변화(React 가 색·맵을 바꿔 끼움, 캔버스를 다시 그림)를 잡는 느린 안전망
const SAFETY_SWEEP_MS = 3000;
// 한 번 훑을 때 굽는 텍스처 수 — 처음 켤 때 수십 장을 한 프레임에 구우면 멈칫한다
const BAKES_PER_SWEEP = 12;

/** 로비 캐릭터 툰(나주 아바타 재질)은 따로 맞춘 재질이라 건드리지 않는다 */
const isAvatarMaterial = (material: THREE.Material) => "toonUniforms" in material.userData;

/** 물건마다 두른 껍데기 외곽선 — 엔진 ToonOutline 과 drei <Outlines> 가 같은 셰이더 모양이다 */
function isShellOutline(material: THREE.Material) {
  if (!(material instanceof THREE.ShaderMaterial) || material.side !== THREE.BackSide) return false;
  const uniforms = material.uniforms;
  return "screenspace" in uniforms && "thickness" in uniforms && "size" in uniforms;
}

const isCreaseLine = (material: THREE.Material) => material.userData.isCreaseLine === true;

const materialsOf = (object: THREE.Object3D): THREE.Material[] => {
  const material = (object as THREE.Mesh).material;
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
};

/** 팔레트로 칠한 재질 — 원래 색(팀 값)과 우리가 넣은 색. 넣은 색이 아니면 그 사이 React 가 바꾼 것이다 */
interface Repainted {
  original: THREE.Color;
  applied: THREE.Color;
  /** 면마다 다른 꼭짓점 색을 걷었다(물건) — 만화를 끄면 다시 켠다 */
  vertexColorsOff: boolean;
}

/** 팔레트를 입힐 구역 — 그룹 이름과 밝은 조를 받을지 */
export interface PaletteZone {
  name: string;
  /** 지금 팔레트를 입히고 밝은 조를 켤지 — 복도는 완전 전원 뒤에만(그 전의 어둠은 퍼즐) */
  lit: boolean;
  /** 물건 꼭짓점 색에 깊이 어둠이 구워져 있다 — 걷지 않는다 */
  bakedDepth?: boolean;
  /** 팔레트 색에 곱하는 밝기 — 등이 벽 가까이 촘촘한 구역(복도)은 낮춰야 등 아래 벽이 하얗게 타지 않는다 */
  tone?: number;
}

interface MangaMaterialsProps {
  /** 껍데기 외곽선·주름선을 감추고 깊이 선 하나로 그린다 */
  hideShellLines: boolean;
  /** 텍스처 잔결 펴기. null 이면 원래 텍스처 */
  flatten: FlattenSettings | null;
  /** 팔레트·밝은 조를 입힐 구역들. null 이면 색은 원래대로 */
  palette: { zones: readonly PaletteZone[] } | null;
}

/**
 * 만화 화풍일 때만 붙는다. 씬을 훑어 툰 재질에 칠한 툰을 걸고(텍스처는 편 판으로, 팔레트 구역은 새 바탕색과 밝은 조로),
 * 펜선을 깊이 선 하나로 모은다. 팀이 맞춘 색·외곽선 값·원래 텍스처는 재질에 기억해 두었다가 떼면(또는 ?만화=off) 돌린다.
 */
export default function MangaMaterials(props: MangaMaterialsProps) {
  const { palette } = props;
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  // 설정은 ref 로 읽는다 — 설정이 바뀌어도 아래 한 판(칠한 재질·구운 텍스처)을 허물지 않고 다시 훑기만 한다.
  // 허물고 다시 구우면 복도에 불이 들어오는 순간 텍스처 수십 장을 버리고 새로 구워 0.4초 멈췄다.
  const settings = useRef(props);
  const requestSweep = useRef<() => void>(() => {});
  useEffect(() => {
    settings.current = props;
    requestSweep.current();
  });

  // 구역마다 밝은 조 켜기 — 값은 함께 쓰고 켬 여부만 구역 것(재컴파일 없음)
  useEffect(() => {
    const zones = palette?.zones ?? [];
    for (const zone of zones) zoneKeyUniforms(zone.name).uKeyOn.value = zone.lit ? 1 : 0;
    invalidate();
    return () => {
      for (const zone of zones) zoneKeyUniforms(zone.name).uKeyOn.value = 0;
    };
  }, [palette, invalidate]);

  useEffect(() => {
    const hidden = new Set<THREE.Material>();
    // 편 판 → 원본. React 가 맵을 새것으로 바꿔 끼우면 그 새것이 원본이 된다
    const sourceOf = new Map<THREE.Texture, THREE.Texture>();
    const swapped = new Set<THREE.MeshToonMaterial>();
    const repainted = new Map<THREE.MeshToonMaterial, Repainted>();
    const offsetAdded = new Set<THREE.MeshToonMaterial>();
    let bakes = 0;
    // 재질 → 칠할 때의 구역 이름. 구역이 꺼지면(퍼즐 처음부터) 그 구역 색만 돌린다
    const zoneOfMaterial = new Map<THREE.MeshToonMaterial, string>();

    const restoreHidden = () => {
      hidden.forEach((m) => {
        m.visible = true;
      });
      hidden.clear();
    };
    const restoreMaps = () => {
      swapped.forEach((m) => {
        const source = m.map && sourceOf.get(m.map);
        if (source) m.map = source;
      });
      swapped.clear();
    };
    const restoreColors = (keep: (zone: string | undefined) => boolean) => {
      repainted.forEach(({ original, applied, vertexColorsOff }, m) => {
        if (keep(zoneOfMaterial.get(m))) return;
        if (m.color.equals(applied)) m.color.copy(original);
        if (vertexColorsOff) {
          m.vertexColors = true;
          m.needsUpdate = true;
        }
        if (offsetAdded.delete(m)) m.polygonOffset = false;
        repainted.delete(m);
      });
      lampOriginals.forEach(({ original, applied }, m) => {
        if (keep(m.userData.mangaZone)) return;
        if (m.color.equals(applied)) m.color.copy(original);
        lampOriginals.delete(m);
      });
    };

    const repaint = (m: THREE.MeshToonMaterial, mesh: THREE.Mesh, map: THREE.Texture | null, zone: PaletteZone) => {
      const known = repainted.get(m);
      if (known && m.color.equals(known.applied)) return false;
      // 처음 보거나, 넣은 색이 아니면(React 가 팀 값을 다시 넣었다) 지금 색이 원래 색이다
      const original = m.color.clone();
      const textureTint = textureAverage(map);
      const vertexTint = m.vertexColors ? vertexColorAverage(mesh.geometry) : new THREE.Color(1, 1, 1);
      const seen = original.clone().multiply(textureTint).multiply(vertexTint);
      const target = paletteColor(m, seen);
      if (!target) {
        repainted.set(m, { original, applied: original.clone(), vertexColorsOff: known?.vertexColorsOff ?? false });
        return false;
      }
      // 물건의 꼭짓점 색은 면마다 달라(낡음·찌그러짐) 밝은 칠 위에서 삼각형 얼룩이 된다 — 걷고 깨끗한 칠로.
      // 밝은 조 구역만 — 복도는 꼭짓점 색에 깊이 어둠이 구워져 있어 걷으면 물건이 하얗게 뜬다
      const vertexColorsOff =
        (known?.vertexColorsOff ?? false) || (!zone.bakedDepth && !target.surface && m.vertexColors);
      if (vertexColorsOff && m.vertexColors) {
        m.vertexColors = false;
        m.needsUpdate = true;
      }
      // 넓은 면의 꼭짓점 색은 남긴다. 밝은 조 구역만 그 평균으로 나눈다 — 복도는 꼭짓점 색에 깊이 어둠이 구워져 있다
      // 넓은 면은 꼭짓점 색(얼룩·깊이 어둠) 평균으로 나눠 바탕을 표의 색에 맞춘다 — 깊이 어둠의 비율은 그대로 남는다
      const keptVertexTint = target.surface ? vertexTint : new THREE.Color(1, 1, 1);
      const toned = target.color.clone().multiplyScalar(zone.tone ?? 1);
      const applied = target.perceived ? compensate(toned, textureTint, keptVertexTint) : toned;
      // 벽에 붙은 물건(받침·함)이 벽과 같은 면에 있으면 밝은 벽 위에서 깜빡인다 — 물건이 벽보다 살짝 앞에 그려지게
      if (!target.surface && !m.polygonOffset) {
        m.polygonOffset = true;
        m.polygonOffsetFactor = -1;
        m.polygonOffsetUnits = -1;
        offsetAdded.add(m);
      }
      m.color.copy(applied);
      repainted.set(m, { original, applied: applied.clone(), vertexColorsOff });
      zoneOfMaterial.set(m, zone.name);
      return true;
    };

    // 스탠드 전구·갓 안쪽 — 켬/끔 색. 원래 색은 칠한 재질과 같은 표에 기억한다
    const lampOriginals = new Map<THREE.MeshBasicMaterial, Repainted>();
    const recolorLampPart = (m: THREE.MeshBasicMaterial, zone: string) => {
      const known = lampOriginals.get(m);
      if (known && m.color.equals(known.applied)) return false;
      const color = lampPartColor(m);
      if (!color) return false;
      lampOriginals.set(m, { original: m.color.clone(), applied: color.clone(), vertexColorsOff: false });
      m.userData.mangaZone = zone;
      m.color.copy(color);
      return true;
    };

    // zone = 이 물체가 든 팔레트 구역(없으면 null)
    const visit = (object: THREE.Object3D, zone: PaletteZone | null) => {
      const { flatten, hideShellLines } = settings.current;
      let changed = false;
      for (const m of materialsOf(object)) {
        if (m instanceof THREE.MeshToonMaterial) {
          if (isAvatarMaterial(m)) continue;
          if (paintToonMaterial(m, zone?.name ?? null)) changed = true;
          const source = m.map ? (sourceOf.get(m.map) ?? m.map) : null;
          if (zone?.lit && repaint(m, object as THREE.Mesh, source, zone)) changed = true;
          if (!flatten || !source || bakes >= BAKES_PER_SWEEP) continue;
          const flat = flattenTexture(gl, source, flatten);
          const next = flat ?? source;
          if (next !== m.map) {
            if (flat) {
              sourceOf.set(flat, source);
              bakes++;
            }
            m.map = next;
            swapped.add(m);
            changed = true;
          }
        } else if (zone?.lit && m instanceof THREE.MeshBasicMaterial) {
          if (recolorLampPart(m, zone.name)) changed = true;
        } else if (hideShellLines && !hidden.has(m) && (isShellOutline(m) || isCreaseLine(m))) {
          m.visible = false;
          hidden.add(m);
          changed = true;
        }
      }
      return changed;
    };

    const sweep = () => {
      const { flatten, hideShellLines, palette } = settings.current;
      // 꺼진 기능은 그 자리에서 돌린다(구운 텍스처는 버리지 않는다 — 다시 켜면 그대로 쓴다)
      if (!hideShellLines) restoreHidden();
      if (!flatten) restoreMaps();
      const litZones = new Set((palette?.zones ?? []).filter((zone) => zone.lit).map((zone) => zone.name));
      restoreColors((zone) => zone !== undefined && litZones.has(zone));
      let changed = false;
      bakes = 0;
      // 팔레트 구역부터 — 재질의 밝은 조 여부는 처음 칠할 때 정해진다
      const zoneOf = new Map<THREE.Object3D, PaletteZone>();
      for (const zone of palette?.zones ?? [])
        scene.getObjectByName(zone.name)?.traverse((object) => zoneOf.set(object, zone));
      for (const [object, zone] of zoneOf) if (visit(object, zone)) changed = true;
      scene.traverse((object) => {
        if (!zoneOf.has(object) && visit(object, null)) changed = true;
      });
      if (changed) invalidate();
    };
    // 씬에 물건이 붙으면 표시만 해 두고 다음 확인 때 한 번 훑는다
    let dirty = true;
    const markDirty = () => {
      dirty = true;
    };
    const watched = new Set<THREE.Object3D>();
    const watch = () =>
      scene.traverse((object) => {
        if (watched.has(object)) return;
        object.addEventListener("childadded", markDirty);
        watched.add(object);
      });
    const check = () => {
      if (!dirty) return;
      dirty = false;
      sweep();
      watch();
      // 굽기 몫을 다 썼으면 남은 텍스처는 다음 확인 때
      if (bakes >= BAKES_PER_SWEEP) dirty = true;
    };
    requestSweep.current = markDirty;
    check();
    const checkTimer = setInterval(check, CHECK_MS);
    const safetyTimer = setInterval(markDirty, SAFETY_SWEEP_MS);
    const stopListening = onMangaSweepRequest(markDirty);
    return () => {
      clearInterval(checkTimer);
      clearInterval(safetyTimer);
      stopListening();
      requestSweep.current = () => {};
      watched.forEach((object) => object.removeEventListener("childadded", markDirty));
      restoreHidden();
      restoreMaps();
      restoreColors(() => false);
      releaseFlattened();
      invalidate();
    };
  }, [scene, gl, invalidate]);

  return null;
}
