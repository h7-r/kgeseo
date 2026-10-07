import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

import { scaleColor } from "@/engine/color";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { Highlight } from "@/lobby/Highlight";
import { useLockUnlocked } from "@/props/combinationLock";
import { rattleOffset, toggleHinge, useIsOpen } from "@/props/hingeState";

import BreakerWiring from "./BreakerWiring";
import { BREAKER_DOOR_THICKNESS } from "./dimensions";
import { openBoxGeometry } from "./geometry";
import HandwrittenHint from "./HandwrittenHint";
import { circuitStripTexture } from "./textures";
import { pluggedWireCount, usePluggedWiresKey, useWiringCorrect } from "./workLampState";

const MINI_BREAKER_COUNT = 6;
const LOUVER_COUNT = 5;
const LEVER_TILT = 0.5;
const point = new THREE.Vector3();

interface BreakerBoxProps {
  position: [number, number, number];
  direction?: number;
  width?: number;
  height?: number;
  depth?: number;
  bodyColor?: string;
  doorColor?: string;
  /** 밝은 뒤판 — 검정이면 열어도 아무것도 안 보인다 */
  interiorColor?: string;
  labelColor?: string;
  brightness?: number;
  /** 문과 자물쇠가 같이 쓰는 id */
  doorId: string;
  isRaised: boolean;
  onLever: () => void;
  outline?: OutlineValues | null;
}

/**
 * 차단기함(분전반). 소화전함과 갈리게 하는 실물 단서 넷 — 문의 루버, 매립 손잡이, 걸쇠+자물쇠,
 * 밝은 뒤판 위의 소형 차단기 줄·회로 표찰·나이프 스위치. 열어서 보는 것에만 밝기 하한을 둔다.
 * 몸통·문짝은 속 찬 덩어리로 둔다 — 얇은 판에 외곽선을 두르면 각도마다 테두리가 떠서 움직인다.
 */
