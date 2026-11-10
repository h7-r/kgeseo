/**
 * 동행 대화의 한 벌뿐인 실행 상태 — 대화창 저장소 · 상황 판정 · 대사 고르기를 엮는다. 화면은 여기 것만 쓴다.
 *
 * 새 main 위에 다시 만들며 #52 에서 바꾼 것(미르 11/9 · Codex 01회차):
 *  - 게임 알림 · 퍼즐 안내판은 지금처럼 따로 둔다 — 동행이 그 말을 따라 하지 않는다(sayNotice · 남은 수 · 게 물림 말 뺌).
 *    알림 · 안내판 수는 상황 판정의 신호로만 읽는다(gameObserver.noteNotice · notePanel).
 *  - 첫 인사(말투 묻기 · 조작 안내) · 첫 물건 안내는 하지 않는다 — 첫 입장 소개는 CompanionIntro(클로즈업)가 맡는다.
 *  - 장면 인물(아비사 · 어부 · 동행 소개)이 차례를 잡았거나 다른 창이 떠 있으면 동행 말은 멈추고 줄을 선다(syncDialogueHold).
 *  - 동행을 끈 판(?npc=off · ?npc 샌드박스 · 검수)은 [F] 도 상황 판정도 없다 — 대화창은 장면 인물 말만 그린다(Codex 리뷰 e649b7d).
 */
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { gameClearTimeout, gameSetTimeout } from "@/engine/input/gameClock";
import { isTouchMode } from "@/engine/input/touchMode";
import { isPointerActive } from "@/engine/input/virtualLock";

import { isCompanionIntro } from "../companion/companionStage";
import { getUnderwater } from "../puzzles/cave/caveState";
import { helpLog } from "../progress/helpLog";
import { isOtherWindowHeld } from "../puzzles/pointerHold";
import { isTalkTaken } from "../scene/firstScene/npcSpeech";
import { createDialogueStore, type Speech } from "./dialogueStore.ts";
import { createDirector } from "./director.ts";
import {
  currentObjective,
  currentZoneCode,
  hintPhase,
  isDialogueBlocked,
  isQuietTime,
  observeGame,
} from "./gameObserver";
import { inCompanionVoice } from "./gameVoice.ts";
import { PANEL_OBJECTIVE, type ObjectiveId } from "./objectives.ts";
import { hasDraftLines, setTone } from "./lines.ts";
import { loadDraftLines } from "./previewMode";
import { createSituationWatcher, type Situation } from "./situations.ts";
import { IS_COMPANION_ACTIVE } from "./talkButton";

/** 대화창 이름 줄 — 동행 캐릭터 이름은 아직 정해지지 않았다(PM 결정 대기). 세진 님 companion 쪽과 같은 자리 표시 */
export const COMPANION_NAME = "동행";
/** [F] 보기를 고르는 동안 마우스를 풀어 두는 붙듦(pointerHold) 이름 — 「다른 창」 판정에서 뺀다 */
export const MENU_HOLD_ID = "npc-dialogue-menu";

// 승인 대기 초안은 개발 · 미리 보기 빌드에서만 올라온다(운영 번들에는 없다)
void loadDraftLines();

interface Panel {
  title: string;
  rule: string;
  rows?: { label: string; value: string }[];
}

// 쪽 · 물음 시간은 게임 시계로 — 터치에서 창 때문에 「전부 멈춤」인 동안 말이 흘러가지 않게(companionRuntime 과 같다)
export const dialogue = createDialogueStore({
  setTimer: (run, ms) => gameSetTimeout(run, ms),
  clearTimer: (handle) => gameClearTimeout(handle as number),
});
const watcher = createSituationWatcher();

/** 지금 떠 있는 안내판 — 화면이 넣어 준다. [F] 의 첫 대답이 이 설명이다 */
let panel: Panel | null = null;
/** 걷기 시작하기 전(불러오는 화면 · 시작 대기)에는 말하지 않고 모아 둔다 */
let hasStarted = false;
dialogue.setHeld(true);

