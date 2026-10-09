import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from "react";

import { DESIGN_WIDTH, PIN_CLASS, STAGE_INNER_SELECTOR } from "@/lib/layout";
import { clamp01 } from "@/lib/math";
import { prefersReducedMotion } from "@/lib/motionPreference";
import { consumeProgrammaticScroll } from "@/lib/pageEvents";

/** 스크롤에 물린 CSS 애니메이션을 지원하면 훅들은 물러나 CSS(합성 스레드)에 맡긴다. */
function supportsScrollTimeline(timeline: string): boolean {
  return typeof CSS !== "undefined" && Boolean(CSS.supports?.(`animation-timeline: ${timeline}`));
}

/** "below" 는 화면 아래로 빠질 때만 되감고, "both" 는 어느 쪽으로 나가든 끈다. */
type RevealRewind = "below" | "both";

/**
 * 화면에 들어오면 true. 위로 지나간 것은 그대로 두고, 아래로 빠졌을 때만 되감아
 * 다시 내려오면 한 번 더 나타난다. 여유를 크게 줘 화면에 닿을 즈음엔 이미 다 나타나 있다.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(
  rootMargin = "0px 0px 30% 0px",
  rewind: RevealRewind = "below",
): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  // 동작 줄이기를 켠 사람에겐 처음부터 보여 준다.
  const [isVisible, setIsVisible] = useState(prefersReducedMotion);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
        // top > 0 이면 화면 아래쪽으로 빠진 것이다.
        else if (rewind === "both" || entry.boundingClientRect.top > 0) setIsVisible(false);
      },
      { rootMargin, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, rewind]);

  return [ref, isVisible];
}

/** 읽은 만큼 차오르는 막대. 매 스크롤마다 리렌더하지 않도록 DOM 을 직접 쓴다. */
export function useReadProgress<T extends HTMLElement = HTMLDivElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (supportsScrollTimeline("scroll()")) return;

    let frame = 0;
    const draw = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const end = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = end <= 0 ? 0 : clamp01(window.scrollY / end);
      el.style.transform = `scaleX(${ratio})`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    draw();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return ref;
}

/**
 * 무대 안에서의 세로 자리(무대 px). shift 상자(data-shift) 안에 들어가면 offsetTop 이 그 상자 기준이라
 * 무대 칸까지 거슬러 올라가며 더한다. transform 을 무시하므로 핀으로 밀어 둔 상태에서도 같다.
 */
function offsetTopWithinStage(el: HTMLElement, stage: Element): number {
  let y = 0;
  for (let node: HTMLElement | null = el; node && node !== stage; node = node.offsetParent as HTMLElement | null) {
    y += node.offsetTop;
  }
  return y;
}

interface PinnedRevealOptions {
  /** 멈춘 채 스크롤하는 거리(무대 px). */
  pinLength?: number;
  /** 덩이 하나가 진행도에서 맡는 몫. 간격보다 넓어 앞 덩이가 끝나기 전에 다음이 시작된다. */
  span?: number;
  /** 이 진행도에서 모든 덩이가 다 드러난다. 나머지는 다 보인 채로 머문다. */
  revealEnd?: number;
  /** 같이 멈출 요소들의 data-pin-group 값. 구간마다 다르게 준다. */
  pinGroup?: string;
  /** true 면 판에 --enter(가운데로 오는 동안 0→1)·--progress(멈춘 뒤 0→1)를 써 준다. */
  writeProgress?: boolean;
  /** 멈춘 뒤 이 진행도까지는 글을 숨겨 둔다. 그동안 그림이 먼저 움직인다. */
  textStart?: number;
}

/**
 * 판 가운데가 화면 가운데에 오면 그 자리에 멈추고, pinLength 만큼 더 스크롤하는 동안
 * 안의 .u-pin-reveal 덩이들이 차례로 드러난다.
 * view() 는 무대 축소(transform) 전 자리로 계산해 늦게 움직이므로 자리를 직접 잰다.
 */
