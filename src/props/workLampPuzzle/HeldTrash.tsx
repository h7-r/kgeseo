import { HeldItem } from "@/lobby/AimTracker";

import type { HeldPoseValues, WorkLampPuzzleValues } from "./controls";
import TrashModel from "./TrashModel";
import { useHeldTrash } from "./workLampState";

interface HeldTrashProps {
  values: HeldPoseValues & Pick<WorkLampPuzzleValues, "trashScale">;
}

/** 손에 든 쓰레기 — 카메라 앞에 그린다(구역 그룹 밖에 놓는다). */
export default function HeldTrash({ values }: HeldTrashProps) {
  const held = useHeldTrash();
  if (!held) return null;
  return (
    <HeldItem itemId="trash" forward={values.handForward} down={values.handDown} side={values.handSide}>
      <group scale={values.trashScale * 0.8} rotation={[0.3, 0.5, 0]}>
        <TrashModel id={held} brightness={1} />
      </group>
    </HeldItem>
  );
}
