// 마우스 광선으로 인스턴스 고르기 · 바닥 높이 재기 · 못 고르는 이유 찾기.

import { useCallback, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

import { CORE, METERS_PER_UNIT, UNITS_PER_METER } from "../plan/sitePlan";
import { GROUND_MESHES, SILENT_MESH_PATTERN, UNPICKABLE_REASONS, type Selection } from "./editorConfig";

const tempColor = new THREE.Color();

// instanceColor 는 선형 값이다. getHex() 가 sRGB 로 돌려주므로 color.set(hex) 로 다시 읽으면 같은 값이 된다.
function getInstanceColorHex(mesh: THREE.InstancedMesh, i: number | undefined) {
  const colors = mesh.instanceColor;
  if (!colors || i === undefined || i >= colors.count) return null;
  return tempColor.fromArray(colors.array, i * 3).getHex();
}

/** 맞은 인스턴스 하나를 편집기 선택 꼴(m 단위)로 풀어낸다 */
function readSelection(mesh: THREE.InstancedMesh, instanceId: number, groupId: string, id: number): Selection {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(instanceId, matrix);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  // 테두리는 그 모양의 진짜 바운딩 박스로 — 키를 세 축에 다 쓰면 폭 1.5 m 나무를 세 배 넘게 감싼다
  const { geometry } = mesh;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bb = geometry.boundingBox ?? new THREE.Box3();
  // 복사가 그 물건 그대로(색·납작함·기울기)를 물려받게 여기서 다 캐낸다.
  // 키는 높이 그대로 두고 가로·세로는 키에 대한 비로 넘긴다.
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "YXZ");
  const color = getInstanceColorHex(mesh, instanceId);
  return {
    groupId,
    id,
    x: position.x * METERS_PER_UNIT,
    y: position.y * METERS_PER_UNIT,
    z: position.z * METERS_PER_UNIT,
    size: scale.y * METERS_PER_UNIT,
    rotation: euler.y,
    tilt: euler.x,
    tilt2: euler.z,
    widthRatio: scale.y > 1e-9 ? scale.x / scale.y : 1,
    depthRatio: scale.y > 1e-9 ? scale.z / scale.y : 1,
    shapeIndex: mesh.userData?.shapeIndex as number | undefined,
    ...(color !== null ? { color } : null),
    box: {
      size: [(bb.max.x - bb.min.x) * scale.x, (bb.max.y - bb.min.y) * scale.y, (bb.max.z - bb.min.z) * scale.z],
      center: [
        ((bb.max.x + bb.min.x) / 2) * scale.x,
        ((bb.max.y + bb.min.y) / 2) * scale.y,
        ((bb.max.z + bb.min.z) / 2) * scale.z,
      ],
    },
  };
}

export function usePicking(heightAt: ((x: number, z: number) => number) | null | undefined) {
  const { camera, scene, gl } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const pointer = useRef(new THREE.Vector2());

  const aimAt = useCallback(
    (ev: { clientX: number; clientY: number }) => {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.current.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.current.setFromCamera(pointer.current, camera);
    },
    [camera, gl],
  );

  // 마우스 아래의 인스턴스
  const pickInstance = useCallback(
    (ev: PointerEvent): Selection | null => {
      aimAt(ev);
      for (const hit of raycaster.current.intersectObjects(scene.children, true)) {
        const mesh = hit.object as THREE.InstancedMesh;
        if (!mesh.isInstancedMesh || hit.instanceId === undefined) continue;
        const groupId = mesh.userData?.groupId as string | undefined;
        const ids = mesh.userData?.ids as Int32Array | undefined;
        if (!groupId || !ids) continue;
        return readSelection(mesh, hit.instanceId, groupId, ids[hit.instanceId]);
      }
      return null;
    },
    [aimAt, scene],
  );

  // 그 자리의 바닥 높이. 코어 지표는 무대 밖에서 0 을 내므로 밖에서는 원경 지면에 광선을 내리고,
  // 못 맞히면 원래 높이를 둔다.
  const down = useRef(new THREE.Vector3(0, -1, 0));
  const floorHeightAt = useCallback(
    (x: number, z: number, fallback = 0) => {
      if (x >= CORE.x[0] && x <= CORE.x[1] && z >= CORE.z[0] && z <= CORE.z[1])
        return heightAt ? heightAt(x, z) : fallback;
      raycaster.current.set(
        new THREE.Vector3(x * UNITS_PER_METER, 400 * UNITS_PER_METER, z * UNITS_PER_METER),
        down.current,
      );
      raycaster.current.far = Infinity;
      const hits = raycaster.current
        .intersectObjects(scene.children, true)
        .filter((h) => GROUND_MESHES.includes(h.object.name));
      return hits.length ? hits[0].point.y * METERS_PER_UNIT : fallback;
    },
    [heightAt, scene],
  );

  // 빈 하늘을 누른 것과 「옮길 수 없는 것」을 누른 것을 구별해 알린다
  const describeMiss = useCallback(
    (ev: PointerEvent) => {
      aimAt(ev);
      for (const hit of raycaster.current.intersectObjects(scene.children, true)) {
        const name = hit.object?.name;
        if (!hit.object?.visible || !name || SILENT_MESH_PATTERN.test(name)) continue;
        const reason = UNPICKABLE_REASONS[name];
        return reason ? `못 옮기는 것이다 — ${reason}` : `못 옮기는 것이다 — 「${name}」 (독립 요소가 아니다)`;
      }
      return "";
    },
    [aimAt, scene],
  );

  return { raycaster, aimAt, pickInstance, floorHeightAt, describeMiss };
}
