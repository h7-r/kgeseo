/**
 * 동행이 상황마다 하는 말 — 미리 써 둔 대사 묶음이다. 그때그때 지어내지 않는다.
 *
 * 목표(퍼즐 · 걸음)마다 상황별 사다리를 둔다. 같은 상황이 되풀이되면 사다리의 다음 칸(더 구체적인 말)으로 간다.
 * 여기 있는 말은 전부 **넛지(무료 1단계)** 다 — 어디를 보고 무엇을 만질지만 말하고 답(번호 · 차례 · 가락)은 적지 않는다.
 * 방향 힌트 · 정답(2 · 3단계)은 서버 Hint API 가 준다.
 *
 * 줄 수의 기준(계약 v0.4.16 §9 — 숫자는 조정 중): 상황 코드 하나에 두 줄, 진전 없음 · 반복 실수 · 목표 이탈만 세 줄까지.
 * 판정 없는 걸음은 한두 줄이다. 걸음의 arrive 는 걸음 도착(STEP_ARRIVED — 분위기 · 보이는 것), help 는 진전 없음(NO_PROGRESS
 * + 그 걸음의 대상)으로 싣는다(§10-3 — 도움말은 진전이 없을 때만). 게임 알림 · 안내판 설명과 같은 말은 두지 않는다 — 그 말은
 * 동행이 이미 제 말투로 한다(gameVoiceLines). 대화를 이어 가는 말(인사 · 보기와 그 대답 · 남은 수)은 화면 쪽 고정 문구라
 * 승인 대상이 아니다(FE_KINDS · WHAT_TO_DO).
 *
 * 상황 코드와 분류는 확정됐고, 대사 원문은 G3 승인을 기다린다. 백엔드 npc.json 과 같은 모양(line_id NUDGE_… · 200자 이내)으로
 * 뽑을 수 있게 했다(tools/export-npc-lines.mjs). 승인 대상 줄(퍼즐 넛지 · 상황 대사 · 잡담)은 draftLines.ts 에 따로 두고 개발 · 미리 보기
 * 빌드에서만 동적 import 로 올린다(previewMode) — 운영 번들에는 글이 없다. 여기에는 FE 문구(대화 진행 · 「여기서 뭘 해야 해요?」 대답)만 남는다.
 * React · 별칭을 쓰지 않는다(node --test).
 */
import type { ObjectiveId, Stage } from "./objectives.ts";

export type SituationKind =
  /** 안내판이 없는 목표 앞에 처음 섰다 */
  | "arrive"
  /** 플레이어가 물었다([F]) — 누를수록 더 구체적으로 */
  | "help"
  /** 진전 없이 오래 머문다 */
  | "stuck"
  /** 틀리기를 되풀이한다 */
  | "wrong"
  /** 정해 둔 시간을 넘겼다 */
  | "overtime"
  /** 목표에서 멀어진다 */
  | "astray"
  /** 필요한 물건을 버리고 간다 */
  | "dropped"
  /** 나온 물건을 줍지 않고 다음 구역으로 갔다 */
  | "unpicked"
  /** 한참 아무것도 하지 않는다 */
  | "idle"
  /** 물속에서 숨이 얼마 안 남았다 */
  | "breath"
  /** 숨이 다해 마지막으로 숨 쉰 자리로 되돌려졌다 */
  | "sentBack"
  /** 풀었다 */
  | "solved"
  /** 한동안 조용했다 — 동행이 먼저 말을 건다(잡담 · 장난) */
  | "chatter"
  /** 필요한 물건 없이 그 자리에 왔다 */
  | "missing";

/**
 * 말투. 베타는 존댓말 한 벌이다(계약 v0.4.16 §9) — 묻기 · 바꾸기는 꺼 두고(dialogueRuntime), 반말은 보관만 한다.
 *   polite 존댓말. 함께 다니는 동료의 해요체
 *   casual 반말. 나주 말씨로 편하게, 장난도 치는 말
 */
export type Tone = "polite" | "casual";

/** 대사 하나 = [존댓말, 반말]. 문자열 하나면 두 말투가 같은 말이다(말투를 정하기 전의 안내) */
export type Toned = string | readonly [polite: string, casual: string];
export type Ladder = readonly Toned[];

