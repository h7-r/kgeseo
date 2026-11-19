/**
 * 쓸 일이 끝난 물건을 치운다 — 둥근 문이 열린 뒤에도 톱니돌 · 뜬 돌이 소지품에 남아 따라다니면 「아직 어디에 써야 하나」 헷갈린다
 * (미르 11/7 박람회판에서 정리 → 11/8 「본게임도 여전히 따라온다」). 박람회판 규칙과 같은 뜻을 본편에 새로 쓴 것.
 * 소지품 · 손 · 바닥 모두에서 치우고, 알림이 있는 규칙은 처음 치울 때 한 번만 알린다.
 */
import { recall } from "../save/puzzleMemory";
import { showNotice } from "./interaction";
import { inventory, type ItemKind } from "./inventory";
import { isBoxOpened } from "./ridge/boxPhase";
import { ridge } from "./ridge/ridgeState";

const remembered = (key: string) => recall<boolean>(key, false) === true;

interface SpentRule {
  /** 이 일이 끝났으면 */
  isSpent: () => boolean;
  kinds: ItemKind[];
  notice: string;
}

const RULES: SpentRule[] = [
  {
    isSpent: () => remembered("door.isOpen"),
    kinds: ["gearStone", "floatStone"],
    notice: "둥근 문이 열렸다 — 남은 톱니돌과 뜬 돌은 이제 쓸 데가 없어 두고 간다.",
  },
  { isSpent: () => remembered("chamber.isShone"), kinds: ["bigPearl"], notice: "" },
  { isSpent: () => ridge.isAtLeast("awakening"), kinds: ["scale"], notice: "" },
  { isSpent: isBoxOpened, kinds: ["bronzeKey", "letterBox"], notice: "" },
];
const told = new Set<SpentRule>();

/** 끝난 일의 물건이 남아 있으면 치운다(PuzzleWorld 가 0.5초마다 부른다) */
export function clearSpentItems() {
  for (const rule of RULES) {
    if (!rule.isSpent()) continue;
    let removed = 0;
    for (const kind of rule.kinds) {
      while (inventory.consume(kind)) removed++;
      if (inventory.hand()?.kind === kind) {
        inventory.releaseHand();
        removed++;
      }
      for (const item of inventory.world())
        if (item.kind === kind) {
          inventory.removeFromWorld(item.uid);
          removed++;
        }
    }
    if (removed > 0 && rule.notice && !told.has(rule)) {
      told.add(rule);
      showNotice(rule.notice, 4);
    }
  }
}
