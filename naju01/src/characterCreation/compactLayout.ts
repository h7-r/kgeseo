// 휴대폰 가로(짧은 높이) 배치 여부와 기기 안전 영역(노치 · 홈 막대) — 화면 안 조작들이 크기를 고를 때 읽는다(14회차).
import { createContext, useContext, useEffect, useState } from "react";

export const CompactContext = createContext(false);

/** 짧은 가로 화면(휴대폰 가로) 배치면 참 — 누르는 영역 44px 이상 · 설명 줄 줄이기 */
export function useIsCompact(): boolean {
  return useContext(CompactContext);
}

/**
 * 손가락 기기(휴대폰 · 태블릿)면 참 — 배치는 그대로라도 조작 크기는 44px 이상(코덱스 14c: 태블릿은 높이 520 이상이라
 * 휴대폰 가로 배치 밖이었다). 휴대폰 가로 배치(CompactContext)면 늘 참이다.
 */
export const TouchSizedContext = createContext(false);

export function useIsTouchSized(): boolean {
  return useContext(TouchSizedContext);
}

const COARSE_QUERY = "(pointer: coarse)";

/** 주 입력이 손가락인가 — 바뀌면(태블릿에 마우스를 붙임 등) 다시 그린다 */
export function useCoarsePointer(): boolean {
  const [isCoarse, setIsCoarse] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(COARSE_QUERY).matches,
  );
  useEffect(() => {
    const media = window.matchMedia?.(COARSE_QUERY);
    if (!media) return undefined;
    const update = () => setIsCoarse(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return isCoarse;
}

export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const ZERO_INSETS: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

function readInsets(probe: HTMLElement): SafeInsets {
  const cs = getComputedStyle(probe);
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}

/**
 * CSS env(safe-area-inset-*) 를 px 로 읽는다 — 배치를 JS 로 계산하므로 노치 쪽으로 단추가 들어가지 않게 직접 뺀다.
 * 회전하면 값이 바뀌므로 크기가 바뀔 때마다 다시 읽는다.
 */
export function useSafeInsets(): SafeInsets {
  const [insets, setInsets] = useState<SafeInsets>(ZERO_INSETS);
  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
      "padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
    document.body.appendChild(probe);
    const update = () => {
      const next = readInsets(probe);
      setInsets((previous) =>
        previous.top === next.top &&
        previous.right === next.right &&
        previous.bottom === next.bottom &&
        previous.left === next.left
          ? previous
          : next,
      );
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      probe.remove();
    };
  }, []);
  return insets;
}

/**
 * 화면 키보드가 가린 뒤 실제로 보이는 세로 범위(visualViewport). 레이아웃 뷰포트는 그대로라 ResizeObserver 로는 못 잡는다.
 * enabled 일 때만 구독한다(휴대폰 가로 + 이름 단계, 코덱스 14b). 키보드가 없으면 null.
 */
export function useKeyboardViewport(enabled: boolean): { top: number; height: number } | null {
  const [area, setArea] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const viewport = typeof window !== "undefined" ? window.visualViewport : null;
    if (!enabled || !viewport) return undefined;
    const update = () => {
      const isShrunk = viewport.height < window.innerHeight - 40;
      setArea(isShrunk ? { top: Math.round(viewport.offsetTop), height: Math.round(viewport.height) } : null);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [enabled]);
  return enabled ? area : null;
}
