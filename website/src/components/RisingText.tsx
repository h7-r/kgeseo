import type { CSSProperties } from "react";

import { useReveal } from "@/hooks/motion";

interface RisingTextProps {
  text: string;
  style?: CSSProperties;
  /** 자리를 잡는 바깥 칸의 class. */
  className?: string;
  /** 글자를 담은 칸의 class. background-clip: text 처럼 글자에 걸려야 하는 것은 여기로 준다. */
  textClassName?: string;
}

const perspectiveStyle: CSSProperties = { perspective: "900px", perspectiveOrigin: "50% 100%" };

/**
 * 제목이 바닥에 누워 있다가 한 덩이로 일어선다(rotateX).
 * 낱말마다 transform 을 걸면 background-clip: text 글자가 낱말별로 합성돼 통째로 사라져서 줄 전체를 세운다.
 */
export default function RisingText({ text, style, className, textClassName }: RisingTextProps) {
  const [ref, isVisible] = useReveal<HTMLSpanElement>("0px 0px 30% 0px");
  const lineClass = `rising-text__line${isVisible ? " is-visible" : ""}`;

  return (
    <div className={className} style={perspectiveStyle}>
      <span
        ref={ref}
        className={`${lineClass}${textClassName ? ` ${textClassName}` : ""}`}
        style={{ ...style, display: "inline-block" }}
      >
        {text}
      </span>
    </div>
  );
}
