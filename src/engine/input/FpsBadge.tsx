/**
 * 실기기 측정용 프레임 표시 — 주소에 ?fps 를 붙이면 오른쪽 위 단추 줄 아래에 뜬다.
 *
 * 숫자: 지금 fps(최근 1초) · 평균 · 하위 1%(가장 느린 1% 프레임 시간의 평균을 fps 로) · 측정 시간 · 끊김(100ms 넘는 프레임) 수.
 * 얼어 있는 동안(멈춤 · 창)은 재지 않는다. 표시를 누르면 처음부터 다시 잰다 — 60초 재고 숫자를 적는다.
 * 계획서 11절 · 코덱스 구현 01회차 5절의 측정 방식.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { isGameFrozen } from "./gamePause";

const STALL_MS = 100;
/** 「지금 fps」를 낼 최근 구간 */
const RECENT_MS = 1000;

interface Stats {
  now: number;
  average: number;
  low1: number;
  seconds: number;
  stalls: number;
}

function summarize(frames: number[], recent: number[], totalMs: number, stalls: number): Stats {
  const recentMs = recent.reduce((a, b) => a + b, 0);
  const now = recent.length && recentMs > 0 ? (recent.length * 1000) / recentMs : 0;
  const average = frames.length ? (frames.length * 1000) / totalMs : 0;
  let low1 = 0;
  if (frames.length >= 20) {
    const sorted = [...frames].sort((a, b) => b - a);
    const count = Math.max(1, Math.floor(sorted.length / 100));
    const slowest = sorted.slice(0, count);
    low1 = 1000 / (slowest.reduce((a, b) => a + b, 0) / count);
  }
  return { now, average, low1, seconds: totalMs / 1000, stalls };
}

export function FpsBadge() {
  const [stats, setStats] = useState<Stats>({ now: 0, average: 0, low1: 0, seconds: 0, stalls: 0 });
  const resetRef = useRef(() => {});

  useEffect(() => {
    let frames: number[] = [];
    let recent: number[] = [];
    let totalMs = 0;
    let stalls = 0;
    let last = performance.now();
    let lastShown = last;
    let raf = 0;
    resetRef.current = () => {
      frames = [];
      recent = [];
      totalMs = 0;
      stalls = 0;
    };
    // 얼었거나 숨겨져 있던 뒤의 첫 간격은 「멈춘 시간」이라 버린다. 플레이 중의 긴 끊김(1초 넘어도)은 그대로 센다
    let skipNext = true;
    const tick = (time: number) => {
      const dt = time - last;
      last = time;
      const isPausedNow = isGameFrozen() || document.visibilityState === "hidden";
      if (isPausedNow) {
        skipNext = true;
      } else if (skipNext) {
        skipNext = false;
      } else if (dt > 0) {
        frames.push(dt);
        recent.push(dt);
        totalMs += dt;
        if (dt > STALL_MS) stalls += 1;
        let recentMs = recent.reduce((a, b) => a + b, 0);
        while (recent.length > 1 && recentMs - recent[0] >= RECENT_MS) recentMs -= recent.shift()!;
      }
      if (time - lastShown > 500) {
        lastShown = time;
        setStats(summarize(frames, recent, totalMs, stalls));
      }
      raf = requestAnimationFrame(tick);
    };
    // 숨김 동안은 rAF 가 한 번도 안 돌 수 있다 — 숨김 · 복귀 자체에서 다음 간격을 버리게 표시한다
    const markSkip = () => {
      skipNext = true;
    };
    document.addEventListener("visibilitychange", markSkip);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", markSkip);
    };
  }, []);

  return (
    <button type="button" data-audit-ignore="진단용(?fps)" style={badgeStyle} onClick={() => resetRef.current()}>
      {stats.now.toFixed(0)} fps · 평균 {stats.average.toFixed(1)} · 하위1% {stats.low1.toFixed(1)} ·{" "}
      {stats.seconds.toFixed(0)}초 · 끊김 {stats.stalls}
    </button>
  );
}

// 오른쪽 위 단추 줄(높이 44 + 위 여백 12) 바로 아래 — 위쪽 가운데 빈칸은 667 폭 · 노치 가로에서 0 보다 좁아져
// 글자가 한 자씩 세로로 쌓였다(HUD 검사 2판). 오른쪽 아래 조작 묶음보다 한참 위라 겹치지 않는다(시험용 표시)
const badgeStyle: CSSProperties = {
  position: "fixed",
  right: "calc(env(safe-area-inset-right) + 12px)",
  top: "calc(env(safe-area-inset-top) + 64px)",
  maxWidth: 200,
  wordBreak: "keep-all",
  textAlign: "right",
  zIndex: 1100,
  padding: "4px 8px",
  border: "none",
  borderRadius: 6,
  background: "rgba(0,0,0,0.6)",
  color: "#9FE870",
  // 시험용 진단 표시(?fps) — 12px 로 읽히게(14회차, 예전 10). 모바일 기본 검사에서는 진단용 예외로 뺀다(data-audit-ignore)
  font: "12px/1.3 ui-monospace, monospace",
  pointerEvents: "auto",
};
