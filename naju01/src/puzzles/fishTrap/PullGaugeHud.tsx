import { useEffect, useRef, type CSSProperties } from "react";

import { GAUGE_HITS, GAUGE_ZONE, gaugeCursor, stopGauge, useGauge } from "./pullGauge";

// 반원 게이지 — 낚시 릴처럼 위로 휜 반투명 띠. 크림빛 막대가 띠를 따라 오가고 가운데 호박빛 칸에서 [E](소지품 · 안내판과 같은 빛깔)
const WIDTH = 380;
const HEIGHT = 150;
const CENTER_X = WIDTH / 2;
const CENTER_Y = 178;
const RADIUS = 150;
const BAND = 36;
/** 띠가 차지하는 각(도) — 위쪽 가운데를 중심으로 좌우 대칭 */
const ARC_DEGREES = 120;
const START_DEGREES = 270 - ARC_DEGREES / 2;

const angleAt = (t: number) => ((START_DEGREES + t * ARC_DEGREES) * Math.PI) / 180;
const pointAt = (t: number, radius = RADIUS) => ({
  x: CENTER_X + Math.cos(angleAt(t)) * radius,
  y: CENTER_Y + Math.sin(angleAt(t)) * radius,
});

function arcPath(from: number, to: number) {
  const a = pointAt(from);
  const b = pointAt(to);
  const large = (to - from) * ARC_DEGREES > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${b.x} ${b.y}`;
}

const BAND_PATH = arcPath(0, 1);
const ZONE_PATH = arcPath(0.5 - GAUGE_ZONE / 2, 0.5 + GAUGE_ZONE / 2);

function markerTransform(t: number) {
  const p = pointAt(t);
  return `translate(${p.x} ${p.y}) rotate(${START_DEGREES + t * ARC_DEGREES + 90})`;
}

/** 줄 당기기 게이지 — 화면 가운데 아래. 막대 자리는 매 프레임 직접 옮긴다(다시 그리지 않게) */
export default function PullGaugeHud() {
  const gauge = useGauge();
  const markerRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!gauge.active) return undefined;
    let frame = 0;
    const tick = () => {
      // 마우스 잠금이 풀리면(ESC) 그만둔다
      if (!document.pointerLockElement) {
        stopGauge();
        return;
      }
      markerRef.current?.setAttribute("transform", markerTransform(gaugeCursor(performance.now())));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [gauge.active]);

  if (!gauge.active) return null;
  const isHit = gauge.flash === "hit";
  return (
    <div style={wrapStyle}>
      <svg
        key={gauge.flashKey}
        className={gauge.flash === "miss" ? "naju-gauge-miss" : undefined}
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ overflow: "visible" }}
      >
        <defs>
          <linearGradient id="naju-gauge-zone" x1="0" x2="1">
            <stop offset="0" stopColor="#F2C89A" stopOpacity="0.45" />
            <stop offset="0.5" stopColor={isHit ? "#FFF1DA" : "#F2C89A"} stopOpacity={isHit ? 1 : 0.9} />
            <stop offset="1" stopColor="#F2C89A" stopOpacity="0.45" />
          </linearGradient>
        </defs>
        {/* 띠 — 반투명 판에 얇은 테두리 */}
        <path d={BAND_PATH} stroke="rgba(242,238,228,.45)" strokeWidth={BAND + 4} fill="none" strokeLinecap="butt" />
        <path d={BAND_PATH} stroke="rgba(16,20,26,.66)" strokeWidth={BAND} fill="none" strokeLinecap="butt" />
        {/* 목표 칸 */}
        <path d={ZONE_PATH} stroke="url(#naju-gauge-zone)" strokeWidth={BAND - 6} fill="none" />
        {/* 크림빛 막대 */}
        <g ref={markerRef} transform={markerTransform(0)}>
          <rect x={-6} y={-BAND / 2 - 6} width={12} height={BAND + 12} rx={6} fill="#F2EEE4" stroke="#2A2018" strokeWidth={1.5} />
        </g>
      </svg>
      <div style={labelStyle}>
        <span style={keyStyle}>E</span>
        {gauge.label} — 막대가 가운데 칸에 들어오면
      </div>
      <div style={dotsStyle}>
        {Array.from({ length: GAUGE_HITS }, (_, i) => (
          <span key={i} style={i < gauge.hits ? dotOnStyle : dotOffStyle} />
        ))}
      </div>
      <style>{`@keyframes najuGaugeShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}.naju-gauge-miss{animation:najuGaugeShake .2s}`}</style>
    </div>
  );
}

const FONT = '"Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif';

const wrapStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 70,
  transform: "translateX(-50%)",
  zIndex: 26,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  pointerEvents: "none",
};

const labelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginTop: -18,
  padding: "6px 12px 6px 6px",
  borderRadius: 999,
  background: "rgba(14,18,26,.72)",
  color: "#F2EEE4",
  font: `600 14px/1 ${FONT}`,
  whiteSpace: "nowrap",
};

const keyStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 22,
  height: 22,
  borderRadius: 6,
  background: "#F2C89A",
  color: "#2A2018",
  font: "700 12px/1 ui-monospace, Menlo, monospace",
};

const dotsStyle: CSSProperties = { display: "flex", gap: 8 };
const dotBase: CSSProperties = { width: 12, height: 12, borderRadius: "50%" };
// 맞춘 횟수 — 호박빛 구슬
const dotOnStyle: CSSProperties = { ...dotBase, background: "#F2C89A", boxShadow: "0 0 8px rgba(242,200,154,.6)" };
const dotOffStyle: CSSProperties = { ...dotBase, background: "rgba(242,238,228,.25)" };
