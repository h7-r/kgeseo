// story-brief.mjs — 설화·기획 「핵심 검수 카드」 만들기(제작 단계 · 터미널에서만 실행)
//   npm run story:brief                 → 검수 목록과 id 를 보여 준다(호출 없음)
//   npm run story:brief -- <검수 id>    → 세 문서를 Claude(판단 급)에 한 번 보내 요약 + 카드 → 인용 검사 → 저장
//   npm run story:brief -- <검수 id> --dry   → 입력 토큰·예상 비용만(무료 토큰 세기만 호출)
// 읽기만: .local/review/projects.json · 저장: .local/review/briefs/<id>.json (+ raw/ 에 모델 원답)
// 비용 상한: 한 번에 $1 (BRIEF_CAP_USD 로 바꿈). 원본 설화 문서·projects.json 은 바꾸지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BRIEF_DOCS, BRIEF_KINDS, briefContentHash, storeBrief, validateBrief } from '../review/brief.mjs';
import { MODELS, countTokens, streamClaude } from './claude.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, '.local/review');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const id = args.find((a) => !a.startsWith('--'));
const CAP = Number(process.env.BRIEF_CAP_USD || 1);
const MAX_TOKENS = 32000; // 생각 몫까지 — 카드 출력 자체는 수천 토큰

const priceOf = (model) => (/haiku/.test(model) ? [0.1, 0.5] : /opus/.test(model) ? [4, 20] : [2, 10]); // story-trial 과 같은 표
const usd = (x) => `$${x.toFixed(4)}`;

const db = JSON.parse(fs.readFileSync(path.join(DATA, 'projects.json'), 'utf8'));
if (!id) {
  console.log('검수 목록 — `npm run story:brief -- <id>` 로 카드를 만듭니다.\n');
  for (const p of db.projects) {
    const chars = BRIEF_DOCS.map((d) => (p[d.field] || '').length);
    console.log(`  ${p.id}  v${p.revision}  ${p.title}  (원천 ${chars[0]} · 시놉시스 ${chars[1]} · 씬 ${chars[2]}자)`);
  }
  process.exit(0);
}
const project = db.projects.find((p) => p.id === id);
if (!project) {
  console.error(`검수 id 를 찾지 못했습니다: ${id}`);
  process.exit(1);
}

const SYSTEM = `너는 지역 설화 기반 방탈출 게임 「왜곡」의 설화·기획 검수 보조다.
사람 검수자는 문서 전체를 읽을 시간이 없다. 너는 사람이 꼭 확인해야 할 곳만 짚는다. 판정은 사람이 한다 — 너는 승인·반려를 말하지 않는다.

문서 세 개를 받는다.
- A: 설화 원천(사실 계약서). 사실(F)·해석 유보(U)·금지 왜곡(NG)·게임 창작(GF)이 표시돼 있을 수 있다. 이것이 기준이다.
- B: 시놉시스(게임 각색).
- C: 씬별 경험·상호작용·에셋 계획.

할 일
1. 문서마다 요약 3~5줄. 한 줄은 한 문장, 짧게. 사람이 이 줄만 읽고 문서의 뼈대를 알 수 있어야 한다.
2. 「사람이 꼭 볼 곳」 카드. 종류는 다섯 가지뿐이다.
   - invented: B·C 가 A 에 없는 사건·인물·관계·지명·시대를 설화 사실처럼 쓴 곳(게임 창작이라고 밝힌 곳은 빼라)
   - conflict: A 와 어긋나거나, B 와 C 가 서로 어긋나는 곳
   - uncertain: A 가 미확인·유보로 둔 것을 B·C 가 확정한 곳
   - sensitive: 실존 지명·인물·종교·의례·지역 이미지에 대한 단정, 또는 A 의 금지 왜곡(NG)을 어길 의심
   - gap: A 의 핵심 사실이 B·C 에서 빠져 이야기가 달라지는 곳(인용은 A 에서)
3. 카드는 중요한 순서로 최대 25장. 사소한 표현·맞춤법은 넣지 마라. 같은 문제는 한 장으로 묶어라.

인용 규칙(코드가 검사한다 — 어기면 카드가 버려진다)
- quote 는 그 문서에서 글자 그대로 복사한 연속 구간, 20~120자. 고쳐 쓰거나 줄이거나 이어 붙이지 마라.
- against 가 있으면 그 quote 도 해당 문서에서 글자 그대로.

출력: JSON 하나만. 설명·코드 울타리 없이.
{"docs":[{"doc":"A","summary":["…"]},{"doc":"B","summary":["…"]},{"doc":"C","summary":["…"]}],
 "items":[{"doc":"B","kind":"invented","severity":"high|mid|low","quote":"…","against":{"doc":"A","quote":"…"},"why":"한 문장 — 무엇을 확인해야 하는지"}]}`;

