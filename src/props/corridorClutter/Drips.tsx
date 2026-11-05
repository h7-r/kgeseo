import { useEffect, useMemo, useRef } from "react";
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
/** 파문이 번지는 판의 반지름 */
const RIPPLE_RADIUS = 0.95;
/** 부딪힌 물이 튀어 오르는 높이와 시간(파문 진행 비율) */
const REBOUND_HEIGHT = 0.3;
const REBOUND_PORTION = 0.16;

const RIPPLE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
// 고리를 그리지 않고 수면의 기울기로 빛을 계산한다. 빛을 향한 비탈만 반짝이고 반대쪽은 어두워져
// 물결이 한 바퀴 온전한 선으로 보이지 않는다. 앞머리가 가장 뚜렷하고 뒤따르는 물결은 낮고 넓어진다.
const RIPPLE_FRAGMENT = /* glsl */ `
  uniform float uAge;
  uniform float uSeed;
  uniform vec3 uColor;
  varying vec2 vUv;
  float height(float r, float angle) {
    float wobble = sin(angle * 3.0 + uSeed) * 0.008 + sin(angle * 5.0 - uSeed * 2.0) * 0.005;
    float front = 0.06 + pow(uAge, 0.6) * 0.88;
    float behind = front - r - wobble;
    if (behind < 0.0) return 0.0;
    // 앞머리에서 뒤로 갈수록 작아지고, 물방울 자리부터 잔잔해진다
    return sin(behind * 34.0) * exp(-behind * 7.5) * smoothstep(0.0, 0.03, behind);
  }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = max(length(p), 0.001);
    float angle = atan(p.y, p.x);
    float slope = height(r + 0.006, angle) - height(r - 0.006, angle);
    vec2 normal = -(p / r) * slope * 8.0;
    // 천장 등 쪽에서 비스듬히 오는 빛
    float shade = dot(normal, normalize(vec2(0.55, 0.83)));
    float life = pow(1.0 - uAge, 1.4) * smoothstep(1.0, 0.8, r);
    float highlight = pow(max(shade, 0.0), 1.5);
    float shadow = max(-shade, 0.0);
    float alpha = clamp((highlight * 0.8 + shadow * 0.34) * life, 0.0, 0.62);
    vec3 color = mix(uColor * 0.2, uColor * 1.7, step(0.0, shade));
    gl_FragColor = vec4(color, alpha);
  }
`;

const rippleGeometry = new THREE.PlaneGeometry(2, 2);

function createRippleMaterial(seed: number, brightness: number) {
  return new THREE.ShaderMaterial({
    vertexShader: RIPPLE_VERTEX,
    fragmentShader: RIPPLE_FRAGMENT,
    uniforms: {
      uAge: { value: 0 },
      uSeed: { value: seed },
      uColor: { value: new THREE.Color(0.62 * brightness, 0.72 * brightness, 0.8 * brightness) },
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

function computeDripVolume(ear: THREE.Vector3, spot: PuddleSpot, quietZs: readonly number[]) {
  if (ear.x >= spot.x + 4) return 0; // 본부실(복도 바깥)에서는 안 들린다
  const d = Math.hypot(ear.x - spot.x, ear.z - spot.z);
  if (d >= MAX_HEARING_DISTANCE) return 0;
  const byDistance = (1 - d / MAX_HEARING_DISTANCE) ** 2;
  let byVending = 1;
  for (const z of quietZs) {
    const k = (Math.abs(ear.z - z) - VENDING_SILENT) / (VENDING_FADE_END - VENDING_SILENT);
    byVending = Math.min(byVending, THREE.MathUtils.clamp(k, 0, 1));
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
  const rippleMaterials = useMemo(
    () => spots.map((spot, i) => createRippleMaterial(i * 1.7, Math.max(0.35, brightness(spot.z)))),
    [spots, brightness],
  );
  useEffect(
    () => () => {
      for (const material of rippleMaterials) material.dispose();
    },
    [rippleMaterials],
  );

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
      const p = (u - FALL_PORTION) / (1 - FALL_PORTION);
      if (u < FALL_PORTION) {
        drop.visible = true;
        // 아래로 갈수록 빨라져야 물처럼 보인다. 빨라질수록 길게 늘어난다.
        const h = (u / FALL_PORTION) ** 2;
        drop.position.y = ceilingY + (floorY - ceilingY) * h;
        drop.scale.set(1, 1 + h * 2.2, 1);
      } else if (p < REBOUND_PORTION) {
        // 수면에 부딪힌 물이 작은 방울로 튀어 올랐다 떨어진다
        drop.visible = true;
        drop.position.y = floorY + Math.sin((p / REBOUND_PORTION) * Math.PI) * REBOUND_HEIGHT;
        drop.scale.setScalar(0.55);
      } else {
        drop.visible = false;
      }
      if (u >= FALL_PORTION) {
        ripple.visible = true;
        // 물결은 웅덩이 모양과 상관없이 둥글게 번진다. 웅덩이 밖 마른 바닥으로는 넘어가지 않는다.
        const radius = RIPPLE_RADIUS * Math.min(spot.sx, spot.sz);
        ripple.scale.set(radius, radius, 1);
        const material = ripple.material;
        if (material instanceof THREE.ShaderMaterial) material.uniforms.uAge.value = p;
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
              geometry={rippleGeometry}
              material={rippleMaterials[i]}
              visible={false}
            />
          </group>
        );
      })}
    </group>
  );
}
