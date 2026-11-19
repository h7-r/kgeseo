// 0단계 성능 측정 패널 — Canvas 밖(DOM). 시작 단추·진행 상태·결과를 보여 준다.
import { useState } from "react";

import { MEASURE_SECONDS, perfStore, toRecordRow, usePerfState, type PerfPhase } from "./perfStore";

const PANEL_STYLE = {
  position: "fixed",
  left: 12,
  top: 12,
  zIndex: 10000,
  width: 300,
  padding: "10px 12px",
  borderRadius: 8,
  background: "rgba(16, 18, 22, 0.88)",
  color: "#e8e8e8",
  font: "12px/1.5 system-ui, sans-serif",
  pointerEvents: "auto",
} as const;

const BUTTON_STYLE = {
  marginTop: 8,
  marginRight: 6,
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid #666",
  background: "#2a2f37",
  color: "#fff",
  cursor: "pointer",
} as const;

function phaseText(phase: PerfPhase, ready: number, bots: number, remaining: number | null): string {
  switch (phase) {
    case "idle":
      return "준비 — [측정 시작]을 누르세요";
    case "requested":
    case "settling":
      return "자리 잡는 중";
    case "spawning":
      return `가짜 아바타 불러오는 중 ${ready}/${bots}`;
    case "warming":
      return `예열 중 ${remaining ?? ""}초`;
    case "measuring":
      return `측정 중 ${remaining ?? ""}초 — 마우스·키보드를 만지지 마세요`;
    case "done":
      return "끝 — 결과를 복사해 기록표에 붙이세요. 다시 재려면 시크릿 창을 모두 닫고 새로 여세요";
  }
}

const show = (value: number, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : "—");

export default function PerfPanel() {
  const { phase, bots, readyBots, remainingSeconds, result } = usePerfState();
  const [copied, setCopied] = useState(false);
  // 다른 기기에서 http://<맥 IP> 로 열면 보안 출처가 아니라 클립보드가 막힌다 — 그때는 글상자로 보여 준다
  const [manualText, setManualText] = useState<string | null>(null);

  const copy = async () => {
    if (!result) return;
    const row = toRecordRow(result);
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(row);
      setCopied(true);
    } catch {
      setCopied(false);
      setManualText(row);
    }
  };

  return (
    <div style={PANEL_STYLE} data-lobby-perf-panel>
      <strong>로비 성능 예비 측정 · 개발용</strong>
      <div>
        나 + 가짜 아바타 {bots}명 · 측정 {MEASURE_SECONDS}초
      </div>
      <div style={{ marginTop: 4, color: "#ffd479" }}>{phaseText(phase, readyBots, bots, remainingSeconds)}</div>
      {result && (
        <table style={{ marginTop: 6, borderCollapse: "collapse", width: "100%" }}>
          <tbody>
            <tr>
              <td>평균 FPS</td>
              <td>{show(result.averageFps)}</td>
            </tr>
            <tr>
              <td>p95 프레임</td>
              <td>{show(result.p95FrameMs)} ms</td>
            </tr>
            <tr>
              <td>가장 긴 프레임</td>
              <td>{show(result.maxFrameMs)} ms</td>
            </tr>
            <tr>
              <td>50ms 넘은 프레임</td>
              <td>{result.framesOver50ms}개</td>
            </tr>
            <tr>
              <td>등장 때 가장 긴 프레임</td>
              <td>{result.spawnMaxFrameMs === null ? "—" : `${show(result.spawnMaxFrameMs)} ms`}</td>
            </tr>
            <tr>
              <td>화면 · dpr</td>
              <td>
                {result.canvas} · {result.dpr}
              </td>
            </tr>
            <tr>
              <td>GPU</td>
              <td style={{ wordBreak: "break-all" }}>{result.gpu}</td>
            </tr>
          </tbody>
        </table>
      )}
      <div>
        <button type="button" style={BUTTON_STYLE} disabled={phase !== "idle"} onClick={perfStore.requestStart}>
          측정 시작
        </button>
        {result && (
          <button type="button" style={BUTTON_STYLE} onClick={copy}>
            {copied ? "복사됨" : "결과 복사"}
          </button>
        )}
      </div>
      {manualText && (
        <textarea
          readOnly
          value={manualText}
          onFocus={(event) => event.currentTarget.select()}
          style={{ marginTop: 6, width: "100%", height: 64, fontSize: 11 }}
          aria-label="측정 결과 한 줄 — 선택해서 복사"
        />
      )}
    </div>
  );
}
