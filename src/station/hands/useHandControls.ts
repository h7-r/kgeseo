import { useSavedControls } from "@/engine/leva/savedControls";

/** 손붙이기의 Leva 폴더 6개. 폴더 이름이 저장 열쇠라 순서·이름을 그대로 둔다. */
export function useHandControls() {
  // 손목 뼈 축은 모델마다 달라 코드로 찍으면 손등에 얹히거나 팔에 박힌다 — 화면을 보며 맞춘다.
  const grip = useSavedControls("손에 쥐기", {
    offsetX: { value: 0, min: -0.6, max: 0.6, step: 0.005, label: "밀기x" },
    offsetY: { value: 0, min: -0.6, max: 0.6, step: 0.005, label: "밀기y" },
    offsetZ: { value: 0, min: -0.6, max: 0.6, step: 0.005, label: "밀기z" },
    rotateX: { value: 0, min: -180, max: 180, step: 1, label: "돌리기x" },
    rotateY: { value: 0, min: -180, max: 180, step: 1, label: "돌리기y" },
    rotateZ: { value: 0, min: -180, max: 180, step: 1, label: "돌리기z" },
    // 0 이면 손 모양이 안 바뀌고 1 이면 쥠표의 물건별 세기 그대로. 평소 손(0.6)보다 작은 값이면 오히려 펴진다.
    fistBlend: { value: 1, min: 0, max: 1, step: 0.05, label: "주먹섞기" },
    // 쥠표에 handRotation 이 있는 물건만 손목이 돈다. 컵·캔·모자는 손바닥이 옆을 봐야 쥔 것으로 보인다.
    wristMatch: { value: 1, min: 0, max: 1, step: 0.05, label: "손목맞춤" },
    // 리그의 물건 전용 뼈(prop_r)에 매단다. 끄면 손뼈 + 주먹중심 보정으로 돌아간다.
    useSocket: { value: true, label: "소켓쓰기" },
  });
  // 상자를 한 손에 매달면 얼굴을 통째로 가린다. 0 으로 내리면 예전 그대로.
  const hug = useSavedControls("품 안기", {
    enabled: { value: true, label: "켜기" },
    forward: { value: 0.34, min: -0.2, max: 1, step: 0.01, label: "앞" },
    // 0 이면 딱 붙는다(살짝 파묻히는 게 자연스럽다)
    margin: { value: 0.04, min: -0.1, max: 0.4, step: 0.01, label: "여유" },
    down: { value: 0.46, min: -0.5, max: 1.5, step: 0.01, label: "아래" },
    side: { value: 0, min: -0.5, max: 0.5, step: 0.01, label: "옆" },
    tilt: { value: 0, min: -60, max: 60, step: 1, label: "기울기" },
  });
  // 어깨 기준 방향 + 팔 길이 비율. 절대값이면 체형을 바꿀 때마다 팔이 쭉 펴지거나 몸에 박힌다.
  // 팔 길이의 55~60% 쯤이어야 팔꿈치가 자연스럽게 굽는다.
  const holdPose = useSavedControls("손 자리", {
    reachRatio: { value: 0.56, min: 0.2, max: 1, step: 0.01, label: "뻗음비" },
    forward: { value: 1, min: 0, max: 2, step: 0.05, label: "앞" },
    side: { value: 0.45, min: -1.5, max: 1.5, step: 0.05, label: "옆" },
    down: { value: 0.65, min: -1, max: 2, step: 0.05, label: "아래" },
    // [E] 때 비율을 더한다
    extraReach: { value: 0.28, min: 0, max: 0.6, step: 0.01, label: "더뻗기" },
  });
  const reach = useSavedControls("팔 뻗기", { enabled: { value: true, label: "켜기" } });
  // 1인칭에서도 같은 아바타를 머리만 접고 그려 제 손으로 쥔다. 손 자리는 카메라 기준이라 고개를 숙여도 화면에 머문다.
  // 손이 눈에서 너무 가까우면 팔뚝이 화면을 덮는다 — 값은 화면으로 잡았다.
  const firstPerson = useSavedControls("1인칭 손", {
    enabled: { value: true, label: "켜기" },
    forward: { value: 0.9, min: 0.2, max: 1.2, step: 0.01, label: "앞" },
    side: { value: 0.34, min: -0.6, max: 0.8, step: 0.01, label: "옆" },
    down: { value: 0.42, min: -0.3, max: 1, step: 0.01, label: "아래" },
    // 1 이면 시선을 그대로, 0 이면 수평만 따른다
    pitchFollow: { value: 0.6, min: 0, max: 1, step: 0.05, label: "피치따름" },
    // [E] 로 뻗을 때 팔 길이 상한(3인칭은 0.92 고정)
    reachLimit: { value: 0.72, min: 0.3, max: 0.95, step: 0.01, label: "뻗기제한" },
    // 품 물건이 1인칭에서 오는 자리 — 화면 가운데 아래
    hugForward: { value: 0.55, min: 0.1, max: 1.2, step: 0.01, label: "품앞" },
    hugDown: { value: 0.55, min: -0.3, max: 1, step: 0.01, label: "품아래" },
  });
  // 붐 손잡이(미터). 열쇠가 thirdPersonConfig 필드 이름과 같아야 한다 — 매 프레임 Object.assign 한다.
  const thirdPerson = useSavedControls("3인칭 시점", {
    enabled: { value: true, label: "켬" },
    // 복도 폭이 3.3 m 라 2.8 m 는 늘 벽에 닿았다
    distance: { value: 2.0, min: 0.6, max: 5, step: 0.05, label: "거리" },
    pivotHeight: { value: 0.22, min: -0.3, max: 1.2, step: 0.01, label: "피벗높이" },
    shoulderOffset: { value: 0.3, min: -1, max: 1, step: 0.01, label: "어깨옆" },
    // 0 이면 카메라 근평면 모서리가 벽을 뚫는다
    boomRadius: { value: 0.16, min: 0, max: 0.6, step: 0.01, label: "붐반경" },
    extendSpeed: { value: 3.2, min: 0.5, max: 20, step: 0.1, label: "펴짐속도" },
    pullWhenLookingDown: { value: 0.45, min: 0, max: 0.9, step: 0.01, label: "내려볼때당김" },
    pullWhenLookingUp: { value: 0.2, min: 0, max: 0.9, step: 0.01, label: "올려볼때당김" },
    fov: { value: 64, min: 0, max: 100, step: 1, label: "시야각" },
    fovSpeed: { value: 4, min: 0.5, max: 20, step: 0.5, label: "시야속도" },
  });
  return { grip, hug, holdPose, reach, firstPerson, thirdPerson };
}

export type HandControls = ReturnType<typeof useHandControls>;
