import { useEffect, useRef, type CSSProperties } from "react";

import { GAUGE_HITS, gaugeCursor, stopGauge, useGauge } from "./pullGauge";

// 반원 게이지 — 낚시 릴처럼 위로 휜 반투명 띠. 잿빛 막대가 잿빛 띠를 따라 오가고 흰 칸에서 [E]
// 칸은 판마다 좁아지고 옮겨 가지만 빛깔은 세 판 다 같은 흰색(판마다 달라 보이면 규칙이 바뀐 줄 안다)
/** 띠·막대의 잿빛 — 로딩 글의 회색과 같다 */
const GREY = "#9AA3B4";
const WHITE = "#FFFFFF";
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
  const start = pointAt(from);
  const end = pointAt(to);
  const large = (to - from) * ARC_DEGREES > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${end.x} ${end.y}`;
}

const BAND_PATH = arcPath(0, 1);
/** 판마다 한 줄 — 칸이 바뀌는 것을 알려 준다 */
const ROUND_NOTES = ["막대가 흰 칸에 들어오면", "칸이 좁아졌다 — 더 정확히", "칸이 옆으로 옮겨 갔다 — 더 빨리"];

function markerTransform(t: number) {
  const point = pointAt(t);
  return `translate(${point.x} ${point.y}) rotate(${START_DEGREES + t * ARC_DEGREES + 90})`;
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
  const zonePath = arcPath(gauge.center - gauge.zone / 2, gauge.center + gauge.zone / 2);
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
            <stop offset="0" stopColor={WHITE} stopOpacity="0.5" />
            <stop offset="0.5" stopColor={WHITE} stopOpacity="0.95" />
            <stop offset="1" stopColor={WHITE} stopOpacity="0.5" />
          </linearGradient>
        </defs>
        {/* 띠 — 잿빛 테두리에 반투명 판 */}
        <path d={BAND_PATH} stroke={GREY} strokeOpacity={0.7} strokeWidth={BAND + 4} fill="none" strokeLinecap="butt" />
        <path d={BAND_PATH} stroke="rgba(16,20,26,.66)" strokeWidth={BAND} fill="none" strokeLinecap="butt" />
        {/* 목표 칸 */}
        <path d={zonePath} stroke="url(#naju-gauge-zone)" strokeWidth={BAND - 6} fill="none" />
        {/* 잿빛 막대 */}
        <g ref={markerRef} transform={markerTransform(0)}>
          <rect
            x={-6}
            y={-BAND / 2 - 6}
            width={12}
            height={BAND + 12}
            rx={6}
            fill={GREY}
            stroke="#2A2018"
            strokeWidth={1.5}
          />
        </g>
      </svg>
      <div style={labelStyle}>
        <span style={keyStyle}>E</span>
        {gauge.label} — {ROUND_NOTES[Math.min(gauge.hits, ROUND_NOTES.length - 1)]}
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
// 맞춘 횟수 — 흰 구슬, 남은 칸은 잿빛
const dotOnStyle: CSSProperties = { ...dotBase, background: WHITE, boxShadow: "0 0 8px rgba(255,255,255,.55)" };
const dotOffStyle: CSSProperties = { ...dotBase, background: GREY, opacity: 0.45 };
