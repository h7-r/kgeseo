/**
 * 대화창 한 벌 — 화면 아래 가운데에 동행 · 장면 인물의 말이 모두 뜬다(Canvas 밖 DOM, 계약 v0.4.16 §10 「대화창 한 벌」, 미르 11/9).
 *
 * 전에는 세 벌이었다 — 동행 서버 자막(CompanionHud), 장면 인물 상자(NpcSpeechHud), 해랑 #52 의 동행 대화창. 이제 하나다.
 *   장면 인물(아비사 · 어부 · 동행 소개)   npcSpeech 그대로 — 차례 · 멈춤 · 클로즈업 연출은 그쪽이 정하고 여기서는 그리기만 한다.
 *                                        인물이 차례를 잡은 동안 동행 말은 줄 서서 기다린다(dialogueRuntime.syncDialogueHold).
 *   동행                                  서버 대사 · 힌트 · 힌트 제안(companionBridge) · [F] 보기 · 미리 보기 초안(dialogueStore).
 * 이름 줄에는 늘 말하는 사람 이름이 있다. 게임 알림 · 퍼즐 안내판은 대화창이 아니라 지금처럼 따로 뜬다(Codex 01회차).
 *
 * 키: [F] 말 넘기기 · 말 걸기(터치는 위 단추 줄 💬 가 같은 키), 물음은 [Y] [N] · 숫자. 장면 인물(아비사 · 어부 · 동행 소개) 말도 [F] —
 *  겨누거나 다가가지 않아도 넘어간다(미르 11/11, 계약 §10-2 「말 거는 키는 F 하나」). 터치는 창 안 「다음」 단추도.
 * 플레이어가 건 보기([F])는 데스크톱에서 마우스를 풀어 눌러서도 고른다 — 푸는 · 다시 잡는 일은 나주 pointerHold 의 「창」 붙듦이라
 * ESC 두 단계(81b1484)와 같은 길이다. 터치는 잠금을 풀지 않고, 보기 단추가 터치 조작층(TouchHud, z 900) 위에 떠 바로 눌린다.
 * 터치 자리는 빠른 칸과 같은 빈칸 — 이동 스틱 자리(왼쪽 40%)와 오른쪽 동작 단추 묶음 사이. 창이 뜨면 빠른 칸은 비켜 숨는다.
 * 창 윗변 높이를 `--npc-speech-top` 으로 알린다 — 동행 소개 클로즈업 구도 · 겨냥 알림(InteractionHud)이 읽는다.
 * 동행 말은 길면 쪽으로 넘어간다(paginate). 장면 인물 말은 제 시간에 넘어가므로 쪽을 나누지 않고 줄을 늘린다(Codex 01회차).
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { useKeyLabels } from "@/engine/input";
import { addPointerActiveListener, isPointerActive } from "@/engine/input/virtualLock";
import { isBlockedByPauseMenu } from "@/game/pauseMenuState";

import { useCompanionChatOpen } from "../companion/chatOpen";
import { subscribeNoticePosted } from "../puzzles/interaction";
import { beginHold, endHold, subscribePointerHolds } from "../puzzles/pointerHold";
import { usePuzzlePanel } from "../puzzles/puzzlePanel";
import {
  NPC_SPEECH_TOP_VAR,
  setSpeechBoxShown,
  subscribeTalkOwner,
  useNpcSpeech,
  useTalkTaken,
  type NpcSpeech,
} from "../scene/firstScene/npcSpeech";
import { DIALOGUE_TIMING, pageDurationMs, type ShownSpeech } from "./dialogueStore.ts";
import {
  COMPANION_NAME,
  MENU_HOLD_ID,
  dialogue,
  dropMenu,
  noteGameNotice,
  pressTalkKey,
  setDialoguePanel,
  startDialogue,
  switchTalkKey,
  syncDialogueHold,
  tickDialogue,
  useDialogue,
} from "./dialogueRuntime";
import { noteNotice, notePanel } from "./gameObserver";

import { useLineBreaks } from "./useLineBreaks";
import "./dialogue.css";

const TICK_MS = 500;
/** 한 쪽 줄 수 — 터치는 키가 작아 세 줄. 낱말 단위로 줄이 바뀌어 줄 끝이 조금씩 비므로 여유를 둔다 */
const PAGE_LINES = { desktop: 4, touch: 3 };
const LINE_FILL = 0.85;
/** 창 너비에서 글이 못 쓰는 폭 — 안쪽 여백 · 테두리 · 얼굴 · 사이 간격(dialogue.css) */
const BOX_CHROME_PX = { desktop: 96, touch: 28 };

