// story-trial-1015 — "원전 + 빈 양식 + 작성 규격만 주면 Claude API가 01~04를 사람본만큼 쓰는가?" 통제 실험.
//
//   npm run story:trial                   실제 실행(단계별 캐시 — 끊기면 다시 실행해도 끝난 단계는 다시 돈 내지 않는다)
//   npm run story:trial -- --dry-run      API 호출 없이 입력·프롬프트 조립 + 예상 비용만
//   npm run story:trial -- --report-only  호출 없이 이미 있는 결과로 검사·보고서만 다시 만든다
//   npm run story:trial -- --mock         가짜 응답으로 코드 경로 전체 점검(output-mock/ 에만 쓴다)
//
// [지키는 것]
//   · 사람 작성 원본(프로젝트파일/데이터/게임문서/)은 읽기만 한다. 모든 출력은 .local/experiments/story-trial-1015/ 아래에만.
//   · 생성 파일 첫 줄에 "AI 시험 생성본 — 원본 아님 (story-trial-1015)".
//   · 비용 상한(기본 $5): 매 호출 전 "지금까지 쓴 돈 + 이번 호출 최악 비용(입력 실측 + max_tokens 전부 출력)"이 상한을 넘으면 멈춘다.
//   · 키는 claude.mjs 가 .env.local 에서 읽는다. 여기서는 키를 다루지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { streamClaude, countTokens, MODELS } from './claude.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXP = path.join(ROOT, '.local/experiments/story-trial-1015');
const IN = path.join(EXP, 'input');
const HUMAN_DIR = path.join(ROOT, '프로젝트파일/데이터/게임문서');
const ARGS = new Set(process.argv.slice(2));
const MOCK = ARGS.has('--mock');
const DRY = ARGS.has('--dry-run');
const REPORT_ONLY = ARGS.has('--report-only');
const OUT = path.join(EXP, MOCK ? 'output-mock' : DRY ? 'output/dry-run' : 'output');
const HEADER = 'AI 시험 생성본 — 원본 아님 (story-trial-1015)';
const CAP = Number(process.env.STORY_TRIAL_CAP_USD || 5);
const PROMPT_VERSION = 'story-trial-prompt v1 (2026-10-15)';
const FENCE = '```';
const CASE_ID = 'case-naju-01';
const STORY_ID = 'story-naju-01-angam';

// ───────────────────────── 파일 쓰기(실험 폴더 밖은 거부) ─────────────────────────
function guard(p) {
  const r = path.resolve(p);
  if (!r.startsWith(EXP + path.sep)) throw new Error(`실험 폴더 밖에는 쓰지 않습니다: ${r}`);
  if (r.startsWith(HUMAN_DIR)) throw new Error('원본 폴더에는 쓰지 않습니다');
  return r;
}
function write(rel, content) {
  const p = guard(path.join(OUT, rel));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}
const mdHead = (t) => `> ${HEADER}\n\n${t}`;
const txtHead = (t) => `${HEADER}\n${t}`;
function jsonHead(obj) {
  const body = Array.isArray(obj) || obj === null || typeof obj !== 'object' ? { data: obj } : obj;
  const s = JSON.stringify(body, null, 2);
  return Object.keys(body).length ? `{"_header": ${JSON.stringify(HEADER)},\n${s.slice(2)}` : `{"_header": ${JSON.stringify(HEADER)}}`;
}
const readIn = (rel) => fs.readFileSync(path.join(IN, rel), 'utf8');
const readHuman = (name) => fs.readFileSync(path.join(HUMAN_DIR, name), 'utf8');
const readOut = (rel) => { try { return fs.readFileSync(path.join(OUT, rel), 'utf8'); } catch { return null; } };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const stripHeaderLine = (t) => t.replace(/^(> )?AI 시험 생성본[^\n]*\n(\n)?/, '').replace(/^<!--[^\n]*-->\n/, '');
const tplFile = (k) => fs.readdirSync(path.join(IN, 'templates')).find((f) => f.startsWith(k) && f.endsWith('.template.md'));

// ───────────────────────── 비용 ─────────────────────────
function priceOf(model, inTok) {
  if (/haiku/.test(model)) return inTok > 100000 ? [0.5, 2.5] : [0.1, 0.5];
  if (/opus/.test(model)) return [4, 20];
  return [2, 10]; // sonnet
}
const costOf = (model, u) => {
  const [pi, po] = priceOf(model, u.input_tokens || 0);
  return ((u.input_tokens || 0) * pi + (u.output_tokens || 0) * po) / 1e6;
};
const LEDGER_FILE = 'usage.json';
function loadLedger() {
  const t = readOut(LEDGER_FILE);
  if (!t) return { cap_usd: CAP, calls: [] };
  try { const j = JSON.parse(t); delete j._header; return j; } catch { return { cap_usd: CAP, calls: [] }; }
}
const ledger = loadLedger();
const spent = () => ledger.calls.reduce((a, c) => a + (c.cost_usd || 0), 0);
const saveLedger = () => { if (!DRY) write(LEDGER_FILE, jsonHead({ ...ledger, cap_usd: CAP, total_usd: +spent().toFixed(4) })); };
class BudgetError extends Error {}

// ───────────────────────── 한 단계 호출(캐시) ─────────────────────────
const estTokens = (s) => Math.ceil(s.length * 0.9); // 한국어 대략치(실행 시에는 count_tokens 실측을 쓴다)
async function callStep({ id, tier, system, user, maxTokens }) {
  const dir = `steps/${id}`;
  const metaTxt = readOut(`${dir}/meta.json`);
  if (metaTxt) {
    const meta = JSON.parse(metaTxt);
    if (meta.ok) {
      console.log(`· ${id}: 캐시 사용(이미 끝난 단계 — 다시 결제하지 않음)`);
      return { text: stripHeaderLine(readOut(`${dir}/response.txt`)), meta };
    }
  }
  if (REPORT_ONLY) return null;
  write(`${dir}/system.txt`, txtHead(system));
  write(`${dir}/user.txt`, txtHead(user));
  const model = MODELS[tier];
  const messages = [{ role: 'user', content: user }];
  let inTok;
  try { inTok = MOCK ? estTokens(system + user) : await countTokens({ tier, system, messages }); }
  catch (e) { inTok = estTokens(system + user); console.log(`  (토큰 실측 실패 — 어림값 사용: ${e.message})`); }
  const worst = costOf(model, { input_tokens: inTok, output_tokens: maxTokens });
  if (spent() + worst > CAP) {
    throw new BudgetError(`비용 상한 보호: 지금까지 $${spent().toFixed(3)} + ${id} 최악 $${worst.toFixed(3)} > 상한 $${CAP}`);
  }
  console.log(`· ${id}: ${model} 호출 — 입력 ${inTok} 토큰, 최대 출력 ${maxTokens} (최악 $${worst.toFixed(3)}, 누적 $${spent().toFixed(3)})`);
  const t0 = Date.now();
  let r;
  let lastLog = 0;
  try {
    r = MOCK
      ? mockResponse(id)
      : await streamClaude({ tier, system, messages, maxTokens, onProgress: (n) => { if (Date.now() - lastLog > 15000) { lastLog = Date.now(); console.log(`    … ${id} 받는 중 ${n}자`); } } });
  } catch (e) {
    // 실패한 호출도 입력분은 청구됐을 수 있으므로 보수적으로 기록
    ledger.calls.push({ step: id, model, input_tokens: inTok, output_tokens: 0, cost_usd: +costOf(model, { input_tokens: inTok, output_tokens: 0 }).toFixed(5), ms: Date.now() - t0, error: e.message, estimated: true });
    saveLedger();
    if (/401/.test(e.message)) e.message += ' — 키가 거부되었거나, 이 실행 환경(샌드박스 프록시)이 API 키 헤더를 막고 있습니다. Mac 터미널에서 직접 실행하세요.';
    throw e;
  }
  const ms = Date.now() - t0;
  const usage = { input_tokens: r.usage?.input_tokens || 0, output_tokens: r.usage?.output_tokens || 0 };
  const cost = costOf(r.model || model, usage);
  const meta = { ok: true, step: id, tier, model: r.model || model, stop_reason: r.stopReason, truncated: r.stopReason === 'max_tokens', max_tokens: maxTokens, ...usage, cost_usd: +cost.toFixed(5), ms, at: new Date().toISOString(), mock: MOCK };
  ledger.calls.push({ step: id, model: meta.model, ...usage, cost_usd: meta.cost_usd, ms, stop_reason: r.stopReason });
  saveLedger();
  write(`${dir}/response.txt`, txtHead(r.text));
  write(`${dir}/meta.json`, jsonHead(meta));
  console.log(`  → ${usage.input_tokens}/${usage.output_tokens} 토큰, $${cost.toFixed(4)}, ${(ms / 1000).toFixed(1)}초, stop=${r.stopReason}`);
  return { text: r.text, meta };
}

// ───────────────────────── 응답 나누기 · JSON 고치기 ─────────────────────────
function splitResponse(text) {
  const mi = text.indexOf('===MARKDOWN===');
  const jsonPart = mi >= 0 ? text.slice(0, mi) : text;
  const m = jsonPart.match(/```json\s*([\s\S]*?)```/) || jsonPart.match(/```json\s*([\s\S]*)$/);
  const rawJson = (m ? m[1] : jsonPart.replace('===JSON===', '')).trim();
  let md = mi >= 0 ? text.slice(mi + '===MARKDOWN==='.length).trim() : '';
  if (!md && m) md = text.slice(text.indexOf(m[0]) + m[0].length).trim();
  return { rawJson, md };
}
async function parseJsonWithRepair(id, raw) {
  try { return { json: JSON.parse(raw), repaired: false }; } catch (e0) {
    console.log(`  ${id}: JSON 문법 오류(${e0.message.slice(0, 60)}) — mechanical 단계로 문법만 수리`);
    const r = await callStep({
      id: `${id}-repair`, tier: 'mechanical', maxTokens: Math.min(32000, Math.ceil(raw.length * 1.2) + 2000),
      system: 'JSON 문법만 고친다. 내용(값·키·순서)은 한 글자도 바꾸거나 더하거나 빼지 않는다. 고친 JSON만 ```json 코드블록 하나로 돌려준다.',
      user: `${FENCE}json\n${raw}\n${FENCE}`,
    });
    if (!r) return { json: null, repaired: false, error: e0.message };
    const m = r.text.match(/```json\s*([\s\S]*?)```/);
    try { return { json: JSON.parse((m ? m[1] : r.text).trim()), repaired: true }; } catch (e1) { return { json: null, repaired: true, error: e1.message }; }
  }
}

