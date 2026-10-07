import type { OutlineValues } from "@/engine/toon";
import { HeldItem } from "@/lobby/AimTracker";

import type { HeldPoseValues, WorkLampPuzzleValues } from "./controls";
import WorkLampModel from "./WorkLampModel";
import { useWorkLampLocation } from "./workLampState";

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
export default function HeldWorkLamp({ values, outline }: HeldWorkLampProps) {
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
