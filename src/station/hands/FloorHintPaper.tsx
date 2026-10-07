import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { Highlight } from "@/lobby/Highlight";
import { heldCoin } from "@/props/coinState";
import { heldDrink, pickUpPaper } from "@/props/drinkState";
import { hintPaperDroppedAt, hintPaperLocation, pickUpHintPaper, useHintPaper } from "@/props/hintPaperState";
import { nozzleLocation } from "@/props/nozzleState";

import { hintPaperTexture } from "./hintPaperTexture";

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
  const texture = useMemo(() => hintPaperTexture(), []);
  // 바닥에 눕은 종이는 테가 없으면 바닥 무늬에 묻힌다 — 선을 두르려고 지오를 따로 둔다.
  const geometry = useMemo(() => new THREE.PlaneGeometry(0.3, 0.3), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const spotRef = useRef<THREE.Group>(null);
  if (hintPaperLocation() !== "floor") return null;
  const position = hintPaperDroppedAt() ?? DEFAULT_SPOT;
  return (
    <group position={position}>
      <group ref={spotRef} />
      <Highlight id={HINT_PAPER_PICKUP_ID} anchor={() => [0, 0, 0]} grow={0.14}>
        {/* 반듯하면 누가 놓아 둔 것처럼 보여 조금 비틀어 눕힌다. */}
        <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0.42]} position={[0, 0.012, 0]} receiveShadow>
          <meshToonMaterial map={texture} gradientMap={TOON_GRADIENT} side={THREE.DoubleSide} />
          <ToonOutline geometry={geometry} outline={outline} />
        </mesh>
      </Highlight>
      <Interactable
        id={HINT_PAPER_PICKUP_ID}
        radius={0.55}
        reach={6}
        label=""
        // 한 번에 하나만 든다(관창·동전과 같은 규칙)
        disabled={() => !!heldDrink() || !!heldCoin() || nozzleLocation() === "hand"}
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
