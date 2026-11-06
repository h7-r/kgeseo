/**
 * 퍼즐이 화면에 띄우던 문장(알림 · 안내판 설명)을 동행의 말로 바꾼다.
 *
 * 퍼즐 쪽 문장은 「빈 통발이다. 물만 줄줄 흐른다.」 같은 지문체다. 이제 동행이 그 말을 하므로, 같은 내용을 동행의 말투
 * (존댓말 · 반말)로 옮겨 둔 표(gameVoiceLines)에서 찾아 말한다. 표에 없는 문장은 원문 그대로 나간다 — 퍼즐 문장을 고치거나
 * 새로 넣었으면 표에도 넣는다(tests/dialogue.test.ts 가 빠진 문장을 잡는다).
 * React · 별칭을 쓰지 않는다(node --test).
 */
import { GAME_VOICE } from "./gameVoiceLines.ts";
import { getTone } from "./lines.ts";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 「뜬 돌이 {1} 홈에 들어갔다. ({2}/{3})」 → 자리 표시마다 그 자리의 글을 잡아내는 식 */
const toPattern = (source: string) =>
  new RegExp(
    `^${source
      .split(/\{\d+\}/)
      .map(escapeRegExp)
      .join("([\\s\\S]+?)")}$`,
  );

interface VoiceRule {
  pattern: RegExp;
  /** 원문에서 자리 표시가 나온 차례 — {2} 가 먼저 나오는 문장도 맞게 채운다 */
  slots: string[];
  polite: string;
  casual: string;
}

/** 자리 표시가 없는 원문들 — rules 에서 slots 가 빈 것과 같은 차례다 */
const GAME_VOICE_PLAIN = GAME_VOICE.map(([source]) => source).filter((source) => !/\{\d+\}/.test(source));

const rules: VoiceRule[] = GAME_VOICE.map(([source, polite, casual]) => ({
  pattern: toPattern(source),
  slots: [...source.matchAll(/\{(\d+)\}/g)].map((match) => match[1]),
  polite,
  casual,
}));
/** 자리 표시가 없는 문장은 바로 찾는다 */
const exact = new Map(
  rules.filter((rule) => rule.slots.length === 0).map((rule, index) => [GAME_VOICE_PLAIN[index], rule]),
);

function findRule(text: string): { rule: VoiceRule; values: Record<string, string> } | null {
  const direct = exact.get(text);
  if (direct) return { rule: direct, values: {} };
  for (const rule of rules) {
    if (rule.slots.length === 0) continue;
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const values: Record<string, string> = {};
    rule.slots.forEach((slot, index) => (values[slot] = match[index + 1]));
    return { rule, values };
  }
  return null;
}

/** 표에 이 문장이 있나 — 검사용 */
export const hasCompanionVoice = (text: string) => findRule(text) !== null;

/** 퍼즐 문장을 지금 말투의 동행 말로. 표에 없으면 원문 그대로 */
export function inCompanionVoice(text: string): string {
  const found = findRule(text);
  if (!found) return text;
  const line = getTone() === "casual" ? found.rule.casual : found.rule.polite;
  return line.replace(/\{(\d+)\}/g, (whole, slot: string) => found.values[slot] ?? whole);
}
