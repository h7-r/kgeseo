import { useMemo } from "react";

import { outlineSchema, useSavedControls } from "@/engine/leva/savedControls";

/**
 * 「스탠드(공통)」 + 「스탠드1~3」. 회전 0 = 갓이 -X 쪽을 비춘다.
 * globalLightScale(전체어둡게)는 폐역 조명 세 개에 곱하는 배율이라 이 폴더에 있어도 방 전체 밝기를 정한다.
 */
export function useDeskLampControls() {
  const common = useSavedControls("스탠드(공통)", {
    ceilingLightsOff: { value: false, label: "천장등끄기" },
    globalLightScale: { value: 0.79, min: 0, max: 1, step: 0.01, label: "전체어둡게" },
    on: { value: true, label: "켜기" },
    height: { value: 1.5, min: 0.5, max: 4, step: 0.05, label: "높이" },
    bulbColor: { value: "#fdffda", label: "전구색" },
    innerColor: { value: "#242322", label: "갓안쪽색" },
    bodyColor: { value: "#34383e", label: "몸체색" },
    intensity: { value: 30, min: 0, max: 300, step: 1, label: "빛세기" },
    spread: { value: 0.55, min: 0.1, max: 1.4, step: 0.01, label: "빛퍼짐" },
    shadeFloor: { value: 55, min: 0, max: 140, step: 5, label: "음영바닥" },
    shadow: { value: false, label: "그림자" },
    ...outlineSchema({ width: 2.0, color: "#1a1614", crease: false, creaseAngle: 45 }),
  });
  const lamp1 = useSavedControls("스탠드1", {
    x: { value: -12.5, min: -20, max: 20, step: 0.1 },
    z: { value: -6.2, min: -14, max: 14, step: 0.1 },
    baseY: { value: 2.05, min: 0, max: 6, step: 0.05, label: "받침높이" },
    rotation: { value: 3.02, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    scale: { value: 1.0, min: 0.3, max: 2.5, step: 0.01, label: "개별배율" },
  });
  const lamp2 = useSavedControls("스탠드2", {
    x: { value: -10.9, min: -20, max: 20, step: 0.1 },
    z: { value: -1.0, min: -14, max: 14, step: 0.1 },
    baseY: { value: 2.05, min: 0, max: 6, step: 0.05, label: "받침높이" },
    rotation: { value: 0.31, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    scale: { value: 1.0, min: 0.3, max: 2.5, step: 0.01, label: "개별배율" },
  });
  const lamp3 = useSavedControls("스탠드3", {
    x: { value: 1.6, min: -20, max: 20, step: 0.1 },
    z: { value: -2.0, min: -14, max: 14, step: 0.1 },
    baseY: { value: 2.05, min: 0, max: 6, step: 0.05, label: "받침높이" },
    rotation: { value: -1.06, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    scale: { value: 1.0, min: 0.3, max: 2.5, step: 0.01, label: "개별배율" },
  });
  // 매 렌더 새 배열이면 받는 쪽 memo 가 전부 풀린다
  const lamps = useMemo(() => [lamp1, lamp2, lamp3], [lamp1, lamp2, lamp3]);
  return { common, lamps };
}

/** 「장스탠드」 — 바닥에 세우는 긴 스탠드. 기본 자리는 화이트보드를 비춘다. */
export function useFloorLampControls() {
  return useSavedControls("장스탠드", {
    visible: { value: true, label: "보이기" },
    on: { value: true, label: "켜기" },
    x: { value: 4.4, min: -20, max: 20, step: 0.1 },
    z: { value: -0.5, min: -14, max: 14, step: 0.1 },
    floorY: { value: 0, min: -1, max: 4, step: 0.05, label: "바닥높이" },
    rotation: { value: 1.04, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    height: { value: 4.8, min: 2, max: 9, step: 0.05, label: "높이" },
    intensity: { value: 46, min: 0, max: 400, step: 1, label: "빛세기" },
    spread: { value: 0.8, min: 0.1, max: 1.4, step: 0.01, label: "빛퍼짐" },
    ...outlineSchema({ width: 2.0, color: "#1a1614", crease: false, creaseAngle: 25 }),
  });
}

/**
 * 「천장등(공통)」 — 수사본부가 새로 매단 공장용 갓 조명.
 * ceilingGlow(천장번짐)는 부드러운 그라데이션이라 계단 셰이딩과 화풍이 어긋나 기본 0 이다.
 */
export function useCeilingLightControls() {
  return useSavedControls("천장등(공통)", {
    on: { value: true, label: "켜기" },
    shadeColor: { value: "#3A4048", label: "갓색" },
    bulbColor: { value: "#f2ecc9", label: "전구색" },
    drop: { value: 2.2, min: 0.5, max: 7, step: 0.05, label: "내림" },
    size: { value: 0.56, min: 0.4, max: 2.5, step: 0.01, label: "크기" },
    intensity: { value: 42, min: 0, max: 400, step: 1, label: "빛세기" },
    spread: { value: 0.2, min: 0.2, max: 1.4, step: 0.01, label: "빛퍼짐" },
    glow: { value: 0.35, min: 0, max: 1.5, step: 0.05, label: "번짐" },
    decay: { value: 1.5, min: 0.5, max: 2.5, step: 0.05, label: "빛감쇠" },
    ceilingGlow: { value: 0, min: 0, max: 80, step: 1, label: "천장번짐" },
  });
}

export type DeskLampControls = ReturnType<typeof useDeskLampControls>;
export type FloorLampValues = ReturnType<typeof useFloorLampControls>;
export type CeilingLightValues = ReturnType<typeof useCeilingLightControls>;
