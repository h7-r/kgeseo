import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { publicAssetRegistry } from "../../loaders/publicAssetManifest";
import type { InstanceGroup } from "../../placement/instanceGroups";
import { UNITS_PER_METER } from "../../plan/sitePlan";
import { drawRadius } from "../immersion/focusFog";
import { FAR_LOD_DISTANCE_M, hasFarBatches, type InstanceBatch, type LodInstanceGroup } from "../lodBatches";
import type { GroundShading } from "../useNajuControls";
import GroundMaterial from "./GroundMaterial";

// 무리 이름은 edits.json 의 열쇠라 한글 값 그대로다. 아래 규칙도 그 값을 본다.

/** 초목 무리 — 외곽선을 두르면 잎마다 테가 생겨 숲이 검은 덩어리가 된다. */
const isVegetationGroup = (groupId = "") =>
  /^(언덕수풀|길가수풀|절벽틈덤불|비탈덤불|절벽머리)\./.test(groupId) ||
  /^(절벽틈덤불|비탈덤불|절벽머리)$/.test(groupId) ||
  /^소품\.(나무|덤불|수풀|풀|꽃)$/.test(groupId) ||
  /^원경\.나무$/.test(groupId);

/**
 * 외곽선은 지오메트리를 한 벌 더 그리므로 「사람이 만든 것」(플레이어가 다가가 만지는 물건)에만 두른다.
 * 씬 요소·울타리·마당울·장승·명패·횃불·비석·무덤·나룻배·나루터·징검돌·인물 — 전체 삼각형의 8.2 %.
 */
const isOutlinedGroup = (groupId = "", includeVegetation = false) =>
  (includeVegetation && isVegetationGroup(groupId)) ||
  /^씬[1-5]\./.test(groupId) ||
  /^(울타리|원경\.집울|원경\.택촌울)\./.test(groupId) ||
  /^소품\.(명패|장승|횃불|비석|무덤|울타리|나룻배|나루터|인물)$/.test(groupId) ||
  /^(나룻배|돌다리\.디딤돌|원경\.나루터)$/.test(groupId);

/**
 * 그림자를 안 드리우는 이름 끝마디. 지피식물과 바닥에 깔린 돌은 그림자가 안 보이는데 비용은 크다
 * (바닥 돌 셋이 그림자 부하의 38 %). 경계 구가 커서 그림자 카메라를 좁혀도 늘 걸친다.
 * 부분 문자열로 거르면 `풀` 이 `수풀` 에도 걸려 덤불 그림자가 통째로 빠진다 — 끝마디를 정확히 본다.
 */
const NO_SHADOW_NAMES = new Set(["잡초", "꽃", "잎더미", "자갈", "풀", "풀포기", "발치너덜", "길가돌", "틈바위"]);

const castsShadow = (groupId = "") =>
  !NO_SHADOW_NAMES.has(groupId.split(".").pop() ?? "") && !NO_SHADOW_NAMES.has(groupId);

const U = UNITS_PER_METER;
/** 0.5 초마다(60 fps 기준 30 프레임) 자리를 다시 담는다 — 매 프레임 담으면 담는 비용이 그리는 비용을 넘는다 */
const REFILL_EVERY_FRAMES = 30;
const EMPTY_IDS = new Int32Array(0);

interface InstanceGroupMeshProps {
  group: InstanceGroup | null;
  outline: ReactNode;
  shading: GroundShading;
  brightness: number;
  outlineVegetation?: boolean;
  shadows?: boolean;
}

/** 묶음 하나의 월드 자리 캐시 — 0.5 초마다 카메라 거리를 재는 데 쓴다(행렬에서 매번 꺼내면 열두 배 느리다) */
interface SlotFrame {
  batch: InstanceBatch;
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh | null;
  /** 인스턴스마다 월드 xyz(유닛) */
  positions: Float32Array;
}

// three 는 setColorAt 전까지 instanceColor 를 안 만든다 — 있을 때만 채우면 돌이 통째로 검게 나온다.
function ensureInstanceColor(mesh: THREE.InstancedMesh, colors: Float32Array | null | undefined, count: number) {
  if (!colors) return;
  if (!mesh.instanceColor || mesh.instanceColor.count !== count)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(colors), 3);
  else (mesh.instanceColor.array as Float32Array).set(colors);
  mesh.instanceColor.needsUpdate = true;
}

/** 원본 자리 전부를 그대로 담는다(원근 나눔·초점 거르기 전 상태). 원경판 짝은 비운다. */
function fillFull(mesh: THREE.InstancedMesh, batch: InstanceBatch) {
  (mesh.instanceMatrix.array as Float32Array).set(batch.matrices);
  mesh.count = batch.ids.length;
  mesh.instanceMatrix.needsUpdate = true;
  ensureInstanceColor(mesh, batch.colors, batch.ids.length);
  mesh.userData.ids = batch.ids;
  mesh.computeBoundingSphere();
}

