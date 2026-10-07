import { useSavedControls } from "@/engine/leva/savedControls";

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

export type PadlockControls = ReturnType<typeof usePadlockControls>;
