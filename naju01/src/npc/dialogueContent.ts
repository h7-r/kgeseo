// NPC 대사 콘텐츠 목록 · 유형 — 「무엇을 말해도 되는가」의 기준 데이터. 순수 모듈.
//
// [유형] ambient(일반 동행 · 상황 반응) · help_offer(도움 제안을 수락했을 때의 일반 반응) · puzzle_hint(실제 퍼즐 진행에 영향을 주는 힌트).
//   hint_offer 는 「대화를 연 까닭(intent)」이고 puzzle_hint 는 「대사 내용의 유형」이다 — 다르다. hint_offer 대화에서도 내보낼 수 있는 것은 help_offer 뿐이다.
// [승인 대사] 게임에 내보내는 기준은 사전 승인된 대사(id)다. AI 는 line_id 로 승인 대사를 고르고, 화면에는 목록의 문장이 나온다(AI 문장이 아니라).
//   reviewed=false 인 대사는 승인 전이라 내보내지 않는다. 기본 목록(NAJU_DIALOGUE_CATALOG)에는 아직 검수된 대사가 없다 — 기획 확정 전.
// [비밀] secrets 는 아직 드러나면 안 되는 말(미발견 단서 이름 · 정답 · 숨은 반전)의 표현 목록이다. 요청에 섞이지 않았는지, 자유 문장에 나오지 않았는지
//   보는 데 쓴다. 표현 목록 대조라 다른 말로 바꾼 표현은 놓친다 — 이것만으로 스포일러를 막았다고 보지 않는다(기본은 자유 문장을 아예 내보내지 않는다).
//   실제 나주 퍼즐 · 정답 데이터는 없다 — 기본 목록의 secrets 는 비어 있다(지어내지 않는다).
import { ZONES } from "../plan/sitePlan";
import type { NpcAiInput } from "./npcAiInput";
import { createScriptedDialogueProvider, type NpcDialogueProvider } from "./npcDialogue";

export type DialogueContentType = "ambient" | "help_offer" | "puzzle_hint";
export const DIALOGUE_CONTENT_TYPES: readonly DialogueContentType[] = ["ambient", "help_offer", "puzzle_hint"];

export interface ApprovedLine {
  id: string;
  type: DialogueContentType;
  text: string;
  /** 검수를 마쳤는지 — false 면 게임에 내보내지 않는다 */
  reviewed: boolean;
  /** 이 대사를 써도 되는 게임 상태 (모두 만족해야 한다) */
  conditions?: {
    /** 플레이어가 이 구역 중 하나에 있어야 */
    zones?: readonly string[];
    /** 이 단서 열쇠를 모두 발견했어야 (stage.seenClues 열쇠) */
    requiresClues?: readonly string[];
    /** 이 씬을 모두 끝냈어야 */
    requiresScenes?: readonly number[];
  };
}

export interface SecretTerm {
  id: string;
  kind: "clue" | "answer" | "twist";
  /** 알려진 표현들 — 이 표현만 찾는다(다른 말로 바꾼 표현은 놓친다) */
  terms: readonly string[];
  /** 이 조건이 되면 더는 비밀이 아니다 (없으면 늘 비밀) */
  revealedBy?: { clueKey?: string; scene?: number };
}

/** 「완료했다」고 말하면 안 되는 일 — 해당 씬을 끝내기 전에는 이 표현이 나오면 상태와 모순 */
export interface CompletionClaim {
  id: string;
  terms: readonly string[];
  requiresScene: number;
}

export interface DialogueCatalog {
  /** 어떤 목록인지 — 검사 전용 가상 목록과 섞이지 않게 */
  id: string;
  lines: readonly ApprovedLine[];
  secrets: readonly SecretTerm[];
  claims: readonly CompletionClaim[];
  /** 게임에 있는 구역 코드 — 없는 구역을 말하면 지어낸 정보 */
  knownZones: readonly string[];
}

