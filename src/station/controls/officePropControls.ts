import { useMemo } from "react";

import { outlineSchema, useSavedControls } from "@/engine/leva/savedControls";

// 수사본부실 소품 — 컴퓨터·키보드·마우스·노트북·머그컵·증거물. 서류는 paperControls.

// 모니터 한 대의 폴더.
function monitorSchema(x: number, z: number, rotation: number) {
  return {
    x: { value: x, min: -20, max: 20, step: 0.1 },
    z: { value: z, min: -14, max: 14, step: 0.1 },
    height: { value: 2.9, min: 0, max: 6, step: 0.05, label: "높이" },
    rotation: { value: rotation, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    sizeMul: { value: 1.0, min: 0.2, max: 4, step: 0.01, label: "개별크기" },
  };
}

// 책상 위 소품(노트북·머그컵) 한 개의 폴더. 높이 2.0 = 책상 윗면.
function deskItemSchema(x: number, z: number, rotation: number, sizeMul = 1.0) {
  return {
    x: { value: x, min: -20, max: 20, step: 0.1 },
    z: { value: z, min: -14, max: 14, step: 0.1 },
    height: { value: 2.0, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: rotation, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    sizeMul: { value: sizeMul, min: 0.2, max: 4, step: 0.01, label: "개별크기" },
  };
}

/** 「컴퓨터(공통·색)」 + 「컴퓨터1」·「컴퓨터3」. 2번 자리에는 노트북3 이 있다. */
export function useComputerControls() {
  const common = useSavedControls("컴퓨터(공통·색)", {
    size: { value: 0.93, min: 0.1, max: 5, step: 0.01, label: "크기" },
    color: { value: "#3e4248", label: "색" },
    ...outlineSchema({ crease: true, creaseAngle: 45 }),
  });
  const pc1 = useSavedControls("컴퓨터1", monitorSchema(-9.5, -6.9, -2.51));
  const pc3 = useSavedControls("컴퓨터3", monitorSchema(6.5, -2.7, -2.5));
  const monitors = useMemo(() => [pc1, pc3], [pc1, pc3]);
  return { common, monitors };
}

/**
 * 「키보드(공통)」·「마우스(공통)」. 자리는 그 책상 모니터 기준 상대값이라 두 세트에 똑같이 쓴다.
 * side·forward·height·rotation 이 MonitorOffset 필드와 같아 값을 그대로 넘긴다.
 * 키보드는 키가 90개쯤 붙어 있어 주름선 각도를 낮추면 선이 폭발한다(45° 면 8,300선).
 */
export function useKeyboardMouseControls() {
  const keyboard = useSavedControls("키보드(공통)", {
    visible: { value: true, label: "보이기" },
    size: { value: 1.55, min: 0.3, max: 3, step: 0.01, label: "크기" },
    thickness: { value: 0.5, min: 0.3, max: 2.5, step: 0.01, label: "두께" },
    depth: { value: 0.83, min: 0.6, max: 1.6, step: 0.01, label: "깊이" },
    side: { value: -0.31, min: -3, max: 3, step: 0.01, label: "좌우" },
    forward: { value: 0.82, min: -3, max: 3, step: 0.01, label: "앞뒤" },
    height: { value: -0.85, min: -2, max: 2, step: 0.01, label: "높이" },
    rotation: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    color: { value: "#2c2f34", label: "색" },
    ...outlineSchema({ width: 3.0, color: "#120f0d", crease: true, creaseAngle: 25, creaseColor: "#19191f" }),
  });
  const mouse = useSavedControls("마우스(공통)", {
    visible: { value: true, label: "보이기" },
    size: { value: 0.37, min: 0.1, max: 1.5, step: 0.005, label: "크기" },
    side: { value: 0.82, min: -3, max: 3, step: 0.01, label: "좌우" },
    forward: { value: 0.93, min: -3, max: 3, step: 0.01, label: "앞뒤" },
    height: { value: -0.88, min: -2, max: 2, step: 0.01, label: "높이" },
    rotation: { value: -2.98, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    color: { value: "#2c2f34", label: "색" },
    ...outlineSchema({ width: 3.0, color: "#1a1614", crease: true, creaseAngle: 21, creaseColor: "#000000" }),
  });
  return { keyboard, mouse };
}

/** 「노트북(공통·색)」 + 「노트북1~3」(노트북3 은 컴퓨터2 자리) */
export function useLaptopControls() {
  const common = useSavedControls("노트북(공통·색)", {
    size: { value: 0.65, min: 0.1, max: 3, step: 0.01, label: "크기" },
    screenColor: { value: "#b6bac6", label: "화면색" },
    bezelColor: { value: "#737d8e", label: "테두리색" },
    keysColor: { value: "#2d2f36", label: "키보드색" },
    trackpadColor: { value: "#5a606a", label: "트랙패드색" },
    bodyColor: { value: "#787e8a", label: "본체색" },
    screenOn: { value: true, label: "화면켜기" },
    screenGlowColor: { value: "#e4f1ff", label: "화면빛색" },
    ...outlineSchema({ crease: true, creaseAngle: 45 }),
  });
  const laptop1 = useSavedControls("노트북1", deskItemSchema(3.9, -2.9, -2.7));
  const laptop2 = useSavedControls("노트북2", deskItemSchema(-9.4, -1.1, 2.05));
  const laptop3 = useSavedControls("노트북3", deskItemSchema(-12.3, -4.1, -1.29));
  const laptops = useMemo(() => [laptop1, laptop2, laptop3], [laptop1, laptop2, laptop3]);
  return { common, laptops };
}

/**
 * 「머그컵(공통·색)」 + 머그컵 셋.
 * brightness 는 쓸 때 한 번 눌러 주는 배수 — 순백 도자기가 Bloom 에 날아가는데, 색을 직접 낮추면 저장값이 코드를 이긴다.
 */
export function useMugControls() {
  const common = useSavedControls("머그컵(공통·색)", {
    size: { value: 1.0, min: 0.2, max: 4, step: 0.01, label: "크기" },
    cupColor: { value: "#fff4e9", label: "컵색" },
    coffeeColor: { value: "#382114", label: "커피색" },
    brightness: { value: 0.88, min: 0.4, max: 1, step: 0.01, label: "밝기" },
    ...outlineSchema({ crease: false, creaseAngle: 55 }),
  });
  const mug1 = useSavedControls("머그컵1(왼쪽 책상)", deskItemSchema(-12.2, -1.5, -1.98, 1.25));
  const mug2 = useSavedControls("머그컵2(왼쪽 책상)", deskItemSchema(-9.8, -6.8, -2.61, 1.25));
  const mug3 = useSavedControls("머그컵3(오른쪽 책상)", deskItemSchema(4.6, -3.4, 0.9));
  const mugs = useMemo(() => [mug1, mug2, mug3], [mug1, mug2, mug3]);
  return { common, mugs };
}

/** 「증거물(공통)」 + 증거물 6개. 순서가 EVIDENCE_ITEMS 와 같다. */
export function useEvidenceControls() {
  const common = useSavedControls("증거물(공통)", {
    visible: { value: true, label: "보이기" },
    size: { value: 1.0, min: 0.3, max: 3, step: 0.01, label: "크기" },
    ...outlineSchema({ crease: true, creaseAngle: 40 }),
  });
  const envelope = useSavedControls("증거물1(봉투)", {
    x: { value: -13.5, min: -20, max: 20, step: 0.1 },
    z: { value: -6.7, min: -14, max: 14, step: 0.1 },
    height: { value: 2.06, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: 0.34, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    thickness: { value: 0.01, min: 0.008, max: 0.12, step: 0.001, label: "두께" },
    size: { value: 1.0, min: 0.3, max: 2, step: 0.01, label: "크기" },
  });
  const tag2 = useSavedControls("증거물2(번호표)", {
    x: { value: -11.8, min: -20, max: 20, step: 0.1 },
    z: { value: 9.0, min: -14, max: 14, step: 0.1 },
    height: { value: 0.55, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: -0.78, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
  });
  const box = useSavedControls("증거물3(상자)", {
    x: { value: -1.3, min: -20, max: 20, step: 0.1 },
    z: { value: -3.5, min: -14, max: 14, step: 0.1 },
    height: { value: 0.0, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: -1.9, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
  });
  // 번호표 1·3 — 1번은 봉투 옆 책상 위, 3번은 캐비닛 위
  const tag1 = useSavedControls("증거물4(번호표1)", {
    x: { value: 0.6, min: -20, max: 20, step: 0.1 },
    z: { value: -1.6, min: -14, max: 14, step: 0.1 },
    height: { value: 2.06, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: 0.83, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
  });
  const tag3 = useSavedControls("증거물5(번호표3)", {
    x: { value: -9.5, min: -20, max: 20, step: 0.1 },
    z: { value: 10.1, min: -14, max: 14, step: 0.1 },
    height: { value: 4.3, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: 0.61, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
  });
  // 증거물 상자와 별개 물건이다. 기본 자리는 상자 뚜껑 위.
  const collectionBox = useSavedControls("증거물6(수거품 상자)", {
    x: { value: -1.4, min: -20, max: 20, step: 0.01 },
    z: { value: -3.65, min: -14, max: 14, step: 0.01 },
    height: { value: 0.95, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: -1.5, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    width: { value: 1.19, min: 0.2, max: 2.5, step: 0.01, label: "가로" },
    depth: { value: 0.78, min: 0.2, max: 2.5, step: 0.01, label: "세로" },
    boxHeight: { value: 0.83, min: 0.15, max: 2.0, step: 0.01, label: "상자높이" },
  });
  const items = useMemo(
    () => [envelope, tag2, box, tag1, tag3, collectionBox] as const,
    [envelope, tag2, box, tag1, tag3, collectionBox],
  );
  return { common, items };
}

export type ComputerControls = ReturnType<typeof useComputerControls>;
export type MonitorValues = ComputerControls["monitors"][number];
export type KeyboardMouseControls = ReturnType<typeof useKeyboardMouseControls>;
export type KeyboardValues = KeyboardMouseControls["keyboard"];
export type MouseValues = KeyboardMouseControls["mouse"];
export type LaptopControls = ReturnType<typeof useLaptopControls>;
export type LaptopValues = LaptopControls["laptops"][number];
export type MugControls = ReturnType<typeof useMugControls>;
export type MugValues = MugControls["mugs"][number];
export type EvidenceControls = ReturnType<typeof useEvidenceControls>;
/** 증거물 한 개의 자리. 봉투·수거품 상자만 칸이 더 있다. */
export type EvidencePose = EvidenceControls["items"][number];
