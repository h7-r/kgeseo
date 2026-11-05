import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

import { scaleColor } from "@/engine/color";
import { TOON_GRADIENT } from "@/engine/toon";

import { buildLightningGeometry, createLightningMaterial } from "@/props/shared/lightning";

import { computeSurge, FLOW_SECONDS, getPaintingStruckAt, setFlowPath } from "./currentFlow";
import { computeRoundedPolyline } from "./puzzleGeometry";
import { getBinFlowStartedAt, isBinComplete, type TrashBin } from "./workLampState";

const PIPE_RADIUS = 0.032;
const PIPE_COLOR = "#4a4f56";
const COLLAR_COLOR = "#666d75";
/** 그림에 닿은 뒤 번개가 이만큼(초) 더 세게 흐르다 잔불꽃으로 줄어든다 */
const TRAIL_AFTER_STRIKE_SECONDS = 3;
const SPARK_COLOR = new THREE.Color("#fffaf0").multiplyScalar(4);

interface PowerCableProps {
  points: THREE.Vector3Tuple[];
  /** 이 선에 전류를 보내는 통. null 이면 전류가 흐르지 않는 선(액자 → 스위치) */
  bin: TrashBin | null;
  brightness?: number;
}

interface CableCurrentProps {
  bin: TrashBin;
  path: THREE.Curve<THREE.Vector3>;
  length: number;
}

/** 통 몫이 다 차면 전선을 따라 액자 쪽으로 가는 번개와 그 앞머리 불똥. */
function CableCurrent({ bin, path, length }: CableCurrentProps) {
  const geometry = useMemo(() => buildLightningGeometry(path, length), [path, length]);
  const material = useMemo(() => createLightningMaterial({ throughWalls: true }), []);
  useEffect(() => {
    setFlowPath(bin, path);
  }, [bin, path]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  const lightningRef = useRef<THREE.Mesh>(null);
  const headRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const start = getBinFlowStartedAt(bin);
    const now = performance.now() / 1000;
    const isFlowing = start > 0 && isBinComplete(bin);
    const progress = isFlowing ? Math.min(1, (now - start) / FLOW_SECONDS) : 0;
    const { uniforms } = material;
    uniforms.uProg.value = progress;
    uniforms.uTime.value = now;
    uniforms.uLen.value = length;
    uniforms.uSurge.value = computeSurge(now);
    uniforms.uTrail.value = now < getPaintingStruckAt() + TRAIL_AFTER_STRIKE_SECONDS ? 1 : 0;
    // 진행 0 이면 셰이더가 전부 버린다. 끄는 동안의 셰이더는 예열이 안 보이는 메시까지 구워 둔다.
    if (lightningRef.current) lightningRef.current.visible = progress > 0;
    const head = headRef.current;
    if (head) {
      const isTravelling = progress > 0 && progress < 1;
      head.visible = isTravelling;
      if (isTravelling) {
        // 가는 동안만 파닥인다
        head.position.copy(path.getPointAt(progress));
        head.scale.setScalar(0.7 + Math.random() * 0.8);
      }
    }
  });
  return (
    <>
      <mesh
        ref={lightningRef}
        geometry={geometry}
        material={material}
        frustumCulled={false}
        renderOrder={5}
        visible={false}
      />
      <mesh ref={headRef} visible={false}>
        <sphereGeometry args={[0.05, 10, 8]} />
        <meshBasicMaterial color={SPARK_COLOR} toneMapped={false} />
      </mesh>
    </>
  );
}

/** 벽·천장을 타는 회색 전선관(분기함 전선관과 같은 모양). 통이 정해진 선에만 전류가 흐른다. */
export default function PowerCable({ points, bin, brightness = 1 }: PowerCableProps) {
  const pointsKey = points
    .flat()
    .map((v) => v.toFixed(2))
    .join(",");
  const { tube, length, path, ends } = useMemo(() => {
    const path = computeRoundedPolyline(points, 0.3);
    const length = path.getLength();
    const segments = Math.max(40, Math.round(length * 6));
    // 관 양 끝의 이음쇠
    const ends = [path.getPointAt(0), path.getPointAt(1)];
    return {
      tube: new THREE.TubeGeometry(path, segments, PIPE_RADIUS, 8, false),
      length,
      path,
      ends,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 점 배열은 판마다 새로 만들어져 값(pointsKey)으로 비교한다
  }, [pointsKey]);
  useEffect(() => () => tube.dispose(), [tube]);
  return (
    <group>
      <mesh geometry={tube} castShadow>
        <meshToonMaterial color={scaleColor(PIPE_COLOR, brightness)} gradientMap={TOON_GRADIENT} />
        <Outlines thickness={2} color="#131416" />
      </mesh>
      {ends.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.046, 10, 8]} />
          <meshToonMaterial color={scaleColor(COLLAR_COLOR, brightness)} gradientMap={TOON_GRADIENT} />
        </mesh>
      ))}
      {bin && <CableCurrent bin={bin} path={path} length={length} />}
    </group>
  );
}
