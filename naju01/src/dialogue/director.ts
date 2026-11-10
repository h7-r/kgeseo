/**
 * 상황 → 동행의 말. 판정(situations)이 「지금 이런 처지다」를 알리면 여기서 대사(lines)를 골라 대화창(dialogueStore)에 올린다.
 * 푸는 법은 먼저 말하지 않는다. 플레이어가 [F] 로 청하면 지금 해 놓은 데에 맞는 도움말을 주고, 한참 못 풀면 도울지 먼저 묻는다.
 * 정식 힌트(서버 Hint API)는 여기서 부르지 않는다 — 붙일 자리(setHintProvider)만 둔다(companionBridge 가 붙인다).
 *
 * 초안 대사(lines 의 isDraft — 퍼즐 넛지 · 상황 대사 · 잡담)는 showDraftLines 일 때만 낸다. 계약 v0.4.16 §9: 배포판의 동행 대사는
 * 서버 승인 원문뿐이다. 그때도 FE 문구(보기 · 물음 · 안내판 설명)는 그대로 낸다.
 * 배포판에서는 동행이 먼저 「도와 드릴까요?」를 묻지 않는다 — 개입할지는 BE 가 정한다(v0.4.7 · v0.4.16 §1). 먼저 거는 말은 서버가 준 것뿐이다.
 * React · 별칭을 쓰지 않는다(node --test).
 */
import type { DialogueStore } from "./dialogueStore.ts";
import {
  getTone,
  ownLines,
  pickChatter,
  pickGeneral,
  pickLine,
  rotateGeneral,
  setTone,
  whatToDo,
  type PickedLine,
  type SituationKind,
  type Tone,
} from "./lines.ts";
import { OBJECTIVES, type ObjectiveId } from "./objectives.ts";
import type { Situation } from "./situations.ts";

/** 정식 힌트를 여는 쪽(서버 연동 — companionBridge) */
export interface HintProvider {
  /** 이 목표의 정식 힌트를 지금 열 수 있나 — 세션이 준비됐고 서버 퍼즐 ID 를 안다 */
  canOpen(objective: ObjectiveId): boolean;
  /** 연다. 힌트 글 · 실패 문구는 서버 쪽 대화가 대화창에 올린다. 보내지 못했으면 false */
  open(objective: ObjectiveId): Promise<boolean>;
}

/** 힌트를 줄 수 없을 때의 FE 고정 문구 — 배포판에서 초안 넛지 대신 한다(대화 진행 문구라 승인 대상이 아니다) */
export const HINT_UNAVAILABLE = "지금은 힌트를 받을 수 없어요. 조금 더 둘러보고 다시 불러 주세요.";
/** 정식 힌트를 열지 묻는 FE 고정 문구(대화 진행 문구 — 승인 대상 아님) */
export const OPEN_HINT_QUESTION = "힌트를 열어 볼까요?";

const MENU = { what: "what", hint: "hint", tone: "tone", close: "close" } as const;
const TONE_CHOICES: { id: Tone; label: string }[] = [
  { id: "casual", label: "편하게 반말로 해요" },
  { id: "polite", label: "존댓말로 해 주세요" },
];
const YES = "yes";
const NO = "no";
const MORE_CHOICES = [
  { id: YES, label: "네, 알려 주세요" },
  { id: NO, label: "아니요, 더 해 볼게요" },
];
const OPEN_CHOICES = [
  { id: YES, label: "네, 열어 주세요" },
  { id: NO, label: "아니요, 괜찮아요" },
];
/** 물음이 대답 없이 물러나는 시간 — 퍼즐을 푸느라 못 본 것이지 거절이 아니다 */
const ASK_TIMEOUT_MS = 14_000;
/**
 * 되돌려짐을 알리는 게임 알림과 그 뒤를 잇는 동행의 말이 함께 쓰는 key.
 * 같은 key 의 말은 서로 바꿔 끼워지므로, 동행의 말이 알림 자리에 들어서고 같은 소식이 두 번 나오지 않는다.
 */