/**
 * 반말 · 존댓말을 묻는가. 계약(v0.4.16 §9): 베타는 해요체 존댓말 한 벌이라 묻기 · 바꾸기를 끈다(반말 대사는 보관만).
 * 말투 계약이 생기면 true 로 바꾸면 [F] 보기의 말투 바꾸기가 살아난다.
 */
const IS_TONE_CHOICE_ENABLED = false;
const TONE_KEY = "naju.dialogue.tone";
setTone("polite");

const director = createDirector({
  store: dialogue,
  guideOf: (objective) => (panel && PANEL_OBJECTIVE[panel.title] === objective ? inCompanionVoice(panel.rule) : null),
  onSpoken: () => watcher.noteSpoken(performance.now() / 1000),
  // [F] 로 청한 도움 — 도움 별(미르 11/11)
  onHelpAsked: () => helpLog.noteAsked(),
  phaseHint: hintPhase,
  canChooseTone: IS_TONE_CHOICE_ENABLED,
  onTone: (tone) => localStorage.setItem(TONE_KEY, tone),
  // 물속에서 마우스가 풀리면 못 움직이는 사이 숨이 준다. 터치는 잠금을 풀지 않고 보기 단추를 바로 누른다
  canFreeCursor: () => !getUnderwater() && !isTouchMode(),
  // 초안 대사는 올라왔을 때만(개발 · 미리 보기 빌드) — 배포판의 동행 대사는 서버 승인 원문뿐이다(계약 §9, previewMode)
  showDraftLines: hasDraftLines,
  log: (line, situation) => {
    if (import.meta.env.DEV) console.debug(`[동행] ${situation} · ${line.id}`);
  },
});

/**
 * 안내판이 바뀌었다. 풀이 설명은 먼저 읊지 않는다 — 플레이어가 「여기서 뭘 해야 해요?」를 고를 때 말한다.
 * 안내판은 화면에 그대로 있으니 남은 수도 동행이 따라 말하지 않는다.
 */
export function setDialoguePanel(next: Panel | null) {
  const hasLeft = next?.title !== panel?.title;
  panel = next;
  if (hasLeft) dialogue.retract("guide");
}

/** 게임이 알림을 띄웠다 — 동행이 따라 말하지는 않고, 방금 무슨 일이 있었다고만 적는다(먼저 거는 말을 미루게) */
export function noteGameNotice() {
  watcher.noteEvent(performance.now() / 1000);
}

/** 처음 걷기 시작했다 — 모아 둔 말을 시작한다(인사는 CompanionIntro 가 한다) */
export function startDialogue() {
  if (hasStarted) return;
  hasStarted = true;
  syncDialogueHold();
}

/**
 * 동행 말을 멈출 때 — 걷기 전 · 연출 · 읽는 창 · 다른 창(소지품 · 설정 · 힌트함 · 입력) · 장면 인물이 차례를 잡음 · 첫 소개.
 * 제 [F] 보기의 붙듦은 「다른 창」이 아니다(MENU_HOLD_ID).
 */
const shouldHold = () =>
  !hasStarted || isDialogueBlocked() || isOtherWindowHeld(MENU_HOLD_ID) || isTalkTaken() || isCompanionIntro();

/** 멈춤을 지금 상태로 맞춘다 — 0.5초 판정 말고도 장면 인물 차례가 바뀌는 순간 · 창이 열리고 닫히는 순간 부른다 */
export function syncDialogueHold() {
  dialogue.setHeld(shouldHold());
}

/**
 * 지금 동행 말을 화면에 낼 수 있나 — 아니면 상황 · 구역 진입을 서버에 보내지 않는다(계약 v0.4.16 §11-2).
 * 멈춤 조건에 더해 동행 물음 · 보기가 떠 있는 동안(대화 중) · 조작을 놓은 동안도 낼 수 없는 때다.
 */
const canDisplayCompanion = () => !shouldHold() && isPointerActive() && dialogue.getState()?.speech.kind !== "ask";

