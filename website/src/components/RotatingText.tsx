import { useEffect, useRef, useState, type CSSProperties } from "react";

import { useReveal } from "@/hooks/motion";
import { prefersReducedMotion } from "@/lib/motionPreference";

interface RotatingTextProps {
  lines: readonly string[];
  /** 문구가 바뀌는 간격(ms). */
  interval?: number;
  style?: CSSProperties;
  /** 문구 글자에 거는 스타일. 자리 잡는 숨은 글에도 같이 걸린다. */
  lineStyle?: CSSProperties;
}

/**
 * 한 자리에서 문구가 차례로 바뀐다. 화면 밖이면 멈추고, 마우스를 올려도 멈춘다.
 * 동작 줄이기를 켠 사람에겐 첫 줄만 보여 준다.
 */
export default function RotatingText({ lines, interval = 3600, style, lineStyle }: RotatingTextProps) {
  const [ref, isVisible] = useReveal("0px 0px -10% 0px", "both");
  const [index, setIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current = prefersReducedMotion();
  }, []);

  useEffect(() => {
    if (!isVisible || isPaused || reducedMotion.current || lines.length < 2) return;
    const timer = window.setInterval(() => setIndex((n) => (n + 1) % lines.length), interval);
    return () => clearInterval(timer);
  }, [isVisible, isPaused, interval, lines.length]);

  const current = lines[index] ?? lines[0];
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");

  return (
    <div
      ref={ref}
      style={{ position: "relative", ...style }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      aria-live="polite"
    >
      {/* 가장 긴 문구로 자리를 잡아 글이 바뀌어도 칸 높이가 들썩이지 않게 한다. */}
      <span aria-hidden="true" style={{ ...lineStyle, visibility: "hidden", display: "block" }}>
        {longest}
      </span>

      <span
        key={index}
        className="rotating-text__line"
        style={{ ...lineStyle, position: "absolute", left: 0, top: 0, right: 0 }}
      >
        {current}
      </span>
    </div>
  );
}
