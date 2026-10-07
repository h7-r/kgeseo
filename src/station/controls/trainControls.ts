import { outlineSchema, useSavedControls } from "@/engine/leva/savedControls";
import { MAX_Z, MIN_Z } from "@/station/layout/dimensions";

/**
 * 기차 쪽 폴더 여섯 개 — 「기차」·「기차 외부 문」·「기차 발판」·「기차 선로」·「부서진 벽 끝」·「기차 저편 공간」.
 * 「기차 외부 문」 열쇠는 TrainDoorOptions, 「기차 발판」 열쇠는 TrainStepSettings 필드와 같아 그대로 넘긴다.
 */
export function useTrainControls() {
  // 크기 = 기차 높이(유닛). 1유닛 ≈ 0.30m 라 10.3 ≈ 3.1m. 기울기 1.4 는 방과 딱 평행하지 않게 틀어 「멈춰 선 채 버려진」 느낌을 낸다.
  const train = useSavedControls("기차", {
    visible: { value: true, label: "보이기" },
    cars: { value: 4, min: 1, max: 6, step: 1, label: "대수" },
    spacing: { value: 0.9, min: 0.8, max: 1.3, step: 0.005, label: "칸겹침" },
    size: { value: 10.3, min: 4, max: 20, step: 0.1, label: "크기" },
    x: { value: 17.6, min: 10, max: 30, step: 0.1, label: "가로" },
    z: { value: 0.5, min: -14, max: 14, step: 0.1, label: "세로" },
    floorY: { value: -0.35, min: -4, max: 4, step: 0.05, label: "바닥높이" },
    rotation: { value: 1.4, min: -Math.PI, max: Math.PI, step: 0.005, label: "기울기" },
    doorOpenWidth: { value: 0.46, min: -0.8, max: 0.8, step: 0.005, label: "문열림폭" },
    roll: { value: 0.08, min: -0.4, max: 0.4, step: 0.005, label: "좌우기울기" },
    pitch: { value: -0.01, min: -0.3, max: 0.3, step: 0.005, label: "앞뒤기울기" },
    bend: { value: -0.11, min: -0.25, max: 0.25, step: 0.005, label: "휨" },
    bodyColor: { value: "#1b2029", label: "차체색" },
    doorColor: { value: "#252b36", label: "문색" },
    darkColor: { value: "#0a0c10", label: "어둠색" },
    ...outlineSchema({ width: 1.5, color: "#242a33", crease: true, creaseAngle: 71, creaseColor: "#000000" }),
  });
  // 문짝 판은 차체 구멍에 묶여 못 줄인다. 대신 문틀폭으로 밝은 문 면을 좁혀 보이게 한다.
  const door = useSavedControls("기차 외부 문", {
    doorColor: { value: "#2a2f38", label: "문색" },
    handleX: { value: 0.78, min: 0.5, max: 0.96, step: 0.01, label: "손잡이가로" },
    handleY: { value: 0.48, min: 0.3, max: 0.72, step: 0.01, label: "손잡이세로" },
    handleWidth: { value: 0.05, min: 0.03, max: 0.16, step: 0.002, label: "손잡이폭" },
    handleHeight: { value: 0.17, min: 0.08, max: 0.3, step: 0.005, label: "손잡이높이" },
    frameWidth: { value: 0, min: 0, max: 0.2, step: 0.005, label: "문틀폭" },
    frameColor: { value: "#caced5", label: "문틀색" },
    wear: { value: 2, min: 0, max: 2, step: 0.05, label: "낡음" },
    dents: { value: 10, min: 0, max: 14, step: 1, label: "찌그러짐" },
    dentDepth: { value: 0.03, min: 0, max: 0.05, step: 0.002, label: "찌그러짐깊이" },
    outlineWidth: { value: 2, min: 0, max: 8, step: 0.5, label: "외곽선굵기" },
    outlineColor: { value: "#000000", label: "외곽선색" },
  });
  // car = 발판을 붙일 문 번호(0부터), -1 이면 모든 문
  const step = useSavedControls("기차 발판", {
    visible: { value: true, label: "보이기" },
    car: { value: 2, min: -1, max: 5, step: 1, label: "칸" },
    width: { value: 0.5, min: 0.1, max: 1.0, step: 0.005, label: "가로폭" },
    depth: { value: 0.14, min: 0.03, max: 0.4, step: 0.005, label: "세로폭" },
    thickness: { value: 0.02, min: 0.005, max: 0.1, step: 0.002, label: "두께" },
    offsetX: { value: 0, min: -0.4, max: 0.4, step: 0.005, label: "좌우" },
    offsetY: { value: -0.08, min: -0.6, max: 0.2, step: 0.005, label: "높이" },
    offsetZ: { value: 0, min: -0.2, max: 0.35, step: 0.005, label: "앞뒤" },
    color: { value: "#1b2029", label: "색" },
  });
  // 높이 -0.55 면 레일 꼭대기가 방 바닥판(y=0) 아래라 사무실 안으로 레일이 안 넘어온다
  const tracks = useSavedControls("기차 선로", {
    visible: { value: true, label: "보이기" },
    y: { value: -0.55, min: -3, max: 1, step: 0.01, label: "선로높이" },
    length: { value: 127, min: 30, max: 200, step: 1, label: "길이" },
    width: { value: 6.5, min: 3, max: 20, step: 0.5, label: "도상폭" },
    matchTrainAngle: { value: true, label: "기차와같은각도" },
    rotation: { value: 1.16, min: -Math.PI, max: Math.PI, step: 0.005, label: "따로기울기" },
    gauge: { value: 5.6, min: 2, max: 9, step: 0.1, label: "궤간" },
    hasGravel: { value: true, label: "자갈" },
    ballastColor: { value: "#292520", label: "도상색" },
    sleeperColor: { value: "#1f1a16", label: "침목색" },
    railColor: { value: "#4c4f53", label: "레일색" },
    ...outlineSchema({ width: 3.5, color: "#080707", crease: false, creaseAngle: 40, creaseColor: "#000000" }),
  });
  // 앞벽(z=-14)·뒷벽(z=+12)이 끝나는 x 를 직접 잡는다. 기차 앞면 x ≈ 14.1, 뒷면 x ≈ 21.1.
  const brokenWall = useSavedControls("부서진 벽 끝", {
    visible: { value: true, label: "보이기" },
    jaggedness: { value: 2.9, min: 0, max: 10, step: 0.1, label: "들쭉" },
    layers: { value: 33, min: 6, max: 40, step: 1, label: "층" },
    frontEndX: { value: 15.8, min: -4, max: 34, step: 0.2, label: "앞벽끝x" },
    frontLimitX: { value: 21, min: -4, max: 36, step: 0.2, label: "앞벽조각끝x" },
    backEndX: { value: 12, min: -4, max: 34, step: 0.2, label: "뒷벽끝x" },
    backLimitX: { value: 21, min: -4, max: 36, step: 0.2, label: "뒷벽조각끝x" },
    centerCut: { value: 0.9, min: 0, max: 1, step: 0.05, label: "가운데파임" },
    roughness: { value: 0.04, min: 0, max: 0.6, step: 0.01, label: "거칠기" },
    rubbleColor: { value: "#3b4048", label: "잔해색" },
    ...outlineSchema({ width: 1.5, color: "#000000", crease: false, creaseAngle: 45, creaseColor: "#000000" }),
  });
  // 방 오른쪽엔 벽이 없어 3D 물체가 없는 자리는 캔버스 바탕색이 그대로 보인다 — 벽·천장을 이어 붙여 한 공간으로 만든다.
  const backdrop = useSavedControls("기차 저편 공간", {
    extend: { value: true, label: "확장" },
    hasFarWall: { value: true, label: "먼벽" },
    farWallX: { value: 29.5, min: 18, max: 45, step: 0.5, label: "먼벽x" },
    farWallColor: { value: "#3c3e43", label: "먼벽색" },
    hasCeiling: { value: true, label: "확장천장" },
    ceilingColor: { value: "#0f1115", label: "확장천장색" },
    tileSize: { value: 3, min: 1, max: 6, step: 0.1, label: "타일" },
    collapse: { value: 0.14, min: 0, max: 0.7, step: 0.01, label: "무너짐" },
    sag: { value: 0.14, min: 0, max: 0.5, step: 0.01, label: "처짐" },
    hasFrame: { value: true, label: "골조" },
    frameSpacing: { value: 1.6, min: 0.6, max: 5, step: 0.1, label: "골조간격" },
    frameThickness: { value: 0.13, min: 0.04, max: 0.5, step: 0.01, label: "골조굵기" },
    frameColor: { value: "#171b21", label: "골조색" },
    hasHangingPanels: { value: true, label: "늘어진판" },
    hasUtilities: { value: true, label: "설비" },
    ductPlacement: { value: 0.29, min: 0, max: 1, step: 0.01, label: "덕트자리" },
    ductDrop: { value: 0.85, min: 0.2, max: 4, step: 0.05, label: "덕트내림" },
    ductWidth: { value: 1.75, min: 0.4, max: 4, step: 0.05, label: "덕트가로" },
    ductHeight: { value: 1.05, min: 0.3, max: 3, step: 0.05, label: "덕트세로" },
    jointSpacing: { value: 6, min: 2, max: 20, step: 0.5, label: "이음간격" },
    pipePlacement: { value: 0.62, min: 0, max: 1, step: 0.01, label: "배관자리" },
    pipeDrop: { value: 0.75, min: 0.2, max: 4, step: 0.05, label: "배관내림" },
    pipeCount: { value: 4, min: 1, max: 8, step: 1, label: "배관수" },
    pipeRadius: { value: 0.2, min: 0.05, max: 0.6, step: 0.01, label: "배관굵기" },
    pipeSpacing: { value: 0.55, min: 0.2, max: 2, step: 0.05, label: "배관간격" },
    hangerSpacing: { value: 5, min: 2, max: 20, step: 0.5, label: "행거간격" },
    ductColor: { value: "#23262c", label: "덕트색" },
    pipeColor: { value: "#1b1f25", label: "배관색" },
    insulationColor: { value: "#4a4536", label: "단열색" },
    backgroundColor: { value: "#000000", label: "배경색" },
    hasTrackFloor: { value: true, label: "선로바닥" },
    trackFloorY: { value: -0.66, min: -4, max: 1, step: 0.02, label: "선로바닥높이" },
    trackFloorColor: { value: "#252629", label: "선로바닥색" },
    trackFloorStain: { value: 0.9, min: 0, max: 1.5, step: 0.05, label: "선로바닥얼룩" },
    hasDarkPanel: { value: true, label: "어둠판" },
    darkPanelDistance: { value: 48, min: 25, max: 70, step: 0.5, label: "어둠판거리" },
    darkColor: { value: "#0a0b0d", label: "어둠색" },
    floorColor: { value: "#101318", label: "바닥색" },
    floorY: { value: -2.4, min: -8, max: 0, step: 0.1, label: "바닥높이" },
  });
  return { train, door, step, tracks, brokenWall, backdrop };
}

