import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

import { scaleColor } from "@/engine/color";
import { buildMergedBoxes } from "@/engine/geometry";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { AimHighlight } from "@/lobby/AimHighlight";

import { makeNameplateTexture } from "./labelTextures";
import { SWITCH_PANEL_WIDTH, SWITCH_SPACING } from "./puzzleGeometry";
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

const BODY = { height: 0.78, width: SWITCH_PANEL_WIDTH };
const FACE_X = 0.14;
/** 유리창 · 스위치 줄 높이 */
const LAMP_Y = 0.07;
const SWITCH_Y = -0.17;
const BRASS = "#b08a3e";
const LIT_LAMP_COLOR = new THREE.Color(2.2, 2.2, 2.2);
const SWITCH_IDS = Array.from({ length: WINDOW_COUNT }, (_, i) => `windowSwitch:${i}`);

interface WindowSwitchPanelProps {
  position: [number, number, number];
  direction?: number;
  brightness?: number;
  outline?: OutlineValues | null;
}

/**
 * 객차 조명 시험반 — 스위치 하나가 그림 속 창 하나의 불이다. 사람 있는 창은 켜고 빈 창은 끈다.
 * 그림 액자와 한 벌로 보이게 호두나무 판에 황동 테를 둘렀고, 스위치는 황동 받침에 흑단 레버, 불은 흰 유리창이다.
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
  const bodyGeometry = useMemo(() => new THREE.BoxGeometry(0.14, BODY.height, BODY.width), []);
  const trimGeometry = useMemo(
    () =>
      buildMergedBoxes([
        { position: [0, BODY.height / 2 - 0.02, 0], size: [0.02, 0.04, BODY.width] },
        { position: [0, -BODY.height / 2 + 0.02, 0], size: [0.02, 0.04, BODY.width] },
        { position: [0, 0, BODY.width / 2 - 0.02], size: [0.02, BODY.height - 0.08, 0.04] },
        { position: [0, 0, -BODY.width / 2 + 0.02], size: [0.02, BODY.height - 0.08, 0.04] },
      ]),
    [],
  );
  useEffect(
    () => () => {
      bodyGeometry.dispose();
      trimGeometry?.dispose();
    },
    [bodyGeometry, trimGeometry],
  );
  const nameplate = makeNameplateTexture("객차 조명", "");
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
          <meshToonMaterial color={scaleColor("#3e2616", brightness)} gradientMap={TOON_GRADIENT} />
          <ToonOutline geometry={bodyGeometry} outline={outline} />
          <Outlines thickness={3} color="#0f1012" />
        </mesh>
      </AimHighlight>
      {trimGeometry && (
        <mesh geometry={trimGeometry} position={[d * FACE_X, 0, 0]}>
          <meshToonMaterial color={scaleColor(BRASS, innerBrightness * 1.1)} gradientMap={TOON_GRADIENT} />
        </mesh>
      )}
      {/* 안쪽 판 — 흑단빛으로 어두워 흰 불과 황동이 살아난다 */}
      <mesh position={[d * (FACE_X - 0.002), 0, 0]} rotation={[0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
        <planeGeometry args={[BODY.width - 0.08, BODY.height - 0.08]} />
        <meshToonMaterial color={scaleColor("#1f1a15", innerBrightness)} gradientMap={TOON_GRADIENT} />
      </mesh>
      <mesh position={[d * (FACE_X + 0.004), 0.28, 0]} rotation={[0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
        <planeGeometry args={[0.62, 0.155]} />
        <meshToonMaterial map={nameplate} color={scaleColor("#ffffff", innerBrightness)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 그림에 전기가 오면 흰빛, 다 맞추면 더 밝게 */}
      <mesh position={[d * (FACE_X + 0.005), 0.28, (BODY.width / 2 - 0.13) * d]}>
        <sphereGeometry args={[0.024, 10, 8]} />
        <meshBasicMaterial color={isFullPower ? "#ffffff" : isPowered ? "#9d9a90" : "#26221d"} toneMapped={false} />
      </mesh>
      {SWITCH_IDS.map((id, i) => {
        const z = (i - (WINDOW_COUNT - 1) / 2) * SWITCH_SPACING * -d; // 화면 왼쪽부터 1~6 (그림 창 순서와 같다)
        const isLit = isPowered && isWindowSwitchOn(i);
        return (
          <group key={i} position={[d * FACE_X, 0, z]}>
            {/* 작은 둥근 유리창 — 켜면 흰빛 */}
            <mesh position={[d * 0.006, LAMP_Y, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.058, 0.058, 0.012, 16]} />
              <meshToonMaterial color={scaleColor(BRASS, innerBrightness)} gradientMap={TOON_GRADIENT} />
            </mesh>
            <mesh position={[d * 0.015, LAMP_Y, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.044, 0.044, 0.008, 16]} />
              <meshBasicMaterial color={isLit ? LIT_LAMP_COLOR : "#2a2722"} toneMapped={false} />
            </mesh>
            {/* 황동 받침 + 흑단 레버 + 상아 손잡이 */}
            <group position={[0, SWITCH_Y, 0]}>
              <mesh position={[d * 0.006, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.07, 0.074, 0.018, 18]} />
                <meshToonMaterial color={scaleColor(BRASS, innerBrightness * 1.05)} gradientMap={TOON_GRADIENT} />
                <Outlines thickness={2} color="#0f0c09" />
              </mesh>
              <group
                ref={(o) => {
                  handles.current[i] = o;
                }}
                position={[d * 0.018, 0, 0]}
                rotation={[0, 0, -0.45 * d]}
              >
                <mesh position={[d * 0.05, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
                  <cylinderGeometry args={[0.013, 0.02, 0.1, 10]} />
                  <meshToonMaterial color={scaleColor("#17140f", innerBrightness)} gradientMap={TOON_GRADIENT} />
                  <Outlines thickness={2} color="#0a0806" />
                </mesh>
                <mesh position={[d * 0.11, 0, 0]} castShadow>
                  <sphereGeometry args={[0.027, 12, 10]} />
                  <meshToonMaterial color={scaleColor("#e8dfc8", innerBrightness)} gradientMap={TOON_GRADIENT} />
                  <Outlines thickness={2} color="#0a0806" />
                </mesh>
              </group>
            </group>
            <Interactable
              id={id}
              radius={0.12}
              reach={6}
              position={() => [position[0] + d * 0.2, position[1] + SWITCH_Y, position[2] + z]}
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
