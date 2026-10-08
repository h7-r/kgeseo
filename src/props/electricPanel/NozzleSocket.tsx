import { useRef } from "react";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { scaleColor } from "@/engine/color";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { Highlight } from "@/lobby/Highlight";
import NozzleModel from "@/props/hydrantCabinet/NozzleModel";
import { nozzleLocation, pickUpNozzle, plugNozzle, useNozzle } from "@/props/nozzleState";
import ToonMaterial from "@/props/shared/ToonMaterial";
import { type HighlightSettings, worldPositionOf } from "@/props/shared/aimTarget";
import { isWorkLampPuzzleHandFull } from "@/props/workLampPuzzle/workLampState";

interface NozzleSocketProps {
  panelId: string;
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
  highlight?: HighlightSettings;
  brightness: number;
  outline?: OutlineValues | null;
}

/** 계기창 아래 관창 구멍 — 소화전에서 꺼낸 관창을 꽂는 자리. 다시 뽑을 수 있어야 잘못 꽂아도 퍼즐이 안 막힌다. */
export default function NozzleSocket({
  panelId,
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
      <mesh geometry={geometry.rim} castShadow receiveShadow>
        <ToonMaterial color={rimColor} brightness={brightness} />
        <ToonOutline geometry={geometry.rim} outline={outline} />
      </mesh>
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
        disabled={() => !canHandle || nozzleLocation() !== "hand"}
        position={() => worldPositionOf(mouthRef)}
        run={() => plugNozzle()}
      />
      {location === "plugged" && (
        <>
          <Highlight
            id={unplugId}
            anchor={() => pluggedPosition}
            color={highlight?.color}
            strength={highlight?.strength}
            grow={highlight?.grow}
          >
            <group position={pluggedPosition} rotation={pluggedRotation} ref={pluggedRef}>
              <NozzleModel metalColor={nozzleColor} brightness={brightness} outline={outline} />
            </group>
          </Highlight>
          <Interactable
            id={unplugId}
            radius={0.34}
            reach={4}
            label="[E] 관창 뽑기"
            // 조건은 한 함수에 모은다 — 따로 적으면 뒤엣것만 남는다
            disabled={() => !canHandle || nozzleLocation() !== "plugged" || isWorkLampPuzzleHandFull()}
            position={() => worldPositionOf(pluggedRef)}
            run={() => pickUpNozzle()}
          />
        </>
      )}
    </>
  );
}
