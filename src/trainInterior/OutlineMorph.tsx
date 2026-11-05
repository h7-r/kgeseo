import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import {
  buildOutlineGeometry,
  OUTLINE_FRAGMENT_SHADER,
  OUTLINE_SHAPE_COUNT,
  OUTLINE_VERTEX_SHADER,
} from "./outlineMorphGeometry";

const HOLD_SECONDS = 2.6;
const MORPH_SECONDS = 1.5;
const CYCLE_SECONDS = HOLD_SECONDS + MORPH_SECONDS;
/** 선 굵기(-1~1 평면 기준). 번짐은 같은 선분을 굵고 옅게 한 번 더 그린다. */
const LINE_WIDTH = 0.0065;
const GLOW_WIDTH = 0.03;
const GLOW_OPACITY = 0.1;
const BAND_COLOR = new THREE.Color("#4f6cb0");

const oneHot = (index: number) => {
  // Vector4 기본값은 w=1 이라 0 으로 비워야 네 번째 모양이 늘 섞이지 않는다.
  const weight = new THREE.Vector4(0, 0, 0, 0);
  weight.setComponent(index, 1);
  return weight;
};

function useOutlineMaterial(width: number, opacity: number) {
  return useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: OUTLINE_VERTEX_SHADER,
        fragmentShader: OUTLINE_FRAGMENT_SHADER,
        uniforms: {
          uFrom: { value: oneHot(0) },
          uTo: { value: oneHot(1) },
          uMix: { value: 0 },
          uWidth: { value: width },
          uTime: { value: 0 },
          uOpacity: { value: opacity },
          uBandColor: { value: BAND_COLOR },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [width, opacity],
  );
}

interface OutlineMorphProps {
  /** 씬이 숨어 있으면 짓지도, 돌리지도 않는다 */
  enabled: boolean;
  position: [number, number, number];
  /** 모양의 절반 크기(유닛) */
  size: number;
}

/** 지도 → 자물쇠 → 열쇠 → 로고 → 지도로 바뀌는 흰 빛 외곽선. 매 프레임 올리는 건 숫자 몇 개뿐이다. */
export default function OutlineMorph({ enabled, position, size }: OutlineMorphProps) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const isBuilding = useRef(false);
  const line = useOutlineMaterial(LINE_WIDTH, 1);
  const glow = useOutlineMaterial(GLOW_WIDTH, GLOW_OPACITY);

  useEffect(() => {
    if (!enabled || isBuilding.current) return;
    isBuilding.current = true;
    void buildOutlineGeometry().then(setGeometry);
  }, [enabled]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(
    () => () => {
      line.dispose();
      glow.dispose();
    },
    [line, glow],
  );

  useFrame(({ clock }) => {
    if (!enabled || !geometry) return;
    const t = clock.elapsedTime;
    const cycle = Math.floor(t / CYCLE_SECONDS);
    const inCycle = t - cycle * CYCLE_SECONDS;
    const mix = Math.max(0, (inCycle - HOLD_SECONDS) / MORPH_SECONDS);
    for (const material of [line, glow]) {
      const { uFrom, uTo, uMix, uTime } = material.uniforms;
      (uFrom.value as THREE.Vector4).copy(oneHot(cycle % OUTLINE_SHAPE_COUNT));
      (uTo.value as THREE.Vector4).copy(oneHot((cycle + 1) % OUTLINE_SHAPE_COUNT));
      uMix.value = mix;
      uTime.value = t;
    }
  });

  if (!geometry) return null;
  // 판(투명 재질)보다 나중에 그려야 판이 선을 덮지 않는다.
  return (
    <group position={position} scale={[size, size, 1]}>
      <mesh geometry={geometry} material={glow} frustumCulled={false} renderOrder={1} raycast={() => null} />
      <mesh geometry={geometry} material={line} frustumCulled={false} renderOrder={2} raycast={() => null} />
    </group>
  );
}