function emptyFar(mesh: THREE.InstancedMesh, batch: InstanceBatch) {
  mesh.count = 0;
  mesh.instanceMatrix.needsUpdate = true;
  ensureInstanceColor(mesh, batch.colors, batch.ids.length);
  mesh.userData.ids = EMPTY_IDS;
  mesh.computeBoundingSphere();
}

/**
 * 인스턴스 무리 하나. userData 에 무리 id 와 원래 번호를 실어 둔다 —
 * 편집기가 광선으로 집었을 때 「어느 무리의 몇 번인가」를 알아야 지우거나 옮길 수 있다.
 *
 * ── 원근 나눔 (10/13) ─────────────────────────────────────
 *   `farBatches` 가 실린 무리(lodBatches.attachFarShapes)는 모양마다 [원본, 원경판] 두 메시가 **같은 자리 목록**을 갖는다.
 *   0.5초마다 카메라 거리로 갈라, 가까운 것은 원본 메시 앞쪽에, 먼 것(22 m 밖)은 원경판 메시 앞쪽에
 *   몰아 담고 `count` 를 줄인다(안 그리는 것은 아예 안 보낸다 → 삼각형 수가 실제로 준다).
 *   편집기가 집을 때 쓰는 `userData.ids` 도 같은 순서로 다시 적는다. 원경판 메시는 `userData.isDistant = true`.
 *
 * ── 구역 초점 거르기 (?초점, 10/13) ──────────────────────────
 *   원근 나눔이 없는 무리도 초점 반경(focusFog.drawRadius) 밖 자리는 0.5초마다 빼고 담는다.
 *   전체보기(부감)·초점 끔으로 반경이 없어지면 한 번 더 돌려 빼 둔 자리를 되살린다.
 *
 *   원근 나눔·거르기가 instanceMatrix 를 0.5초마다 다시 쓰므로, 바깥(몰입연출의 낙숫물·단서 훑기, 공개 에셋 교체)은
 *   **원본 배열** `userData.originalMatrices` / `originalIds` 를 읽는다. 원경판 짝 메시도 같은 배열을 가리킨다.
 *
 *   교체 등록부(publicAssetRegistry)가 맡는 무리는 여기서 손대지 않는다 — PublicAssetLayer 의 compactOriginal 이
 *   원본을 스스로 압축하는데, 여기서도 0.5초마다 다시 담으면 서로 덮어써 자리가 두 번 그려지거나 사라진다.
 */
