/* eslint-disable react-refresh/only-export-components -- 상수·훅을 컴포넌트와 한 파일에 둔다(옛 파일 구조 유지) */
/**
 * publicAssets.tsx — 공개 3D 에셋 교체 층 (옛 scenes/AI허브전시.jsx 의 AI허브바꿔치기 이식, v3 10/13 + 10/14 추가분)
 *   기존 에셋 자리에 공개 3D 경량본을 **바꿔 끼워** 눈으로 확인한다.
 *
 * [켜는 법]  `?aihub&src=sf` (+ `&애니판` 변환판). 스위치·manifest 타입·등록부는 publicAssetManifest.ts,
 *   파일 읽기는 publicAssetLoader.ts, 세 가지 배치 계산은 publicAssetPlacement.ts, 기하 도구는 publicAssetGeometry.ts.
 *   AI허브(_aihub_local, src 없음) 가지는 이식하지 않았다 — publicAssetManifest.ts 머리말 참고.
 *   옛 `?aihub=검수`(진열) · `?aihub=면수`(면수표) 모드도 옮기지 않았다(검수정책이 검수 실행에서 빼는 개발 보조 화면).
 *
 * [이 컴포넌트가 하는 일 — 20 틱마다]
 *   ① 원본 무리 압축   등록부에 든 무리(InstancedMesh.name = 무리 id)에서 교체본이 맡는 자리를 뺀다(compactOriginal)
 *   ② 바꿔치기        서명(원본 배열 정체)이 바뀐 무리만 다시 세운다
 *   ③ 덮기 · 놓기      한 번만(대상 땅이 서야 세운다)
 *   ④ 차단물 겉돌 가라앉히기  clearedBlockers 에 그 차단물이 들면 2.4 초에 걸쳐 땅속으로
 *   ⑤ 원근 나눔       원경판이 있는 바꿔치기는 카메라 22 m(초점 모드 10 m) 안은 근경판, 밖은 원경판
 *   ⑥ 구역 초점 거르기  초점 반경 밖 자리는 빼고(전체보기 땐 되살린다)
 *   Alt+클릭 = 덮기 판 빼기(localStorage) — 검수 정상 모드에선 막는다
 *
 * [옛 이름 → 새 이름]
 *   AI허브바꿔치기 → PublicAssetLayer · 세운 → built · 내무리 → groupRef · 틱 → tick · 초점틱 → focusTick
 *   window.__AI허브집기 → __game.publicAssets.pick(x, y) · window.__AI허브덮기복구 → __game.publicAssets.restoreCovers()
 *   window.__풀솎기 / __풀솎기구역 → __game.publicAssets.grassThinning · window.__공개에셋상태 → __game.publicAssets.status
 *   window.__NAJU.치운차단물() → clearedBlockers prop · window.__NAJU.지형.지면(x,z) → groundAt prop
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

import { UNITS_PER_METER } from "../plan/sitePlan";
import { drawRadius, focus } from "../scene/immersion/focusFog";
import { loadPublicAssetTable, type PublicAssetTable } from "./publicAssetLoader";
import {
  hiddenCovers,
  IS_PUBLIC_ASSETS_ENABLED,
  IS_REVIEW_NORMAL_MODE,
  publicAssetRegistry,
  publicAssetStatus,
  reportAssetFailure,
  saveHiddenCovers,
} from "./publicAssetManifest";
import {
  buildCover,
  buildPlace,
  buildSwap,
  compactOriginal,
  grassThinning,
  type BuildContext,
  type BuiltEntry,
} from "./publicAssetPlacement";

export {
  IS_ANIME_VARIANT,
  IS_PUBLIC_ASSETS_ENABLED,
  publicAssetRegistry,
  publicAssetStatus,
} from "./publicAssetManifest";
export { PUBLIC_ASSET_MESH_PREFIX } from "./publicAssetGeometry";

const U = UNITS_PER_METER;
/** 원경판 경계(m) — 초점 모드에선 안개가 14 m 에서 닫히므로 10 m 로 당긴다(안개 속은 원경판으로 충분) */
const LOD_BOUNDARY_M = 22;
const LOD_BOUNDARY_FOCUSED_M = 10;
/** 차단물 겉돌이 가라앉는 시간(초) */
const SINK_SECONDS = 2.4;

/**
 * 등록부(publicAssetRegistry)를 구독한다 — 「땅.풀」 같은 합본 메시를 숨길지 등을 React 가 다시 판단하게.
 * 예: `const hidden = usePublicAssetRegistry().hiddenGroups.has("땅.풀")` → 풀 합본 메시를 안 그린다.
 */
export function usePublicAssetRegistry() {
  const [, setVersion] = useState(publicAssetRegistry.version);
  useEffect(() => publicAssetRegistry.subscribe(() => setVersion(publicAssetRegistry.version)), []);
  return publicAssetRegistry;
}