export default function BreakerBox({
  position,
  direction = 1,
  width = 1.5,
  height = 2.0,
  depth = 0.45,
  bodyColor = "#464b52",
  doorColor = "#565d66",
  interiorColor = "#6a7079",
  labelColor = "#b5443a",
  brightness = 1,
  doorId,
  isRaised,
  onLever,
  outline,
}: BreakerBoxProps) {
  const d = direction;
  const isOpen = useIsOpen(doorId);
  const isUnlocked = useLockUnlocked(doorId);
  usePluggedWiresKey(); // 레버 라벨의 꽂힌 수를 따라가려고 구독한다
  const isWired = useWiringCorrect();
  const doorRef = useRef<THREE.Group>(null);
  const leverRef = useRef<THREE.Group>(null);
  const innerBrightness = Math.max(0.55, brightness);
  const stripTexture = circuitStripTexture(1);

  const wallThickness = 0.05;
  const bodyGeometry = useMemo(
    () => openBoxGeometry({ depth, height, width, wallThickness, direction: d }),
    [depth, height, width, d],
  );
  // 문짝을 함보다 작게(소화전함과 같은 규칙) — 같은 크기면 열릴 때 모서리가 테두리에 잘린다
  const doorWidth = width - 0.14;
  const doorHeight = height - 0.16;
  const doorGeometry = useMemo(
    () => new THREE.BoxGeometry(BREAKER_DOOR_THICKNESS, doorHeight, doorWidth),
    [doorHeight, doorWidth],
  );
  useEffect(
    () => () => {
      bodyGeometry?.dispose();
      doorGeometry.dispose();
    },
    [bodyGeometry, doorGeometry],
  );

  const doorAngle = useRef(0);
  useFrame((_, dt) => {
    // 함이 d 쪽을 보므로 d·각 — 반대 부호면 문이 벽 속으로 젖혀져 잘려 보인다
    const goal = isOpen ? (d * 104 * Math.PI) / 180 : 0;
    doorAngle.current += (goal - doorAngle.current) * Math.min(1, dt * 9);
    // 잠긴 채 당기면 덜컹 — 자물쇠도 같은 id 라 같이 흔들린다
    if (doorRef.current) doorRef.current.rotation.y = doorAngle.current + rattleOffset(doorId) * 0.05 * -d;
    const lever = leverRef.current;
    if (lever) {
      const t = isRaised ? -LEVER_TILT : LEVER_TILT;
      lever.rotation.z += (t - lever.rotation.z) * Math.min(1, dt * 12);
    }
  });

  // 레버 날은 z 축으로 젖혀져 앞으로 날길이·sin(각)만큼 나온다. 뒤판에서 0.11 이면 닫힌 문 안쪽에 머문다.
  const housingHeight = height * 0.26;
  const housingWidth = width * 0.3;
  const bladeLength = height * 0.16;
  const switchX = wallThickness + 0.06;

  const revealEdges: [number, number, number, [number, number, number]][] = [
    [0, (height - wallThickness) / 2 - 0.004, 0, [depth * 0.9, 0.012, width - wallThickness * 2]],
    [0, -(height - wallThickness) / 2 + 0.004, 0, [depth * 0.9, 0.012, width - wallThickness * 2]],
    [0, 0, (width - wallThickness) / 2 - 0.004, [depth * 0.9, height - wallThickness * 2, 0.012]],
    [0, 0, -(width - wallThickness) / 2 + 0.004, [depth * 0.9, height - wallThickness * 2, 0.012]],
  ];

  return (
    <group position={position}>
      {/* 몸통 강조는 닫힌 문을 볼 때만 — 열린 뒤 레버·선을 겨냥할 때마다 함 전체가 떴다 꺼졌다 */}
      <Highlight id={isOpen ? "__none" : doorId} anchor={() => null} grow={0} strength={0.16}>
        {bodyGeometry && (
          <mesh geometry={bodyGeometry} castShadow receiveShadow>
            <meshToonMaterial color={scaleColor(bodyColor, brightness)} gradientMap={TOON_GRADIENT} />
            <ToonOutline geometry={bodyGeometry} outline={outline} />
            <Outlines thickness={4} color="#131416" />
          </mesh>
        )}
      </Highlight>

      {/* 개구부 안쪽 테를 한 톤 어둡게 — 그래야 벽에 박힌 상자로 읽힌다 */}
      {revealEdges.map(([tx, ty, tz, size], i) => (
        <mesh key={`reveal${i}`} position={[d * (depth * 0.55) + tx, ty, tz]}>
          <boxGeometry args={size} />
          <meshToonMaterial color={scaleColor(bodyColor, brightness * 0.6)} gradientMap={TOON_GRADIENT} />
        </mesh>
      ))}

      {/* 밝은 뒤판 — 위의 검은 부품들이 실루엣으로 읽힌다 */}
      <mesh position={[d * (wallThickness + 0.015), 0, 0]}>
        <boxGeometry args={[0.03, height - 0.14, width - 0.14]} />
        <meshToonMaterial color={scaleColor(interiorColor, innerBrightness)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {[-1, 1].map((sy) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`backScrew${sy}${sz}`}
            position={[d * (wallThickness + 0.032), sy * height * 0.4, sz * width * 0.4]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.018, 0.018, 0.014, 8]} />
            <meshToonMaterial color={scaleColor("#5f666e", innerBrightness)} gradientMap={TOON_GRADIENT} />
          </mesh>
        )),
      )}
      {/* 차단기 줄에서 단자대로 내려가는 굵은 선 — 회로가 지나는 함으로 읽힌다 */}
      {[-1, 1].map((sz) => (
        <mesh key={`cable${sz}`} position={[d * (wallThickness + 0.04), -height * 0.06, sz * width * 0.3]}>
          <boxGeometry args={[0.03, height * 0.34, 0.035]} />
          <meshToonMaterial
            color={scaleColor(sz < 0 ? "#2b2e33" : "#7a4a3a", innerBrightness)}
            gradientMap={TOON_GRADIENT}
          />
        </mesh>
      ))}

      {/* 위 — DIN 레일 + 소형 차단기 줄 + 회로 표찰 */}
      <group position={[d * (wallThickness + 0.05), height * 0.29, 0]}>
        <mesh>
          <boxGeometry args={[0.02, 0.06, width * 0.78]} />
          <meshToonMaterial color={scaleColor("#aeb5bd", innerBrightness)} gradientMap={TOON_GRADIENT} />
        </mesh>
        {Array.from({ length: MINI_BREAKER_COUNT }, (_, i) => {
          const z = (i - (MINI_BREAKER_COUNT - 1) / 2) * ((width * 0.78) / MINI_BREAKER_COUNT);
          // 한 칸만 올라가 있다 — 「여기가 살아 있는 회로」라는 잔단서
          const isUp = i === 2;
          return (
            <group key={`mini${i}`} position={[d * 0.05, 0, z]}>
              <mesh castShadow>
                <boxGeometry args={[0.07, 0.17, (width * 0.78) / MINI_BREAKER_COUNT - 0.012]} />
                <meshToonMaterial color={scaleColor("#cfd4d9", innerBrightness)} gradientMap={TOON_GRADIENT} />
                <Outlines thickness={2} color="#22252a" />
              </mesh>
              <mesh position={[d * 0.045, isUp ? 0.045 : -0.045, 0]}>
                <boxGeometry args={[0.03, 0.055, 0.022]} />
                <meshToonMaterial color="#1b1d21" gradientMap={TOON_GRADIENT} />
              </mesh>
            </group>
          );
        })}
        {/* 차단기 줄(높이 0.17)과 안 겹치게 충분히 내린다 */}
        <mesh position={[d * 0.1, -0.175, 0]} rotation={[0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
          <planeGeometry args={[width * 0.8, width * 0.8 * (44 / 512)]} />
          <meshBasicMaterial map={stripTexture} toneMapped={false} transparent />
        </mesh>
      </group>

      {/* 가운데 — 주 차단기(나이프 스위치). 이것을 올린다. */}
      <group position={[d * switchX, -height * 0.04, 0]}>
        <mesh position={[d * 0.04, 0, 0]} castShadow>
          <boxGeometry args={[0.08, housingHeight, housingWidth]} />
          <meshToonMaterial color="#1c1e22" gradientMap={TOON_GRADIENT} />
          <Outlines thickness={3} color="#0d0e10" />
        </mesh>
        <mesh position={[d * 0.081, 0, 0]}>
          <boxGeometry args={[0.006, housingHeight * 0.86, housingWidth * 0.26]} />
          <meshBasicMaterial color="#08090b" toneMapped={false} />
        </mesh>
        {/* ON(위) 초록 · OFF(아래) 붉은 띠 — 노랑은 이 복도의 금속 톤과 어긋난다 */}
        <mesh position={[d * 0.081, housingHeight * 0.36, 0]}>
          <boxGeometry args={[0.005, housingHeight * 0.12, housingWidth * 0.52]} />
          <meshBasicMaterial color={isRaised ? "#5fd58a" : "#2f5a3d"} toneMapped={false} />
        </mesh>
        <mesh position={[d * 0.081, -housingHeight * 0.36, 0]}>
          <boxGeometry args={[0.005, housingHeight * 0.12, housingWidth * 0.52]} />
          <meshBasicMaterial color={isRaised ? "#5a2a26" : "#c5463a"} toneMapped={false} />
        </mesh>
        {[-1, 1].map((sz) => (
          <mesh key={sz} position={[d * 0.05, 0, sz * housingWidth * 0.66]} castShadow>
            <boxGeometry args={[0.06, housingHeight * 0.4, 0.09]} />
            <meshToonMaterial color={scaleColor("#9aa3ad", innerBrightness)} gradientMap={TOON_GRADIENT} />
            <Outlines thickness={2} color="#131416" />
          </mesh>
        ))}
        <Highlight id={`${doorId}:lever`} anchor={() => null} grow={0} strength={0.35}>
          <group ref={leverRef} position={[d * 0.09, 0, 0]} rotation={[0, 0, LEVER_TILT]}>
            <mesh position={[0, bladeLength * 0.5, 0]} castShadow>
              <boxGeometry args={[0.032, bladeLength, 0.07]} />
              <meshToonMaterial color={scaleColor("#b4bcc4", innerBrightness)} gradientMap={TOON_GRADIENT} />
              <Outlines thickness={2} color="#131416" />
            </mesh>
            <mesh position={[d * 0.026, bladeLength * 0.98, 0]} castShadow>
              <cylinderGeometry args={[0.062, 0.07, 0.16, 14]} />
              <meshToonMaterial color="#202226" gradientMap={TOON_GRADIENT} />
              <Outlines thickness={2} color="#0d0e10" />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.022, 0.022, 0.1, 10]} />
              <meshToonMaterial color={scaleColor("#6e767e", innerBrightness)} gradientMap={TOON_GRADIENT} />
            </mesh>
          </group>
        </Highlight>
        <mesh position={[d * 0.085, housingHeight * 0.62, -housingWidth * 0.68]}>
          <sphereGeometry args={[0.032, 12, 8]} />
          <meshBasicMaterial color={isRaised ? "#7dffa8" : "#3a413d"} toneMapped={false} />
        </mesh>
      </group>

      <BreakerWiring
        position={position}
        direction={d}
        width={width}
        height={height}
        wallThickness={wallThickness}
        brightness={innerBrightness}
        isOpen={isOpen}
      />

      {/* 문짝 — 경첩은 −z 모서리, 문짝은 그 축에서 +z 로 뻗는다 */}
      <group ref={doorRef} position={[d * (depth + 0.01), 0, -doorWidth / 2]}>
        <mesh geometry={doorGeometry} position={[0, 0, doorWidth / 2]} castShadow receiveShadow>
          <meshToonMaterial color={scaleColor(doorColor, brightness)} gradientMap={TOON_GRADIENT} />
          <ToonOutline geometry={doorGeometry} outline={outline} />
        </mesh>

        {/* 루버(환기 슬릿) — 소화전 문에는 절대 없는 분전반의 얼굴 */}
        {Array.from({ length: LOUVER_COUNT }, (_, i) => (
          <mesh
            key={`louver${i}`}
            position={[d * (BREAKER_DOOR_THICKNESS / 2 + 0.006), height * 0.3 - i * 0.075, width / 2]}
          >
            <boxGeometry args={[0.014, 0.028, width * 0.52]} />
            <meshToonMaterial color={scaleColor("#2b2f35", brightness)} gradientMap={TOON_GRADIENT} />
          </mesh>
        ))}

        <mesh
          position={[d * (BREAKER_DOOR_THICKNESS / 2 + 0.005), -height * 0.06, width / 2]}
          rotation={[0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
        >
          <planeGeometry args={[width * 0.46, height * 0.075]} />
          <meshBasicMaterial color={labelColor} toneMapped={false} />
        </mesh>

        {/* 매립 손잡이 — 튀어나온 손잡이를 달면 소화전 문이 된다 */}
        <mesh position={[d * (BREAKER_DOOR_THICKNESS / 2 + 0.004), -height * 0.2, width - 0.17]}>
          <boxGeometry args={[0.01, height * 0.17, 0.085]} />
          <meshToonMaterial color={scaleColor(doorColor, brightness * 0.3)} gradientMap={TOON_GRADIENT} />
        </mesh>
        <mesh position={[d * (BREAKER_DOOR_THICKNESS / 2 + 0.012), -height * 0.2, width - 0.17]}>
          <boxGeometry args={[0.018, height * 0.1, 0.04]} />
          <meshToonMaterial color={scaleColor("#9aa2ab", brightness)} gradientMap={TOON_GRADIENT} />
        </mesh>

        {/* 문 안쪽 — 보강 리브 + 회로도 주머니. 없으면 문이 종이 한 장이다 */}
        <mesh position={[-d * (BREAKER_DOOR_THICKNESS / 2 + 0.004), 0, width / 2]}>
          <boxGeometry args={[0.006, height - 0.08, width - 0.08]} />
          <meshToonMaterial color={scaleColor(doorColor, brightness * 1.35)} gradientMap={TOON_GRADIENT} />
        </mesh>
        {[-1, 1].map((sy) => (
          <mesh key={`rib${sy}`} position={[-d * (BREAKER_DOOR_THICKNESS / 2 + 0.012), sy * height * 0.26, width / 2]}>
            <boxGeometry args={[0.016, 0.05, width - 0.18]} />
            <meshToonMaterial color={scaleColor(doorColor, brightness * 0.8)} gradientMap={TOON_GRADIENT} />
          </mesh>
        ))}
        <mesh position={[-d * (BREAKER_DOOR_THICKNESS / 2 + 0.014), -height * 0.04, width / 2]}>
          <boxGeometry args={[0.01, height * 0.3, width * 0.52]} />
          <meshToonMaterial color={scaleColor("#cdc6ad", Math.max(0.6, brightness))} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#2a2720" />
        </mesh>
        <HandwrittenHint
          text="모양"
          color="#2a2622"
          size={width * 0.46}
          position={[-d * (BREAKER_DOOR_THICKNESS / 2 + 0.021), -height * 0.04, width / 2]}
          rotation={[0, d > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
          brightness={Math.max(0.55, brightness)}
        />

        {[0.28, 0.72].map((t) => (
          <mesh key={t} position={[d * (BREAKER_DOOR_THICKNESS / 2 + 0.01), (t - 0.5) * height * 0.86, 0.07]}>
            <boxGeometry args={[0.035, 0.18, 0.08]} />
            <meshToonMaterial color={scaleColor("#7a828a", brightness)} gradientMap={TOON_GRADIENT} />
          </mesh>
        ))}
      </group>

      {/* 잠긴 동안은 끈다 — 그래야 겨냥이 자물쇠로 간다(자물쇠가 제 대상을 갖는다) */}
      <Interactable
        id={doorId}
        radius={1.2}
        reach={6}
        position={() => {
          const door = doorRef.current;
          if (!door) return null;
          door.getWorldPosition(point);
          return [point.x, point.y, point.z];
        }}
        label={isOpen ? "[E] 차단기함 닫기" : "[E] 차단기함 열기"}
        disabled={() => !isUnlocked}
        run={() => toggleHinge(doorId)}
      />

      {/* 선 셋을 다 꽂기 전에는 무엇을 해야 하는지를 말한다 — 레버만 두면 「눌러도 안 되는데?」가 된다 */}
      <Interactable
        id={`${doorId}:lever`}
        radius={1.0}
        reach={6}
        position={() => [position[0] + d * (depth + 0.1), position[1] - height * 0.04, position[2]]}
        label={isWired ? "[E] 주 차단기 올리기" : `모양 (${pluggedWireCount()}/3)`}
        disabled={() => !isOpen || isRaised}
        run={() => isWired && onLever()}
      />
    </group>
  );
}
