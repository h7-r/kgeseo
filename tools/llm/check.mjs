// 키 연결 확인 — `npm run llm:check`
//   1) .env.local 에서 키를 읽었는지(값은 안 찍는다, 앞 7자·길이만)
//   2) 가장 싼 단계(mechanical)로 아주 짧은 호출 한 번 — 몇 원 미만
import { callClaude, MODELS, readApiKey } from './claude.mjs';

const key = readApiKey();
if (!key) {
  console.log('🔴 키 없음 — .env.local 의 ANTHROPIC_API_KEY= 뒤에 키를 넣고 저장하세요.');
  process.exit(1);
}
console.log(`🟢 키 읽음 (${key.slice(0, 7)}… · ${key.length}자)`);
console.log('   모델:', MODELS);
try {
  const r = await callClaude({ tier: 'mechanical', maxTokens: 20, messages: [{ role: 'user', content: '「연결 확인」이라고만 답하세요.' }] });
  console.log(`🟢 호출 성공 — ${r.model} · 응답 "${r.text.trim()}" · 토큰 입력 ${r.usage?.input_tokens} / 출력 ${r.usage?.output_tokens}`);
} catch (e) {
  console.log('🔴 호출 실패 —', e.message);
  process.exit(1);
}
