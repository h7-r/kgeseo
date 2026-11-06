/**
 * 동행 대화창 — 화면 왼쪽 아래에서 동행과 주고받는 대화(Canvas 밖 DOM).
 *
 * 전에는 퍼즐 설명이 오른쪽 안내판에, 방금 일어난 일이 가운데 알림에 따로 떴다. 이제 둘 다 동행이 말한다.
 *   퍼즐 앞에 서면      동행이 그 퍼즐을 설명하고, 하나 해낼 때마다 남은 수를 말해 준다(수치는 오른쪽 아래에 작게 남는다)
 *   한동안 조용하면     동행이 먼저 잡담을 건다
 *   무슨 일이 생기면    동행이 바로 말한다(퍼즐이 showNotice 로 올리던 문장 그대로)
 *   막히면              상황을 보고 동행이 먼저 말을 건다(dialogue/situations)
 *   [F] 로 말을 걸면    무엇이 궁금한지 보기가 뜬다 — 눌러서 고르거나 숫자키로 고른다
 * 동행이 먼저 물을 때([Y] [N])는 걷던 그대로 키로 답한다. 플레이어가 먼저 말을 걸었을 때는 마우스를 풀어 눌러서도 고를 수 있다.
 * 글이 길면 창이 커지는 대신 쪽으로 넘어간다.
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

import { useIsUnderwater } from "../puzzles/cave/caveState";
import { useNotice } from "../puzzles/interaction";
import { useHeldItems } from "../puzzles/inventory";
import { usePuzzlePanel } from "../puzzles/puzzlePanel";
import { DIALOGUE_TIMING, pageDurationMs, type ShownSpeech } from "./dialogueStore.ts";
import {
  COMPANION_NAME,
  dialogue,
  dropMenu,
  explainFirstItem,
  pressTalkKey,
  sayNotice,
  setDialoguePanel,
  startDialogue,
  tickDialogue,
  useDialogue,
} from "./dialogueRuntime";
import { noteNotice, notePanel } from "./gameObserver";

import "./dialogue.css";

const TICK_MS = 500;
/** 한 쪽 = 네 줄. 낱말 단위로 줄이 바뀌어 줄 끝이 조금씩 비므로 여유를 둔다 */
const PAGE_LINES = 4;
const LINE_FILL = 0.85;
const FONT_PX = 18;
/** 창 너비에서 글이 못 쓰는 폭 — 안쪽 여백 · 테두리 · 얼굴 · 사이 간격(dialogue.css) */
const BOX_CHROME_PX = 96;

const isTypingInField = (target: EventTarget | null) =>
  /INPUT|TEXTAREA|SELECT/.test((target as HTMLElement | null)?.tagName ?? "");

/** 선택지를 고르는 키 — 예 · 아니오 둘이면 Y · N, 그 밖에는 숫자 */
const choiceKeys = (count: number, numbered = false) =>
  count === 2 && !numbered ? ["Y", "N"] : Array.from({ length: count }, (_, index) => String(index + 1));

export default function DialogueLayer() {
  const shown = useDialogue();
  const panel = usePuzzlePanel();
  const notice = useNotice();
  const isUnderwater = useIsUnderwater();
  const heldCount = useHeldItems().length;
  const rootRef = useRef<HTMLDivElement>(null);
  const typingRef = useRef<FinishTyping | null>(null);

  // 안내판 → 동행의 설명 + 상태 띠
  useEffect(() => {
    setDialoguePanel(panel);
    notePanel(panel);
  }, [panel]);
  useEffect(() => () => setDialoguePanel(null), []);

  // 알림 → 동행의 말
  useEffect(() => {
    if (!notice) return;
    noteNotice(notice.text);
    sayNotice(notice.text);
  }, [notice]);

  // 상황 판정
  useEffect(() => {
    const timer = window.setInterval(tickDialogue, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // 걷기 시작하면(마우스 잠금) 동행이 말을 시작한다
  useEffect(() => {
    const onLockChange = () => {
      if (!document.pointerLockElement) return;
      startDialogue();
      // 보기를 고르지 않고 [T] 로 다시 걷기 시작했으면 보기를 거둔다
      if (!relockRef.current) return;
      relockRef.current = null;
      dropMenu();
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () => document.removeEventListener("pointerlockchange", onLockChange);
  }, []);

  // 첫 물건을 얻으면 꺼내 드는 법을 알려 준다. 이어 하기로 이미 가진 채 시작하면 하지 않는다
  const hadItemsRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (hadItemsRef.current === false && heldCount > 0) explainFirstItem();
    hadItemsRef.current = heldCount > 0;
  }, [heldCount]);

  // 창 너비 → 한 쪽에 들어가는 글자 수
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const measure = () => {
      const perLine = (root.clientWidth - BOX_CHROME_PX) / FONT_PX;
      dialogue.setCapacity(perLine * PAGE_LINES * LINE_FILL);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // 플레이어가 먼저 건 대화(보기 고르기)는 마우스를 풀어 눌러서 고를 수 있게 하고, 끝나면 다시 잡는다.
  // 잠금은 걷기 쪽이 지켜보는 바로 그 요소에 다시 걸어야 한다 — 다른 요소에 걸면 잠겼는데도 못 걷는다.
  const relockRef = useRef<Element | null>(null);
  const isMenuOpen = !!shown?.speech.freeCursor;
  useEffect(() => {
    if (!isMenuOpen || !document.pointerLockElement) return;
    relockRef.current = document.pointerLockElement;
    document.exitPointerLock();
  }, [isMenuOpen]);

  /** 풀었던 마우스를 다시 잡는다 — 키 · 클릭 처리 안에서 불러야 브라우저가 허락한다. 거절돼도 [T] 로 다시 잡으면 된다 */
  const relock = useCallback(() => {
    const target = relockRef.current;
    relockRef.current = null;
    if (target?.isConnected) void Promise.resolve(target.requestPointerLock()).catch(() => {});
  }, []);

  const answer = useCallback(
    (choiceId: string) => {
      const isMenu = !!dialogue.getState()?.speech.freeCursor;
      if (dialogue.answer(choiceId) && isMenu) relock();
    },
    [relock],
  );

  // 키 — 캡처 단계에서 받아, 대답에 쓴 Y · N · 숫자가 게임 단축키(표식 · 빠른 칸)로 새지 않게 한다
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || isTypingInField(event.target)) return;
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
        // 말을 건 보기는 Esc 로 물린다(마우스가 이미 풀려 있어 Esc 가 여기까지 온다)
        if (event.code === "Escape" && state?.speech.freeCursor) {
          event.stopImmediatePropagation();
          dialogue.declineAsk();
          relock();
          return;
        }
      }
      if (event.code !== "KeyF") return;
      // 글자가 찍히는 중이면 먼저 다 보여 준다
      const handled = typingRef.current?.() || pressTalkKey(!!document.pointerLockElement);
      if (handled) event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [answer, relock]);

  const className = `npc-talk${isUnderwater ? " npc-talk--underwater" : ""}`;

  return (
    <>
      <div ref={rootRef} className={className}>
        {shown && <SpeechBox shown={shown} typingRef={typingRef} onAnswer={answer} />}
      </div>
      {panel && <PuzzleCounts rows={panel.rows ?? []} diagram={panel.diagram} />}
    </>
  );
}

