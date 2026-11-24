/**
 * 화면 픽셀 총량 상한(11/24, Evensong 참고) — 해상도 배율(dpr) 상한만으로는 창 넓이를 못 본다.
 * 4K 모니터(배율 1)나 4K 150 %(배율 1.5)는 배율이 낮아도 830만 픽셀을 그리고, 자동 해상도는 배율 1 아래로 못 내려가
 * 느린 PC 도 그 픽셀을 다 그렸다. 그래서 자동 해상도의 위 · 아래 끝을 창 넓이에 맞춰 자른다.
 *
 * - 위 끝(PIXEL_BUDGET): 이보다 많이 그리지 않는다. 1080p · 1440p(배율 1) · 14인치 맥북(1.75)은 걸리지 않는다.
 * - 아래 끝(PIXEL_FLOOR): 느릴 때 1080p 한 장 분량까지는 내려갈 수 있다 — 큰 창이면 배율 1 아래로도 간다.
 * - 글 · 단추는 DOM 이라 배율과 상관없이 선명하다. 흐려지는 것은 3D 장면뿐이다.
 * - ?pixels=숫자 로 위 끝을 바꾸고 ?pixels=off 로 끈다(A/B 비교용). 「자동」이 아닌 해상도 설정에는 걸지 않는다.
 *
 * 측정(11/24, M5 Max, 나주 바위 아래, 프레임 제한 해제): 1080p GPU 1.9ms · 4K(배율 1) 4.8ms — 픽셀 수에 거의 비례한다.
 */
import { useEffect, useState } from "react";
import { IS_LOW_QUALITY } from "./quality";

const PIXELS_PARAM = (() => {
  try {
    return new URLSearchParams(location.search).get("pixels");
  } catch {
    return null;
  }
})();

/** 기본 위 끝. 저사양은 1080p 한 장, 기본은 약 460만(14인치 맥북 1.75 배 = 455만이 걸리지 않는 값) */
const DEFAULT_PIXEL_BUDGET = IS_LOW_QUALITY ? 2.1e6 : 4.6e6;
export const PIXEL_BUDGET =
  PIXELS_PARAM === "off" ? Infinity : Number(PIXELS_PARAM) > 0 ? Number(PIXELS_PARAM) : DEFAULT_PIXEL_BUDGET;
/** 아래 끝 — 느릴 때 내려갈 수 있는 바닥. 저사양은 1080p 에서 배율 0.65 쯤 */
export const PIXEL_FLOOR = PIXEL_BUDGET === Infinity ? Infinity : IS_LOW_QUALITY ? 0.9e6 : 2.1e6;
/** 배율을 이보다 낮추지는 않는다 — 4K 배율 1 에서도 1920×1080 은 그린다 */
const HARD_MIN_DPR = 0.5;

/** 지금 창의 CSS 넓이(픽셀²) */
export function viewportArea() {
  if (typeof window === "undefined") return 1;
  return Math.max(1, (window.innerWidth || 1) * (window.innerHeight || 1));
}

/** 이 픽셀 수를 넘지 않는 배율 — 창이 작으면 아주 크게 나오고 다른 상한이 먼저 걸린다 */
export function dprForPixels(pixels: number, area = viewportArea()) {
  if (!Number.isFinite(pixels)) return Infinity;
  return Math.max(HARD_MIN_DPR, Math.sqrt(pixels / area));
}

/** 자동 해상도의 위 끝 배율 — 다른 상한(기기 배율 · 품질별 상한)과 함께 Math.min 으로 쓴다 */
export const budgetMaxDpr = (area = viewportArea()) => dprForPixels(PIXEL_BUDGET, area);
/** 자동 해상도의 아래 끝 배율 — 품질별 하한과 함께 Math.min 으로 쓴다 */
export const budgetMinDpr = (area = viewportArea()) => dprForPixels(PIXEL_FLOOR, area);

/**
 * 창 넓이가 바뀌면 다시 그리게 한다 — 배율 상한이 창 넓이에 달려 있어서. 끌어서 크기를 바꾸는 동안 매번 바꾸지 않게
 * 0.25초 멈춘 뒤에 한 번만 바꾼다(배율이 바뀌면 프레임버퍼를 다시 잡는다).
 */
export function useViewportArea() {
  const [area, setArea] = useState(viewportArea);
  useEffect(() => {
    if (PIXEL_BUDGET === Infinity) return;
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setArea(viewportArea()), 250);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return area;
}