export function usePinnedReveal<T extends HTMLElement = HTMLDivElement>({
  pinLength = 600,
  span = 0.52,
  revealEnd = 0.8,
  pinGroup = "angam-rock",
  writeProgress = false,
  textStart = 0,
}: PinnedRevealOptions = {}): RefObject<T | null> {
  const ref = useRef<T>(null);

  // 첫 그림 전에 0 을 넣어야 다 보였다가 사라지는 깜빡임이 없다.
  useLayoutEffect(() => {
    const panel = ref.current;
    const stage = panel?.closest<HTMLElement>(STAGE_INNER_SELECTOR);
    if (!panel || !stage) return;
    const chunks = [...panel.querySelectorAll<HTMLElement>(".u-pin-reveal")];
    const pinned = [...document.querySelectorAll<HTMLElement>(`.${PIN_CLASS}[data-pin-group="${pinGroup}"]`)];
    const cssPin = supportsScrollTimeline("scroll()");
    // 동작 줄이기: 글은 처음부터 다 보이게. 멈춤은 움직임이 아니라 자리라서 그대로 둔다.
    const reduced = prefersReducedMotion();
    if (reduced) chunks.forEach((el) => el.classList.add("is-complete"));

    const gap = chunks.length > 1 ? (1 - span) / (chunks.length - 1) : 0;
    const lastValues = new Map<Element, string | number>();
    let lastPin = "";

    let frame = 0;
    const draw = () => {
      frame = 0;
      const viewportHeight = window.innerHeight;
      const stageRect = stage.getBoundingClientRect();
      const scale = stageRect.width / (stage.offsetWidth || DESIGN_WIDTH);
      const stageTop = stageRect.top + window.scrollY;
      const panelCenter = offsetTopWithinStage(panel, stage) + panel.offsetHeight / 2;
      const pinStart = Math.round(stageTop + panelCenter * scale - viewportHeight / 2);
      const pinDistance = Math.round(pinLength * scale);

      const pinKey = `${pinStart}|${pinDistance}`;
      if (cssPin && pinKey !== lastPin) {
        lastPin = pinKey;
        for (const el of pinned) {
          el.style.setProperty("--pin-start", `${pinStart}px`);
          el.style.setProperty("--pin-end", `${pinStart + pinDistance}px`);
          el.style.setProperty("--pin-distance", `${pinLength}px`);
          // 숫자가 준비된 뒤에야 CSS 애니메이션을 켠다.
          el.classList.add("is-pinned");
        }
      }
      const scrolled = Math.min(pinDistance, Math.max(0, window.scrollY - pinStart));
      if (!cssPin) {
        const push = `translate3d(0, ${(scrolled / scale).toFixed(2)}px, 0)`;
        for (const el of pinned) el.style.transform = push;
      }

      if (writeProgress) {
        // 한 화면 전부터 0 → 멈추는 순간 1
        const enter = clamp01(1 - (pinStart - window.scrollY) / viewportHeight);
        const progress = pinDistance > 0 ? scrolled / pinDistance : 1;
        const key = `${enter.toFixed(3)}|${progress.toFixed(3)}`;
        if (lastValues.get(panel) !== key) {
          lastValues.set(panel, key);
          panel.style.setProperty("--enter", enter.toFixed(3));
          panel.style.setProperty("--progress", reduced ? "1" : progress.toFixed(3));
        }
      }
      if (reduced) return;

      const overall =
        pinDistance > 0 ? (scrolled / pinDistance - textStart) / Math.max(0.01, revealEnd - textStart) : 1;
      chunks.forEach((el, index) => {
        let ratio = (overall - index * gap) / span;
        ratio = clamp01(ratio);
        ratio = Math.round(ratio * 1000) / 1000;
        if (lastValues.get(el) === ratio) return;
        lastValues.set(el, ratio);
        el.style.setProperty("--reveal-progress", String(ratio));
        el.classList.toggle("is-complete", ratio >= 1);
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    draw();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // 위쪽 구간이 늦게 커지면(영상·폰트 로드) 무대 자리가 달라진다.
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(document.body);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      resizeObserver.disconnect();
    };
  }, [pinLength, span, revealEnd, pinGroup, writeProgress, textStart]);

  return ref;
}

export const revealClass = (isVisible: boolean): string => `u-reveal${isVisible ? " is-visible" : ""}`;

/** 깊이까지 주는 드러내기 — 안쪽에서 걸어 나오는 느낌. */
export const depthRevealClass = (isVisible: boolean): string => `u-depth-reveal${isVisible ? " is-visible" : ""}`;

/** 마우스를 따라 [data-depth] 층이 깊이만큼 어긋난다. */
export function useMouseParallax<T extends HTMLElement = HTMLDivElement>(maxOffset = 14): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return;

    let frame = 0;
    let x = 0;
    let y = 0;

    const draw = () => {
      frame = 0;
      for (const layer of el.querySelectorAll<HTMLElement>("[data-depth]")) {
        const depth = parseFloat(layer.dataset.depth ?? "") || 0;
        layer.style.transform = `translate3d(${(-x * maxOffset * depth).toFixed(2)}px, ${(-y * maxOffset * depth).toFixed(2)}px, 0)`;
      }
    };

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const rect = el.getBoundingClientRect();
      x = (event.clientX - rect.left) / rect.width - 0.5;
      y = (event.clientY - rect.top) / rect.height - 0.5;
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const handleMouseLeave = () => {
      x = 0;
      y = 0;
      if (!frame) frame = requestAnimationFrame(draw);
    };

    el.addEventListener("mousemove", handleMouseMove);
    el.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("mousemove", handleMouseMove);
      el.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [maxOffset]);

  return ref;
}

