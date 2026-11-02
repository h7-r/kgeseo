import { useEffect, type RefObject } from "react";
import type { Director } from "./immersion/director";
import type { focus } from "./immersion/focusFog";
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";

import type { PresentedControls } from "../app/presentation";
import { applyRealSize, findFirstMesh, parseGlb } from "../loaders/glbImport";
import type { TerrainTeleport } from "../movement/useTerrainMovement";
import { computeEditAnchors, type Edits, type InstanceGroup } from "../placement/instanceGroups";
import { METERS_PER_UNIT, VIEWPOINTS } from "../plan/sitePlan";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { CollapseSequence } from "../story/blockerCollapse";
import { layoutCensus, spaceMask } from "./layoutCensus";
import { RECORD_PROPS, centered } from "../world/recordProps";
import { applyBakedTerrainTexture } from "../terrain/bakedTerrainTexture";
import type { ConnectorRamp } from "../terrain/connectorRamp";
import { bakeUnderpaint, collectTerrain, computeGroundCellRect, exportTerrainGlb } from "../terrain/terrainAtlas";
import type { Terrain } from "./useTerrainLayers";

const DIGIT_INDEX: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4 };

interface NajuDevHookOptions {
  camera: THREE.Camera;
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  terrain: Terrain;
  controls: PresentedControls;
  teleport: RefObject<TerrainTeleport | null>;
  endScene: (sceneNumber: number) => string;
  clearedBlockers: Set<string>;
  collapseRef: RefObject<CollapseSequence | null>;
  ramp: ConnectorRamp | null;
  instanceGroups: InstanceGroup[];
  edits: Edits;
  /** 몰입연출 콘솔 API(옛 window.__연출) · 구역 초점 상태 */
  director?: Director;
  focus?: typeof focus;
}

/** 개발용 `__game.naju` — 헤드리스 스크린샷·콘솔이 쓴다. teleport 를 쓰므로 useTerrainMovement 뒤여야 한다. */
export function useNajuDevHook({
  camera,
  gl,
  scene,
  terrain,
  controls,
  teleport,
  endScene,
  clearedBlockers,
  collapseRef,
  ramp,
  instanceGroups,
  edits,
  director,
  focus,
}: NajuDevHookOptions) {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("naju", {
      camera,
      gl,
      scene,
      terrain,
      controls,
      teleport,
      THREE,
      // Meshy 에 넘길 지형 한 덩이를 뽑는다(굽는 규칙은 terrainAtlas)
      exportTerrainGlb: (options?: Parameters<typeof exportTerrainGlb>[1]) => exportTerrainGlb(scene, options, gl),
      endScene,
      // 몰입연출 — __game.naju.director.beat("단서발견") · .event("구렁이") · .scenePassed(3) · .sceneFog() · .replayCut("Z1") · .state()
      director,
      focus,
      rampMeasurements: () => ramp?.measurements ?? null,
      clearedBlockers: () => [...clearedBlockers],
      collapseStage: () =>
        collapseRef.current ? (collapseRef.current.isDone ? "끝" : collapseRef.current.stage()) : "없음",
      // 세계 사각형 → 아틀라스 사각형(구역별 굽기에서 도구가 쓴다)
      groundCellRect: computeGroundCellRect,
      zoneList: () => terrain.zones.map((z) => ({ code: z.code, x: z.x, z: z.z })),
      // 밑그림 아틀라스를 캔버스로 — 색 대조용
      underpaint: (size = 2048) => {
        const collected = collectTerrain(scene, { vertexColors: true });
        if (!collected) throw new Error("밑그림을 구울 지형 메시가 없다");
        return bakeUnderpaint(gl, collected.geometry, size);
      },
      assets: { parseGlb, firstMesh: findFirstMesh, fitRealSize: applyRealSize },
      // 도구가 Leva 를 안 거치고 구운 텍스처를 껐다 켠다
      bakedTerrain: (enabled: boolean) => applyBakedTerrainTexture(scene, enabled),
      // 손 편집 번호가 가리키는 생성 자리(tools/check-edit-anchors 가 읽는다)
      editAnchors: () => computeEditAnchors(instanceGroups, edits),
      generatedCounts: () => Object.fromEntries(instanceGroups.map((g) => [g.groupId, g.generatedSpots.length])),
      // 코드로 그린 무리 하나 → GLB(미터, 바닥 y=0·가운데 정렬). 라이브러리 임시 입고용(10/19) — base64 로 돌려준다
      exportCodeProp: (groupId: string) => exportCodeProp(instanceGroups, groupId),
      // 사람 공간 역분석(공간 연출 에이전트 A단계, 10/19) — 무리별 자리 분류·밀도·크기
      layoutCensus: () => layoutCensus(terrain, instanceGroups, edits),
      // 기록·의례 소품 코드 모형 → 공용 라이브러리 임시본(codeprops) — 에이전트 시험 「라이브러리에 없음」 채우기(10/19)
      exportRecordProps: async () => {
        const out: string[] = [];
        for (const def of RECORD_PROPS) {
          const { root, boundsM } = centered(def.build());
          const result = await new GLTFExporter().parseAsync(root, { binary: true });
          const bytes = new Uint8Array(result as ArrayBuffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          const meta = { display_name: def.nameKo, group_id: `기록소품.${def.slug}`, category: def.category, tags: def.tags, description: def.description, setting: def.setting, era: "premodern_generic", provider: "팀 제작(코드 모형)", license: "팀 제작", bounds_m: boundsM, generation_queue: true };
          const r = await fetch("/__naju-codeprop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: def.slug, glbBase64: btoa(binary), meta }) });
          out.push(`${def.slug} ${r.status}`);
        }
        return out;
      },
      // 공간 지형 칸 지도 → docs/에셋라이브러리/공간/<slug>.mask.json (공간 구성 단계 배치 코드가 읽는다)
      saveSpaceMask: async (slug = "naju01_angam") => {
        const r = await fetch("/__naju-spacemask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, mask: spaceMask(terrain) }) });
        return r.json();
      },
    });
  }, [
    camera,
    gl,
    scene,
    terrain,
    controls,
    teleport,
    endScene,
    clearedBlockers,
    ramp,
    collapseRef,
    instanceGroups,
    edits,
    director,
    focus,
  ]);
}

/** 개발용 — 숫자키 V1~V3 텔레포트(§4 시야 검증), Shift+숫자 = 그 씬이 끝났다. IME 때문에 e.code 를 쓴다. */
export function useViewpointKeys(
  teleport: RefObject<TerrainTeleport | null>,
  endScene: (sceneNumber: number) => string,
  collapseNoticeRef: RefObject<string>,
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const i = DIGIT_INDEX[e.code];
      if (i === undefined) return;
      if (e.shiftKey) {
        collapseNoticeRef.current = endScene(i + 1);
        return;
      }
      if (i > 2 || !teleport.current) return;
      const v = VIEWPOINTS[i];
      teleport.current(v.x, v.z, v.heading);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [teleport, endScene, collapseNoticeRef]);
}