const body = BRIEF_DOCS.map((d) => `<doc id="${d.key}" name="${d.label}">\n${project[d.field] || '(비어 있음)'}\n</doc>`).join('\n\n');
const messages = [{ role: 'user', content: `검수: ${project.title} (v${project.revision})\n\n${body}` }];

const tier = 'judgment';
const model = MODELS[tier];
const [pi, po] = priceOf(model);
const inTok = await countTokens({ tier, system: SYSTEM, messages });
const worst = (inTok * pi + MAX_TOKENS * po) / 1e6;
console.log(`입력 ${inTok} 토큰 · 모델 ${model} · 예상 최대 ${usd(worst)} (상한 $${CAP})`);
if (DRY) process.exit(0);
if (worst > CAP) {
  console.error(`예상 최대 비용이 상한을 넘습니다. BRIEF_CAP_USD 를 올리거나 문서를 줄여 주세요.`);
  process.exit(1);
}

const t0 = Date.now();
let lastShown = 0;
const r = await streamClaude({
  tier,
  system: SYSTEM,
  messages,
  maxTokens: MAX_TOKENS,
  onProgress: (n) => {
    if (n - lastShown > 2000) {
      lastShown = n;
      process.stdout.write(`  … ${n}자\r`);
    }
  },
});
const cost = ((r.usage.input_tokens || 0) * pi + (r.usage.output_tokens || 0) * po) / 1e6;
fs.mkdirSync(path.join(DATA, 'briefs/raw'), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.writeFileSync(path.join(DATA, 'briefs/raw', `${project.id}-${stamp}.txt`), r.text);
console.log(`\n응답 ${r.text.length}자 · 출력 ${r.usage.output_tokens} 토큰 · ${usd(cost)} · ${((Date.now() - t0) / 1000).toFixed(0)}초 · 끝난 이유 ${r.stopReason}`);
if (!r.text.trim()) {
  console.error('본문이 비었습니다(생각에 출력 한도를 다 썼을 수 있음). 저장하지 않았습니다.');
  process.exit(1);
}

let raw;
try {
  raw = JSON.parse(r.text.replace(/^```(?:json)?\s*|\s*```\s*$/g, '').trim());
} catch {
  const m = r.text.match(/\{[\s\S]*\}/);
  try { raw = m ? JSON.parse(m[0]) : null; } catch { raw = null; }
}
if (!raw) {
  console.error('JSON 으로 읽지 못했습니다. 원답은 .local/review/briefs/raw/ 에 있습니다. 저장하지 않았습니다.');
  process.exit(1);
}

const checked = validateBrief(project, raw);
const record = await storeBrief(DATA, project, {
  createdAt: new Date().toISOString(),
  model: r.model,
  usage: { ...r.usage, cost_usd: +cost.toFixed(5) },
  truncated: r.stopReason === 'max_tokens',
  ...checked,
});
const byKind = Object.keys(BRIEF_KINDS).map((k) => `${BRIEF_KINDS[k]} ${checked.items.filter((i) => i.kind === k).length}`).join(' · ');
console.log(`\n카드 ${checked.items.length}장 저장 (${byKind})`);
if (checked.rejected.length) console.log(`인용 검사에서 뺀 카드 ${checked.rejected.length}장 — 화면 「뺀 카드」에서 볼 수 있습니다.`);
console.log(`내용 해시 ${briefContentHash(project).slice(0, 12)} · 저장: .local/review/briefs/${project.id}.json (${record.id.slice(0, 8)})`);
console.log('작업대 「설화와 기획」 화면을 새로고침하면 카드가 보입니다.');
