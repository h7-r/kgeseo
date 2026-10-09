import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { ToonOutline } from "@/engine/outline";
import { playerView } from "@/engine/playerView";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { AimHighlight } from "@/lobby/AimHighlight";
import { getHeldCoin } from "@/props/coinState";
import { getHeldDrink, pickUpPaper } from "@/props/drinkState";
import {
  getHintPaperDroppedAt,
  getHintPaperLocation,
  pickUpHintPaper,
  setFootSpot,
  useHintPaper,
} from "@/props/hintPaperState";
import { getNozzleLocation } from "@/props/nozzleState";

import { makeHintPaperTexture } from "./hintPaperTexture";

// 겨냥·강조가 같이 쓰는 id
const HINT_PAPER_PICKUP_ID = "hintPaperPickup";

// 못 겨냥한 채 버렸을 때 — 자판기 앞
const DEFAULT_SPOT: Vector3Tuple = [-20.4, 0.05, -3.2];
const spotPoint = new THREE.Vector3();

interface FloorHintPaperProps {
  outline?: OutlineValues | null;
}

/**
 * 바닥에 버린 힌트 쪽지. 동전·관창처럼 내려놓으면 그 자리에 남아야 되돌릴 수 있다(GRD-01).
 * 겨냥하면 밝아지고 [E] 로 다시 줍는다.
 */
export default function FloorHintPaper({ outline }: FloorHintPaperProps) {
  useHintPaper();
  const texture = useMemo(() => makeHintPaperTexture(), []);
  // 바닥에 눕은 종이는 테가 없으면 바닥 무늬에 묻힌다 — 선을 두르려고 지오를 따로 둔다.
  const geometry = useMemo(() => new THREE.PlaneGeometry(0.3, 0.3), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const spotRef = useRef<THREE.Group>(null);
  if (getHintPaperLocation() !== "floor") return null;
  const position = getHintPaperDroppedAt() ?? DEFAULT_SPOT;
  return (
    <group position={position}>
      <group ref={spotRef} />
      <AimHighlight id={HINT_PAPER_PICKUP_ID} anchor={() => [0, 0, 0]} grow={0.14}>
        {/* 반듯하면 누가 놓아 둔 것처럼 보여 조금 비틀어 눕힌다. */}
        <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0.42]} position={[0, 0.012, 0]} receiveShadow>
          <meshToonMaterial map={texture} gradientMap={TOON_GRADIENT} side={THREE.DoubleSide} />
          <ToonOutline geometry={geometry} outline={outline} />
        </mesh>
      </AimHighlight>
      <Interactable
        id={HINT_PAPER_PICKUP_ID}
        radius={0.55}
        reach={6}
        label=""
        // 한 번에 하나만 든다(관창·동전과 같은 규칙)
        disabled={() => !!getHeldDrink() || !!getHeldCoin() || getNozzleLocation() === "hand"}
        position={() => {
          const spot = spotRef.current;
          if (!spot) return null;
          // 겨냥 루프가 초당 20번 부른다 — 그릇 하나를 돌려 쓴다.
          spot.getWorldPosition(spotPoint);
          return [spotPoint.x, spotPoint.y, spotPoint.z];
        }}
        run={() => {
          pickUpPaper();
          pickUpHintPaper();
        }}
      />
    </group>
  );
}

const footForward = new THREE.Vector3();

/**
 * 쪽지를 버릴 발 앞 자리를 적어 둔다. [E] 를 받는 App 은 Canvas 밖이라 카메라를 못 읽는다.
 * 0.1초에 한 번이면 걸으면서 버려도 반 걸음 차이도 안 난다.
 */
export function FootSpotTracker() {
  const { camera } = useThree();
  const elapsed = useRef(0);
  useFrame((_, delta) => {
    elapsed.current += delta;
    if (elapsed.current < 0.1) return;
    elapsed.current = 0;
    camera.getWorldDirection(footForward);
    // 원점은 사람이 선 자리. 카메라에서 재면 3인칭에서 쪽지가 등 뒤 벽 너머에 떨어져 영영 못 줍는다.
    // y 는 복도(0.01)·방(0) 둘 다 살짝 위로 띄운다.
    const body = playerView.ready ? playerView.eye : camera.position;
    setFootSpot([body.x + footForward.x * 1.1, 0.05, body.z + footForward.z * 1.1]);
  });
  return null;
}