/** 무리의 첫 모양·첫 자리 크기 그대로 한 개를 GLB 로. 위치·회전은 버리고 크기만 살린다(미터). */
async function exportCodeProp(groups: InstanceGroup[], groupId: string): Promise<{ base64: string; boundsM: number[]; shapes: number }> {
  const group = groups.find((g) => g.groupId === groupId);
  if (!group || !group.batches.length) throw new Error(`무리를 찾지 못했다: ${groupId}`);
  const root = new THREE.Group();
  root.name = groupId;
  const batch = group.batches[0];
  const matrix = new THREE.Matrix4().fromArray(batch.matrices, 0);
  const scale = new THREE.Vector3();
  matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  const geometry = batch.geometry.clone();
  geometry.scale(scale.x * METERS_PER_UNIT, scale.y * METERS_PER_UNIT, scale.z * METERS_PER_UNIT);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  // ★ 바탕색 굽기(10/20): 게임 표본은 꼭짓점 색에 「명암 비율」만 굽고 바탕색은 자리마다 instanceColor 로 곱한다.
  //   그대로 내보내면 라이브러리 임시본이 하얗게 나온다(통발·제상 등) → 첫 자리의 instanceColor 를 꼭짓점 색에 곱해 둔다.
  const base = new THREE.Color(batch.colors[0] ?? 1, batch.colors[1] ?? 1, batch.colors[2] ?? 1);
  const col = geometry.attributes.color as THREE.BufferAttribute | undefined;
  if (col && (base.r < 0.999 || base.g < 0.999 || base.b < 0.999)) {
    for (let i = 0; i < col.count; i++) col.setXYZ(i, Math.min(1, col.getX(i) * base.r), Math.min(1, col.getY(i) * base.g), Math.min(1, col.getZ(i) * base.b));
    col.needsUpdate = true;
  }
  const material =
    (group.material?.clone() as THREE.Material | undefined) ??
    new THREE.MeshStandardMaterial({ vertexColors: Boolean(geometry.attributes.color), roughness: 1, side: group.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
  root.add(new THREE.Mesh(geometry, material));
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  const result = await new GLTFExporter().parseAsync(root, { binary: true });
  const bytes = new Uint8Array(result as ArrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(binary), boundsM: [size.x, size.y, size.z].map((v) => Math.round(v * 100) / 100), shapes: group.batches.length };
}
