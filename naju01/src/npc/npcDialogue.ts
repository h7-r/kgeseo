// NPC 대사 공급자 — 대화창(dialogSession)과 대사 출처를 떼어 둔다. 지금은 고정 대사만 쓴다(AI 모델·API 는 연결하지 않음).
// 나중에 백엔드 응답 공급자를 같은 인터페이스로 끼우면 대화창·FSM 쪽은 그대로다.
// NPC 이름·대사는 기획에서 정해지지 않았다 — 기본값은 「임시」임이 드러나게 두고, 설정으로 주입한다.
import type { NpcAiInput } from "./npcAiInput";

export interface NpcLine {
  /** 말하는 이름. 없으면 세션의 기본 이름 */
  speaker?: string;
  text: string;
  /** 이 대사가 마지막이면 true — 다음 입력에 대화를 끝낸다 */
  last?: boolean;
}

/** 대화를 연 까닭 — manual: 플레이어가 [F] 대화 · hint_offer: [F] 도움 제안을 수락 */
export type DialogIntent = "manual" | "hint_offer";

/** 공급자가 받는 맥락. 읽기만 한다 */
export interface NpcDialogueContext {
  /** 대화 세션 번호 (열 때마다 하나씩) */
  sessionId: number;
  /** 이 세션에서 몇 번째 대사를 달라는지 (0 = 첫 대사) */
  turn: number;
  /** NPC 기본 이름 */
  speaker: string;
  /** 지금 관측값 (거리 · 구역 · 최근 게임 이벤트) — 훅이 채운다. 없을 수 있다 */
  observation: NpcDialogueObservation | null;
  /** 대화를 연 까닭 (9단계 추가 · 선택). 없으면 manual 로 본다 */
  intent?: DialogIntent;
  /** npc_ai_input/0.1 스냅숏 (10단계 추가 · 선택) — AI 공급자가 요청에 싣는다. 고정 대사 공급자는 쓰지 않는다 */
  aiInput?: NpcAiInput | null;
}

export interface NpcDialogueObservation {
  distance: number;
  zone: string | null;
  recentEvents: readonly string[];
}

export interface NpcDialogueProvider {
  /** 첫 대사. signal 이 끊기면(닫힘 · 시간 초과) 결과는 버려진다 */
  open(context: NpcDialogueContext, signal: AbortSignal): Promise<NpcLine>;
  /** 다음 대사. null 이면 대화 끝 */
  next(context: NpcDialogueContext, signal: AbortSignal): Promise<NpcLine | null>;
}

export interface NpcDialogueConfig {
  /** 대화창에 보이는 이름 */
  name: string;
  /** 고정 대사 (차례대로) */
  lines: readonly string[];
}

/** 기본값 — 기획 확정 전 임시. 실제 이름·대사는 설정으로 넘긴다 */
export const PLACEHOLDER_DIALOGUE: NpcDialogueConfig = {
  name: "NPC (임시)",
  lines: ["(임시 대사) 여기 있어.", "(임시 대사) 대사는 아직 정해지지 않았어."],
};

/**
 * 도움 제안을 수락했을 때의 임시 대사 — 퍼즐 힌트가 아니다(퍼즐 · 힌트 데이터가 아직 없다). 검수 전 자리채움이고,
 * 정답 · 단서 · 길을 알려 주지 않는 말만 둔다. 실제 대사는 dialogue.helpLines 로 넘긴다.
 */
export const PLACEHOLDER_HELP_LINES: readonly string[] = [
  "(임시 도움 대사) 도와줄 수 있는 게 있으면 좋겠는데…",
  "(임시 도움 대사) 힌트는 아직 준비되지 않았어. 천천히 해도 괜찮아.",
];

/** 고정 대사 공급자: lines 를 차례대로 돌려주고, 마지막 대사에 last 를 붙인다 */
export function createScriptedDialogueProvider(lines: readonly string[]): NpcDialogueProvider {
  const lineAt = (turn: number): NpcLine | null =>
    turn < lines.length ? { text: lines[turn], last: turn === lines.length - 1 } : null;
  return {
    open: async (context) => lineAt(0) ?? { text: "…", last: true, speaker: context.speaker },
    next: async (context) => lineAt(context.turn),
  };
}
