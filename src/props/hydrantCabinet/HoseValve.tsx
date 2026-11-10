import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { ToonOutline } from "@/engine/outline";
import { getGlowTexture } from "@/engine/textures/glowTexture";
import type { OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { AimHighlight } from "@/lobby/AimHighlight";
import { registerValveCabinet } from "@/game/valveTurnNudge";
import { isHingeOpen, openHinge } from "@/props/hingeState";
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
/** 밸브 맥박 주기(초) — 「지금」으로 읽히게 조금 빠르게 */
const PULSE_SECONDS = 1.2;

/**
 * 전류가 닿아 돌릴 수 있게 되면 밸브 자체가 빛난다 — 바닥 동그라미 · 닿는 순간 글 안내는 없앴다(미르 11/10).
 * 오래 헤매면 글 안내는 game/valveTurnNudge 가 띄운다.
 */
/** 맥박 0~1 — 손잡이 발광(AimHighlight)과 빛무리가 같은 위상으로 숨쉰다 */
const pulseWave = () => 0.5 + 0.5 * Math.sin((performance.now() / 1000) * ((Math.PI * 2) / PULSE_SECONDS));

/** 돌릴 수 있는 동안 0.35~1 로 숨쉰다. canTurnValve 는 시간으로 정해져 알림이 없어 매 프레임 읽는다(Codex 10) */
const readValvePulse = () => (canTurnValve() ? 0.35 + 0.65 * pulseWave() : 0);

/** 손잡이 둘레 빛무리 — 스프라이트 전체 폭(미터, 가장자리는 투명) · 색 · 불투명도 범위 */
const HALO = {
  size: [0.75, 1.05] as const,
  color: "#ffb53a",
  opacity: [0.55, 1] as const,
  /** 손잡이에서 함 앞쪽으로 내미는 거리(미터) — 밸브가 함 안쪽 벽 가까이라 테두리가 빛을 가리지 않게 */
  forward: 0.12,
};

/**
 * 밸브 빛무리 — 가산 혼합 스프라이트. 함 테두리에 덜 가리게 함 앞쪽으로 내밀어 두어서, 문이 닫혀 있으면 문 밖에 떠 보인다 —
 * 그래서 문이 열려 있을 때만 보인다(닫힌 동안은 돌릴 수 없다, Codex 리뷰). 닫혀 있으면 오래 헤맬 때 글 안내가 「문을 열고」로 말한다.
 * 깊이는 쓰지 않는다(뒤 물건을 지우지 않게). 휴대폰은 블룸이 꺼져도 스프라이트만으로 보이게 밝기를 잡았다.
 */
function ValveHalo({ position, cabinetId }: { position: Vector3Tuple; cabinetId: string }) {
  const ref = useRef<THREE.Sprite>(null);
  const material = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: HALO.color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    const sprite = ref.current;
    if (!sprite) return;
    sprite.visible = canTurnValve() && isHingeOpen(cabinetId);
    if (!sprite.visible) return;
    const wave = pulseWave();
    sprite.scale.setScalar(HALO.size[0] + (HALO.size[1] - HALO.size[0]) * wave);
    material.opacity = HALO.opacity[0] + (HALO.opacity[1] - HALO.opacity[0]) * wave;
  });
  return <sprite ref={ref} material={material} position={position} visible={false} renderOrder={2} />;
}

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
  // 오래 헤맬 때 글 안내가 문 상태(열림 · 닫힘)로 말을 고른다
  useEffect(() => registerValveCabinet(cabinetId), [cabinetId]);
  useEffect(() => {
    hoseAnchors.valve = handleRef.current;
    return () => {
      hoseAnchors.valve = null;
    };
  }, []);
  useFrame((_, dt) => {
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
      {/* 빛무리는 핸들 바로 앞(함 앞쪽) — 세워 둔 핸들 그룹 밖에 둔다(스프라이트는 늘 화면을 본다) */}
      <ValveHalo position={[d * (0.11 + HALO.forward), 0.02, 0]} cabinetId={cabinetId} />
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
