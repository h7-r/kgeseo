import { useSavedControls } from "@/engine/leva/savedControls";
import { CROUCH_EYE, EYE } from "@/engine/movement/constants";

/** 「시점(눈높이)」 — usePlayer 보다 먼저 불러야 값을 넘길 수 있다. */
export function useViewControls() {
  return useSavedControls("시점(눈높이)", {
    eyeHeight: { value: EYE, min: 2, max: 10, step: 0.05, label: "눈높이" },
    crouchEyeHeight: { value: CROUCH_EYE, min: 0.8, max: 6, step: 0.05, label: "앉은높이" },
  });
}

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

export type ViewValues = ReturnType<typeof useViewControls>;
export type SurfaceValues = ReturnType<typeof useSurfaceControls>;
export type LightingValues = ReturnType<typeof useLightingControls>;
