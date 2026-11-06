import type { CSSProperties } from "react";

import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

interface ComingSoonChipProps {
  /** 기본은 「출시 예정」. 서버를 기다리는 기능은 「준비 중」. */
  label?: string;
  /** 놓인 자리의 글 크기에 맞출 때만 덧씌운다. */
  style?: CSSProperties;
}

/** 아직 열리지 않은 것에 붙이는 점선 딱지. */
export default function ComingSoonChip({ label = COMING_SOON_LABEL, style }: ComingSoonChipProps) {
  // 출시 예정은 사이트 경고 빨강으로 눈에 띄게 한다. 「준비 중」 같은 다른 말은 그대로 흐리게 둔다.
  const toneStyle = label === COMING_SOON_LABEL ? comingSoonToneStyle : null;
  return <span style={{ ...chipStyle, ...toneStyle, ...style }}>{label}</span>;
}

const COMING_SOON_LABEL = "출시 예정";

const comingSoonToneStyle: CSSProperties = {
  color: COLOR.danger,
  borderColor: "rgba(248,113,113,0.45)",
};

const chipStyle: CSSProperties = {
  padding: "4px 10px",
  borderRadius: "999px",
  border: "1px dashed #3a4258",
  fontFamily: FONT.mono,
  fontSize: "13px",
  color: COLOR.textDim,
  whiteSpace: "nowrap",
  flexShrink: 0,
};
