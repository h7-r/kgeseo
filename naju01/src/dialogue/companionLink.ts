/**
 * 앱 한 벌의 다리 — 동행 서버 대화(companionRuntime 의 companionDialog)를 대화창(dialogueRuntime)에 잇는다.
 * 앱이 뜰 때 한 번 부르고(app/App.tsx), 떼면 원래대로(서버 없이 FE 대화창만) 돌아간다.
 */
import { MOCK_SCENARIO, companionDialog, companionSession } from "../companion/companionRuntime";
import {
  HINT_PUZZLE_IDS,
  PUZZLE_FOCUS_IDS,
  SEND_SITUATION,
  SITUATION_ZONE_IDS,
  STEP_FOCUS_IDS,
  createCompanionBridge,
  hintedPuzzleIdOf,
} from "./companionBridge.ts";
import { askOpenHint, sayCompanion, setHintProvider, setSituationSink } from "./dialogueRuntime";
import type { ObjectiveId } from "./objectives.ts";

/** 세션이 고정한 판의 정식 힌트만 연다. 개발 모의 서버(?npc-mock, 개발 빌드만)는 어느 퍼즐이든 힌트를 주므로 공식 ID 그대로 */
function serverHintPuzzleIdOf(objective: ObjectiveId): string | null {
  if (MOCK_SCENARIO !== null) return HINT_PUZZLE_IDS[objective] ?? null;
  const status = companionSession.getStatus();
  return hintedPuzzleIdOf(objective, status.phase === "ready" ? status : null);
}

export function connectCompanionDialogue(): () => void {
  const bridge = createCompanionBridge({
    dialog: companionDialog,
    say: sayCompanion,
    askOpenHint,
    sendSituation: SEND_SITUATION,
    serverPuzzleIdOf: serverHintPuzzleIdOf,
    zoneIdOf: (stage) => SITUATION_ZONE_IDS[stage] ?? null,
    focusIdOf: (objective) => STEP_FOCUS_IDS[objective] ?? null,
    // 퍼즐 폴링은 공식 서버 퍼즐 ID 가 있는 퍼즐 — 이 판에 정식 힌트가 있는지(serverHintPuzzleIdOf)와 상관없다
    puzzleFocusIdOf: (objective) => (HINT_PUZZLE_IDS[objective] ? (PUZZLE_FOCUS_IDS[objective] ?? null) : null),
  });
  setHintProvider(bridge.hintProvider);
  setSituationSink(bridge.relay);
  return () => {
    bridge.dispose();
    setHintProvider(null);
    setSituationSink(null);
  };
}
