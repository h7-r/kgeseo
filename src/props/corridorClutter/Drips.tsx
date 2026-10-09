import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { playSound } from "@/audio/sound";
import { playerView } from "@/engine/playerView";

import type { BrightnessAt, PuddleSpot } from "./clutterGeometry";

// 거리를 제곱으로 줄인다 — 직선이면 멀리서도 꽤 남아 계속 나는 것처럼 들린다. 10 유닛(≈3m) 밖은 0.
const MAX_HEARING_DISTANCE = 10;
// 자판기 앞: 귀가 자판기 z 에서 3 안이면 0, 9 까지 서서히 커진다.
const VENDING_SILENT = 3;
const VENDING_FADE_END = 9;
// 앞 62% 는 떨어지는 시간, 나머지는 파문
const FALL_PORTION = 0.62;

function computeDripVolume(ear: THREE.Vector3, spot: PuddleSpot, quietZs: readonly number[]) {
  if (ear.x >= spot.x + 4) return 0; // 본부실(복도 바깥)에서는 안 들린다
  const d = Math.hypot(ear.x - spot.x, ear.z - spot.z);
  if (d >= MAX_HEARING_DISTANCE) return 0;
  const byDistance = (1 - d / MAX_HEARING_DISTANCE) ** 2;
  let byVending = 1;
  for (const z of quietZs) {
    const k = (Math.abs(ear.z - z) - VENDING_SILENT) / (VENDING_FADE_END - VENDING_SILENT);
    byVending = Math.min(byVending, Math.max(0, Math.min(1, k)));
  }
  return 0.5 * byDistance * byVending;
}

interface DripsProps {
  spots: PuddleSpot[];
  ceilingY: number;
  floorY: number;
  brightness: BrightnessAt;
  /** 물방울 소리가 안 들려야 하는 세계 z — 자판기 앞 */
  quietZs?: readonly number[];
}

/**
 * 천장 배관에서 웅덩이로 떨어지는 물방울. 움직이는 것이 하나라도 있어야 멈춘 그림이 아니라 지금도 흐르는 곳이 된다.
 * 떨어질 때 늘어나고, 닿는 순간 파문이 퍼졌다 사라진다.
 */
export default function Drips({ spots, ceilingY, floorY, brightness, quietZs = [] }: DripsProps) {
  const dropRefs = useRef<(THREE.Mesh | null)[]>([]);
  const rippleRefs = useRef<(THREE.Mesh | null)[]>([]);
  // 방울마다 지난 프레임 진행도 — 닿는 순간을 한 번만 잡는다
  const lastPhase = useRef<number[]>([]);

  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime;
    for (let i = 0; i < spots.length; i++) {
      const spot = spots[i];
      const drop = dropRefs.current[i];
      const ripple = rippleRefs.current[i];
      if (!drop || !ripple) continue;
      const u = ((t + spot.offset) % spot.period) / spot.period;
      const previous = lastPhase.current[i] ?? u;
      if (previous < FALL_PORTION && u >= FALL_PORTION) {
        // 볼륨을 손으로 깎는 방식이라 듣는 귀는 카메라가 아니라 사람이다(3인칭 카메라는 캐릭터 뒤에 멀리 있다).
        const ear = playerView.ready ? playerView.eye : camera.position;
        const volume = computeDripVolume(ear, spot, quietZs);
        if (volume > 0.01) playSound("drip", { volume });
      }
      lastPhase.current[i] = u;
      const fall = Math.min(1, u / FALL_PORTION);
      if (u < FALL_PORTION) {
        drop.visible = true;
        // 아래로 갈수록 빨라져야 물처럼 보인다. 빨라질수록 길게 늘어난다.
        const h = fall * fall;
        drop.position.y = ceilingY + (floorY - ceilingY) * h;
        drop.scale.set(1, 1 + h * 2.2, 1);
      } else {
        drop.visible = false;
      }
      const p = (u - FALL_PORTION) / 0.38;
      if (u >= FALL_PORTION) {
        ripple.visible = true;
        const k = 0.25 + p * 1.4;
        ripple.scale.set(k * spot.sx, 1, k * spot.sz);
        const material = ripple.material;
        if (material instanceof THREE.MeshBasicMaterial) material.opacity = 0.45 * (1 - p) * (1 - p);
      } else ripple.visible = false;
    }
  });

  return (
    <group>
      {spots.map((spot, i) => {
        const v = Math.max(0.15, brightness(spot.z));
        return (
          <group key={`drip${i}`}>
            <mesh
              ref={(mesh) => {
                dropRefs.current[i] = mesh;
              }}
              position={[spot.x, ceilingY, spot.z]}
              visible={false}
            >
              <sphereGeometry args={[0.035, 7, 5]} />
              <meshBasicMaterial color={new THREE.Color(0.45 * v, 0.55 * v, 0.62 * v)} toneMapped={false} />
            </mesh>
            <mesh
              ref={(mesh) => {
                rippleRefs.current[i] = mesh;
              }}
              position={[spot.x, floorY + 0.014, spot.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              visible={false}
            >
              <ringGeometry args={[0.34, 0.5, 20]} />
              <meshBasicMaterial
                color={new THREE.Color(0.5 * v, 0.6 * v, 0.68 * v)}
                transparent
                opacity={0}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
