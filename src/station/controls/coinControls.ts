import { useSavedControls } from "@/engine/leva/savedControls";

/**
 * 「동전」 — 자판기 앞 바닥의 토큰 둘. 모양 열쇠(canColor…coinThickness)가 CoinLook 필드와 같아 그대로 넘긴다.
 * 바닥 자리는 자판기 정면 앞이다 — 몸통 속이면 충돌 때문에 못 줍는다.
 */
export function useCoinControls() {
  return useSavedControls("동전", {
    visible: { value: true, label: "보이기" },
    floorY: { value: 0.05, min: 0, max: 2, step: 0.01, label: "바닥y" },
    coinSize: { value: 0.18, min: 0.08, max: 0.5, step: 0.005, label: "동전크기" },
    coinThickness: { value: 0.038, min: 0.015, max: 0.12, step: 0.002, label: "동전두께2" },
    canFloorX: { value: -23.7, min: -34, max: -16, step: 0.1, label: "캔바닥x" },
    canFloorZ: { value: -1.2, min: -14, max: 6, step: 0.1, label: "캔바닥z" },
    canRotation: { value: 0.2, min: -3.15, max: 3.15, step: 0.05, label: "캔회전" },
    canColor: { value: "#b6923f", label: "캔색" },
    canPatternColor: { value: "#6f531f", label: "캔무늬색" },
    cupFloorX: { value: -23.4, min: -34, max: -16, step: 0.1, label: "컵바닥x" },
    cupFloorZ: { value: -5.4, min: -14, max: 6, step: 0.1, label: "컵바닥z" },
    cupRotation: { value: -0.5, min: -3.15, max: 3.15, step: 0.05, label: "컵회전" },
    cupColor: { value: "#9c7b52", label: "컵색" },
    cupPatternColor: { value: "#4a3a22", label: "컵무늬색" },
    drinkReturn: { value: [-20.7, 1.0, -1.6], step: 0.05, label: "음료반환" },
    coffeeReturn: { value: [-20.7, 1.0, -3.2], step: 0.05, label: "커피반환" },
    outlineWidth: { value: 3, min: 0, max: 10, step: 0.5, label: "외곽선굵기" },
    outlineColor: { value: "#1c1409", label: "외곽선색" },
  });
}

export type CoinValues = ReturnType<typeof useCoinControls>;
