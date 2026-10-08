import { useEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "@/lib/motionPreference";
import { sectionTops, sectionTopsCached } from "@/navigation/sectionGeometry";
import { getSubMenu } from "@/navigation/subMenus";

// 머리띠가 스크롤에 맞춰 하는 일: 숨기·드러내기, 구간으로 굴러가기, 구간 맞춤 칸 깔기, 지금 구간 찾기.

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

/** 맨 위를 벗어났나(solid) · 내려가는 중이라 숨길까(hidden). 매 프레임 리렌더하지 않도록 문턱을 넘을 때만 바뀐다. */
export function useHeaderScrollState() {
  const [solid, setSolid] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - lastY.current;

      setSolid(y > SOLID_THRESHOLD);
      // 스스로 굴리는 중에 숨으면 맞춘 화면 위에 빈 띠가 생긴다.
      if (isHeaderHeld(performance.now())) {
        setHidden(false);
        lastY.current = y;
        return;
      }
      if (y < ALWAYS_SHOWN_ABOVE) setHidden(false);
      else if (delta > HIDE_DELTA) setHidden(true);
      else if (delta < -HIDE_DELTA) setHidden(false);

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

  return { solid, hidden };
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
      for (const section of sectionTopsCached(path, scale, headerHeight)) {
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

interface SnapSlot {
  top: number;
  height: number;
  align: "start" | "center" | "end";
}

/**
 * 구간 맞춤은 CSS scroll-snap 에 맡기고 여기선 문서 위에 보이지 않는 맞춤 칸만 깐다.
 * JS 로 끌어다 맞추면 트랙패드 관성과 같은 프레임에 부딪혀 멈칫한다. scroll-snap 은 관성과 한 몸으로 선다.
 * 화면보다 긴 구간·핀 구간은 윗줄 맞춤으로 두어 그 안에서는 자유롭게 굴린다.
 */
export function useSectionSnapMarkers(path: string, scale: number, headerHeight: number) {
  useEffect(() => {
    if (!getSubMenu(path)) return;
    if (prefersReducedMotion()) return;
    const html = document.documentElement;
    const layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:absolute;left:0;top:0;width:1px;height:0;pointer-events:none;visibility:hidden;";
    document.body.appendChild(layer);

    const layOut = () => {
      const viewportHeight = window.innerHeight;
      const available = viewportHeight - headerHeight;
      const slots: SnapSlot[] = [];
      // 맨 위 히어로 핀 — 0 부터 핀이 풀리는 데까지 한 칸.
      const pinTrack = document.querySelector("[data-pin-track]");
      if (pinTrack) {
        const end = pinTrack.getBoundingClientRect().bottom + window.scrollY - viewportHeight;
        slots.push({ top: 0, height: Math.max(viewportHeight, end + viewportHeight), align: "start" });
      }
      for (const section of sectionTops(path, scale, headerHeight)) {
        if (section.isPageTop) continue;
        const pin = section.pinEnd - section.top;
        if (!pin && section.height <= available) {
          slots.push({ top: section.top, height: section.height, align: "center" });
        } else {
          slots.push({ top: section.top - 16, height: section.height + pin + 16, align: "start" });
        }
      }
      // 맨 아래 — 푸터까지 내려갈 수 있게.
      slots.push({ top: html.scrollHeight - viewportHeight, height: viewportHeight, align: "end" });
      layer.replaceChildren(
        ...slots.map((slot) => {
          const marker = document.createElement("div");
          marker.style.cssText = `position:absolute;left:0;width:1px;top:${Math.round(slot.top)}px;height:${Math.max(1, Math.round(slot.height))}px;scroll-snap-align:${slot.align};`;
          return marker;
        }),
      );
    };

    html.style.scrollPaddingTop = `${headerHeight}px`;
    html.classList.add("section-snap");
    layOut();
    // 그림·영상이 늦게 읽혀 문서 높이가 바뀌면 다시 깐다.
    let timer = 0;
    const scheduleLayOut = () => {
      clearTimeout(timer);
      timer = window.setTimeout(layOut, 120);
    };
    const observer = new ResizeObserver(scheduleLayOut);
    observer.observe(document.body);
    window.addEventListener("resize", scheduleLayOut);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("resize", scheduleLayOut);
      html.classList.remove("section-snap");
      html.style.scrollPaddingTop = "";
      layer.remove();
    };
  }, [path, scale, headerHeight]);
}
