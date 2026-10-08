import { button } from "leva";

import { useSavedControls } from "@/engine/leva/savedControls";
import { forceCutscene } from "@/props/vendingPush";

// 복도 자판기 두 대와 비밀문 컷신, 자판기 앞 동전.

/**
 * 「자판기 비밀문」·「음료 자판기」·「커피 자판기」.
 * 밸브가 돌면 음료 자판기가 옆으로 밀려 본부실 입구가 드러난다. 미는 거리는 문 자리·자판기 폭에서 자동으로 맞춘다.
 * 자판기 앞뒤 깊이만 두 대가 같이 쓰므로 「비밀 복도」 폴더에 있다.
 */
export function useVendingControls() {
  // 보는거리 5 — 가까우면 자판기가 화면을 넘쳐 열린 문이 안 보인다. 보는높이·겨냥은 수평으로 보게 맞춘 값.
  const secretDoor = useSavedControls("자판기 비밀문", {
    enabled: { value: true, label: "켬" },
    preview: { value: false, label: "미리보기" },
    autoFit: { value: true, label: "자동맞춤" },
    distance: { value: 4.2, min: -12, max: 12, step: 0.1, label: "이동z" },
    margin: { value: 0.3, min: 0, max: 2, step: 0.05, label: "여유" },
    duration: { value: 2.2, min: 0.4, max: 8, step: 0.1, label: "시간" },
    followPipe: { value: true, label: "관도따라" },
    transitionTime: { value: 0.9, min: 0.2, max: 3, step: 0.05, label: "넘어가는시간" },
    viewDistance: { value: 5, min: 1.5, max: 20, step: 0.1, label: "보는거리" },
    viewHeight: { value: 0.6, min: -6, max: 6, step: 0.1, label: "보는높이" },
    viewAim: { value: 0.55, min: 0.1, max: 1, step: 0.02, label: "보는겨냥" },
    viewOffset: { value: 1.2, min: -8, max: 8, step: 0.1, label: "보는치우침" },
    shake: { value: 0.04, min: 0, max: 0.2, step: 0.005, label: "흔들림" },
    dustCount: { value: 90, min: 0, max: 300, step: 10, label: "먼지수" },
    dustColor: { value: "#cfc7b6", label: "먼지색" },
    dustSize: { value: 0.22, min: 0.05, max: 0.8, step: 0.01, label: "먼지크기" },
    dustStrength: { value: 1, min: 0, max: 4, step: 0.1, label: "먼지세기" },
    playNow: { ...button(forceCutscene), label: "지금돌려보기" },
  });
  // 회전도 90 = 바깥벽 정면, -90 = 맞은편 벽에서 복도를 본다. 위치z 4 는 본부실 입구를 막는 자리.
  const drink = useSavedControls("음료 자판기", {
    flapClosedAngle: { value: -26, min: -60, max: 0, step: 1, label: "배출닫힘각도" },
    flapOpenAngle: { value: -104, min: -150, max: -60, step: 1, label: "배출열림각도" },
    flapHeight: { value: 0.72, min: 0.3, max: 1, step: 0.02, label: "배출덮개높이" },
    trayReach: { value: 0.34, min: 0, max: 1, step: 0.02, label: "배출혀" },
    sideFrontRatio: { value: 0.22, min: 0.02, max: 0.9, step: 0.02, label: "배출앞턱비" },
    x: { value: -21.3, min: -34, max: -19, step: 0.1, label: "위치x" },
    y: { value: 0, min: -2, max: 6, step: 0.1, label: "위치y" },
    z: { value: 4, min: -60, max: 26, step: 0.5, label: "위치z" },
    rotationDeg: { value: -90, min: -180, max: 180, step: 90, label: "회전도" },
    width: { value: 3.55, min: 2, max: 5, step: 0.05, label: "가로길이" },
    height: { value: 6.85, min: 4, max: 9, step: 0.05, label: "세로길이" },
    bodyColor: { value: "#909090", label: "몸통색" },
    backColor: { value: "#5f5e5e", label: "뒷면색" },
    trimColor: { value: "#3b3b3b", label: "테색" },
    signColor: { value: "#fffdf2", label: "간판색" },
    signTextColor: { value: "#141414", label: "간판글자색" },
    glassColor: { value: "#d7dcde", label: "유리색" },
    shelfColor: { value: "#3a4652", label: "선반색" },
    buttonFrameColor: { value: "#404348", label: "버튼틀색" },
    panelColor: { value: "#20272e", label: "패널색" },
    darkColor: { value: "#838383", label: "어두운색" },
    outline: { value: true, label: "외곽선" },
    outlineWidth: { value: 3, min: 0, max: 12, step: 0.5, label: "외곽선굵기" },
    outlineColor: { value: "#000000", label: "외곽선색" },
    innerOutlineColor: { value: "#000000", label: "내부외곽선색" },
    crease: { value: true, label: "주름선" },
    creaseAngle: { value: 40, min: 10, max: 80, step: 1, label: "주름선각도" },
    creaseColor: { value: "#808080", label: "주름선색" },
  });
  const coffee = useSavedControls("커피 자판기", {
    x: { value: -21.3, min: -34, max: -19, step: 0.1, label: "위치x" },
    y: { value: 0, min: -2, max: 6, step: 0.1, label: "위치y" },
    z: { value: 0.5, min: -60, max: 26, step: 0.5, label: "위치z" },
    rotationDeg: { value: -90, min: -180, max: 180, step: 90, label: "회전도" },
    width: { value: 3.4, min: 2, max: 5, step: 0.05, label: "가로길이" },
    height: { value: 6.85, min: 4, max: 9, step: 0.05, label: "세로길이" },
    bodyColor: { value: "#3e332b", label: "몸통색" },
    trimColor: { value: "#7a7f89", label: "테색" },
    signColor: { value: "#8d372e", label: "간판색" },
    signTextColor: { value: "#fff6e2", label: "간판글자색" },
    buttonFrameColor: { value: "#3e3e3e", label: "버튼틀색" },
    panelColor: { value: "#241a12", label: "패널색" },
    darkColor: { value: "#15171b", label: "어두운색" },
    cupColor: { value: "#cbc19e", label: "컵색" },
    coffeeColor: { value: "#342113", label: "커피색" },
    dispenserWallColor: { value: "#8d8d8d", label: "배출부벽색" },
    dispenserGlassColor: { value: "#c9ccce", label: "배출부유리색" },
    doorOpenAngle: { value: 1.55, min: 0.6, max: 2.1, step: 0.02, label: "문열림각" },
    outline: { value: true, label: "외곽선" },
    outlineWidth: { value: 3, min: 0, max: 12, step: 0.5, label: "외곽선굵기" },
    outlineColor: { value: "#000000", label: "외곽선색" },
    innerOutlineColor: { value: "#000000", label: "내부외곽선색" },
    crease: { value: true, label: "주름선" },
    creaseAngle: { value: 40, min: 10, max: 80, step: 1, label: "주름선각도" },
    creaseColor: { value: "#808080", label: "주름선색" },
  });
  return { secretDoor, drink, coffee };
}

/**
 * 「동전」 — 자판기 앞 바닥의 토큰 둘. 모양 열쇠(canColor…coinThickness)를 CoinLook 으로 그대로 넘긴다.
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

export type VendingControls = ReturnType<typeof useVendingControls>;
export type DrinkVendingValues = VendingControls["drink"];
export type CoffeeVendingValues = VendingControls["coffee"];
export type CoinValues = ReturnType<typeof useCoinControls>;