interface PublicAssetLayerProps {
  /** 씬이 끝나 치운 차단물 코드(useBlockerCollapse.clearedBlockers) — 「차단물」 놓기가 이걸 보고 가라앉는다 */
  clearedBlockers: Set<string>;
  /** 땅 높이(m → m). terrain.groundAt 또는 (x, z) => ({ y: ground.surface.heightAt(x, z) }) */
  groundAt: (x: number, z: number) => { y: number } | null | undefined;
}

/** `?aihub&src=sf` 가 아니면 아무것도 그리지 않는다. NajuScene 의 InstanceGroupMesh 들과 같은 부모 아래 두면 된다. */
export default function PublicAssetLayer({ clearedBlockers, groundAt }: PublicAssetLayerProps) {
  const [table, setTable] = useState<PublicAssetTable | null>(null);
  const built = useRef(new Map<string, BuiltEntry>()); // 키 → 세운 묶음
  const groupRef = useRef<THREE.Group>(null);
  const tick = useRef(0);
  const focusTick = useRef(0);
  const clearedRef = useRef(clearedBlockers);
  const groundAtRef = useRef(groundAt);
  // 렌더 중 ref 쓰기 금지(react-hooks) — 효과에서 최신 값을 넣는다
  useEffect(() => {
    clearedRef.current = clearedBlockers;
    groundAtRef.current = groundAt;
  }, [clearedBlockers, groundAt]);

  useEffect(() => {
    if (!IS_PUBLIC_ASSETS_ENABLED) return undefined;
    let isAlive = true;
    loadPublicAssetTable(() => isAlive)
      .then((result) => {
        if (isAlive && result) setTable(result);
      })
      .catch((error: unknown) => reportAssetFailure("public-loader", error));
    return () => {
      isAlive = false;
    };
  }, []);

  // Alt+클릭 덮기 판 빼기 · 개발 훅 — 한 번
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!IS_PUBLIC_ASSETS_ENABLED) return undefined;
    const el = gl.domElement;
    const onPointerDown = (ev: PointerEvent) => {
      if (IS_REVIEW_NORMAL_MODE || !ev.altKey || !groupRef.current) return;
      const rect = el.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -((ev.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray
        .intersectObjects(scene.children, true)
        .find((h) => h.object.userData?.coverIds && h.instanceId !== undefined);
      if (!hit || hit.instanceId === undefined) return;
      const id = (hit.object.userData.coverIds as string[])[hit.instanceId];
      hiddenCovers.add(id);
      saveHiddenCovers();
      for (const [key, v] of built.current)
        if (key.startsWith("덮기:")) {
          for (const m of v.meshes) {
            groupRef.current.remove(m);
            m.dispose();
          }
          built.current.delete(key);
        }
      console.info("[publicAssets] 덮기 판 뺌:", id, "(되살리기: __game.publicAssets.restoreCovers())");
      ev.stopPropagation();
      ev.preventDefault();
    };
    el.addEventListener("pointerdown", onPointerDown, true);
    if (import.meta.env.DEV)
      exposeDevHook("publicAssets", {
        registry: publicAssetRegistry,
        status: () => ({ ...publicAssetStatus, failures: [...publicAssetStatus.failures] }),
        grassThinning,
        restoreCovers: () => {
          hiddenCovers.clear();
          saveHiddenCovers();
          location.reload();
        },
        // 진단용 — pick(x, y) 를 부르면 그 화면 점(0~1)에서 광선이 맞는 것들을 보여 준다
        pick: (x = 0.5, y = 0.5) => {
          const ray = new THREE.Raycaster();
          ray.setFromCamera(new THREE.Vector2(x * 2 - 1, -(y * 2 - 1)), camera);
          return ray
            .intersectObjects(scene.children, true)
            .slice(0, 8)
            .map((h) => ({
              name: h.object.name,
              visible: h.object.visible,
              instanceId: h.instanceId,
              groupId: h.object.userData?.groupId,
              id:
                h.instanceId !== undefined
                  ? (h.object.userData?.ids as Int32Array | undefined)?.[h.instanceId]
                  : undefined,
              replacement: !!h.object.userData?.publicAssetReplacement,
              distance: +h.distance.toFixed(1),
            }));
        },
        built: () => [...built.current.values()].map((v) => ({ label: v.label, triangles: v.triangles })),
      });
    return () => el.removeEventListener("pointerdown", onPointerDown, true);
  }, [gl, scene, camera]);

  useFrame(({ scene, camera }) => {
    const group = groupRef.current;
    if (!table || !group || ++tick.current % 20) return;
    group.updateMatrixWorld(true);
    const ctx: BuildContext = {
      scene,
      camera,
      parent: group,
      inverse: new THREE.Matrix4().copy(group.matrixWorld).invert(),
    };
    let changed = false;

    // ── ① 원본 무리 압축 — 등록부가 맡는 자리를 원본에서 뺀다(새로 담긴 무리만) ──
    scene.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh && !o.userData.publicAsset)
        compactOriginal(o as THREE.InstancedMesh);
    });

    // ── ② 바꿔치기 ──
    table.swaps.forEach((item, index) => {
      const key = `바꿔:${index}:${item.target}`;
      const result = buildSwap(item, ctx, built.current.get(key));
      if (result === "same" || result === null) return;
      built.current.set(key, result);
      changed = true;
    });

    // ── ③ 덮기 · 놓기 (한 번만) ──
    table.covers.forEach((item, index) => {
      const key = `덮기:${index}`;
      if (built.current.has(key)) return;
      const result = buildCover(item, index, ctx, table.cutFaces);
      if (!result) return; // 땅이 아직 안 섰다 — 다음 틱에
      built.current.set(key, result);
      changed = true;
    });
    table.places.forEach((item, index) => {
      const key = `놓기:${index}`;
      if (built.current.has(key)) return;
      const result = buildPlace(item, index, ctx, groundAtRef.current);
      if (!result) return;
      built.current.set(key, result);
      changed = true;
    });

    // ── ④ 차단물 겉돌 가라앉히기 (10/14) — endScene 으로 차단물이 치워지면 2.4 초에 걸쳐 땅속으로 ──
    const cleared = clearedRef.current;
    if (cleared.size)
      for (const v of built.current.values()) {
        if (!v.blocker || !cleared.has(v.blocker)) continue;
        const now = performance.now() / 1000;
        if (v.sinkStartedAt == null) {
          v.sinkStartedAt = now;
          v.originalY = v.meshes.map((m) => m.position.y);
        }
        const u = Math.min(1, (now - v.sinkStartedAt) / SINK_SECONDS);
        const e = u * u;
        v.meshes.forEach((m, i) => {
          m.position.y = (v.originalY?.[i] ?? 0) - (v.sinkDepth ?? 0) * e;
          m.position.x += (Math.random() - 0.5) * 0.04 * (1 - u) * U;
          m.visible = u < 1;
          m.updateMatrixWorld();
        });
      }

    // ── ⑤ 원근 나눔 — 원경판이 있는 바꿔치기는 카메라 22 m 안은 근경판, 밖은 원경판 ──
    const radius = drawRadius(); // 구역 초점 — 이 밖은 안 그린다(유닛). 꺼져 있으면 null
    const radius2 = radius ? radius * radius : Infinity;
    const boundary2 = ((radius ? LOD_BOUNDARY_FOCUSED_M : LOD_BOUNDARY_M) * U) ** 2;
    const eye = camera.position;
    for (const v of built.current.values())
      for (const { nearMeshes, farMeshes, nearMatrices, farMatrices, positions, idTable } of v.lodPairs || []) {
        let a = 0;
        let b = 0;
        const nearIds = new Int32Array(positions.length);
        const farIds = new Int32Array(positions.length);
        for (let k = 0; k < positions.length; k++) {
          const d2 = positions[k].distanceToSquared(eye);
          if (d2 > radius2) continue;
          if (d2 < boundary2) {
            for (const m of nearMeshes) m.setMatrixAt(a, nearMatrices[k]);
            nearIds[a++] = idTable[k];
          } else {
            for (const m of farMeshes) m.setMatrixAt(b, farMatrices[k]);
            farIds[b++] = idTable[k];
          }
        }
        for (const m of nearMeshes) {
          m.userData.ids = nearIds.subarray(0, a);
          m.count = a;
          m.instanceMatrix.needsUpdate = true;
          m.computeBoundingSphere();
        }
        for (const m of farMeshes) {
          m.userData.ids = farIds.subarray(0, b);
          m.count = b;
          m.instanceMatrix.needsUpdate = true;
          m.computeBoundingSphere();
        }
      }

    // ── ⑥ 구역 초점 거르기 — 원근 짝이 없는 교체본(덮기 등)도 반경 밖 자리는 뺀다 ──
    // 전체보기(부감) 중엔 radius 가 없다 → 빼 둔 자리를 반경 없이 되살린다
    if ((radius || focus.paused) && ++focusTick.current % 20 === 0) {
      const t = new THREE.Vector3();
      group.traverse((o) => {
        if (!(o as THREE.InstancedMesh).isInstancedMesh || o.userData.lodPaired) return;
        const m = o as THREE.InstancedMesh;
        if (!m.userData.fullSet)
          m.userData.fullSet = {
            matrices: (m.instanceMatrix.array as Float32Array).slice(0, m.count * 16),
            n: m.count,
            ids: m.userData.ids ? Array.from(m.userData.ids as Int32Array) : null,
            coverIds: m.userData.coverIds ? [...(m.userData.coverIds as string[])] : null,
          };
        const full = m.userData.fullSet as {
          matrices: Float32Array;
          n: number;
          ids: number[] | null;
          coverIds: string[] | null;
        };
        const ids: number[] = [];
        const coverIds: string[] = [];
        m.updateMatrixWorld();
        let j = 0;
        for (let k = 0; k < full.n; k++) {
          t.set(full.matrices[k * 16 + 12], full.matrices[k * 16 + 13], full.matrices[k * 16 + 14]).applyMatrix4(
            m.matrixWorld,
          );
          if (t.distanceToSquared(eye) > radius2) continue;
          (m.instanceMatrix.array as Float32Array).set(full.matrices.subarray(k * 16, k * 16 + 16), j * 16);
          if (full.ids) ids.push(full.ids[k]);
          if (full.coverIds) coverIds.push(full.coverIds[k]);
          j++;
        }
        m.count = j;
        if (full.ids) m.userData.ids = Int32Array.from(ids);
        if (full.coverIds) m.userData.coverIds = coverIds;
        m.instanceMatrix.needsUpdate = true;
        m.computeBoundingSphere();
      });
    }

    if (changed) {
      let total = 0;
      const lines = [...built.current.values()].map((v) => {
        total += v.triangles;
        return `${v.label} · ${Math.round(v.triangles / 1000)}k면`;
      });
      console.info(`[publicAssets] (공개 에셋 미리보기) 합계 ${Math.round(total / 1000)}k면\n  ` + lines.join("\n  "));
    }
    // 파일 다운로드 완료와 실제 교체 배치 적용을 구분한다. 다음 렌더 이후에
    // 검수 연결이 후속 프레임을 세어 준비 기록을 보낸다(형태 승인은 사람이 한다).
    const appliedGroups = [...built.current.values()].filter((v) => v.meshes.length > 0).length;
    if (publicAssetStatus.phase === "loaded" && appliedGroups > 0) {
      publicAssetStatus.phase = "applied";
      publicAssetStatus.appliedGroups = appliedGroups;
    }
  });

  if (!IS_PUBLIC_ASSETS_ENABLED) return null;
  return <group ref={groupRef} name="publicAssets" />;
}

