import { useEffect, useRef, type CSSProperties } from "react";

import { isGameFrozen } from "@/engine/input/gamePause";
import { useTouchMode } from "@/engine/input/touchMode";
import { isPointerActive } from "@/engine/input/virtualLock";

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
  // 휴대폰 — 당기기는 오른쪽 아래 ✋ 단추다(14회차)
  const isTouch = useTouchMode();
  const gauge = useGauge();
  const markerRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!gauge.active) return undefined;
    let frame = 0;
    const tick = () => {
      // 터치 모드에서 얼어 있으면(멈춤 · 창) 그만두지 않고 기다린다 — 풀리면 출발 시각이 그만큼 밀린다(pullGauge)
      if (isGameFrozen()) {
        frame = requestAnimationFrame(tick);
        return;
      }
      // 마우스 잠금이 풀리면(ESC) 그만둔다
      if (!isPointerActive()) {
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
    <div style={isTouch ? { ...wrapStyle, ...touchWrapStyle } : wrapStyle} data-hud="게이지">
      <svg
        key={gauge.flashKey}
        className={gauge.flash === "miss" ? "naju-gauge-miss" : undefined}
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={isTouch ? { overflow: "visible", width: "100%", height: "auto" } : { overflow: "visible" }}
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
      <div
        style={
          isTouch
            ? { ...labelStyle, maxWidth: "100%", whiteSpace: "normal", lineHeight: 1.3, textAlign: "center" }
            : labelStyle
        }
      >
        <span style={keyStyle}>{isTouch ? "✋" : "E"}</span>
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

// 휴대폰 — 380×150 고정이면 퍼즐 안내판(왼쪽 위) · 빠른 소지품(아래 가운데) · 동작 단추(오른쪽 아래)와 겹쳤다.
// 왼쪽 안내판(최대 300px · 40vw)과 오른쪽 동작 단추(약 194px) 사이 빈칸 가운데, 세로 가운데에 그 폭만큼 줄여 둔다(14회차)
const GAUGE_LEFT = "calc(env(safe-area-inset-left, 0px) + 20px + min(300px, 40vw))";
const GAUGE_RIGHT = "calc(100vw - env(safe-area-inset-right, 0px) - 202px)";
const touchWrapStyle: CSSProperties = {
  left: `calc((${GAUGE_LEFT} + ${GAUGE_RIGHT}) / 2)`,
  bottom: "auto",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: `min(300px, calc(${GAUGE_RIGHT} - ${GAUGE_LEFT}))`,
  // 짧은 화면에서 위 단추 줄 · 아래 빠른 소지품과 닿지 않게 높이도 묶는다
  maxHeight: "calc(100dvh - 150px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
  padding: 0,
  background: "none",
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
