/**
 * 앱 한 벌의 다리 — 동행 서버 대화(companionRuntime 의 companionDialog)를 대화창(dialogueRuntime)에 잇는다.
 * 앱이 뜰 때 한 번 부르고(app/App.tsx), 떼면 원래대로(서버 없이 FE 대화창만) 돌아간다.
 */
import { gameNow } from "@/engine/input/gameClock";

import { MOCK_SCENARIO, companionDialog, companionSession } from "../companion/companionRuntime";
import { helpLog } from "../progress/helpLog";
import {
  HINT_PUZZLE_IDS,
  PUZZLE_FOCUS_IDS,
  SEND_SITUATION,
  SITUATION_ZONE_IDS,
  STEP_FOCUS_IDS,
  createCompanionBridge,
  hintedPuzzleIdOf,
} from "./companionBridge.ts";
import { askOpenHint, isUnaskedTalkBlocked, sayCompanion, setHintProvider, setSituationSink } from "./dialogueRuntime";
import { OBJECTIVES, type ObjectiveId } from "./objectives.ts";

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
    // 퍼즐 폴링은 서버 판정 퍼즐(puzzleId 가 있는 목표) · 대응표 §5 대표 Object — 이 판에 정식 힌트가 있는지와 상관없다
    puzzleFocusIdOf: (objective) => (OBJECTIVES[objective].puzzleId ? (PUZZLE_FOCUS_IDS[objective] ?? null) : null),
    onAnswerSeen: () => helpLog.noteAnswerSeen(),
    // 퍼즐 폴링 1분 · 개입 뒤 쉬기(180초 · 600초) · 줄 수명은 게임 시계로 — 멈춤(ESC 메뉴 · 설정 · 소지품 · 시작 카드) 동안은
    // 흐르지 않는다. 실제 시계면 멈춘 시간이 「막혀 있는 시간」으로 쌓여 돌아오자마자 동행이 끼어들었다(미르 11/11 「그 시간만큼은 멈춰 있어야」).
    // 자물쇠 · 종이를 만지는 시간은 게임이 얼지 않아 그대로 센다
    now: gameNow,
    onRequestedHint: () => helpLog.noteAsked(),
    // 보낼 때는 canDisplay 가 막고(dialogueRuntime), 보낸 뒤 바빠졌으면(같은 조건) 도착한 넛지 대사를 버린다
    isBusy: isUnaskedTalkBlocked,
  });
  setHintProvider(bridge.hintProvider);
  setSituationSink(bridge.relay);
  return () => {
    bridge.dispose();
    setHintProvider(null);
    setSituationSink(null);
  };
}
