import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** 운영체제의 "동작 줄이기" 설정. 켜져 있으면 연출을 건너뛰고 결과만 보여 준다. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.(REDUCED_MOTION_QUERY).matches);
}

function subscribe(onChange: () => void) {
  const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/** 설정이 바뀌면 다시 그린다. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