/** 승인 대기 초안(draftLines.ts) — 개발 · 미리 보기 빌드와 검사만 넣는다. 없으면 초안 대사는 없는 셈이다 */
export interface DraftLines {
  objective: Record<ObjectiveId, Partial<Record<SituationKind, Ladder>>>;
  general: Record<string, Ladder>;
}
let drafts: DraftLines | null = null;
export function registerDraftLines(next: DraftLines | null) {
  drafts = next;
}
export const hasDraftLines = () => drafts !== null;

let tone: Tone = "polite";
export const getTone = () => tone;
export function setTone(next: Tone) {
  tone = next;
}

const textOf = (line: Toned, as: Tone = tone) => (typeof line === "string" ? line : line[as === "polite" ? 0 : 1]);
/** line_id 끝에 붙는 말투 표시 — J 존댓말 · B 반말. 두 말투가 같은 말이면 붙이지 않는다 */
const toneMark = (line: Toned, as: Tone = tone) => (typeof line === "string" ? "" : as === "polite" ? "_J" : "_B");

/**
 * 목표와 상관없이 쓰는 FE 문구 — 대화 진행 · 인사 · 남은 수(계약 v0.4.16 §9-3, 승인 대상 아님). 글 속에 바뀌는 자리를 두지 않는다.
 * 공통 상황 대사 · 잡담(승인 대상)은 draftLines.ts 의 DRAFT_GENERAL_LINES.
 */
