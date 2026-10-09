import { useRef } from "react";
import type * as THREE from "three";

import type { OutlineValues } from "@/engine/toon";
import CanVendingMachine from "@/props/vending/CanVendingMachine";
import CoffeeVendingMachine from "@/props/vending/CoffeeVendingMachine";
import VendingPushCutscene from "@/props/vending/VendingPushCutscene";
import type { CoffeeTemperature, VendingMachineState } from "@/props/vendingMachineState";
import { getPushOffset } from "@/props/vendingPushState";
import { VendingMachineCollider } from "@/station/layout/Colliders";

import type { CorridorValues } from "../controls/corridorControls";
import type { CoffeeVendingValues, DrinkVendingValues, VendingControlValues } from "../controls/vendingControls";

/** 「비밀 복도 › 커피선택」 선택지 값(저장 데이터라 한글) → 온도 id. "없음" 이면 자판기 상태를 따른다. */
const COFFEE_CHOICE: Record<string, CoffeeTemperature> = { 핫: "hot", 아이스: "iced" };

// (도 × π) ÷ 180 순서를 지킨다 — 곱셈 순서가 바뀌면 마지막 자리가 달라질 수 있다
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** 몸통 선과 캔·버튼·배출구 같은 안쪽 선. 색만 다르다. */
const getMachineOutline = (v: DrinkVendingValues | CoffeeVendingValues, color: string): OutlineValues => ({
  outline: v.outline,
  outlineWidth: v.outlineWidth,
  outlineColor: color,
  crease: v.crease,
  creaseAngle: v.creaseAngle,
  creaseColor: v.creaseColor,
});

interface VendingAreaProps {
  corridor: CorridorValues;
  vending: VendingControlValues;
  /** 컷신 카메라 높이의 기준(「시점(눈높이)」) */
  eyeHeight: number;
  brightnessAt: (z: number) => number;
  isCollisionEnabled: boolean;
  drinkMachine: VendingMachineState;
  coffeeMachine: VendingMachineState;
}

/**
 * 바깥벽에 등을 댄 자판기 두 대와 비밀문 컷신·몸통 충돌.
 * 밝기는 벽·함과 같은 깊이 규칙이다 — 안 그러면 복도 끝에서 자판기만 혼자 환하다.
 */
