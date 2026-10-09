import { Suspense } from "react";

import { Interactable } from "@/lobby/AimTracker";
import { AimHighlight } from "@/lobby/AimHighlight";
import { pickUpItem, type LobbyState } from "@/lobby/interactions";
import { findItemOnTop } from "@/lobby/placement";
import { MeasuredItem } from "@/lobby/ItemPlacement";
import { getNozzleLocation } from "@/props/nozzleState";
import { isWorkLampPuzzleHandFull } from "@/props/workLampPuzzle/workLampState";

import type { HighlightValues } from "../controls/systemControls";
import PickupItemModel, { type PickupLooks } from "./PickupItemModel";
import { getPickupSize, getPickupSpot, type PickupItem, type PickupKind } from "./usePickupItems";

// 위에 물건을 올릴 수 있는 건 윗면이 평평한 것만 — 컵·모자·삼각 표지는 실제 윗면이 뾰족하거나 둥글어 허공에 걸쳐 보인다
const FLAT_TOP_KINDS: ReadonlySet<PickupKind> = new Set(["laptop", "paper", "box", "collectionBox"]);

interface PickupItemsProps {
  items: readonly PickupItem[];
  lobby: LobbyState;
  looks: PickupLooks;
  highlight: HighlightValues;
}

/**
 * 방에 놓인 들 수 있는 물건들. 어디 있는지는 로비 상태의 자리가 정하고, 손에 든 하나는 여기서 빠져 HeldItemsLayer 가 그린다.
 * 위에 뭔가 얹혀 있으면 겨냥 대상에서 아예 뺀다 — 글자로 이유를 알리지 않으니 「빛나지 않는다」가 곧 「지금은 못 든다」다.
 */
export default function PickupItems({ items, lobby, looks, highlight }: PickupItemsProps) {
  return (
    <Suspense fallback={null}>
      {items.map((item) => {
        if (lobby.heldItem === item.id) return null;
        const spot = getPickupSpot(item, lobby.itemSpots);
        const aimId = `pickup:${item.id}`;
        return (
          <group key={item.id}>
            <Interactable
              id={aimId}
              radius={0.55}
              position={() => {
                const c = getPickupSpot(item, lobby.itemSpots);
                return [c.x, c.y + 0.25, c.z];
              }}
              label={`[E] ${item.name} 들기`}
              disabled={() =>
                !!lobby.heldItem ||
                !!findItemOnTop(item.id) ||
                getNozzleLocation() === "hand" ||
                isWorkLampPuzzleHandFull()
              }
              run={() => pickUpItem(item.id)}
            />
            {/* 면 = 이 위에도 올린다 · 자리 = 겹침 검사 · 재기 = 발자국 크기 */}
            <MeasuredItem
              id={item.id}
              isSurface={FLAT_TOP_KINDS.has(item.kind)}
              occupiesSpace
              isPickable
              baseY={spot.y}
              remeasureKey={`${spot.x},${spot.y},${spot.z},${spot.rot},${getPickupSize(item)},${looks.mug.size},${looks.laptop.size},${looks.evidenceSize},${looks.keyboard.size},${looks.keyboard.thickness},${looks.keyboard.depth},${looks.mouse.size}`}
            >
              <AimHighlight
                id={aimId}
                color={highlight.color}
                strength={highlight.strength}
                grow={highlight.grow}
                anchor={() => {
                  const c = getPickupSpot(item, lobby.itemSpots);
                  return [c.x, c.y, c.z];
                }}
              >
                <PickupItemModel item={item} spot={spot} looks={looks} isHatHanging={!lobby.itemSpots[item.id]} />
              </AimHighlight>
            </MeasuredItem>
          </group>
        );
      })}
    </Suspense>
  );
}
