import { useEffect, useRef, type RefObject } from "react";

import { prefersReducedMotion } from "@/lib/motionPreference";

/*
 * 커서가 가까워질수록 이미 테두리·색을 가진 요소가 밝아진다(--proximity 0→1).
 * 검정 바탕 위에 빛을 얹으면 회색 얼룩으로만 보여서 이 방식을 쓴다.
 * 창에 리스너 하나, 한 프레임에 한 번(rAF), CSS 변수만 바꿔 리렌더가 없다.
 */

interface ProximityEntry {
  el: HTMLElement;
  radius: number;
  lastValue?: string;
}

const NO_POINTER = -9999;
const OFFSCREEN_MARGIN = 80;

const entries = new Set<ProximityEntry>();
// ref 콜백으로 등록한 요소. 같은 요소가 다시 넘어와도 쌓이지 않게 한다.
const registered = new Map<HTMLElement, ProximityEntry>();

let frame = 0;
let pointerX = NO_POINTER;
let pointerY = NO_POINTER;
let listening = false;
let allCleared = false;

function canTrackPointer(): boolean {
  return Boolean(window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) && !prefersReducedMotion();
}

// 같은 값이라도 CSS 변수를 쓰면 스타일을 다시 계산하므로 바뀔 때만 쓴다.
function write(entry: ProximityEntry, value: string) {
  if (entry.lastValue === value) return;
  entry.lastValue = value;
  entry.el.style.setProperty("--proximity", value);
}

function draw() {
  frame = 0;
  allCleared = pointerX === NO_POINTER;
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const detached: ProximityEntry[] = [];

  // 위치를 전부 읽은 뒤 몰아서 쓴다. 읽기·쓰기를 번갈아 하면 매번 스타일을 다시 계산한다.
  const writes: [ProximityEntry, string][] = [];
  for (const entry of entries) {
    if (!entry.el.isConnected) {
      detached.push(entry);
      continue;
    }
    const rect = entry.el.getBoundingClientRect();
    if (
      rect.bottom < -OFFSCREEN_MARGIN ||
      rect.top > viewportHeight + OFFSCREEN_MARGIN ||
      rect.right < -OFFSCREEN_MARGIN ||
      rect.left > viewportWidth + OFFSCREEN_MARGIN
    ) {
      writes.push([entry, "0"]);
      continue;
    }
    // 가운데가 아니라 가장자리까지 잰다. 가운데 기준이면 큰 카드가 불리하다.
    const dx = Math.max(rect.left - pointerX, 0, pointerX - rect.right);
    const dy = Math.max(rect.top - pointerY, 0, pointerY - rect.bottom);
    const distance = Math.hypot(dx, dy);
    const value = distance >= entry.radius ? 0 : 1 - distance / entry.radius;
    // 제곱해 끝에서 뚝 떨어지게 한다. 선형이면 멀리서도 늘 희미하게 켜져 있다.
    writes.push([entry, (value * value).toFixed(3)]);
  }
  for (const [entry, value] of writes) write(entry, value);

  for (const entry of detached) {
    entries.delete(entry);
    registered.delete(entry.el);
  }
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(draw);
}

function handleMouseMove(event: MouseEvent) {
  pointerX = event.clientX;
  pointerY = event.clientY;
  schedule();
}

function handleMouseLeave() {
  pointerX = NO_POINTER;
  pointerY = NO_POINTER;
  schedule();
}

function handleScroll() {
  // 커서가 창 밖이고 이미 전부 0 으로 껐으면 스크롤마다 다시 잴 필요가 없다.
  if (pointerX === NO_POINTER && allCleared) return;
  schedule();
}

// 페이지 수명 내내 쓰는 공용 리스너라 떼지 않는다.
function startListening() {
  if (listening) return;
  listening = true;
  window.addEventListener("mousemove", handleMouseMove, { passive: true });
  window.addEventListener("mouseleave", handleMouseLeave);
  window.addEventListener("scroll", handleScroll, { passive: true });
}

/**
 * ref 콜백에서 바로 등록한다. ref 를 이미 다른 용도로 쓰는 자리(메뉴 밑줄 재기 등)에 쓴다.
 * 요소가 문서에서 빠지면 다음 프레임에 스스로 명단에서 빠진다.
 */
export function registerProximity(el: HTMLElement | null, radius = 170): void {
  if (!el || registered.has(el)) return;
  if (!canTrackPointer()) return;
  const entry: ProximityEntry = { el, radius };
  registered.set(el, entry);
  entries.add(entry);
  startListening();
}

/** 커서가 radius(px) 안에 들어오면 이 요소의 --proximity 가 0 → 1 로 오른다. */
export function useProximity<T extends HTMLElement = HTMLDivElement>(radius = 190): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !canTrackPointer()) return;

    const entry: ProximityEntry = { el, radius };
    entries.add(entry);
    startListening();
    return () => {
      entries.delete(entry);
      el.style.removeProperty("--proximity");
    };
  }, [radius]);

  return ref;
}