export default function InstanceGroupMesh({
  group,
  outline,
  shading,
  brightness,
  outlineVegetation = false,
  shadows = true,
}: InstanceGroupMeshProps) {
  const nearMeshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const farMeshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const frames = useRef<SlotFrame[] | null>(null);
  const tick = useRef(-1);
  /** 마지막 담기에서 반경 밖 자리를 뺐나 — 반경이 사라지면 한 번 되살려야 한다 */
  const culled = useRef(false);

  useEffect(() => {
    if (!group) return;
    const farBatches = (group as LodInstanceGroup).farBatches;
    group.batches.forEach((batch, i) => {
      const near = nearMeshes.current[i];
      if (!near) return;
      fillFull(near, batch);
      near.userData.groupId = group.groupId;
      // 복사·붙여넣기가 같은 모양을 물려받게 남긴다
      near.userData.shapeIndex = batch.shapeIndex;
      near.userData.originalMatrices = batch.matrices;
      near.userData.originalIds = batch.ids; // originalMatrices 와 같은 순서의 편집 번호
      near.userData.isDistant = false;
      const far = farBatches?.[i] ? farMeshes.current[i] : null;
      if (!far) return;
      emptyFar(far, batch);
      far.userData.groupId = group.groupId;
      far.userData.shapeIndex = batch.shapeIndex;
      far.userData.originalMatrices = batch.matrices;
      far.userData.originalIds = batch.ids;
      far.userData.isDistant = true;
    });
    // 묶음이 바뀌면 자리 캐시를 새로 잡고 다음 프레임에 바로 나눈다
    frames.current = null;
    tick.current = -1;
    culled.current = false;
  }, [group]);

  useFrame(({ camera }) => {
    if (!group) return;
    const lod = hasFarBatches(group);
    // 교체 등록부가 맡는 무리는 PublicAssetLayer(compactOriginal)가 원본을 압축한다 — 여기서 또 담으면 서로 덮어쓴다.
    //   이미 빼 둔 자리가 있으면 전부 되살려 두고 손을 뗀다(압축이 전체 집합에서 스냅샷을 뜨게).
    if (publicAssetRegistry.touches(group.groupId)) {
      if (frames.current) {
        for (const { batch, near, far } of frames.current) {
          fillFull(near, batch);
          if (far) emptyFar(far, batch);
        }
        frames.current = null;
        culled.current = false;
      }
      return;
    }
    // 전체보기(부감) 중에는 반경 없이 한 번 더 돌려 빼 둔 자리를 되살린다
    const radius = drawRadius();
    if (radius == null && !lod && !culled.current) return;
    if (++tick.current % REFILL_EVERY_FRAMES) return;

    if (!frames.current) {
      const farBatches = (group as LodInstanceGroup).farBatches;
      const t = new THREE.Vector3();
      const slots: SlotFrame[] = [];
      group.batches.forEach((batch, i) => {
        const near = nearMeshes.current[i];
        if (!near) return;
        near.updateMatrixWorld();
        const world = near.matrixWorld;
        const n = batch.ids.length;
        const positions = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) {
          t.set(batch.matrices[k * 16 + 12], batch.matrices[k * 16 + 13], batch.matrices[k * 16 + 14]).applyMatrix4(
            world,
          );
          positions[k * 3] = t.x;
          positions[k * 3 + 1] = t.y;
          positions[k * 3 + 2] = t.z;
        }
        slots.push({ batch, near, far: farBatches?.[i] ? (farMeshes.current[i] ?? null) : null, positions });
      });
      if (!slots.length) return;
      frames.current = slots;
    }

    const eye = camera.position;
    const radius2 = radius == null ? Infinity : radius * radius; // 구역 초점(?초점) — 이 밖은 안 그린다
    const lodRadius2 = (FAR_LOD_DISTANCE_M * U) ** 2;
    for (const { batch, near, far, positions } of frames.current) {
      const n = batch.ids.length;
      const nearIds = new Int32Array(n);
      const farIds = far ? new Int32Array(n) : null;
      const nearMatrices = near.instanceMatrix.array as Float32Array;
      const nearColors = near.instanceColor ? (near.instanceColor.array as Float32Array) : null;
      const farMatrices = far ? (far.instanceMatrix.array as Float32Array) : null;
      const farColors = far?.instanceColor ? (far.instanceColor.array as Float32Array) : null;
      let a = 0;
      let b = 0;
      for (let k = 0; k < n; k++) {
        const dx = positions[k * 3] - eye.x;
        const dy = positions[k * 3 + 1] - eye.y;
        const dz = positions[k * 3 + 2] - eye.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > radius2) continue;
        if (farMatrices && d2 >= lodRadius2) {
          farMatrices.set(batch.matrices.subarray(k * 16, k * 16 + 16), b * 16);
          if (farColors) farColors.set(batch.colors.subarray(k * 3, k * 3 + 3), b * 3);
          farIds![b++] = batch.ids[k];
        } else {
          nearMatrices.set(batch.matrices.subarray(k * 16, k * 16 + 16), a * 16);
          if (nearColors) nearColors.set(batch.colors.subarray(k * 3, k * 3 + 3), a * 3);
          nearIds[a++] = batch.ids[k];
        }
      }
      near.count = a;
      near.userData.ids = nearIds.subarray(0, a);
      near.instanceMatrix.needsUpdate = true;
      if (near.instanceColor) near.instanceColor.needsUpdate = true;
      near.computeBoundingSphere();
      if (far && farIds) {
        far.count = b;
        far.userData.ids = farIds.subarray(0, b);
        far.instanceMatrix.needsUpdate = true;
        if (far.instanceColor) far.instanceColor.needsUpdate = true;
        far.computeBoundingSphere();
      }
    }
    culled.current = radius != null;
  });

  if (!group) return null;
  const groupOutline = outline && isOutlinedGroup(group.groupId, outlineVegetation) ? outline : null;
  const farBatches = (group as LodInstanceGroup).farBatches;
  const castShadow = shadows && castsShadow(group.groupId);
  // 모형이 제 재질(텍스처·노멀맵)을 데려왔으면 그것을 쓴다 — 바닥재질은 정점 색 전용이다.
  const material = group.material ? (
    <primitive object={group.material} attach="material" />
  ) : (
    <GroundMaterial shading={shading} brightness={brightness} doubleSided={group.doubleSided} />
  );
  return (
    <>
      {group.batches.map((batch, i) => (
        <instancedMesh
          key={`${group.groupId}-${batch.shapeIndex}-${batch.ids.length}`}
          // 블록으로 감싼다 — React 19 는 ref 콜백의 반환값을 정리 함수로 취급한다.
          ref={(mesh) => {
            nearMeshes.current[i] = mesh;
          }}
          name={group.groupId}
          args={[batch.geometry, undefined, batch.ids.length]}
          castShadow={castShadow}
          receiveShadow
        >
          {material}
          {groupOutline}
        </instancedMesh>
      ))}
      {/* 원경판 짝 — 같은 자리 목록을 나눠 담으므로 버퍼 크기는 원본과 같다. 외곽선은 멀어서 안 읽히니 안 두른다. */}
      {farBatches?.map((farBatch, i) =>
        farBatch ? (
          <instancedMesh
            key={`${group.groupId}-${farBatch.shapeIndex}-${farBatch.ids.length}-far`}
            ref={(mesh) => {
              farMeshes.current[i] = mesh;
            }}
            name={group.groupId}
            args={[farBatch.geometry, undefined, farBatch.ids.length]}
            castShadow={castShadow}
            receiveShadow
          >
            {material}
          </instancedMesh>
        ) : null,
      )}
    </>
  );
}
