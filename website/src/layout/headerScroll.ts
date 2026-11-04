import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { HEADER_HEIGHT, useStageScale } from "@/lib/layout";
import { prefersReducedMotion } from "@/lib/motionPreference";
import { measureSectionPositions, measureSectionPositionsCached } from "@/navigation/sectionGeometry";
import { getSubMenu } from "@/navigation/subMenus";

// 머리띠가 스크롤에 맞춰 하는 일: 숨기·드러내기, 구간으로 굴러가기, 지금 구간 찾기.

/** 스스로 굴리는 동안 머리띠를 이 시각(ms)까지 붙잡아 둔다. */
const headerHold = { until: 0 };

const sectionScroll: { frame: number; cancel: (() => void) | null } = { frame: 0, cancel: null };

/** 스스로 굴리는 중이거나 막 끝났으면 머리띠를 숨기지 않는다. */
function isHeaderHeld(now: number): boolean {
  return now < headerHold.until;
}

export function cancelSectionScroll(): void {
  sectionScroll.cancel?.();
}

/** 본문 단추가 같은 페이지의 구간으로 내려갈 때 쓴다. 머리띠 하위 메뉴를 눌렀을 때와 같은 자리에 멈춘다. */
export function useScrollToSection(): (id: string) => void {
  const scale = useStageScale();
  const { pathname } = useLocation();
  return useCallback(
    (id: string) => {
      const headerHeight = Math.round(HEADER_HEIGHT * scale);
      scrollToSection(
        () => measureSectionPositions(pathname, scale, headerHeight).find((section) => section.id === id)?.snapTop,
      );
    },
    [pathname, scale],
  );
}

/**
 * 구간에 맞춰 한 프레임씩 직접 굴린다. 그동안 머리띠는 숨지 않는다.
 * scrollTo smooth 는 멀리 갈 때 아래 그림·영상이 읽혀 문서가 바뀌면 중간에 끊긴다.
 * 사람이 휠·터치·키를 쓰면 바로 놓아준다.
 */
export function scrollToSection(measureTarget: () => number | undefined, retries = 2) {
  const target = measureTarget();
  if (target == null) return;
  cancelAnimationFrame(sectionScroll.frame);
  sectionScroll.cancel?.();
  const start = window.scrollY;
  const distance = target - start;
  const startTime = performance.now();
  const duration = prefersReducedMotion() ? 0 : Math.min(450, Math.max(220, 180 + Math.abs(distance) * 0.08));
  headerHold.until = Infinity;
  // 켜 두면 브라우저가 프레임마다 놓는 자리를 가까운 구간으로 다시 끌어당긴다.
  document.documentElement.style.scrollSnapType = "none";

  const handleUserInput = () => finish(false);

  function finish(completed: boolean) {
    cancelAnimationFrame(sectionScroll.frame);
    document.documentElement.style.scrollSnapType = "";
    window.removeEventListener("wheel", handleUserInput);
    window.removeEventListener("touchstart", handleUserInput);
    window.removeEventListener("keydown", handleUserInput);
    sectionScroll.cancel = null;
    // 매 프레임 재면 배치를 다시 계산해 버벅이므로 도착한 뒤 한 번만 다시 잰다.
    if (completed && retries > 0) {
      const corrected = measureTarget();
      if (corrected != null && Math.abs(window.scrollY - corrected) > 4) {
        scrollToSection(measureTarget, retries - 1);
        return;
      }
    }
    headerHold.until = performance.now() + 250;
  }

  sectionScroll.cancel = () => finish(false);
  window.addEventListener("wheel", handleUserInput, { passive: true });
  window.addEventListener("touchstart", handleUserInput, { passive: true });
  window.addEventListener("keydown", handleUserInput);

  const step = (now: number) => {
    const k = duration ? Math.min(1, (now - startTime) / duration) : 1;
    const eased = -2 * k * k * k + 3 * k * k;
    window.scrollTo({ top: Math.max(0, start + distance * eased), behavior: "instant" });
    if (k < 1) sectionScroll.frame = requestAnimationFrame(step);
    else finish(true);
  };
  sectionScroll.frame = requestAnimationFrame(step);
}

const SOLID_THRESHOLD = 8;
const HIDE_DELTA = 14;
const ALWAYS_SHOWN_ABOVE = 160;

/** 맨 위를 벗어났나(isSolid) · 내려가는 중이라 숨길까(isHidden). 매 프레임 리렌더하지 않도록 문턱을 넘을 때만 바뀐다. */
export function useHeaderScrollState() {
  const [isSolid, setIsSolid] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - lastY.current;

      setIsSolid(y > SOLID_THRESHOLD);
      // 스스로 굴리는 중에 숨으면 맞춘 화면 위에 빈 띠가 생긴다.
      if (isHeaderHeld(performance.now())) {
        setIsHidden(false);
        lastY.current = y;
        return;
      }
      if (y < ALWAYS_SHOWN_ABOVE) setIsHidden(false);
      else if (delta > HIDE_DELTA) setIsHidden(true);
      else if (delta < -HIDE_DELTA) setIsHidden(false);

      if (Math.abs(delta) > HIDE_DELTA) lastY.current = y;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
    };
  }, []);

  return { isSolid, isHidden };
}

/** 하위 메뉴에서 켤 구간 id — 맞춤 자리를 화면 3분의 1 넘게 지난 마지막 구간. */
export function useCurrentSection(path: string, scale: number, enabled: boolean, headerHeight: number) {
  const [currentId, setCurrentId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !getSubMenu(path)) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY + window.innerHeight * 0.33;
      let current: string | null = null;
      for (const section of measureSectionPositionsCached(path, scale, headerHeight)) {
        if (section.snapTop <= y) current = section.id;
      }
      setCurrentId(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
    };
  }, [path, scale, enabled, headerHeight]);

  return currentId;
}
