// 행동 판단 평가셋 30 사례 — 합성 시나리오. 입력은 실제 추적기 · AI 입력 생성기로 대본을 돌려 만든다(playScript).
// 기대 레이블은 규칙 계산 결과에서 만들지 않았다: 각 사례의 rationale 에 적은 플레이어 경험 · 게임 진행 관점으로 따로 붙인 **초안**이다.
// 사람 검토 전에는 정답 데이터가 아니다(labelStatus "draft"). npc_ai_input/0.1 에 없는 정보는 evalOnly 에만 적고, 기대값이 그 정보에
// 달린 사례는 runtimeJudgeable=false 로 지표에서 뺀다. 시간은 놀이 시간(초).
import type { BehaviorEvalCase, PolicyHistoryEvent } from "../behaviorEval";
import type { HelpContext } from "../helpPolicy";
import type { HelpAction } from "../helpPolicy";
import type { PlayerAssessmentState } from "../npcAssessment";
import { playScript, type ScriptStep } from "./assessmentScenarios";

const OK: HelpContext = {
  sceneActive: true,
  pointerLocked: true,
  cutActive: false,
  dialogOpen: false,
  canInteract: true,
  interactionBlock: null,
};

/** a ↔ b 왕복 count 번 (period 초씩) */
const pingPong = (a: string, b: string, count: number, period: number, moving = true): ScriptStep[] =>
  Array.from({ length: count }, (_, i) => ({ seconds: period, zone: i % 2 === 0 ? b : a, moving }));
/** 구역 목록을 rounds 바퀴 돈다 */
const cycle = (zones: string[], rounds: number, period: number): ScriptStep[] =>
  Array.from({ length: zones.length * rounds }, (_, i) => ({ seconds: period, zone: zones[i % zones.length] }));

/** 정체 + 두 구역 왕복 (진행 뒤 약 600 s) — 여러 사례의 공통 바탕 */
const STALL_PINGPONG: ScriptStep[] = [{ seconds: 30, zone: "Z1", events: ["clue"] }, ...pingPong("Z1", "Z2", 10, 60)];
/** 정체 + 세 구역 순환 (약 900 s) */
const STALL_CYCLE: ScriptStep[] = [{ seconds: 60, zone: "Z1" }, ...cycle(["Z2", "Z3", "Z1"], 5, 56)];

interface Spec {
  id: string;
  category: string;
  description: string;
  script: ScriptStep[];
  context?: Partial<HelpContext>;
  history?: PolicyHistoryEvent[];
  expectedState: PlayerAssessmentState | null;
  expectedAction: HelpAction | null;
  rationale: string;
  limitations?: string;
  runtimeJudgeable?: boolean;
  evalOnly?: Record<string, string | number | boolean>;
  labelNote?: string;
}

