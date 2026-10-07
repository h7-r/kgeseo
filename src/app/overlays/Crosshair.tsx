import type { CSSProperties } from "react";

const crosshairStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: 5,
  height: 5,
  marginLeft: -2.5,
  marginTop: -2.5,
  borderRadius: "50%",
  background: "rgba(240,244,250,.55)",
  pointerEvents: "none",
};

/** 1인칭은 커서가 없으니 화면 한가운데가 커서다. */
export default function Crosshair() {
  return <div style={crosshairStyle} />;
}
