import type { OutlineValues } from "@/engine/toon";
import { HeldItem } from "@/lobby/HeldItem";
import type { WorkLampPuzzleValues } from "@/station/controls/workLampControls";

import TrashModel from "./TrashModel";
import WorkLampModel from "./WorkLampModel";
import { useHeldTrash, useWorkLampLocation } from "./workLampState";

type HeldPoseValues = Pick<WorkLampPuzzleValues, "handForward" | "handDown" | "handSide">;

interface HeldWorkLampProps {
  values: HeldPoseValues &
    Pick<
      WorkLampPuzzleValues,
      "handTilt" | "handTwist" | "lampScale" | "handScale" | "metalColor" | "rubberColor" | "bulbColor" | "handGlow"
    >;
  outline?: OutlineValues | null;
}

/**
 * 손에 든 작업등. 구역(복도) 그룹 밖에 놓아야 한다 — 들고 로비로 나가면
 * 구역 최적화가 복도를 끄면서 손에 든 램프까지 같이 사라진다.
 */
export function HeldWorkLamp({ values, outline }: HeldWorkLampProps) {
  const location = useWorkLampLocation();
  if (location !== "hand") return null;
  return (
    <HeldItem itemId="workLamp" forward={values.handForward} down={values.handDown} side={values.handSide}>
      <group rotation={[values.handTilt, 0, values.handTwist]}>
        <WorkLampModel
          scale={values.lampScale * values.handScale}
          metalColor={values.metalColor}
          rubberColor={values.rubberColor}
          bulbColor={values.bulbColor}
          // 배터리라 약하다 — 이 약함이 「꽂아야 읽힌다」의 근거다
          glow={values.handGlow}
          outline={outline}
        />
      </group>
    </HeldItem>
  );
}

interface HeldTrashProps {
  values: HeldPoseValues & Pick<WorkLampPuzzleValues, "trashScale">;
}

/** 손에 든 쓰레기 — 작업등과 같은 까닭으로 구역 그룹 밖에 그린다. */
export function HeldTrash({ values }: HeldTrashProps) {
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