// ───────────────────────── 프롬프트 ─────────────────────────
function systemPrompt() {
  const spec = stripHeaderLine(readIn('작성규격_v1.md'));
  const frame = [
    ['게임 세계관 설정서', '왜곡 세계관 설정서.md'],
    ['캐릭터 설정집', '캐릭터 설정집.md'],
    ['합동수사본부 조직 설정서', '합동수사본부 조직 설정서.md'],
    ['공용 인터랙션 카탈로그', '00 공용 인터랙션 카탈로그.md'],
  ].map(([t, f]) => `<${t}>\n${readHuman(f)}\n</${t}>`).join('\n\n');
  return [
    '너는 지역 설화 기반 추리·방탈출 게임 「왜곡」의 이야기 에이전트다. 설화 원전을 바탕으로 게임 기획 문서 01~04를 차례로 작성한다.',
    '아래 <작성 규격>을 반드시 지킨다. <게임 세계관 설정서>·<캐릭터 설정집>·<합동수사본부 조직 설정서>·<공용 인터랙션 카탈로그>는 모든 Case에 공통인 게임의 틀이다(특정 설화의 내용이 아니다).',
    '',
    '[출력 형식 — 꼭 지킬 것]',
    '1. 응답은 두 부분뿐이다. 첫 줄에 `===JSON===`, 그 아래 ```json 코드블록 하나(짝 JSON — 규격 0.4: JSON이 기준), 그다음 줄에 `===MARKDOWN===`, 그 아래 사람이 읽는 문서 마크다운. 앞뒤에 다른 말을 쓰지 않는다.',
    '2. 마크다운은 주어진 <빈 양식>의 제목과 표 머리를 그대로, 같은 순서로 쓴다. 양식의 자리표시([인물A], [Scene 제목], [MAP_ID] 등)는 실제 값으로 바꾼다. "(…마다 반복)" 표시가 있는 블록은 필요한 만큼 반복한다. 규격이 요구하는 칸(머리 정보 표, ID, 인용 구간 등)은 덧붙인다.',
    '3. 문서 맨 위에 규격 0.2의 머리 정보 표(case_id, story_id, doc_type, doc_version, author_kind, author, input_hash, status)를 둔다. 값은 과제에 주어진 것을 쓴다. status는 DRAFT.',
    '4. 근거 표시(규격 0.3): 본문 내용 줄(목록 줄, 표의 자료 줄, 문단 줄)마다 줄 끝에 [F] [GF] [U] [NEW] 중 하나를 붙인다. 근거 ID가 있으면 [F: F-03] [GF: GF-01] [U: U-02]처럼 쓴다. 이번에 새로 지어낸 내용은 반드시 [NEW]. 제목 줄과 표 머리줄에는 붙이지 않는다. 표의 자료 줄은 마지막 칸 끝에 붙인다.',
    '5. 사람 작성본용 🟢🟡🔴 표시는 쓰지 않는다.',
    '6. 퍼즐의 정답·암호·풀이 순서는 쓰지 않는다. 퍼즐 수도 정하지 않는다.',
    '7. 앞 문서를 고치지 않는다. 앞 문서와 맞지 않거나 고칠 필요가 보이면 마크다운 맨 끝 `## 막힘 보고` 절에 적는다(없으면 "없음").',
    '8. 한국어로, 짧고 분명한 문장으로 쓴다.',
    '',
    `<작성 규격>\n${spec}\n</작성 규격>`,
    '',
    frame,
  ].join('\n');
}

function headValues(docType, inputHash) {
  return `case_id=${CASE_ID} · story_id=${STORY_ID} · doc_type=${docType} · doc_version=v1.0 · author_kind=agent · author=story-agent/${MODELS.judgment}/${PROMPT_VERSION} · input_hash=${inputHash} · status=DRAFT`;
}
const docBlock = (label, d) => `<${label} — 짝 JSON(기준)>\n${FENCE}json\n${JSON.stringify(d.json)}\n${FENCE}\n</${label} — 짝 JSON(기준)>\n\n<${label} — 마크다운>\n${d.md}\n</${label} — 마크다운>`;

const SHAPES = {
  '01': `{
  "doc_type": "fact_contract",
  "head": { "case_id": "", "story_id": "", "doc_version": "v1.0", "author_kind": "agent", "author": "", "input_hash": "", "status": "DRAFT" },
  "sources": [ { "id": "SRC-01", "name": "", "kind": "원전|학술|공공 아카이브|향토 자료", "location": "", "terms": "이용 조건(모르면 '미확인')", "body_checked": true } ],
  "facts": [ { "id": "F-01", "category": "장소|인물|사건|관계|시대|결말|상징", "text": "한 줄에 한 사실", "src": ["SRC-01"], "loc": "본문 n문단", "quote": "원문에서 글자 그대로 복사한 연속 구간", "lock": "LOCKED|APPROVAL_REQUIRED" } ],
  "order": [ { "seq": 1, "event": "", "facts": ["F-04"], "reorderable": false } ],
  "open": [ { "id": "U-01", "kind": "", "issue": "", "rule": "게임 처리 원칙", "src": ["SRC-01"] } ],
  "ng": [ { "id": "NG-01", "change": "금지할 변경", "reason": "", "refs": ["F-03"] } ],
  "gf": [ { "id": "GF-01", "setting": "", "kind": "", "relation": "원전 사실과의 관계", "status": "제안", "tag": "NEW" } ],
  "tags": { "era": "", "setting": [], "motif": [] }
}`,
  '02': `{
  "doc_type": "synopsis",
  "head": { ... 01과 같은 필드 },
  "title": "", "episode": "", "logline": "",
  "start": { "why_here": "", "first_incident": "", "first_goal": "", "first_belief": "" },
  "questions": [ { "id": "Q-01", "text": "", "central": false, "answered_by": "언제 답을 얻는가" } ],
  "misconception": { "belief": "", "truth": "", "why": "" },
  "reversals": [ { "id": "RV-01", "before": "", "reveal": "", "shift": "", "basis": ["F-07"], "tag": "F|GF|NEW" } ],
  "characters": [ { "name": "", "role": "", "first_seen_as": "", "hidden_truth": "" } ],
  "field_link": [ { "place": "", "online_question": "", "onsite": "", "tag": "NEW" } ],
  "ending": { "final_state": "", "last_image": "", "left_open": "" },
  "handoff": { "must_reveal": [], "hide_early": [], "keep_reversals": [], "keep_emotion": [], "keep_interpretation": [] }
}`,
  '03': `{
  "doc_type": "scenario",
  "head": { ... },
  "player_role": "", "start": { "situation": "", "knows": [], "unknown": [] }, "final_goal": "",
  "questions": [ { "id": "Q-01", "shown_when": "", "answered_when": "" } ],
  "reveal_order": [ { "seq": 1, "content": "", "basis": ["F-03"], "scene_id": "scene-01" } ],
  "reversals": [ { "id": "RV-01", "before": "", "reveal": "", "basis": [] } ],
  "emotion_curve": [ { "stage": "", "emotion": "" } ],
  "avoid": [], "clear_conditions": [],
  "scenes": [ { "scene_id": "scene-01", "name": "", "role": "", "key_finding": "", "answers_q": ["Q-01"] } ]
}`,
  '04': `{
  "doc_type": "scene_table",
  "head": { ... },
  "map": { "map_id": "", "structure": "", "notes": "" },
  "scenes": [ {
    "scene_id": "scene-01", "order": 1, "title": "",
    "entry_knows": [], "purpose": "", "questions": ["Q-01"],
    "required_discoveries": [ { "id": "RD-S1-01", "text": "", "basis": ["F-03"], "logic": null } ],
    "perception": { "before": "", "after": "" },
    "mood": { "base": "", "target_emotion": "", "tension": "" },
    "space_reqs": [ { "space_req_id": "SPREQ-S1-01", "setting": [], "era": "", "must_read_as": "", "playable": true, "layer": "near|mid|far" } ],
    "asset_reqs": [ { "req_id": "REQ-S1-01", "category": "story_object|interactive|dressing", "role_hint": "", "affordances_required": [], "tags_any": [], "setting": [], "era": "", "lore_reason": "", "dressing_only": false } ],
    "puzzle_link": { "story_role": "", "confirms": ["RD-S1-01"], "interactions": ["observe"] },
    "exit": { "complete_when": "", "trigger": "", "carry_info": [], "carry_items": [] }
  } ]
}
※ required_discoveries[].logic: 모순·순서·인과 같은 논리 관계를 주장하면 { "claim": "", "conditions": "같은 시각·장소, 관찰 가능 조건 등" }, 아니면 null.`,
};