/** 「승강장 끝벽」 — 기차가 뚫고 나온 무너진 벽. 구멍 좌우 폭은 기차 크기에서 계산한다. */
export function usePlatformEndWallControls() {
  return useSavedControls("승강장 끝벽", {
    visible: { value: true, label: "보이기" },
    frontZ: { value: MIN_Z - 8, min: -50, max: 0, step: 0.5, label: "앞끝z" },
    backZ: { value: MAX_Z + 8, min: 0, max: 50, step: 0.5, label: "뒷끝z" },
    holeHeight: { value: 11, min: 2, max: 14, step: 0.2, label: "구멍높이" },
    holeMargin: { value: 0.9, min: 0, max: 6, step: 0.1, label: "구멍여유" },
    strips: { value: 18, min: 6, max: 40, step: 1, label: "칸" },
    jaggedness: { value: 1.8, min: 0, max: 6, step: 0.1, label: "들쭉" },
    hasRubble: { value: true, label: "잔해" },
    rubbleColor: { value: "#3b4048", label: "잔해색" },
    roughness: { value: 0.3, min: 0, max: 0.6, step: 0.01, label: "거칠기" },
    ...outlineSchema({ width: 1.5, color: "#000000", crease: false }),
  });
}

export type TrainControls = ReturnType<typeof useTrainControls>;
export type TrainValues = TrainControls["train"];
export type BackdropValues = TrainControls["backdrop"];
export type PlatformEndWallValues = ReturnType<typeof usePlatformEndWallControls>;
