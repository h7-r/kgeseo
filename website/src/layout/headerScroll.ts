import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { HEADER_HEIGHT, useStageScale } from "@/lib/layout";
import { prefersReducedMotion } from "@/lib/motionPreference";
import { measureSectionPositions, measureSectionPositionsCached } from "@/navigation/sectionGeometry";
import { getSubMenu } from "@/navigation/subMenus";

// 머리띠가 스크롤에 맞춰 하는 일: 숨기·드러내기, 구간으로 굴러가기, 지금 구간 찾기, 멈춘 뒤 구간 맞추기.

/** 스스로 굴리는 동안 머리띠를 이 시각(ms)까지 붙잡아 둔다. */
const headerHold = { until: 0 };

const sectionScroll: { frame: number; cancel: (() => void) | null } = { frame: 0, cancel: null };

/** 스스로 도착한 자리를 멈춤 맞춤이 다시 옮기지 않게 이 시각(ms)까지 쉰다. */
const settleRest = { until: 0 };
const SETTLE_REST_MS = 400;

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
export function scrollToSection(
  measureTarget: () => number | undefined,
  retries = 2,
  durationFor: (distance: number) => number = (distance) => Math.min(450, Math.max(220, 180 + distance * 0.08)),
) {
  const target = measureTarget();
  if (target == null) return;
  cancelAnimationFrame(sectionScroll.frame);
  sectionScroll.cancel?.();
  const start = window.scrollY;
  const distance = target - start;
  const startTime = performance.now();
  const duration = prefersReducedMotion() ? 0 : durationFor(Math.abs(distance));
  headerHold.until = Infinity;

  const handleUserInput = () => finish(false);

  function finish(completed: boolean) {
    cancelAnimationFrame(sectionScroll.frame);
    window.removeEventListener("wheel", handleUserInput);
    window.removeEventListener("touchstart", handleUserInput);
    window.removeEventListener("keydown", handleUserInput);
    window.removeEventListener("pointerdown", handleUserInput);
    sectionScroll.cancel = null;
    // 매 프레임 재면 배치를 다시 계산해 버벅이므로 도착한 뒤 한 번만 다시 잰다.
    if (completed && retries > 0) {
      const corrected = measureTarget();
      if (corrected != null && Math.abs(window.scrollY - corrected) > 4) {
        scrollToSection(measureTarget, retries - 1, durationFor);
        return;
      }
    }
    headerHold.until = performance.now() + 250;
    if (completed) settleRest.until = performance.now() + SETTLE_REST_MS;
  }

  sectionScroll.cancel = () => finish(false);
  window.addEventListener("wheel", handleUserInput, { passive: true });
  window.addEventListener("touchstart", handleUserInput, { passive: true });
  window.addEventListener("keydown", handleUserInput);
  window.addEventListener("pointerdown", handleUserInput);

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

/** 스크롤이 멈춘 뒤 이만큼 조용하면 멈춘 것으로 본다(ms). scrollend 가 없는 브라우저를 위한 값이다. */
const SETTLE_IDLE_MS = 160;
/** 굴리던 방향의 다음 구간이 화면 높이의 이 비율 안이면 그 구간까지 마저 간다. 크면 조금만 굴려도 넘어간다. */
const SETTLE_AHEAD = 0.3;
/** 굴리다 지나친 구간은 화면 높이의 이 비율 안일 때만 되돌아간다. */
const SETTLE_BEHIND = 0.15;

interface ScrollRange {
  start: number;
  end: number;
}

/** 구간이 화면에 맞게 보이는 스크롤 범위들. 범위 안은 핀 구간이거나 화면보다 긴 구간이라 자유롭게 둔다. */
function measureRestRanges(path: string, scale: number, headerHeight: number): ScrollRange[] {
  const viewportHeight = window.innerHeight;
  const ranges: ScrollRange[] = [];
  const pinTrack = document.querySelector("[data-pin-track]");
  if (pinTrack) {
    ranges.push({ start: 0, end: pinTrack.getBoundingClientRect().bottom + window.scrollY - viewportHeight });
  }
  for (const section of measureSectionPositionsCached(path, scale, headerHeight)) {
    if (section.isPageTop) continue;
    const overflow = Math.max(0, section.height - (viewportHeight - headerHeight));
    ranges.push({ start: section.snapTop, end: section.snapTop + overflow + (section.pinEnd - section.top) });
  }
  const bottom = document.documentElement.scrollHeight - viewportHeight;
  ranges.push({ start: bottom, end: bottom });
  return ranges.sort((a, b) => a.start - b.start);
}

function findRestTarget(
  y: number,
  startY: number,
  direction: number,
  ranges: readonly ScrollRange[],
): number | undefined {
  if (ranges.some(({ start, end }) => y >= start - 2 && y <= end + 2)) return undefined;
  const below = ranges.find(({ start }) => start > y)?.start;
  const above = ranges.findLast(({ end }) => end < y)?.end;
  const ahead = direction > 0 ? below : above;
  const behind = direction > 0 ? above : below;
  const viewportHeight = window.innerHeight;
  if (ahead != null && Math.abs(ahead - y) <= viewportHeight * SETTLE_AHEAD) return ahead;
  // 이번에 지나쳐 온 구간으로만 되돌아간다. 맞춰 서 있던 구간을 떠난 것까지 되돌리면 휠이 제자리로 끌려온다.
  const hasPassed = behind != null && (behind - startY) * direction > 2;
  if (hasPassed && Math.abs(behind - y) <= viewportHeight * SETTLE_BEHIND) return behind;
  return undefined;
}

/**
 * 스크롤이 완전히 멈춘 뒤에만 가까운 구간을 화면에 맞춘다.
 * 굴리는 동안에는 끼어들지 않아 트랙패드 관성과 부딪히지 않고, 사람이 다시 만지면 바로 놓아준다.
 */
export function useSectionSettle(path: string, scale: number, headerHeight: number) {
  useEffect(() => {
    if (!getSubMenu(path) || prefersReducedMotion()) return;
    let lastY = window.scrollY;
    let startY: number | null = null;
    let direction = 0;
    let timer = 0;
    let isPointerDown = false;

    // 휠 칸 사이에도 scrollend 가 오므로 곧바로 맞추지 않고 조용해지기를 기다린다.
    const waitForIdle = () => {
      clearTimeout(timer);
      timer = window.setTimeout(settle, SETTLE_IDLE_MS);
    };
    const settle = () => {
      const y = window.scrollY;
      const from = startY ?? y;
      startY = null;
      if (isPointerDown || sectionScroll.cancel || performance.now() < settleRest.until) return;
      const target = findRestTarget(y, from, direction, measureRestRanges(path, scale, headerHeight));
      if (target == null) return;
      scrollToSection(
        () => target,
        0,
        (distance) => Math.min(650, 260 + distance * 0.5),
      );
    };
    const handleScroll = () => {
      const y = window.scrollY;
      if (y !== lastY) {
        startY ??= lastY;
        direction = Math.sign(y - lastY);
      }
      lastY = y;
      waitForIdle();
    };
    const handlePointerDown = () => {
      isPointerDown = true;
    };
    const handlePointerUp = () => {
      isPointerDown = false;
      waitForIdle();
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("wheel", waitForIdle, { passive: true });
    window.addEventListener("scrollend", waitForIdle);
    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("wheel", waitForIdle);
      window.removeEventListener("scrollend", waitForIdle);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [path, scale, headerHeight]);
}
