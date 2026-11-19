/** 모바일 배경 — 3D 강 · 깊은 공간 대신 정지 그라디언트(휴대폰 GPU · 배터리 · 데이터) */
import type { CSSProperties } from "react";

export default function MobileBackdrop() {
  return <div aria-hidden="true" style={style} />;
}

const style: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 0,
  pointerEvents: "none",
  background:
    "radial-gradient(120% 60% at 85% 10%, rgba(46,72,137,0.28) 0%, rgba(1,4,10,0) 60%), " +
    "radial-gradient(90% 50% at 0% 90%, rgba(50,82,150,0.16) 0%, rgba(1,4,10,0) 60%), #01040a",
};
