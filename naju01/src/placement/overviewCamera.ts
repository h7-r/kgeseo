// 편집기 시점 — 부감(Tab) 띄우기·밀기·돌리기, , . 시점 돌리기, 휠, 눌린 키 모으기.

import { useEffect, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { METERS_PER_UNIT, UNITS_PER_METER } from "../plan/sitePlan";
import type { HeightAt } from "../terrain/ground";
import { clamp, clampDelta, EDIT_BOUNDS, OVERVIEW_CAMERA, type Selection } from "./editorConfig";
import { ASSET_TRAY_ID, PANEL_ID } from "./editHelpPanelHtml";

type MaybeHeightAt = HeightAt | null | undefined;

const tempForward = new THREE.Vector3();
const tempSide = new THREE.Vector3();
const tempPivot = new THREE.Vector3();

/**
 * 부감 시점 돌리기. 제자리에서 고개만 돌리면 보던 땅이 큰 원을 그리며 휩쓸려 「이동」으로 보인다 —
 * 지도 앱처럼 화면 한복판이 내려다보는 땅 지점을 축으로 카메라째 돈다.
 */
function orbitCamera(camera: THREE.Camera, delta: number, groundY: number) {
  camera.rotation.order = "YXZ";
  const yaw = camera.rotation.y;
  const heightM = camera.position.y * METERS_PER_UNIT - groundY;
  // 수평에 가까우면 축이 무한히 멀어진다 — 0.15 rad 아래로는 안 내려간다
  const pitch = Math.max(0.15, -camera.rotation.x);
  const aheadM = Math.min(400, heightM / Math.tan(pitch));
  tempPivot.set(
    camera.position.x - Math.sin(yaw) * aheadM * UNITS_PER_METER,
    camera.position.y,
    camera.position.z - Math.cos(yaw) * aheadM * UNITS_PER_METER,
  );
  const dx = camera.position.x - tempPivot.x;
  const dz = camera.position.z - tempPivot.z;
  const c = Math.cos(delta),
    s = Math.sin(delta);
  camera.position.x = tempPivot.x + dx * c - dz * s;
  camera.position.z = tempPivot.z + dx * s + dz * c;
  camera.rotation.y = yaw + delta;
}

// 화면 위가 앞이다. 월드 축으로 밀면 시점을 돌린 뒤 방향이 어긋난다.
export function panCamera(camera: THREE.Camera, sideM: number, aheadM: number) {
  camera.getWorldDirection(tempForward);
  tempForward.y = 0;
  if (tempForward.lengthSq() < 1e-9) tempForward.set(0, 0, -1);
  tempForward.normalize();
  tempSide.crossVectors(tempForward, camera.up).normalize();
  const x = camera.position.x * METERS_PER_UNIT + tempForward.x * aheadM + tempSide.x * sideM;
  const z = camera.position.z * METERS_PER_UNIT + tempForward.z * aheadM + tempSide.z * sideM;
  camera.position.x = clamp(x, EDIT_BOUNDS.x[0], EDIT_BOUNDS.x[1]) * UNITS_PER_METER;
  camera.position.z = clamp(z, EDIT_BOUNDS.z[0], EDIT_BOUNDS.z[1]) * UNITS_PER_METER;
}

/** 카메라 발밑 지표 높이(m). 무대 밖은 값이 없어 0 이다. */
export function heightBelowCamera(camera: THREE.Camera, heightAt: MaybeHeightAt) {
  return heightAt ? heightAt(camera.position.x * METERS_PER_UNIT, camera.position.z * METERS_PER_UNIT) : 0;
}

interface OverviewCameraOptions {
  enabled: boolean;
  overview: boolean;
  heightAt: MaybeHeightAt;
  selectedRef: MutableRefObject<Selection | null>;
}

/** 부감 띄우기와 매 프레임 밀기·돌리기. 눌린 키 모음을 돌려준다(usePressedKeys 가 채운다). */
export function useOverviewCamera({ enabled, overview, heightAt, selectedRef }: OverviewCameraOptions) {
  const camera = useThree((state) => state.camera);
  const pressedKeys = useRef(new Set<string>());
  const overviewRef = useRef(overview);
  const heightAtRef = useRef(heightAt);
  useLayoutEffect(() => {
    overviewRef.current = overview;
    heightAtRef.current = heightAt;
  });

  // 부감에 들어갈 때 띄우고 나올 때 곧바로 내려놓는다 — 걷기 훅에 맡기면 22 m 에서 떨어져
  // 낙하복귀가 사람을 마지막 안전 지점으로 보낸다
  useEffect(() => {
    if (!enabled) return;
    camera.rotation.order = "YXZ";
    if (overview) {
      camera.position.y = (heightBelowCamera(camera, heightAt) + OVERVIEW_CAMERA.height) * UNITS_PER_METER;
      camera.rotation.x = OVERVIEW_CAMERA.pitch;
      camera.rotation.z = 0;
      return;
    }
    // 높이는 걷기 훅이 그 자리에서 잡는다 — 고개만 수평으로
    camera.rotation.x = 0;
    camera.rotation.z = 0;
  }, [enabled, overview, camera, heightAt]);

  // 부감 밀기 — 키는 모아 두고 매 프레임 민다(키다운마다 옮기면 프레임률에 따라 빠르기가 달라진다)
  useFrame((_, rawDelta) => {
    if (!enabled || !overviewRef.current) return;
    const dt = clampDelta(rawDelta);
    const keys = pressedKeys.current;
    // 고른 것이 있으면 방향키는 그 물건을 민다 — WASD 로는 여전히 화면을 밀어 따라간다
    const arrowsPan = !selectedRef.current;
    const ahead =
      (keys.has("KeyW") ? 1 : 0) -
      (keys.has("KeyS") ? 1 : 0) +
      (arrowsPan ? (keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0) : 0);
    const side =
      (keys.has("KeyD") ? 1 : 0) -
      (keys.has("KeyA") ? 1 : 0) +
      (arrowsPan ? (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0) : 0);
    if (!ahead && !side) return;
    const speed = OVERVIEW_CAMERA.panSpeed * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 3 : 1);
    panCamera(camera, side * speed * dt, ahead * speed * dt);
  });

  // , . 시점 돌리기 — 맥 트랙패드엔 오른쪽 버튼이 없다. 걸을 때도 같은 키로 돈다.
  useFrame((_, rawDelta) => {
    if (!enabled) return;
    const dt = clampDelta(rawDelta);
    const keys = pressedKeys.current;
    const turn = (keys.has("Period") ? 1 : 0) - (keys.has("Comma") ? 1 : 0);
    if (!turn) return;
    const speed = 0.9 * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 3 : 1);
    orbitCamera(camera, -turn * speed * dt, heightBelowCamera(camera, heightAtRef.current));
  });

  return pressedKeys;
}

