import type { CSSProperties } from "react";

const curtainStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#000",
  transition: "opacity 260ms ease",
  // 화면을 덮어도 클릭·마우스는 그대로 통과시킨다.
  pointerEvents: "none",
  zIndex: 50,
};

interface FadeCurtainProps {
  /** 0 투명 · 1 검정 */
  opacity: number;
}

/** 씬 전환용 검은 막. transition 으로만 움직여 자바스크립트가 매 프레임 끼어들지 않는다. */
export default function FadeCurtain({ opacity }: FadeCurtainProps) {
  return <div style={{ ...curtainStyle, opacity }} />;
}