export const GENERAL_LINES = {
  help: [["지금은 딱히 걸리는 게 없어요. 가던 길 그대로 가면 돼요.", "지금은 딱히 걸리는 게 없어. 가던 길 가면 돼."]],
  /** 사다리를 다 썼다 */
  helpEnd: [
    [
      "제가 아는 건 여기까지예요. 우리 주변을 한 번만 더 찬찬히 봐요.",
      "내가 아는 건 여기까지랑께. 주변을 한 번만 더 찬찬히 봐.",
    ],
    ["방금 제가 말한 걸 하나씩 다시 해 봐요. 분명 거기 있어요.", "방금 말한 걸 하나씩 다시 해 봐. 분명 거기 있당께."],
  ],
  /** 맨 처음 — 말투를 정하기 전이라 조금 격식 있고 서먹한 표준말이다 */
  opening: [
    "안녕하세요. 이번 사건에 동행하게 된 안내자예요. 이곳은 나주 앙암바위 사건 구역이에요. …아, 여기는 나주니까 지금부터는 나주 말씨로 바꿔 볼게요. 흠흠.",
  ],
  toneAsk: ["그런데 말은 어떻게 할까요? 편하게 반말로 할까요, 아니면 존댓말로 할까요?"],
  /** 말투를 고른 뒤 — 키 안내까지 */
  toneSet: [
    [
      "알겠어요. 그럼 존댓말로 할게요. 막히면 [F] 로 불러 줘요. 제가 뭘 물어보면 [Y] · [N] 으로 답하면 돼요.",
      "오메, 좋아! 그럼 편하게 할게잉. 막히면 [F] 눌러서 나 불러. 내가 뭐 물어보면 [Y] · [N] 으로 답하면 돼.",
    ],
  ],
  /** 이어 하기 등 이미 말투를 정한 뒤 다시 만났을 때 */
  greet: [
    [
      "저는 곁에서 같이 갈게요. 걷기는 W A S D, 달리기는 Shift, 점프는 Space, 앉기는 [C] 예요. 살펴보고 쓸 때는 [E], 마우스가 풀리면 [T] 를 눌러요. 막히면 [F] 로 저를 불러 줘요.",
      "나는 곁에서 같이 갈게잉. 걷기는 W A S D, 달리기는 Shift, 점프는 Space, 앉기는 [C] 야. 살펴보고 쓸 때는 [E], 마우스가 풀리면 [T] 를 눌러. 막히면 [F] 로 나 불러.",
    ],
  ],
  /** 첫 물건을 얻었을 때 한 번 — 조작 규칙 */
  firstItem: [
    [
      "챙긴 물건은 숫자키나 [I] 소지품에서 꺼내야 손에 들려요. 빈손으로 [E] 를 눌러도 가진 게 떨어지지 않으니 걱정하지 않아도 돼요.",
      "챙긴 물건은 숫자키나 [I] 소지품에서 꺼내야 손에 들려. 빈손으로 [E] 를 눌러도 가진 게 안 떨어지니까 걱정 마잉.",
    ],
  ],
  /** 하나씩 채워 가는 퍼즐에서 하나를 더 해냈다 — 남은 수(둘 · 셋 · 넷 · 다섯)마다 한 문장. 하나 남았을 때는 progressLast */
  progress: [
    ["좋아요, 이제 둘 남았어요.", "좋아, 이제 둘 남았당께."],
    ["잘하고 있어요. 셋만 더 하면 돼요.", "잘하고 있어잉. 셋만 더 하면 돼."],
    ["그렇죠! 넷 남았어요.", "그렇제! 넷 남았어."],
    ["좋아요, 다섯 남았어요.", "좋아, 다섯 남았어."],
  ],
  progressLast: [
    ["하나만 더 하면 돼요!", "하나만 더 하면 된당께!"],
    ["거의 다 됐어요. 딱 하나 남았어요.", "거의 다 됐어. 딱 하나 남았제."],
  ],
  /** 조개 구멍에서 게한테 물렸다 */
  pinched: [
    ["앗, 게한테 물렸네요. 손은 괜찮아요?", "워매, 게한테 물렸네! 손은 괜찮어?"],
    [
      "이런, 또 게예요… 우리 그런 구멍은 이제 그만 건드리기로 해요.",
      "아따, 또 게네… 그런 구멍은 이제 그만 건드리자잉. 게도 네 얼굴 외우겠당께.",
    ],
    [
      "게들이 오늘 유난히 사납네요. 저라도 화났을 거예요.",
      "게들이 오늘 유난히 사납구만. 자던 집을 파 대면 나라도 화났을 것 같어.",
    ],
  ],
  /** 한참 못 풀고 있을 때 — 힌트를 바로 주지 않고 도울지 먼저 묻는다 */
  offerHelp: [
    ["여기서 조금 막힌 것 같아요. 제가 도와 드릴까요?", "여기서 쪼끔 막힌 것 같네. 내가 도와줄까?"],
    ["아직 안 풀렸죠? 조금만 도와 드릴까요?", "아직 안 풀렸제? 쪼끔만 도와줄까?"],
    ["꽤 오래 붙들고 있네요. 이번엔 제가 도와 드릴까요?", "꽤 오래 붙들고 있네잉. 이번엔 내가 도와줄까?"],
  ],
  /** 틀리기를 되풀이할 때 */
  offerAfterWrong: [
    ["괜찮아요, 그럴 수 있어요. 조금 도와 드릴까요?", "괜찮어, 그럴 수 있제. 쪼끔 도와줄까?"],
    ["자꾸 어긋나네요. 제가 조금 도와 드릴까요?", "자꾸 어긋나네잉. 내가 쪼끔 도와줄까?"],
  ],
  /** [F] 로 말을 걸었을 때 */
  menu: [["네, 뭐가 궁금해요?", "응, 뭐가 궁금해?"]],
  hintOffer: [["조금 더 알려 드릴까요?", "조금 더 알려 줄까?"]],
  hintDeclined: [["알겠어요. 필요하면 [F] 로 불러 줘요.", "알았어. 필요하면 [F] 로 불러잉."]],
} as const satisfies Record<string, Ladder>;

export type GeneralKind = keyof typeof GENERAL_LINES;
/** 초안 쪽 공통 묶음 이름(상황 대사 · 잡담) — 글은 draftLines.ts */
export type DraftGeneralKind =
  | "stuck"
  | "wrong"
  | "astray"
  | "dropped"
  | "unpicked"
  | "idle"
  | "missing"
  | "breath"
  | "sentBack"
  | "solved"
  | "chatter"
  | "chatterNaju"
  | "chatterDock"
  | "chatterRock"
  | "chatterCave"
  | "chatterRidge";

const generalLadder = (kind: string): Ladder | undefined =>
  kind in GENERAL_LINES ? GENERAL_LINES[kind as GeneralKind] : drafts?.general[kind];

/**
 * [F] 보기 「여기서 뭘 해야 해요?」의 대답 — 안내판도 첫 설명 대사도 없는 목표에 둔다. 이 줄이 없으면 그 목표에서는 보기가 뜨지 않는다.
 * 할 일의 이름까지만 말한다. 푸는 법은 「힌트를 주세요」가 맡는다.
 * 대화를 이어 가는 화면 쪽 고정 문구다(계약 v0.4.16 §9) — 승인 대상 대사(draftLines.ts)와 섞지 않으려고 따로 둔다.
 */
