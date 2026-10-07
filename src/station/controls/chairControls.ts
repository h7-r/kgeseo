import { useMemo } from "react";

import { outlineSchema, useSavedControls } from "@/engine/leva/savedControls";

function chairSchema(x: number, z: number, rotation: number) {
  return {
    x: { value: x, min: -20, max: 20, step: 0.1 },
    z: { value: z, min: -14, max: 14, step: 0.1 },
    height: { value: 0, min: -1, max: 4, step: 0.01, label: "높이" },
    rotation: { value: rotation, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    sizeMul: { value: 1.0, min: 0.2, max: 4, step: 0.01, label: "개별크기" },
  };
}

/** 「의자(공통·색)」·「의자 끌기」·「의자1~5」. 왼쪽 자리에 셋, 오른쪽에 둘. */
export function useChairControls() {
  const common = useSavedControls("의자(공통·색)", {
    size: { value: 1.03, min: 0.2, max: 3, step: 0.01, label: "크기" },
    color: { value: "#363b46", label: "색" },
    collidable: { value: true, label: "충돌" },
    ...outlineSchema({ width: 2.0, color: "#1a1614", crease: true, creaseAngle: 65 }),
  });
  // 기본값은 전부 고치기 전 화면 그대로다 — 추측한 값을 켜 둔 채 올렸다가 여러 번 망가뜨렸다.
  const drag = useSavedControls("의자 끌기", {
    distance: { value: 1.55, min: 0.8, max: 3.2, step: 0.01, label: "거리" },
    followBody: { value: false, label: "몸기준" },
    slack: { value: 0, min: 0, max: 1.5, step: 0.01, label: "느슨함" },
  });
  const chair1 = useSavedControls("의자1(노트북2 앞)", chairSchema(-7.2, -2.5, -1.3));
  const chair2 = useSavedControls("의자2(노트북3 앞)", chairSchema(-14.3, -1.9, 1.98));
  const chair3 = useSavedControls("의자3(컴퓨터1 앞)", chairSchema(-9.5, -9.7, 0.41));
  const chair4 = useSavedControls("의자4(노트북1 앞)", chairSchema(1.7, -5.1, -0.1));
  const chair5 = useSavedControls("의자5(컴퓨터3 앞)", chairSchema(4.3, -6.0, 0.82));
  const chairs = useMemo(() => [chair1, chair2, chair3, chair4, chair5], [chair1, chair2, chair3, chair4, chair5]);
  return { common, drag, chairs };
}

export type ChairControls = ReturnType<typeof useChairControls>;
