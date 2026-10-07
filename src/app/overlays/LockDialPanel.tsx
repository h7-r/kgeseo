import type { CSSProperties } from "react";

import { useLock, useLockControl } from "@/props/combinationLock";

const panelStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 42,
  transform: "translateX(-50%)",
  zIndex: 40,
  display: "grid",
  justifyItems: "center",
  gap: 10,
  pointerEvents: "none",
  textAlign: "center",
};

const rowsStyle: CSSProperties = { display: "flex", gap: 6 };

const rowStyle: CSSProperties = {
  minWidth: 30,
  padding: "5px 0",
  borderRadius: 5,
  border: "1px solid rgba(220,228,240,.25)",
  background: "rgba(16,20,28,.72)",
  color: "#dfe6f0",
  font: "700 19px/1.1 ui-monospace, Menlo, monospace",
};

const selectedRowStyle: CSSProperties = {
  ...rowStyle,
  border: "1px solid #ffd34d",
  background: "rgba(70,56,18,.9)",
  color: "#ffe9a8",
};

const guideStyle: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  background: "rgba(16,20,28,.72)",
  color: "#cfd8e6",
  font: "13px/1.4 system-ui, -apple-system, sans-serif",
};

/**
 * 자물쇠를 만지는 동안 지금 돌리는 칸과 키 안내. 숫자는 3D 자물쇠에서 읽게 하고 여기서는 키만 알려 준다.
 * App 에서 떼어 둔 이유: 다이얼을 App 이 구독하면 키 한 번에 App 과 Canvas 자식 전체가 다시 그려진다.
 */
export default function LockDialPanel() {
  const control = useLockControl();
  const lock = useLock(control?.id);
  if (!control || !lock) return null;
  return (
    <div style={panelStyle}>
      <div style={rowsStyle}>
        {lock.digits.map((digit, row) => (
          <span key={row} style={row === lock.selectedRow ? selectedRowStyle : rowStyle}>
            {lock.glyphs[row]?.[digit] ?? "?"}
          </span>
        ))}
      </div>
      <div style={guideStyle}>
        {lock.submitting
          ? "Backend에서 확인 중..."
          : lock.unlocked
            ? "열렸다 — [E] 로 소화전 문을 연다"
            : "← → 칸 고르기 · ↑ ↓ 숫자 돌리기(휠도 된다) · [E] 확인 · ESC 나가기"}
      </div>
    </div>
  );
}
