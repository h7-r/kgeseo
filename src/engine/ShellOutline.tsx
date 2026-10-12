import { Outlines } from "@react-three/drei";

import type { OutlineValues } from "@/engine/toon";

interface ShellOutlineProps {
  outline?: OutlineValues | null;
}

/** 부모 메시에 drei 외곽선만 두른다(주름선 없음). 선이 꺼져 있으면 아무것도 안 그린다. */
export default function ShellOutline({ outline }: ShellOutlineProps) {
  if (!outline?.outline) return null;
  return <Outlines thickness={outline.outlineWidth} color={outline.outlineColor} />;
}
