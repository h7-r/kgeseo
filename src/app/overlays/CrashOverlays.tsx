import type { CSSProperties } from "react";

import { crashLog } from "@/debug/crashLog";

const gpuLostStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeContent: "center",
  textAlign: "center",
  gap: 4,
  background: "rgba(10,12,16,.92)",
  color: "#e8edf5",
  font: "600 17px/1.6 system-ui, -apple-system, sans-serif",
  zIndex: 50,
};

const titleStyle: CSSProperties = { font: "700 20px/1.4 system-ui, sans-serif", color: "#ffb4a8" };

const bodyStyle: CSSProperties = { fontSize: 13, opacity: 0.8, marginTop: 8, marginBottom: 14 };

const reportStyle: CSSProperties = {
  font: "12px/1.45 ui-monospace, Menlo, monospace",
  textAlign: "left",
  color: "#cfe0f5",
  background: "rgba(0,0,0,.5)",
  border: "1px solid #35405222",
  borderRadius: 6,
  padding: "10px 12px",
  margin: 0,
  maxWidth: "min(760px, 92vw)",
  maxHeight: "46vh",
  overflow: "auto",
  whiteSpace: "pre",
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  justifyContent: "center",
  marginTop: 14,
};

const buttonStyle: CSSProperties = {
  marginTop: 18,
  padding: "10px 18px",
  borderRadius: 8,
  border: "1px solid #3a4557",
  background: "#1b2230",
  color: "#cfe0f5",
  font: "600 14px system-ui, sans-serif",
  cursor: "pointer",
};

const sceneEmptiedStyle: CSSProperties = {
  position: "absolute",
  top: 12,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 60,
  padding: "8px 14px",
  borderRadius: 6,
  background: "rgba(140,40,32,.92)",
  color: "#ffe2dd",
  font: "600 13px/1.4 system-ui, sans-serif",
  pointerEvents: "none",
};

function copyReport() {
  navigator.clipboard
    .writeText(crashLog.report())
    .then(() => alert("복사됐습니다. 붙여넣어 보내주세요."))
    .catch(() => alert("복사 실패 — 화면을 캡처해 주세요."));
}

function reopenLight() {
  const url = new URL(location.href);
  url.searchParams.set("q", "low");
  location.href = url.toString();
}

interface CrashOverlaysProps {
  isGpuLost: boolean;
  isSceneEmptied: boolean;
}

/** 검은 화면만 남으면 원인을 알 수 없다 — GPU 끊김과 장면 꺼짐을 따로 알린다(원인이 완전히 다르다). */
export default function CrashOverlays({ isGpuLost, isSceneEmptied }: CrashOverlaysProps) {
  if (isGpuLost) {
    return (
      <div style={gpuLostStyle}>
        <div style={titleStyle}>GPU 연결이 끊어졌습니다</div>
        <div style={bodyStyle}>
          그래픽 드라이버가 브라우저와의 연결을 끊었습니다(컨텍스트 손실).
          <br />
          <strong>아래 기록을 캡처하거나 「기록 복사」를 눌러 개발자에게 보내주세요.</strong>
          <br />
          사고 직전 20초가 그대로 남아 있습니다.
        </div>
        {/* 사고 직전 기록이 원인을 가른다 */}
        <pre style={reportStyle}>{crashLog.report()}</pre>
        <div style={buttonRowStyle}>
          <button style={buttonStyle} onClick={copyReport}>
            기록 복사
          </button>
          <button style={buttonStyle} onClick={() => location.reload()}>
            새로고침
          </button>
          <button style={buttonStyle} onClick={reopenLight}>
            가벼운 모드로 다시 열기
          </button>
        </div>
      </div>
    );
  }
  if (isSceneEmptied) {
    return <div style={sceneEmptiedStyle}>⚠ 장면이 꺼졌습니다 (GPU는 정상) — 이 문구를 캡처해 주세요</div>;
  }
  return null;
}