interface TiltBindings<T extends HTMLElement> {
  ref: RefObject<T | null>;
  onMouseMove: (event: MouseEvent<T>) => void;
  onMouseLeave: () => void;
}

/** 마우스를 따라 최대 ±maxAngle 도 기울어지는 카드. 결과를 요소에 그대로 펼쳐 붙인다. */
export function useTilt<T extends HTMLElement = HTMLDivElement>(maxAngle = 6): TiltBindings<T> {
  const ref = useRef<T>(null);

  const onMouseMove = (event: MouseEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `rotateY(${x * maxAngle * 2}deg) rotateX(${-y * maxAngle * 2}deg) translateZ(0)`;
  };
  const onMouseLeave = () => {
    const el = ref.current;
    if (el) el.style.transform = "";
  };

  return { ref, onMouseMove, onMouseLeave };
}

/**
 * CSS view() 와 같은 뜻의 구간 지점.
 * entry x: 윗변이 화면 아래에서 x×높이 들어옴 · cover x: 아래 닿음(0)~위로 다 빠짐(1) · exit x: 윗변이 화면 위에 닿은 뒤 x×높이 더 올라감
 */
type ScrollRangeEdge = readonly ["entry" | "cover" | "exit", number];

interface ScrollRangeOptions {
  start?: ScrollRangeEdge;
  end?: ScrollRangeEdge;
}

function edgeToScrollY([kind, x]: ScrollRangeEdge, top: number, height: number, viewportHeight: number): number {
  if (kind === "entry") return top - viewportHeight + x * height;
  if (kind === "exit") return top + x * height;
  return top - viewportHeight + x * (viewportHeight + height);
}

/**
 * 요소의 스크롤 구간을 px 로 재서 --range-start · --range-end 에 넣는다.
 * view() 는 무대 축소(transform) 를 빼고 재서 수백 px 어긋나므로 직접 잰다.
 * 스크롤마다가 아니라 창·페이지 크기가 바뀔 때만 다시 잰다.
 */
