// 마우스 — 고르기 · 끌어 옮기기 · 붓으로 놓기 · 오른쪽/가운데 버튼 시점.

import { useEffect, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

import { METERS_PER_UNIT, UNITS_PER_METER } from "../plan/sitePlan";
import { findAsset } from "./assetCatalog";
import { clamp, EDIT_BOUNDS, GROUND_MESHES, OUTER_GROUND_MESHES, type Selection } from "./editorConfig";
import { addInstance, modifyInstance, type Edits } from "./instanceGroups";
import { heightBelowCamera, panCamera } from "./overviewCamera";
import type { usePicking } from "./usePicking";

/** 붓으로 고른 물건을 (x, y, z) 바닥에 하나 놓는다 */
function placeAsset(edits: Edits, brushKey: string, x: number, y: number, z: number) {
  const asset = findAsset(brushKey);
  // 필드 순서가 곧 편집 파일의 필드 순서다
  const { edits: next, id } = addInstance(edits, brushKey, {
    x,
    y: y - (asset?.centerOrigin ? -(asset.defaultSize ?? 1) * 0.3 : 0),
    z,
    size: asset?.defaultSize ?? 1,
    rotation: Math.random() * Math.PI * 2,
    // 언덕·길처럼 키와 가로세로가 다른 물건은 비율을 같이 싣는다
    ...(asset?.defaultWidthRatio !== undefined ? { widthRatio: asset.defaultWidthRatio } : null),
    ...(asset?.defaultDepthRatio !== undefined ? { depthRatio: asset.defaultDepthRatio } : null),
    ...(asset?.defaultColor !== undefined ? { color: asset.defaultColor } : null),
  });
  return { edits: next, id, label: asset?.label ?? brushKey };
}

interface PointerEditingOptions {
  enabled: boolean;
  picking: ReturnType<typeof usePicking>;
  heightAt: ((x: number, z: number) => number) | null | undefined;
  editsRef: MutableRefObject<Edits>;
  brushRef: MutableRefObject<string | null>;
  selectedRef: MutableRefObject<Selection | null>;
  undoStack: MutableRefObject<Edits[]>;
  setEdits: Dispatch<SetStateAction<Edits>>;
  setSelected: Dispatch<SetStateAction<Selection | null>>;
  setNotice: Dispatch<SetStateAction<string>>;
}

export function usePointerEditing({
  enabled,
  picking,
  heightAt,
  editsRef,
  brushRef,
  selectedRef,
  undoStack,
  setEdits,
  setSelected,
  setNotice,
}: PointerEditingOptions) {
  const { camera, scene, gl } = useThree();
  const { raycaster, aimAt, pickInstance, floorHeightAt, describeMiss } = picking;
  const floorHeightAtRef = useRef(floorHeightAt);
  const describeMissRef = useRef(describeMiss);
  const heightAtRef = useRef(heightAt);
  const panDrag = useRef<{ x: number; y: number } | null>(null); // 가운데 버튼 끌기
  const drag = useRef<{ start: [number, number]; moved: boolean } | null>(null);
  const orbitDrag = useRef<{ x: number; y: number } | null>(null); // 오른쪽 버튼

  // 리스너는 한 번만 붙이고(렌더마다 다시 붙으면 드래그가 끊긴다) 최신 값은 ref 로 본다
  useLayoutEffect(() => {
    floorHeightAtRef.current = floorHeightAt;
    describeMissRef.current = describeMiss;
    heightAtRef.current = heightAt;
  });

  useEffect(() => {
    if (!enabled) return;
    const canvas = gl.domElement;
    const plane = new THREE.Plane();
    const planeHit = new THREE.Vector3();

    // 커서 아래 땅 자리 [x, z, 원경이면 그 높이]. 못 맞히면 지금 높이의 수평면으로 받는다 —
    // 언덕 위에서 수평으로 보면 광선이 코어를 넘어 날아간다.
    const groundUnderCursor = (ev: PointerEvent, baseY: number): [number, number, number | null] | null => {
      aimAt(ev);
      const hits = raycaster.current
        .intersectObjects(scene.children, true)
        .filter((h) => GROUND_MESHES.includes(h.object.name));
      let x: number;
      let z: number;
      let hitY: number | null = null;
      if (hits.length) {
        x = hits[0].point.x * METERS_PER_UNIT;
        z = hits[0].point.z * METERS_PER_UNIT;
        if (OUTER_GROUND_MESHES.has(hits[0].object.name)) hitY = hits[0].point.y * METERS_PER_UNIT;
      } else {
        plane.set(new THREE.Vector3(0, 1, 0), -baseY * UNITS_PER_METER);
        if (!raycaster.current.ray.intersectPlane(plane, planeHit)) return null;
        x = planeHit.x * METERS_PER_UNIT;
        z = planeHit.z * METERS_PER_UNIT;
      }
      // 면 교점은 수백 m 밖까지 간다
      return [clamp(x, EDIT_BOUNDS.x[0], EDIT_BOUNDS.x[1]), clamp(z, EDIT_BOUNDS.z[0], EDIT_BOUNDS.z[1]), hitY];
    };

    // 붓이 들려 있으면 놓는다. 이어 놓을 수 있게 붓은 그대로 든다(ESC 로 내려놓는다).
    const placeBrush = (ev: PointerEvent, brushKey: string) => {
      const spot = groundUnderCursor(ev, 0);
      if (!spot) return;
      const [x, z, outerY] = spot;
      const y = outerY !== null ? outerY : floorHeightAtRef.current(x, z, 0);
      undoStack.current.push(editsRef.current);
      const { edits: next, id, label } = placeAsset(editsRef.current, brushKey, x, y, z);
      setEdits(next);
      setNotice(`${label} 놓음 #${id} · Ctrl+S 로 저장`);
    };

    const handlePointerDown = (ev: PointerEvent) => {
      if (ev.button === 2) {
        orbitDrag.current = { x: ev.clientX, y: ev.clientY };
        canvas.setPointerCapture?.(ev.pointerId);
        ev.preventDefault();
        return;
      }
      // 가운데 버튼 = 부감에서 지도를 끌어 옮기는 손짓
      if (ev.button === 1) {
        panDrag.current = { x: ev.clientX, y: ev.clientY };
        canvas.setPointerCapture?.(ev.pointerId);
        ev.preventDefault();
        return;
      }
      if (ev.button !== 0) return;
      const brushKey = brushRef.current;
      if (brushKey) {
        placeBrush(ev, brushKey);
        return;
      }
      const found = pickInstance(ev);
      if (found) {
        setSelected(found);
        selectedRef.current = found;
        drag.current = { start: [ev.clientX, ev.clientY], moved: false };
        canvas.setPointerCapture?.(ev.pointerId);
        setNotice(
          `${found.groupId} #${found.id} · (${found.x.toFixed(1)}, ${found.z.toFixed(1)}) · 키 ${found.size.toFixed(1)} m`,
        );
      } else {
        setSelected(null);
        selectedRef.current = null;
        setNotice(describeMissRef.current(ev));
      }
    };

    const handlePointerMove = (ev: PointerEvent) => {
      // 높이에 비례해 민다 — 90 m 위와 4 m 위에서 같은 양을 밀면 한쪽은 안 움직이고 한쪽은 날아간다
      if (panDrag.current) {
        const dx = ev.clientX - panDrag.current.x;
        const dy = ev.clientY - panDrag.current.y;
        panDrag.current = { x: ev.clientX, y: ev.clientY };
        const groundY = heightBelowCamera(camera, heightAtRef.current);
        const height = Math.max(2, camera.position.y * METERS_PER_UNIT - groundY);
        const factor = height * 0.0022;
        panCamera(camera, -dx * factor, dy * factor);
        return;
      }
      if (orbitDrag.current) {
        const dx = ev.clientX - orbitDrag.current.x;
        const dy = ev.clientY - orbitDrag.current.y;
        orbitDrag.current = { x: ev.clientX, y: ev.clientY };
        camera.rotation.order = "YXZ";
        camera.rotation.y -= dx * 0.0035;
        camera.rotation.x = Math.max(
          -Math.PI / 2 + 0.01,
          Math.min(Math.PI / 2 - 0.01, camera.rotation.x - dy * 0.0035),
        );
        return;
      }
      // 4 px 넘게 움직여야 끌기다(클릭과 구분)
      const current = drag.current;
      const chosen = selectedRef.current;
      if (!current || !chosen) return;
      if (!current.moved) {
        const d = Math.hypot(ev.clientX - current.start[0], ev.clientY - current.start[1]);
        if (d < 4) return;
        current.moved = true;
        undoStack.current.push(editsRef.current);
      }
      const spot = groundUnderCursor(ev, chosen.y);
      if (!spot) return;
      const [x, z, outerY] = spot;
      const y = outerY !== null ? outerY : floorHeightAtRef.current(x, z, chosen.y);
      const moved = { ...chosen, x, y, z };
      selectedRef.current = moved;
      setSelected(moved);
      setEdits((e) => modifyInstance(e, chosen.groupId, chosen.id, { x, y, z }));
    };

    const handlePointerUp = (ev: PointerEvent) => {
      if (orbitDrag.current) {
        orbitDrag.current = null;
        canvas.releasePointerCapture?.(ev.pointerId);
        return;
      }
      if (panDrag.current) {
        panDrag.current = null;
        canvas.releasePointerCapture?.(ev.pointerId);
        return;
      }
      if (drag.current?.moved) setNotice("옮김 · Ctrl+S 로 저장");
      drag.current = null;
      canvas.releasePointerCapture?.(ev.pointerId);
    };

    const preventMenu = (ev: Event) => ev.preventDefault();
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("contextmenu", preventMenu);
    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("contextmenu", preventMenu);
    };
  }, [
    enabled,
    pickInstance,
    aimAt,
    gl,
    camera,
    scene,
    setEdits,
    raycaster,
    editsRef,
    brushRef,
    selectedRef,
    undoStack,
    setSelected,
    setNotice,
  ]);
}
