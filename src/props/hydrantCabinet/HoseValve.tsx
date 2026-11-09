import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { Vector3Tuple } from "three";

import { ToonOutline } from "@/engine/outline";
import type { OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { AimHighlight } from "@/lobby/AimHighlight";
import { showToast } from "@/game/toast";
import { openHinge } from "@/props/hingeState";
import { hoseAnchors } from "@/props/nozzleState";
import {
  canTurnValve,
  getHoseFlowStartedAt,
  getValveOpening,
  turnValve,
  usePanelWiring,
} from "@/props/panelWiringState";
import ToonMaterial from "@/props/shared/ToonMaterial";
import { type AimHighlightSettings, getWorldPositionOf } from "@/props/shared/aimTarget";

interface HoseValveProps {
  valveId: string;
  /** 소화전함 문 id — 전류가 출발할 때 닫혀 있으면 연다 */
  cabinetId: string;
  position: Vector3Tuple;
  /** 앞면이 향하는 x 방향(+1 / −1) */
  d: number;
  metalColor: string;
  handleColor: string;
  canHandle: boolean;
  highlight?: AimHighlightSettings;
  brightness: number;
  outline?: OutlineValues | null;
}

/**
 * 개폐 밸브 — 함 아래쪽 왼편, 출구가 위를 본다. 내려온 호스 끝이 닿는 자리에 있어야 "여기 물린다"로 읽힌다.
 * 배전반 선 셋을 잇고 차단기를 올리고 관창을 꽂으면 전류가 호스를 타고 온다. 그 전류가 닿아야 돈다.
 */
/** 전류가 닿았는데 어디로 가야 할지 몰랐다(미르 11/9) — 화면이 밸브를 비춘 뒤에도 남는 말 */
const VALVE_READY_TOAST = "소화전으로 돌아가 [E]로 밸브를 열자";
/** 밸브 맥박 주기(초) — 튜토리얼 바닥 동그라미(1.6초)보다 조금 빠르게 「지금」으로 읽히게 */
const PULSE_SECONDS = 1.2;

/** 돌릴 수 있는 동안 0.35~1 로 숨쉰다. canTurnValve 는 시간으로 정해져 알림이 없어 매 프레임 읽는다(Codex 10) */
const readValvePulse = () =>
  canTurnValve()
    ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((performance.now() / 1000) * ((Math.PI * 2) / PULSE_SECONDS)))
    : 0;

export default function HoseValve({
  valveId,
  cabinetId,
  position,
  d,
  metalColor,
  handleColor,
  canHandle,
  highlight,
  brightness,
  outline,
}: HoseValveProps) {
  const handleRef = useRef<THREE.Group>(null);
  const turned = useRef(0);
  usePanelWiring(); // 열림 상태가 바뀌면 끔 조건이 따라오게
  const hoseStartedAt = getHoseFlowStartedAt();
  // 전류가 출발할 때 소화전 문이 닫혀 있으면 연다 — 화면이 닫힌 문 뒤 밸브를 보고 끝나지 않게. 처음 한 번만(나중에 손으로 닫으면 그대로 둔다)
  const hasOpenedDoor = useRef(false);
  useEffect(() => {
    if (hoseStartedAt < 0 || hasOpenedDoor.current) return;
    hasOpenedDoor.current = true;
    openHinge(cabinetId);
  }, [hoseStartedAt, cabinetId]);
  // 전류가 닿은 순간 한 번 — 뽑았다 다시 꽂아 또 닿으면 다시(토스트는 한 칸이라 쌓이지 않는다)
  const wasReady = useRef(false);
  useEffect(() => {
    hoseAnchors.valve = handleRef.current;
    return () => {
      hoseAnchors.valve = null;
    };
  }, []);
  useFrame((_, dt) => {
    const isReady = canTurnValve();
    if (isReady && !wasReady.current) showToast(VALVE_READY_TOAST, 6000);
    wasReady.current = isReady;
    const handle = handleRef.current;
    if (!handle) return;
    turned.current += (getValveOpening() - turned.current) * (1 - Math.exp(-dt * 3.2));
    // 오른쪽(시계 방향)으로 두 바퀴
    handle.rotation.z = -turned.current * Math.PI * 4;
  });
  return (
    <group position={position}>
      {/* 뒤(급수관)에서 나오는 가로 관 */}
      <mesh position={[-d * 0.11, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 0.22, 10]} />
        <ToonMaterial color={metalColor} brightness={brightness} />
        <ToonOutline outline={outline} />
      </mesh>
      {/* 몸통(엘보) */}
      <mesh castShadow>
        <cylinderGeometry args={[0.052, 0.058, 0.15, 10]} />
        <ToonMaterial color={metalColor} brightness={brightness} />
        <ToonOutline outline={outline} />
      </mesh>
      {/* 위로 올라가는 출구 + 커플링 — 내려온 호스를 여기 문다 */}
      <mesh position={[0, 0.14, 0]} castShadow>
        <cylinderGeometry args={[0.042, 0.042, 0.14, 10]} />
        <ToonMaterial color={metalColor} brightness={brightness} />
        <ToonOutline outline={outline} />
      </mesh>
      <mesh position={[0, 0.225, 0]} castShadow>
        <cylinderGeometry args={[0.058, 0.058, 0.07, 10]} />
        <ToonMaterial color="#b9a24a" brightness={brightness} />
        <ToonOutline outline={outline} />
      </mesh>
      {/* 핸들은 몸통 바로 앞 — 옆으로 비키면 바퀴만 떠 보인다. 도는 것은 안쪽 그룹이다
          (바깥까지 돌리면 세워 둔 방향이 같이 틀어져 바퀴가 눕는다). */}
      <group position={[d * 0.11, 0.02, 0]} rotation={[0, Math.PI / 2, 0]}>
        <AimHighlight
          id={valveId}
          anchor={() => [0, 0, 0]}
          color={highlight?.color}
          strength={highlight?.strength}
          grow={highlight?.grow}
          pulse={readValvePulse}
        >
          <group ref={handleRef}>
            <mesh castShadow>
              <torusGeometry args={[0.062, 0.015, 6, 14]} />
              <ToonMaterial color={handleColor} brightness={brightness} />
              <ToonOutline outline={outline} />
            </mesh>
            {[0, 1, 2].map((i) => (
              <mesh key={i} rotation={[0, 0, (i * Math.PI) / 3]} castShadow>
                <boxGeometry args={[0.125, 0.015, 0.014]} />
                <ToonMaterial color={handleColor} brightness={brightness} />
              </mesh>
            ))}
            <mesh>
              <cylinderGeometry args={[0.024, 0.024, 0.045, 8]} />
              <ToonMaterial color={handleColor} brightness={brightness} />
            </mesh>
          </group>
        </AimHighlight>
        <Interactable
          id={valveId}
          radius={0.28}
          reach={5}
          label="[E] 밸브 열기"
          // 눌러도 아무 일 없으면 고장으로 읽힌다 — 돌 수 있을 때만 뜬다
          disabled={() => !canHandle || !canTurnValve()}
          position={() => getWorldPositionOf(handleRef)}
          run={() => turnValve()}
        />
      </group>
    </group>
  );
}
