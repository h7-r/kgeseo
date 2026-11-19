/**
 * 튜토리얼 공간(비밀 복도)에서 얻는 쪽지 — 첫 쪽지 · 캔음료 쪽지 · 자판기 힌트 메모 · 밸브 자물쇠 힌트 · 정답 확인.
 * 본부실에 처음 들어서면 힌트함에서 지운다(미르 11/10 「튜토리얼은 한 번 지나가는 구간」). 쪽지에는 출처 칸이 없어 id 로 고른다 —
 * 튜토리얼 공간에 쪽지를 새로 두면 여기에도 넣는다.
 * 힌트함은 저장되지 않아 다시 접속하면 비어 있다. 본부실 뒤로는 이 쪽지들이 다시 들어오는 길이 없다(문이 잠기고 · 전원 · 밸브는 처음 상태).
 */
import { discardHints } from "@/game/hintBox";
import { VALVE_HELP_HINT_IDS } from "@/game/valveHelp";
import { discardDrink, getHeldDrink } from "@/props/drinkState";
import { VALVE_HINT, storeHintPaper } from "@/props/hintPaperState";

import { TUTORIAL_NOTE_IDS } from "./firstHint";

export const TUTORIAL_HINT_IDS: readonly string[] = [...TUTORIAL_NOTE_IDS, VALVE_HINT.id, ...VALVE_HELP_HINT_IDS];

/**
 * 힌트함에서 튜토리얼 공간 쪽지만 지운다. 다른 쪽지는 그대로.
 * 자판기 힌트 메모(실물)를 손에 든 채 들어왔으면 그것도 거둔다 — 들고 [H] 를 누르면 힌트함에 다시 들어갔다(Codex 리뷰)
 */
export function discardTutorialHints() {
  if (getHeldDrink()?.kind === "paper") {
    storeHintPaper(); // 실물은 없어진 것으로(바닥 · 자판기로 돌아가지 않는다)
    discardDrink();
  }
  return discardHints(TUTORIAL_HINT_IDS);
}
