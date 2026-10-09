import type { ReactNode } from "react";
import type * as THREE from "three";
import { Html } from "@react-three/drei";

import { SHOW_DEV_LABELS } from "../../app/runtimeFlags";

interface DevLabelProps {
  position: THREE.Vector3 | [number, number, number];
  children: ReactNode;
  color?: string;
  background?: string;
  size?: number;
}

/**
 * 도면 점검용 이름표. 한글이 필요해서 3D 글자 대신 DOM 을 띄운다.
 * 평소엔 안 띄운다 — `?dev` 일 때만(Leva 「라벨」 저장값이 켜져 있어도 여기서 막는다).
 */
export default function DevLabel({
  position,
  children,
  color = "#F2F4F8",
  background = "rgba(20,24,34,.72)",
  size = 13,
}: DevLabelProps) {
  if (!SHOW_DEV_LABELS) return null;
  return (
    <Html position={position} center distanceFactor={26} zIndexRange={[10, 0]}>
      <div
        style={{
          pointerEvents: "none",
          whiteSpace: "nowrap",
          font: `600 ${size}px/1.3 "Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif`,
          color,
          background,
          border: "1px solid rgba(255,255,255,.14)",
          borderRadius: 4,
          padding: "2px 7px",
          transform: "translateY(-6px)",
        }}
      >
        {children}
      </div>
    </Html>
  );
}
