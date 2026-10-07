import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";

import type { OutlineValues } from "@/engine/toon";
import { HeldItem } from "@/lobby/AimTracker";
import { drinkAction, heldDrink, useDrink } from "@/props/drinkState";

import HeldCanModel from "./HeldCanModel";
import HeldCupModel from "./HeldCupModel";
import HeldPaperModel from "./HeldPaperModel";

interface HeldDrinkProps {
  outline?: OutlineValues | null;
}

/**
 * 손에 든 컵·캔·쪽지와 따기·마시기 모션.
 * HeldItem 그룹은 카메라와 같은 방향이라 로컬 +Z 가 사용자 쪽 — 마실 때 +Z 로 당기고 +x 로 기울여 입구가 입에 온다.
 */
export default function HeldDrink({ outline }: HeldDrinkProps) {
  useDrink();
  const drink = heldDrink();
  const groupRef = useRef<THREE.Group>(null);
  const tabRef = useRef<THREE.Group>(null);
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    // 쪽지는 펼쳐 보면 화면 앞·중앙으로 크게 당겨 읽게 한다.
    if (drink && drink.kind === "paper") {
      const isViewing = drink.opened;
      const tx = isViewing ? -0.13 : 0;
      const ty = isViewing ? 0.05 : 0;
      const tz = isViewing ? 0.5 : 0;
      const ts = isViewing ? 1.8 : 1;
      group.position.x += (tx - group.position.x) * 0.15;
      group.position.y += (ty - group.position.y) * 0.15;
      group.position.z += (tz - group.position.z) * 0.15;
      group.scale.setScalar(group.scale.x + (ts - group.scale.x) * 0.15);
      group.rotation.set(0, 0, 0);
      return;
    }
    const { action, startedAt } = drinkAction();
    const t = startedAt ? (performance.now() - startedAt) / 1000 : 99;
    let py = 0;
    let pz = 0;
    let rx = 0;
    if (action === "sip" && t < 1.3) {
      const s = Math.sin((t / 1.3) * Math.PI);
      py = s * 0.12; // 입 높이로
      pz = s * 0.55; // 사용자 쪽으로
      rx = s * 1.05; // 입구가 사용자 쪽으로
    } else if (action === "open" && t < 0.6) {
      const s = Math.sin((t / 0.6) * Math.PI);
      py = s * 0.05;
      pz = s * 0.06; // 살짝 들어 올리며 딴다
    }
    group.position.set(0, py, pz);
    group.rotation.x = rx;
    group.scale.setScalar(1);
    const tab = tabRef.current;
    if (tab) {
      const goal = drink && drink.kind === "can" && drink.opened ? -0.9 : 0;
      tab.rotation.x += (goal - tab.rotation.x) * 0.2;
    }
  });
  if (!drink) return null;
  const isCan = drink.kind === "can";
  const isPaper = drink.kind === "paper";
  return (
    <HeldItem
      itemId="drink"
      kind="drink"
      forward={isPaper ? 0.9 : isCan ? 1.0 : 1.1}
      down={isPaper ? 0.35 : 0.5}
      side={isPaper ? 0.15 : 0.35}
    >
      <group ref={groupRef}>
        {isPaper ? (
          <HeldPaperModel outline={outline} />
        ) : isCan ? (
          <HeldCanModel color={drink.color ?? ""} isOpened={drink.opened} tabRef={tabRef} outline={outline} />
        ) : (
          <HeldCupModel
            color={drink.color ?? ""}
            coffeeColor={drink.liquidColor ?? ""}
            remaining={drink.remaining}
            outline={outline}
          />
        )}
      </group>
    </HeldItem>
  );
}
