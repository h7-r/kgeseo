/**
 * 동행 대화의 한 벌뿐인 실행 상태 — 대화창 저장소 · 상황 판정 · 대사 고르기를 엮는다. 화면은 여기 것만 쓴다.
 * 안내판 설명을 어느 퍼즐까지 들려줬는지도 여기서 기억한다(같은 설명을 다가갈 때마다 되풀이하지 않게).
 */
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";

import { getUnderwater } from "../puzzles/cave/caveState";
import { createDialogueStore, type Speech } from "./dialogueStore.ts";
import { SENT_BACK_KEY, createDirector } from "./director.ts";
import {
  currentObjective,
  currentZoneCode,
  hintPhase,
  isDialogueBlocked,
  isQuietTime,
  observeGame,
} from "./gameObserver";
import { inCompanionVoice } from "./gameVoice.ts";
import { PANEL_OBJECTIVE, SENT_BACK_NOTICE, type ObjectiveId } from "./objectives.ts";
import { setTone, type Tone } from "./lines.ts";
import { IS_DRAFT_LINES_VISIBLE } from "./previewMode";
import { createSituationWatcher, type Situation } from "./situations.ts";

/** 대화창 이름 줄 — 동행 캐릭터 이름은 아직 정해지지 않았다(PM 결정 대기). 세진 님 companion 쪽과 같은 자리 표시 */
export const COMPANION_NAME = "동행";

interface Panel {
  title: string;
  rule: string;
  rows?: { label: string; value: string }[];
}

export const dialogue = createDialogueStore();
const watcher = createSituationWatcher();

/** 지금 떠 있는 안내판 — 화면이 넣어 준다. [F] 의 첫 대답이 이 설명이다 */
let panel: Panel | null = null;
/** 걷기 시작하기 전(불러오는 화면 · 시작 대기)에는 말하지 않고 모아 둔다 */
let hasStarted = false;
dialogue.setHeld(true);

/**
 * 반말 · 존댓말을 처음에 묻는가. 계약(v0.4.16 §9): 베타는 해요체 존댓말 한 벌이라 묻기 · 바꾸기를 끈다.
 * 반말 대사는 보관만 한다 — 말투 계약이 생기면 true 로 바꾸면 묻기 · 바꾸기가 그대로 살아난다.
 */
const IS_TONE_CHOICE_ENABLED = false;
const GREETED_KEY = "naju.dialogue.greeted";
const TONE_KEY = "naju.dialogue.tone";

const director = createDirector({
  store: dialogue,
  guideOf: (objective) => (panel && PANEL_OBJECTIVE[panel.title] === objective ? inCompanionVoice(panel.rule) : null),
  onSpoken: () => watcher.noteSpoken(performance.now() / 1000),
  phaseHint: hintPhase,
  canChooseTone: IS_TONE_CHOICE_ENABLED,
  onTone: (tone) => localStorage.setItem(TONE_KEY, tone),
  // 물속에서 마우스가 풀리면 못 움직이는 사이 숨이 준다
  canFreeCursor: () => !getUnderwater(),
  // 초안 대사는 미리 보기에서만 — 배포판의 동행 대사는 서버 승인 원문뿐이다(계약 §9, previewMode)
  showDraftLines: IS_DRAFT_LINES_VISIBLE,
  log: (line, situation) => {
    if (import.meta.env.DEV) console.debug(`[동행] ${situation} · ${line.id}`);
  },
});

/** 안내판 줄의 수 — 「2 / 3」은 [2, 3], 「1」은 [1, null] */
function countOf(value: string): [number, number | null] | null {
  const match = /^(\d+)(?:\s*\/\s*(\d+))?/.exec(value);
  return match ? [Number(match[1]), match[2] ? Number(match[2]) : null] : null;
}

/** 남은 수를 동행이 말해 주는 줄 — 빠르게 오르내리는 수(따라 한 차례 · 고리 안 물고기)는 말하지 않는다 */
const QUIET_ROWS = new Set(["따라 한 차례", "고리 안"]);
const PINCH_ROW = "꼬집힘";
const lastCounts = new Map<string, number>();