function userPrompt(step, ctx) {
  const tpl = (k) => stripHeaderLine(readIn(`templates/${tplFile(k)}`));
  if (step === '01') {
    return [
      `[과제] 「01 설화 사실 계약서」를 작성하라. 머리 정보 값: ${headValues('fact_contract', ctx.hash)}`,
      '',
      '[원전] 아래 SRC-01이 이 설화에 대해 네가 가진 유일한 출처다.',
      '- SRC-02 이후 출처를 지어내지 않는다. 네가 기억하는 다른 판본·자료·지식은 F의 근거로 쓰지 않는다(필요하면 U로 남기거나 막힘 보고에 적는다).',
      '- 원문 첫 두 줄([출처]·[수집])은 수집 메모다. 그 아래 제목 한 줄과 본문 4문단이 원문이다. 위치는 "본문 n문단"으로 적는다.',
      '',
      `<SRC-01 원문>\n${ctx.tale}\n</SRC-01 원문>`,
      '',
      `<빈 양식>\n${tpl('01')}\n</빈 양식>`,
      '',
      '[01 추가 요구 — 규격 1장 "확장에서 추가하는 것"]',
      '- §2 핵심 사실 표에 `원문 인용(SRC-01)` 칸을 덧붙인다. 인용(JSON의 quote)은 원문에서 **글자 그대로 복사한 연속 구간**이다. 맞춤법이 틀린 곳도 고치지 않는다. 말줄임(…)으로 두 구간을 잇지 않는다. 15~80자.',
      '- 한 줄(F 하나)에 사실 하나. 원문이 직접 말하지 않는 것(추론·함의)은 F가 아니라 U로 둔다.',
      '- 이용 조건이 확인되지 않은 출처만을 근거로 한 F는 APPROVAL_REQUIRED로 둔다(규격). 그렇게 둔 경우 이유를 §1 확인 범위에 적는다.',
      '- 시대·장소 유형·모티프 태그(era/setting/motif)를 §0 문서 정보 표에 행으로 덧붙이고 JSON tags에도 적는다. 영어 소문자 snake_case.',
      '- §6 게임용 창작 설정(GF)은 U와 직접 연결된 것만, 승인 상태는 "제안", 근거 표시는 [NEW].',
      '- §7 체크리스트는 규격 0.5를 지켰는지 스스로 확인하는 목록으로 쓴다.',
      '',
      `[짝 JSON 모양]\n${SHAPES['01']}`,
    ].join('\n');
  }
  if (step === '02') {
    return [
      `[과제] 「02 지역 테마 시놉시스」를 작성하라. 머리 정보 값: ${headValues('synopsis', ctx.hash)}`,
      '입력은 앞 단계가 만든 01 설화 사실 계약서뿐이다. 01에 없는 사실을 원전 사실처럼 쓰지 않는다. 01의 NG를 어기지 않는다. U를 사실로 단정하지 않는다.',
      '',
      docBlock('01 설화 사실 계약서', ctx.d01),
      '',
      `<빈 양식>\n${tpl('02')}\n</빈 양식>`,
      '',
      '[02 추가 요구 — 규격 2장]',
      '- 핵심 질문에 Q-01, Q-02 … ID를 단다(03·04가 이 ID로 참조한다).',
      '- 반전마다 근거 ID(F/GF)를 적는다. 근거 없는 반전은 [NEW].',
      '- §8 뒤에 「현장 연결」 절을 덧붙인다: 실제 장소 · 온라인에 남길 질문 · 현장에서 볼 수 있는 것. 모두 [NEW] 초안.',
      '- 게임 고유 해석 표(§10)는 01의 GF를 따르고, 새 해석이 필요하면 [NEW]로 표시한다.',
      '- 퍼즐 수는 정하지 않는다.',
      '',
      `[짝 JSON 모양]\n${SHAPES['02']}`,
    ].join('\n');
  }
  if (step === '03') {
    return [
      `[과제] 「03 게임 시나리오 기획서」를 작성하라. 머리 정보 값: ${headValues('scenario', ctx.hash)}`,
      '입력은 앞 단계가 만든 01·02뿐이다. 앞 문서를 고치지 않는다.',
      '',
      docBlock('01 설화 사실 계약서', ctx.d01),
      '',
      docBlock('02 지역 테마 시놉시스', ctx.d02),
      '',
      `<빈 양식>\n${tpl('03')}\n</빈 양식>`,
      '',
      '[03 추가 요구 — 규격 3장]',
      '- §7 정보 공개 순서 표는 「공개 순번 · 공개되는 내용 · 근거 ID · 해당 Scene(scene_id)」를 담는다(빈 양식 표 머리에 칸을 덧붙여도 된다).',
      '- §14 Scene 개요 표에 scene_id와 그 Scene이 답하는 Q- ID 칸을 덧붙인다.',
      '- 질문 ID는 02의 Q- ID를 그대로 쓴다.',
      '',
      `[짝 JSON 모양]\n${SHAPES['03']}`,
    ].join('\n');
  }
  if (step === '04') {
    return [
      `[과제] 「04 Scene 구성표」를 작성하라. 머리 정보 값: ${headValues('scene_table', ctx.hash)}`,
      '입력은 앞 단계가 만든 01·02·03뿐이다. Scene 수와 순서는 03의 Scene 개요를 따른다. 앞 문서를 고치지 않는다.',
      '',
      docBlock('01 설화 사실 계약서', ctx.d01),
      '',
      docBlock('02 지역 테마 시놉시스', ctx.d02),
      '',
      docBlock('03 게임 시나리오 기획서', ctx.d03),
      '',
      `<빈 양식>\n${tpl('04')}\n</빈 양식>`,
      '',
      '[04 추가 요구 — 규격 4장]',
      '- 필수 발견마다 RD-S{Scene번호}-{nn} ID. 논리 관계(모순·순서·인과)를 주장하는 필수 발견은 성립 조건을 함께 적는다.',
      '- §4 공간 구성: 필수 장소 요소마다 SPREQ-S{n}-{nn}, 스토리 오브젝트·일반 조작·장식 전용마다 REQ-S{n}-{nn}를 달고 자연어로 쓴다. 전체 필드는 짝 JSON에 둔다. 구체 물건명·instance_id는 정하지 않는다. lore_reason은 "퍼즐을 위해"가 아니라 왜 그 자리에 자연스럽게 있는지.',
      '- §5 퍼즐 연결 조건: 이야기 역할과 확인되어야 하는 RD- ID만. 퍼즐 호스트 후보는 정하지 않는다("퍼즐 단계에서 배치된 에셋 중 선택"이라고만 쓴다). 인터랙션은 공용 인터랙션 카탈로그 ID만 쓴다.',
      '- 퍼즐 정답·암호·풀이 순서·퍼즐 수는 쓰지 않는다.',
      '',
      `[짝 JSON 모양]\n${SHAPES['04']}`,
    ].join('\n');
  }
  throw new Error(step);
}

const STEP_CFG = {
  '01': { tier: 'judgment', maxTokens: 48000, name: '설화사실계약서', jsonName: 'fact_contract' },
  '02': { tier: 'judgment', maxTokens: 32000, name: '지역테마시놉시스', jsonName: 'synopsis' },
  '03': { tier: 'judgment', maxTokens: 32000, name: '게임시나리오기획서', jsonName: 'scenario' },
  '04': { tier: 'judgment', maxTokens: 40000, name: 'Scene구성표', jsonName: 'scene_table' },
};

async function runDocStep(step, ctx) {
  const cfg = STEP_CFG[step];
  const r = await callStep({ id: `s${step}`, tier: cfg.tier, maxTokens: cfg.maxTokens, system: ctx.system, user: userPrompt(step, ctx) });
  if (!r) return null;
  // 본문 없이 끝났으면(생각만 하다 한도에 걸림 등) 실패로 보고 사슬을 멈춘다 — 빈 문서를 고쳐 쓰거나 다음 단계로 넘기지 않는다
  if (!String(r.text || '').trim()) {
    throw new Error(`s${step}: 본문이 비어 있다(stop=${r.meta?.stop_reason}, 출력 ${r.meta?.output_tokens} 토큰). max_tokens 를 늘리거나 단계를 나눠야 한다. 이 단계 캐시를 steps/_실패 로 옮긴 뒤 다시 실행.`);
  }
  const { rawJson, md } = splitResponse(r.text);
  const pj = await parseJsonWithRepair(`s${step}`, rawJson);
  const d = { json: pj.json, md, meta: r.meta, repaired: pj.repaired, jsonError: pj.error || null };
  write(`AI-${step}_${cfg.name}.md`, mdHead(md));
  if (pj.json) write(`AI-${step}_${cfg.jsonName}.json`, jsonHead(pj.json));
  if (step === '04' && pj.json?.scenes) {
    const reqs = pj.json.scenes.map((s) => ({ scene_id: s.scene_id, space_reqs: s.space_reqs || [], asset_reqs: s.asset_reqs || [] }));
    write('AI-04_space_asset_reqs.json', jsonHead({ case_id: CASE_ID, scenes: reqs }));
  }
  return d;
}

