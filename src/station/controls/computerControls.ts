import { useMemo } from "react";

import { outlineSchema, useSavedControls } from "@/engine/leva/savedControls";

/** 「컴퓨터(공통·색)」 + 「컴퓨터1」·「컴퓨터3」(2번 자리에는 노트북3 이 놓였다). */
export function useComputerControls() {
  const common = useSavedControls("컴퓨터(공통·색)", {
    size: { value: 0.93, min: 0.1, max: 5, step: 0.01, label: "크기" },
    color: { value: "#3e4248", label: "색" },
    ...outlineSchema({ crease: true, creaseAngle: 45 }),
  });
  const pc1 = useSavedControls("컴퓨터1", {
    x: { value: -9.5, min: -20, max: 20, step: 0.1 },
    z: { value: -6.9, min: -14, max: 14, step: 0.1 },
    height: { value: 2.9, min: 0, max: 6, step: 0.05, label: "높이" },
    rotation: { value: -2.51, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    sizeMul: { value: 1.0, min: 0.2, max: 4, step: 0.01, label: "개별크기" },
  });
  const pc3 = useSavedControls("컴퓨터3", {
    x: { value: 6.5, min: -20, max: 20, step: 0.1 },
    z: { value: -2.7, min: -14, max: 14, step: 0.1 },
    height: { value: 2.9, min: 0, max: 6, step: 0.05, label: "높이" },
    rotation: { value: -2.5, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    sizeMul: { value: 1.0, min: 0.2, max: 4, step: 0.01, label: "개별크기" },
  });
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

/** 「노트북(공통·색)」 + 「노트북1~3」(노트북3 은 예전 컴퓨터2 자리) */
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
  const laptop1 = useSavedControls("노트북1", {
    x: { value: 3.9, min: -20, max: 20, step: 0.1 },
    z: { value: -2.9, min: -14, max: 14, step: 0.1 },
    height: { value: 2.0, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: -2.7, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    sizeMul: { value: 1.0, min: 0.2, max: 4, step: 0.01, label: "개별크기" },
  });
  const laptop2 = useSavedControls("노트북2", {
    x: { value: -9.4, min: -20, max: 20, step: 0.1 },
    z: { value: -1.1, min: -14, max: 14, step: 0.1 },
    height: { value: 2.0, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: 2.05, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    sizeMul: { value: 1.0, min: 0.2, max: 4, step: 0.01, label: "개별크기" },
  });
  const laptop3 = useSavedControls("노트북3", {
    x: { value: -12.3, min: -20, max: 20, step: 0.1 },
    z: { value: -4.1, min: -14, max: 14, step: 0.1 },
    height: { value: 2.0, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: -1.29, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    sizeMul: { value: 1.0, min: 0.2, max: 4, step: 0.01, label: "개별크기" },
  });
  const laptops = useMemo(() => [laptop1, laptop2, laptop3], [laptop1, laptop2, laptop3]);
  return { common, laptops };
}

export type ComputerControls = ReturnType<typeof useComputerControls>;
export type MonitorValues = ComputerControls["monitors"][number];
export type KeyboardMouseControls = ReturnType<typeof useKeyboardMouseControls>;
export type KeyboardValues = KeyboardMouseControls["keyboard"];
export type MouseValues = KeyboardMouseControls["mouse"];
export type LaptopControls = ReturnType<typeof useLaptopControls>;
export type LaptopValues = LaptopControls["laptops"][number];
