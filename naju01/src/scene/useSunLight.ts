import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { requestShadowUpdates } from "@/engine/rendering";

import type { PresentedControls } from "../app/presentation";
import { UNITS_PER_METER } from "../plan/sitePlan";
import { planPoint } from "./components/planPoint";

const U = UNITS_PER_METER;

/** 해 — 방위·고도로 자리를 정하고, 그림자 카메라가 사람을 따라다니게 한다. */
export function useSunLight(controls: PresentedControls, camera: THREE.Camera) {
  // 해가 바라보는 지점 — 그림자 카메라를 맞춘다
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  const sunRef = useRef<THREE.DirectionalLight>(null);

  // 코어 한가운데(40, 25)에서 방위·고도만큼. X = 동(+) · Z = 남(+).
  const sunPosition = useMemo(() => {
    const distance = 130; // m
    const a = (controls.sunAzimuth * Math.PI) / 180;
    const e = (controls.sunElevation * Math.PI) / 180;
    return planPoint(
      40 + distance * Math.cos(e) * Math.sin(a),
      25 - distance * Math.cos(e) * Math.cos(a),
      distance * Math.sin(e),
    );
  }, [controls.sunAzimuth, controls.sunElevation]);

  // 그림자 카메라를 사람 곁으로 옮긴다(±70 이면 텍셀이 촘촘해지고 그림자 맵에 들 물건도 준다).
  // 텍셀 격자에 스냅하지 않으면 걸을 때 그림자 가장자리가 지글거린다.
  const sunFollow = useRef({ x: 0, z: 0 });
  useFrame(() => {
    const light = sunRef.current;
    if (!light || !controls.shadows) return;
    const texel = (controls.shadowRange * 2) / 4096;
    const cx = Math.round(camera.position.x / texel) * texel;
    const cz = Math.round(camera.position.z / texel) * texel;
    const last = sunFollow.current;
    if (cx === last.x && cz === last.z) return;
    last.x = cx;
    last.z = cz;
    sunTarget.position.set(cx, sunTarget.position.y, cz);
    sunTarget.updateMatrixWorld();
    // 빛은 목표에서 같은 방향·같은 거리 — 해의 각도는 안 바뀐다
    light.position.set(sunPosition.x + cx - 40 * U, sunPosition.y, sunPosition.z + cz - 25 * U);
    // 서 있는 동안은 그림자 맵을 안 그린다. 걷는 동안 매 프레임 그리지 않게 관리자가 간격을 둔다.
    requestShadowUpdates(0.25);
  });

  return { sunTarget, sunRef, sunPosition };
}
