/**
 * 종이 읽기 — 궤 속 낡은 종이를 손에 들고 읽는 화면(Canvas 밖 DOM). 왼쪽 가장자리에 작게 떠서 가운데 장면을 가리지 않고,
 * [E] · [Esc] 로 내려놓는다. 열려 있는 동안 [E] 는 여기서 받아 다른 것에 안 닿는다
 */
import { useEffect, useMemo, type CSSProperties } from "react";

import { setKeyInterceptor } from "../interaction";
import { closePaper, getOldPaperCanvas, usePaperOpen } from "./oldPaper";

export default function PaperReadHud() {
  const isOpen = usePaperOpen();
  const src = useMemo(() => (isOpen ? getOldPaperCanvas().toDataURL("image/png") : ""), [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    setKeyInterceptor(() => {
      closePaper();
      return true;
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape") closePaper();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      setKeyInterceptor(null);
      window.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  if (!isOpen) return null;
  return (
    <div style={backdropStyle}>
      <img src={src} alt="궤 속 낡은 종이" style={paperStyle} draggable={false} />
      <div style={hintStyle}>
        <span style={keyStyle}>H</span> 힌트함에 넣기 <span style={{ opacity: 0.5 }}>·</span>{" "}
        <span style={keyStyle}>E</span> 내려놓기
      </div>
    </div>
  );
}

const FONT = '"Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif';

const backdropStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 30,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  justifyContent: "center",
  gap: 14,
  padding: "0 0 0 3vw",
  // 왼쪽 띠만 어둡다 — 오른쪽 장면은 그대로 보인다
  background: "linear-gradient(90deg, rgba(6,5,4,.78) 0%, rgba(6,5,4,.55) 26%, rgba(6,5,4,0) 44%)",
  pointerEvents: "none",
};

const paperStyle: CSSProperties = {
  width: "min(26vw, 380px)",
  maxHeight: "48vh",
  objectFit: "contain",
  transform: "rotate(-1.2deg)",
  boxShadow: "0 30px 60px rgba(0,0,0,.6), 0 0 0 1px rgba(242,238,228,.08)",
  filter: "brightness(1.05)",
};

const hintStyle: CSSProperties = {
  marginLeft: 6,
  color: "rgba(242,238,228,.78)",
  font: `600 13px/1 ${FONT}`,
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const keyStyle: CSSProperties = {
  padding: "4px 7px",
  borderRadius: 5,
  background: "#F2C89A",
  color: "#2A2018",
  font: "700 11px/1 ui-monospace, Menlo, monospace",
};
