import { offsetTopWithinStage, STAGE_INNER_SELECTOR, DESIGN_WIDTH } from "@/lib/layout";
import { PAGE_CHANGE_EVENT } from "@/lib/pageEvents";

import { JOURNEY_SECTIONS, journeyInput, MAX_SCRIMS } from "./journey";

// 홈 스크롤 → 강 여정 진행도. 문서 전체 비율로 잡으면 핀 구간·긴 구역 때문에 카메라가 구역과 어긋난다.
// 구역이 화면 가운데 오는 실제 스크롤 자리를 재서 JOURNEY_SECTIONS 의 진행도와 짝짓는다.

interface Knot {
  scroll: number;
  t: number;
}

interface Measured {
  knots: Knot[];
  /** 구역이 바뀌는 스크롤 자리(JOURNEY_SECTIONS 순서의 사이사이). */
  boundaries: number[];
  sealAnchor: HTMLElement | null;
  /** 장면을 눌러 둘 글 덩이(data-scrim). */
  scrims: HTMLElement[];
}

function measure(): Measured | null {
  const stage = document.querySelector<HTMLElement>(STAGE_INNER_SELECTOR);
  if (!stage) return null;
  const viewportHeight = window.innerHeight;
  const stageRect = stage.getBoundingClientRect();
  const scale = stageRect.width / (stage.offsetWidth || DESIGN_WIDTH);
  const stageTop = stageRect.top + window.scrollY;

  const knots: Knot[] = [{ scroll: 0, t: 0 }];
  const middles: number[] = [];
  for (const section of JOURNEY_SECTIONS) {
    const el = stage.querySelector<HTMLElement>(`[data-section="${section.id}"]`);
    if (!el) return null;
    // usePinnedReveal 과 같은 기준 — 덩이 가운데가 화면 가운데 오는 순간.
    const center = Math.round(
      stageTop + (offsetTopWithinStage(el, stage) + el.offsetHeight / 2) * scale - viewportHeight / 2,
    );
    if (typeof section.at === "number") {
      knots.push({ scroll: center, t: section.at });
      middles.push(center);
    } else {
      const end = center + Math.round((section.pinLength ?? 0) * scale);
      knots.push({ scroll: center, t: section.at[0] }, { scroll: end, t: section.at[1] });
      middles.push((center + end) / 2);
    }
  }
  const maxScroll = Math.max(
    document.documentElement.scrollHeight - viewportHeight,
    knots[knots.length - 1].scroll + 1,
  );
  knots.push({ scroll: maxScroll, t: 1 });

  const boundaries = middles.slice(1).map((middle, i) => (middles[i] + middle) / 2);
  return {
    knots,
    boundaries,
    sealAnchor: stage.querySelector<HTMLElement>("[data-seal-anchor]"),
    scrims: [...stage.querySelectorAll<HTMLElement>("[data-scrim]")],
  };
}

function progressAt(knots: readonly Knot[], scroll: number): number {
  for (let i = 1; i < knots.length; i += 1) {
    const a = knots[i - 1];
    const b = knots[i];
    if (scroll <= b.scroll)
      return a.t + (b.t - a.t) * Math.max(0, (scroll - a.scroll) / Math.max(1, b.scroll - a.scroll));
  }
  return 1;
}

/**
 * 홈 스크롤을 journeyInput 에 옮겨 쓰기 시작한다. 돌려준 함수로 멈춘다.
 * 자리는 크기가 바뀔 때만 다시 잰다 — 스크롤마다 재면 강제 레이아웃이 난다.
 */
export function followHomeScroll(onChange: () => void): () => void {
  let measured: Measured | null = null;
  let dirty = true;
  let frame = 0;

  const update = () => {
    frame = 0;
    if (dirty) {
      measured = measure();
      dirty = false;
    }
    if (!measured) return;
    const y = window.scrollY;
    journeyInput.progress = progressAt(measured.knots, y);
    journeyInput.section = Math.min(
      JOURNEY_SECTIONS.length - 1,
      measured.boundaries.filter((boundary) => y >= boundary).length,
    );
    // 봉인 자리(앙암 사진 원)는 핀에 붙잡혀 움직이므로 스크롤마다 화면 자리를 다시 읽는다. 읽기만 해 레이아웃을 흔들지 않는다.
    const anchor = measured.sealAnchor?.getBoundingClientRect();
    if (anchor) {
      journeyInput.sealAnchor.x = (anchor.left + anchor.width / 2) / window.innerWidth;
      journeyInput.sealAnchor.y = (anchor.top + anchor.height / 2) / window.innerHeight;
      journeyInput.sealAnchor.radius = anchor.width / 2 / window.innerHeight;
    }
    // 글 덩이는 핀·스크롤로 움직인다. 화면에 걸친 것만 담는다.
    let count = 0;
    for (const element of measured.scrims) {
      if (count >= MAX_SCRIMS) break;
      const rect = element.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.width === 0) continue;
      journeyInput.scrims[count][0] = rect.left / window.innerWidth;
      journeyInput.scrims[count][1] = rect.top / window.innerHeight;
      journeyInput.scrims[count][2] = rect.right / window.innerWidth;
      journeyInput.scrims[count][3] = rect.bottom / window.innerHeight;
      count += 1;
    }
    journeyInput.scrimCount = count;
    onChange();
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const remeasure = () => {
    dirty = true;
    schedule();
  };

  // 위쪽 영상·글꼴이 늦게 와 무대 높이가 바뀌어도 다시 잰다.
  const resizeObserver = new ResizeObserver(remeasure);
  resizeObserver.observe(document.body);
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", remeasure);
  window.addEventListener(PAGE_CHANGE_EVENT, remeasure);
  update();

  return () => {
    if (frame) cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", remeasure);
    window.removeEventListener(PAGE_CHANGE_EVENT, remeasure);
  };
}
