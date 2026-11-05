// AI 대사 콘텐츠 정책 — 응답 형식 검증(validateAiDialogueResponse) 뒤에 「이 대사를 화면에 내보내도 되는가」를 정한다. 순수 함수 + 안전 공급자 공장.
//
// [허용] (1) 대사 유형을 밝혀야 한다(content_type). (2) puzzle_hint 는 늘 막는다(퍼즐 정의 · 힌트 해금 정보가 없다).
//   (3) 대화를 연 까닭과 맞아야 한다(manual → ambient · hint_offer → help_offer). (4) line_id 로 고른 승인 대사만 내보낸다:
//   목록에 있고 · 유형이 같고 · 검수됐고 · 지금 상태 조건(구역 · 발견 단서 · 끝낸 씬)이 맞을 때. 화면에는 목록의 문장이 나간다.
//   (5) 자유 문장(line_id 없음)은 기본으로 내보내지 않는다(FREE_TEXT_NOT_APPROVED).
// [선별] 자유 문장은 표현 목록 대조(screenFreeText)로 미발견 단서 · 정답 · 반전 · 상태 모순 · 없는 구역 · 힌트 말투를 찾아 개발 기록에 남긴다.
//   **이 대조는 완전하지 않다** — 다른 말로 바꾼 표현 · 목록에 없는 지어낸 정보는 놓친다. 그래서 자유 문장을 허용하는 설정(allowFreeText)은
//   평가 · 개발용이고, 게임 기본값은 false 다.
import {
  createAiDialogueProvider,
  AI_PROVIDER_CONFIG,
  type AiDialogueProvider,
  type AiDialogueTransport,
  type AiProviderConfig,
} from "./aiDialogueProvider";
import {
  allowedContentTypes,
  createCatalogFallbackProvider,
  isSecretActive,
  lineConditionProblem,
  NAJU_DIALOGUE_CATALOG,
  normalizeForMatch,
  requestSecretLeak,
  type DialogueCatalog,
  type DialogueContentType,
} from "./dialogueContent";
import type { NpcAiInput } from "./npcAiInput";
import type { DialogIntent, NpcDialogueProvider, NpcLine } from "./npcDialogue";

export type ContentRejection =
  | "MISSING_CONTENT_TYPE"
  | "PUZZLE_HINT_NOT_ALLOWED"
  | "TYPE_INTENT_MISMATCH"
  | "UNKNOWN_LINE_ID"
  | "LINE_TYPE_MISMATCH"
  | "UNREVIEWED_LINE"
  | "CONDITION_UNMET"
  | "FREE_TEXT_NOT_APPROVED"
  | "UNDISCOVERED_CLUE"
  | "ANSWER_LEAK"
  | "TWIST_LEAK"
  | "STATE_CONTRADICTION"
  | "INVENTED_INFO"
  | "HINT_LIKE";

export const CONTENT_POLICY_CONFIG = {
  /** 자유 문장을 내보낼지 — 평가 · 개발용. 게임 기본값은 false (승인 대사만) */
  allowFreeText: false,
  /** 검수된 대사만 내보낼지 */
  requireReviewed: true,
};
export type ContentPolicyConfig = typeof CONTENT_POLICY_CONFIG;

/** 형식 검증을 통과한 응답 */
export interface ContentCandidate {
  text: string;
  last: boolean;
  contentType: DialogueContentType | null;
  lineId: string | null;
}

export type ContentVerdict =
  | { allow: true; source: "catalog" | "free_text"; line: NpcLine; lineId: string | null }
  | { allow: false; reasons: readonly ContentRejection[]; details: readonly string[] };

// 힌트처럼 들리는 말투 — 일반 대사에 섞인 힌트를 잡으려는 것. 완전하지 않다
const HINT_LIKE = /(정답|비밀\s*번호|암호는|순서대로\s*(눌러|돌려)|하면\s*열려|답은)/;
const ZONE_CODE = /\bZ\d+\b/gi;

/** 자유 문장 선별 — 표현 목록 대조(완전하지 않음). 걸린 이유 · 근거 */
export function screenFreeText(text: string, input: NpcAiInput | null, catalog: DialogueCatalog) {
  const reasons: ContentRejection[] = [];
  const details: string[] = [];
  const flat = normalizeForMatch(text);
  for (const s of catalog.secrets) {
    if (!isSecretActive(s, input)) continue;
    const hit = s.terms.find((t) => flat.includes(normalizeForMatch(t)));
    if (!hit) continue;
    reasons.push(s.kind === "clue" ? "UNDISCOVERED_CLUE" : s.kind === "answer" ? "ANSWER_LEAK" : "TWIST_LEAK");
    details.push(`${s.id}: 「${hit}」`);
  }
  for (const c of catalog.claims) {
    if (input?.progress.cleared_scenes.includes(c.requiresScene)) continue;
    const hit = c.terms.find((t) => flat.includes(normalizeForMatch(t)));
    if (hit) {
      reasons.push("STATE_CONTRADICTION");
      details.push(`${c.id}: 씬 ${c.requiresScene} 미완료인데 「${hit}」`);
    }
  }
  for (const m of text.match(ZONE_CODE) ?? []) {
    if (!catalog.knownZones.includes(m.toUpperCase())) {
      reasons.push("INVENTED_INFO");
      details.push(`없는 구역 ${m}`);
    }
  }
  const hint = text.match(HINT_LIKE);
  if (hint) {
    reasons.push("HINT_LIKE");
    details.push(`힌트 말투 「${hint[0]}」`);
  }
  return { reasons: [...new Set(reasons)], details };
}