export const WHAT_TO_DO: Partial<Record<ObjectiveId, Toned>> = {
  S1_SMOKE: [
    "연기가 화살표로 모였어요. 그 화살표를 따라가는 게 지금 할 일이에요.",
    "연기가 화살표로 모였네. 그 화살표를 따라가는 게 지금 할 일이제.",
  ],
  P05: [
    "소반 둘레의 자리마다 돌탑을 세우는 곳이에요. 돌탑마다 제자리가 따로 있어요.",
    "소반 둘레 자리마다 돌탑을 세우는 곳이제. 돌탑마다 제자리가 따로 있어.",
  ],
  S2_OFFER: [
    "소반에 제물을 올리는 곳이에요. 올릴 것은 우리가 지나온 길에서 챙긴 것들이에요.",
    "소반에 제물을 올리는 곳이제. 올릴 건 지나온 길에서 챙긴 것들이야.",
  ],
  S2_ENTER: [
    "강물이 갈라져 강바닥에 길이 났어요. 그 길로 들어가는 게 지금 할 일이에요.",
    "강물이 갈라져서 강바닥에 길이 났네. 그 길로 들어가는 게 지금 할 일이제.",
  ],
  S3_SCALE: [
    "돌판에 눈물 모양 자국이 패어 있어요. 그 자국에 꼭 맞는 것을 채우는 곳이에요.",
    "돌판에 눈물 모양 자국이 패어 있어. 그 자국에 꼭 맞는 걸 채우는 곳이제.",
  ],
  S3_KEY: [
    "자물통이 채워진 함을 여는 차례예요. 맞는 열쇠가 있어야 열려요.",
    "자물통 채워진 함을 여는 차례야. 맞는 열쇠가 있어야 열린당께.",
  ],
  S3_RIFT: [
    "두 장승 사이에 틈이 열렸어요. 그 틈을 지나가는 게 여기서 할 일이에요.",
    "두 장승 사이에 틈이 열렸네. 그 틈을 지나가는 게 여기서 할 일이제.",
  ],
};

/** WHAT_TO_DO 줄의 종류 이름 — line_id 와 분류에 쓴다 */
const WHAT_KIND = "what";

export interface PickedLine {
  /** NUDGE_P01_HELP_1_J — 서버 npc.json 의 line_id 규칙(대문자 · 숫자 · 밑줄)과 같다. 끝의 J · B 는 말투 */
  id: string;
  text: string;
  /** 사다리의 마지막 칸인가 — 더 물어도 같은 말이다 */
  isLast: boolean;
  /**
   * 승인을 기다리는 초안(퍼즐 넛지 · 상황 대사 · 잡담)인가. 계약 v0.4.16 §9: 배포판의 동행 대사는 서버 승인 원문뿐이라
   * 이 줄은 미리 보기에서만 화면에 낸다. FE 문구(대화 진행 · 「여기서 뭘 해야 해요?」 대답)는 false
   */
  isDraft: boolean;
}

const idPart = (value: string) =>
  value
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toUpperCase();

export const lineId = (scope: string, kind: string, index: number, mark = "") =>
  `NUDGE_${idPart(scope)}_${idPart(kind)}_${index + 1}${mark}`;

const fill = (text: string, vars: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);

function pickFrom(scope: string, kind: string, ladder: Ladder, step: number, vars: Record<string, string>): PickedLine {
  const index = Math.min(Math.max(0, step), ladder.length - 1);
  const line = ladder[index];
  return {
    id: lineId(scope, kind, index, toneMark(line)),
    text: fill(textOf(line), vars),
    isLast: index >= ladder.length - 1,
    isDraft: APPROVAL_CATEGORIES.includes(categoryOf(scope, kind)),
  };
}

/**
 * 목표 · 상황 · 몇 번째인지로 지금 말투의 대사를 고른다. 목표에 그 상황의 말이 없으면 공통 대사로 간다.
 * step 이 사다리를 넘으면 마지막 칸에 머문다(isLast).
 */
export function pickLine(
  objective: ObjectiveId | null,
  kind: SituationKind,
  step: number,
  vars: Record<string, string> = {},
): PickedLine | null {
  const own = objective ? drafts?.objective[objective][kind] : undefined;
  if (own?.length) return pickFrom(objective as string, kind, own, step, vars);
  const general = generalLadder(kind);
  return general?.length ? pickFrom("GENERAL", kind, general, step, vars) : null;
}

