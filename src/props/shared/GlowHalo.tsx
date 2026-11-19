/**
 * 「지금 여기를 만져라」 빛무리 — 가산 혼합 스프라이트가 손잡이 발광과 같은 위상으로 숨쉰다.
 * 소화전 밸브(미르 11/10 「밸브 자체에 빛나는 효과」)에서 시작해 관창 · 관창 구멍 · 객차 조명 시험반이 같은 빛을 쓴다
 * (11/12 「빛은 소화전 밸브 돌리라고 빛내는 거랑 동일하게」). 맥박 · 기본값은 glowPulse 에 있다.
 * 깊이는 쓰지 않는다(뒤 물건을 지우지 않게). 휴대폰은 블룸이 꺼져도 스프라이트만으로 보이게 밝기를 잡았다.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { getGlowTexture } from "@/engine/textures/glowTexture";

import { GLOW_HALO, pulseWave } from "./glowPulse";

interface GlowHaloProps {
  position: Vector3Tuple;
  /** 매 프레임 읽는다 — 시간으로 정해지는 조건(전류 도착)은 알림이 없다 */
  visible: () => boolean;
  /** 스프라이트 전체 폭 범위(미터) */
  size?: readonly [number, number];
  color?: string;
  opacity?: readonly [number, number];
}

export default function GlowHalo({
  position,
  visible,
  size = GLOW_HALO.size,
  color = GLOW_HALO.color,
  opacity = GLOW_HALO.opacity,
}: GlowHaloProps) {
  const ref = useRef<THREE.Sprite>(null);
  const material = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    const sprite = ref.current;
    if (!sprite) return;
    sprite.visible = visible();
    if (!sprite.visible) return;
    const wave = pulseWave();
    sprite.scale.setScalar(size[0] + (size[1] - size[0]) * wave);
    material.opacity = opacity[0] + (opacity[1] - opacity[0]) * wave;
  });
  return <sprite ref={ref} material={material} position={position} visible={false} renderOrder={2} />;
}