// ───────────────────────── 코드 검사 ─────────────────────────
const normQ = (s) => String(s || '').replace(/[‘’‚‛′`']/g, "'").replace(/[“”„‟″"]/g, '"').replace(/\s+/g, ' ').trim();
function rawBody(tale) {
  // 수집 메모 두 줄([출처]·[수집])을 뺀 원문
  return tale.split(/\r?\n/).filter((l) => !/^\[(출처|수집)\]/.test(l)).join('\n');
}
function longestCommon(a, b) {
  // 가장 긴 공통 연속 구간 길이(진단용)
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diagPrev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diagPrev + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diagPrev = tmp;
    }
  }
  return best;
}
function citationCheck(d01, tale) {
  const body = normQ(rawBody(tale));
  const facts = d01?.json?.facts || [];
  return facts.map((f) => {
    const quotes = Array.isArray(f.quote) ? f.quote : [f.quote];
    const srcs = Array.isArray(f.src) ? f.src : [f.src];
    const usesSrc01 = srcs.some((s) => /SRC-01/.test(String(s)));
    const results = quotes.filter(Boolean).map((q) => {
      const nq = normQ(q);
      const pass = nq.length > 0 && body.includes(nq);
      return { quote: q, pass, longest_match: pass ? nq.length : longestCommon(nq, body), len: nq.length };
    });
    const pass = usesSrc01 && results.length > 0 && results.every((x) => x.pass);
    return { id: f.id, text: f.text, src: srcs, loc: f.loc, lock: f.lock, uses_src01: usesSrc01, quotes: results, pass, reason: !usesSrc01 ? 'SRC-01을 근거로 적지 않음' : results.length === 0 ? '인용 없음' : pass ? '' : '원문에 글자 그대로 없음' };
  });
}

const ID_RE = /\b(SRC-\d{2}|F-\d{2,3}|GF-\d{2,3}|U-\d{2,3}|NG-\d{2,3}|Q-\d{2,3}|RV-\d{2,3}|RD-S\d+-\d{2,3}|SPREQ-S\d+-\d{2,3}|REQ-S\d+-\d{2,3})\b/g;
const ID_FULL = new RegExp(`^${ID_RE.source.replace(/\\b/g, '')}$`);
const TAG_RE = /\[(F|GF|U|NEW)(?:\s*[:：][^\]]*)?\]\s*\|?\s*$/;
const isSepRow = (r) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(r);
function contentLines(md) {
  // 근거 표시가 필요한 줄: 목록 줄, 표 자료 줄, 문단 줄(제목·표 머리·구분선·코드·빈 줄 제외)
  const lines = md.split('\n');
  const out = [];
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) { inCode = !inCode; continue; }
    if (inCode || !l.trim()) continue;
    if (/^#{1,6}\s/.test(l) || /^\s*-{3,}\s*$/.test(l) || /^\s*<\/?aside>/.test(l)) continue;
    if (/^\s*\|/.test(l) && (isSepRow(l) || isSepRow(lines[i + 1] || ''))) continue; // 머리줄·구분줄
    if (/^\s*\*\*[^*]{1,30}\*\*\s*[:：]?\s*$/.test(l)) continue; // 굵은 이름표
    if (/^\s*>\s*$/.test(l)) continue;
    if (/^\s*-\s*\[[ xX]\]/.test(l)) continue; // 체크리스트
    out.push({ n: i + 1, text: l });
  }
  return out;
}
function docChecks(docs) {
  const res = { head: {}, ids: {}, src: [], tags: {}, newLines: [], ng: [], logic: [], vocab: [] };
  const HEAD_FIELDS = ['case_id', 'story_id', 'doc_type', 'doc_version', 'author_kind', 'author', 'input_hash', 'status'];
  for (const [k, d] of Object.entries(docs)) {
    const top = d.md.split('\n').slice(0, 40).join('\n');
    res.head[k] = HEAD_FIELDS.filter((f) => !top.includes(f));
  }
  const defs = new Map();
  const addDef = (id, where) => { if (!id) return; defs.set(id, [...(defs.get(id) || []), where]); };
  const j1 = docs['01']?.json; const j2 = docs['02']?.json; const j3 = docs['03']?.json; const j4 = docs['04']?.json;
  (j1?.sources || []).forEach((s) => addDef(s.id, '01'));
  (j1?.facts || []).forEach((s) => addDef(s.id, '01'));
  (j1?.open || []).forEach((s) => addDef(s.id, '01'));
  (j1?.ng || []).forEach((s) => addDef(s.id, '01'));
  (j1?.gf || []).forEach((s) => addDef(s.id, '01'));
  (j2?.questions || []).forEach((s) => addDef(s.id, '02'));
  (j2?.reversals || []).forEach((s) => addDef(s.id, '02'));
  (j3?.reversals || []).forEach((s) => { if (!defs.has(s.id)) addDef(s.id, '03'); });
  (j4?.scenes || []).forEach((sc) => {
    (sc.required_discoveries || []).forEach((r) => addDef(r.id, '04'));
    (sc.space_reqs || []).forEach((r) => addDef(r.space_req_id, '04'));
    (sc.asset_reqs || []).forEach((r) => addDef(r.req_id, '04'));
  });
  const dup = [...defs].filter(([, w]) => w.length > 1).map(([id, w]) => `${id}(${w.join(',')})`);
  const badFormat = [...defs.keys()].filter((id) => !ID_FULL.test(id));
  const refs = new Map();
  for (const [k, d] of Object.entries(docs)) {
    const text = d.md + '\n' + JSON.stringify(d.json || {});
    for (const m of text.matchAll(ID_RE)) refs.set(m[1], new Set([...(refs.get(m[1]) || []), k]));
  }
  const dangling = [...refs].filter(([id]) => !defs.has(id)).map(([id, w]) => `${id}(${[...w].join(',')})`);
  const legacy = [];
  for (const [k, d] of Object.entries(docs)) {
    for (const m of d.md.matchAll(/(?<![\w-])(Q\d(?!\d)|GI-\d{2}|P0\d)(?![\w-])/g)) legacy.push(`${m[1]}(${k})`);
  }
  res.ids = { defined: defs.size, duplicate: dup, bad_format: badFormat, dangling, legacy_style: [...new Set(legacy)] };
  res.src = (j1?.facts || []).filter((f) => !(f.src && f.src.length) || !f.loc).map((f) => f.id);
  for (const [k, d] of Object.entries(docs)) {
    const cl = contentLines(d.md);
    const tagged = cl.filter((x) => TAG_RE.test(x.text.trim()));
    const count = { F: 0, GF: 0, U: 0, NEW: 0 };
    for (const x of tagged) { const m = x.text.trim().match(TAG_RE); count[m[1]]++; }
    res.tags[k] = { content_lines: cl.length, tagged: tagged.length, rate: cl.length ? +(tagged.length / cl.length).toFixed(3) : 0, ...count, untagged_sample: cl.filter((x) => !TAG_RE.test(x.text.trim())).slice(0, 5).map((x) => x.text.slice(0, 80)) };
    for (const x of tagged) if (x.text.trim().match(TAG_RE)[1] === 'NEW') res.newLines.push({ doc: k, line: x.n + 2, text: x.text.trim() }); // +2 = 출력 파일 머리줄
  }
  // DOC-NG(간단): 마을-인물 짝 뒤바뀜
  const ngPatterns = [
    /아랑사[^\n|]{0,10}진부촌\s*(에\s*사는|의|출신)/, /진부촌\s*(에\s*사는|의|출신)\s*(어부\s*)?아랑사/,
    /아비사[^\n|]{0,10}택촌\s*(에\s*사는|의|출신)/, /택촌\s*(에\s*사는|의|출신)\s*(처녀\s*)?아비사/,
  ];
  for (const [k, d] of Object.entries(docs)) {
    d.md.split('\n').forEach((l, i) => { if (ngPatterns.some((p) => p.test(l))) res.ng.push({ doc: k, line: i + 3, text: l.trim().slice(0, 140) }); });
  }
  const catalog = ['observe', 'collect', 'compare', 'rotate', 'align', 'connect', 'sequence', 'input_code'];
  (j4?.scenes || []).forEach((sc) => {
    (sc.required_discoveries || []).forEach((r) => { if (r.logic && !(r.logic.conditions && String(r.logic.conditions).trim())) res.logic.push(r.id); });
    (sc.puzzle_link?.interactions || []).forEach((x) => { if (!catalog.includes(x)) res.vocab.push(`${sc.scene_id}:${x}`); });
  });
  res.logic_claims = (j4?.scenes || []).reduce((a, sc) => a + (sc.required_discoveries || []).filter((r) => r.logic).length, 0);
  return res;
}

// ───────────────────────── 사람본 읽기(읽기 전용) ─────────────────────────
const cellsOf = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const plainMd = (s) => String(s || '').replace(/\*\*/g, '').replace(/`/g, '').trim();
function humanTable(md, idRe) {
  return md.split('\n').filter((l) => /^\s*\|/.test(l)).map(cellsOf).filter((c) => idRe.test(plainMd(c[0]))).map((c) => c.map(plainMd));
}
function parseHuman01(md) {
  const F = humanTable(md, /^F-\d+/).map((c) => ({ id: c[0], category: c[1], text: c[2], src: (c[3].match(/SRC-\d+/g) || []), loc: c[4], lock: c[5] }));
  const U = humanTable(md, /^U-\d+/).map((c) => ({ id: c[0], kind: c[1], text: c[2], rule: c[3], src: (c[4].match(/SRC-\d+/g) || []) }));
  const NG = humanTable(md, /^NG-\d+/).map((c) => ({ id: c[0], text: c[1], reason: c[2], refs: c[3] }));
  const GF = humanTable(md, /^GF-\d+/).map((c) => ({ id: c[0], text: c[1], kind: c[2], relation: c[3], status: c[4] }));
  return { F, U, NG, GF };
}
// 입력 범위 밖 판정 — 출처 칸에 SRC-01이 없고 다른 SRC만 있으면 자동. 아래는 내용상 수동 판정(이유 명시).
const OUT_OF_SCOPE_MANUAL = {
  'U-04': 'SRC-05·SRC-06(상위 자료집)의 존재를 알아야 쓸 수 있는 항목 — AI에게 주지 않은 출처 목록',
  'NG-05': '밀양 아랑 설화와의 혼동 — SRC-01 밖의 외부 지식(사람본도 출처 "—")',
};
function scopeOf(item) {
  if (OUT_OF_SCOPE_MANUAL[item.id]) return { in: false, why: OUT_OF_SCOPE_MANUAL[item.id] };
  const src = item.src || [];
  if (src.length && !src.includes('SRC-01')) return { in: false, why: `출처가 ${src.join(', ')}뿐 — AI에게 주지 않은 출처` };
  return { in: true, why: src.length > 1 ? `SRC-01 + ${src.filter((s) => s !== 'SRC-01').join(', ')}(교차 출처는 범위 밖, 내용은 SRC-01 안)` : '' };
}
function countHuman(md, kind) {
  const lines = md.split('\n');
  if (kind === 'scenes') return lines.filter((l) => /^#\s+Scene\b/.test(l)).length;
  if (kind === 'q') return lines.filter((l) => /^\s*-\s*\*\*Q\d+\./.test(l)).length;
  if (kind === 'reversals') return lines.filter((l) => /^##\s+\d+차 반전/.test(l)).length;
  if (kind === 'rd') {
    const per = []; let scene = -1; let on = false;
    for (const l of lines) {
      if (/^#\s+Scene\b/.test(l)) { scene++; per[scene] = 0; on = false; continue; }
      if (/^#{1,6}\s/.test(l)) { on = /^###\s+필수 발견/.test(l); continue; }
      if (on && scene >= 0 && /^-\s+/.test(l)) per[scene]++;
    }
    return per;
  }
  if (kind === 'reveal') {
    const s = md.split(/\n## /).find((b) => /^7\. 정보 공개 순서/.test(b)) || '';
    return s.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l)).length;
  }
  if (kind === 'sceneOverview') return lines.filter((l) => /^\|\s*`?scene-\d+/.test(l)).length;
  return null;
}
const normHead = (h) => h.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/`/g, '').replace(/[🟢🟡🔴]/gu, '').replace(/^\d+(\.\d+)*\.?\s*/, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
function sectionCoverage(templateMd, humanMd, aiMd) {
  const tHeads = [...new Set(templateMd.split('\n').filter((l) => /^#{1,6}\s/.test(l)).map(normHead).filter((h) => h && !/\[/.test(h) && !/^Scene /.test(h)))];
  const hs = (md) => (md || '').split('\n').filter((l) => /^#{1,6}\s/.test(l)).map(normHead);
  const H = hs(humanMd); const A = hs(aiMd);
  const has = (arr, t) => arr.some((x) => x.includes(t) || (t.includes(x) && x.length >= 4));
  const rows = tHeads.map((t) => ({ heading: t, human: has(H, t), ai: has(A, t) }));
  return { rows, total: rows.length, human: rows.filter((r) => r.human).length, ai: rows.filter((r) => r.ai).length };
}

// 글자 두 개 묶음(bigram) 겹침 — 짝짓기 검증용
function dice(a, b) {
  const g = (s) => { const t = String(s || '').replace(/[\s.,·:;()[\]'"‘’“”`*|/\-~!?、。]/g, ''); const set = new Set(); for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2)); return set; };
  const A = g(a); const B = g(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return (2 * n) / (A.size + B.size);
}

async function pairItems(h01, d01) {
  const ai = {
    F: (d01?.json?.facts || []).map((f) => ({ id: f.id, text: f.text })),
    U: (d01?.json?.open || []).map((u) => ({ id: u.id, text: `${u.issue || ''} / ${u.rule || ''}` })),
    NG: (d01?.json?.ng || []).map((n) => ({ id: n.id, text: `${n.change || ''} / ${n.reason || ''}` })),
    GF: (d01?.json?.gf || []).map((g) => ({ id: g.id, text: g.setting || '' })),
  };
  const hu = {
    F: h01.F.map((f) => ({ id: f.id, text: f.text })),
    U: h01.U.map((u) => ({ id: u.id, text: `${u.text} / ${u.rule}` })),
    NG: h01.NG.map((n) => ({ id: n.id, text: `${n.text} / ${n.reason}` })),
    GF: h01.GF.map((g) => ({ id: g.id, text: g.text })),
  };
  const r = await callStep({
    id: 'cmp-pair01', tier: 'mechanical', maxTokens: 4000,
    system: '두 목록(사람본 H, AI본 A)의 항목을 "같은 내용을 말하는가"로 짝짓는다. 한 항목이 여러 항목과 짝일 수 있다(쪼개기·합치기). 같은 내용이 없으면 빈 배열. 판단만 하고 설명은 쓰지 않는다. ```json 코드블록 하나만 돌려준다.',
    user: [
      '아래 분류(F 사실, U 해석 유보, NG 금지 왜곡, GF 게임 창작 설정)마다 사람본 항목 하나하나에 대응하는 AI본 항목 ID를 적어라.',
      '돌려줄 모양: {"F":[{"human":"F-01","ai":["F-01","F-02"]}], "U":[...], "NG":[...], "GF":[...]} — 사람본 항목은 빠짐없이 모두 적는다.',
      `<H>\n${JSON.stringify(hu)}\n</H>`,
      `<A>\n${JSON.stringify(ai)}\n</A>`,
    ].join('\n'),
  });
  let llm = null;
  if (r) { const m = r.text.match(/```json\s*([\s\S]*?)```/); try { llm = JSON.parse((m ? m[1] : r.text).trim()); } catch { llm = null; } }
  const out = {};
  for (const cat of ['F', 'U', 'NG', 'GF']) {
    const used = new Set();
    const rows = hu[cat].map((h) => {
      const hItem = h01[cat].find((x) => x.id === h.id);
      const scope = scopeOf(hItem);
      const proposed = (llm?.[cat] || []).find((p) => p.human === h.id)?.ai || [];
      const aiTexts = proposed.map((id) => ai[cat].find((a) => a.id === id)?.text || '').join(' ');
      const score = proposed.length ? dice(h.text, aiTexts) : 0;
      const best = ai[cat].map((a) => ({ id: a.id, s: dice(h.text, a.text) })).sort((x, y) => y.s - x.s)[0];
      const verdict = !proposed.length ? (scope.in ? '사람본에만' : '입력 범위 밖') : score >= 0.25 ? '짝 확인' : score >= 0.15 ? '짝(겹침 약함)' : '짝 기각(겹침 낮음)';
      if (verdict === '짝 확인' || verdict === '짝(겹침 약함)') proposed.forEach((id) => used.add(id));
      return { human: h.id, human_text: h.text, ai: proposed, overlap: +score.toFixed(2), verdict, scope: scope.in ? '범위 안' : '입력 범위 밖', scope_note: scope.why, code_best: best ? `${best.id}(${best.s.toFixed(2)})` : '' };
    });
    const aiOnly = ai[cat].filter((a) => !used.has(a.id));
    out[cat] = { rows, aiOnly, aiTotal: ai[cat].length, humanTotal: hu[cat].length };
  }
  out.llm_ok = !!llm;
  return out;
}

async function diffSummary(step, humanMd, aiMd) {
  const r = await callStep({
    id: `cmp-diff${step}`, tier: 'judgment', maxTokens: 3500,
    system: '게임 기획 문서 두 판본(사람 작성본 H, AI 작성본 A)을 비교하는 검토자다. 한국어 평이체로, 짧은 글머리표로 쓴다. 근거 없는 칭찬·추측을 하지 않는다. 사람본이 정답이라고 가정하지 말고, 두 판본의 차이를 사실대로 적는다.',
    user: [
      `<H>\n${humanMd}\n</H>`,
      `<A>\n${aiMd}\n</A>`,
      '아래 다섯 제목으로만 답하라(각 3~6개 글머리표, 한 줄씩).',
      '### 사람본에만 있는 중요한 내용',
      '### AI본에만 있는 내용',
      '### 구조·형식 차이(절·표·ID·근거 표시)',
      '### 원전 사실·금지 왜곡 관점의 위험(있으면)',
      '### 한 줄 평가',
    ].join('\n'),
  });
  return r ? stripHeaderLine(r.text) : null;
}

// ───────────────────────── 마크다운 → HTML(간단) ─────────────────────────
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function inline(s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>'); }
export function mdToHtml(md, title) {
  const L = md.split('\n'); const out = []; let i = 0;
  const isBlockStart = (x) => /^(#{1,6}\s|\s*\||\s*[-*]\s|>|```|\s*\d+\.\s)/.test(x);
  while (i < L.length) {
    const l = L[i];
    if (/^```/.test(l)) { const buf = []; i++; while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]); i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue; }
    const h = l.match(/^(#{1,6})\s+(.*)$/); if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*\|/.test(l)) {
      const rows = []; while (i < L.length && /^\s*\|/.test(L[i])) rows.push(L[i++]);
      let html = '<div class="tw"><table>';
      rows.forEach((r, k) => { if (isSepRow(r)) return; const tag = k === 0 && rows[1] && isSepRow(rows[1]) ? 'th' : 'td'; html += '<tr>' + cellsOf(r).map((c) => `<${tag}>${inline(c)}</${tag}>`).join('') + '</tr>'; });
      out.push(html + '</table></div>'); continue;
    }
    if (/^\s*[-*]\s+/.test(l)) { const items = []; while (i < L.length && /^\s*[-*]\s+/.test(L[i])) items.push(L[i++].replace(/^\s*[-*]\s+/, '')); out.push('<ul>' + items.map((x) => `<li>${inline(x)}</li>`).join('') + '</ul>'); continue; }
    if (/^\s*\d+\.\s+/.test(l)) { const items = []; while (i < L.length && /^\s*\d+\.\s+/.test(L[i])) items.push(L[i++].replace(/^\s*\d+\.\s+/, '')); out.push('<ol>' + items.map((x) => `<li>${inline(x)}</li>`).join('') + '</ol>'); continue; }
    if (/^>\s?/.test(l)) { const buf = []; while (i < L.length && /^>\s?/.test(L[i])) buf.push(L[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${buf.map(inline).join('<br>')}</blockquote>`); continue; }
    if (!l.trim()) { i++; continue; }
    if (/^---\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    const buf = [L[i++]]; while (i < L.length && L[i].trim() && !isBlockStart(L[i])) buf.push(L[i++]);
    out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
  }
  return `<!doctype html>
<!-- ${HEADER} -->
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1f;--muted:#6b6b70;--line:#dedbd3;--card:#fff;--accent:#7a4b2a;--code:#f1eee8}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#141416;--fg:#e9e7e2;--muted:#a3a19c;--line:#34343a;--card:#1c1c20;--accent:#d9a37a;--code:#25252b}}
:root[data-theme="dark"]{--bg:#141416;--fg:#e9e7e2;--muted:#a3a19c;--line:#34343a;--card:#1c1c20;--accent:#d9a37a;--code:#25252b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 -apple-system,"Apple SD Gothic Neo","Pretendard","Noto Sans KR",sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 80px}h1{font-size:1.6rem;line-height:1.3}h2{margin-top:2.2em;padding-bottom:.3em;border-bottom:1px solid var(--line);font-size:1.25rem}h3{font-size:1.05rem;margin-top:1.6em}
blockquote{margin:1em 0;padding:.6em 1em;border-left:3px solid var(--accent);background:var(--card);color:var(--muted)}hr{border:0;border-top:1px solid var(--line);margin:2em 0}
.tw{overflow-x:auto;margin:1em 0}table{border-collapse:collapse;width:100%;font-size:.88rem;background:var(--card)}th,td{border:1px solid var(--line);padding:.4em .6em;vertical-align:top;text-align:left}th{background:var(--code)}
code{background:var(--code);padding:.05em .35em;border-radius:4px;font-size:.88em;word-break:break-all}pre{background:var(--code);padding:1em;overflow-x:auto;border-radius:6px}pre code{background:none;padding:0}
.banner{font-size:.85rem;color:var(--muted);border:1px dashed var(--line);padding:.5em .8em;border-radius:6px}
</style></head><body><main><p class="banner">${HEADER}</p>
${out.join('\n')}
</main></body></html>`;
}

// ───────────────────────── 보고서 ─────────────────────────
const usd = (x) => `$${(x || 0).toFixed(4)}`;
function buildReport(ctx) {
  const { docs, cite, checks, pairs, cov, counts, diffs, scrubReport, aborted } = ctx;
  const L = [];
  const p = (...x) => L.push(...x);
  const passN = cite.filter((c) => c.pass).length;
  const notes = readOut('검토자메모.md');
  p('# story-trial-1015 비교 보고서 — AI가 쓴 01~04 vs 사람이 쓴 01~04', '');
  p(`- 보고서 생성 시각: ${new Date().toISOString()}${MOCK ? ' · **가짜 응답(--mock) 점검본 — 실험 결과 아님**' : ''}`);
  p('- 질문: 원전 텍스트 하나 + 빈 양식 + 작성 규격만 주면, Claude API가 사람본과 견줄 만한 01~04를 쓰는가?');
  p('- 사람 작성본(기준선)은 읽기만 했다. 이 보고서와 AI 문서는 모두 `.local/experiments/story-trial-1015/` 안에만 있다.');
  if (aborted) p('', `> ⚠️ 실행이 중간에 멈췄다: ${aborted}`);
  p('', '## 1. 무엇을 주고, 무엇을 주지 않았나', '');
  p('| 구분 | 내용 |', '| --- | --- |');
  p('| 준 것 — 원전 | `input/SRC-01_나주문화원_앙암바위.txt` (나주문화원 게시물 본문, 이야기 출처는 이것 하나) |');
  p('| 준 것 — 규칙 | `input/작성규격_v1.md` (01~04 작성 규격 v1, Project 문서 복사본) |');
  p('| 준 것 — 빈 양식 | `input/templates/0N_*.template.md` (사람본에서 제목·표 머리만 뽑음, 이야기 낱말은 자리표시로 바꿈) |');
  p('| 준 것 — 게임 틀 | 왜곡 세계관 설정서 · 캐릭터 설정집 · 합동수사본부 조직 설정서 · 00 공용 인터랙션 카탈로그 (사람 작성자도 가졌던 공통 설정) |');
  p('| 주지 않은 것 | 사람본 01~06, 왜곡 게임 기획서1·2, 왜곡 메인 스토리·시놉시스, 튜토리얼 설계서, 퍼즐 폴더 전체, SRC-02~06(문화재청·나주시·언론·자료집) |');
  p('| 단계 연결 | 01은 원전에서 → 02는 AI-01만 → 03은 AI-01·02 → 04는 AI-01·02·03 (파이프라인과 같은 사슬) |');
  p('', '**빈 양식에서 지운 것(누출 방지)**', '');
  for (const [f, r] of Object.entries(scrubReport || {})) p(`- ${f}: ${r.scrubbed.join(' / ') || '없음'}${r.leaks?.length ? ` · ⚠️ 남은 낱말 ${r.leaks.join(',')}` : ' · 이야기 낱말 남음 없음'}`);
  p('- 알고 그대로 둔 작은 누출: 작성 규격 §4.2·4.3 예시 JSON에 「아랑사가 택촌 어부임을 보여 준다」·「깎아지른 절벽과 강을 사이에 둔 두 마을」, §0.2 예시에 case/story ID가 있다(모두 SRC-01 안의 사실). 세계관 설정서 98행에 「앙암바위 Case … 영산포·영산강·앙암바위」 예시 한 줄이 있다.');
  p('- 양식은 "제목·표 머리만"이 원칙이지만, `항목|내용` 꼴 머리 표는 필드 이름(첫 칸)만 남기고 값을 비웠다. 반전 수·인물 수·Scene 수가 새지 않게 반복 블록은 하나로 접었다.');

  p('', '## 2. 비용 · 토큰 · 시간', '');
  p('| 단계 | 모델 | 입력 토큰 | 출력 토큰 | 비용 | 시간 | 끝난 이유 |', '| --- | --- | ---: | ---: | ---: | ---: | --- |');
  for (const c of ledger.calls) p(`| ${c.step} | ${c.model} | ${c.input_tokens} | ${c.output_tokens} | ${usd(c.cost_usd)}${c.estimated ? '(추정)' : ''} | ${((c.ms || 0) / 1000).toFixed(1)}초 | ${c.error ? '오류: ' + c.error.slice(0, 60) : c.stop_reason || ''} |`);
  const tin = ledger.calls.reduce((a, c) => a + (c.input_tokens || 0), 0); const tout = ledger.calls.reduce((a, c) => a + (c.output_tokens || 0), 0);
  p(`| **합계** | | ${tin} | ${tout} | **${usd(spent())}** | ${(ledger.calls.reduce((a, c) => a + (c.ms || 0), 0) / 1000).toFixed(0)}초 | 상한 $${CAP} |`);
  for (const [k, d] of Object.entries(docs)) if (d?.meta?.truncated) p('', `> ⚠️ ${k}: 출력 한도(max_tokens)에서 잘렸다 — 문서 끝부분이 빠졌을 수 있다.`);
  for (const [k, d] of Object.entries(docs)) if (d && !d.json) p('', `> ⚠️ ${k}: 짝 JSON을 읽지 못했다(${d.jsonError}). 이 문서의 JSON 기반 검사는 빠졌다.`);

  p('', '## 3. 인용 검사 — AI-01이 SRC-01에서 따왔다는 구간이 원문에 정말 있나', '');
  p('코드로만 검사했다(LLM 없음). 띄어쓰기와 따옴표 모양만 맞춰 보고, 나머지는 글자 그대로 일치해야 통과.', '');
  p(`**통과 ${passN} / ${cite.length} (${cite.length ? Math.round((passN / cite.length) * 100) : 0}%)**`, '');
  p('| F | 통과 | 사실(요약) | 인용 구간 | 원문과 가장 길게 겹친 글자 수 | 이유 |', '| --- | --- | --- | --- | ---: | --- |');
  for (const c of cite) p(`| ${c.id} | ${c.pass ? '✅' : '❌'} | ${String(c.text || '').slice(0, 60)} | ${c.quotes.map((q) => '「' + String(q.quote).slice(0, 60) + '」').join(' ')} | ${c.quotes.map((q) => `${q.longest_match}/${q.len}`).join(', ')} | ${c.reason} |`);

  p('', '## 4. 코드 규격 검사(규격 §5 중 싼 것)', '');
  p('| 검사 | 결과 |', '| --- | --- |');
  p(`| DOC-HEAD 머리 정보 빠짐 | ${Object.entries(checks.head).map(([k, v]) => `${k}: ${v.length ? v.join(',') : '없음'}`).join(' · ')} |`);
  p(`| DOC-ID 정의된 ID 수 | ${checks.ids.defined} |`);
  p(`| DOC-ID 중복 | ${checks.ids.duplicate.join(', ') || '없음'} |`);
  p(`| DOC-ID 형식 오류 | ${checks.ids.bad_format.join(', ') || '없음'} |`);
  p(`| DOC-ID 끊긴 참조(쓰였는데 정의 없음) | ${checks.ids.dangling.join(', ') || '없음'} |`);
  p(`| 사람본식 ID 섞임(Q1·GI-·P0n) | ${checks.ids.legacy_style.join(', ') || '없음'} |`);
  p(`| DOC-SRC 출처·위치 빠진 F | ${checks.src.join(', ') || '없음'} |`);
  p(`| DOC-NG 마을-인물 짝 뒤바뀜 의심 줄 | ${checks.ng.length ? checks.ng.map((x) => `${x.doc}:${x.line}`).join(', ') : '없음'} |`);
  p(`| DOC-LOGIC 논리 주장 RD / 조건 빈 RD | ${checks.logic_claims}개 / ${checks.logic.join(', ') || '없음'} |`);
  p(`| DOC-VOCAB 카탈로그 밖 인터랙션 | ${checks.vocab.join(', ') || '없음'} |`);
  p(`| DOC-NEW 모은 [NEW] 줄 | ${checks.newLines.length}줄 (→ \`G1_확인목록.md\`) |`);
  p('', '**줄마다 근거 표시(F/GF/U/NEW)를 달았나**', '');
  p('| 문서 | 내용 줄 | 표시 단 줄 | 비율 | F | GF | U | NEW |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [k, t] of Object.entries(checks.tags)) p(`| ${k} | ${t.content_lines} | ${t.tagged} | ${Math.round(t.rate * 100)}% | ${t.F} | ${t.GF} | ${t.U} | ${t.NEW} |`);
  p('', '검사하지 않은 것: DOC-ORDER·DOC-REVEAL(공개 순서와 발생 순서의 의미 비교 — 코드만으로는 판정이 불안정), DOC-VOCAB 중 태그 어휘(에셋 메타데이터 규격 §5 어휘 목록을 입력으로 두지 않았음).');

  p('', '## 5. 01 대조 — 사실(F) · 해석 유보(U) · 금지 왜곡(NG) · 게임 창작(GF)', '');
  p(`짝짓기는 mechanical 단계(${MODELS.mechanical})가 제안하고, 코드가 글자 겹침(두 글자 묶음 Dice)으로 확인했다. 0.25 이상 "짝 확인", 0.15~0.25 "겹침 약함", 그 아래 "기각". 사람본 항목 중 AI에게 주지 않은 출처에만 기대는 것은 "입력 범위 밖"으로 따로 셌다(AI의 실수가 아님).${pairs.llm_ok ? '' : ' ⚠️ LLM 짝짓기 결과를 읽지 못해 코드 최고 겹침만 참고로 적었다.'}`, '');
  p('| 분류 | 사람본 | AI본 | 짝 확인 | 겹침 약함 | 사람본에만(기각 포함) | 입력 범위 밖 | AI본에만 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const cat of ['F', 'U', 'NG', 'GF']) {
    const x = pairs[cat]; if (!x) continue;
    const c = (v) => x.rows.filter((r) => r.verdict === v).length;
    p(`| ${cat} | ${x.humanTotal} | ${x.aiTotal} | ${c('짝 확인')} | ${c('짝(겹침 약함)')} | ${c('사람본에만') + c('짝 기각(겹침 낮음)')} | ${c('입력 범위 밖')} | ${x.aiOnly.length} |`);
  }
  for (const cat of ['F', 'U', 'NG', 'GF']) {
    const x = pairs[cat]; if (!x) continue;
    p('', `### ${cat} 짝표`, '');
    p('| 사람본 | 사람본 내용(요약) | AI 짝 | 겹침 | 판정 | 범위 | 코드 최고 겹침 |', '| --- | --- | --- | ---: | --- | --- | --- |');
    for (const r of x.rows) p(`| ${r.human} | ${r.human_text.slice(0, 70)} | ${r.ai.join(', ') || '—'} | ${r.overlap} | ${r.verdict} | ${r.scope}${r.scope_note ? ' — ' + r.scope_note : ''} | ${r.code_best} |`);
    if (x.aiOnly.length) { p('', `AI본에만 있는 ${cat}:`, ''); for (const a of x.aiOnly) p(`- ${a.id} — ${a.text.slice(0, 120)}`); }
  }

  p('', '## 6. 02~04 비교', '', '### 수치', '');
  p('| 항목 | 사람본 | AI본 |', '| --- | ---: | ---: |');
  for (const r of counts) p(`| ${r[0]} | ${r[1]} | ${r[2]} |`);
  p('', '### 절 포함(빈 양식의 제목 기준)', '');
  p('| 문서 | 양식 제목 수 | 사람본에 있음 | AI본에 있음 | AI본에서 빠진 제목 |', '| --- | ---: | ---: | ---: | --- |');
  for (const [k, c] of Object.entries(cov)) p(`| ${k} | ${c.total} | ${c.human} | ${c.ai} | ${c.rows.filter((r) => !r.ai).map((r) => r.heading).join(' · ') || '없음'} |`);
  for (const k of ['02', '03', '04']) {
    p('', `### ${k} 내용 차이 요약 (${MODELS.judgment}가 두 판본을 읽고 정리)`, '');
    p(diffs[k] ? diffs[k].replace(/^###/gm, '####') : '(요약 없음 — 단계가 실행되지 않았다)');
  }

  p('', '## 7. 사람 검토자(G1)가 확인할 것 — 자동으로 모은 카드', '');
  const cards = [];
  cite.filter((c) => !c.pass).forEach((c) => cards.push(`[인용 불일치] ${c.id} — 「${String(c.quotes[0]?.quote || '').slice(0, 50)}」 원문 대조 필요`));
  (docs['01']?.json?.facts || []).filter((f) => /APPROVAL/.test(f.lock || '')).forEach((f) => cards.push(`[승인 필요 사실] ${f.id} — ${String(f.text).slice(0, 60)}`));
  (docs['01']?.json?.gf || []).forEach((g) => cards.push(`[게임 창작 GF] ${g.id} — ${String(g.setting).slice(0, 70)}`));
  if ((docs['01']?.json?.ng || []).length) cards.push(`[NG 충분성] AI-01 금지 왜곡 ${docs['01'].json.ng.length}개가 충분한가 (사람본 ${pairs.NG?.humanTotal ?? '?'}개)`);
  cards.push(`[NEW 줄] 01~04에 [NEW] ${checks.newLines.length}줄 — \`G1_확인목록.md\``);
  checks.ng.forEach((x) => cards.push(`[금지 왜곡 의심] ${x.doc}:${x.line} — ${x.text.slice(0, 60)}`));
  if (checks.ids.dangling.length) cards.push(`[끊긴 참조] ${checks.ids.dangling.join(', ')}`);
  for (const c of cards) p(`- ${c}`);

  p('', '## 8. 검토자 분석 · 권고', '');
  p(notes ? stripHeaderLine(notes) : '(아직 없음 — 실행 결과를 읽은 뒤 `output/검토자메모.md`에 쓰고 `npm run story:trial -- --report-only`로 다시 만들면 여기에 들어간다.)');
  p('', '---', '', '파일: `output/AI-0n_*.md`(AI 문서) · `output/AI-0n_*.json`(짝 JSON) · `output/AI-04_space_asset_reqs.json` · `output/steps/*/`(프롬프트·원응답·사용량) · `output/usage.json` · `output/checks.json` · `output/G1_확인목록.md`');
  return L.join('\n');
}

// ───────────────────────── dry-run 예상 비용 ─────────────────────────
function dryRun(system, tale) {
  const hum = { '01': readHuman('01 설화 사실 계약서.md'), '02': readHuman('02 지역 테마 시놉시스.md'), '03': readHuman('03 게임 시나리오 기획서.md'), '04': readHuman('04 Scene 구성표.md') };
  const ctx = { tale, hash: 'DRYRUN', system };
  const u01 = userPrompt('01', ctx);
  write('s01_system.txt', txtHead(system));
  write('s01_user.txt', txtHead(u01));
  // 뒤 단계 입력은 앞 AI 문서 크기를 사람본 크기로 어림한다(JSON 동봉분 포함 배수)
  const outEst = { '01': estTokens(hum['01']) * 1.6, '02': estTokens(hum['02']) * 1.1, '03': estTokens(hum['03']) * 1.2, '04': estTokens(hum['04']) * 1.0 };
  const sys = estTokens(system);
  const rows = [];
  let acc = 0; let worst = 0;
  const prevDocs = (n) => ['01', '02', '03'].slice(0, n).reduce((a, k) => a + outEst[k], 0);
  ['01', '02', '03', '04'].forEach((k, i) => {
    const tplLen = estTokens(readIn(`templates/${tplFile(k)}`));
    const inTok = Math.round(sys + tplLen + (k === '01' ? estTokens(tale) + 1500 : prevDocs(i) + 1200));
    const e = costOf(MODELS.judgment, { input_tokens: inTok, output_tokens: Math.round(outEst[k]) });
    const w = costOf(MODELS.judgment, { input_tokens: inTok, output_tokens: STEP_CFG[k].maxTokens });
    acc += e; worst += w;
    rows.push(`| s${k} | ${MODELS.judgment} | ~${inTok} | ~${Math.round(outEst[k])} (최대 ${STEP_CFG[k].maxTokens}) | ~$${e.toFixed(3)} | $${w.toFixed(3)} |`);
  });
  const pairIn = 6000; const diffIn = ['02', '03', '04'].reduce((a, k) => a + estTokens(hum[k]) * 2 + 400, 0);
  const cmp = costOf(MODELS.mechanical, { input_tokens: pairIn, output_tokens: 2500 }) + costOf(MODELS.judgment, { input_tokens: diffIn, output_tokens: 3 * 2500 });
  const cmpW = costOf(MODELS.mechanical, { input_tokens: pairIn, output_tokens: 4000 }) + costOf(MODELS.judgment, { input_tokens: diffIn, output_tokens: 3 * 3500 });
  rows.push(`| 비교(짝짓기 1 + 차이 요약 3) | haiku + sonnet | ~${pairIn + Math.round(diffIn)} | ~${2500 + 7500} | ~$${cmp.toFixed(3)} | $${cmpW.toFixed(3)} |`);
  const md = [
    '# story-trial-1015 dry-run — 예상 비용(호출 없음)', '',
    `시스템 프롬프트(규격 + 게임 틀 4종) 어림 ${sys} 토큰 · 원전 ${estTokens(tale)} 토큰 · 한국어 1글자≈0.9토큰으로 어림(실행 때는 count_tokens로 실측).`, '',
    '| 단계 | 모델 | 입력 | 출력 | 예상 | 최악(max_tokens 전부) |', '| --- | --- | ---: | ---: | ---: | ---: |', ...rows,
    `| **합계** | | | | **~$${(acc + cmp).toFixed(2)}** | **$${(worst + cmpW).toFixed(2)}** |`, '',
    `상한 $${CAP}. 실행 중에는 매 호출 전 "누적 + 이번 최악"이 상한을 넘으면 멈춘다.`,
  ].join('\n');
  write('예상비용.md', mdHead(md));
  console.log(md);
}

// ───────────────────────── mock 응답(코드 경로 점검용) ─────────────────────────
function mockResponse(id) {
  const J = (o) => `===JSON===\n${FENCE}json\n${JSON.stringify(o, null, 1)}\n${FENCE}\n===MARKDOWN===\n`;
  const head = (t) => `| 필드 | 값 |\n| --- | --- |\n| case_id | ${CASE_ID} |\n| story_id | ${STORY_ID} |\n| doc_type | ${t} |\n| doc_version | v1.0 |\n| author_kind | agent |\n| author | mock |\n| input_hash | x |\n| status | DRAFT |\n`;
  const u = { input_tokens: 1000, output_tokens: 500 };
  const R = (text) => ({ usage: u, stopReason: 'end_turn', model: 'mock-model', text });
  if (id === 's01') return R(J({ doc_type: 'fact_contract', facts: [
    { id: 'F-01', category: '장소', text: '앙암바위는 영산포구 쪽 절벽이다', src: ['SRC-01'], loc: '본문 1문단', quote: '깍아지른 듯한 절벽이 있는데', lock: 'LOCKED' },
    { id: 'F-02', category: '장소', text: '오타 교정 인용(실패해야 함)', src: ['SRC-01'], loc: '본문 1문단', quote: '깎아지른 듯한 절벽이 있는데', lock: 'LOCKED' },
    { id: 'F-03', category: '인물', text: '아랑사는 택촌 어부, 아비사는 진부촌 처녀다', src: ['SRC-01'], loc: '본문 1문단', quote: '택촌에 사는 아랑사라는 어부가', lock: 'LOCKED' }],
    open: [{ id: 'U-01', issue: '구렁이가 아랑사인지 원문은 말하지 않는다', rule: '단정 금지' }],
    ng: [{ id: 'NG-01', change: '거주 마을 뒤바꾸기', reason: '원문 명시', refs: ['F-03'] }],
    gf: [{ id: 'GF-01', setting: '구렁이는 아랑사일 수 있다는 암시', status: '제안', tag: 'NEW' }] }) + `# 01\n${head('fact_contract')}\n## 2. 반드시 유지할 핵심 사실\n- 앙암바위는 절벽이다 [F: F-01]\n- 진부촌에 사는 아랑사 [F]\n- 새 설정 [NEW]\n- 표시 없는 줄\n`);
  if (id === 's02') return R(J({ doc_type: 'synopsis', questions: [{ id: 'Q-01', text: '아랑사는 어디에?' }], reversals: [{ id: 'RV-01', basis: ['F-03', 'GF-09'] }] }) + `# 02\n${head('synopsis')}\n# 3. 핵심 미스터리\n- Q-01 아랑사는 어디에 [NEW]\n`);
  if (id === 's03') return R(J({ doc_type: 'scenario', reveal_order: [{ seq: 1, basis: ['F-03'], scene_id: 'scene-01' }], scenes: [{ scene_id: 'scene-01', answers_q: ['Q-01'] }] }) + `# 03\n${head('scenario')}\n## 7. 정보 공개 순서\n- 1 [F: F-03]\n`);
  const s04 = '{"doc_type":"scene_table","scenes":[{"scene_id":"scene-01","required_discoveries":[{"id":"RD-S1-01","logic":{"claim":"모순","conditions":""}}],"space_reqs":[{"space_req_id":"SPREQ-S1-01"}],"asset_reqs":[{"req_id":"REQ-S1-01"}],"puzzle_link":{"interactions":["observe","talk"]}}]}';
  if (id === 's04') return R(`===JSON===\n${FENCE}json\n${s04.replace(/\]\}$/, ',]}')}\n${FENCE}\n===MARKDOWN===\n# 04\n# Scene 01\n### 필수 발견\n- RD-S1-01 [F]\n`); // 일부러 JSON 문법 오류
  if (id === 's04-repair') return R(`${FENCE}json\n${s04}\n${FENCE}`);
  if (id === 'cmp-pair01') return R(`${FENCE}json\n{"F":[{"human":"F-01","ai":["F-01"]},{"human":"F-03","ai":["F-03"]},{"human":"F-13","ai":[]}],"U":[{"human":"U-01","ai":["U-01"]}],"NG":[{"human":"NG-01","ai":["NG-01"]}],"GF":[{"human":"GF-02","ai":["GF-01"]}]}\n${FENCE}`);
  if (id.startsWith('cmp-diff')) return R('### 사람본에만 있는 중요한 내용\n- (mock)\n### 한 줄 평가\n- (mock)');
  throw new Error('mock 없음: ' + id);
}

// ───────────────────────── 실행 ─────────────────────────
async function main() {
  const tale = readIn('SRC-01_나주문화원_앙암바위.txt');
  const system = systemPrompt();
  if (DRY) { dryRun(system, tale); return; }
  console.log(`story-trial-1015 시작 — 출력: ${path.relative(ROOT, OUT)} · 상한 $${CAP}${MOCK ? ' · MOCK' : ''}${REPORT_ONLY ? ' · 보고서만' : ''}`);
  const docs = {};
  let aborted = null;
  try {
    docs['01'] = await runDocStep('01', { system, tale, hash: sha(tale) });
    if (docs['01']) docs['02'] = await runDocStep('02', { system, d01: docs['01'], hash: sha(docs['01'].md + JSON.stringify(docs['01'].json)) });
    if (docs['02']) docs['03'] = await runDocStep('03', { system, d01: docs['01'], d02: docs['02'], hash: sha(['01', '02'].map((k) => docs[k].md).join('\n')) });
    if (docs['03']) docs['04'] = await runDocStep('04', { system, d01: docs['01'], d02: docs['02'], d03: docs['03'], hash: sha(['01', '02', '03'].map((k) => docs[k].md).join('\n')) });
  } catch (e) {
    aborted = e.message;
    console.error(e instanceof BudgetError ? `■ ${e.message}` : `■ 단계 실패: ${e.message}`);
  }
  for (const k of Object.keys(docs)) if (!docs[k]) delete docs[k];
  if (!docs['01']) { console.error('AI-01이 없어 검사·비교를 할 수 없습니다.'); saveLedger(); process.exitCode = 1; return; }

  // 검사(코드)
  const cite = citationCheck(docs['01'], tale);
  const checks = docChecks(docs);
  write('checks.json', jsonHead({ citation: cite, ...checks }));
  write('G1_확인목록.md', mdHead(['# G1 확인 목록 — [NEW] 줄 모음(DOC-NEW)', '', '| 문서 | 줄 | 내용 |', '| --- | ---: | --- |', ...checks.newLines.map((x) => `| ${x.doc} | ${x.line} | ${x.text.replace(/\|/g, '/').slice(0, 200)} |`)].join('\n')));

  // 비교(사람본 읽기 전용)
  const H = { '01': readHuman('01 설화 사실 계약서.md'), '02': readHuman('02 지역 테마 시놉시스.md'), '03': readHuman('03 게임 시나리오 기획서.md'), '04': readHuman('04 Scene 구성표.md') };
  const h01 = parseHuman01(H['01']);
  let pairs = {}; const diffs = {};
  try {
    pairs = await pairItems(h01, docs['01']);
    for (const k of ['02', '03', '04']) if (docs[k]) diffs[k] = await diffSummary(k, H[k], docs[k].md);
  } catch (e) { aborted = (aborted ? aborted + ' / ' : '') + '비교 단계: ' + e.message; console.error('■ 비교 단계 실패:', e.message); }
  const tpl = (k) => stripHeaderLine(readIn(`templates/${tplFile(k)}`));
  const cov = {}; for (const k of ['01', '02', '03', '04']) cov[k] = sectionCoverage(tpl(k), H[k], docs[k]?.md || '');
  const j2 = docs['02']?.json; const j3 = docs['03']?.json; const j4 = docs['04']?.json;
  const aiRd = (j4?.scenes || []).map((s) => (s.required_discoveries || []).length);
  const humanRd = countHuman(H['04'], 'rd');
  const uniq = (md, re) => new Set((md || '').match(re) || []).size;
  const counts = [
    ['01 사실 F 수', h01.F.length, (docs['01'].json?.facts || []).length],
    ['01 해석 유보 U 수', h01.U.length, (docs['01'].json?.open || []).length],
    ['01 금지 왜곡 NG 수', h01.NG.length, (docs['01'].json?.ng || []).length],
    ['01 게임 창작 GF 수', h01.GF.length, (docs['01'].json?.gf || []).length],
    ['02 핵심 질문(Q) 수', countHuman(H['02'], 'q'), j2?.questions?.length ?? uniq(docs['02']?.md, /Q-\d{2}/g)],
    ['02 반전 수', countHuman(H['02'], 'reversals'), j2?.reversals?.length ?? '—'],
    ['03 정보 공개 단계 수', countHuman(H['03'], 'reveal'), j3?.reveal_order?.length ?? '—'],
    ['03 Scene 개요 행 수', countHuman(H['03'], 'sceneOverview'), j3?.scenes?.length ?? '—'],
    ['04 Scene 수', countHuman(H['04'], 'scenes'), j4?.scenes?.length ?? uniq(docs['04']?.md, /^#\s+Scene.*$/gm)],
    ['04 필수 발견(RD) 수 — Scene별', humanRd.join(' / ') + ` (계 ${humanRd.reduce((a, b) => a + b, 0)})`, aiRd.length ? aiRd.join(' / ') + ` (계 ${aiRd.reduce((a, b) => a + b, 0)})` : '—'],
    ['04 공간 요구 SPREQ 수', '0 (사람본은 규격 이전 양식 — 자연어만)', (j4?.scenes || []).reduce((a, s) => a + (s.space_reqs || []).length, 0)],
    ['04 에셋 요구 REQ 수', '0 (사람본은 규격 이전 양식 — 자연어만)', (j4?.scenes || []).reduce((a, s) => a + (s.asset_reqs || []).length, 0)],
    ['문서 길이(글자) 01/02/03/04', ['01', '02', '03', '04'].map((k) => H[k].length).join(' / '), ['01', '02', '03', '04'].map((k) => docs[k]?.md.length ?? '—').join(' / ')],
  ];
  let scrubReport = {};
  try { scrubReport = JSON.parse(readIn('templates/_scrub_report.json')); } catch { /* 없음 */ }
  const report = buildReport({ docs, cite, checks, pairs, cov, counts, diffs, scrubReport, aborted });
  write('비교보고서.md', mdHead(report));
  write('비교보고서.html', mdToHtml(report, 'story-trial-1015 비교 보고서'));
  write('compare.json', jsonHead({ pairs, cov, counts }));
  saveLedger();
  console.log(`\n완료 — 인용 통과 ${cite.filter((c) => c.pass).length}/${cite.length}, 총비용 ${usd(spent())}, 보고서: ${path.relative(ROOT, path.join(OUT, '비교보고서.md'))}`);
}

main().catch((e) => { console.error('■', e.message); saveLedger(); process.exitCode = 1; });
