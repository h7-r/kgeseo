import { Suspense, type RefObject } from "react";

import type { OutlineValues } from "@/engine/toon";
import { HeldItem } from "@/lobby/AimTracker";
import type { LobbyState } from "@/lobby/interactions";
import { PlacementGhost, PlacementResolver } from "@/lobby/PlacementViews";
import { heldCoin } from "@/props/coinState";
import NozzleModel from "@/props/hydrantCabinet/NozzleModel";
import type { NozzleLocation } from "@/props/nozzleState";
import SaggingHose from "@/props/hydrantCabinet/SaggingHose";
import type { WorkLampPuzzleValues } from "@/props/workLampPuzzle/controls";
import HeldTrash from "@/props/workLampPuzzle/HeldTrash";
import HeldWorkLamp from "@/props/workLampPuzzle/HeldWorkLamp";
import AttachToHand from "@/station/hands/AttachToHand";
import type { AvatarLink, WorldPoint } from "@/engine/avatarLink";
import CoinModel from "@/station/hands/CoinModel";
import FootSpotTracker from "@/station/hands/FootSpotTracker";
import HeldCoin from "@/station/hands/HeldCoin";
import HeldDrink from "@/station/hands/HeldDrink";
import { chairDragState } from "@/station/office/chairDragState";

import type { CoinValues } from "../controls/coinControls";
import type { HydrantInteriorValues, NozzleValues } from "../controls/hydrantControls";
import type { PlacementPreviewValues } from "../controls/interactionControls";
import PickupItemModel, { type PickupLooks } from "./PickupItemModel";
import { pickupSpot, type PickupItem } from "./usePickupItems";

/** 끌고 있는 의자의 등받이 — ChairDrag 가 매 프레임 적어 둔 자리. 잡고 있지 않으면 null. */
const chairHandTarget = (): WorldPoint | null =>
  chairDragState.isHeld ? { x: chairDragState.handX, y: chairDragState.handY, z: chairDragState.handZ } : null;

interface HeldItemsLayerProps {
  lobby: LobbyState;
  pickups: readonly PickupItem[];
  looks: PickupLooks;
  placementPreview: PlacementPreviewValues;
  coin: CoinValues;
  coinOutline: OutlineValues;
  workLamp: WorkLampPuzzleValues;
  corridorOutline: OutlineValues;
  nozzle: NozzleValues;
  /** 관창이 지금 어디 있나(씬이 구독해 넘긴다) */
  nozzleLocation: NozzleLocation;
  hydrantInterior: HydrantInteriorValues;
  /** 끌려 나온 호스는 소화전 자리의 복도 밝기를 따른다 */
  hoseBrightness: number;
  playerRef: RefObject<AvatarLink> | null;
  isThirdPerson: boolean;
  enabled: boolean;
}

/**
 * 손에 든 것과 놓기 미리보기. 방·복도 구역 그룹 밖에 둔다 — 구역 최적화가 그룹을 통째로 꺼서,
 * 안에 두면 복도로 나가는 순간 들고 있던 컵이 사라진다.
 */
export default function HeldItemsLayer({
  lobby,
  pickups,
  looks,
  placementPreview: preview,
  coin,
  coinOutline,
  workLamp,
  corridorOutline,
  nozzle,
  nozzleLocation,
  hydrantInterior,
  hoseBrightness,
  playerRef,
  isThirdPerson,
  enabled,
}: HeldItemsLayerProps) {
  const held = lobby.heldItem ? pickups.find((o) => o.id === lobby.heldItem) : undefined;
  const coinKind = heldCoin();
  // 놓여 있던 자리 — 손이 거기까지 뻗었다가 물건과 함께 돌아온다. 자리는 놓을 때까지 남아 든 채로도 읽힌다.
  const heldFrom = held ? pickupSpot(held, lobby.itemSpots) : null;

  return (
    <Suspense fallback={null}>
      {/* 계산은 보여주기와 따로 — 표시를 꺼도 놓기가 돼야 한다. 쪽지는 여기 안 건다(방 바닥 경계 안으로 당겨져 복도에서 벽 속으로 간다). */}
      <PlacementResolver itemId={lobby.heldItem || (coinKind ? "coin" : null)} />
      <FootSpotTracker />
      <AttachToHand
        playerRef={playerRef}
        isThirdPerson={isThirdPerson}
        enabled={enabled}
        lobby={lobby}
        // 상자 id 는 "E-03" 꼴이라 id 앞머리로는 쥐는 법을 못 찾는다
        heldKind={held?.kind}
        chairHandTarget={chairHandTarget}
      />

      {lobby.heldItem && preview.ghostVisible && (
        <PlacementGhost okColor={preview.okColor} blockedColor={preview.blockedColor} opacity={preview.ghostOpacity}>
          {held && <PickupItemModel item={held} looks={looks} />}
        </PlacementGhost>
      )}

      {/* 동전 미리보기는 바닥에 눕힌 동전이어야 한다 — 세우면 원판 중심이 바닥에 박혀 윗절반만 돔으로 보인다 */}
      {coinKind && preview.ghostVisible && (
        <PlacementGhost okColor={preview.okColor} blockedColor={preview.blockedColor} opacity={preview.ghostOpacity}>
          <CoinModel kind={coinKind} look={coin} outline={coinOutline} isLying />
        </PlacementGhost>
      )}

      <HeldWorkLamp values={workLamp} outline={corridorOutline} />
      <HeldTrash values={workLamp} />

      {lobby.heldItem && (
        <HeldItem
          itemId={lobby.heldItem}
          kind={held?.kind}
          startPosition={heldFrom ? [heldFrom.x, heldFrom.y, heldFrom.z] : null}
          startYaw={heldFrom?.rot ?? 0}
        >
          {held && <PickupItemModel item={held} looks={looks} />}
        </HeldItem>
      )}

      {/* 손에 든 동전 — E 로 투입구에 넣으면 쑥 들어간다 */}
      <HeldCoin look={coin} outline={coinOutline} />
      {/* 손에 든 음료(컵/캔) — E 로 (캔이면 따고) 마시고, 다 비면 버린다 */}
      <HeldDrink outline={coinOutline} />

      {/* 소화전함에서 집어 온 관창. 함 속·배전반 쪽과 같은 모양을 써야 옮겨진 물건으로 읽힌다. */}
      {nozzleLocation === "hand" && (
        <HeldItem itemId="nozzle" kind="nozzle" forward={nozzle.forward} down={nozzle.down} side={nozzle.side}>
          <group rotation={[(nozzle.tilt * Math.PI) / 180, (nozzle.twist * Math.PI) / 180, 0]} scale={nozzle.size}>
            <NozzleModel
              metalColor={hydrantInterior.metalColor}
              brightness={nozzle.brightness}
              outline={corridorOutline}
            />
          </group>
        </HeldItem>
      )}

      {/* 함에서 끌려 나온 호스 — 관창이 함 밖에 있을 때만 그린다(SaggingHose 가 스스로 본다) */}
      {nozzle.hoseVisible && (
        <SaggingHose
          segments={nozzle.hoseSegments}
          radius={nozzle.hoseRadius}
          sag={nozzle.hoseSag}
          exitLength={nozzle.hoseExit}
          approachLength={nozzle.hoseApproach}
          floorY={nozzle.hoseFloorY}
          color={hydrantInterior.hoseColor}
          brightness={hoseBrightness}
          outline={corridorOutline}
        />
      )}
    </Suspense>
  );
}
