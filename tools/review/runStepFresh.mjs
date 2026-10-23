#!/usr/bin/env node
// runStepFresh.mjs — 시험 단계 하나를 새 프로세스에서 돌린다(검수 서버 POST …/steps/<s>/run-fresh 가 띄움, 10/23)
//   서버는 시작할 때 도구 모듈을 한 번만 읽는다 → 도구를 고칠 때마다 서버를 다시 켜야 했다. 여기서는 매번 새로 읽는다.
//   사용(직접): node tools/review/runStepFresh.mjs <저장소 뿌리> <시험 id> <s05>
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [, , root, id, step] = process.argv;
const m = await import(pathToFileURL(path.join(root, 'tools/review/agentTrial.mjs')).href);
await m.startStep(root, id, step);
for (;;) {
  await new Promise(r => setTimeout(r, 3000));
  const t = await m.readTrial(root, id); const st = t.steps[step];
  if (st?.status === 'done') { console.log(new Date().toISOString(), step, 'done', st.costUsd); process.exit(0); }
  if (st?.status === 'failed') { console.log(new Date().toISOString(), step, 'FAILED', st.error); process.exit(1); }
}
