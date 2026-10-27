// agentTrial.mjs — 검수 작업대 「에이전트 시험」 (10/19)
//   설화 원문 하나를 넣고 이야기 에이전트(01~04) → 에셋 선정(05) → 공간 배치 초안(06)을 단계마다 페이지 버튼으로 돌린다.
//   사람 문서·나주 공간·manifest 는 읽기만 한다. 결과는 .local/review/trials/<id>/ 에만 쓴다.
//   06 의 배치 초안은 「빈 지형」(NAJU-01-EMPTY) 에 연결한 시험 전용 검수 기록으로 가져온다 — 공간 승인해도 게임 데이터에 반영하지 않는다.
//
//   API 는 제작 단계에서만 부른다(에이전트 구조 §8): 이 모듈의 「실행」 요청 때만. 매 호출 전 「지금까지 쓴 돈 + 이번 최악 비용」이
//   시험 예산을 넘으면 멈춘다. 키는 tools/llm/claude.mjs 가 .env.local 에서 읽는다(여기서는 키를 다루지 않는다).
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const TRIAL_ROOT = '.local/review/trials';
const KIT_IN = '.local/experiments/story-trial-1015/input';
const FRAME_DIR = '프로젝트파일/데이터/게임문서';
const PRESET_SOURCE = `${KIT_IN}/SRC-01_나주문화원_앙암바위.txt`;
const SPACE_ID = 'space:naju01-angam';
const HEADER = 'AI 시험 생성본 — 원본 아님 (에이전트 시험)';
const PROMPT_VERSION = 'agent-trial v1 (2026-10-19)';
export const DEFAULT_BUDGET_USD = 8;

/** 단계 표 — 순서·이름·모델 급·출력 한도·생각 몫 */
export const STEPS = Object.freeze([
  // effort — 생각 양(low·medium·high). 10/19 첫 실행: 생각이 48,000 중 37,499 토큰을 써 01 본문이 잘렸다 → 문서 단계는 low
  { id: 's01', no: '01', label: '설화 사실 계약서', tier: 'judgment', maxTokens: 48000, effort: 'low' },
  { id: 's02', no: '02', label: '지역 테마 시놉시스', tier: 'judgment', maxTokens: 40000, effort: 'low' },
  { id: 's03', no: '03', label: '게임 시나리오 기획서', tier: 'judgment', maxTokens: 40000, effort: 'low' },
  { id: 's04', no: '04', label: 'Scene 구성표(JSON)', tier: 'judgment', maxTokens: 48000, effort: 'low' },
  { id: 's05', no: '05', label: '에셋 선정', tier: 'judgment', maxTokens: 24000, effort: 'medium' },
  { id: 's06', no: '06', label: '공간 배치 초안', tier: 'judgment', maxTokens: 24000, effort: 'medium' },
]);
// 공정 2판(10/19, agentTrialV2.mjs) — 새 시험의 기본. 1판 시험(pipeline 없음)은 1판 표 그대로
import { STEPS_V2, v2Kit } from './agentTrialV2.mjs';
// 실내 방 세트 공정(10/21, indoorTrial.mjs) — 시험의 spaceKind 가 indoor 일 때 06~08 이 실내판
import { STEPS_INDOOR, INDOOR_SPACE_ID, indoorKit, indoorCompare } from './indoorTrial.mjs';
const stepsFor = trial => (trial?.spaceKind === 'indoor' ? STEPS_INDOOR : trial?.pipeline === 2 ? STEPS_V2 : STEPS);
/** 각색 조건(10/21) — 제작팀이 정한 각색 방침. 01(사실 추출)에는 넣지 않는다(원전과 창작이 섞이지 않게) */
const adaptText = trial => trial?.adaptation?.text ? `[각색 조건 — 제작팀이 정한 게임 각색 방침. 원전 사실이 아니다. 01 의 F 근거로 쓰지 않고, 이 조건에서 나온 내용은 [NEW] 또는 GF 로 표시한다. 반드시 따른다]\n${trial.adaptation.text}${trial.spaceKind === 'indoor' ? '\n\n[공간] 이 시험의 게임 공간은 한옥 한 채다(10/22): 방(문을 닫는 실내)과 마루(대청처럼 지붕은 있지만 앞이 마당으로 트인 반외부 — 실내가 아니다)를 합쳐 2~4칸. 공간은 하나씩 불러오고 문으로 이동한다. 마당은 걸어 다니지 않지만 마루와 문에서 늘 보이는 배경(담·대문·나무·하늘)이라, 마루에서 보이는 것(대문·디딤돌·달 등)을 단서로 쓸 수 있다. 그 밖의 야외 무대·원경 landmark·npc(말을 거는 인물) 호스트는 만들지 않는다.' : ''}` : '';
const stepOf = (id, trial) => stepsFor(trial).find(s => s.id === id);

// ── 비용 ── story-trial 과 같은 단가표 + 캐시(쓰기 1.25배 · 읽기 0.1배)
const priceOf = model => (/haiku/.test(model) ? [0.1, 0.5] : /opus/.test(model) ? [4, 20] : [2, 10]);
export function costOf(model, usage = {}) {
  const [pi, po] = priceOf(model);
  const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  return (input * pi + (usage.output_tokens || 0) * po) / 1e6;
}

const fail = (status, code, message, details) => { throw Object.assign(new Error(message), { status, code, details }); };
const sha = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

