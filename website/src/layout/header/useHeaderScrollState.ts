import { useEffect, useRef, useState } from "react";

import { isHeaderHeld } from "./sectionScroll";

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