/** 풀 포기 자리 하나(m). vegetation.buildGrass 가 포기를 만들 때 내주는 값과 같은 뜻 */
export interface GrassSpot {
  x: number;
  y: number;
  z: number;
  /** 키(m) */
  h: number;
  rotation?: number;
}

/**
 * 「땅.풀」 무리 — 코드 풀(합본)과 **같은 자리**를 인스턴스 행렬로 들고 있는 보이지 않는 무리 (옛 공간그레이박스 풀자리무리, 10/13)
 *   바꿔치기(manifest target "땅.풀")가 이 자리를 읽어 공개 3D 풀·갈대로 바꿔 심는다. 교체가 등록되면 합본 풀은
 *   usePublicAssetRegistry().hiddenGroups.has("땅.풀") 로 숨긴다. 높이는 1 짜리 표본 × (키 × 1.8).
 *   TS 의 buildGrass 는 포기 자리를 내주지 않는다 — 리드가 buildGrass 에 자리 콜백/반환을 더해 이 컴포넌트에 넘긴다.
 */
export function GrassSpotMarkers({ spots }: { spots: GrassSpot[] | null }) {
  const mesh = useMemo(() => {
    if (!IS_PUBLIC_ASSETS_ENABLED || !spots?.length) return null;
    const geometry = new THREE.BoxGeometry(0.3, 1, 0.3).translate(0, 0.5, 0);
    const m = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), spots.length);
    m.name = "땅.풀";
    m.visible = false;
    m.layers.set(31); // 편집기 광선이 이 보이지 않는 상자를 집지 않게
    const M = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    spots.forEach((d, i) => {
      const k = d.h * 1.8 * U;
      m.setMatrixAt(
        i,
        M.compose(p.set(d.x * U, d.y * U, d.z * U), q.setFromEuler(e.set(0, d.rotation ?? 0, 0)), sc.set(k, k, k)),
      );
    });
    m.userData.groupId = "땅.풀";
    m.userData.ids = Int32Array.from(spots, (_, i) => i);
    return m;
  }, [spots]);
  useEffect(
    () => () => {
      mesh?.geometry.dispose();
      (mesh?.material as THREE.Material | undefined)?.dispose();
    },
    [mesh],
  );
  return mesh ? <primitive object={mesh} /> : null;
}
