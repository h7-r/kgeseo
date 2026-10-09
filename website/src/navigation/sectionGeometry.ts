import { PIN_CLASS, STAGE_INNER_SELECTOR } from "@/lib/layout";

import { getSubMenu } from "./subMenus";

/**
 * 요소가 문서에 배치된 높이(px).
 * 핀 덩이는 멈춰 있는 동안 transform 으로 따라 내려와 화면 위치가 늘 같다. offsetTop 은 transform 을 무시하므로
 * 무대 안쪽 칸까지 offsetTop 을 더하고 무대 배율을 곱한다.
 */
function measureDocumentTop(element: HTMLElement, scale: number): number {
  let sum = 0;
  let current: Element | null = element;
  while (current instanceof HTMLElement && !current.matches(STAGE_INNER_SELECTOR)) {
    sum += (current.offsetTop || 0) + measureSteadyTranslateY(current);
    current = current.offsetParent;
  }
  if (!current) return element.getBoundingClientRect().top + window.scrollY; // 무대 밖
  return current.getBoundingClientRect().top + window.scrollY + sum * scale;
}

interface SectionBounds {
  top: number;
  height: number;
}

/**
 * 덩이가 차지하는 범위(px).
 * 홈의 덩이는 한 shift 상자 안에 제목·그림·카드로 흩어져 있어, 찾은 요소 하나만 재면 가운데가 어긋난다.
 * 그래서 같은 shift 상자의 조각을 모두 합친 범위를 쓴다.
 */
function measureSectionBounds(element: HTMLElement, scale: number): SectionBounds {
  const single = () => ({ top: measureDocumentTop(element, scale), height: element.offsetHeight * scale });
  const shiftBox = element.closest("[data-shift]");
  if (!shiftBox) return single();
  let top = Infinity;
  let bottom = -Infinity;
  for (const child of shiftBox.children) {
    if (!(child instanceof HTMLElement) || !child.offsetHeight) continue;
    const childTop = measureDocumentTop(child, scale);
    top = Math.min(top, childTop);
    bottom = Math.max(bottom, childTop + child.offsetHeight * scale);
  }
  return Number.isFinite(top) ? { top, height: bottom - top } : single();
}

/**
 * 덩이를 보려면 스크롤을 둘 자리(px).
 * 덩이 사이 틈이 모두 같으므로 머리띠 아래 남은 화면 한가운데에 놓으면 위아래 틈이 같게 보인다.
 * 화면보다 긴 덩이는 머리띠 바로 아래에서 시작한다.
 */
function computeSnapScrollTop(bounds: SectionBounds, headerHeight: number): number {
  const remaining = window.innerHeight - headerHeight;
  if (bounds.height <= remaining) {
    return Math.max(0, bounds.top + bounds.height / 2 - (headerHeight + remaining / 2));
  }
  return Math.max(0, bounds.top - headerHeight - 16);
}

/**
 * 요소에 늘 걸려 있는 세로 이동(설계 px).
 * translateY(-50%) 로 가운데 정렬한 덩이는 offsetTop 만 보면 크게 어긋나므로 더한다.
 * 핀 이동은 스크롤만큼 따라 내려오는 것이라 빼야 원래 자리가 나온다.
 */
function measureSteadyTranslateY(element: HTMLElement): number {
  if (element.classList.contains(PIN_CLASS)) return 0;
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === "none") return 0;
  try {
    return new DOMMatrixReadOnly(transform).m42;
  } catch {
    return 0;
  }
}

interface SectionPosition extends SectionBounds {
  id: string;
  label: string;
  /** 핀이 풀리는 스크롤 자리(px). */
  pinEnd: number;
  /** 이 덩이에 맞출 때의 스크롤 자리(px). */
  snapTop: number;
  isPageTop?: boolean;
}

/** 지금 페이지의 덩이 자리들. 위에서 아래 순. */
export function measureSectionPositions(path: string, scale: number, headerHeight = 0): SectionPosition[] {
  const menu = getSubMenu(path);
  if (!menu) return [];
  const result: SectionPosition[] = [];
  for (const item of menu.items) {
    if (!item.selector) {
      result.push({ id: item.id, label: item.label, top: 0, height: 0, pinEnd: 0, isPageTop: true, snapTop: 0 });
      continue;
    }
    const element = document.querySelector(item.selector);
    if (!(element instanceof HTMLElement)) continue;
    const bounds = measureSectionBounds(element, scale);
    result.push({
      id: item.id,
      label: item.label,
      ...bounds,
      pinEnd: bounds.top + (item.pinLength ?? 0) * scale,
      snapTop: computeSnapScrollTop(bounds, headerHeight),
    });
  }
  return result.sort((a, b) => a.top - b.top);
}

// 스크롤마다 전부 다시 재면(getComputedStyle·offsetTop) 매 프레임 배치를 다시 계산해 버벅인다.
const CACHE_TTL_MS = 400;
let cache: { key: string; time: number; value: SectionPosition[] } = { key: "", time: 0, value: [] };

/** measureSectionPositions 를 같은 페이지·배율·머리 높이면 0.4초 동안 다시 쓴다. */
export function measureSectionPositionsCached(path: string, scale: number, headerHeight = 0): SectionPosition[] {
  const key = `${path}|${scale}|${headerHeight}`;
  const now = performance.now();
  if (cache.key !== key || now - cache.time > CACHE_TTL_MS) {
    cache = { key, time: now, value: measureSectionPositions(path, scale, headerHeight) };
  }
  return cache.value;
}
