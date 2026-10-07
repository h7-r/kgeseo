import type { CSSProperties, ReactNode } from "react";

const buttonStyle: CSSProperties = {
  position: "fixed",
  top: 14,
  zIndex: 60,
  padding: "8px 12px",
  border: "1px solid rgba(255,255,255,.24)",
  borderRadius: 8,
  background: "rgba(13,17,24,.82)",
  color: "#f4f6fb",
  font: "600 12px/1 system-ui, sans-serif",
  cursor: "pointer",
};

interface TopBarButtonProps {
  /** 화면 오른쪽에서 떨어진 거리(px). Leva 패널(오른쪽 약 280px)에 가리지 않게 둔다. */
  right: number;
  onClick: () => void;
  ariaLabel?: string;
  children: ReactNode;
}

/** 오른쪽 위 작은 단추(⚙ 설정 · [V] 시점) */
export default function TopBarButton({ right, onClick, ariaLabel, children }: TopBarButtonProps) {
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} style={{ ...buttonStyle, right }}>
      {children}
    </button>
  );
}
