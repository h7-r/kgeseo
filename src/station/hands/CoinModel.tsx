import type { OutlineValues } from "@/engine/toon";
import Coin from "@/props/Coin";
import type { CoinKind } from "@/props/coinState";

/** Leva 「동전」 중 동전 모양에 쓰는 값 */
export interface CoinLook {
  canColor: string;
  canPatternColor: string;
  cupColor: string;
  cupPatternColor: string;
  coinSize: number;
  coinThickness: number;
}

interface CoinModelProps {
  kind: CoinKind;
  look: CoinLook;
  outline?: OutlineValues | null;
  /** 바닥에 눕힌 자세. 놓기 미리보기는 눕혀야 원판 중심이 바닥에 박히지 않는다. */
  isLying?: boolean;
}

/** 손에 들거나 날아가는 동전 한 닢. 종류에 따라 무늬·색을 고른다. */
export default function CoinModel({ kind, look, outline, isLying = false }: CoinModelProps) {
  const isCan = kind === "can";
  return (
    <Coin
      position={[0, 0, 0]}
      pattern={kind}
      color={isCan ? look.canColor : look.cupColor}
      patternColor={isCan ? look.canPatternColor : look.cupPatternColor}
      radius={look.coinSize}
      thickness={look.coinThickness}
      isLying={isLying}
      outline={outline}
    />
  );
}
