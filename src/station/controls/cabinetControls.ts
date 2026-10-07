import { useMemo } from "react";

import { outlineSchema, useSavedControls } from "@/engine/leva/savedControls";

/** 「캐비닛(공통)」 + 「캐비닛1~3」. 색·크기는 공통, 시드만 달라 얼룩·찌그러짐이 서로 다르다. */
export function useCabinetControls() {
  const common = useSavedControls("캐비닛(공통)", {
    visible: { value: true, label: "보이기" },
    color: { value: "#4d5460", label: "색" },
    height: { value: 4.3, min: 2, max: 8, step: 0.05, label: "높이" },
    dentCount: { value: 4, min: 0, max: 12, step: 1, label: "찌그러짐" },
    dentDepth: { value: 0.016, min: 0, max: 0.026, step: 0.001, label: "깊이" },
    stainCount: { value: 10, min: 0, max: 24, step: 1, label: "얼룩" },
    stainStrength: { value: 0.0, min: 0, max: 2, step: 0.05, label: "얼룩세기" },
    showLines: { value: true, label: "선보이기" },
    lineColor: { value: "#000000", label: "선색" },
    drawersOpen: { value: true, label: "서랍열기" },
    slightOpen: { value: 0.12, min: 0, max: 0.25, step: 0.005, label: "살짝열림" },
    wideOpen: { value: 0.14, min: 0, max: 0.25, step: 0.005, label: "많이열림" },
    showPapers: { value: true, label: "서류보이기" },
    drawerWear: { value: 1.0, min: 0, max: 2, step: 0.05, label: "서랍낡음" },
    ...outlineSchema({ crease: true, creaseAngle: 40 }),
  });
  const cabinet1 = useSavedControls("캐비닛1", {
    x: { value: -11.6, min: -20, max: 20, step: 0.1 },
    z: { value: 10.2, min: -14, max: 14, step: 0.1 },
    rotation: { value: 3.14, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    seed: { value: 6511, min: 1, max: 9999, step: 1, label: "시드" },
  });
  const cabinet2 = useSavedControls("캐비닛2", {
    x: { value: -10.0, min: -20, max: 20, step: 0.1 },
    z: { value: 10.2, min: -14, max: 14, step: 0.1 },
    rotation: { value: 3.14, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    seed: { value: 6145, min: 1, max: 9999, step: 1, label: "시드" },
  });
  const cabinet3 = useSavedControls("캐비닛3", {
    x: { value: -8.4, min: -20, max: 20, step: 0.1 },
    z: { value: 10.2, min: -14, max: 14, step: 0.1 },
    rotation: { value: 3.14, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    seed: { value: 4022, min: 1, max: 9999, step: 1, label: "시드" },
  });
  const cabinets = useMemo(() => [cabinet1, cabinet2, cabinet3], [cabinet1, cabinet2, cabinet3]);
  return { common, cabinets };
}

export type CabinetControls = ReturnType<typeof useCabinetControls>;
export type CabinetCommonValues = CabinetControls["common"];
export type CabinetValues = CabinetControls["cabinets"][number];