// ── 저장 ──
const trialDir = (root, id) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) fail(400, 'invalid_trial', '시험 ID 형식이 아닙니다.');
  return path.join(root, TRIAL_ROOT, id);
};
async function writeAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, text, { mode: 0o600 });
  await fs.rename(temp, file);
}
export async function readTrial(root, id) {
  try { return JSON.parse(await fs.readFile(path.join(trialDir(root, id), 'trial.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') fail(404, 'trial_not_found', '에이전트 시험을 찾을 수 없습니다.'); throw error; }
}
async function saveTrial(root, trial) {
  trial.updatedAt = new Date().toISOString();
  await writeAtomic(path.join(trialDir(root, trial.id), 'trial.json'), JSON.stringify(trial, null, 2));
}
async function writeOut(root, trial, name, text) {
  if (!/^[\w가-힣.-]+$/u.test(name)) fail(400, 'invalid_name', name);
  await writeAtomic(path.join(trialDir(root, trial.id), name), text);
}
async function readOut(root, trial, name) {
  try { return await fs.readFile(path.join(trialDir(root, trial.id), name), 'utf8'); } catch { return null; }
}
async function readJsonOut(root, trial, name) {
  const text = await readOut(root, trial, name);
  return text ? JSON.parse(text) : null;
}

export async function listTrials(root) {
  const dir = path.join(root, TRIAL_ROOT);
  let names = [];
  try { names = await fs.readdir(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    try { const t = JSON.parse(await fs.readFile(path.join(dir, name, 'trial.json'), 'utf8')); out.push(summary(t)); } catch { /* 깨진 폴더는 건너뜀 */ }
  }
  return out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}
const summary = t => ({ id: t.id, title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt, spentUsd: t.spentUsd, budgetUsd: t.budgetUsd, done: stepsFor(t).filter(s => t.steps[s.id]?.status === 'done').length, total: stepsFor(t).length, pipeline: t.pipeline || 1, spaceKind: t.spaceKind || 'outdoor', hasAdaptation: Boolean(t.adaptation?.text), llm: t.llm || 'claude', running: stepsFor(t).find(s => t.steps[s.id]?.status === 'running')?.id || null });

export async function presetSource(root) {
  const text = await fs.readFile(path.join(root, PRESET_SOURCE), 'utf8').catch(() => null);
  return text ? { name: '나주문화원 「앙암바위」 (SRC-01, 10/15 수집)', text } : null;
}

// 01 사실에서 (원문 「…」)로 남긴 방언·옛말 낱말
export function dialectTokens(d01) {
  return [...new Set([...(d01?.facts || []), ...(d01?.open || [])].flatMap(f => [...String(f.text || '').matchAll(/원문 「([^」]{2,8})」/g)].map(m => m[1].trim())))].filter(t => t.length >= 2 && !/[?？]/.test(t));
}

export async function createTrial(root, input) {
  const title = clip(String(input?.title || '').trim(), 120) || '에이전트 시험';
  const sourceText = String(input?.sourceText || '');
  if (!sourceText.trim() || sourceText.length > 60000) fail(400, 'invalid_source', '설화 원문을 1~60,000자로 넣어 주세요.');
  const budget = Number(input?.budgetUsd ?? DEFAULT_BUDGET_USD);
  if (!(budget > 0 && budget <= 30)) fail(400, 'invalid_budget', '시험 예산은 $0~30 사이로 정해 주세요.');
  const trial = {
    id: randomUUID(), title, createdAt: new Date().toISOString(), updatedAt: null, promptVersion: PROMPT_VERSION, pipeline: 2,
    source: { name: clip(String(input?.sourceName || '직접 입력'), 200), text: sourceText, sha: sha(sourceText) },
    spaceId: SPACE_ID, budgetUsd: budget, spentUsd: 0, calls: [], steps: {}, missingDecisions: {}, reviewProjectId: null,
    llm: input?.llm === 'local' ? 'local' : 'claude',
  };
  const adaptation = String(input?.adaptation || '');
  if (adaptation.length > 20000) fail(400, 'invalid_adaptation', '각색 조건은 20,000자 이하로 넣어 주세요.');
  if (adaptation.trim()) trial.adaptation = { text: adaptation, sha: sha(adaptation) };
  if (input?.spaceKind === 'indoor') { trial.spaceKind = 'indoor'; trial.spaceId = INDOOR_SPACE_ID; }
  // 앞 시험의 01~04 를 그대로 이어받기(같은 원문일 때만) — 문서 단계 비용을 다시 쓰지 않고 뒤 공정만 시험
  if (input?.fromTrialId) {
    const from = await readTrial(root, String(input.fromTrialId));
    if (from.source.sha !== trial.source.sha) fail(409, 'source_mismatch', '이어받을 시험의 원문이 다릅니다.');
    // 각색 조건이 다르면 02~04 는 다시 써야 한다 — 01(원문만 보고 쓴 사실 계약)만 이어받는다
    const sameAdapt = (from.adaptation?.sha || null) === (trial.adaptation?.sha || null);
    for (const no of sameAdapt ? ['01', '02', '03', '04'] : ['01']) {
      for (const name of [`AI-${no}.md`, `AI-${no}.json`]) { const text = await readOut(root, from, name); if (text) await writeOut(root, trial, name, text); }
      const st = from.steps[`s${no}`];
      if (st?.status === 'done') trial.steps[`s${no}`] = { ...st, costUsd: 0, copiedFrom: from.id };
    }
    trial.copiedFrom = from.id;
  }
  await saveTrial(root, trial);
  return trial;
}

// ── 이야기 에이전트(01~04) ──
async function storyKit(root) {
  const { createStoryPrompts, splitResponse } = await import('../llm/storyAgent.mjs');
  const prompts = createStoryPrompts({ inDir: path.join(root, KIT_IN), humanDir: path.join(root, FRAME_DIR), caseId: 'case-trial', storyId: 'story-trial', promptVersion: PROMPT_VERSION });
  return { ...prompts, splitResponse };
}
const docIn = (d) => ({ json: d.json, md: d.md });
async function docsSoFar(root, trial) {
  const out = {};
  for (const no of ['01', '02', '03', '04']) {
    const json = await readJsonOut(root, trial, `AI-${no}.json`).catch(() => null);
    const md = await readOut(root, trial, `AI-${no}.md`);
    if (json || md) out[no] = { json, md: md ? md.replace(/^> [^\n]*\n\n/, '') : '' };
  }
  return out;
}

/** 04 를 JSON 만으로 — 마크다운은 아래 renderSceneTable 이 그린다 */
function scene04Only(prompt) {
  return prompt.replace(/\[짝 JSON 모양\]/, '[출력 — 작업대 판(10/19)]\n이번에는 마크다운을 쓰지 않는다. 응답은 ```json 코드블록 하나(짝 JSON)뿐이다. 마크다운은 작업대가 JSON 으로 그린다. 그래서 JSON 에 문서의 모든 내용을 담는다.\n\n[짝 JSON 모양]');
}
function renderSceneTable(json) {
  const lines = [`# 04 Scene 구성표 (JSON 에서 그림)`, ''];
  if (json?.map) lines.push(`- 맵: ${json.map.map_id || ''} · ${json.map.structure || ''} ${json.map.notes ? `· ${json.map.notes}` : ''}`, '');
  for (const s of json?.scenes || []) {
    lines.push(`## ${s.scene_id} · ${s.title || ''}`, '', `- 목적: ${s.purpose || ''}`, `- 들어올 때 아는 것: ${(s.entry_knows || []).join(' / ')}`, `- 질문: ${(s.questions || []).join(', ')}`);
    if (s.mood) lines.push(`- 분위기: ${s.mood.base || ''} · 목표 감정 ${s.mood.target_emotion || ''} · 긴장 ${s.mood.tension || ''}`);
    lines.push('', '### 필수 발견');
    for (const r of s.required_discoveries || []) lines.push(`- ${r.id}: ${r.text} [${(r.basis || []).join(', ')}]${r.logic ? ` — 논리: ${r.logic.claim} (조건: ${r.logic.conditions})` : ''}`);
    lines.push('', '### 공간 요구');
    for (const r of s.space_reqs || []) lines.push(`- ${r.space_req_id}: ${r.must_read_as || ''} · 장소 ${(r.setting || []).join('/')} · 시대 ${r.era || ''} · ${r.layer || ''}`);
    lines.push('', '### 에셋 요구');
    for (const r of s.asset_reqs || []) lines.push(`- ${r.req_id} (${r.category}): ${r.role_hint || ''} · 태그 ${(r.tags_any || []).join('/')} · 이유: ${r.lore_reason || ''}${r.dressing_only ? ' · 장식 전용' : ''}`);
    if (s.exit) lines.push('', `- 나가는 조건: ${s.exit.complete_when || ''} (${s.exit.trigger || ''})`);
    lines.push('');
  }
  return lines.join('\n');
}

// ── 공용: LLM 한 번 + JSON 꺼내기 ──
function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/) || text.match(/```json\s*([\s\S]*)$/);
  const raw = (fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).trim();
  try { return JSON.parse(raw); } catch (error) { return { __error: error.message, __raw: raw.slice(0, 2000) }; }
}

// ── 05 에셋 선정 ──
const ERA_HINT = { joseon: '조선', goryeo: '고려', ancient: '고대', timeless: '시대 공통' };
function candidateLine(item) {
  const bounds = Array.isArray(item.boundsM) && item.boundsM.every(Number.isFinite) ? item.boundsM.map(v => v.toFixed(1)).join('×') + 'm' : '-';
  return [
    item.id, item.nameKo, item.categoryKo, item.era || '-', (item.spaces || []).slice(0, 4).join('/') || '-',
    clip(item.description || item.subjectEn || '', 90) || '-', (item.loreHints || []).slice(0, 2).join('/') || '-',
    (item.requiresContext || []).join('/') || '-', (item.notFor || []).join('/') || '-', bounds,
    item.needsReplacement ? '임시본' : item.metaQuality === 'auto' ? '설명 추정' : '',
  ].join(' | ');
}
async function candidatesFor(root, reqs) {
  const { buildLibrary, searchLibrary } = await import('./library.mjs');
  const { items } = await buildLibrary(root);
  const out = {};
  for (const req of reqs) {
    // role_hint 는 규격상 추상 역할(clue_source·ambience …)이라 검색어로 쓰지 않는다(영문 소문자 낱말이면 뺀다). 한글 태그가 실제 검색어다.
    const queries = [req.role_hint, ...(req.tags_any || [])].filter(q => typeof q === 'string' && q.trim() && !/^[a-z_\s-]+$/u.test(q.trim())).slice(0, 6);
    const best = new Map();
    for (const q of queries) {
      const found = await searchLibrary(items, q, { placeableOnly: true, root, waitSemanticMs: 15000, limit: 20 });
      for (const r of found.results.slice(0, 12)) if (r.item.source !== 'space') best.set(r.item.id, Math.max(best.get(r.item.id) || 0, r.score));
    }
    out[req.req_id] = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id]) => items.find(i => i.id === id));
  }
  return { out, items };
}
async function spaceItem(root) {
  const { buildLibrary } = await import('./library.mjs');
  return (await buildLibrary(root)).items.find(i => i.id === SPACE_ID) || null;
}
function spaceText(space) {
  return [
    `공간: ${space.nameKo} (${space.kind === 'outdoor' ? '야외' : space.kind}, ${space.sizeM?.join(' × ')} m)`, space.description,
    '구역(미터 좌표 · 동서 x, 남북 z — z 가 클수록 남쪽 강 쪽):',
    ...space.zones.map(z => `- ${z.code} ${z.physicalName}: x ${z.x.join('~')}, z ${z.z.join('~')}, 높이 EL ${z.elevation >= 0 ? '+' : ''}${z.elevation} m · ${z.surface}`),
    '지형 요소:', ...space.features.map(f => `- ${f.name}: ${f.detail}`),
  ].join('\n');
}
const SELECT_SYSTEM = `너는 지역 설화 기반 방탈출 게임 「왜곡」의 에셋 선정 에이전트다. Scene 구성표의 에셋 요구(REQ)마다 공용 라이브러리 후보 중에서 고른다.
규칙
- 반드시 그 REQ 의 후보 목록에 있는 id 만 고른다. 지어내지 않는다.
- 시대(era)·장소(setting)·설화 단서·맥락 필요(requiresContext)·금지(notFor)를 본다. 맞는 게 없으면 억지로 고르지 말고 pick 을 null 로 두고 missing 에 무엇이 필요한지 적는다.
- 「임시본」은 코드 모형을 뽑은 임시 3D 다(실제 에셋으로 바꿀 예정). 뜻이 맞으면 써도 되지만 reason 에 「임시본」이라고 적는다.
- 「설명 추정」은 메타데이터를 코드가 추정한 것이다. 이름과 분류를 더 믿어라.
- count 는 그 REQ 를 채우려고 놓을 개수(1~8). 장식 전용(dressing)은 여럿, 이야기 물건(story_object)은 보통 1.
- reason 은 한국어 한 문장: 왜 이 물건이 이 자리에 자연스러운가.
- alternatives 는 차선 후보 id 최대 2개.
출력: \`\`\`json 코드블록 하나만.
{"selections":[{"req_id":"REQ-S1-01","scene_id":"scene-01","pick":"후보 id 또는 null","count":1,"reason":"","alternatives":[],"missing":null 또는 {"name_ko":"","description_ko":"생김새·재질·크기","why":"후보가 왜 안 맞나"}}]}`;

// ── 06 배치 초안 ──
const LAYOUT_SYSTEM = `너는 「왜곡」 공간 배치 에이전트다. 주어진 야외 공간의 구역 안에, 선정된 에셋을 처음부터 놓는다(지금 공간에는 지형·강·절벽만 있고 물건은 없다).
규칙
- Scene 마다 쓸 구역(1~2개)을 고르고 이유를 적는다. 구역은 주어진 code 만.
- 각 에셋은 고른 구역의 사각형 안에 둔다(가장자리에서 0.7 m 이상 안쪽). 좌표는 미터. y(높이)는 적지 않는다 — 땅에 붙인다.
- 같은 자리에 겹치지 않게 서로 (두 물건 폭의 절반 합 + 0.3 m) 이상 띄운다. 길·절벽 가장자리를 막지 않는다.
- 이야기 물건은 플레이어가 지나가며 볼 자리에, 장식은 가장자리·벽 쪽에.
- rotationY 는 도(0~359). scale 은 1(실제 크기)을 기본으로, 꼭 필요할 때만 0.7~1.3.
- reason 은 한국어 한 문장.
출력: \`\`\`json 코드블록 하나만.
{"scene_zones":[{"scene_id":"scene-01","zones":["Z1"],"reason":""}],"items":[{"req_id":"REQ-S1-01","asset_id":"","scene_id":"scene-01","zone":"Z1","x":0,"z":0,"rotationY":0,"scale":1,"reason":""}]}`;

function validateLayout(space, layout, picks) {
  const zones = new Map(space.zones.map(z => [z.code, z]));
  const pickMap = new Map(picks.map(p => [`${p.req_id}|${p.pick}`, p]));
  const accepted = []; const rejected = []; const warnings = [];
  const margin = 0.3;
  for (const [index, item] of (layout.items || []).entries()) {
    const zone = zones.get(item.zone);
    const pick = pickMap.get(`${item.req_id}|${item.asset_id}`);
    const why = !zone ? `없는 구역 ${item.zone}` : !pick ? `선정에 없는 에셋 ${item.asset_id}` : !Number.isFinite(item.x) || !Number.isFinite(item.z) ? '좌표가 숫자가 아님'
      : item.x < zone.x[0] + margin || item.x > zone.x[1] - margin || item.z < zone.z[0] + margin || item.z > zone.z[1] - margin ? `${item.zone} 사각형 밖 (${item.x}, ${item.z})` : null;
    if (why) { rejected.push({ index, ...item, why }); continue; }
    const scale = Number.isFinite(item.scale) ? Math.min(1.3, Math.max(0.7, item.scale)) : 1;
    const heightM = pick.real ? +Math.min(pick.real.range[1], Math.max(pick.real.range[0], pick.real.heightM * scale)).toFixed(3) : null;
    accepted.push({ ...item, rotationY: Number.isFinite(item.rotationY) ? item.rotationY : 0, scale, heightM, heightSource: pick.real?.source || null, boundsM: pick.boundsM || null });
  }
  for (let i = 0; i < accepted.length; i++) for (let j = i + 1; j < accepted.length; j++) {
    const a = accepted[i]; const b = accepted[j];
    const ra = Math.max(...(a.boundsM || [1, 1, 1]).filter((_, k) => k !== 1)) / 2; const rb = Math.max(...(b.boundsM || [1, 1, 1]).filter((_, k) => k !== 1)) / 2;
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d < (ra + rb) * 0.8) warnings.push(`${a.req_id}·${b.req_id} 가 겹칠 수 있음 (${d.toFixed(1)} m)`);
  }
  return { accepted, rejected, warnings };
}

// ── 실행 ──
const running = new Map(); // trialId -> stepId
async function llm(root, trial, step, { system, user, cacheSystem = false }) {
  // 공급자: 시험별 기본(trial.llm) + 단계별 지정(trial.llmSteps[step.id]). local 이면 비용 0 · 예산 검사 없음(10/19)
  const provider = trial.llmSteps?.[step.id] || trial.llm || 'claude';
  if (provider === 'local') {
    const { streamLocal } = await import('../llm/local.mjs');
    const t0 = Date.now();
    const r = await streamLocal({ system, messages: [{ role: 'user', content: user }], maxTokens: step.maxTokens, onProgress: n => { trial.steps[step.id].progressChars = n; } });
    trial.calls.push({ step: step.id, model: r.model, usage: r.usage, costUsd: 0, ms: Date.now() - t0, stopReason: r.stopReason, provider: 'local', at: new Date().toISOString() });
    Object.assign(trial.steps[step.id], { costUsd: 0, provider: 'local', model: r.model, stopReason: r.stopReason, outputTokens: r.usage?.output_tokens, ms: Date.now() - t0 });
    if (r.stopReason === 'max_tokens') trial.steps[step.id].truncated = true;
    if (!String(r.text || '').trim()) fail(502, 'empty_output', '로컬 모델 답이 비었습니다.');
    return r.text;
  }
  const { streamClaude, countTokens, MODELS } = await import('../llm/claude.mjs');
  const model = MODELS[step.tier];
  const messages = [{ role: 'user', content: user }];
  const inTok = await countTokens({ tier: step.tier, system, messages });
  const worst = costOf(model, { input_tokens: inTok, output_tokens: step.maxTokens });
  if (trial.spentUsd + worst > trial.budgetUsd) fail(402, 'budget_exceeded', `예산 초과 — 지금까지 $${trial.spentUsd.toFixed(3)} + 이번 최악 $${worst.toFixed(3)} > 예산 $${trial.budgetUsd}. 예산을 올리거나 멈추세요.`);
  const t0 = Date.now();
  const r = await streamClaude({ tier: step.tier, system, messages, maxTokens: step.maxTokens, cacheSystem, effort: step.effort, onProgress: n => { trial.steps[step.id].progressChars = n; } });
  const cost = costOf(r.model || model, r.usage);
  trial.spentUsd = +(trial.spentUsd + cost).toFixed(5);
  trial.calls.push({ step: step.id, model: r.model || model, usage: r.usage, costUsd: +cost.toFixed(5), ms: Date.now() - t0, stopReason: r.stopReason, thinkingParam: r.thinkingParam, at: new Date().toISOString() });
  Object.assign(trial.steps[step.id], { costUsd: +((trial.steps[step.id].costUsd || 0) + cost).toFixed(5), stopReason: r.stopReason, outputTokens: r.usage?.output_tokens, thinkingTokens: r.usage?.output_tokens_details?.thinking_tokens ?? null, thinkingParam: r.thinkingParam, thinkingError: r.thinkingError || null });
  if (r.stopReason === 'max_tokens') trial.steps[step.id].truncated = true;
  // 10/26: 생각이 출력 한도를 다 써 05 JSON 이 잘렸다(생각 41.6k / 56k) — 한 번은 생각을 줄여(effort low) 다시 쓴다
  if (r.stopReason === 'max_tokens' && step.effort && step.effort !== 'low' && !step._retried) { trial.steps[step.id].retriedLowEffort = true; trial.steps[step.id].truncated = false; return llm(root, trial, { ...step, effort: 'low', _retried: true }, { system, user, cacheSystem }); }
  if (!String(r.text || '').trim()) fail(502, 'empty_output', `본문이 비었습니다(끝난 이유 ${r.stopReason}, 출력 ${r.usage?.output_tokens} 토큰). 생각에 출력 한도를 다 썼을 수 있습니다.`);
  return r.text;
}

/** 10/26: 09 시각 검수가 05~08 을 안에서 다시 돌릴 때 쓴다 — 단계 기록(끝난 시각·결과)도 갱신 */
export async function runStepInline(root, trial, stepId) {
  const step = stepOf(stepId, trial); if (!step) fail(400, 'unknown_step', stepId);
  trial.steps[stepId] = { ...(trial.steps[stepId] || {}), status: 'running', startedAt: new Date().toISOString(), progressChars: 0, costUsd: 0, by: 's09' };
  const result = await runStepBody(root, trial, step);
  Object.assign(trial.steps[stepId], { status: 'done', finishedAt: new Date().toISOString(), result, error: null });
  return result;
}
async function runStepBody(root, trial, step) {
  const docs = await docsSoFar(root, trial);
  if (step.director && trial.spaceKind !== 'indoor') { const { runDirector } = await import('./storyDirector.mjs'); return runDirector({ root, trial, step, docs, readJsonOut, writeOut, extractJson, llm, fail, trialDirOf: trialDir }); } // 10/27: 05b 장면 연출 — 야외(나주) 시험
  if (trial.spaceKind === 'indoor' && step.indoor) return indoorKit({ readJsonOut, writeOut, extractJson, llm, fail, clip, trialDirOf: trialDir })(root, trial, step, docs);
  // 05 퍼즐 초안에도 각색 조건을 붙인다(인물 없음·실내만 같은 조건이 호스트 종류를 바꾼다)
  const llmAdapt = (r0, t, st, opts) => llm(r0, t, st, st.id === 's05' && adaptText(t) ? { ...opts, user: `${opts.user}\n\n${adaptText(t)}` } : opts);
  if (trial.pipeline === 2 && step.v2) return v2Kit({ readJsonOut, writeOut, extractJson, llm: llmAdapt, spaceItem, spaceText, fail, clip })(root, trial, step, docs);
  const need = (...nos) => { for (const n of nos) if (!docs[n]?.json) fail(409, 'previous_step_missing', `앞 단계 ${n} 결과(JSON)가 없습니다.`); };
  if (['s01', 's02', 's03', 's04'].includes(step.id)) {
    const kit = await storyKit(root);
    const system = kit.systemPrompt();
    const ctx = { system, tale: trial.source.text };
    if (step.id === 's01') ctx.hash = sha(trial.source.text);
    if (step.id === 's02') { need('01'); Object.assign(ctx, { d01: docIn(docs['01']), hash: sha(docs['01'].md) }); }
    if (step.id === 's03') { need('01', '02'); Object.assign(ctx, { d01: docIn(docs['01']), d02: docIn(docs['02']), hash: sha(docs['01'].md + docs['02'].md) }); }
    if (step.id === 's04') { need('01', '02', '03'); Object.assign(ctx, { d01: docIn(docs['01']), d02: docIn(docs['02']), d03: docIn(docs['03']), hash: sha(docs['01'].md + docs['02'].md + docs['03'].md) }); }
    let user = kit.userPrompt(step.no, ctx);
    // 앙암바위 원문(제목 + 4문단) 전제 문구를 다른 원문에서는 일반화(10/21)
    if (step.id === 's01' && (trial.adaptation || trial.spaceKind === 'indoor')) user = user.replace('그 아래 제목 한 줄과 본문 4문단이 원문이다.', '그 아래 제목 한 줄과 본문이 원문이다.');
    if (step.id !== 's01' && adaptText(trial)) user = `${user}\n\n${adaptText(trial)}`;
    // 10/26 미르: 원문 「한방에서 안 재우고」(같은 방에서)를 방 이름 「한방」으로 옮겨 플레이어가 뜻을 몰랐다 → 방언·옛말은 풀어 쓴다
    if (step.id === 's01') user = `${user}\n\n[방언·옛말] 사실(F)·해석 유보(U) 문장은 표준어로 풀어 쓴다. 원문의 방언·옛말·구어는 뜻을 풀고 원문 표현은 괄호에 남긴다(예: 「신랑은 신부와 같은 방(원문 「한방」)이 아니라 사랑방에서 재워졌다」). 방 이름·물건 이름처럼 보이는 말이 실제로는 방언 표현일 수 있으니 확인하고, 뜻이 확실하지 않으면 사실로 확정하지 말고 해석 유보(U)에 넣는다.`;
    // 10/26 미르(세 번째 지적): 01 이 풀어 쓴 「한방」을 02~04 가 다시 「신부와 한방이 아닌」으로 써서 화면에 남았다 — 01 의 (원문 「…」) 낱말을 뒤 문서에서 못 쓰게
    if (step.id !== 's01') { const toks = dialectTokens(docs['01']?.json); if (toks.length) user = `${user}\n\n[방언·옛말 — 쓰지 말 것] 01 이 원문 표현으로만 남긴 말: ${toks.map(t => `「${t}」`).join(' · ')}. 이 문서에서는 이 말을 쓰지 않고 01 이 풀어 쓴 뜻으로 쓴다(예: 「한방」 → 「신부와 같은 방」). 플레이어가 처음 보는 사람이라고 생각하고 쓴다.`; }
    if (step.id === 's04') user = scene04Only(user);
    const text = await llm(root, trial, step, { system, user, cacheSystem: true });
    await writeOut(root, trial, `raw-${step.id}.txt`, text);
    let json; let md;
    if (step.id === 's04') { json = extractJson(text); md = json.__error ? '' : renderSceneTable(json); }
    else { const parts = kit.splitResponse(text); md = parts.md; try { json = JSON.parse(parts.rawJson); } catch (error) { json = { __error: error.message }; } }
    if (json.__error) fail(422, 'json_invalid', `JSON 을 읽지 못했습니다: ${json.__error}. 원답은 raw-${step.id}.txt 에 있습니다.`);
    await writeOut(root, trial, `AI-${step.no}.json`, JSON.stringify(json, null, 2));
    await writeOut(root, trial, `AI-${step.no}.md`, `> ${HEADER}\n\n${md}`);
    return { chars: md.length, counts: step.id === 's04' ? { scenes: (json.scenes || []).length, assetReqs: (json.scenes || []).reduce((a, s) => a + (s.asset_reqs || []).length, 0) } : null };
  }
  if (step.id === 's05') {
    need('04');
    const space = await spaceItem(root);
    if (!space) fail(409, 'space_missing', '공용 라이브러리에 나주 공간 항목이 없습니다.');
    const scenes = docs['04'].json.scenes || [];
    const reqs = scenes.flatMap(s => (s.asset_reqs || []).map(r => ({ ...r, scene_id: s.scene_id })));
    if (!reqs.length) fail(409, 'no_reqs', '04 에 에셋 요구(asset_reqs)가 없습니다.');
    const { out: cands } = await candidatesFor(root, reqs);
    const user = [
      spaceText(space), '',
      ...scenes.map(s => [
        `## ${s.scene_id} · ${s.title || ''} — ${s.purpose || ''}`,
        ...(s.asset_reqs || []).map(r => [
          `### ${r.req_id} (${r.category}${r.dressing_only ? ', 장식 전용' : ''}) — ${r.role_hint || ''}`,
          `태그 ${(r.tags_any || []).join('/')} · 장소 ${(r.setting || []).join('/')} · 시대 ${r.era || ''} · 조작 ${(r.affordances_required || []).join('/') || '-'} · 이유: ${r.lore_reason || ''}`,
          '후보(id | 이름 | 분류 | 시대 | 장소 | 설명 | 설화 단서 | 맥락 필요 | 금지 | 크기 | 비고):',
          ...(cands[r.req_id] || []).map(c => `- ${candidateLine(c)}`),
          (cands[r.req_id] || []).length ? '' : '- (검색된 후보 없음)',
        ].join('\n')),
      ].join('\n\n')),
    ].join('\n');
    await writeOut(root, trial, 'candidates.json', JSON.stringify(Object.fromEntries(Object.entries(cands).map(([k, v]) => [k, v.map(c => ({ id: c.id, nameKo: c.nameKo, categoryKo: c.categoryKo, era: c.era || null, thumbnail: c.thumbnail || null, url: c.url, needsReplacement: Boolean(c.needsReplacement) }))])), null, 2));
    const text = await llm(root, trial, step, { system: SELECT_SYSTEM, user });
    await writeOut(root, trial, 'raw-s05.txt', text);
    const json = extractJson(text);
    if (json.__error) fail(422, 'json_invalid', `JSON 을 읽지 못했습니다: ${json.__error}`);
    const byReq = new Map(reqs.map(r => [r.req_id, r]));
    const selections = (json.selections || []).filter(s => byReq.has(s.req_id)).map(s => {
      const list = cands[s.req_id] || [];
      const picked = list.find(c => c.id === s.pick) || null;
      return {
        req_id: s.req_id, scene_id: byReq.get(s.req_id).scene_id, req: { category: byReq.get(s.req_id).category, role_hint: byReq.get(s.req_id).role_hint, lore_reason: byReq.get(s.req_id).lore_reason, dressing_only: Boolean(byReq.get(s.req_id).dressing_only) },
        pick: picked ? picked.id : null, pickName: picked?.nameKo || null, thumbnail: picked?.thumbnail || null, url: picked?.url || null, needsReplacement: Boolean(picked?.needsReplacement), boundsM: picked?.boundsM || null,
        count: Math.min(8, Math.max(1, Math.round(Number(s.count) || 1))), reason: clip(s.reason, 300),
        alternatives: (s.alternatives || []).filter(id => list.some(c => c.id === id)).slice(0, 2).map(id => ({ id, nameKo: list.find(c => c.id === id).nameKo })),
        missing: picked ? null : (s.missing ? { name_ko: clip(s.missing.name_ko, 80), description_ko: clip(s.missing.description_ko, 300), why: clip(s.missing.why, 300) } : { name_ko: byReq.get(s.req_id).role_hint, description_ko: '', why: '후보 중 고르지 않음' }),
        invalidPick: s.pick && !picked ? s.pick : null,
      };
    });
    for (const r of reqs) if (!selections.some(s => s.req_id === r.req_id)) selections.push({ req_id: r.req_id, scene_id: r.scene_id, req: { category: r.category, role_hint: r.role_hint, lore_reason: r.lore_reason, dressing_only: Boolean(r.dressing_only) }, pick: null, count: 1, reason: '', alternatives: [], missing: { name_ko: r.role_hint, description_ko: '', why: '에이전트가 답하지 않은 요구' } });
    await writeOut(root, trial, 'selection.json', JSON.stringify({ spaceId: space.id, selections }, null, 2));
    return { picked: selections.filter(s => s.pick).length, missing: selections.filter(s => !s.pick).length };
  }
  if (step.id === 's06') {
    need('04');
    const selection = await readJsonOut(root, trial, 'selection.json');
    if (!selection) fail(409, 'previous_step_missing', '05 에셋 선정 결과가 없습니다.');
    const picks = selection.selections.filter(s => s.pick);
    // 「라이브러리에 없음」에서 사람이 대체 후보를 고른 것도 배치에 넣는다
    for (const s of selection.selections) {
      const d = trial.missingDecisions?.[s.req_id];
      if (!s.pick && d?.decision === 'substitute' && d.assetId) picks.push({ ...s, pick: d.assetId, pickName: d.assetName || d.assetId, reason: '사람이 대체 후보로 지정' });
    }
    if (!picks.length) fail(409, 'no_picks', '배치할 선정 결과가 없습니다.');
    // 실제 키(realSize) — 크기 미상이면 GLB 원래 단위(stone21 은 30)가 그대로 쓰여 거대 바위가 됐다(10/19 1차)
    const { placementAsset } = await import('./manifestPlace.mjs');
    const { realHeight } = await import('./realSize.mjs');
    for (const p of picks) {
      try {
        const asset = await placementAsset(root, { url: p.url || `/_sf_local/${String(p.pick).replace(/^[a-z]+:/, '')}`, source: String(p.pick).startsWith('khs:') ? 'khs' : 'public' }, { requireNames: false });
        p.real = await realHeight(root, { file: asset.file, naturalHeightM: asset.naturalHeightM, boundsM: p.boundsM });
      } catch { p.real = null; }
    }
    const space = await spaceItem(root);
    const scenes = docs['04'].json.scenes || [];
    const user = [
      spaceText(space), '',
      'Scene:', ...scenes.map(s => `- ${s.scene_id} · ${s.title || ''}: ${s.purpose || ''} | 공간 요구: ${(s.space_reqs || []).map(r => r.must_read_as).join(' / ')} | 분위기: ${s.mood?.base || ''}`), '',
      '놓을 에셋(선정 결과):',
      ...picks.map(p => `- ${p.req_id} (${p.scene_id}, ${p.req.category}${p.req.dressing_only ? ', 장식' : ''}) → ${p.pick} 「${p.pickName}」 × ${p.count} · 실제 키 ${p.real ? `${p.real.heightM} m(${p.real.source}, 허용 ${p.real.range[0]}~${p.real.range[1]} m)` : '미상'}${p.boundsM ? ` · 크기 ${p.boundsM.map(v => Number(v).toFixed(1)).join('×')} m` : ''} · 역할: ${p.req.role_hint || ''}`),
    ].join('\n');
    const text = await llm(root, trial, step, { system: LAYOUT_SYSTEM, user });
    await writeOut(root, trial, 'raw-s06.txt', text);
    const json = extractJson(text);
    if (json.__error) fail(422, 'json_invalid', `JSON 을 읽지 못했습니다: ${json.__error}`);
    const checked = validateLayout(space, json, picks);
    await writeOut(root, trial, 'layout.json', JSON.stringify({ sceneZones: json.scene_zones || [], ...checked }, null, 2));
    return { accepted: checked.accepted.length, rejected: checked.rejected.length, warnings: checked.warnings.length };
  }
  fail(400, 'unknown_step', step.id);
}

export async function estimateStep(root, id, stepId) {
  const trial = await readTrial(root, id);
  const step = stepOf(stepId, trial) || fail(400, 'unknown_step', stepId);
  if (step.codeOnly) return { model: 'code', inputTokensApprox: 0, maxTokens: 0, worstUsd: 0, typicalUsd: 0, spentUsd: trial.spentUsd, budgetUsd: trial.budgetUsd };
  const { MODELS } = await import('../llm/claude.mjs');
  const model = MODELS[step.tier];
  // 입력은 단계마다 다르다 — 대략치(원문·앞 문서 글자 수 ÷ 1.6 + 공통 틀). 실제 값은 실행 직전 count_tokens 로 다시 잰다.
  const docs = await docsSoFar(root, trial);
  const chars = trial.source.text.length + Object.values(docs).reduce((a, d) => a + (d.md?.length || 0) + JSON.stringify(d.json || {}).length, 0);
  const frame = ['s01', 's02', 's03', 's04'].includes(stepId) ? 53000 : trial.pipeline === 2 ? 14000 : 6000;
  const inTok = Math.round((frame + (stepId === 's01' ? trial.source.text.length : chars)) / 1.6);
  return { model, inputTokensApprox: inTok, maxTokens: step.maxTokens, worstUsd: +costOf(model, { input_tokens: inTok, output_tokens: step.maxTokens }).toFixed(3), typicalUsd: +costOf(model, { input_tokens: inTok, output_tokens: Math.round(step.maxTokens * 0.4) }).toFixed(3), spentUsd: trial.spentUsd, budgetUsd: trial.budgetUsd };
}

/** 장면 연출(05b) 뒤 단계는 이야기 컷 사람 검수가 끝나야 — 서버의 run-fresh 도 띄우기 전에 부른다 */
export async function cineGate(root, trialOrId, stepId) {
  const trial = typeof trialOrId === 'string' ? await readTrial(root, trialOrId) : trialOrId;
  const list = stepsFor(trial); const di = list.findIndex(s => s.director), si = list.findIndex(s => s.id === stepId);
  if (di >= 0 && si > di) { const n = await cinePending(root, trial.id); if (n > 0) fail(409, 'cine_review_pending', `이야기 컷 사람 검수가 끝나지 않았습니다(검수 전 ${n}컷). 좌측 「이야기 컷 검수」에서 그림을 보고 승인·반려한 뒤 진행하세요.`); }
}

/** 이야기 컷 중 사람이 아직 승인·반려하지 않은 컷 수(cinematics.json 이 없으면 0) */
export async function cinePending(root, id) {
  let doc; try { doc = JSON.parse(await fs.readFile(path.join(trialDir(root, id), 'cinematics.json'), 'utf8')); } catch { return 0; }
  const P = [...(doc.cinematics || []).flatMap(c => c.panels || []), ...(doc.recall || []).flatMap(r => r.panels || [])];
  return P.filter(q => !['approved', 'rejected'].includes(q.review?.status)).length;
}

/** 단계 실행 — 바로 돌려주고 뒤에서 돈다. 화면은 GET 으로 상태를 읽는다 */
export async function startStep(root, id, stepId, { onDone } = {}) {
  const trial = await readTrial(root, id);
  const step = stepOf(stepId, trial) || fail(400, 'unknown_step', stepId);
  if (running.has(id)) fail(409, 'step_running', `이미 ${running.get(id)} 단계가 돌고 있습니다.`);
  // 10/28 미르: 「사람이 눈으로 확인하고 승인해야 넘어가도록」 — 장면 연출(05b) 뒤 단계는 이야기 컷 사람 검수가 끝나야(검수 전 0컷) 돈다
  await cineGate(root, trial, stepId);
  const provider = trial.llmSteps?.[stepId] || trial.llm || 'claude';
  if (step.codeOnly) { /* 코드만 — 모델 확인 없음 */ }
  else if (provider === 'local') {
    const { localStatus } = await import('../llm/local.mjs');
    const st = await localStatus();
    if (!st.ok) fail(503, 'local_llm_down', `로컬 LLM — ${st.error}`);
  } else {
    const { readApiKey } = await import('../llm/claude.mjs');
    if (!readApiKey()) fail(422, 'api_key_missing', '저장소 뿌리 .env.local 에 ANTHROPIC_API_KEY 가 없습니다.');
  }
  running.set(id, stepId);
  trial.steps[stepId] = { status: 'running', startedAt: new Date().toISOString(), progressChars: 0, costUsd: 0 };
  await saveTrial(root, trial);
  const ticker = setInterval(() => { saveTrial(root, trial).catch(() => {}); }, 3000);
  (async () => {
    try {
      const result = await runStepBody(root, trial, step);
      Object.assign(trial.steps[stepId], { status: 'done', finishedAt: new Date().toISOString(), result, error: null });
      if (onDone) await onDone(trial, stepId).catch(error => { trial.steps[stepId].postError = String(error.message || error).slice(0, 500); });
    } catch (error) {
      Object.assign(trial.steps[stepId], { status: 'failed', finishedAt: new Date().toISOString(), error: String(error.message || error).slice(0, 800), code: error.code || null });
    } finally {
      clearInterval(ticker);
      running.delete(id);
      await saveTrial(root, trial).catch(() => {});
    }
  })();
  return summary(trial);
}

/** 코드만 다시 앉히기(비용 0) — 계획·선정·자리 힌트는 그대로, 배치 코드(scatter.mjs)만 다시 */
export async function relayoutTrial(root, id) {
  const trial = await readTrial(root, id);
  if (running.has(id)) fail(409, 'step_running', `이미 ${running.get(id)} 단계가 돌고 있습니다.`);
  if (trial.spaceKind === 'indoor') { const docs0 = await docsSoFar(root, trial); const r = await indoorKit({ readJsonOut, writeOut, extractJson, llm, fail, clip, trialDirOf: trialDir })(root, trial, { id: 'relayout' }, docs0); await saveTrial(root, trial); return r; }
  if (trial.pipeline !== 2) fail(409, 'not_v2', '공정 2판 시험만 됩니다.');
  const docs = await docsSoFar(root, trial);
  const result = await v2Kit({ readJsonOut, writeOut, extractJson, llm, spaceItem, spaceText, fail, clip })(root, trial, { id: 'relayout', v2: true }, docs);
  await saveTrial(root, trial);
  return result;
}

export async function trialDetail(root, id) {
  const trial = await readTrial(root, id);
  const files = {};
  for (const no of ['01', '02', '03', '04']) files[`AI-${no}.md`] = await readOut(root, trial, `AI-${no}.md`);
  const selection = await readJsonOut(root, trial, 'selection.json').catch(() => null);
  const layout = await readJsonOut(root, trial, 'layout.json').catch(() => null);
  const s04 = await readJsonOut(root, trial, 'AI-04.json').catch(() => null);
  const candidates = await readJsonOut(root, trial, 'candidates.json').catch(() => null);
  const v2 = trial.pipeline === 2 ? { puzzle: await readJsonOut(root, trial, 'puzzle.json').catch(() => null), spacePlan: await readJsonOut(root, trial, 'spaceplan.json').catch(() => null), selection2: await readJsonOut(root, trial, 'selection2.json').catch(() => null), layout2: await readJsonOut(root, trial, 'layout2.json').catch(() => null) } : {};
  const indoor = trial.spaceKind === 'indoor' ? { plan: await readJsonOut(root, trial, 'indoor_plan.json').catch(() => null), selection: await readJsonOut(root, trial, 'indoor_selection.json').catch(() => null), build: await readJsonOut(root, trial, 'indoor_build.json').catch(() => null), buildRaw: await readJsonOut(root, trial, 'indoor_build_raw.json').catch(() => null), buildAgent: await readJsonOut(root, trial, 'indoor_build_agent.json').catch(() => null), puzzleReview: await readJsonOut(root, trial, 'puzzle_review.json').catch(() => null), puzzleCriteria: PUZZLE_CRITERIA, compare: await indoorCompare(root, trial, { readJsonOut, trialDirOf: trialDir }).catch(e => ({ error: e.message })) } : null;
  // 사람 완성본(10/22) — 같은 원문의 다른 시험 중 humanFinal 표시가 있는 것. 에이전트 단독 결과와 나란히 비교하는 기준
  if (indoor && !trial.humanFinal) {
    try {
      for (const name of await fs.readdir(path.join(root, TRIAL_ROOT))) {
        if (name === trial.id) continue;
        const t = JSON.parse(await fs.readFile(path.join(root, TRIAL_ROOT, name, 'trial.json'), 'utf8'));
        if (!t.humanFinal || t.source?.sha !== trial.source?.sha) continue;
        const b = await readJsonOut(root, t, 'indoor_build.json').catch(() => null);
        if (b) { indoor.humanRef = { id: t.id, title: t.title, viewer: b.viewer, at: b.at, rooms: b.rooms, hosts: b.hosts }; break; }
      }
    } catch { /* 없음 */ }
  }
  return { ...trial, ...v2, indoor, candidates, running: running.get(id) || null, steps: Object.fromEntries(stepsFor(trial).map(s => [s.id, trial.steps[s.id] || { status: 'idle' }])), stepTable: stepsFor(trial), files, selection, layout, scenes: (s04?.scenes || []).map(s => ({ scene_id: s.scene_id, title: s.title })) };
}

export async function decideMissing(root, id, input) {
  const trial = await readTrial(root, id);
  const reqId = clip(input?.reqId, 40);
  if (!['substitute', 'queue', 'drop', null].includes(input?.decision ?? null)) fail(400, 'invalid_decision', '대체 · 생성 대기 · 제외 중 하나로 고르세요.');
  trial.missingDecisions ||= {};
  if (!input.decision) delete trial.missingDecisions[reqId];
  else trial.missingDecisions[reqId] = { decision: input.decision, assetId: input.decision === 'substitute' ? clip(input.assetId, 200) : null, assetName: clip(input.assetName, 120) || null, note: clip(input.note, 500), reviewer: clip(input.reviewer, 100), at: new Date().toISOString() };
  await saveTrial(root, trial);
  return trial.missingDecisions;
}

/** 배치 화면 보기 설정 — 끈 에셋(asset_id 목록). 게임이 /places 를 읽을 때 뺀다 */
export async function setView(root, id, input) {
  const trial = await readTrial(root, id);
  const off = Array.isArray(input?.off) ? [...new Set(input.off.filter(v => typeof v === 'string').map(v => clip(v, 200)))].slice(0, 300) : [];
  trial.view = { off, at: new Date().toISOString() };
  await saveTrial(root, trial);
  return trial.view;
}

/** 시험의 LLM 공급자 바꾸기 — { llm: 'claude'|'local', steps?: { s05:'local', ... } } */
export async function setLlm(root, id, input) {
  const trial = await readTrial(root, id);
  if (input?.llm) trial.llm = input.llm === 'local' ? 'local' : 'claude';
  if (input?.steps && typeof input.steps === 'object') {
    trial.llmSteps = {};
    for (const [k, v] of Object.entries(input.steps)) if (/^s(0[1-9]|10)$/.test(k) && ['claude', 'local'].includes(v)) trial.llmSteps[k] = v;
  }
  await saveTrial(root, trial);
  return { llm: trial.llm, llmSteps: trial.llmSteps || {} };
}

/**
 * 항목 판정(10/19) — 사람 검수 의견. verdict: approve·swap·adjust·replan·remove·regenerate (null = 지우기)
 * 승인은 「고정」(locked), 나머지는 「열림」(open) — 10 단계가 열린 의견만 원인 단계로 돌려 다시 만든다.
 * 모든 판정은 feedbackHistory 에 남긴다(승인·반려 짝 = 이후 학습 자료).
 */
// 퍼즐 검수(10/22 미르: 퍼즐은 사람이 눈으로 — 이야기 개연성 · 에셋 연결 · 상호작용 · 잠금 · 넘어가는 연출 · 재미 · 난이도)
export const PUZZLE_CRITERIA = Object.freeze({ story: '이야기와 개연성', assets: '연결된 에셋이 자연스러움', interact: '상호작용 방식이 납득됨', count: '상호작용 수·동선이 적당함', gate: '풀기 전엔 다음 공간으로 못 감', transit: '넘어가는 연출(자물쇠·문)이 자연스러움', fun: '재미있고 납득됨' });
export async function setPuzzleReview(root, id, input) {
  const trial = await readTrial(root, id);
  const pid = clip(input?.puzzle_id, 40);
  if (!/^[A-Za-z][\w-]{0,30}$/.test(pid)) fail(400, 'invalid_puzzle', '퍼즐 ID 형식이 아닙니다.');
  const reviewer = clip(input?.reviewer, 100);
  if (!reviewer.trim()) fail(400, 'reviewer_required', '검수자 이름을 적어 주세요.');
  const criteria = {};
  for (const [k, v] of Object.entries(input?.criteria || {})) if (PUZZLE_CRITERIA[k] && ['ok', 'issue', null].includes(v)) criteria[k] = v;
  const difficulty = ['easy', 'fit', 'hard', null].includes(input?.difficulty ?? null) ? (input?.difficulty ?? null) : null;
  const verdict = ['approve', 'revise', null].includes(input?.verdict ?? null) ? (input?.verdict ?? null) : null;
  const note = clip(input?.note, 2000);
  if (verdict === 'revise' && !note.trim()) fail(400, 'note_required', '무엇을 고칠지 메모를 적어 주세요.');
  const cur = (await readJsonOut(root, trial, 'puzzle_review.json').catch(() => null)) || { reviews: {}, history: [] };
  const entry = { criteria, difficulty, verdict, note, reviewer, at: new Date().toISOString() };
  cur.reviews[pid] = entry; cur.history.push({ puzzle_id: pid, ...entry });
  await writeOut(root, trial, 'puzzle_review.json', JSON.stringify(cur, null, 2));
  return cur;
}

export async function setFeedback(root, id, input) {
  const { VERDICTS } = await import('./agentTrialV2.mjs');
  const trial = await readTrial(root, id);
  const itemId = clip(input?.itemId, 60);
  if (!/^[A-Za-z][\w-]{0,40}$/.test(itemId)) fail(400, 'invalid_item', '항목 ID 형식이 아닙니다.');
  const verdict = input?.verdict ?? null;
  if (verdict !== null && !VERDICTS[verdict]) fail(400, 'invalid_verdict', `판정은 ${Object.values(VERDICTS).join(' · ')} 중 하나입니다.`);
  const reviewer = clip(input?.reviewer, 100);
  if (verdict && !reviewer.trim()) fail(400, 'reviewer_required', '검수자 이름을 적어 주세요.');
  const note = clip(input?.note, 1000);
  if (verdict && ['adjust', 'replan'].includes(verdict) && !note.trim()) fail(400, 'note_required', '어떻게 고칠지 메모를 적어 주세요(에이전트가 그대로 따른다).');
  trial.feedback ||= {}; trial.feedbackHistory ||= [];
  const entry = verdict ? { verdict, note, reviewer, name: clip(input?.name, 120) || null, assetId: verdict === 'swap' ? clip(input?.assetId, 200) || null : null, assetName: clip(input?.assetName, 120) || null, source: input?.source === 'object-issue' ? 'object-issue' : 'page', status: verdict === 'approve' ? 'locked' : 'open', at: new Date().toISOString() } : null;
  if (entry) trial.feedback[itemId] = entry; else delete trial.feedback[itemId];
  trial.feedbackHistory.push({ itemId, ...(entry || { verdict: null, reviewer, at: new Date().toISOString() }), round: trial.feedbackRound || 0 });
  if (trial.feedbackHistory.length > 2000) trial.feedbackHistory = trial.feedbackHistory.slice(-2000);
  await saveTrial(root, trial);
  return { feedback: trial.feedback, generationQueue: trial.generationQueue || [] };
}

/**
 * 사람이 배치 화면에서 자리 하나를 직접 고침(10/20) — 옮기기·돌리기·크기 또는 빼기.
 * input: { itemId, assetId, from:{x,z}, to:{x,z,rotationY,heightM}|null, reviewer }
 * 고친 자리는 manual 표시 + 그 항목은 「승인(고정)」으로 — 다시 깔기(코드만·10)도 그 자리를 그대로 둔다. 기록은 feedbackHistory
 */
export async function editSpot(root, id, input) {
  const trial = await readTrial(root, id);
  const reviewer = clip(input?.reviewer, 100);
  if (!reviewer.trim()) fail(400, 'reviewer_required', '검수자 이름을 적어 주세요.');
  const itemId = clip(input?.itemId, 60), assetId = clip(input?.assetId, 200);
  const layout = await readJsonOut(root, trial, 'layout2.json');
  if (!layout?.spots) fail(409, 'no_layout', '배치가 없습니다.');
  const fx = Number(input?.from?.x), fz = Number(input?.from?.z);
  const cands = layout.spots.map((s, i) => ({ s, i })).filter(({ s }) => s.itemId === itemId && s.assetId === assetId);
  if (!cands.length) fail(404, 'spot_missing', '그 항목·에셋의 자리를 찾지 못했습니다.');
  const { i } = cands.sort((a, b) => Math.hypot(a.s.x - fx, a.s.z - fz) - Math.hypot(b.s.x - fx, b.s.z - fz))[0];
  const before = { ...layout.spots[i] };
  if (input?.to == null) layout.spots.splice(i, 1);
  else {
    const t = input.to;
    for (const k of ['x', 'z', 'rotationY', 'heightM']) if (!Number.isFinite(Number(t[k]))) fail(400, 'invalid_to', `${k} 값이 숫자가 아닙니다.`);
    const h = Number(t.heightM);
    // 높이는 앉힘 규칙으로 다시(배는 수면에 띄우고, 바위는 낮은 쪽까지) — 손잡이 초안은 땅(강바닥)에 붙여 세우기 때문
    const { loadMask, seatSpot } = await import('./scatter.mjs');
    const mask = loadMask(root);
    const x = +Number(t.x).toFixed(2), z = +Number(t.z).toFixed(2);
    const seat = seatSpot(mask, x, z, { rule: before.rule || 'flat', foot: 0.3, h, steep: before.steep });
    layout.spots[i] = { ...before, x, z, rotationY: Math.round(((Number(t.rotationY) % 360) + 360) % 360), heightM: +h.toFixed(3), ...(before.hf ? { hf: +(before.hf * h / (before.heightM || h)).toFixed(3) } : {}), dy: seat.ok ? seat.dy : 0, manual: true };
  }
  layout.manualEdits = [...(layout.manualEdits || []), { itemId, assetId, from: { x: before.x, z: before.z }, to: input?.to == null ? null : { x: layout.spots[i].x, z: layout.spots[i].z, rotationY: layout.spots[i].rotationY, heightM: layout.spots[i].heightM }, reviewer, at: new Date().toISOString() }];
  await writeOut(root, trial, 'layout2.json', JSON.stringify(layout, null, 2));
  trial.feedback ||= {}; trial.feedbackHistory ||= [];
  const left = layout.spots.some(s => s.itemId === itemId);
  const entry = left
    ? { verdict: 'approve', note: '사람이 배치 화면에서 자리를 고침', reviewer, name: before.name || null, assetId: null, assetName: null, source: 'spot-edit', status: 'locked', at: new Date().toISOString() }
    : { verdict: 'remove', note: '사람이 배치 화면에서 뺌', reviewer, name: before.name || null, assetId: null, assetName: null, source: 'spot-edit', status: 'resolved', at: new Date().toISOString() };
  trial.feedback[itemId] = entry;
  trial.feedbackHistory.push({ itemId, ...entry, before, after: input?.to == null ? null : layout.spots[i], round: trial.feedbackRound || 0 });
  await saveTrial(root, trial);
  return { ok: true, spots: layout.spots.length, edited: input?.to == null ? 'removed' : 'moved' };
}

export async function setReviewProject(root, id, projectId) {
  const trial = await readTrial(root, id);
  trial.reviewProjectId = projectId;
  await saveTrial(root, trial);
}

/** 사람본과 견줄 숫자 — 사람 문서·manifest 는 읽기만 */
export async function compareWithHuman(root, id) {
  const trial = await readTrial(root, id);
  const human = {};
  for (const [no, name] of [['01', '01 설화 사실 계약서.md'], ['02', '02 지역 테마 시놉시스.md'], ['03', '03 게임 시나리오 기획서.md'], ['04', '04 Scene 구성표.md']]) {
    const file = path.join(root, FRAME_DIR, name);
    human[no] = existsSync(file) ? readFileSync(file, 'utf8') : '';
  }
  const docs = await docsSoFar(root, trial);
  const count = (text, re) => new Set((text || '').match(re) || []).size;
  const rows = [
    ['01 사실(F) 수', count(human['01'], /\bF-\d{2}\b/g), docs['01']?.json?.facts?.length ?? null],
    ['01 해석 유보(U) 수', count(human['01'], /\bU-\d{2}\b/g), docs['01']?.json?.open?.length ?? null],
    ['01 금지 왜곡(NG) 수', count(human['01'], /\bNG-\d{2}\b/g), docs['01']?.json?.ng?.length ?? null],
    ['02 핵심 질문(Q) 수', count(human['02'], /\bQ-?\d{1,2}\b/g), docs['02']?.json?.questions?.length ?? null],
    ['03·04 Scene 수', count(human['04'], /Scene\s?0?\d/g), docs['04']?.json?.scenes?.length ?? null],
    ['04 에셋 요구 수', '사람본은 자연어(구조화 이전)', (docs['04']?.json?.scenes || []).reduce((a, s) => a + (s.asset_reqs || []).length, 0) || null],
    ['문서 길이(글자) 01/02/03/04', ['01', '02', '03', '04'].map(n => human[n].length).join(' / '), ['01', '02', '03', '04'].map(n => docs[n]?.md?.length ?? '—').join(' / ')],
  ];
  // 공간: 사람 배치 = 게임 무리 대조표 + manifest 놓기 / 에이전트 배치 = layout.json
  const layout = await readJsonOut(root, trial, 'layout.json').catch(() => null);
  const selection = await readJsonOut(root, trial, 'selection.json').catch(() => null);
  let inventory = null;
  try { inventory = await fs.readFile(path.join(root, 'docs/에셋라이브러리/나주_게임물체_라이브러리_대조표_1019.md'), 'utf8'); } catch { /* 없음 */ }
  const humanObjects = inventory ? [...inventory.matchAll(/^\| ([^|]+) \| (🟢|🟡)[^|]*\|/gmu)].map(m => m[1].trim()) : [];
  return {
    docs: rows,
    space: {
      human: { objectGroups: humanObjects, note: '사람이 만든 나주 공간의 게임 무리(원경 제외)' },
      agent: { picks: (selection?.selections || []).filter(s => s.pick).map(s => ({ req: s.req_id, name: s.pickName, count: s.count })), placed: layout?.accepted?.length ?? 0, rejected: layout?.rejected?.length ?? 0, sceneZones: layout?.sceneZones || [] },
    },
  };
}