/** 상황 · 구역을 서버로 보내는 곳(companionBridge.relay) — 동행 서버 세션이 있을 때만 붙는다 */
type SituationSink = (
  situation: Situation | null,
  zoneCode: string | null,
  canDisplay: boolean,
  objective: ObjectiveId | null,
) => void;
let situationSink: SituationSink | null = null;
export function setSituationSink(sink: SituationSink | null) {
  situationSink = sink;
}

/** 0.5초마다 — 게임 상태를 읽어 상황이 생겼으면 동행이 말한다(미리 보기 초안) · 서버에 알린다(한 길 — companionBridge) */
export function tickDialogue() {
  syncDialogueHold();
  // 동행을 끈 판은 동행이 먼저 말할 일도 서버에 알릴 일도 없다(장면 인물 말은 npcSpeech 가 따로 한다)
  if (!hasStarted || !IS_COMPANION_ACTIVE) return;
  const sight = observeGame(panel);
  const situation = watcher.observe(sight);
  if (situation) director.handle(situation);
  // 지금 목표도 넘긴다 — 서버 퍼즐이면 1분마다 그 퍼즐을 가리켜 BE 퍼즐 자동 개입이 돌게 한다(companionBridge 퍼즐 폴링)
  situationSink?.(situation, currentZoneCode(), canDisplayCompanion(), sight.objective);
}

/** 서버가 준 동행의 말을 대화창에 올린다 — 동행이 방금 말했으니 한동안 먼저 말 걸지 않게 적는다 */
export function sayCompanion(speech: Speech) {
  dialogue.say(speech);
  watcher.noteSpoken(performance.now() / 1000);
}

/** 서버가 힌트를 권했다 — 열지 Y/N 으로 묻는다 */
export const askOpenHint = director.askOpenHint;

/** [F] — 떠 있는 말이 있으면 넘기고, 없으면 동행에게 말을 건다(물어볼 것 고르기) */
export function pressTalkKey(isPlaying: boolean) {
  // 동행을 끈 판(?npc=off 등)에는 말을 걸 동행이 없다
  if (!IS_COMPANION_ACTIVE) return false;
  // 장면 인물이 말하는 동안 · 첫 소개 · 다른 창이 떠 있는 동안은 동행이 끼어들지 않는다(그 말은 E 로 넘긴다)
  if (shouldHold()) return false;
  if (dialogue.advance()) return true;
  if (dialogue.getState() || !isPlaying || isQuietTime()) return false;
  void director.openMenu(currentObjective(panel));
  return true;
}

/** 보기를 고르지 않고 다시 걷기 시작했다 — 보기를 거둔다(그대로 두면 뒤의 말이 전부 갇힌다) */
export function dropMenu() {
  if (dialogue.getState()?.speech.freeCursor) dialogue.declineAsk();
}
export const setHintProvider = director.setHintProvider;

export const useDialogue = () => useSyncExternalStore(dialogue.subscribe, dialogue.getState);

exposeDevHook("najuDialogue", {
  start: startDialogue,
  held: shouldHold,
  canDisplay: canDisplayCompanion,
  drafts: hasDraftLines,
  /** 말투를 바로 바꾼다(검사용) — 저장하지 않는다 */
  tone: setTone,
  state: dialogue.getState,
  say: (text: string, kind: "line" | "notice" | "guide" | "hint" = "line") => dialogue.say({ kind, text }),
  ask: (text: string, labels: string[] = ["응", "아니"]) =>
    dialogue.ask({ text, choices: labels.map((label, index) => ({ id: String(index), label })) }),
  answer: dialogue.answer,
  advance: dialogue.advance,
  menu: (objective?: ObjectiveId) => director.openMenu(objective ?? currentObjective(panel)),
  help: (objective?: ObjectiveId) => director.help(objective ?? currentObjective(panel)),
  situation: (situation: Situation) => director.handle(situation),
  objective: () => currentObjective(panel),
  observe: () => observeGame(panel),
});
