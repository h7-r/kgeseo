import { useSavedControls } from "@/engine/leva/savedControls";

// 복도 벽함 두 개의 속 — 소화전함·배전반, 소화전 번호 자물쇠. 함 바깥(색·크기·자리)은 「비밀 복도」 폴더에 있다.

/**
 * 「소화전 속」·「소화전 밑」·「관창」.
 * 「소화전 속」 열쇠는 HydrantCabinetInterior props 와 같다(선 여섯 칸 빼고 그대로 펼쳐 넘긴다).
 */
export function useHydrantControls() {
  // 경종 바깥색은 함 바깥색보다 아주 살짝 밝아야 벽에 안 묻힌다.
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

/**
 * 「배전반 속」 — 문을 열면 보이는 차단기·부스바·전선. 열쇠가 ElectricPanelInterior props 와 같다.
 * 전선 색은 실물 규격(검정 상·파랑 중성·초록 접지), 퍼즐 선 3색은 중성선과 안 헷갈리게 한 단계 밝게.
 * 관창 꽂는 구멍 값만 함 크기를 안 따라간다 — 꽂을 물건이 고정 크기다.
 */
export function usePanelInteriorControls() {
  return useSavedControls("배전반 속", {
    innerColor: { value: "#31353a", label: "안색" },
    plateColor: { value: "#5e646c", label: "판색" },
    breakerColor: { value: "#bbbeb1", label: "차단기색" },
    breakerFaceColor: { value: "#4b4f54", label: "차단기면색" },
    displayColor: { value: "#d1d4d8", label: "표시창색" },
    displayGlow: { value: 0.0, min: 0, max: 2.5, step: 0.05, label: "표시창빛" },
    wireOutlineScale: { value: 0.4, min: 0, max: 1, step: 0.05, label: "전선외곽선" },
    hasSocket: { value: true, label: "꽂는구멍" },
    socketDiameter: { value: 0.105, min: 0.06, max: 0.2, step: 0.005, label: "구멍지름" },
    socketDepth: { value: 0.09, min: 0.02, max: 0.2, step: 0.005, label: "구멍깊이" },
    socketGap: { value: 0.16, min: 0, max: 0.3, step: 0.005, label: "구멍간격" },
    socketRimColor: { value: "#9aa0a6", label: "구멍테색" },
    socketHoleColor: { value: "#15171a", label: "구멍속색" },
    nozzlePushIn: { value: 0, min: -0.15, max: 0.15, step: 0.005, label: "꽂힘밀기" },
    lampRimColor: { value: "#2b2e33", label: "등테색" },
    lampX: { value: 0.33, min: -0.45, max: 0.45, step: 0.005, label: "등위치가로" },
    lampY: { value: 0.02, min: -0.35, max: 0.35, step: 0.005, label: "등위치높이" },
    lampSize: { value: 0.05, min: 0.015, max: 0.09, step: 0.002, label: "등크기" },
    lampSpacing: { value: 1.3, min: 1.05, max: 3, step: 0.05, label: "등간격" },
    redLampColor: { value: "#ff4a3d", label: "빨간등색" },
    redLampSize: { value: 0.89, min: 0.2, max: 0.95, step: 0.02, label: "빨간알크기" },
    redLampGlow: { value: 0.8, min: 0, max: 3, step: 0.05, label: "빨간등빛" },
    greenLampColor: { value: "#43ff5c", label: "초록등색" },
    greenLampSize: { value: 0.89, min: 0.2, max: 0.95, step: 0.02, label: "초록알크기" },
    greenLampGlow: { value: 0.3, min: 0, max: 3, step: 0.05, label: "초록등빛" },
    groundX: { value: 0.33, min: 0.1, max: 0.45, step: 0.005, label: "접지가로" },
    groundWidth: { value: 0.08, min: 0.02, max: 0.16, step: 0.005, label: "접지폭" },
    leverColor: { value: "#b3bac7", label: "레버색" },
    copperColor: { value: "#6c5339", label: "동색" },
    metalColor: { value: "#43494e", label: "금속색" },
    blackWireColor: { value: "#272727", label: "검은선색" },
    blueWireColor: { value: "#537cba", label: "파란선색" },
    greenWireColor: { value: "#58895c", label: "초록선색" },
    labelColor: { value: "#e8c53a", label: "라벨색" },
    puzzleRed: { value: "#fc6055", label: "퍼즐빨강" },
    puzzleBlue: { value: "#537cba", label: "퍼즐파랑" },
    puzzleYellow: { value: "#deb633", label: "퍼즐노랑" },
    breakerRows: { value: 3, min: 1, max: 11, step: 1, label: "차단기줄" },
    switchThickness: { value: 0.14, min: 0.03, max: 0.24, step: 0.002, label: "스위치두께" },
    switchWidth: { value: 0.24, min: 0.12, max: 0.4, step: 0.005, label: "스위치가로" },
    switchDepth: { value: 0.13, min: 0.05, max: 0.2, step: 0.005, label: "스위치깊이" },
    switchSpacing: { value: 0.21, min: 0.1, max: 0.34, step: 0.005, label: "스위치간격" },
    knobWidth: { value: 0.22, min: 0.08, max: 0.45, step: 0.01, label: "손잡이가로" },
    knobHeight: { value: 0.44, min: 0.2, max: 0.9, step: 0.02, label: "손잡이높이" },
    knobTravel: { value: 0.14, min: 0.04, max: 0.3, step: 0.005, label: "미는거리" },
    mainBreakerHeight: { value: 0.1, min: 0.05, max: 0.2, step: 0.005, label: "주차단기높이" },
    mainBreakerWidth: { value: 0.23, min: 0.1, max: 0.4, step: 0.005, label: "주차단기가로" },
    mainBreakerDepth: { value: 0.15, min: 0.06, max: 0.24, step: 0.005, label: "주차단기깊이" },
    mainBreakerPosition: { value: 0.44, min: 0.15, max: 0.8, step: 0.01, label: "주차단기위치" },
    junctionColor: { value: "#2b2e33", label: "접속함색" },
    junctionHeight: { value: 0.09, min: 0.03, max: 0.16, step: 0.005, label: "접속함높이" },
    junctionWidth: { value: 0.14, min: 0.06, max: 0.3, step: 0.005, label: "접속함가로" },
    junctionPosition: { value: 0.1, min: -0.2, max: 0.3, step: 0.005, label: "접속함위치" },
    meterWidth: { value: 0.22, min: 0.08, max: 0.4, step: 0.005, label: "계기함가로" },
    meterHeight: { value: 1.05, min: 0.4, max: 2, step: 0.05, label: "계기함높이" },
    meterPosition: { value: 0.3, min: -0.45, max: 0.45, step: 0.005, label: "계기함위치" },
    displayWidth: { value: 0.84, min: 0.2, max: 0.95, step: 0.02, label: "표시창가로" },
    displayHeight: { value: 0.74, min: 0.2, max: 0.95, step: 0.02, label: "표시창높이" },
    wireRadius: { value: 0.02, min: 0.006, max: 0.04, step: 0.001, label: "전선굵기" },
    thickWireRadius: { value: 0.03, min: 0.012, max: 0.07, step: 0.002, label: "굵은선굵기" },
    dangerLabel: { value: true, label: "딱지" },
    outline: { value: true, label: "외곽선" },
    outlineWidth: { value: 4.0, min: 0, max: 12, step: 0.5, label: "외곽선굵기" },
    outlineColor: { value: "#000000", label: "외곽선색" },
    crease: { value: true, label: "주름선" },
    creaseAngle: { value: 40, min: 10, max: 80, step: 1, label: "주름선각도" },
    creaseColor: { value: "#808080", label: "주름선색" },
  });
}

/**
 * 「소화전 자물쇠」·「걸쇠 문쪽」·「걸쇠 테두리쪽」.
 * 걸쇠 두 폴더는 열쇠가 LatchSettings 필드와 같아 그대로 넘긴다. 자리는 자물쇠 기준이다.
 * digit1~5(맞춤N)는 처음 보이는 글자 번호(씨앗)다 — 게임 안에서 돌린 값은 combinationLock 이 따로 들고 있다.
 */
export function usePadlockControls() {
  // lockX/Y/Z 는 자물쇠만 옮긴다. 지금 값은 걸쇠 두 구멍 한가운데에 쇠막대가 정확히 꿰이도록 계산한 값이다.
  const padlock = useSavedControls("소화전 자물쇠", {
    visible: { value: true, label: "보이기" },
    showPathWhenHidden: { value: true, label: "숨길때길보기" },
    lockX: { value: 0.015, min: -0.3, max: 0.3, step: 0.001, label: "자물쇠좌우" },
    lockY: { value: -0.1171, min: -0.4, max: 0.4, step: 0.001, label: "자물쇠위아래" },
    lockZ: { value: -0.03, min: -0.3, max: 0.3, step: 0.001, label: "자물쇠깊이" },
    size: { value: 1.66, min: 0.4, max: 2.5, step: 0.02, label: "크기" },
    x: { value: -20.61, min: -34, max: -19, step: 0.01 },
    y: { value: 3.07, min: 0, max: 7, step: 0.01 },
    z: { value: 15.86, min: -60, max: 26, step: 0.02 },
    rotationDeg: { value: -100, min: -180, max: 180, step: 5, label: "회전도" },
    width: { value: 0.155, min: 0.05, max: 0.4, step: 0.005, label: "폭" },
    height: { value: 0.082, min: 0.02, max: 0.2, step: 0.002, label: "높이" },
    depth: { value: 0.077, min: 0.02, max: 0.2, step: 0.002, label: "깊이" },
    sideRoundness: { value: 0.7, min: 0, max: 1, step: 0.02, label: "옆둥글기" },
    shackleRadius: { value: 0.04, min: 0.01, max: 0.12, step: 0.001, label: "고리반지름" },
    shackleThickness: { value: 0.009, min: 0.003, max: 0.04, step: 0.0005, label: "고리굵기" },
    shackleHeight: { value: 0.088, min: 0.015, max: 0.25, step: 0.002, label: "고리높이" },
    rowCount: { value: 5, min: 1, max: 8, step: 1, label: "칸수" },
    dialSpan: { value: 0.37, min: 0.2, max: 0.8, step: 0.01, label: "다이얼띠" },
    glyphPool: { value: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", label: "뽑을글자" },
    glyphsPerRow: { value: 7, min: 3, max: 12, step: 1, label: "칸글자수" },
    glyphSeed: { value: 7, min: 1, max: 99, step: 1, label: "글자씨" },
    digit1: { value: 3, min: 0, max: 11, step: 1, label: "맞춤1" },
    digit2: { value: 4, min: 0, max: 11, step: 1, label: "맞춤2" },
    digit3: { value: 0, min: 0, max: 11, step: 1, label: "맞춤3" },
    digit4: { value: 3, min: 0, max: 11, step: 1, label: "맞춤4" },
    digit5: { value: 4, min: 0, max: 11, step: 1, label: "맞춤5" },
    answer: { value: "VALVE", label: "정답" },
    handleDistance: { value: 0.8, min: 0.3, max: 2.5, step: 0.05, label: "조작거리" },
    metalColor: { value: "#888f96", label: "쇠색" },
    dialColor: { value: "#b7b7b7", label: "다이얼색" },
    glyphColor: { value: "#000000", label: "글자색" },
    dividers: { value: true, label: "칸선" },
    dividerColor: { value: "#6e7276", label: "칸선색" },
    dividerWidth: { value: 0.055, min: 0, max: 0.3, step: 0.005, label: "칸선굵기" },
    dividerHeight: { value: 1.03, min: 0.9, max: 1.25, step: 0.005, label: "칸선높이" },
    marker: { value: true, label: "표식" },
    markerColor: { value: "#2f3338", label: "표식색" },
    markerSize: { value: 1, min: 0.3, max: 2, step: 0.05, label: "표식크기" },
  });
  // ㄱ자로 꺾인 판. 날개를 문 앞면에 대고 꺾인 쪽 구멍으로 쇠막대가 지난다.
  const doorLatch = useSavedControls("걸쇠 문쪽", {
    visible: { value: true, label: "보이기" },
    x: { value: 0.0, min: -0.3, max: 0.3, step: 0.001, label: "좌우" },
    alignToShackle: { value: false, label: "쇠막대맞춤" },
    y: { value: 0.0, min: -0.1, max: 0.4, step: 0.001, label: "위아래" },
    z: { value: -0.03, min: -0.3, max: 0.3, step: 0.001, label: "깊이" },
    rotationX: { value: 0, min: -180, max: 180, step: 1, label: "회전x" },
    rotationY: { value: 10, min: -180, max: 180, step: 1, label: "회전y" },
    rotationZ: { value: -180, min: -180, max: 180, step: 1, label: "회전z" },
    hole: { value: 1.5, min: 1.25, max: 4, step: 0.05, label: "구멍" },
    plateWidth: { value: 2.6, min: 1.2, max: 6, step: 0.05, label: "판폭" },
    thickness: { value: 0.49, min: 0.15, max: 1.5, step: 0.02, label: "두께" },
    length: { value: 5.2, min: 1.5, max: 14, step: 0.1, label: "길이" },
    wing: { value: 3.0, min: 0, max: 8, step: 0.1, label: "날개" },
    screwCount: { value: 2, min: 0, max: 4, step: 1, label: "나사수" },
    screwOnWing: { value: true, label: "나사날개" },
    screwColor: { value: "#5d6166", label: "나사색" },
    screwSize: { value: 0.49, min: 0.15, max: 1.2, step: 0.02, label: "나사크기" },
    color: { value: "#838689", label: "색" },
  });
  // 꺾임 없는 평판(날개 0). 옆으로 세워 함 테두리에 댄다.
  const frameLatch = useSavedControls("걸쇠 테두리쪽", {
    visible: { value: true, label: "보이기" },
    x: { value: 0.03, min: -0.3, max: 0.3, step: 0.001, label: "좌우" },
    alignToShackle: { value: false, label: "쇠막대맞춤" },
    y: { value: 0.0, min: -0.1, max: 0.4, step: 0.001, label: "위아래" },
    z: { value: -0.03, min: -0.3, max: 0.3, step: 0.001, label: "깊이" },
    rotationX: { value: 0, min: -180, max: 180, step: 1, label: "회전x" },
    rotationY: { value: 0, min: -180, max: 180, step: 1, label: "회전y" },
    rotationZ: { value: 0, min: -180, max: 180, step: 1, label: "회전z" },
    hole: { value: 1.5, min: 1.25, max: 4, step: 0.05, label: "구멍" },
    plateWidth: { value: 2.6, min: 1.2, max: 6, step: 0.05, label: "판폭" },
    thickness: { value: 0.27, min: 0.15, max: 1.5, step: 0.02, label: "두께" },
    length: { value: 14.0, min: 1.5, max: 14, step: 0.1, label: "길이" },
    wing: { value: 0.0, min: 0, max: 8, step: 0.1, label: "날개" },
    screwCount: { value: 2, min: 0, max: 4, step: 1, label: "나사수" },
    screwOnWing: { value: false, label: "나사날개" },
    screwColor: { value: "#5d6166", label: "나사색" },
    screwSize: { value: 0.45, min: 0.15, max: 1.2, step: 0.02, label: "나사크기" },
    color: { value: "#838689", label: "색" },
  });
  return { padlock, doorLatch, frameLatch };
}

export type HydrantControls = ReturnType<typeof useHydrantControls>;
export type HydrantInteriorValues = HydrantControls["interior"];
export type NozzleValues = HydrantControls["nozzle"];
export type PanelInteriorValues = ReturnType<typeof usePanelInteriorControls>;
export type PadlockControls = ReturnType<typeof usePadlockControls>;
