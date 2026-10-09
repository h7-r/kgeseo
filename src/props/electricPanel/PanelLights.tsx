import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { scaleColor } from "@/engine/color";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

const DIM_INTENSITY = 0;
const IGNITION_COLOR = new THREE.Color("#ffffff"); // 붙는 순간의 흰빛
const SETTLED_COLOR = new THREE.Color("#fff4cf"); // 붙고 나서 앉는 아주 연한 노랑

// 붙는 동안 형광등처럼 어두운 철판과 흰빛을 오간다. 짝수 칸이 켜짐.
// 불규칙해야 '붙는 중'으로 읽힌다 — 일정하면 그냥 깜빡이는 표시등이다.
const IGNITION_STEPS = [0.05, 0.11, 0.15, 0.27, 0.32, 0.4, 0.58, 0.66];
const IGNITION_END = IGNITION_STEPS[IGNITION_STEPS.length - 1];

function isIgnitionOn(t: number) {
  for (let i = 0; i < IGNITION_STEPS.length; i++) if (t < IGNITION_STEPS[i]) return i % 2 === 0;
  return true;
}

/** 쉬지 않고 깜빡이면 고장 난 형광등이다. 두 번 치고 한동안 숨 쉬어야 신호로 읽힌다. 1 을 넘는 만큼 Bloom 이 번진다. */
function computeCoverIntensity(t: number) {
  if (t < IGNITION_END) return isIgnitionOn(t) ? 3.4 : 0.04;
  const u = (t - IGNITION_END) % 2.7;
  if (u < 0.1) return 3.1;
  if (u < 0.24) return 0.8;
  if (u < 0.36) return 3.1;
  return 1.7 + 0.22 * Math.sin(u * 2.4);
}

/** 0 = 원래 어두운 철판, 1 = 흰빛. 붙는 동안은 섞지 않고 오간다 — 섞으면 '반짝'이 아니라 '서서히'다. */
function computeCoverWhiteness(t: number) {
  if (t < IGNITION_END) return isIgnitionOn(t) ? 1 : 0;
  return 1;
}

interface PanelLightProps {
  geometry: THREE.BufferGeometry | null;
  offColor: string;
  brightness: number;
  outline?: OutlineValues | null;
  isOn: () => boolean;
}

/** 부스바 꼭대기 볼트 — 회로 하나가 살면 톡 하고 들어온다. 뽑거나 내리면 곧바로 꺼진다. */
export function BoltLight({ geometry, offColor, brightness, outline, isOn }: PanelLightProps) {
  const meshRef = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>>(null);
  const startedAt = useRef(0);
  const off = useMemo(() => new THREE.Color(scaleColor(offColor, brightness)), [offColor, brightness]);
  useFrame(() => {
    const material = meshRef.current?.material;
    if (!material) return;
    if (!isOn()) {
      startedAt.current = 0;
      material.emissiveIntensity = 0;
      material.color.copy(off);
      return;
    }
    if (!startedAt.current) startedAt.current = performance.now();
    const t = (performance.now() - startedAt.current) / 1000;
    // 0.09초 동안 확 올랐다가 제 밝기로 앉는다
    material.emissiveIntensity = t < 0.09 ? 3.2 : 1.9 + 0.1 * Math.sin(t * 3.2);
    material.color.copy(off).lerp(SETTLED_COLOR, Math.min(1, t / 0.08));
  });
  if (!geometry) return null;
  return (
    <mesh ref={meshRef} geometry={geometry} castShadow>
      <meshToonMaterial
        color={scaleColor(offColor, brightness)}
        gradientMap={TOON_GRADIENT}
        emissive={SETTLED_COLOR}
        emissiveIntensity={0}
      />
      <ToonOutline geometry={geometry} outline={outline} />
    </mesh>
  );
}

/**
 * 접속함 덮개·계기창 — 조건이 다 갖춰지면 붙는 연출 뒤 은은히 숨 쉰다.
 * 하나라도 풀리면 시각을 되돌려 다시 채우면 처음부터 붙는다(켜진 채 남으면 푼 티가 안 난다).
 */
export function CoverLight({ geometry, offColor, brightness, outline, isOn }: PanelLightProps) {
  const meshRef = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>>(null);
  const startedAt = useRef(0);
  const off = useMemo(() => new THREE.Color(scaleColor(offColor, brightness)), [offColor, brightness]);
  useFrame(() => {
    const material = meshRef.current?.material;
    if (!material) return;
    if (!isOn()) {
      startedAt.current = 0;
      material.emissiveIntensity = DIM_INTENSITY;
      material.color.copy(off);
      return;
    }
    if (!startedAt.current) startedAt.current = performance.now();
    const t = (performance.now() - startedAt.current) / 1000;
    material.emissiveIntensity = computeCoverIntensity(t);
    // 판 색도 같이 간다 — emissive 만 올리면 테두리만 빛나 뒤에서 비치는 것처럼 보인다.
    material.color.copy(off).lerp(t < IGNITION_END ? IGNITION_COLOR : SETTLED_COLOR, computeCoverWhiteness(t));
  });
  if (!geometry) return null;
  return (
    <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
      {/* toneMapped 는 끄지 않는다 — 끄면 꺼져 있을 때 이 판만 톤이 어긋나 덧댄 스티커로 보인다 */}
      <meshToonMaterial
        color={scaleColor(offColor, brightness)}
        gradientMap={TOON_GRADIENT}
        emissive={SETTLED_COLOR}
        emissiveIntensity={DIM_INTENSITY}
      />
      <ToonOutline geometry={geometry} outline={outline} />
    </mesh>
  );
}
