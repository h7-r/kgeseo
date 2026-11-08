/**
 * 터치 모드에서 세로면 게임 전체를 덮는 회전 안내 — 첫 로딩 · 오프닝 · 캐릭터 생성 · 게임 씬 모두(11/7 미르).
 * 본편 · 나주 main 에 라우터 밖으로 한 번씩 둔다. 로딩 영상 막(z 100000)보다 위.
 * 덮는 동안 로딩 영상 · 음악은 막 쪽이 스스로 멈추고(landscape.isMediaHeld), 게임 씬은 MobileGate 가 멈춘다.
 * 가로로 돌아오면 덮개만 걷는다 — 멈춤 표시는 「눌러서 계속」으로만 풀린다(가로 복귀가 멈춤을 대신 풀지 않는다).
 * 리액트가 뜨기 전의 첫 화면은 index.html 의 같은 안내(#boot-rotate)가 맡는다.
 */
import type { CSSProperties } from "react";

import { useLandscapeState } from "./landscape";

export function LandscapeGuard() {
  const { isBlocked } = useLandscapeState();
  if (!isBlocked) return null;
  return (
    <div style={coverStyle} role="alertdialog" aria-label="가로로 돌려 주세요">
      <div style={iconStyle} aria-hidden="true">
        ⟲
      </div>
      <div style={titleStyle}>가로로 돌려 주세요</div>
      <div style={bodyStyle}>이 게임은 가로 화면에서 플레이합니다.</div>
    </div>
  );
}

const coverStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100001,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
  background: "#01040a",
  color: "#F2EEE4",
  fontFamily: "sans-serif",
  textAlign: "center",
  touchAction: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
};

const iconStyle: CSSProperties = { fontSize: 56, lineHeight: 1 };
const titleStyle: CSSProperties = { fontSize: 24, fontWeight: 700, letterSpacing: -0.3 };
const bodyStyle: CSSProperties = { fontSize: 15, opacity: 0.75 };