export default function VendingArea({
  corridor,
  vending: { secretDoor, drink, coffee },
  eyeHeight,
  brightnessAt,
  isCollisionEnabled,
  drinkMachine,
  coffeeMachine,
}: VendingAreaProps) {
  // 음료 자판기만 담아 옆으로 미는 그룹(컷신이 매 프레임 자리를 만진다). 커피 자판기는 제자리다.
  const drinkPushRef = useRef<THREE.Group>(null);
  const drinkZ = drink.z;
  const coffeeZ = coffee.z;

  // 밸브가 돌면 음료 자판기가 문을 비켜 밀린다. 방향은 이미 서 있는 쪽(문을 지나쳐 되돌아오지 않게),
  // 거리는 문을 완전히 비키는 만큼과 자판기 한 대 폭 중 큰 쪽 — 이미 안 가려도 비켜서는 게 보여야 한다.
  const pushDirection = drinkZ >= corridor.doorZ ? 1 : -1;
  const clearance = corridor.doorWidth / 2 + drink.width / 2 + secretDoor.margin - Math.abs(drinkZ - corridor.doorZ);
  const pushDistance = secretDoor.autoFit ? pushDirection * Math.max(drink.width, clearance) : secretDoor.distance;

  const coffeeChoice = COFFEE_CHOICE[corridor.coffeeChoice] ?? null;

  return (
    <>
      <VendingPushCutscene
        targetRef={drinkPushRef}
        enabled={secretDoor.enabled}
        preview={secretDoor.preview}
        distance={pushDistance}
        duration={secretDoor.duration}
        transitionTime={secretDoor.transitionTime}
        // 밀린 뒤 자리까지 한 화면에 담으려고 두 자리의 가운데를 본다
        viewPoint={() => [
          drink.x - secretDoor.viewDistance,
          eyeHeight + secretDoor.viewHeight,
          drinkZ + pushDistance / 2 - secretDoor.viewOffset,
        ]}
        lookAt={() => [drink.x, drink.y + drink.height * secretDoor.viewAim, drinkZ + pushDistance / 2]}
        dustOrigin={() => [drink.x - corridor.vendingDepth / 2, drink.y + 0.12, drinkZ + getPushOffset() * 0.5]}
        dustCount={secretDoor.dustCount}
        dustColor={secretDoor.dustColor}
        dustSize={secretDoor.dustSize}
        dustStrength={secretDoor.dustStrength}
        dustSpread={drink.width * 0.8}
        shake={secretDoor.shake}
      />
      <VendingMachineCollider
        name="vending:drink"
        x={drink.x}
        z={drinkZ}
        width={drink.width}
        depth={corridor.vendingDepth}
        height={drink.height}
        rotation={toRadians(drink.rotationDeg)}
        followsPush
        enabled={isCollisionEnabled}
      />
      <VendingMachineCollider
        name="vending:coffee"
        x={coffee.x}
        z={coffeeZ}
        width={coffee.width}
        depth={corridor.vendingDepth}
        height={coffee.height}
        rotation={toRadians(coffee.rotationDeg)}
        enabled={isCollisionEnabled}
      />
      <group ref={drinkPushRef}>
        <CanVendingMachine
          flapClosedAngle={drink.flapClosedAngle}
          flapOpenAngle={drink.flapOpenAngle}
          flapHeight={drink.flapHeight}
          trayReach={drink.trayReach}
          sideFrontRatio={drink.sideFrontRatio}
          position={[drink.x, drink.y, drinkZ]}
          rotationY={toRadians(drink.rotationDeg)}
          width={drink.width}
          height={drink.height}
          depth={corridor.vendingDepth}
          bodyColor={drink.bodyColor}
          backColor={drink.backColor}
          trimColor={drink.trimColor}
          signColor={drink.signColor}
          signTextColor={drink.signTextColor}
          glassColor={drink.glassColor}
          shelfColor={drink.shelfColor}
          buttonFrameColor={drink.buttonFrameColor}
          panelColor={drink.panelColor}
          darkColor={drink.darkColor}
          vendingId="drink"
          // Leva 강제값이 있으면 그게 이긴다(연출 확인용). 평소에는 버튼을 눌러 나온 캔을 보여 준다.
          dispensedCan={
            corridor.forcedCan >= 0 ? corridor.forcedCan : drinkMachine.dispensed >= 0 ? drinkMachine.dispensed : null
          }
          brightness={brightnessAt(drinkZ)}
          outline={getMachineOutline(drink, drink.outlineColor)}
          innerOutline={getMachineOutline(drink, drink.innerOutlineColor)}
        />
      </group>
      <CoffeeVendingMachine
        position={[coffee.x, coffee.y, coffeeZ]}
        rotationY={toRadians(coffee.rotationDeg)}
        width={coffee.width}
        height={coffee.height}
        depth={corridor.vendingDepth}
        bodyColor={coffee.bodyColor}
        trimColor={coffee.trimColor}
        signColor={coffee.signColor}
        signTextColor={coffee.signTextColor}
        buttonFrameColor={coffee.buttonFrameColor}
        panelColor={coffee.panelColor}
        darkColor={coffee.darkColor}
        cupColor={coffee.cupColor}
        coffeeColor={coffee.coffeeColor}
        dispenserWallColor={coffee.dispenserWallColor}
        dispenserGlassColor={coffee.dispenserGlassColor}
        vendingId="coffee"
        selectedTemperature={corridor.coffeeChoice !== "없음" ? coffeeChoice : coffeeMachine.temperature}
        hasCup={corridor.forcedCup || coffeeMachine.hasCup}
        forcedDoorOpen={corridor.forcedCoffeeDoorOpen}
        doorOpenAngle={coffee.doorOpenAngle}
        brightness={brightnessAt(coffeeZ)}
        outline={getMachineOutline(coffee, coffee.outlineColor)}
        innerOutline={getMachineOutline(coffee, coffee.innerOutlineColor)}
      />
    </>
  );
}