const SPECS: Spec[] = [
  // ── A 정상 탐색 ──
  {
    id: "A01-explore-early",
    category: "정상 탐색",
    description: "시작 100 s 뒤 단서 발견, 다음 구역으로 이동해 100 s 탐색",
    script: [
      { seconds: 100, zone: "Z1" },
      { seconds: 100, zone: "Z2", events: ["clue"] },
    ],
    expectedState: "EXPLORING",
    expectedAction: "WAIT",
    rationale: "100 s 전에 진행이 있었고 새 구역을 둘러보는 중 — 도움이 필요한 신호가 없다",
  },
  {
    id: "A02-explore-steady",
    category: "정상 탐색",
    description: "600 s 동안 단서 · 씬 · 단서를 차례로 얻으며 세 구역을 다님, 마지막 진행 100 s 전",
    script: [
      { seconds: 150, zone: "Z1" },
      { seconds: 200, zone: "Z2", events: ["clue"] },
      { seconds: 150, zone: "Z3", events: ["scene"] },
      { seconds: 100, zone: "Z1", events: ["clue"] },
    ],
    expectedState: "EXPLORING",
    expectedAction: "WAIT",
    rationale: "진행이 꾸준하다. 이전 구역으로 돌아온 것도 진행 직후라 자연스러운 이동",
  },
  {
    id: "A03-explore-tour",
    category: "정상 탐색",
    description: "진행 없이 400 s 지났지만 처음 가는 구역 넷을 차례로 돌았고 마지막 새 구역이 100 s 전",
    script: [
      { seconds: 100, zone: "Z1" },
      { seconds: 100, zone: "Z2" },
      { seconds: 100, zone: "Z3" },
      { seconds: 100, zone: "Z4" },
    ],
    expectedState: "EXPLORING",
    expectedAction: "WAIT",
    rationale: "맵을 처음 훑는 단계 — 진행이 없어도 새 곳을 보고 있어 막힌 것이 아니다",
  },
  {
    id: "A04-explore-one-zone",
    category: "정상 탐색",
    description: "한 구역 안에서 350 s 동안 계속 걸으며 살핌, 진행 · 구역 이동 없음",
    script: [{ seconds: 350, zone: "Z1" }],
    expectedState: "EXPLORING",
    expectedAction: "WAIT",
    rationale: "한 구역을 꼼꼼히 조사하는 중일 수 있다. 6 분 남짓은 막힘으로 단정하기 이르다",
    labelNote: "경계 — 더 길어지면 막힘일 수 있다(같은 구역 안 맴돌기는 구역 단위 입력으로는 구분이 어렵다)",
  },
  // ── B 새 구역 진입 · 단서 발견 ──
  {
    id: "B05-new-zone-after-stall",
    category: "새 구역 · 단서",
    description: "320 s 동안 진행 없이 두 구역을 오가다가 30 s 전 처음 가는 Z3 에 들어섬",
    script: [
      { seconds: 200, zone: "Z1" },
      { seconds: 120, zone: "Z2" },
      { seconds: 30, zone: "Z3" },
    ],
    expectedState: "EXPLORING",
    expectedAction: "WAIT",
    rationale: "스스로 새 길을 찾았다 — 지금 끼어들면 발견의 흐름을 끊는다",
  },
  {
    id: "B06-clue-after-stuck",
    category: "새 구역 · 단서",
    description: "약 500 s 정체하며 왕복하다가 5 s 전 단서를 발견",
    script: [{ seconds: 30, zone: "Z1" }, ...pingPong("Z1", "Z2", 8, 60), { seconds: 5, events: ["clue"] }],
    expectedState: "EXPLORING",
    expectedAction: "WAIT",
    rationale: "막힘을 스스로 풀었다 — 방금 진행한 플레이어에게 도움 제안은 맞지 않다",
  },
  {
    id: "B07-blocker-cleared",
    category: "새 구역 · 단서",
    description: "약 400 s 정체 뒤 10 s 전 씬을 끝내 차단물이 무너짐",
    script: [
      { seconds: 60, zone: "Z1" },
      ...pingPong("Z1", "Z2", 6, 55),
      { seconds: 10, events: ["scene", "blocker"] },
    ],
    expectedState: "EXPLORING",
    expectedAction: "WAIT",
    rationale: "씬 완료 · 길이 열림 — 새 진행이 시작되는 시점",
  },
  // ── C 장시간 진행 정체 ──
  {
    id: "C08-stall-pingpong",
    category: "장시간 정체",
    description: "단서 하나 뒤 600 s 동안 진행 없이 Z1 ↔ Z2 를 10 번 오감, 계속 움직임",
    script: STALL_PINGPONG,
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "OFFER_HELP",
    rationale: "10 분 동안 이미 본 두 곳만 오간다 — 다음에 할 일을 못 찾은 전형적인 모습",
  },
  {
    id: "C09-stall-cycle",
    category: "장시간 정체",
    description: "진행 없이 900 s 동안 이미 가 본 세 구역을 다섯 바퀴 돎",
    script: STALL_CYCLE,
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "OFFER_HELP",
    rationale: "15 분째 같은 곳을 순환 — 새 정보 없이 헤매고 있다",
  },
  {
    id: "C10-stall-one-return",
    category: "장시간 정체",
    description: "진행 없이 500 s: Z1 → Z2 → Z1 로 한 번 돌아온 뒤 Z1 안에서 300 s 계속 걸음",
    script: [
      { seconds: 100, zone: "Z1" },
      { seconds: 100, zone: "Z2" },
      { seconds: 300, zone: "Z1", moving: true },
    ],
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "OFFER_HELP",
    rationale: "8 분 넘게 아무 진행 없이 이미 본 곳을 걷고 있다 — 플레이어 경험으로는 막힘에 가깝다",
    limitations: "구역 안에서 맴도는 정도는 입력에 없어 「한 번 돌아옴」만 보인다",
  },
  // ── D 동일 구역 반복 방문 ──
  {
    id: "D11-repeat-after-progress",
    category: "반복 방문",
    description: "100 s 전 씬을 끝낸 뒤 Z1 ↔ Z2 를 25 s 간격으로 네 번 오감",
    script: [{ seconds: 300, zone: "Z1" }, { seconds: 0, events: ["scene"] }, ...pingPong("Z1", "Z2", 4, 25)],
    expectedState: "EXPLORING",
    expectedAction: "WAIT",
    rationale: "진행 직후 물건을 가지러 오가는 듯한 이동 — 막힘 아님",
  },
  {
    id: "D12-repeat-early",
    category: "반복 방문",
    description: "진행 없이 280 s 동안 Z1 ↔ Z2 를 다섯 번 오감",
    script: [{ seconds: 20, zone: "Z1" }, ...pingPong("Z1", "Z2", 5, 52)],
    expectedState: "EXPLORING",
    expectedAction: "WAIT",
    rationale: "왕복이 잦지만 5 분이 안 됐다 — 아직 스스로 풀 시간을 준다",
    labelNote: "경계 — 막힘의 초기 징후일 수 있다",
  },
  {
    id: "D13-repeat-cycle",
    category: "반복 방문",
    description: "진행 없이 780 s 동안 Z2 · Z3 · Z1 을 네 바퀴 돎",
    script: [{ seconds: 60, zone: "Z1" }, ...cycle(["Z2", "Z3", "Z1"], 4, 60)],
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "OFFER_HELP",
    rationale: "13 분째 같은 순서로 같은 곳을 돈다",
  },
  // ── E 퍼즐 근처에서 막힘 ──
  {
    id: "E14-puzzle-hover",
    category: "퍼즐 근처",
    description: "진행 없이 420 s 동안 Z2 의 퍼즐 장치 주변만 맴돎(구역 이동 없음)",
    script: [{ seconds: 420, zone: "Z2" }],
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "OFFER_HELP",
    rationale: "퍼즐 앞에서 7 분 — 퍼즐에 막혔을 가능성이 높다",
    limitations:
      "퍼즐 장치와의 거리 · 머문 시간이 npc_ai_input/0.1 에 없다 — 입력으로는 「한 구역을 오래 둘러봄」과 구분할 수 없다",
    runtimeJudgeable: false,
    evalOnly: { nearPuzzle: true, secondsNearPuzzle: 400 },
  },
  {
    id: "E15-puzzle-wrong-answers",
    category: "퍼즐 근처",
    description: "180 s 동안 같은 퍼즐에 오답을 다섯 번 냄",
    script: [{ seconds: 180, zone: "Z2" }],
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "OFFER_HELP",
    rationale: "같은 퍼즐 오답이 거듭됨 — 시간은 짧아도 분명한 막힘",
    limitations: "나주에 퍼즐 장치가 없고 오답 수도 입력에 없다(백엔드 attempt_counts 미연동)",
    runtimeJudgeable: false,
    evalOnly: { wrongAttempts: 5, nearPuzzle: true },
  },
  {
    id: "E16-puzzle-new-clue",
    category: "퍼즐 근처",
    description: "퍼즐 장치 근처에서 300 s 머물다 10 s 전 단서를 얻음",
    script: [
      { seconds: 300, zone: "Z2" },
      { seconds: 10, events: ["clue"] },
    ],
    expectedState: "EXPLORING",
    expectedAction: "WAIT",
    rationale: "새 단서로 퍼즐을 다시 시도할 참 — 지금은 기다린다",
    limitations: "퍼즐 근처라는 정보는 없지만 기대값은 「방금 진행」만으로 정해진다",
    evalOnly: { nearPuzzle: true },
  },
  // ── F 장시간 유휴 (AFK 가능성) ──
  {
    id: "F17-afk-after-stuck",
    category: "장시간 유휴",
    description: "정체 · 왕복 뒤 마지막 300 s 동안 움직이지 않음",
    script: [
      { seconds: 30, zone: "Z1", events: ["clue"] },
      ...pingPong("Z1", "Z2", 5, 60),
      { seconds: 300, moving: false },
    ],
    expectedState: "INSUFFICIENT_DATA",
    expectedAction: "WAIT",
    rationale: "자리를 비웠을 수 있다 — 없는 사람에게 말을 걸지 않는다",
  },
  {
    id: "F18-afk-returned",
    category: "장시간 유휴",
    description: "정체 · 왕복 뒤 240 s 멈춰 있다가 10 s 전부터 다시 움직임",
    script: [
      { seconds: 30, zone: "Z1", events: ["clue"] },
      ...pingPong("Z1", "Z2", 6, 60),
      { seconds: 240, moving: false },
      { seconds: 10, moving: true },
    ],
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "OFFER_HELP",
    rationale: "돌아와 다시 헤매기 시작 — 진행은 여전히 없다",
  },
  {
    id: "F19-idle-from-start",
    category: "장시간 유휴",
    description: "시작부터 400 s 동안 거의 움직이지 않음",
    script: [{ seconds: 400, zone: "Z1", moving: false }],
    expectedState: "INSUFFICIENT_DATA",
    expectedAction: "WAIT",
    rationale: "플레이를 시작했다고 보기 어렵다 — 판단할 행동이 없다",
  },
  // ── G 개입 제한 (상태는 막힘, 끼어들 수 없음) ──
  {
    id: "G20-limit-dialog",
    category: "개입 제한",
    description: "C08 과 같은 막힘인데 대화 중",
    script: STALL_PINGPONG,
    context: { dialogOpen: true, canInteract: false },
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "WAIT",
    rationale: "이미 NPC 와 대화 중 — 그 위에 제안을 겹치지 않는다",
  },
  {
    id: "G21-limit-cutscene",
    category: "개입 제한",
    description: "C08 과 같은 막힘인데 구역 진입 컷 연출 중",
    script: STALL_PINGPONG,
    context: { cutActive: true, canInteract: false, interactionBlock: "cut" },
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "WAIT",
    rationale: "연출을 끊지 않는다",
  },
  {
    id: "G22-limit-unlocked",
    category: "개입 제한",
    description: "C08 과 같은 막힘인데 포인터 잠금이 풀림(메뉴 · 편집)",
    script: STALL_PINGPONG,
    context: { pointerLocked: false, canInteract: false, interactionBlock: "unlocked" },
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "WAIT",
    rationale: "플레이어가 게임 밖을 보고 있다",
  },
  {
    id: "G23-limit-far",
    category: "개입 제한",
    description: "C08 과 같은 막힘인데 NPC 가 멀거나 화면 밖",
    script: STALL_PINGPONG,
    context: { canInteract: false, interactionBlock: "too-far" },
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "WAIT",
    rationale: "말을 걸 수 없는 거리 — 안내를 띄워도 받을 수 없다",
  },
  // ── H 도움 제안 거절 뒤 ──
  {
    id: "H24-declined-recently",
    category: "거절 뒤",
    description: "C08 과 같은 막힘, 2 분 전 도움 제안을 거절함",
    script: STALL_PINGPONG,
    history: [
      { kind: "offer", secondsAgo: 125 },
      { kind: "decline", secondsAgo: 120 },
    ],
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "WAIT",
    rationale: "스스로 풀겠다는 뜻 — 곧바로 다시 묻지 않는다",
  },
  {
    id: "H25-declined-long-ago",
    category: "거절 뒤",
    description: "C09 와 같은 15 분 막힘, 거절은 11 분 반 전",
    script: STALL_CYCLE,
    history: [
      { kind: "offer", secondsAgo: 700 },
      { kind: "decline", secondsAgo: 690 },
    ],
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "OFFER_HELP",
    rationale: "거절 뒤 10 분 넘게 여전히 막혀 있다 — 한 번 더 조심스럽게 물어볼 만하다",
  },
  {
    id: "H26-declined-then-explored",
    category: "거절 뒤",
    description: "거절 3 분 뒤 처음 가는 Z3 에 60 s 전 들어섬",
    script: [
      { seconds: 30, zone: "Z1", events: ["clue"] },
      ...pingPong("Z1", "Z2", 6, 60),
      { seconds: 60, zone: "Z3" },
    ],
    history: [
      { kind: "offer", secondsAgo: 190 },
      { kind: "decline", secondsAgo: 180 },
    ],
    expectedState: "EXPLORING",
    expectedAction: "WAIT",
    rationale: "거절한 뒤 스스로 새 곳을 찾아 나섰다",
  },
  // ── I 도움 수락 뒤 ──
  {
    id: "I27-accepted-recently",
    category: "수락 뒤",
    description: "C08 과 같은 막힘, 1 분 전 도움을 받아들여 대화함",
    script: STALL_PINGPONG,
    history: [{ kind: "accept", secondsAgo: 60 }],
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "WAIT",
    rationale: "방금 도와줬다 — 그 도움을 시도해 볼 시간을 준다",
    limitations: "정책은 수락을 기록하지 않는다(제안 쿨다운만 걸린다)",
  },
  {
    id: "I28-accepted-no-effect",
    category: "수락 뒤",
    description: "C09 와 같은 15 분 막힘, 도움을 받아들인 지 4 분 지났는데 진행 없음",
    script: STALL_CYCLE,
    history: [{ kind: "accept", secondsAgo: 240 }],
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "OFFER_HELP",
    rationale: "받은 도움이 통하지 않았다 — 다시 제안할 만하다",
    limitations: "정책은 수락을 기록하지 않는다 — 「수락 뒤 다시 제안」 간격을 따로 정할 수 없다",
    labelNote: "다시 제안해야 하는지는 기획 판단이 필요하다",
  },
  // ── J 정보 부족 · 경계값 ──
  {
    id: "J29-too-short",
    category: "정보 부족 · 경계",
    description: "시작한 지 90 s",
    script: [{ seconds: 90, zone: "Z1" }],
    expectedState: "INSUFFICIENT_DATA",
    expectedAction: "WAIT",
    rationale: "판단할 만큼 플레이하지 않았다",
  },
  {
    id: "J30-stall-boundary",
    category: "정보 부족 · 경계",
    description: "진행 없이 정확히 300 s 동안 Z1 ↔ Z2 를 네 번 오감",
    script: [{ seconds: 20, zone: "Z1" }, ...pingPong("Z1", "Z2", 4, 70)],
    expectedState: "POSSIBLY_STUCK",
    expectedAction: "OFFER_HELP",
    rationale: "5 분 진행 없음 + 반복 왕복 — 막힘 기준에 막 닿았다",
    labelNote: "경계값 사례",
  },
];

export function buildBehaviorEvalCases(): BehaviorEvalCase[] {
  return SPECS.map((s) => ({
    id: s.id,
    category: s.category,
    description: s.description,
    input: playScript(s.script),
    context: { ...OK, ...s.context },
    history: s.history ?? [],
    expectedState: s.expectedState,
    expectedAction: s.expectedAction,
    rationale: s.rationale,
    limitations: s.limitations ?? "",
    runtimeJudgeable: s.runtimeJudgeable ?? true,
    evalOnly: s.evalOnly,
    labelStatus: "draft",
    labelNote: s.labelNote,
  }));
}
