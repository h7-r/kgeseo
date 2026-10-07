import { useMemo } from "react";

import { outlineSchema, useSavedControls } from "@/engine/leva/savedControls";

// 높이 2.0 = 책상 윗면(노트북이 올라간 높이)
function mugSchema(x: number, z: number, rotation: number, sizeMul = 1.0) {
  return {
    x: { value: x, min: -20, max: 20, step: 0.1 },
    z: { value: z, min: -14, max: 14, step: 0.1 },
    height: { value: 2.0, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: rotation, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    sizeMul: { value: sizeMul, min: 0.2, max: 4, step: 0.01, label: "개별크기" },
  };
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
  const mug1 = useSavedControls("머그컵1(왼쪽 책상)", mugSchema(-12.2, -1.5, -1.98, 1.25));
  const mug2 = useSavedControls("머그컵2(왼쪽 책상)", mugSchema(-9.8, -6.8, -2.61, 1.25));
  const mug3 = useSavedControls("머그컵3(오른쪽 책상)", mugSchema(4.6, -3.4, 0.9));
  const mugs = useMemo(() => [mug1, mug2, mug3], [mug1, mug2, mug3]);
  return { common, mugs };
}

export type MugControls = ReturnType<typeof useMugControls>;
export type MugValues = MugControls["mugs"][number];
