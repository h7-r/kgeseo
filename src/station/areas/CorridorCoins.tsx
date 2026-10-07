import type { Vector3Tuple } from "three";

import type { OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { Highlight } from "@/lobby/Highlight";
import Coin from "@/props/Coin";
import {
  coinDroppedAt,
  coinLocation,
  heldCoin,
  pickUpCoin,
  returnLandingPosition,
  returnSlotPosition,
  type CoinKind,
} from "@/props/coinState";
import { nozzleLocation } from "@/props/nozzleState";
import type { VendingId } from "@/props/vendingMachineState";
import { isWorkLampPuzzleHandFull } from "@/props/workLampPuzzle/workLampState";
import CoinDrop from "@/station/hands/CoinDrop";

import type { CoinValues } from "../controls/coinControls";

const ORIGIN_ANCHOR = (): Vector3Tuple => [0, 0, 0];

// 한 손 규칙 — 동전·관창·작업등 퍼즐 물건 중 하나라도 들었으면 못 줍는다
const isHandBusy = () => !!heldCoin() || nozzleLocation() === "hand" || isWorkLampPuzzleHandFull();

interface FloorCoinProps {
  kind: CoinKind;
  /** 바닥 자리. 겨냥은 그때그때, 낙하 연출은 그리는 순간 읽는다. */
  spot: () => Vector3Tuple;
  /** 반환구 자리 — 있으면 거기서 앞 바닥으로 떨어진다 */
  from?: Vector3Tuple | null;
  rotation: number;
  color: string;
  patternColor: string;
  coin: CoinValues;
  outline: OutlineValues;
}

/** 바닥(또는 반환구 앞)에 놓인 동전 한 닢과 그 겨냥 대상. */
function FloorCoin({ kind, spot, from, rotation, color, patternColor, coin, outline }: FloorCoinProps) {
  const id = `coinPickup:${kind}`;
  return (
    <>
      <Interactable
        id={id}
        // 바닥 물건이라 눈(4.15)에서 발밑까지만 해도 4.1 이다 — 손닿는거리(6)로 둔다. 작은 동전이라 반경도 넓힌다.
        radius={0.75}
        reach={6}
        position={spot}
        label=""
        disabled={isHandBusy}
        run={() => pickUpCoin(kind)}
      />
      <CoinDrop kind={kind} position={spot()} from={from} lift={coin.coinThickness / 2}>
        {/* 겨냥하면 밝아진다 — 주울 수 있다는 표시 */}
        <Highlight id={id} anchor={ORIGIN_ANCHOR} grow={0.14}>
          <Coin
            position={[0, 0, 0]}
            rotation={[0, rotation, 0]}
            pattern={kind}
            color={color}
            patternColor={patternColor}
            radius={coin.coinSize}
            thickness={coin.coinThickness}
            outline={outline}
          />
        </Highlight>
      </CoinDrop>
    </>
  );
}

interface CorridorCoinsProps {
  coin: CoinValues;
  outline: OutlineValues;
}

/**
 * 자판기 앞 바닥의 동전 둘. 손에 들었거나 넣어서 사라졌으면 여기선 안 그린다.
 * 잘못 넣으면 그 자판기 반환구에서 나온다 — 캔 동전은 커피 자판기에서, 종이컵 동전은 음료 자판기에서.
 */
export default function CorridorCoins({ coin, outline }: CorridorCoinsProps) {
  const canLook = {
    rotation: coin.canRotation,
    color: coin.canColor,
    patternColor: coin.canPatternColor,
    coin,
    outline,
  };
  const cupLook = {
    rotation: coin.cupRotation,
    color: coin.cupColor,
    patternColor: coin.cupPatternColor,
    coin,
    outline,
  };
  // Leva 벡터 값은 number[] 로 온다
  const returnedSpot = (vendingId: VendingId, fallback: readonly number[]) => (): Vector3Tuple => {
    const landing = returnLandingPosition(vendingId) ?? fallback;
    return [landing[0], coin.floorY, landing[2]];
  };

  return (
    <>
      {coinLocation("can") === "floor" && (
        <FloorCoin
          kind="can"
          spot={() => coinDroppedAt("can") ?? [coin.canFloorX, coin.floorY, coin.canFloorZ]}
          {...canLook}
        />
      )}
      {coinLocation("can") === "returned:coffee" && (
        <FloorCoin
          kind="can"
          spot={returnedSpot("coffee", coin.coffeeReturn)}
          from={returnSlotPosition("coffee")}
          {...canLook}
        />
      )}
      {coinLocation("cup") === "floor" && (
        <FloorCoin
          kind="cup"
          spot={() => coinDroppedAt("cup") ?? [coin.cupFloorX, coin.floorY, coin.cupFloorZ]}
          {...cupLook}
        />
      )}
      {coinLocation("cup") === "returned:drink" && (
        <FloorCoin
          kind="cup"
          spot={returnedSpot("drink", coin.drinkReturn)}
          from={returnSlotPosition("drink")}
          {...cupLook}
        />
      )}
    </>
  );
}
