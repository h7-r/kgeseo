import { useMemo } from "react";

import { outlineSchema, useSavedControls } from "@/engine/leva/savedControls";

// 수사본부실 껍데기와 빛 — 벽·바닥 질감, 폐역 조명, 구조물 선, 스탠드·천장등.

/** 「벽·바닥 질감」 — 콘크리트 블록 벽과 민바닥. 시드를 바꾸면 얼룩 배치가 통째로 달라진다. */
export function useSurfaceControls() {
  return useSavedControls("벽·바닥 질감", {
    wallColor: { value: "#525b69", label: "벽색" },
    wallBaseColor: { value: "#4e5462", label: "벽아랫단색" },
    wallSeed: { value: 7, min: 1, max: 999, step: 1, label: "벽시드" },
    wallStain: { value: 0.5, min: 0, max: 1.5, step: 0.05, label: "벽얼룩" },
    wallWear: { value: 0.7, min: 0, max: 2, step: 0.05, label: "벽낡음" },
    floorColor: { value: "#424448", label: "바닥색" },
    floorSeed: { value: 340, min: 1, max: 999, step: 1, label: "바닥시드" },
    floorStain: { value: 0.85, min: 0, max: 1.5, step: 0.05, label: "바닥얼룩" },
    ceilingColor: { value: "#5a5f69", label: "천장색" },
    ceilingSelfGlow: { value: 0.14, min: 0, max: 0.6, step: 0.01, label: "천장자체밝기" },
    ceilingSeed: { value: 12, min: 1, max: 999, step: 1, label: "천장시드" },
    ceilingStain: { value: 0.7, min: 0, max: 1.5, step: 0.05, label: "천장얼룩" },
    ceilingWear: { value: 0.7, min: 0, max: 2, step: 0.05, label: "천장낡음" },
  });
}

/** 「폐역 조명」 — 기본광·반구광·주광과 안개. */
export function useLightingControls() {
  return useSavedControls("폐역 조명", {
    ambientIntensity: { value: 1.72, min: 0, max: 2.4, step: 0.01, label: "기본광밝기" },
    ambientColor: { value: "#ffffff", label: "기본광색" },
    hemisphereIntensity: { value: 0.92, min: 0, max: 1.5, step: 0.01, label: "반구광밝기" },
    sunIntensity: { value: 3.25, min: 0, max: 4.2, step: 0.01, label: "주광밝기" },
    sunColor: { value: "#ffffff", label: "주광색" },
    amberIntensity: { value: 58, min: 0, max: 120, step: 1, label: "앰버포인트밝기" },
    fogNear: { value: 42, min: 0, max: 120, step: 1, label: "안개농도시작" },
    fogFar: { value: 274, min: 20, max: 300, step: 1, label: "안개농도끝" },
    fogColor: { value: "#cfd9eb", label: "안개색" },
  });
}

/**
 * 「방 구조물(선)」 — 몰딩·모서리 기둥·부축기둥·구조 기둥. JSX 로 바로 만든 지오라 주름선은 못 걸고 외곽선만 조절한다.
 * 열쇠가 StructureOutline 필드와 같아 값을 그대로 넘긴다.
 */
export function useStructureOutlineControls() {
  return useSavedControls("방 구조물(선)", {
    outline: { value: true, label: "외곽선" },
    outlineWidth: { value: 1.0, min: 0, max: 12, step: 0.5, label: "외곽선굵기" },
    outlineColor: { value: "#000000", label: "외곽선색" },
    moldingOutline: { value: true, label: "몰딩선" },
  });
}

// 스탠드마다 폴더 하나. 슬라이더 목록이 같아 자리만 갈아 끼운다.
function lampSchema(x: number, z: number, rotation: number) {
  return {
    x: { value: x, min: -20, max: 20, step: 0.1 },
    z: { value: z, min: -14, max: 14, step: 0.1 },
    baseY: { value: 2.05, min: 0, max: 6, step: 0.05, label: "받침높이" },
    rotation: { value: rotation, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    scale: { value: 1.0, min: 0.3, max: 2.5, step: 0.01, label: "개별배율" },
  };
}

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
  const lamp1 = useSavedControls("스탠드1", lampSchema(-12.5, -6.2, 3.02));
  const lamp2 = useSavedControls("스탠드2", lampSchema(-10.9, -1.0, 0.31));
  const lamp3 = useSavedControls("스탠드3", lampSchema(1.6, -2.0, -1.06));
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

export type SurfaceValues = ReturnType<typeof useSurfaceControls>;
export type LightingValues = ReturnType<typeof useLightingControls>;
export type DeskLampControls = ReturnType<typeof useDeskLampControls>;
export type FloorLampValues = ReturnType<typeof useFloorLampControls>;
export type CeilingLightValues = ReturnType<typeof useCeilingLightControls>;