const isTypingInField = (target: EventTarget | null) =>
  /INPUT|TEXTAREA|SELECT/.test((target as HTMLElement | null)?.tagName ?? "");

/** 선택지를 고르는 키 — 예 · 아니오 둘이면 Y · N, 그 밖에는 숫자 */
const choiceKeys = (count: number, numbered = false) =>
  count === 2 && !numbered ? ["Y", "N"] : Array.from({ length: count }, (_, index) => String(index + 1));

/** 글자 크기(px) — dialogue.css 의 clamp 와 같은 셈. 한 쪽에 들어가는 글자 수를 잴 때 쓴다 */
const fontPx = (isTouch: boolean) => {
  const vw = window.innerWidth / 100;
  return isTouch ? Math.min(16, Math.max(14, 0.8 * vw + 8)) : Math.min(22, Math.max(17, 0.9 * vw + 10));
};

/** 터치 키 이름 — 공용 표(keyLabels)에 없는 [F] 는 나주에서만 💬(본편 [F] 는 다른 뜻이라 공용 표에 넣지 않는다) */
const touchTalkKey = (text: string) => text.replace(/\[F\]/g, "[💬]");

export default function DialogueLayer() {
  const shown = useDialogue();
  const npc = useNpcSpeech();
  const isTalkTaken = useTalkTaken();
  const panel = usePuzzlePanel();
  const labels = useKeyLabels();
  const isChatOpen = useCompanionChatOpen();
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const typingRef = useRef<FinishTyping | null>(null);
  const isTouch = labels.isTouch;

  // 장면 인물 말이 먼저다. 인물이 차례만 잡고 아직 첫 줄 전이면 동행 말도 내린다(차례가 바뀌는 순간 바로 멈춘다)
  const npcShown = npc && !isChatOpen ? npc : null;
  const companionShown = !npcShown && !isTalkTaken && !isChatOpen ? shown : null;
  const isShown = !!npcShown || !!companionShown;

  // 안내판 → [F] 「여기서 뭘 해야 해요?」의 대답 · 상황 판정의 진전 신호
  useEffect(() => {
    setDialoguePanel(panel);
    notePanel(panel);
  }, [panel]);
  useEffect(() => () => setDialoguePanel(null), []);

  // 알림 → 상황 판정의 신호(틀림 · 풀림 · 되돌려짐)만. 동행이 따라 말하지 않는다 — 알림은 제자리에 그대로 뜬다.
  // 화면에 뜬 때가 아니라 게임이 쏜 순간에 센다 — 대화창이 떠 있는 동안 알림은 줄을 서서 늦게 뜨거나 밀렸다 다시 뜬다(#78)
  useEffect(
    () =>
      subscribeNoticePosted((text) => {
        noteNotice(text);
        noteGameNotice();
      }),
    [],
  );

  // 상황 판정
  useEffect(() => {
    const timer = window.setInterval(tickDialogue, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // 장면 인물 차례 · 다른 창이 바뀌는 순간 동행 말을 멈추거나 잇는다(0.5초 판정을 기다리지 않는다)
  useEffect(() => {
    const offOwner = subscribeTalkOwner(syncDialogueHold);
    const offHolds = subscribePointerHolds(syncDialogueHold);
    return () => {
      offOwner();
      offHolds();
    };
  }, []);
  useEffect(syncDialogueHold, [isChatOpen]);

  // 걷기 시작하면(마우스 잠금 · 터치 가상 잠금) 동행이 말을 시작한다. 보기를 고르지 않고 다시 잡았으면 보기를 거둔다
  useEffect(
    () =>
      addPointerActiveListener(() => {
        if (!isPointerActive()) return;
        startDialogue();
        dropMenu();
      }),
    [],
  );

  // 창 너비 → 한 쪽에 들어가는 글자 수(동행 말만 쪽으로 나눈다)
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const measure = () => {
      const mode = isTouch ? "touch" : "desktop";
      const perLine = (root.clientWidth - BOX_CHROME_PX[mode]) / fontPx(isTouch);
      dialogue.setCapacity(perLine * PAGE_LINES[mode] * LINE_FILL);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(root);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isTouch]);

  // 플레이어가 건 보기([F])는 마우스를 풀어 눌러서 고를 수 있게 한다 — 나주 「창」 붙듦이라 닫히면 하던 조작으로 다시 잡는다.
  // 터치는 잠금을 풀지 않는다(보기 단추를 바로 누른다 — director 가 freeCursor 를 주지 않는다)
  const isMenuOpen = !!companionShown?.speech.freeCursor && !isTouch;
  useEffect(() => {
    if (!isMenuOpen) return undefined;
    beginHold(MENU_HOLD_ID, "window");
    return () => endHold(MENU_HOLD_ID);
  }, [isMenuOpen]);

  const answer = useCallback((choiceId: string) => {
    dialogue.answer(choiceId);
  }, []);

  // 키 — 캡처 단계에서 받아, 대답에 쓴 Y · N · 숫자가 게임 단축키(빠른 칸)로 새지 않게 한다
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || isTypingInField(event.target)) return;
      // 멈춤 메뉴가 떠 있는 동안은 대화를 넘기거나 보기를 고르지 않는다(나주입장 08회차)
      if (isBlockedByPauseMenu(event.code)) return;
      const state = dialogue.getState();
      const choices = state?.speech.kind === "ask" && isLastPage(state) ? (state.speech.choices ?? []) : [];
      if (choices.length > 0) {
        const key = event.code.replace(/^Key|^Digit|^Numpad/, "");
        const index = choiceKeys(choices.length, state?.speech.numbered).indexOf(key);
        if (index >= 0) {
          event.stopImmediatePropagation();
          event.preventDefault();
          answer(choices[index].id);
          return;
        }
        // 말을 건 보기는 Esc 로 물린다(마우스가 이미 풀려 있어 Esc 가 여기까지 온다) — 닫히면 붙듦이 풀려 조작으로 돌아간다
        if (event.code === "Escape" && state?.speech.freeCursor) {
          event.stopImmediatePropagation();
          dialogue.declineAsk();
          return;
        }
      }
      if (event.code !== "KeyF") return;
      // 다른 인물을 겨눴으면 그쪽으로 바꾸고, 아니면 글자가 찍히는 중이면 먼저 다 보여 준다
      const handled =
        switchTalkKey(isPointerActive()) || typingRef.current?.() || pressTalkKey(isPointerActive());
      if (handled) event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [answer]);

  // 창이 떠 있나(터치 빠른 칸이 비킨다) · 창 윗변 높이(줄 수 · 화면 크기에 따라 바뀐다)
  useLayoutEffect(() => {
    setSpeechBoxShown(isShown);
    return () => setSpeechBoxShown(false);
  }, [isShown]);
  const shownKey = npcShown ? `npc-${npcShown.key}` : companionShown ? `talk-${companionShown.serial}` : "";
  useLayoutEffect(() => {
    const root = document.documentElement;
    const box = boxRef.current;
    if (!isShown || !box) {
      root.style.removeProperty(NPC_SPEECH_TOP_VAR);
      return undefined;
    }
    const update = () => {
      const stage = rootRef.current?.offsetParent?.getBoundingClientRect();
      const rect = box.getBoundingClientRect();
      const bottom = stage ? stage.bottom : window.innerHeight;
      root.style.setProperty(NPC_SPEECH_TOP_VAR, `${Math.ceil(bottom - rect.top)}px`);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(box);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty(NPC_SPEECH_TOP_VAR);
    };
  }, [isShown, shownKey]);

  const toScreen = (text: string) => (isTouch ? touchTalkKey(labels.text(text)) : text);

  return (
    <div ref={rootRef} className={`npc-talk${isTouch ? " npc-talk--touch" : ""}`} data-hud="대화창">
      {isShown && (
        <div
          ref={boxRef}
          className={`npc-talk__box${companionShown?.speech.kind === "hint" ? " npc-talk__box--hint" : ""}${npcShown ? " npc-talk__box--scene" : ""}`}
          data-kind={npcShown ? "scene" : companionShown?.speech.kind}
          data-testid="npc-talk-box"
        >
          {/* 알림은 창 안에 넣지 않는다 — 대화창이 떠 있는 동안 알림은 줄을 섰다가 창이 내려가면 뜬다(#78 · 미르 11/10 「NPC 와 대화할 때
              다른 알림을 중복으로 띄우지 마라」). 예전엔 터치에서 창 맨 위 한 줄로 넣었다 */}
          {npcShown ? (
            <SceneSpeech speech={npcShown} isTouch={isTouch} toScreen={toScreen} />
          ) : companionShown ? (
            <CompanionSpeech
              shown={companionShown}
              typingRef={typingRef}
              onAnswer={answer}
              isTouch={isTouch}
              toScreen={toScreen}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

const isLastPage = (shown: ShownSpeech | null) => !!shown && shown.pageIndex >= shown.pages.length - 1;

/** 찍는 중인 글자를 한꺼번에 다 보여 준다 — 아직 찍는 중이었으면 true */
type FinishTyping = () => boolean;

/** 장면 인물의 말 — 이름표 · 넘기기 안내 · 글 전체(제 시간에 넘어가므로 쪽을 나누지 않는다). 넘기기는 [F] · 터치는 창 안 「다음」 */
function SceneSpeech({
  speech,
  isTouch,
  toScreen,
}: {
  speech: NpcSpeech;
  isTouch: boolean;
  toScreen: (text: string) => string;
}) {
  return (
    <div key={speech.key} className="npc-talk__body npc-talk__body--scene">
      <div className="npc-talk__head">
        <span className="npc-talk__name" data-testid="npc-talk-name">
          {speech.speaker}
        </span>
        {speech.onNext && !isTouch && (
          <span className="npc-talk__advance">
            [F] 다음 <span className="companion-dots">▸</span>
          </span>
        )}
      </div>
      <p className="npc-talk__text" data-testid="npc-talk-text">
        {withKeys(toScreen(speech.text))}
      </p>
      {speech.onNext && isTouch && (
        // 터치 — 창이 조작층 위에 떠 있어 「다음」을 바로 누른다(위 줄 💬 도 같은 일 — 동행 말과 같은 모양)
        <button type="button" className="npc-talk__foot npc-talk__foot--button" onClick={speech.onNext}>
          다음 <span className="companion-dots">▸</span>
        </button>
      )}
    </div>
  );
}

interface CompanionSpeechProps {
  shown: ShownSpeech;
  typingRef: RefObject<FinishTyping | null>;
  onAnswer: (choiceId: string) => void;
  isTouch: boolean;
  toScreen: (text: string) => string;
}

/** 동행의 말 — 얼굴(동행 정령 초상) · 이름 · 화제 · 쪽 */
function CompanionSpeech(props: CompanionSpeechProps) {
  const { speech, pages, pageIndex, serial } = props.shown;
  return (
    <>
      <div className="npc-talk__face" aria-hidden="true" />
      <div className="npc-talk__body">
        <div className="npc-talk__head">
          <span className="npc-talk__name" data-testid="npc-talk-name">
            {COMPANION_NAME}
          </span>
          {speech.topic && <span className="npc-talk__topic">{speech.topic}</span>}
          {pages.length > 1 && (
            <span className="npc-talk__page">
              {pageIndex + 1}/{pages.length}
            </span>
          )}
        </div>
        {speech.asked && <div className="npc-talk__asked">나 · {speech.asked}</div>}
        {/* 쪽이 넘어가면 통째로 새로 붙여 글자를 처음부터 찍는다 */}
        <SpeechPage key={serial} {...props} />
      </div>
    </>
  );
}

/** 한 쪽 — 글자를 한 자씩 찍고, 물음이면 보기를, 아니면 넘기는 키를 보인다 */
function SpeechPage({ shown, typingRef, onAnswer, isTouch, toScreen }: CompanionSpeechProps) {
  const { speech, pages, pageIndex } = shown;
  const text = toScreen(pages[pageIndex]);
  // 두 줄 넘게 넘어가면 문장 · 쉼표 자리에서 끊는다 — 글 길이는 그대로라 찍는 자리는 text 로 세도 된다
  const [textRef, lined] = useLineBreaks<HTMLParagraphElement>(text);
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    // 지난 시간으로 센다 — 프레임이 밀려 타이머가 늦게 돌아도 글이 느려지지 않는다
    const startedAt = performance.now();
    let count = 0;
    const timer = window.setInterval(() => {
      count = Math.min(text.length, Math.floor((performance.now() - startedAt) / DIALOGUE_TIMING.typeMs));
      setTyped(count);
      if (count >= text.length) window.clearInterval(timer);
    }, DIALOGUE_TIMING.typeMs);
    const finish: FinishTyping = () => {
      if (count >= text.length) return false;
      window.clearInterval(timer);
      count = text.length;
      setTyped(count);
      return true;
    };
    typingRef.current = finish;
    return () => {
      window.clearInterval(timer);
      if (typingRef.current === finish) typingRef.current = null;
    };
  }, [text, typingRef]);

  const cut = snapToKey(text, typed);
  const isLast = pageIndex >= pages.length - 1;
  const choices = speech.kind === "ask" && isLast ? (speech.choices ?? []) : [];
  const keys = choiceKeys(choices.length, speech.numbered);
  // 물음의 마지막 쪽은 대답을 기다린다 — 정해 둔 시간이 있을 때만 줄어드는 띠를 보인다
  const waitMs = choices.length
    ? (speech.timeoutMs ?? 0)
    : pageDurationMs(pages[pageIndex], DIALOGUE_TIMING, speech.holdMs);

  return (
    <>
      <p ref={textRef} className="npc-talk__text" data-testid="npc-talk-text">
        {withKeys(lined.slice(0, cut))}
        <span className="npc-talk__pending">{withKeys(lined.slice(cut))}</span>
      </p>
      {choices.length > 0 ? (
        <div className="npc-talk__choices">
          {choices.map((choice, index) => (
            <button key={choice.id} type="button" className="npc-talk__choice" onClick={() => onAnswer(choice.id)}>
              {/* 터치는 키보드가 없다 — 키 표시 없이 눌러서 고른다 */}
              {!isTouch && <span className="npc-talk__key">{keys[index]}</span>}
              {choice.label}
            </button>
          ))}
        </div>
      ) : isTouch ? (
        // 터치 — 창이 조작층 위에 떠 있어 「다음」을 바로 누를 수 있다(위 줄 💬 도 같은 일)
        <button type="button" className="npc-talk__foot npc-talk__foot--button" onClick={() => pressTalkKey(true)}>
          {isLast ? "닫기" : "다음"} <span className="companion-dots">▸</span>
        </button>
      ) : (
        <div className="npc-talk__foot">
          <span className="npc-talk__key">F</span>
          {isLast ? "닫기" : "다음"}
        </div>
      )}
      {/* 게임 시계로 재는 띠 — 터치에서 창 때문에 얼면 같이 멈춘다(넘김 타이머도 게임 시계, dialogueRuntime) */}
      {waitMs > 0 && (
        <div className="npc-talk__timer" data-game-clock="" style={{ animationDuration: `${waitMs}ms` }} />
      )}
    </>
  );
}

/** [E] · [F] 같은 키 표시 — 터치에서 바뀐 단추 그림([✋] · [💬])도 */
const KEY_TOKEN = /\[([A-Z0-9]{1,2}|✋|💬|💡|🎒|⚙)\]/gu;

/** 찍다 만 자리가 [E] 같은 키 표시 한가운데면 그 끝으로 민다 — 「[E」 가 잠깐 보이지 않게 */
function snapToKey(text: string, typed: number) {
  for (const match of text.matchAll(KEY_TOKEN)) {
    const end = match.index + match[0].length;
    if (match.index < typed && typed < end) return end;
  }
  return typed;
}

/** 글 속의 [E] · [F] 를 키 모양으로 그린다 */
function withKeys(text: string): ReactNode {
  const parts = text.split(KEY_TOKEN);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="npc-talk__key">
        {part}
      </span>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
