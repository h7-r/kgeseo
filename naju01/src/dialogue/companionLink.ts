/**
 * 앱 한 벌의 다리 — 동행 서버 대화(companionRuntime 의 companionDialog)를 대화창(dialogueRuntime)에 잇는다.
 * 앱이 뜰 때 한 번 부르고(app/App.tsx), 떼면 원래대로(서버 없이 FE 대화창만) 돌아간다.
 */
import { companionDialog } from "../companion/companionRuntime";
import { HINT_PUZZLE_IDS, SEND_SITUATION, SITUATION_ZONE_IDS, createCompanionBridge } from "./companionBridge.ts";
import { askOpenHint, sayCompanion, setHintProvider, setSituationSink } from "./dialogueRuntime";

export function connectCompanionDialogue(): () => void {
  const bridge = createCompanionBridge({
    dialog: companionDialog,
    say: sayCompanion,
    askOpenHint,
    sendSituation: SEND_SITUATION,
    serverPuzzleIdOf: (objective) => HINT_PUZZLE_IDS[objective] ?? null,
    zoneIdOf: (stage) => SITUATION_ZONE_IDS[stage] ?? null,
  });
  setHintProvider(bridge.hintProvider);
  setSituationSink(bridge.relay);
  return () => {
    bridge.dispose();
    setHintProvider(null);
    setSituationSink(null);
  };
}