interface PuzzleCountsProps {
  rows: { label: string; value: string; ok?: boolean }[];
  diagram?: ReactNode;
}

/** 퍼즐 앞에 서 있는 동안 오른쪽 아래에 조용히 떠 있는 수치(「캔 조개 1 / 3」) · 그림. 설명은 동행이 말한다 */
function PuzzleCounts({ rows, diagram }: PuzzleCountsProps) {
  if (rows.length === 0 && !diagram) return null;
  return (
    <div className="npc-counts" data-testid="npc-counts">
      {diagram && <div className="npc-counts__diagram">{diagram}</div>}
      {rows.map((row) => (
        <span key={row.label} className={`npc-counts__row${row.ok ? " npc-counts__row--ok" : ""}`}>
          {row.label} <b>{row.value}</b>
        </span>
      ))}
    </div>
  );
}

const isLastPage = (shown: ShownSpeech | null) => !!shown && shown.pageIndex >= shown.pages.length - 1;

/** 찍는 중인 글자를 한꺼번에 다 보여 준다 — 아직 찍는 중이었으면 true */
type FinishTyping = () => boolean;

interface SpeechProps {
  shown: ShownSpeech;
  typingRef: RefObject<FinishTyping | null>;
  onAnswer: (choiceId: string) => void;
}

function SpeechBox({ shown, typingRef, onAnswer }: SpeechProps) {
  const { speech, pages, pageIndex, serial } = shown;
  return (
    <div
      className={`npc-talk__box${speech.kind === "hint" ? " npc-talk__box--hint" : ""}`}
      data-kind={speech.kind}
      data-testid="npc-talk-box"
    >
      <div className="npc-talk__face" aria-hidden="true" />
      <div className="npc-talk__body">
        <div className="npc-talk__head">
          {COMPANION_NAME}
          {speech.topic && <span className="npc-talk__topic">{speech.topic}</span>}
          {pages.length > 1 && (
            <span className="npc-talk__page">
              {pageIndex + 1}/{pages.length}
            </span>
          )}
        </div>
        {speech.asked && <div className="npc-talk__asked">나 · {speech.asked}</div>}
        {/* 쪽이 넘어가면 통째로 새로 붙여 글자를 처음부터 찍는다 */}
        <SpeechPage key={serial} shown={shown} typingRef={typingRef} onAnswer={onAnswer} />
      </div>
    </div>
  );
}

/** 한 쪽 — 글자를 한 자씩 찍고, 물음이면 보기를, 아니면 넘기는 키를 보인다 */
function SpeechPage({ shown, typingRef, onAnswer }: SpeechProps) {
  const { speech, pages, pageIndex } = shown;
  const text = pages[pageIndex];
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
  const waitMs = choices.length ? (speech.timeoutMs ?? 0) : pageDurationMs(text, DIALOGUE_TIMING, speech.holdMs);

  return (
    <>
      <p className="npc-talk__text" data-testid="npc-talk-text">
        {withKeys(text.slice(0, cut))}
        <span className="npc-talk__pending">{withKeys(text.slice(cut))}</span>
      </p>
      {choices.length > 0 ? (
        <div className="npc-talk__choices">
          {choices.map((choice, index) => (
            <button key={choice.id} type="button" className="npc-talk__choice" onClick={() => onAnswer(choice.id)}>
              <span className="npc-talk__key">{keys[index]}</span>
              {choice.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="npc-talk__foot">
          <span className="npc-talk__key">F</span>
          {isLast ? "닫기" : "다음"}
        </div>
      )}
      {waitMs > 0 && <div className="npc-talk__timer" style={{ animationDuration: `${waitMs}ms` }} />}
    </>
  );
}

const KEY_TOKEN = /\[([A-Z0-9]{1,2})\]/g;

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