/** 구역마다 그곳에서만 하는 잡담 묶음. 마을 · 강바람 이야기(chatterNaju)는 물 밖에서만 한다 */
const LOCAL_CHATTER: Record<Stage, readonly DraftGeneralKind[]> = {
  dock: ["chatterDock", "chatterNaju"],
  rock: ["chatterRock", "chatterNaju"],
  cave: ["chatterCave"],
  ridge: ["chatterRidge", "chatterNaju"],
};

/**
 * 잡담 — 어디서나 하는 말과 지금 있는 구역의 말을 번갈아 차례로 돈다.
 * 다른 구역의 말은 꺼내지 않는다(물속에서 강바람 이야기를 하지 않게).
 */
export function pickChatter(turn: number, stage: Stage): PickedLine | null {
  const local = LOCAL_CHATTER[stage].flatMap((kind) =>
    (generalLadder(kind) ?? []).map((_, index) => [kind, index] as const),
  );
  const general = (generalLadder("chatter") ?? []).map((_, index) => ["chatter", index] as const);
  if (!local.length || !general.length) return null;
  const half = Math.floor(turn / 2);
  const [kind, index] = turn % 2 === 0 ? general[half % general.length] : local[half % local.length];
  return pickDraftGeneral(kind, index);
}

/** FE 문구 한 줄 — 늘 있다 */
export function pickGeneral(kind: GeneralKind, step = 0, vars: Record<string, string> = {}): PickedLine {
  return pickFrom("GENERAL", kind, GENERAL_LINES[kind], step, vars);
}

/** 초안 쪽 공통 대사 한 줄 — 초안이 안 올라왔으면(운영 빌드) null */
export function pickDraftGeneral(kind: DraftGeneralKind, step = 0): PickedLine | null {
  const ladder = drafts?.general[kind];
  return ladder?.length ? pickFrom("GENERAL", kind, ladder, step, {}) : null;
}

/** 돌려 쓰는 공통 대사 — 사다리와 달리 끝에 머물지 않고 처음으로 돌아간다. 줄 수가 바뀌어도 부르는 쪽은 그대로다 */
export function rotateGeneral(kind: GeneralKind | DraftGeneralKind, turn: number): PickedLine | null {
  const ladder = generalLadder(kind);
  return ladder?.length ? pickFrom("GENERAL", kind, ladder, turn % ladder.length, {}) : null;
}

/** 그 잡담 묶음을 말하는 구역들. 어디서나 하는 잡담이면 빈 목록 */
export function chatterZones(kind: string): Stage[] {
  return (Object.keys(LOCAL_CHATTER) as Stage[]).filter((stage) =>
    (LOCAL_CHATTER[stage] as readonly string[]).includes(kind),
  );
}

/** 그 목표가 무엇을 하는 곳인지 한 줄(WHAT_TO_DO). 안내판이나 첫 설명 대사가 있는 목표는 null */
export function whatToDo(objective: ObjectiveId): PickedLine | null {
  const line = WHAT_TO_DO[objective];
  return line
    ? { id: lineId(objective, WHAT_KIND, 0, toneMark(line)), text: textOf(line), isLast: true, isDraft: false }
    : null;
}

/** 그 목표에 따로 써 둔 대사만 — 공통 대사로 넘어가지 않는다 */
export function ownLines(objective: ObjectiveId, kind: SituationKind): PickedLine[] {
  const ladder = drafts?.objective[objective][kind] ?? [];
  return ladder.map((_, index) => pickFrom(objective, kind, ladder, index, {}));
}

/**
 * 콘텐츠로 옮길 때의 자리(계약 v0.4.16 §6).
 *   퍼즐 넛지 → puzzles[].nudges   상황 대사 → situations[].lines[]   일반 잡담 · 나주 잡담 → general_nudges
 *   FE 문구 → 서버로 가지 않는다. 화면 쪽에 그대로 두는 고정 문구라 승인 대상이 아니다
 */
export type LineCategory = "퍼즐 넛지" | "상황 대사" | "일반 잡담" | "나주 잡담" | "FE 문구";

