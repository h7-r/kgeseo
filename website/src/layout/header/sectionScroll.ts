import { prefersReducedMotion } from "@/lib/motionPreference";

/** 스스로 굴리는 동안 머리띠를 이 시각(ms)까지 붙잡아 둔다. */
const headerHold = { until: 0 };

const sectionScroll: { frame: number; cancel: (() => void) | null } = { frame: 0, cancel: null };

/** 스스로 굴리는 중이거나 막 끝났으면 머리띠를 숨기지 않는다. */
export function isHeaderHeld(now: number): boolean {
  return now < headerHold.until;
}

export function cancelSectionScroll(): void {
  sectionScroll.cancel?.();
}

/**
 * 구간에 맞춰 한 프레임씩 직접 굴린다. 그동안 머리띠는 숨지 않는다.
 * scrollTo smooth 는 멀리 갈 때 아래 그림·영상이 읽히며 문서가 바뀌면 중간에 끊겼다.
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
