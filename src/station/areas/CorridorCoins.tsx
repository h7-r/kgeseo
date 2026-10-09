import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { Vector3Tuple } from "three";

import type { OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { AimHighlight } from "@/lobby/AimHighlight";
import Coin from "@/props/Coin";
import {
  getCoinDroppedAt,
  getCoinDroppedTime,
  getCoinLocation,
  getHeldCoin,
  pickUpCoin,
  getReturnLandingPosition,
  getReturnSlotPosition,
  type CoinKind,
} from "@/props/coinState";
import { getNozzleLocation } from "@/props/nozzleState";
import type { VendingId } from "@/props/vendingMachineState";
import { isWorkLampPuzzleHandFull } from "@/props/workLampPuzzle/workLampState";

import type { CoinValues } from "../controls/vendingControls";

const ORIGIN_ANCHOR = (): Vector3Tuple => [0, 0, 0];

// 한 손 규칙 — 동전·관창·작업등 퍼즐 물건 중 하나라도 들었으면 못 줍는다
const isHandBusy = () => !!getHeldCoin() || getNozzleLocation() === "hand" || isWorkLampPuzzleHandFull();

interface CoinDropProps {
  kind: CoinKind;
  /** 바닥 자리 */
  position: Vector3Tuple;
  /** 바닥에서 띄우는 높이(보통 두께 절반) */
  lift?: number;
  /** 반환구 자리. 주면 거기서 앞 바닥으로 포물선을 그리며 떨어진다. */
  from?: Vector3Tuple | null;
  children?: ReactNode;
}

/**
 * 내려놓은 동전의 낙하·반동. 모서리로 떨어져 한 번 튕기고 눕는다.
 * 처음부터 바닥이던 동전(droppedTime 0)은 연출 없이 눕혀 둔다. 겨냥·판정과는 무관하다.
 */
function CoinDrop({ kind, position, lift = 0, from, children }: CoinDropProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [bx, by, bz] = position;
  const landY = by + lift;
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const t0 = getCoinDroppedTime(kind);
    const t = t0 ? (performance.now() - t0) / 1000 : 99;

    if (from) {
      const total = 0.72;
      const fall = 0.5;
      if (t >= total) {
        group.position.set(bx, landY, bz);
        group.rotation.z = 0;
        return;
      }
      let x: number;
      let y: number;
      let z: number;
      if (t < fall) {
        // 앞으로는 등속, 아래로는 가속 + 처음 살짝 튀어나오는 호
        const k = t / fall;
        x = from[0] + (bx - from[0]) * k;
        z = from[2] + (bz - from[2]) * k;
        y = from[1] + (landY - from[1]) * (k * k) + Math.sin(k * Math.PI) * 0.1;
      } else {
        const b = (t - fall) / (total - fall);
        x = bx;
        z = bz;
        y = landY + Math.sin(b * Math.PI) * 0.1 * (1 - b); // 바닥에서 한 번 튕김
      }
      group.position.set(x, y, z);
      const rk = Math.min(1, t / 0.58);
      const ease = 1 - Math.pow(1 - rk, 3);
      group.rotation.z = (1 - ease) * 1.4; // 구르며 눕는다
      return;
    }

    // 제자리에서 수직으로 떨어져 눕는다
    const total = 0.55;
    let dy = 0;
    let rz = 0;
    if (t < total) {
      const fall = 0.3;
      const height = 0.7;
      if (t < fall) {
        const k = t / fall;
        dy = height * (1 - k * k);
      } else {
        const b = (t - fall) / (total - fall);
        dy = Math.sin(b * Math.PI) * 0.12 * (1 - b);
      }
      dy = Math.max(0, dy);
      const rk = Math.min(1, t / 0.42);
      const ease = 1 - Math.pow(1 - rk, 3);
      rz = (1 - ease) * 1.35 - Math.sin(rk * Math.PI) * 0.14;
    }
    group.position.set(bx, landY + dy, bz);
    group.rotation.z = rz;
  });
  return (
    <group ref={groupRef} position={[bx, landY, bz]}>
      {children}
    </group>
  );
}

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
        <AimHighlight id={id} anchor={ORIGIN_ANCHOR} grow={0.14}>
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
        </AimHighlight>
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
    const landing = getReturnLandingPosition(vendingId) ?? fallback;
    return [landing[0], coin.floorY, landing[2]];
  };

  return (
    <>
      {getCoinLocation("can") === "floor" && (
        <FloorCoin
          kind="can"
          spot={() => getCoinDroppedAt("can") ?? [coin.canFloorX, coin.floorY, coin.canFloorZ]}
          {...canLook}
        />
      )}
      {getCoinLocation("can") === "returned:coffee" && (
        <FloorCoin
          kind="can"
          spot={returnedSpot("coffee", coin.coffeeReturn)}
          from={getReturnSlotPosition("coffee")}
          {...canLook}
        />
      )}
      {getCoinLocation("cup") === "floor" && (
        <FloorCoin
          kind="cup"
          spot={() => getCoinDroppedAt("cup") ?? [coin.cupFloorX, coin.floorY, coin.cupFloorZ]}
          {...cupLook}
        />
      )}
      {getCoinLocation("cup") === "returned:drink" && (
        <FloorCoin
          kind="cup"
          spot={returnedSpot("drink", coin.drinkReturn)}
          from={getReturnSlotPosition("drink")}
          {...cupLook}
        />
      )}
    </>
  );
}
