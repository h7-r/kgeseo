import { useSavedControls } from "@/engine/leva/savedControls";

/**
 * 「소화전 속」·「소화전 밑」·「관창」.
 * 「소화전 속」 열쇠는 HydrantCabinetInterior props 와 같다(선 여섯 칸 빼고 그대로 펼쳐 넘긴다).
 */
export function useHydrantControls() {
  // 함 바깥(색·크기)은 「비밀 복도」 폴더에 있다. 경종 바깥색은 함 바깥색보다 아주 살짝 밝아야 벽에 안 묻힌다.
  const interior = useSavedControls("소화전 속", {
    innerColor: { value: "#2e2828", label: "안색" },
    metalColor: { value: "#9aa1a8", label: "금속색" },
    hoseColor: { value: "#d1cfc9", label: "호스색" },
    bellOuterColor: { value: "#934c42", label: "경종바깥색" },
    bellInnerColor: { value: "#797979", label: "경종속색" },
    bellSize: { value: 0.2, min: 0.08, max: 0.45, step: 0.005, label: "경종크기" },
    bellInnerSize: { value: 0.12, min: 0.02, max: 0.4, step: 0.005, label: "경종속크기" },
    bellOffset: { value: 0, min: -0.3, max: 0.3, step: 0.005, label: "경종높이" },
    bellInnerOffset: { value: -0.03, min: -0.15, max: 0.15, step: 0.005, label: "경종속위아래" },
    callPointOuterColor: { value: "#d1cccc", label: "발신기바깥색" },
    callPointInnerColor: { value: "#f54531", label: "발신기속색" },
    callPointSize: { value: 0.18, min: 0.06, max: 0.4, step: 0.005, label: "발신기크기" },
    callPointInnerSize: { value: 0.74, min: 0.1, max: 0.9, step: 0.02, label: "발신기속크기" },
    indicatorColor: { value: "#ffffff", label: "표시등색" },
    glow: { value: 1.1, min: 0, max: 3, step: 0.05, label: "빛세기" },
    partDepth: { value: 0.04, min: 0, max: 1, step: 0.02, label: "부품깊이" },
    outline: { value: true, label: "외곽선" },
    outlineWidth: { value: 3.5, min: 0, max: 12, step: 0.5, label: "외곽선굵기" },
    outlineColor: { value: "#000000", label: "외곽선색" },
    crease: { value: true, label: "주름선" },
    creaseAngle: { value: 40, min: 10, max: 80, step: 1, label: "주름선각도" },
    creaseColor: { value: "#808080", label: "주름선색" },
  });
  // 함 아래로 내려와 꺾여 음료 자판기 뒤까지 가는 배선관. 두 줄의 꺾임 중심을 따로 둬 값끼리 서로 안 물린다.
  const conduit = useSavedControls("소화전 밑", {
    visible: { value: true, label: "보이기" },
    endZ: { value: 5.8, min: -60, max: 26, step: 0.1, label: "끝자리" },
    bendHeight: { value: 1.1, min: 0.2, max: 3.5, step: 0.05, label: "꺾임높이" },
    forward: { value: -0.01, min: -0.3, max: 0.5, step: 0.01, label: "벽에서" },
    offset: { value: 0.0, min: -1.5, max: 1.5, step: 0.05, label: "치우침" },
    spacing: { value: 0.19, min: 0.06, max: 0.9, step: 0.01, label: "좌우여백" },
    levelGap: { value: 0.19, min: 0, max: 0.8, step: 0.01, label: "위아래간격" },
    radius: { value: 0.05, min: 0.02, max: 0.16, step: 0.002, label: "굵기" },
    bendRadius: { value: 0.3, min: 0.06, max: 0.9, step: 0.02, label: "굽힘" },
    color: { value: "#474c53", label: "색" },
  });
  // 손에 든 관창과 끌려 나온 호스. 자리·자세·크기는 서로 독립이다.
  // 기울기 26 — 정면(90)으로 들면 황동 커플링 마구리만 보여 노란 원반을 든 꼴이 된다.
  const nozzle = useSavedControls("관창", {
    forward: { value: 1.5, min: 0.4, max: 3, step: 0.05, label: "앞" },
    down: { value: 0.6, min: -0.5, max: 2, step: 0.05, label: "아래" },
    side: { value: 0.55, min: -1.5, max: 1.5, step: 0.05, label: "옆" },
    tilt: { value: 26, min: 0, max: 180, step: 2, label: "기울기" },
    twist: { value: -16, min: -90, max: 90, step: 2, label: "비틀기" },
    size: { value: 1, min: 0.3, max: 2, step: 0.05, label: "크기" },
    brightness: { value: 1, min: 0.2, max: 2, step: 0.05, label: "밝기" },
    hoseVisible: { value: true, label: "호스보이기" },
    hoseRadius: { value: 0.052, min: 0.02, max: 0.12, step: 0.002, label: "호스굵기" },
    hoseSag: { value: 0.42, min: 0, max: 1, step: 0.02, label: "호스처짐" },
    hoseExit: { value: 0.5, min: 0, max: 1.5, step: 0.05, label: "호스나옴" },
    hoseApproach: { value: 0.95, min: 0, max: 2, step: 0.05, label: "호스밑에서" },
    hoseFloorY: { value: 0.03, min: 0, max: 2, step: 0.01, label: "호스바닥" },
    hoseSegments: { value: 36, min: 8, max: 72, step: 2, label: "호스칸" },
  });
  return { interior, conduit, nozzle };
}

export type HydrantControls = ReturnType<typeof useHydrantControls>;
export type HydrantInteriorValues = HydrantControls["interior"];
export type NozzleValues = HydrantControls["nozzle"];
