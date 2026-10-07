import { useMemo } from "react";

import { outlineSchema, useSavedControls } from "@/engine/leva/savedControls";
import { DESK_SPOTS, type DeskSpot } from "@/station/office/deskSpots";

/** 「책상(공통)」 — 책상 다섯 개에 함께 쓰는 크기·바닥 높이·선. */
export function useDeskCommonControls() {
  return useSavedControls("책상(공통)", {
    size: { value: 2.2, min: 0.5, max: 5, step: 0.05, label: "크기" },
    lift: { value: -0.3, min: -2, max: 2, step: 0.02, label: "높이미세" },
    ...outlineSchema({ crease: true, creaseAngle: 50 }),
  });
}

// 책상마다 폴더 하나. 기본값은 DESK_SPOTS(「★ 책상값 출력」으로 뽑아 고정한 값).
function deskSchema([x, z, rotation, width, depth, height]: DeskSpot) {
  return {
    x: { value: x, min: -20, max: 20, step: 0.1 },
    z: { value: z, min: -14, max: 14, step: 0.1 },
    rotation: { value: rotation, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    width: { value: width, min: 0.5, max: 3, step: 0.05, label: "가로길이" },
    depth: { value: depth, min: 0.5, max: 3, step: 0.05, label: "세로길이" },
    height: { value: height, min: 0.5, max: 2, step: 0.05, label: "높이" },
  };
}

/** 「책상1(빨강)」~「책상5(보라)」 */
export function useDeskControls() {
  const desk1 = useSavedControls("책상1(빨강)", deskSchema(DESK_SPOTS[0]));
  const desk2 = useSavedControls("책상2(파랑)", deskSchema(DESK_SPOTS[1]));
  const desk3 = useSavedControls("책상3(초록)", deskSchema(DESK_SPOTS[2]));
  const desk4 = useSavedControls("책상4(노랑)", deskSchema(DESK_SPOTS[3]));
  const desk5 = useSavedControls("책상5(보라)", deskSchema(DESK_SPOTS[4]));
  return useMemo(() => [desk1, desk2, desk3, desk4, desk5], [desk1, desk2, desk3, desk4, desk5]);
}

export type DeskCommonValues = ReturnType<typeof useDeskCommonControls>;
export type DeskValues = ReturnType<typeof useDeskControls>[number];
