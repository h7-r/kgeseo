import type { CSSProperties } from "react";

export interface LoadingProgress {
  done: number;
  total: number;
  label: string;
  phase: "fetching" | "building";
}

interface LoadingCoverProps {
  progress: LoadingProgress;
  /** 씬이 그려졌다 — 덮개가 흐려진다 */
  isFading: boolean;
}

/** 에셋을 받는 동안·씬을 세우는 동안 덮는다(app/prefetch) */
export default function LoadingCover({ progress, isFading }: LoadingCoverProps) {
  const ratio = progress.total ? progress.done / progress.total : 0;
  const text =
    progress.phase === "fetching"
      ? `에셋 받는 중 ${progress.done} / ${progress.total}${progress.label ? ` · ${progress.label}` : ""}`
      : "지형을 세우는 중… 잠시만 기다려 주세요";
  return (
    <div style={{ ...coverStyle, opacity: isFading ? 0 : 1 }}>
      <div style={textBoxStyle}>
        <div style={titleStyle}>NAJU-01</div>
        <div style={barStyle}>
          {progress.phase === "fetching" ? (
            <div style={{ ...barFillStyle, width: `${Math.round(ratio * 100)}%` }} />
          ) : (
            // 씬을 세우는 동안은 주 스레드가 바빠 화면이 멎는다 — transform 애니메이션은 합성 스레드에서 돌아 그동안에도 움직인다.
            // 가득 찬 막대 + 멈춘 글만 있으면 「멈췄다 · 렉」으로 읽혔다(베타 11/13 「지역 이동할 때 버벅인다」)
            <div style={barSlideStyle} />
          )}
        </div>
        <style>{SLIDE_KEYFRAMES}</style>
        <div style={captionStyle}>{text}</div>
      </div>
    </div>
  );
}

const coverStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  // Leva(1000) 위
  zIndex: 3000,
  display: "grid",
  placeItems: "center",
  background: "#141014",
  color: "#E6EBF4",
  transition: "opacity .4s ease",
  pointerEvents: "none",
  overflow: "hidden",
};

const textBoxStyle: CSSProperties = {
  position: "relative",
  display: "grid",
  gap: 10,
  justifyItems: "center",
  minWidth: 260,
};

const titleStyle: CSSProperties = {
  font: '600 22px/1.2 "Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif',
  letterSpacing: 4,
  color: "#E8EFFA",
};

const barStyle: CSSProperties = {
  width: 260,
  height: 4,
  borderRadius: 2,
  background: "rgba(255,255,255,.12)",
  overflow: "hidden",
};

const barFillStyle: CSSProperties = {
  height: "100%",
  background: "#8FE3B0",
  transition: "width .25s ease",
};

const SLIDE_KEYFRAMES = `@keyframes naju-loading-slide { from { transform: translateX(-100%); } to { transform: translateX(260%); } }`;

const barSlideStyle: CSSProperties = {
  width: "40%",
  height: "100%",
  borderRadius: 2,
  background: "#8FE3B0",
  animation: "naju-loading-slide 1.1s linear infinite",
  willChange: "transform",
};

const captionStyle: CSSProperties = {
  font: '13px/1.5 ui-monospace, Menlo, "Malgun Gothic", monospace',
  color: "#9AA3B4",
};