/**
 * 눌린 키 모으기 · Tab 부감. 편집 키 핸들러는 고른 것이 바뀔 때마다 다시 붙어서,
 * 거기서 모으면 누르고 있던 키를 잃어 화면이 멈춘다.
 */
export function usePressedKeys(
  pressedKeys: MutableRefObject<Set<string>>,
  enabled: boolean,
  setOverview: Dispatch<SetStateAction<boolean>> | undefined,
) {
  useEffect(() => {
    const keys = pressedKeys.current;
    if (!enabled) {
      keys.clear();
      return;
    }
    const handleDown = (ev: KeyboardEvent) => {
      if (ev.code === "Tab") {
        ev.preventDefault(); // 안 막으면 브라우저가 포커스를 옮긴다
        setOverview?.((v) => !v);
        return;
      }
      keys.add(ev.code);
    };
    const handleUp = (ev: KeyboardEvent) => keys.delete(ev.code);
    // 창을 벗어나면 누른 채로 남아 화면이 혼자 흘러간다
    const clearKeys = () => keys.clear();
    window.addEventListener("keydown", handleDown);
    window.addEventListener("keyup", handleUp);
    window.addEventListener("blur", clearKeys);
    return () => {
      window.removeEventListener("keydown", handleDown);
      window.removeEventListener("keyup", handleUp);
      window.removeEventListener("blur", clearKeys);
      keys.clear();
    };
  }, [pressedKeys, enabled, setOverview]);
}

const isPointerInside = (el: HTMLElement | null, ev: WheelEvent) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
};

/** 휠 — 안내판은 pointer-events:none 이라 휠이 캔버스로 샌다. 커서가 어느 상자 안인지를 자리로 잰다. */
export function useOverviewWheel(enabled: boolean, overview: boolean, heightAt: MaybeHeightAt) {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    if (!enabled) return;
    const handleWheel = (ev: WheelEvent) => {
      // ① 에셋함 안이면 그 상자만 구른다
      const tray = document.getElementById(ASSET_TRAY_ID);
      if (tray && isPointerInside(tray, ev)) {
        ev.preventDefault();
        tray.scrollTop += ev.deltaY;
        return;
      }
      // ② 안내판 위면 막기만 한다
      if (isPointerInside(document.getElementById(PANEL_ID), ev)) {
        ev.preventDefault();
        return;
      }
      // ③ 부감일 때만. 걸을 때는 휠에 아무 일도 없다.
      if (!overview) return;
      ev.preventDefault();
      const groundY = heightBelowCamera(camera, heightAt);
      const current = camera.position.y * METERS_PER_UNIT - groundY;
      // 그냥 굴리면 돌린다(트랙패드 두 손가락). 높낮이는 핀치 — 맥은 핀치를 ctrlKey 붙은 wheel 로 보낸다.
      const isHeight = ev.ctrlKey || ev.metaKey || ev.shiftKey;
      if (!isHeight) {
        const amount = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
        orbitCamera(camera, -amount * 0.0035, groundY);
        return;
      }
      // 곱셈으로 — 5 m 와 80 m 에서 같은 양을 더하면 한쪽이 못 쓴다
      const next = Math.min(
        OVERVIEW_CAMERA.heightRange[1],
        Math.max(OVERVIEW_CAMERA.heightRange[0], current * (ev.deltaY > 0 ? 1.15 : 1 / 1.15)),
      );
      camera.position.y = (groundY + next) * UNITS_PER_METER;
    };
    // 창 하나에만 단다 — 캔버스에도 달면 버블링으로 두 번 발동한다
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [enabled, overview, camera, heightAt]);
}
