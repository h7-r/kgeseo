import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { playerView } from "@/engine/playerView";
import type { OutlineValues } from "@/engine/toon";
import { HeldItem } from "@/lobby/AimTracker";
import { coinInsertion, finishInsert, heldCoin, useCoins } from "@/props/coinState";

import CoinModel, { type CoinLook } from "./CoinModel";

const startPoint = new THREE.Vector3();

interface HeldCoinProps {
  look: CoinLook;
  outline?: OutlineValues | null;
}

/**
 * 손에 든 동전과 투입 모션. 투입하면 월드 좌표에서 실제 투입구로 날아가 작아지며 들어가고,
 * 다 들어가면 finishInsert() 가 결과를 확정한다.
 */
export default function HeldCoin({ look, outline }: HeldCoinProps) {
  useCoins();
  const { camera } = useThree();
  const flightRef = useRef<THREE.Group>(null);
  const start = useRef<Vector3Tuple | null>(null);
  useFrame(() => {
    const group = flightRef.current;
    const insertion = coinInsertion();
    if (insertion && group) {
      if (!insertion.t0) {
        insertion.t0 = performance.now();
        // 3인칭 카메라는 캐릭터 뒤라 카메라 앞에서 출발하면 등 뒤 허공에서 몸통을 뚫고 날아간다.
        // 손뼈를 알면 그 손에서, 아니면 사람 자리 기준 오른쪽·아래·앞에서 출발한다.
        const hand = playerView.isThirdPerson ? playerView.hand : null;
        if (hand) {
          hand.getWorldPosition(startPoint);
        } else {
          const body = playerView.ready ? playerView.eye : camera.position;
          startPoint.set(0.5, -0.55, -1.4).applyQuaternion(camera.quaternion).add(body);
        }
        start.current = [startPoint.x, startPoint.y, startPoint.z];
      }
      const from = start.current;
      if (!from) return;
      const goal = insertion.slot || from;
      const t = Math.min(1, (performance.now() - insertion.t0) / 460);
      const e = t * t * (3 - 2 * t);
      group.position.set(
        from[0] + (goal[0] - from[0]) * e,
        from[1] + (goal[1] - from[1]) * e + Math.sin(t * Math.PI) * 0.12,
        from[2] + (goal[2] - from[2]) * e,
      );
      group.scale.setScalar(t < 0.75 ? 1 : Math.max(0.05, 1 - (t - 0.75) / 0.25));
      group.visible = true;
      if (t >= 1) finishInsert();
    } else if (group) {
      group.visible = false;
    }
  });
  const heldKind = heldCoin();
  const inserting = coinInsertion();
  return (
    <>
      {heldKind && (
        <HeldItem itemId="coin" kind="coin" forward={1.4} down={0.55} side={0.5}>
          <CoinModel kind={heldKind} look={look} outline={outline} />
        </HeldItem>
      )}
      {inserting && (
        <group ref={flightRef}>
          <CoinModel kind={inserting.kind} look={look} outline={outline} />
        </group>
      )}
    </>
  );
}