export const SENT_BACK_KEY = "sentBack";

interface DirectorOptions {
  store: DialogueStore;
  /** 안내판 설명 — 「여기서 뭘 해야 해요?」의 대답으로 다시 들려준다. 안내판이 없는 목표면 null */
  guideOf: (objective: ObjectiveId) => string | null;
  /** 보기를 고르는 동안 마우스를 풀어도 되나 — 물속처럼 멈춰 서면 위험한 곳에서는 키로만 고른다 */
  canFreeCursor?: () => boolean;
  /** 지금 플레이어가 해 놓은 데에 맞는 도움말 — 그 목표의 어느 대사 묶음 몇 번째인지. 가릴 수 없으면 null */
  phaseHint?: (objective: ObjectiveId) => { kind: SituationKind; index: number } | null;
  /** 반말 · 존댓말을 고르게 하나 — 베타는 존댓말 한 벌이라 끈다 */
  canChooseTone?: boolean;
  /** 플레이어가 말투를 골랐다 — 다음에 올 때도 그 말투로 시작하게 적어 둔다 */
  onTone?: (tone: Tone) => void;
  /** 대사를 말했다 — 한동안 먼저 말 걸지 않게 판정 쪽에 알린다 */
  onSpoken?: () => void;
  /**
   * 플레이어가 [F] 로 청해 동행의 대답을 받았다 — 「여기서 뭘 해야 해요?」(보기가 둘이면 Y) 대답 · 미리 보기 판의 넛지.
   * 도움 별의 「직접 청한 도움」(progress/helpLog, 미르 11/11 「Y 를 눌러 동행이 알려 준 것을 받았을 때」).
   * 정식 힌트는 서버 글이 실제로 왔을 때 다리(companionBridge onRequestedHint)가 센다. 동행이 먼저 권한 것에 「네」는 세지 않는다
   */
  onHelpAsked?: () => void;
  /** 승인 대기 초안(isDraft)을 화면에 내나 — 미리 보기(개발 · VITE_NPC_PREVIEW 빌드)만 true. 기본 true(검사용) */
  showDraftLines?: boolean | (() => boolean);
  log?: (line: PickedLine, situation: string) => void;
}

