import { useRef } from "react";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { scaleColor } from "@/engine/color";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { AimHighlight } from "@/lobby/AimHighlight";
import NozzleModel from "@/props/hydrantCabinet/NozzleModel";
import { getNozzleLocation, pickUpNozzle, plugNozzle, useNozzle } from "@/props/nozzleState";
import { areAllCircuitsLive } from "@/props/panelWiringState";
import GlowHalo from "@/props/shared/GlowHalo";
import { attentionPulse } from "@/props/shared/glowPulse";
import ToonMaterial from "@/props/shared/ToonMaterial";
import { type AimHighlightSettings, getWorldPositionOf } from "@/props/shared/aimTarget";
import { isWorkLampPuzzleHandFull } from "@/props/workLampPuzzle/workLampState";

/**
 * 구멍이 「여기 꽂아라」로 빛나는 동안 — 회로가 다 살고 아직 안 꽂혔을 때. 꽂으면 꺼진다(11/12).
 * 차단기 · 선은 상자가 알리지만 매 프레임 읽어도 싸다.
 */
const isSocketWaiting = () => areAllCircuitsLive() && getNozzleLocation() !== "plugged";
const readSocketPulse = attentionPulse(isSocketWaiting);
/** 빛무리를 구멍 입구에서 판 앞쪽으로 내미는 거리(미터) — 테두리에 묻히지 않게 */
const HALO_FORWARD = 0.1;

interface NozzleSocketProps {
  panelId: string;
  /** 판 앞면이 향하는 x 방향(+1 / −1) */
  d: number;
  geometry: { rim: THREE.BufferGeometry; bore: THREE.BufferGeometry; bottom: THREE.BufferGeometry };
  /** 구멍 입구(판 앞면) */
  mouth: Vector3Tuple;
  /** 꽂힌 관창 원점 — 물 나오는 끝이 구멍 바닥에 닿는다 */
  pluggedPosition: Vector3Tuple;
  /** 로컬 +y(노란 끝)가 구멍 속(−d·x)을 향하는 각 */
  pluggedRotation: Vector3Tuple;
  rimColor: string;
  holeColor: string;
  /** 꽂힌 관창 색 — 소화전함 금속색과 같아야 옮겨 온 그 한 자루로 읽힌다 */
  nozzleColor: string;
  canHandle: boolean;
  highlight?: AimHighlightSettings;
  brightness: number;
  outline?: OutlineValues | null;
}

/** 계기창 아래 관창 구멍 — 소화전에서 꺼낸 관창을 꽂는 자리. 다시 뽑을 수 있어야 잘못 꽂아도 퍼즐이 안 막힌다. */
export default function NozzleSocket({
  panelId,
  d,
  geometry,
  mouth,
  pluggedPosition,
  pluggedRotation,
  rimColor,
  holeColor,
  nozzleColor,
  canHandle,
  highlight,
  brightness,
  outline,
}: NozzleSocketProps) {
  const location = useNozzle();
  // 메시에 ref 를 달면 그 메시를 안 그릴 때 자리도 사라져 빈 그룹을 쓴다
  const mouthRef = useRef<THREE.Group>(null);
  const pluggedRef = useRef<THREE.Group>(null);
  const plugId = `nozzlePlug:${panelId}`;
  const unplugId = `nozzleUnplug:${panelId}`;
  return (
    <>
      {/* 선 셋을 잇고 차단기를 올리면 테두리가 소화전 밸브처럼 숨쉬며 빛난다 — 함 속 관창과 같은 빛, 꽂으면 꺼진다 */}
      <AimHighlight id={plugId} anchor={() => mouth} grow={0} strength={0.5} pulse={readSocketPulse}>
        <mesh geometry={geometry.rim} castShadow receiveShadow>
          <ToonMaterial color={rimColor} brightness={brightness} />
          <ToonOutline geometry={geometry.rim} outline={outline} />
        </mesh>
      </AimHighlight>
      <GlowHalo position={[mouth[0] + d * HALO_FORWARD, mouth[1], mouth[2]]} visible={isSocketWaiting} />
      {/* 관 벽은 바깥을 봐서 들여다보면 잘려 나간다 — 이 메시만 양면이다 */}
      <mesh geometry={geometry.bore}>
        <meshToonMaterial
          color={scaleColor(holeColor, brightness * 0.95)}
          gradientMap={TOON_GRADIENT}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* 바닥은 벽보다 한 단 더 어둡게 — 그 차이가 깊이로 읽힌다 */}
      <mesh geometry={geometry.bottom}>
        <meshBasicMaterial color={scaleColor(holeColor, brightness * 0.45)} toneMapped={false} />
      </mesh>
      <group ref={mouthRef} position={mouth} />
      {/* 들고 있을 때만 꽂는다 */}
      <Interactable
        id={plugId}
        radius={0.3}
        reach={4}
        label="[E] 관창 꽂기"
        // 회로가 살아야 꽂는다 — 관창은 그 뒤에야 꺼낼 수 있지만, 조건은 여기도 한 함수에 모은다
        disabled={() => !canHandle || !areAllCircuitsLive() || getNozzleLocation() !== "hand"}
        position={() => getWorldPositionOf(mouthRef)}
        run={() => plugNozzle()}
      />
      {location === "plugged" && (
        <>
          <AimHighlight
            id={unplugId}
            anchor={() => pluggedPosition}
            color={highlight?.color}
            strength={highlight?.strength}
            grow={highlight?.grow}
          >
            <group position={pluggedPosition} rotation={pluggedRotation} ref={pluggedRef}>
              <NozzleModel metalColor={nozzleColor} brightness={brightness} outline={outline} />
            </group>
          </AimHighlight>
          <Interactable
            id={unplugId}
            radius={0.34}
            reach={4}
            label="[E] 관창 뽑기"
            // 조건은 한 함수에 모은다 — 따로 적으면 뒤엣것만 남는다
            disabled={() => !canHandle || getNozzleLocation() !== "plugged" || isWorkLampPuzzleHandFull()}
            position={() => getWorldPositionOf(pluggedRef)}
            run={() => pickUpNozzle()}
          />
        </>
      )}
    </>
  );
}
