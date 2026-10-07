import type { CSSProperties } from "react";

import { heldDrink, useDrink } from "@/props/drinkState";
import { NEAR_TARGET, type NearTarget } from "@/station/layout/passage";
import { PALETTE } from "@/station/layout/dimensions";

const hintStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 40,
  transform: "translateX(-50%)",
  color: "#2C3444",
  font: "600 15px sans-serif",
  background: PALETTE.gold,
  padding: "8px 16px",
  borderRadius: 20,
  pointerEvents: "none",
};

interface ActionHintProps {
  near: NearTarget;
}

/**
 * 화면 아래 안내문. 겨냥한 물건은 스스로 빛나므로 글로 적지 않는다.
 * 남는 건 빛낼 대상이 없는 이동, 그리고 손에 든 것에 키가 둘 이상 걸린 때(쪽지: [E] 와 [H] 가 다른 일)뿐이다.
 */
export default function ActionHint({ near }: ActionHintProps) {
  // 판 번호만 구독한다. 집고 버리는 순간에만 바뀌어 자주 다시 그려지지 않는다.
  useDrink();
  const hint =
    heldDrink()?.kind === "paper"
      ? "[H] 힌트함에 넣기   ·   [E] 내려놓기"
      : near === NEAR_TARGET.trainExit
        ? "[E] 기차에서 내리기"
        : "";
  if (!hint) return null;
  return <div style={hintStyle}>{hint}</div>;
}
