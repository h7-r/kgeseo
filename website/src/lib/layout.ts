import { useEffect, useState } from "react";

/** 디자인 폭. 모든 페이지를 이 폭으로 짜고 창 폭에 맞춰 통째로 축소한다. */
export const DESIGN_WIDTH = 1920;

/** 머리띠 높이(설계 px). 메인과 하위 페이지가 같은 높이를 써서 페이지를 옮겨도 덜컥 바뀌지 않는다. */
export const HEADER_HEIGHT = 149;

/**
 * 하위 페이지 무대의 첫 높이를 어림할 때 푸터 몫으로 더하는 값(설계 px).
 * 실제 푸터(217)보다 작지만, Stage 가 그리기 전에 푸터를 재어 높이를 고치므로 화면에는 드러나지 않는다.
 */
export const FOOTER_ALLOWANCE = 186;

/** 뒤의 3D 공간이 퍼져 나가는 소실점(화면 비율). 본문을 피해 오른쪽 아래에 둔다. */
export const BACKDROP_ORIGIN = { x: 0.88, y: 0.62 } as const;

/** 축소가 걸린 안쪽 칸의 클래스. 스크롤 계산이 closest() 로 이 칸을 찾는다. */
export const STAGE_INNER_CLASS = "stage";

/**
 * 자식 중 높이를 재지 않고 안을 들여다볼 상자에 붙이는 속성.
 * 멈춤(pin) 구간 아래 구간들을 통째로 내리는 높이 0 짜리 상자다.
 */
export const SHIFT_BOX_ATTR = { "data-shift": "" } as const;

/** 페이지 맨 아래 푸터에 붙이는 속성. 푸터는 높이만 더한다. */
export const FOOTER_ATTR = { "data-footer": "" } as const;

/** 창 폭 ÷ 1920. */
export function useStageScale(): number {
  const [scale, setScale] = useState(() => (typeof window === "undefined" ? 1 : window.innerWidth / DESIGN_WIDTH));

  useEffect(() => {
    const update = () => setScale(window.innerWidth / DESIGN_WIDTH);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return scale;
}
