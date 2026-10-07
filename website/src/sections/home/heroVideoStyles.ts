import type { CSSProperties } from "react";

// 영상 첫 장면을 바탕에 깔아 둔다. 캔버스가 같은 장면 위로 0.8초 동안 떠올라 바뀌는 순간이 안 보인다.
export const heroVideoBoxStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 0,
  pointerEvents: "none",
  overflow: "hidden",
  background: "#43587f url(/hero-scrub-poster.webp) center / cover no-repeat",
};

// 가장자리를 눌러 빨려드는 느낌을 키우고 흰 글자를 읽히게 한다.
export const heroVideoShadeStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 0,
  pointerEvents: "none",
  background:
    "radial-gradient(120% 90% at 50% 42%, rgba(67,88,127,0) 34%, rgba(16,25,56,0.5) 78%, rgba(11,16,40,0.78) 100%)",
};