function useScrollRange(
  ref: RefObject<HTMLElement | null>,
  { start = ["entry", 0], end = ["exit", 1] }: ScrollRangeOptions = {},
): void {
  // 배열은 매번 새로 만들어지므로 낱값으로 풀어 의존성을 비교한다.
  const [startKind, startX] = start;
  const [endKind, endX] = end;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !supportsScrollTimeline("scroll()")) return;
    const stage = el.closest<HTMLElement>(STAGE_INNER_SELECTOR);
    let frame = 0;
    let last = "";
    const measure = () => {
      frame = 0;
      const viewportHeight = window.innerHeight;
      let scale = 1;
      let top: number;
      if (stage) {
        const rect = stage.getBoundingClientRect();
        scale = rect.width / (stage.offsetWidth || DESIGN_WIDTH);
        top = rect.top + window.scrollY + offsetTopWithinStage(el, stage) * scale;
      } else {
        top = el.getBoundingClientRect().top + window.scrollY;
      }
      const height = el.offsetHeight * scale;
      const a = Math.round(edgeToScrollY([startKind, startX], top, height, viewportHeight));
      const b = Math.round(edgeToScrollY([endKind, endX], top, height, viewportHeight));
      const key = `${a}|${b}`;
      if (key === last) return;
      last = key;
      el.style.setProperty("--range-start", `${a}px`);
      el.style.setProperty("--range-end", `${b}px`);
      // 숫자가 들어간 뒤에야 애니메이션을 켠다.
      el.classList.add("is-ranged");
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", schedule);
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(document.body);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      resizeObserver.disconnect();
    };
  }, [ref, startKind, startX, endKind, endX]);
}

/** 확대샷으로 시작해 들어오는 동안 제 크기로 물러난다(.u-scroll-zoom-out). */
export function useScrollZoomOut<T extends HTMLElement = HTMLDivElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useScrollRange(ref, { start: ["entry", 0.1], end: ["cover", 0.42] });
  return ref;
}

interface ScrollZoomOptions {
  /** 아래에서 들어올 때 배율. */
  enterScale?: number;
  /** 위로 빠져나갈 때 배율. */
  exitScale?: number;
  /** 들어올 때 뒤로 물러나 있는 거리(px). */
  depth?: number;
}

/**
 * 멀리서 다가와 한가운데에서 제 크기, 위로 빠질 땐 살짝 커지며 지나간다.
 * 배율 폭을 좁게 잡아야 글자가 출렁이지 않는다 — 그림·카드에만 쓴다.
 */
export function useScrollZoom<T extends HTMLElement = HTMLDivElement>({
  enterScale = 0.92,
  exitScale = 1.05,
  depth = 70,
}: ScrollZoomOptions = {}): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return;
    // 지원하면 .u-scroll-zoom + useScrollRange 로 CSS 가 맡는다.
    if (supportsScrollTimeline("scroll()")) return;

    let frame = 0;
    const draw = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      // 0 = 아래에서 막 들어옴, 0.5 = 한가운데, 1 = 위로 다 빠져나감
      const ratio = clamp01((viewportHeight - rect.top) / (viewportHeight + rect.height));
      const scale =
        ratio < 0.5 ? enterScale + (1 - enterScale) * (ratio / 0.5) : 1 + (exitScale - 1) * ((ratio - 0.5) / 0.5);
      const z = ratio < 0.5 ? -depth * (1 - ratio / 0.5) : 0;
      el.style.transform = `perspective(1600px) translate3d(0, 0, ${z.toFixed(1)}px) scale(${scale.toFixed(4)})`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    draw();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [enterScale, exitScale, depth]);

  useScrollRange(ref, { start: ["entry", 0], end: ["exit", 1] });

  return ref;
}

/**
 * 지금 스크롤하는 중인가. 배경 입체 공간을 넘길 때만 살려 글 읽기를 방해하지 않는다.
 * 멈춤 판정이 짧으면 손을 떼는 찰나마다 깜빡이므로 900ms 쯤 기다린다.
 */
export function useIsScrolling(idleDelay = 900): boolean {
  const [isScrolling, setIsScrolling] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    let timer = 0;
    let active = false;
    const handleScroll = () => {
      // 쪽 이동이 부른 scrollTo(0) 은 사람이 굴린 게 아니다.
      if (consumeProgrammaticScroll()) return;
      if (!active) {
        active = true;
        setIsScrolling(true);
      }
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        active = false;
        setIsScrolling(false);
      }, idleDelay);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [idleDelay]);

  return isScrolling;
}
