#!/usr/bin/env node
// runChain.mjs — 설화를 넣으면 01~04 를 이어서 돌린다(10/28 미르: 「설화를 입력하면 자동으로 다 채워져 나와 있어야」)
//   01 이 끝나면 설화 요약, 04 가 끝나면 핵심 검수 카드가 자동으로 생긴다(agentTrial.startStep 의 단계 뒤 처리). 05 부터는 사람 확인 뒤.
//   사용: node tools/review/runChain.mjs <저장소 뿌리> <시험 id> [s01 s02 s03 s04]
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [, , root, id, ...rest] = process.argv;
const steps = rest.length ? rest : ['s01', 's02', 's03', 's04'];
const m = await import(pathToFileURL(path.join(root, 'tools/review/agentTrial.mjs')).href);
for (const s of steps) {
  const t0 = await m.readTrial(root, id);
  if (t0.steps?.[s]?.status === 'done') { console.log(new Date().toISOString(), s, 'already done'); continue; }
  try { await m.startStep(root, id, s); } catch (e) { console.log(new Date().toISOString(), s, 'NOT STARTED', e.message); process.exit(1); }
  for (;;) {
    await new Promise(r => setTimeout(r, 3000));
    const st = (await m.readTrial(root, id)).steps[s];
    if (st?.status === 'done') { console.log(new Date().toISOString(), s, 'done', st.costUsd, st.after || st.afterError || ''); break; }
    if (st?.status === 'failed') { console.log(new Date().toISOString(), s, 'FAILED', st.error); process.exit(1); }
  }
}
// 04 단계 뒤 처리(카드)가 끝날 때까지 프로세스를 잡아 둔다 — startStep 의 뒤 처리는 같은 프로세스 안에서 돈다
console.log(new Date().toISOString(), 'chain end');
