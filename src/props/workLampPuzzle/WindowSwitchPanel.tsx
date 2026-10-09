import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

import { scaleColor } from "@/engine/color";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { AimHighlight } from "@/lobby/AimHighlight";

import HandwrittenHint from "./HandwrittenHint";
import {
  hasFullPower,
  isPaintingPowered,
  toggleWindowSwitch,
  useHasFullPower,
  useIsPaintingPowered,
  useWindowSwitchKey,
  WINDOW_COUNT,
  isWindowSwitchOn,
} from "./workLampState";

const SPACING = 0.24;
const SWITCH_IDS = Array.from({ length: WINDOW_COUNT }, (_, i) => `windowSwitch:${i}`);

interface WindowSwitchPanelProps {
  position: [number, number, number];
  direction?: number;
  brightness?: number;
  outline?: OutlineValues | null;
}

/**
 * 객차 조명 시험반 — 스위치 하나가 그림 속 창 하나의 불이다. 사람 있는 창은 켜고 빈 창은 끈다.
 * 이름판 없이 판 위에 휘갈긴 「창」 한 글자뿐이다.
 */
export default function WindowSwitchPanel({
  position,
  direction = -1,
  brightness = 1,
  outline,
}: WindowSwitchPanelProps) {
  const d = direction;
  const isPowered = useIsPaintingPowered();
  const isFullPower = useHasFullPower();
  useWindowSwitchKey(); // 스위치가 바뀌면 다시 그린다(값은 아래에서 직접 읽는다)
  const bodyGeometry = useMemo(() => new THREE.BoxGeometry(0.14, 0.66, SPACING * WINDOW_COUNT + 0.3), []);
  useEffect(() => () => bodyGeometry.dispose(), [bodyGeometry]);
  const innerBrightness = Math.max(0.35, brightness);
  const handles = useRef<(THREE.Group | null)[]>([]);
  useFrame((_, dt) => {
    for (let i = 0; i < WINDOW_COUNT; i++) {
      const handle = handles.current[i];
      if (!handle) continue;
      // 위 = 켬. 레버가 ±x 로 뻗으므로 d 에 따라 같은 각이 위/아래로 갈린다
      const goal = (isWindowSwitchOn(i) ? 0.45 : -0.45) * d;
      handle.rotation.z += (goal - handle.rotation.z) * Math.min(1, dt * 14);
    }
  });
  return (
    <group position={position}>
      <AimHighlight id={SWITCH_IDS} anchor={() => null} grow={0} strength={0.12}>
        <mesh geometry={bodyGeometry} position={[d * 0.07, 0, 0]} castShadow receiveShadow>
          <meshToonMaterial color={scaleColor("#3a3f46", brightness)} gradientMap={TOON_GRADIENT} />
          <ToonOutline geometry={bodyGeometry} outline={outline} />
          <Outlines thickness={3} color="#0f1012" />
        </mesh>
      </AimHighlight>
      <HandwrittenHint
        text="창"
        color="#e9e2cf"
        size={0.5}
        position={[d * 0.143, 0.2, 0]}
        rotation={[0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
        brightness={innerBrightness}
      />
      {/* 그림에 전기가 오면 초록, 다 맞추면 흰빛 */}
      <mesh position={[d * 0.145, 0.2, (SPACING * WINDOW_COUNT) / 2 + 0.06]}>
        <sphereGeometry args={[0.03, 10, 8]} />
        <meshBasicMaterial color={isFullPower ? "#e8fff0" : isPowered ? "#7dffa8" : "#2a302c"} toneMapped={false} />
      </mesh>
      {SWITCH_IDS.map((id, i) => {
        const z = (i - (WINDOW_COUNT - 1) / 2) * SPACING * -d; // 화면 왼쪽부터 1~6 (그림 창 순서와 같다)
        return (
          <group key={i} position={[d * 0.14, -0.12, z]}>
            <mesh position={[d * 0.005, 0.18, 0]}>
              <boxGeometry args={[0.012, 0.07, 0.11]} />
              <meshBasicMaterial color={isPowered && isWindowSwitchOn(i) ? "#ffd978" : "#22262b"} toneMapped={false} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.05, 0.05, 0.03, 14]} />
              <meshToonMaterial color={scaleColor("#8e959d", innerBrightness)} gradientMap={TOON_GRADIENT} />
            </mesh>
            <group
              ref={(o) => {
                handles.current[i] = o;
              }}
              position={[d * 0.02, 0, 0]}
              rotation={[0, 0, -0.45 * d]}
            >
              <mesh position={[d * 0.06, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.016, 0.022, 0.12, 10]} />
                <meshToonMaterial color={scaleColor("#c9d0d8", innerBrightness)} gradientMap={TOON_GRADIENT} />
                <Outlines thickness={2} color="#131416" />
              </mesh>
            </group>
            <Interactable
              id={id}
              radius={0.12}
              reach={6}
              position={() => [position[0] + d * 0.2, position[1] - 0.12, position[2] + z]}
              label={`[E] ${i + 1}`}
              disabled={() => !isPaintingPowered() || hasFullPower()}
              run={() => toggleWindowSwitch(i)}
            />
          </group>
        );
      })}
    </group>
  );
}
