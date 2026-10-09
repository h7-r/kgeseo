import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { scaleColor } from "@/engine/color";
import { TOON_GRADIENT } from "@/engine/toon";

import { createCurrentMaterial, FLOW_SECONDS } from "./currentFlow";
import { computeRoundedPolyline } from "./puzzleGeometry";
import { getFlowStartedAt, isBinComplete, type TrashBin } from "./workLampState";

interface PowerCableProps {
  points: THREE.Vector3Tuple[];
  /** 이 선에 전류를 보내는 통. null 이면 전류가 흐르지 않는 선(액자 → 스위치) */
  bin: TrashBin | null;
  brightness?: number;
}

/** 벽·천장을 타는 고무 피복 전선. 통 몫이 다 차면 그 위로 전류가 액자 쪽으로 흐른다. */
export default function PowerCable({ points, bin, brightness = 1 }: PowerCableProps) {
  const pointsKey = points
    .flat()
    .map((v) => v.toFixed(2))
    .join(",");
  const { tube, glowTube, length, path, clips } = useMemo(() => {
    const path = computeRoundedPolyline(points, 0.3);
    const length = path.getLength();
    const segments = Math.max(40, Math.round(length * 12));
    // 벽에 박힌 전선 집게 — 1.1 유닛마다
    const clips: THREE.Vector3[] = [];
    for (let s = 0.6; s < length - 0.4; s += 1.1) clips.push(path.getPointAt(s / length));
    return {
      tube: new THREE.TubeGeometry(path, segments, 0.034, 8, false),
      glowTube: new THREE.TubeGeometry(path, segments, 0.058, 8, false),
      length,
      path,
      clips,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 점 배열은 판마다 새로 만들어져 값(pointsKey)으로 비교한다
  }, [pointsKey]);
  const glowMaterial = useMemo(() => createCurrentMaterial(), []);
  useEffect(
    () => () => {
      tube.dispose();
      glowTube.dispose();
    },
    [tube, glowTube],
  );
  useEffect(() => () => glowMaterial.dispose(), [glowMaterial]);
  const headRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const start = bin ? getFlowStartedAt(bin) : -99;
    const now = performance.now() / 1000;
    const isFlowing = !!bin && start > 0 && isBinComplete(bin);
    const progress = isFlowing ? Math.min(1, (now - start) / FLOW_SECONDS) : 0;
    glowMaterial.uniforms.uProg.value = progress;
    glowMaterial.uniforms.uTime.value = now;
    glowMaterial.uniforms.uLen.value = length;
    // visible 은 끄지 않는다 — 처음 보이는 순간 셰이더 컴파일로 화면이 몇 초 멈췄다. 진행 0 이면 셰이더가 다 버린다.
    const head = headRef.current;
    if (head) {
      const isTravelling = progress > 0 && progress < 1;
      if (isTravelling) head.position.copy(path.getPointAt(progress));
      // 가는 동안만 파닥이는 앞머리 불똥(안 쓸 때는 크기 0)
      head.scale.setScalar(isTravelling ? 0.7 + Math.random() * 0.8 : 0.0001);
    }
  });
  return (
    <group>
      <mesh geometry={tube} castShadow>
        <meshToonMaterial color={scaleColor("#23262a", brightness)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {clips.map((p, i) => (
        <mesh key={i} position={p}>
          <boxGeometry args={[0.1, 0.1, 0.1]} />
          <meshToonMaterial color={scaleColor("#8b9097", brightness)} gradientMap={TOON_GRADIENT} />
        </mesh>
      ))}
      <mesh geometry={glowTube} material={glowMaterial} />
      <mesh ref={headRef} scale={0.0001}>
        <sphereGeometry args={[0.09, 10, 8]} />
        <meshBasicMaterial color={new THREE.Color("#dff8ff").multiplyScalar(4)} toneMapped={false} />
      </mesh>
    </group>
  );
}
