import { Suspense, useMemo } from "react";

import { pickOutline } from "@/engine/leva/savedControls";
import { Interactable } from "@/lobby/AimTracker";
import { Highlight } from "@/lobby/Highlight";
import { grabChair, type LobbyState } from "@/lobby/interactions";
import { heldCoin } from "@/props/coinState";
import { heldDrink } from "@/props/drinkState";
import { nozzleLocation } from "@/props/nozzleState";
import { isWorkLampPuzzleHandFull } from "@/props/workLampPuzzle/workLampState";
import Chair, { CHAIR_SCALE } from "@/station/office/Chair";
import ChairDrag from "@/station/office/ChairDrag";

import type { ChairControls } from "../controls/furnitureControls";
import type { HighlightValues } from "../controls/systemControls";

interface RoomChairsProps {
  chairs: ChairControls;
  lobby: LobbyState;
  highlight: HighlightValues;
}

/** 사무용 의자 다섯 — [E] 로 잡아 끈다. 잡고 있는 의자는 ChairDrag 가 사람 앞으로 끌고 온다. */
export default function RoomChairs({ chairs: { common, drag, chairs }, lobby, highlight }: RoomChairsProps) {
  const outline = useMemo(() => pickOutline(common), [common]);
  return (
    <Suspense fallback={null}>
      {chairs.map((c, i) => {
        const id = `chair${i}`;
        const placed = lobby.chairSpots[id];
        const x = placed ? placed.x : c.x;
        const z = placed ? placed.z : c.z;
        const isDragged = lobby.draggedChair === id;
        const chair = (
          <>
            <Interactable
              id={id}
              radius={0.9}
              position={() => [x, 1.6, z]}
              label="[E] 의자 끌기"
              // 손이 비어 있어야 잡는다. 한 손 규칙은 한 줄에 모은다 — 나눠 적으면 JSX 가 뒤엣것만 쓴다.
              disabled={() =>
                !!lobby.draggedChair ||
                !!lobby.heldItem ||
                nozzleLocation() === "hand" ||
                !!heldCoin() ||
                !!heldDrink() ||
                isWorkLampPuzzleHandFull()
              }
              run={() => grabChair(id)}
            />
            <Highlight
              id={id}
              color={highlight.color}
              strength={highlight.strength}
              grow={highlight.furnitureGrow}
              anchor={() => [x, 0, z]}
            >
              <Chair
                outline={outline}
                name={id}
                // 끄는 동안 충돌을 끈다 — 안 끄면 끌고 가는 의자에 내가 막힌다
                collidable={common.collidable && !isDragged}
                pos={[x, z]}
                rot={c.rotation}
                y={c.height}
                scale={common.size}
                sizeMul={c.sizeMul}
                color={common.color}
              />
            </Highlight>
          </>
        );
        return (
          <group key={id}>
            {isDragged ? (
              <ChairDrag
                id={id}
                origin={[x, z]}
                // Chair 안 충돌 박스와 같은 식이어야 한다(Chair 의 ×0.85 는 여기 넣지 않는다)
                radius={0.65 * CHAIR_SCALE * common.size * c.sizeMul}
                height={1.9 * CHAIR_SCALE * common.size * c.sizeMul}
                distance={drag.distance}
                followBody={drag.followBody}
                slack={drag.slack}
              >
                {chair}
              </ChairDrag>
            ) : (
              chair
            )}
          </group>
        );
      })}
    </Suspense>
  );
}
