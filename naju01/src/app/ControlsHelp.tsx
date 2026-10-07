import type { CSSProperties } from "react";

/** (?dev) 조작 안내 — 잠그기 전에만 화면 아래에 뜬다 */
export default function ControlsHelp() {
  return (
    <div style={helpStyle}>
      <b>[T] 시작</b> · WASD 이동 · Shift 달리기 · Space 점프 · C 앉기 · ESC 나가기 · <b>[V] 1·3인칭 전환</b> ·{" "}
      <b>[E] 편집</b> · <b>[H] 계기판 숨기기</b>
      <br />
      <span style={mutedStyle}>
        3인칭에서 마우스로 캐릭터 앞·뒤를 자유롭게 회전 · [1][2][3] V1·V2·V3 시점으로 이동(개발용)
        <br />
        [L] Leva 패널 · 낙하하면 마지막 안전 지점으로 복귀
        <br />
        Leva 아래쪽 「절벽높이·차단물높이·눈높이·FOV·걷기속도」가 문서 §9 의 미결값입니다 — 돌려 보고 정한 값은{" "}
        <b>공간도면.js 에 박아야</b> 팀에 전달됩니다
      </span>
    </div>
  );
}

const mutedStyle: CSSProperties = { color: "#8B94A6" };
const helpStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 18,
  transform: "translateX(-50%)",
  zIndex: 20,
  padding: "8px 14px",
  borderRadius: 8,
  background: "rgba(14,18,26,.7)",
  color: "#E6EBF4",
  font: '12.5px/1.6 "Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif',
  textAlign: "center",
  pointerEvents: "none",
};
