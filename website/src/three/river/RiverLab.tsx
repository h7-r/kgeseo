import { useEffect, useState, type CSSProperties } from "react";

import { JOURNEY_SECTIONS, journeyInput, sectionAtProgress } from "./journey";
import RiverScene from "./RiverScene";

// 개발 서버 전용 시험 화면(/__river). 홈을 건드리지 않고 장면만 띄워 진행도를 손으로 돌린다.
// main.tsx 가 import.meta.env.DEV 일 때만 불러 배포본에는 코드째 빠진다.

declare global {
  interface Window {
    __river?: { set: (progress: number) => void };
  }
}

export default function RiverLab() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    journeyInput.progress = progress;
    journeyInput.section = sectionAtProgress(progress);
  }, [progress]);

  useEffect(() => {
    window.__river = { set: setProgress };
    return () => {
      delete window.__river;
    };
  }, []);

  const section = JOURNEY_SECTIONS[sectionAtProgress(progress)].id;

  return (
    <div style={rootStyle}>
      <RiverScene followHome={false} />
      <div style={panelStyle}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={progress}
          onChange={(event) => setProgress(Number(event.target.value))}
          style={{ width: "100%" }}
        />
        <span>
          {progress.toFixed(3)} · {section}
        </span>
      </div>
    </div>
  );
}

const rootStyle: CSSProperties = { position: "fixed", inset: 0, background: "#01040a" };

const panelStyle: CSSProperties = {
  position: "fixed",
  left: 24,
  right: 24,
  bottom: 18,
  display: "flex",
  gap: 16,
  alignItems: "center",
  font: "13px/1 monospace",
  color: "#9fb2ea",
  zIndex: 1,
};
