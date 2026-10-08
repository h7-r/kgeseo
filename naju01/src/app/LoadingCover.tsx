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
  fading: boolean;
}

/** 에셋을 받는 동안·씬을 세우는 동안 덮는다(app/prefetch) */
export default function LoadingCover({ progress, fading }: LoadingCoverProps) {
  const ratio = progress.total ? progress.done / progress.total : 0;
  const text =
    progress.phase === "fetching"
      ? `에셋 받는 중 ${progress.done} / ${progress.total}${progress.label ? ` · ${progress.label}` : ""}`
      : "지형을 세우는 중…";
  return (
    <div style={{ ...coverStyle, opacity: fading ? 0 : 1 }}>
      <div style={textBoxStyle}>
        <div style={titleStyle}>NAJU-01</div>
        <div style={barStyle}>
          <div style={{ ...barFillStyle, width: `${Math.round(ratio * 100)}%` }} />
        </div>
        <div style={captionStyle}>{text}</div>
      </div>
    </div>
  );
}

const coverStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  // Leva(1000)·계기판(20) 위
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

const captionStyle: CSSProperties = {
  font: '12px/1.5 ui-monospace, Menlo, "Malgun Gothic", monospace',
  color: "#9AA3B4",
};