export function evaluateDialogueContent(
  candidate: ContentCandidate,
  intent: DialogIntent,
  input: NpcAiInput | null,
  catalog: DialogueCatalog = NAJU_DIALOGUE_CATALOG,
  config: ContentPolicyConfig = CONTENT_POLICY_CONFIG,
): ContentVerdict {
  const reasons: ContentRejection[] = [];
  const details: string[] = [];
  const type = candidate.contentType;
  if (!type) reasons.push("MISSING_CONTENT_TYPE");
  else if (type === "puzzle_hint") reasons.push("PUZZLE_HINT_NOT_ALLOWED");
  else if (!allowedContentTypes(intent).includes(type)) {
    reasons.push("TYPE_INTENT_MISMATCH");
    details.push(`${intent} 대화에 ${type}`);
  }
  if (candidate.lineId !== null) {
    const line = catalog.lines.find((l) => l.id === candidate.lineId);
    if (!line) {
      reasons.push("UNKNOWN_LINE_ID");
      details.push(candidate.lineId);
    } else {
      if (line.type === "puzzle_hint") reasons.push("PUZZLE_HINT_NOT_ALLOWED");
      else if (type && line.type !== type) reasons.push("LINE_TYPE_MISMATCH");
      if (config.requireReviewed && !line.reviewed) reasons.push("UNREVIEWED_LINE");
      const problem = lineConditionProblem(line, input);
      if (problem) {
        reasons.push("CONDITION_UNMET");
        details.push(problem);
      }
      if (!reasons.length)
        return { allow: true, source: "catalog", line: { text: line.text, last: candidate.last }, lineId: line.id };
    }
  } else {
    if (!config.allowFreeText) reasons.push("FREE_TEXT_NOT_APPROVED");
    const screen = screenFreeText(candidate.text, input, catalog);
    reasons.push(...screen.reasons);
    details.push(...screen.details);
    if (!reasons.length)
      return { allow: true, source: "free_text", line: { text: candidate.text, last: candidate.last }, lineId: null };
  }
  return { allow: false, reasons: [...new Set(reasons)], details };
}

export interface SafeAiDialogueProviderOptions {
  transport: AiDialogueTransport;
  /** 이 공급자가 맡는 대화 까닭 — 검수 대사 fallback 의 유형을 정한다 */
  intent: DialogIntent;
  /** 검수 대사가 하나도 없을 때 마지막으로 쓰는 고정 대사(지금의 임시 대사) */
  baseFallback: NpcDialogueProvider;
  catalog?: DialogueCatalog;
  policy?: ContentPolicyConfig;
  config?: AiProviderConfig;
  /** 판정 기록 (개발 로그) */
  onVerdict?: (verdict: ContentVerdict, sessionId: number, turn: number) => void;
}

/**
 * 게임에 붙일 AI 공급자 — 형식 검증 → 콘텐츠 정책 → 통과한 것만 화면으로. 막히면 검수 대사(없으면 base 고정 대사)로 대신한다.
 * 요청에 아직 비밀인 말이 섞이면 보내지 않는다(unsafe_request).
 */
export function createSafeAiDialogueProvider({
  transport,
  intent,
  baseFallback,
  catalog = NAJU_DIALOGUE_CATALOG,
  policy = CONTENT_POLICY_CONFIG,
  config = AI_PROVIDER_CONFIG,
  onVerdict,
}: SafeAiDialogueProviderOptions): AiDialogueProvider {
  const fallbackType: DialogueContentType = intent === "hint_offer" ? "help_offer" : "ambient";
  return createAiDialogueProvider({
    transport,
    fallback: createCatalogFallbackProvider(catalog, fallbackType, baseFallback),
    config,
    requestGuard: (request) => requestSecretLeak(JSON.stringify(request), request.ai_input, catalog),
    contentPolicy: (candidate, context) => {
      const verdict = evaluateDialogueContent(
        candidate,
        context.intent ?? "manual",
        context.aiInput ?? null,
        catalog,
        policy,
      );
      onVerdict?.(verdict, context.sessionId, context.turn);
      return verdict;
    },
  });
}