/** 기본 목록 — 실제 나주 게임용. 기획에서 검수한 대사 · 퍼즐 · 단서 데이터가 아직 없어 비어 있다 */
export const NAJU_DIALOGUE_CATALOG: DialogueCatalog = {
  id: "naju/0 (검수 대사 없음)",
  lines: [],
  secrets: [],
  claims: [],
  knownZones: ZONES.map((z) => z.code),
};

/** 비교용 정규화 — 공백 · 문장 부호를 빼고 소문자 */
export function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[\s.,!?·…'"“”‘’()[\]{}~\-_/\\:;]+/g, "");
}

/** 지금 상태에서 아직 비밀인지 */
export function isSecretActive(secret: SecretTerm, input: NpcAiInput | null): boolean {
  const r = secret.revealedBy;
  if (!r) return true;
  if (!input) return true;
  if (r.clueKey && input.progress.discovered_clues.includes(r.clueKey)) return false;
  if (r.scene !== undefined && input.progress.cleared_scenes.includes(r.scene)) return false;
  return true;
}

/** 승인 대사의 조건이 지금 상태에서 맞는지. 맞지 않으면 그 이유 */
export function lineConditionProblem(line: ApprovedLine, input: NpcAiInput | null): string | null {
  const c = line.conditions;
  if (!c) return null;
  if (!input) return "게임 상태 모름";
  if (c.zones && !(input.player.zone && c.zones.includes(input.player.zone)))
    return `구역 ${input.player.zone ?? "모름"} ∉ ${c.zones.join("/")}`;
  for (const key of c.requiresClues ?? [])
    if (!input.progress.discovered_clues.includes(key)) return `단서 ${key} 미발견`;
  for (const n of c.requiresScenes ?? []) if (!input.progress.cleared_scenes.includes(n)) return `씬 ${n} 미완료`;
  return null;
}

/** 대화를 연 까닭에 따라 내보낼 수 있는 유형 — puzzle_hint 는 어디에도 없다 */
export function allowedContentTypes(intent: "manual" | "hint_offer"): readonly DialogueContentType[] {
  return intent === "hint_offer" ? ["help_offer"] : ["ambient"];
}

/**
 * 요청 검사 — 모델에 보내는 요청에 아직 비밀인 말이 섞였으면 그 비밀 id 를 돌려준다(보내지 않는다).
 * ai_input 은 원래 발견한 단서만 담지만(추적기), 목록 기준으로 한 번 더 막는다.
 */
export function requestSecretLeak(
  requestJson: string,
  input: NpcAiInput | null,
  catalog: DialogueCatalog,
): string | null {
  const flat = normalizeForMatch(requestJson);
  for (const s of catalog.secrets) {
    if (!isSecretActive(s, input)) continue;
    if (s.terms.some((t) => flat.includes(normalizeForMatch(t)))) return s.id;
  }
  return null;
}

/**
 * 검수된 대사로만 답하는 fallback 공급자 — 그 유형 · 지금 상태에 맞는 reviewed 대사를 차례로. 하나도 없으면 base(지금의 임시 고정 대사)로.
 * 기본 목록엔 검수 대사가 없어 게임에서는 base 가 쓰인다.
 */
export function createCatalogFallbackProvider(
  catalog: DialogueCatalog,
  type: DialogueContentType,
  base: NpcDialogueProvider,
): NpcDialogueProvider {
  // 상태 조건은 그 차례 맥락의 AI 입력(context.aiInput)으로 본다
  const pick = (input: NpcAiInput | null) =>
    catalog.lines.filter((l) => l.type === type && l.reviewed && lineConditionProblem(l, input) === null);
  return {
    open: async (context, signal) => {
      const lines = pick(context.aiInput ?? null);
      if (!lines.length) return base.open(context, signal);
      return createScriptedDialogueProvider(lines.map((l) => l.text)).open(context, signal);
    },
    next: async (context, signal) => {
      const lines = pick(context.aiInput ?? null);
      if (!lines.length) return base.next(context, signal);
      return createScriptedDialogueProvider(lines.map((l) => l.text)).next(context, signal);
    },
  };
}
