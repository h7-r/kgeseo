import { useEffect, useRef } from "react";
import { Outlines } from "@react-three/drei";
import * as THREE from "three";

import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { ROOM_H } from "@/station/layout/dimensions";

const METAL = "#2E333A";

interface WorkLampProps {
  /** 천장 부착 [x, z] */
  pos?: [number, number];
  /** 천장에서 갓까지 내려온 길이 */
  drop?: number;
  on?: boolean;
  /** 갓 지름 배수 */
  size?: number;
  shadeColor?: THREE.ColorRepresentation;
  bulbColor?: THREE.ColorRepresentation;
  intensity?: number;
  /** 원뿔이 벌어지는 각(rad) */
  spread?: number;
  /** 넓게 퍼지는 빛 한 겹의 세기(intensity 대비 배수) */
  glow?: number;
  /** 2 = 물리적으로 정확, 낮출수록 멀리 퍼진다 */
  decay?: number;
  /** 갓 위로 새는 빛. 셀 셰이딩과 화풍이 어긋나 기본은 끔 */
  ceilingGlow?: number;
  outline?: OutlineValues | null;
}

/** 수사본부가 폐역 천장에 새로 매단 작업등. 모양은 코드, 빛은 갓 아래 spotLight 두 겹. */
export default function WorkLamp({
  pos = [0, 0],
  drop = 2.8,
  on = true,
  size = 1,
  shadeColor = "#3A4048",
  bulbColor = "#FFD9A0",
  intensity = 110,
  spread = 0.95,
  glow = 0.55,
  decay = 1.4,
  ceilingGlow = 0,
  outline,
}: WorkLampProps) {
  const [x, z] = pos;
  // target 을 안 주면 씬 원점을 노려봐, 구석의 등들이 빛 웅덩이를 타원으로 찌그러뜨린다.
  const coreLightRef = useRef<THREE.SpotLight>(null);
  const glowLightRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  useEffect(() => {
    if (targetRef.current) {
      if (coreLightRef.current) coreLightRef.current.target = targetRef.current;
      if (glowLightRef.current) glowLightRef.current.target = targetRef.current;
    }
  }, [on]);
  const ceilY = ROOM_H - 0.05;
  const shadeY = ceilY - drop;
  const shadeHeight = 0.8 * size;
  const shadeBottom = 0.92 * size;
  const shadeTop = 0.2 * size;
  const neckY = shadeY + shadeHeight;
  const shellOutline = outline?.outline && <Outlines thickness={outline.outlineWidth} color={outline.outlineColor} />;

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, ceilY - 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.24, 0.1, 16]} />
        <meshToonMaterial color={METAL} gradientMap={TOON_GRADIENT} />
        {shellOutline}
      </mesh>
      <mesh position={[0, (ceilY - 0.1 + neckY) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, ceilY - 0.1 - neckY, 10]} />
        <meshToonMaterial color={METAL} gradientMap={TOON_GRADIENT} />
        {shellOutline}
      </mesh>

      {/* 툰 재질은 앞뒤 면에 다른 색을 못 준다 — 바깥 원뿔(앞면) + 안쪽 원뿔(뒷면)을 겹쳐 두 색을 낸다. */}
      <group position={[0, shadeY + shadeHeight / 2, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[shadeTop, shadeBottom, shadeHeight, 24, 1, true]} />
          <meshToonMaterial color={shadeColor} gradientMap={TOON_GRADIENT} side={THREE.FrontSide} />
          {shellOutline}
        </mesh>
        <mesh scale={0.97}>
          <cylinderGeometry args={[shadeTop, shadeBottom, shadeHeight, 24, 1, true]} />
          <meshBasicMaterial color={on ? "#FFF3D2" : "#565B62"} side={THREE.BackSide} toneMapped={false} />
        </mesh>
        <mesh position={[0, shadeHeight / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[shadeTop, 24]} />
          <meshToonMaterial color={shadeColor} gradientMap={TOON_GRADIENT} />
        </mesh>
      </group>

      <mesh position={[0, shadeY + 0.2 * size, 0]}>
        <sphereGeometry args={[0.16 * size, 12, 10]} />
        <meshBasicMaterial color={on ? bulbColor : "#3A3A3A"} toneMapped={false} />
      </mesh>

      <object3D ref={targetRef} position={[0, 0, 0]} />

      {/* 한 겹만 쓰면 아무리 흐려도 원 경계가 남는다 — 넓고 약한 두 번째 원뿔로 테두리를 지운다. */}
      {on && (
        <>
          <spotLight
            ref={coreLightRef}
            position={[0, shadeY, 0]}
            angle={spread}
            penumbra={0.92}
            intensity={intensity}
            distance={ROOM_H + 10}
            decay={decay}
            color={bulbColor}
            castShadow={false}
          />
          {/* spotLight angle 상한이 90° 라 1.45 로 자른다. */}
          {glow > 0 && (
            <spotLight
              ref={glowLightRef}
              position={[0, shadeY, 0]}
              angle={Math.min(spread * 1.6, 1.45)}
              penumbra={1}
              intensity={intensity * glow}
              distance={ROOM_H + 14}
              decay={Math.max(decay - 0.5, 0.4)}
              color={bulbColor}
              castShadow={false}
            />
          )}
          <pointLight
            position={[0, shadeY + 0.25 * size, 0]}
            intensity={6}
            distance={3.2}
            decay={2}
            color={bulbColor}
          />
          {/* distance 를 짧게 두면 천장에 밝은 동그라미가 찍힌다 — 넓고 옅게 깐다. */}
          {ceilingGlow > 0 && (
            <pointLight
              position={[0, neckY + 0.5 * size, 0]}
              intensity={ceilingGlow}
              distance={(ceilY - neckY) * 12}
              decay={1.1}
              color={bulbColor}
            />
          )}
        </>
      )}
    </group>
  );
}
