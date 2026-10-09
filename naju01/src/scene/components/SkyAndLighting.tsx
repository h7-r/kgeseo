import type { RefObject } from "react";
import * as THREE from "three";

import { ShaderWarmup, ShadowMapUpdater } from "@/engine/rendering";

import type { PresentedControls } from "../../app/presentation";
import { MESH_NAMES } from "../../plan/meshNames";
import { UNITS_PER_METER } from "../../plan/sitePlan";
import { planPoint } from "./planPoint";

const U = UNITS_PER_METER;

interface SkyAndLightingProps {
  controls: PresentedControls;
  skyGeometry: THREE.BufferGeometry | null;
  skyRef: RefObject<THREE.Mesh | null>;
  cloudGeometry: THREE.BufferGeometry | null;
  cloudRef: RefObject<THREE.Mesh | null>;
  sunTarget: THREE.Object3D;
  sunRef: RefObject<THREE.DirectionalLight | null>;
  sunPosition: THREE.Vector3;
}

/** 그림자 관리·하늘색·하늘돔·안개·빛·해·구름. 하늘돔과 구름의 자리는 씬의 주 프레임이 카메라에 맞춘다. */
export default function SkyAndLighting({
  controls,
  skyGeometry,
  skyRef,
  cloudGeometry,
  cloudRef,
  sunTarget,
  sunRef,
  sunPosition,
}: SkyAndLightingProps) {
  const shadowBias = { "shadow-bias": -0.0005, "shadow-normalBias": controls.shadowNormalBias };
  return (
    <>
      <ShadowMapUpdater
        enabled={controls.shadows && controls.throttleShadowUpdates}
        urgentInterval={3}
        slowInterval={240}
      />
      {/* 재질을 처음 그리는 순간 셰이더를 컴파일한다(수백 ms). GLB 가 늦게 붙으므로 주기적으로 데운다. */}
      <ShaderWarmup />
      <color attach="background" args={[controls.skyColor]} />
      {/* 하늘돔 — 빛도 안개도 안 타고 가장 먼저 그려 깊이 버퍼를 안 쓴다 */}
      {skyGeometry && (
        <mesh name={MESH_NAMES.skyDome} ref={skyRef} geometry={skyGeometry} renderOrder={-1} frustumCulled={false}>
          <meshBasicMaterial vertexColors side={THREE.BackSide} fog={false} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      {controls.fog && <fog attach="fog" args={[controls.skyColor, controls.fogNear * U, controls.fogFar * U]} />}
      <ambientLight intensity={controls.ambientIntensity * controls.brightness} />
      {/* 하늘빛 — 얕은 굴곡에서도 면 방향이 갈려 보이게 한다 */}
      <hemisphereLight
        args={[
          controls.hemisphereSkyColor,
          controls.hemisphereGroundColor,
          controls.hemisphereIntensity * controls.brightness,
        ]}
        position={[0, 1, 0]}
      />
      <primitive object={sunTarget} position={planPoint(40, 25, 0)} />
      {/* 그림자 카메라는 사람을 따라다닌다. ±70 을 2048² 로 덮으면 텍셀 6.8 cm. */}
      <directionalLight
        ref={sunRef}
        castShadow={controls.shadows}
        target={sunTarget}
        position={sunPosition}
        intensity={controls.sunIntensity * controls.brightness}
        color={controls.sunColor}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-controls.shadowRange}
        shadow-camera-right={controls.shadowRange}
        shadow-camera-top={controls.shadowRange}
        shadow-camera-bottom={-controls.shadowRange}
        shadow-camera-near={1}
        shadow-camera-far={900}
        {...shadowBias}
      />

      {cloudGeometry && (
        <mesh
          name={MESH_NAMES.skyClouds}
          ref={cloudRef}
          geometry={cloudGeometry}
          renderOrder={-1}
          frustumCulled={false}
        >
          <meshBasicMaterial vertexColors fog={false} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
    </>
  );
}
