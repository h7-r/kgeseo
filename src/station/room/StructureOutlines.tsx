import { Outlines } from "@react-three/drei";

import { OUTLINE_COLOR, OUTLINE_THICKNESS } from "@/engine/toon";

/**
 * 방 구조물(몰딩·모서리 기둥·부축기둥·구조 기둥)의 선. Leva 「방 구조물(선)」 폴더 값이다.
 * JSX 로 바로 만든 지오라 참조가 없어 주름선은 못 걸고 외곽선만 둘린다.
 */
export interface StructureOutline {
  outline: boolean;
  outlineWidth: number;
  outlineColor: string;
  /** 걸레받이·허리몰딩·코니스에도 선을 두를지 */
  moldingOutline: boolean;
}

/** 기둥류 외곽선. 값을 안 주면 기본 굵기·색으로 두른다. */
export default function StructureOutlines({ outline }: { outline?: StructureOutline }) {
  if (outline?.outline === false) return null;
  return (
    <Outlines thickness={outline?.outlineWidth ?? OUTLINE_THICKNESS} color={outline?.outlineColor ?? OUTLINE_COLOR} />
  );
}