/** 승인을 받는 분류 — 서버 콘텐츠로 옮겨지는 것들 */
export const APPROVAL_CATEGORIES: readonly LineCategory[] = ["퍼즐 넛지", "상황 대사", "일반 잡담", "나주 잡담"];

/**
 * 대화를 이어 가는 말과 진행 알림 — 상황을 감지해 하는 말이 아니라 화면이 대화의 차례에 맞춰 하는 말이다.
 * 인사 · 말투 · [F] 보기와 그 대답 · 도울지 묻기 · 첫 물건 조작 안내 · 남은 수 · 게 물림.
 * 목표별 「여기서 뭘 해야 해요?」 대답(WHAT_TO_DO)도 같은 분류다.
 */
const FE_KINDS: ReadonlySet<string> = new Set<GeneralKind>([
  "opening",
  "toneAsk",
  "toneSet",
  "greet",
  "menu",
  "help",
  "helpEnd",
  "hintOffer",
  "hintDeclined",
  "firstItem",
  "progress",
  "progressLast",
  "pinched",
  "offerHelp",
  "offerAfterWrong",
]);

/** 서버에 등록되는 퍼즐(P번호)의 대사는 퍼즐 넛지, 잡담은 잡담, 대화 진행 문구는 FE 문구, 그 밖(걸음 · 공통 상황)은 상황 대사 */
export function categoryOf(scope: string, kind: string): LineCategory {
  if (kind === "chatter") return "일반 잡담";
  // 구역 잡담 · 나주 잡담은 이 케이스에서만 말이 된다
  if (kind.startsWith("chatter")) return "나주 잡담";
  if (kind === WHAT_KIND || (scope === "GENERAL" && FE_KINDS.has(kind))) return "FE 문구";
  return /^P\d/.test(scope) ? "퍼즐 넛지" : "상황 대사";
}

interface ListedLine {
  id: string;
  scope: string;
  kind: string;
  category: LineCategory;
  tone: Tone | "both";
  text: string;
}

/** 공통 묶음의 원래 차례 — 내보내기(tools/export-npc-lines.mjs) 문서가 둘로 나누기 전과 같은 차례로 나오게 */
const GENERAL_ORDER: readonly string[] = [
  "help",
  "helpEnd",
  "stuck",
  "wrong",
  "astray",
  "dropped",
  "unpicked",
  "idle",
  "missing",
  "breath",
  "sentBack",
  "solved",
  "opening",
  "toneAsk",
  "toneSet",
  "greet",
  "firstItem",
  "chatter",
  "chatterNaju",
  "chatterDock",
  "chatterRock",
  "chatterCave",
  "chatterRidge",
  "progress",
  "progressLast",
  "pinched",
  "offerHelp",
  "offerAfterWrong",
  "menu",
  "hintOffer",
  "hintDeclined",
];

/** 대사 전부(두 말투 모두) — 검사 · 내보내기용. 초안은 registerDraftLines 로 넣었을 때만 */
export function allLines(): ListedLine[] {
  const lines: ListedLine[] = [];
  const add = (scope: string, kind: string, ladder: Ladder) =>
    ladder.forEach((line, index) => {
      if (typeof line === "string") {
        lines.push({
          id: lineId(scope, kind, index),
          scope,
          kind,
          category: categoryOf(scope, kind),
          tone: "both",
          text: line,
        });
        return;
      }
      for (const as of ["polite", "casual"] as const)
        lines.push({
          id: lineId(scope, kind, index, toneMark(line, as)),
          scope,
          kind,
          category: categoryOf(scope, kind),
          tone: as,
          text: textOf(line, as),
        });
    });
  for (const [scope, kinds] of Object.entries(drafts?.objective ?? {}))
    for (const [kind, ladder] of Object.entries(kinds)) add(scope, kind, ladder);
  for (const [scope, line] of Object.entries(WHAT_TO_DO)) add(scope, WHAT_KIND, [line]);
  // 내보내기 문서의 차례는 둘로 나누기 전(#52)과 같게 — FE 문구와 초안이 섞여 있던 원래 차례
  const general: Record<string, Ladder> = { ...GENERAL_LINES, ...drafts?.general };
  const order = (kind: string) => (GENERAL_ORDER.indexOf(kind) + 1 || Infinity) as number;
  for (const kind of Object.keys(general).sort((a, b) => order(a) - order(b))) add("GENERAL", kind, general[kind]);
  return lines;
}