export function createDirector(options: DirectorOptions) {
  const { store, guideOf } = options;
  const draftOption = options.showDraftLines ?? true;
  /** 초안을 내는 판인가(미리 보기) — 초안은 늦게(동적 import) 올라오므로 그때그때 묻는다 */
  const showsDrafts = () => (typeof draftOption === "function" ? draftOption() : draftOption);
  /** 화면에 낼 수 있는 줄인가 — 배포판에서는 초안을 내지 않는다(계약 §9) */
  const canShow = (line: PickedLine | null): line is PickedLine => !!line && (showsDrafts() || !line.isDraft);
  /** 목표마다 [F] 로 몇 칸까지 들었나 */
  const helpStep = new Map<ObjectiveId, number>();
  let solvedCount = 0;
  let endCount = 0;
  /** 목표마다 마지막으로 그 단계에 맞춰 답해 준 단계 */
  const toldPhase = new Map<ObjectiveId, string>();
  let progressCount = 0;
  let hintProvider: HintProvider | null = null;

  const topicOf = (objective: ObjectiveId | null) => (objective ? OBJECTIVES[objective].name : undefined);

  /** 같은 말을 이 시간 안에 되풀이하지 않는다 */
  const REPEAT_GAP_MS = 60_000;
  /** 동행이 먼저 건 말은 이만큼 넘게 줄에서 기다렸으면 버린다 */
  const UNASKED_TTL_MS = 6_000;
  const spokenAt = new Map<string, number>();

  function speak(line: PickedLine | null, objective: ObjectiveId | null, situation: string, asked?: string) {
    if (!canShow(line)) return false;
    // asked 가 있으면(빈 글이어도) 플레이어가 청한 말이다. 청하지 않은 말은 방금 한 말을 되풀이하지 않고, 늦어지면 하지 않는다
    const isRequested = asked !== undefined;
    if (!isRequested && Date.now() - (spokenAt.get(line.id) ?? -Infinity) < REPEAT_GAP_MS) return false;
    spokenAt.set(line.id, Date.now());
    store.say({
      kind: "line",
      text: line.text,
      lineId: line.id,
      topic: topicOf(objective),
      asked: asked || undefined,
      ttlMs: isRequested ? undefined : UNASKED_TTL_MS,
    });
    options.log?.(line, situation);
    options.onSpoken?.();
    return true;
  }

  /**
   * 미룰 수 없는 말 — 줄 서지 않고 떠 있는 말(알림 · 물음)을 물리고 바로 뜬다. 방금 한 말이어도 다시 한다.
   * 연출에 막혀 줄에서 늦어지면 이미 지난 일이니 버린다.
   */
  function warn(line: PickedLine | null, objective: ObjectiveId | null, situation: string, key?: string) {
    if (!canShow(line)) return;
    store.say({
      kind: "notice",
      urgent: true,
      text: line.text,
      lineId: line.id,
      topic: topicOf(objective),
      ttlMs: UNASKED_TTL_MS,
      key,
    });
    options.log?.(line, situation);
    options.onSpoken?.();
  }

  /** 그 목표의 첫 설명 — 안내판이 있으면 그 글, 없으면 따로 써 둔 첫 대사(초안 — 미리 보기만), 그것도 없으면 무엇을 하는 곳인지 한 줄(화면 쪽 문구) */
  function introOf(objective: ObjectiveId): PickedLine | null {
    const guide = guideOf(objective);
    if (guide) return { id: `GUIDE_${objective}`, text: guide, isLast: true, isDraft: false };
    const own = ownLines(objective, "arrive")[0] ?? null;
    return (canShow(own) ? own : null) ?? whatToDo(objective);
  }

  /** FE 고정 문구 한 줄 — 초안이 아니라 늘 낸다 */
  function sayFixed(text: string, objective: ObjectiveId | null, asked?: string) {
    store.say({ kind: "line", text, topic: topicOf(objective), asked: asked || undefined });
    options.onSpoken?.();
  }

  /** 서버에 등록된 퍼즐이고 정식 힌트를 지금 열 수 있나 */
  const canOpenHint = (objective: ObjectiveId) =>
    !!OBJECTIVES[objective].puzzleId && !!hintProvider?.canOpen(objective);

  /**
   * 도움말 한 칸 — 플레이어가 청했을 때만 준다.
   * 지금 해 놓은 데(단계)에 맞는 말이 있으면 그것부터, 같은 단계에서 또 청하면 사다리를 한 칸씩 더 간다.
   */
  function nextHelp(objective: ObjectiveId | null, asked?: string, isRequested = false): void {
    /** 청해서 받은 도움이면 센다 */
    const noteRequested = () => {
      if (isRequested) options.onHelpAsked?.();
    };
    // 배포판에서 목표를 모르면(4 · 5스테이지처럼 목표표 밖) 「걸리는 게 없다」고 하지 않는다 — 받을 수 없다고만
    if (!objective) {
      if (!showsDrafts()) return void sayFixed(HINT_UNAVAILABLE, null, asked);
      return void speak(pickGeneral("help"), null, "help", asked ?? "");
    }
    // 배포판 — 초안 넛지 사다리를 쓰지 않는다. 정식 힌트를 열 수 있으면 그것, 아니면 FE 고정 문구 하나(계약 §9)
    if (!showsDrafts()) {
      if (canOpenHint(objective)) return void offerOfficialHint(objective);
      return void sayFixed(HINT_UNAVAILABLE, objective, asked);
    }
    const phase = options.phaseHint?.(objective) ?? null;
    const phaseKey = phase ? `${objective}:${phase.kind}:${phase.index}` : null;
    if (phase && phaseKey !== toldPhase.get(objective)) {
      toldPhase.set(objective, phaseKey as string);
      // 첫 설명 단계인데 따로 써 둔 첫 대사가 없으면(안내판과 같은 말이라 두지 않았다) 안내판 설명으로 답한다
      const fitting =
        ownLines(objective, phase.kind)[phase.index] ?? (phase.kind === "arrive" ? introOf(objective) : null);
      if (fitting) {
        noteRequested();
        return void speak(fitting, objective, "help-phase", asked ?? "");
      }
    }
    const ladder = ownLines(objective, "help");
    const step = helpStep.get(objective) ?? 0;
    if (step >= ladder.length) {
      helpStep.set(objective, 0);
      // 넛지를 다 썼다 — 서버에 등록된 퍼즐이고 열 수 있으면 정식 힌트를 권한다
      if (canOpenHint(objective)) return void offerOfficialHint(objective);
      endCount += 1;
      return void speak(rotateGeneral("helpEnd", endCount), objective, "help-end", asked ?? "");
    }
    helpStep.set(objective, step + 1);
    noteRequested();
    speak(ladder[step], objective, "help", asked ?? "");
  }

  /**
   * 플레이어가 [F] 로 말을 걸었다 — 무엇이 궁금한지 고르게 한다.
   * 고르는 동안은 마우스가 풀려 눌러서 고를 수 있고, 숫자키로도 고른다.
   */
  async function openMenu(objective: ObjectiveId | null) {
    if (!objective) return void nextHelp(null);
    const intro = introOf(objective);
    const heard = helpStep.get(objective) ?? 0;
    // 배포판의 「힌트를 주세요」는 정식 힌트를 지금 열 수 있을 때만 — 눌러 봐야 「받을 수 없어요」뿐인 보기는 숨긴다
    const canAskHint = showsDrafts() || canOpenHint(objective);
    // 고를 것이 「괜찮아요」 하나뿐이면 보기를 띄우지 않고 받을 수 없다고만 한다
    if (!intro && !canAskHint) return void sayFixed(HINT_UNAVAILABLE, objective);
    const choices = [
      ...(intro ? [{ id: MENU.what, label: "여기서 뭘 해야 해요?" }] : []),
      ...(canAskHint ? [{ id: MENU.hint, label: heard > 0 ? "힌트를 더 주세요" : "힌트를 주세요" }] : []),
      ...(options.canChooseTone
        ? [{ id: MENU.tone, label: getTone() === "casual" ? "존댓말로 말해 주세요" : "편하게 반말로 말해요" }]
        : []),
      { id: MENU.close, label: "괜찮아요, 혼자 해 볼게요" },
    ];
    options.onSpoken?.();
    const answer = await store.ask({
      text: pickGeneral("menu").text,
      topic: topicOf(objective),
      choices,
      freeCursor: options.canFreeCursor?.() ?? true,
      key: "menu",
    });
    const asked = choices.find((choice) => choice.id === answer)?.label;
    if (answer === MENU.what && intro) {
      store.say({ kind: "guide", text: intro.text, topic: topicOf(objective), key: "guide", asked });
      options.onSpoken?.();
      options.onHelpAsked?.();
    } else if (answer === MENU.hint) nextHelp(objective, asked, true);
    else if (answer === MENU.tone) applyTone(getTone() === "casual" ? "polite" : "casual", asked);
  }

  /** 말투를 정하고, 그 말투로 키 안내까지 한 번 말한다 */
  function applyTone(next: Tone, asked?: string) {
    setTone(next);
    options.onTone?.(next);
    speak(pickGeneral("toneSet"), null, "tone", asked);
  }

  /**
   * 처음 만났다. 말투를 정한 적이 없으면 딱딱한 표준말로 인사한 뒤 나주 말씨로 바꾸고, 반말 · 존댓말을 묻는다.
   * 정한 적이 있으면 그 말투로 바로 인사한다.
   */
  async function begin(saved: Tone | null) {
    if (saved) {
      setTone(saved);
      speak(pickGeneral("greet"), null, "greet");
      return;
    }
    options.onSpoken?.();
    const answer = await store.ask({
      text: `${pickGeneral("opening").text}\n${pickGeneral("toneAsk").text}`,
      choices: TONE_CHOICES,
      numbered: true,
      freeCursor: true,
      key: "tone",
    });
    const picked = TONE_CHOICES.find((choice) => choice.id === answer);
    // 고르지 않고 넘기면 존댓말로 간다 — [F] 보기에서 언제든 바꿀 수 있다
    applyTone(picked?.id ?? "polite", picked?.label);
  }

  async function offerMore(objective: ObjectiveId | null, question: PickedLine, situation: string) {
    // 배포판에서는 동행이 먼저 도울지 묻지 않는다 — 개입 판단은 BE(v0.4.7 · v0.4.16 §1). 서버가 권하면 askOpenHint 가 묻는다
    if (!showsDrafts()) return;
    options.log?.(question, situation);
    options.onSpoken?.();
    const answer = await store.ask({
      text: question.text,
      lineId: question.id,
      topic: topicOf(objective),
      choices: MORE_CHOICES,
      timeoutMs: ASK_TIMEOUT_MS,
      key: "offer",
    });
    if (answer === YES) nextHelp(objective, MORE_CHOICES[0].label);
    else if (answer === NO) speak(pickGeneral("hintDeclined"), objective, "declined", MORE_CHOICES[1].label);
  }

  async function offerOfficialHint(objective: ObjectiveId) {
    const answer = await store.ask({
      text: "여기부터는 정식 힌트예요. 열면 남은 힌트가 하나 줄어요. 열어 볼까요?",
      topic: topicOf(objective),
      choices: OPEN_CHOICES,
      timeoutMs: ASK_TIMEOUT_MS,
      key: "offer",
    });
    if (answer !== YES) return;
    // 열었으면 힌트 글(또는 잔액 없음 같은 실패 문구)은 서버 쪽 대화가 대화창에 올린다
    const isSent = (await hintProvider?.open(objective)) ?? false;
    if (!isSent) sayFixed(HINT_UNAVAILABLE, objective);
  }

  /**
   * 서버가 힌트를 권했다(suggest_hint) — 열지 Y/N 으로 묻는다. 제안은 해금이 아니라서 「네」일 때만 연다(부른 쪽이 acceptOffer).
   * 같이 온 서버 대사(lead)는 물음 위에 붙인다 — 따로 띄우면 물음이 그 말을 밀어낸다.
   */
  async function askOpenHint(request: {
    lead: string | null;
    lineId?: string;
    balance: number | null;
    /** 물음이 실제로 화면에 떴다(dialogueStore onShow) */
    onShow?: () => void;
    /** 화면에 뜬 물음에 「아니요」를 골랐다 — 대답 없이 물러남 · 버려짐과 가른다(거절 쿨다운) */
    onDecline?: () => void;
  }) {
    const question =
      request.balance === null ? OPEN_HINT_QUESTION : `${OPEN_HINT_QUESTION} (남은 힌트 ${request.balance})`;
    options.onSpoken?.();
    const answer = await store.ask({
      text: request.lead ? `${request.lead}\n${question}` : question,
      lineId: request.lineId,
      choices: OPEN_CHOICES,
      timeoutMs: ASK_TIMEOUT_MS,
      key: "offer",
      onShow: request.onShow,
    });
    if (answer === NO) request.onDecline?.();
    return answer === YES;
  }

  function handle(situation: Situation) {
    const { kind, objective, step } = situation;
    switch (kind) {
      case "arrive":
        // 첫마디는 「무엇이 있다」까지만 — 푸는 법은 플레이어가 청할 때 말한다
        if (objective) speak(ownLines(objective, "arrive")[0] ?? null, objective, kind);
        return;
      case "solved": {
        const own = objective ? ownLines(objective, "solved")[0] : null;
        // 따로 써 둔 말이 없으면 퍼즐일 때만 짧게 맞장구친다 — 걸음마다 칭찬하면 시끄럽다
        if (own) speak(own, objective, kind);
        else if (objective && OBJECTIVES[objective].puzzleId)
          speak(rotateGeneral("solved", solvedCount++), objective, kind);
        return;
      }
      case "stuck":
        // 한참 못 풀고 있다 — 힌트를 바로 주지 않고 도울지 먼저 묻는다. 「네」면 지금 단계에 맞는 도움말을 준다
        void offerMore(objective, pickGeneral("offerHelp", step), kind);
        return;
      case "wrong":
        void offerMore(objective, pickGeneral("offerAfterWrong", step), kind);
        return;
      case "overtime":
        // 오래 걸렸다는 물음은 막힘 물음의 마지막 칸(「꽤 오래 붙들고 있네요」)과 같은 말이다
        void offerMore(objective, pickGeneral("offerHelp", 2), kind);
        return;
      case "astray":
        speak(pickLine(objective, kind, step), objective, kind);
        return;
      case "dropped":
      case "unpicked":
        speak(pickLine(null, kind, 0), objective, kind);
        return;
      case "missing":
        // 계약: 안 챙긴 물건의 이름 · 자리는 말하지 않는다 — 「빠진 게 있다」까지만
        speak(pickLine(null, kind, 0), objective, kind);
        return;
      case "idle":
        speak(pickLine(null, kind, step), objective, kind);
        return;
      case "breath":
        // 숨은 가장 급하다
        warn(pickLine(null, kind, step), objective, kind);
        return;
      case "sentBack":
        // 방금 뜬 되돌려짐 알림 자리에 바꿔 끼운다 — 그 알림이 이미 밀려났어도 바로 뜬다
        warn(pickLine(null, kind, step), objective, kind, SENT_BACK_KEY);
        return;
      case "chatter":
        // 잡담은 화제(퍼즐 이름)를 달지 않는다
        speak(pickChatter(step, situation.zone), null, kind);
    }
  }

  return {
    handle,
    /** 플레이어가 [F] 로 말을 걸었다 — 물어볼 것을 고르게 한다 */
    openMenu,
    /** 고르지 않고 바로 다음 도움말 한 칸 */
    help: nextHelp,
    /** 처음 걷기 시작했다 — 인사(말투를 아직 안 정했으면 묻는다) */
    begin,
    firstItem: () => speak(pickGeneral("firstItem"), null, "first-item"),
    /** 하나씩 채워 가는 퍼즐에서 하나를 더 해냈다 — 남은 수를 알려 준다(여섯부터는 말하지 않는다) */
    progress(objective: ObjectiveId | null, left: number) {
      progressCount += 1;
      if (left === 1) speak(rotateGeneral("progressLast", progressCount), objective, "progress");
      else if (left >= 2 && left <= 5) speak(pickGeneral("progress", left - 2), objective, "progress");
    },
    /** 게한테 물렸다 */
    pinched: (times: number) => speak(pickGeneral("pinched", Math.min(times, 3) - 1), "P01", "pinched"),
    /** 서버 Hint API 를 잇는 자리. 없으면 넛지를 다 쓴 뒤 「여기까지」라고만 한다 */
    setHintProvider(provider: HintProvider | null) {
      hintProvider = provider;
    },
    askOpenHint,
  };
}

export type Director = ReturnType<typeof createDirector>;
