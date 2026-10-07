import { useSavedControls } from "@/engine/leva/savedControls";

/**
 * 「사물 충돌」·「성능」.
 * 카메라가 물체 안에 들어가면 외곽선 껍데기가 화면을 덮어 프레임이 몇 초로 늘고 드라이버가 리셋된다 — 그래서 큰 물건은 막는다.
 */
export function useSystemControls() {
  const collision = useSavedControls("사물 충돌", {
    enabled: { value: true, label: "켜기" },
    margin: { value: 0.9, min: 0.5, max: 1.2, step: 0.05, label: "여유" },
    showBoxes: { value: false, label: "보기" },
    boxHeight: { value: 4, min: 0.5, max: 12, step: 0.5, label: "보기높이" },
  });
  // 그림자 한 번 다시 그리는 값은 실측 1.4~2.3ms. 간격 2 면 든 물건·문 그림자가 33ms 늦게 따라온다.
  const performance = useSavedControls("성능", {
    meter: { value: true, label: "계기판" },
    zoneCulling: { value: true, label: "구역최적화" },
    saveShadows: { value: true, label: "그림자아끼기" },
    shadowInterval: { value: 2, min: 1, max: 10, step: 1, label: "그림자간격" },
    shadowSafetyInterval: { value: 240, min: 20, max: 600, step: 20, label: "그림자안전망" },
    shaderWarmup: { value: true, label: "셰이더예열" },
  });
  return { collision, performance };
}

export type SystemControls = ReturnType<typeof useSystemControls>;
export type CollisionValues = SystemControls["collision"];
export type PerformanceValues = SystemControls["performance"];
