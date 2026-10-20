// Claude API 호출부 — 이야기 에이전트(설화·기획 단계)가 쓴다. (10/15 미르: Claude 로 통일)
//
// [원칙] 에이전트 구조 문서 §8
//   · 제작할 때만 부른다(검수 화면·게임 실행 중에는 부르지 않는다).
//   · 단계별로 급을 나눈다 — judgment(판단) · hard(어려운 원전) · mechanical(기계적 단계).
//   · 키는 저장소 뿌리의 .env.local 의 ANTHROPIC_API_KEY 에서만 읽는다. 로그·오류 문구에 키를 절대 찍지 않는다.
//   · 모델을 바꿀 때는 아래 MODELS 한 곳만 고친다(호출부는 그대로).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const MODELS = Object.freeze({
  judgment: 'claude-sonnet-5-5', // 원전 사실 추출 · 각색 · 충돌 검토
  hard: 'claude-opus-5-5', // 고문·방언·출처 충돌 등 어려운 원전만
  mechanical: 'claude-haiku-5-5', // 양식 맞춤 · 요약 · 카드 정리 · 문서 간 일관성 (입력 10만 토큰 넘으면 단가 5배 — 나눠 넣는다)
});

/** .env.local → 환경변수(이미 있으면 그대로). 값은 반환만 하고 출력하지 않는다. */
export function readApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  const file = path.join(ROOT, '.env.local');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  const line = text.split(/\r?\n/).find((l) => /^\s*ANTHROPIC_API_KEY\s*=/.test(l));
  return line ? line.replace(/^\s*ANTHROPIC_API_KEY\s*=\s*/, '').replace(/^["']|["']$/g, '').trim() : '';
}

const hide = (text, key) => (key ? String(text).split(key).join('[키 숨김]') : String(text));

/**
 * 한 번 호출. tier = 'judgment' | 'hard' | 'mechanical'.
 * 돌려주는 값: { text, usage:{input_tokens, output_tokens}, model, stopReason }
 */
// temperature 는 보내지 않는다 — 5.5 세대 모델은 이 값을 받지 않는다(400 invalid_request_error, 10/15 확인).
export async function callClaude({ tier = 'judgment', system, messages, maxTokens = 4096 }) {
  const key = readApiKey();
  if (!key) throw new Error('ANTHROPIC_API_KEY 가 비어 있습니다. 저장소 뿌리의 .env.local 에 키를 넣어 주세요.');
  const model = MODELS[tier];
  if (!model) throw new Error(`알 수 없는 단계: ${tier}`);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, ...(system ? { system } : {}), messages }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(hide(`Claude API ${res.status}: ${body?.error?.type || ''} ${body?.error?.message || ''}`.trim(), key));
  return {
    text: (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''),
    usage: body.usage,
    model: body.model,
    stopReason: body.stop_reason,
  };
}

/**
 * 긴 출력용 스트리밍 호출(10/15 story-trial 추가). 비스트리밍은 수 분 걸리는 긴 문서에서 연결이 끊길 수 있다.
 * 돌려주는 값은 callClaude 와 같다: { text, usage, model, stopReason }
 */
/**
 * 10/19 추가 옵션
 *   cacheSystem: true — system 을 캐시 블록으로(같은 system 을 5분 안에 다시 보내면 입력 단가가 크게 준다. 작업대 01~04 가 같은 규격·틀을 매번 보낸다)
 *   effort: 'low'|'medium'|'high' — 생각 양 조절. 10/15 시험·10/19 첫 실행에서 생각이 출력 한도의 대부분(48,000 중 37,499)을 써 본문이 잘렸다.
 *     5.5 모델은 thinking.type=enabled(budget_tokens)를 받지 않는다(10/19 400: "Use thinking.type.adaptive and output_config.effort").
 *     그래서 thinking: {type:'adaptive'} + output_config: {effort} 로 보낸다. 이것도 거절되면(400) 한 번만 빼고 다시 보낸다 — thinkingParam 'rejected'.
 */
export async function streamClaude({ tier = 'judgment', system, messages, maxTokens = 4096, onProgress, cacheSystem = false, effort = null }) {
  try {
    return await streamOnce({ tier, system, messages, maxTokens, onProgress, cacheSystem, effort });
  } catch (error) {
    if (effort && /Claude API 400/.test(String(error.message)) && /thinking|effort|output_config/i.test(String(error.message))) {
      const result = await streamOnce({ tier, system, messages, maxTokens, onProgress, cacheSystem, effort: null });
      return { ...result, thinkingParam: 'rejected', thinkingError: String(error.message).slice(0, 300) };
    }
    throw error;
  }
}

async function streamOnce({ tier, system, messages, maxTokens, onProgress, cacheSystem, effort }) {
  const key = readApiKey();
  if (!key) throw new Error('ANTHROPIC_API_KEY 가 비어 있습니다. 저장소 뿌리의 .env.local 에 키를 넣어 주세요.');
  const model = MODELS[tier];
  if (!model) throw new Error(`알 수 없는 단계: ${tier}`);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      ...(system ? { system: cacheSystem ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system } : {}),
      ...(effort ? { thinking: { type: 'adaptive' }, output_config: { effort } } : {}),
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(hide(`Claude API ${res.status}: ${body?.error?.type || ''} ${body?.error?.message || ''}`.trim(), key));
  }
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  let thinkingChars = 0;
  const usage = { input_tokens: 0, output_tokens: 0 };
  let stopReason = null;
  let modelOut = model;
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const evt = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const dataLine = evt.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      let d;
      try { d = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
      if (d.type === 'message_start') {
        modelOut = d.message?.model || model;
        Object.assign(usage, d.message?.usage || {});
      } else if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta') {
        text += d.delta.text;
        onProgress?.(text.length);
      } else if (d.type === 'content_block_delta' && d.delta?.type === 'thinking_delta') {
        // 5.5 모델은 답을 쓰기 전에 생각부터 한다 — 그 몫도 max_tokens 에 들어간다(10/15 s01 이 생각만 하다 잘림)
        thinkingChars += (d.delta.thinking || '').length;
      } else if (d.type === 'message_delta') {
        if (d.usage) Object.assign(usage, Object.fromEntries(Object.entries(d.usage).filter(([, v]) => v != null)));
        if (d.delta?.stop_reason) stopReason = d.delta.stop_reason;
      } else if (d.type === 'error') {
        throw new Error(hide(`Claude API stream error: ${d.error?.type || ''} ${d.error?.message || ''}`, key));
      }
    }
  }
  return { text, usage, model: modelOut, stopReason, thinkingChars, thinkingParam: effort ? `effort:${effort}` : 'none' };
}

/** 입력 토큰 수 미리 세기(무료 엔드포인트) — 비용 상한 확인용. */
export async function countTokens({ tier = 'judgment', system, messages }) {
  const key = readApiKey();
  if (!key) throw new Error('ANTHROPIC_API_KEY 가 비어 있습니다.');
  const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELS[tier], ...(system ? { system } : {}), messages }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(hide(`count_tokens ${res.status}: ${body?.error?.message || ''}`, key));
  return body.input_tokens;
}
