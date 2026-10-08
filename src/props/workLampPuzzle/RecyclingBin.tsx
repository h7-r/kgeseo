import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

import { scaleColor } from "@/engine/color";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import { BIN_SIZE, taperedBoxGeometry } from "./geometry";
import { binBodyTexture, binSignTexture } from "./trashTextures";
import { rejectingBin, trashRejectedAt, type TrashBin } from "./workLampState";

interface RecyclingBinProps {
  bin: TrashBin;
  position: [number, number, number];
  direction?: number;
  brightness?: number;
  /** 이 통의 몫 — 앞 칸 수로 보여 준다 */
  slotCount?: number;
  filledCount?: number;
  outline?: OutlineValues | null;
}

/** 벽에 등을 대고 선 분리수거함. 틀린 것을 받으면 투입구 둘레가 0.6 초 붉게 튄다. */
export default function RecyclingBin({
  bin,
  position,
  direction = 1,
  brightness = 1,
  slotCount = 4,
  filledCount = 0,
  outline,
}: RecyclingBinProps) {
  const d = direction;
  const isPlastic = bin === "plastic";
  const { depth, width, bodyHeight } = BIN_SIZE;
  const bodyColor = isPlastic ? "#2d64a8" : "#50574d";
  const lidColor = isPlastic ? "#3b77c0" : "#5f675b";
  const signTexture = binSignTexture(bin);
  const bodyTexture = binBodyTexture(bin);
  const mouthMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const bodyGeometry = useMemo(() => taperedBoxGeometry(depth, bodyHeight, width, 0.9), [depth, bodyHeight, width]);
  const lidGeometry = useMemo(() => new THREE.BoxGeometry(depth + 0.1, 0.16, width + 0.1), [depth, width]);
  useEffect(
    () => () => {
      bodyGeometry.dispose();
      lidGeometry.dispose();
    },
    [bodyGeometry, lidGeometry],
  );
  useFrame(() => {
    const material = mouthMaterial.current;
    if (!material) return;
    const since = performance.now() / 1000 - trashRejectedAt();
    const isFlashing = rejectingBin() === bin && since < 0.6 && Math.floor(since * 10) % 2 === 0;
    material.color.set(isFlashing ? "#ff3b2f" : "#0a0b0d");
  });
  // 위가 넓은 통이라 표지 윗단에서 앞면이 더 나와 있다 — 표지 윗단 높이로 잰다
  const frontX = (y: number) => depth / 2 + (depth / 2) * (0.9 + 0.1 * ((y + 0.7 - 0.06) / bodyHeight)) + 0.012;
  const faceYaw = d > 0 ? Math.PI / 2 : -Math.PI / 2;
  const top = bodyHeight + 0.2;
  return (
    <group position={position}>
      <mesh geometry={bodyGeometry} position={[d * (depth / 2), bodyHeight / 2 + 0.06, 0]} castShadow receiveShadow>
        <meshToonMaterial map={bodyTexture} color={scaleColor("#ffffff", brightness)} gradientMap={TOON_GRADIENT} />
        <ToonOutline geometry={bodyGeometry} outline={outline} />
        <Outlines thickness={3} color="#111214" />
      </mesh>
      {/* 아랫단 받침 — 통이 바닥에 앉은 것으로 보인다 */}
      <mesh position={[d * (depth / 2), 0.07, 0]}>
        <boxGeometry args={[depth * 0.93, 0.14, width * 0.93]} />
        <meshToonMaterial color={scaleColor("#1c1e21", brightness)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 허리 보강대 — 표지(1.55 ± 0.65) 위아래로 비켜 둔다 */}
      {[0.5, 2.4].map((y) => {
        const k = 0.9 + 0.1 * (y / bodyHeight);
        return (
          <mesh key={y} position={[d * (depth / 2), y + 0.06, 0]}>
            <boxGeometry args={[depth * k + 0.04, 0.07, width * k + 0.04]} />
            <meshToonMaterial color={scaleColor(bodyColor, brightness * 0.85)} gradientMap={TOON_GRADIENT} />
            <Outlines thickness={2} color="#111214" />
          </mesh>
        );
      })}
      <mesh geometry={lidGeometry} position={[d * (depth / 2), bodyHeight + 0.11, 0]} castShadow>
        <meshToonMaterial color={scaleColor(lidColor, brightness)} gradientMap={TOON_GRADIENT} />
        <ToonOutline geometry={lidGeometry} outline={outline} />
        <Outlines thickness={3} color="#111214" />
      </mesh>
      <mesh position={[d * (depth / 2 - 0.04), bodyHeight + 0.2, 0]}>
        <boxGeometry args={[depth * 0.86, 0.04, width * 0.88]} />
        <meshToonMaterial color={scaleColor(lidColor, brightness * 1.12)} gradientMap={TOON_GRADIENT} />
      </mesh>
      <mesh position={[d * 0.06, bodyHeight + 0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.035, 0.035, width * 0.8, 10]} />
        <meshToonMaterial color={scaleColor("#2a2d31", brightness)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 투입구 — 플라스틱은 병이 들어가는 둥근 구멍, 일반은 여닫이 날개 */}
      {isPlastic ? (
        <group position={[d * (depth * 0.62), top + 0.012, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.3, 28]} />
            <meshBasicMaterial ref={mouthMaterial} color="#0a0b0d" toneMapped={false} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.31, 0.035, 8, 28]} />
            <meshToonMaterial color={scaleColor("#1c4f8e", brightness)} gradientMap={TOON_GRADIENT} />
            <Outlines thickness={2} color="#111214" />
          </mesh>
        </group>
      ) : (
        <group position={[d * (depth * 0.62), top + 0.012, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.46, width * 0.62]} />
            <meshBasicMaterial ref={mouthMaterial} color="#0a0b0d" toneMapped={false} />
          </mesh>
          {/* 방금 누가 넣은 것처럼 날개가 안쪽으로 조금 밀려 있다 */}
          <mesh position={[d * 0.02, -0.03, 0]} rotation={[0, 0, d * 0.35]}>
            <boxGeometry args={[0.46, 0.025, width * 0.6]} />
            <meshToonMaterial color={scaleColor(lidColor, brightness * 0.9)} gradientMap={TOON_GRADIENT} />
          </mesh>
        </group>
      )}
      <mesh position={[d * frontX(1.55), 1.55, 0]} rotation={[0, faceYaw, 0]}>
        <planeGeometry args={[width * 0.72, width * 0.9]} />
        <meshToonMaterial
          map={signTexture}
          color={scaleColor("#ffffff", Math.max(0.4, brightness))}
          gradientMap={TOON_GRADIENT}
        />
      </mesh>
      {/* 몫 칸 — 제대로 들어갈 때마다 하나씩 초록으로 찬다 */}
      <mesh position={[d * (depth + 0.056), bodyHeight + 0.11, 0]}>
        <boxGeometry args={[0.012, 0.1, width * 0.7]} />
        <meshToonMaterial color={scaleColor("#1a1c1f", brightness)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {Array.from({ length: slotCount }, (_, i) => (
        <mesh key={i} position={[d * (depth + 0.064), bodyHeight + 0.11, (i - (slotCount - 1) / 2) * 0.24]}>
          <boxGeometry args={[0.012, 0.06, 0.17]} />
          <meshBasicMaterial color={i < filledCount ? "#7dffa8" : "#2a302c"} toneMapped={false} />
        </mesh>
      ))}
      {/* 발로 뚜껑을 여는 통이라는 신호 */}
      {!isPlastic && (
        <mesh position={[d * (depth * 0.95 + 0.08), 0.1, 0]}>
          <boxGeometry args={[0.2, 0.06, 0.42]} />
          <meshToonMaterial color={scaleColor("#23262a", brightness)} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#111214" />
        </mesh>
      )}
      {[-1, 1].map((sz) => (
        <mesh key={sz} position={[d * 0.12, 0.13, sz * width * 0.42]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.13, 0.13, 0.1, 16]} />
          <meshToonMaterial color={scaleColor("#141517", brightness)} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#0b0c0d" />
        </mesh>
      ))}
      {/* 전선이 통에서 나가는 고무 부싱 */}
      <mesh position={[d * 0.08, bodyHeight - 0.1, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, 0.1, 12]} />
        <meshToonMaterial color={scaleColor("#1a1b1d", brightness)} gradientMap={TOON_GRADIENT} />
      </mesh>
    </group>
  );
}