/** 안내판의 수가 올랐으면 동행이 말한다 — 「둘 남았어요」. 처음 본 수는 기준일 뿐이다 */
function tellProgress(next: Panel) {
  const objective = PANEL_OBJECTIVE[next.title] ?? null;
  for (const row of next.rows ?? []) {
    const count = countOf(row.value);
    if (!count || QUIET_ROWS.has(row.label)) continue;
    const key = `${next.title}|${row.label}`;
    const before = lastCounts.get(key);
    lastCounts.set(key, count[0]);
    if (before === undefined || count[0] <= before || !hasStarted) continue;
    if (row.label === PINCH_ROW) director.pinched(count[0]);
    else if (count[1] !== null && count[1] > count[0]) director.progress(objective, count[1] - count[0]);
  }
}

/**
 * 안내판이 바뀌었다. 풀이 설명은 먼저 읊지 않는다 — 플레이어가 「여기서 뭘 해야 해요?」를 고를 때 말한다.
 * 여기서는 하나 해낼 때마다 남은 수만 알려 준다.
 */
export function setDialoguePanel(next: Panel | null) {
  const hasLeft = next?.title !== panel?.title;
  panel = next;
  if (hasLeft) dialogue.retract("guide");
  if (next) tellProgress(next);
}

/** 게임이 알림을 띄웠다 — 동행이 제 말투로 그 말을 한다 */
export function sayNotice(text: string) {
  watcher.noteEvent(performance.now() / 1000);
  // 되돌려짐 알림에는 동행의 말이 곧 뒤따른다 — 같은 key 를 달아 그 말이 이 알림 자리에 들어서게 한다
  const key = text.startsWith(SENT_BACK_NOTICE) ? SENT_BACK_KEY : undefined;
  dialogue.say({ kind: "notice", text: inCompanionVoice(text), key });
}

/** 처음 걷기 시작했다 — 모아 둔 말을 시작한다. 인사는 탭마다 한 번, 말투는 처음 한 번만 묻는다 */
export function startDialogue() {
  if (hasStarted) return;
  hasStarted = true;
  const saved = IS_TONE_CHOICE_ENABLED ? readTone() : "polite";
  if (saved && sessionStorage.getItem(GREETED_KEY)) return void setTone(saved);
  sessionStorage.setItem(GREETED_KEY, "1");
  void director.begin(saved);
}

function readTone(): Tone | null {
  const saved = localStorage.getItem(TONE_KEY);
  return saved === "polite" || saved === "casual" ? saved : null;
}

/** 상황 · 구역을 서버로 보내는 곳(companionBridge.relay) — 동행 서버 세션이 있을 때만 붙는다 */
type SituationSink = (situation: Situation | null, zoneCode: string | null) => void;
let situationSink: SituationSink | null = null;
export function setSituationSink(sink: SituationSink | null) {
  situationSink = sink;
}

/** 0.5초마다 — 게임 상태를 읽어 상황이 생겼으면 동행이 말한다(미리 보기 초안) · 서버에 알린다(한 길 — companionBridge) */
export function tickDialogue() {
  dialogue.setHeld(!hasStarted || isDialogueBlocked());
  if (!hasStarted) return;
  const situation = watcher.observe(observeGame(panel));
  if (situation) director.handle(situation);
  situationSink?.(situation, currentZoneCode());
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
  if (dialogue.advance()) return true;
  if (dialogue.getState() || !isPlaying || isDialogueBlocked() || isQuietTime()) return false;
  void director.openMenu(currentObjective(panel));
  return true;
}

/** 첫 물건을 얻었다 — 꺼내 드는 법을 한 번만 알려 준다 */
let hasExplainedItems = false;
export function explainFirstItem() {
  if (hasExplainedItems) return;
  hasExplainedItems = true;
  director.firstItem();
}

/** 보기를 고르지 않고 다시 걷기 시작했다 — 보기를 거둔다(그대로 두면 뒤의 말이 전부 갇힌다) */
export function dropMenu() {
  if (dialogue.getState()?.speech.freeCursor) dialogue.declineAsk();
}
export const setHintProvider = director.setHintProvider;

export const useDialogue = () => useSyncExternalStore(dialogue.subscribe, dialogue.getState);

exposeDevHook("najuDialogue", {
  start: startDialogue,
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
