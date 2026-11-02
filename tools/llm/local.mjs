// 로컬 LLM 호출부(10/19) — 비용 0 경로. OpenAI 호환 /v1/chat/completions 를 쓰는 서버면 무엇이든 붙는다:
//   · 맥북: mlx_lm.server (MLX, Apple Silicon)   · GIST 서버: vLLM (12월까지 무료)
// 설정은 저장소 뿌리 .env.local 에서만 읽는다(키 없음 — 주소·모델 이름만):
//   LOCAL_LLM_URL=http://127.0.0.1:8080/v1
//   LOCAL_LLM_MODEL=(비우면 서버에 올라온 모델)
// streamClaude 와 같은 모양으로 돌려준다 → agentTrial 의 llm() 이 공급자만 바꿔 부른다. 비용은 0 으로 기록한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function localConfig() {
  const env = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(LOCAL_LLM_URL|LOCAL_LLM_MODEL|LOCAL_VLM_URL|LOCAL_VLM_MODEL)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  } catch { /* 파일 없음 */ }
  const url = process.env.LOCAL_LLM_URL || env.LOCAL_LLM_URL || 'http://127.0.0.1:8080/v1';
  const model = process.env.LOCAL_LLM_MODEL || env.LOCAL_LLM_MODEL || null; // 비우면 서버가 올린 모델을 그대로 쓴다
  // 맥북 안 주소만 허용 — 다른 곳으로 설화·문서를 보내지 않게(GIST 는 맥북에서 터널로 붙인 localhost 주소를 쓴다)
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url + '/')) throw new Error('LOCAL_LLM_URL 은 이 컴퓨터 주소(127.0.0.1 · localhost)만 씁니다.');
  return { url: url.replace(/\/$/, ''), model };
}

/** 연결 확인 — 서버가 켜져 있고 어떤 모델이 올라와 있는지 */
export async function localStatus() {
  let cfg;
  try { cfg = localConfig(); } catch (error) { return { ok: false, error: error.message }; }
  try {
    const r = await fetch(`${cfg.url}/models`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { ok: false, url: cfg.url, model: cfg.model, error: `응답 ${r.status}` };
    const j = await r.json();
    // mlx_lm.server 는 캐시에 있는 모델을 모두 나열한다(그림·비전 모델 포함) → 글 모델을 고른다
    const ids = (j.data || []).map(m => m.id);
    const textModel = ids.find(id => /Qwen3-30B/i.test(id)) || ids.find(id => !/VL|FLUX|klein|vision|diffusion/i.test(id)) || ids[0];
    return { ok: true, url: cfg.url, model: cfg.model || textModel || '(서버 기본)', served: (j.data || []).map(m => m.id).slice(0, 10) };
  } catch (error) {
    return { ok: false, url: cfg.url, model: cfg.model, error: `연결 안 됨 — 맥북 터미널에서 로컬 서버를 켜 주세요 (${String(error.cause?.code || error.name)})` };
  }
}

/** streamClaude 와 같은 돌려받기: { text, usage, model, stopReason, thinkingParam } */
export async function streamLocal({ system, messages, maxTokens = 8192, onProgress }) {
  const cfg = localConfig();
  if (!cfg.model) { const st = await localStatus(); cfg.model = st.model || 'default_model'; }
  const body = { model: cfg.model, stream: true, max_tokens: Math.min(maxTokens, 16384), temperature: 0.4, messages: [{ role: 'system', content: system }, ...messages] };
  const r = await fetch(`${cfg.url}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`로컬 LLM 오류 ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const decoder = new TextDecoder();
  let buf = '', text = '', stopReason = null, usage = null;
  for await (const chunk of r.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const d = j.choices?.[0];
        if (d?.delta?.content) { text += d.delta.content; onProgress?.(text.length); }
        if (d?.finish_reason) stopReason = d.finish_reason === 'length' ? 'max_tokens' : 'end_turn';
        if (j.usage) usage = j.usage;
      } catch { /* 조각 */ }
    }
  }
  // Qwen3 생각 모드 꼬리표가 섞이면 걷어낸다
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { text, model: `local:${cfg.model}`, stopReason: stopReason || 'end_turn', thinkingParam: 'local', usage: { input_tokens: usage?.prompt_tokens || 0, output_tokens: usage?.completion_tokens || 0, local: true } };
}
