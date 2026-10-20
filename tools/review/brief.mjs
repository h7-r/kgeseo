// 설화·기획 「핵심 검수 카드」(10/15 미르: 「문서가 너무 많아 사람이 다 못 본다 — LLM 이 핵심만 추려 사람이 검수」)
//
// 흐름(에이전트 구조 §8 「API 는 제작할 때만」을 지킨다)
//   ① 제작: 터미널에서 `npm run story:brief -- <검수 id>` → Claude(판단 급)가 세 문서(설화 원천·시놉시스·씬 계획)를 읽고
//      문서마다 요약 몇 줄 + 「사람이 꼭 볼 줄」 카드(원문 그대로 인용)를 낸다 → 코드가 인용이 원문에 정말 있는지 확인 →
//      .local/review/briefs/<검수 id>.json 에 저장. 원본 문서·projects.json 은 읽기만 한다.
//   ② 검수: 작업대 설화와 기획 화면이 카드를 읽어 보여 주고, 사람이 카드마다 「확인」·「문제」를 누른다(API 호출 없음).
//      세 문서 글자가 바뀌면(내용 해시) 카드는 「옛 내용」이 되어 승인 근거로 쓰지 않는다.
//   ③ 설화 관문 승인: 지금 내용의 카드가 있으면 전부 판정돼야 하고, 「문제」가 하나라도 있으면 승인할 수 없다.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const BRIEF_DOCS = Object.freeze([
  { key: 'A', field: 'sourceText', label: '설화 원천(사실 계약서)' },
  { key: 'B', field: 'synopsis', label: '시놉시스' },
  { key: 'C', field: 'sceneNotes', label: '씬별 계획' },
]);
export const BRIEF_KINDS = Object.freeze({
  invented: '원천에 없는 내용',
  conflict: '서로 어긋남',
  uncertain: '미확인을 확정함',
  sensitive: '민감·금지 왜곡 의심',
  gap: '핵심 사실 빠짐',
});
export const BRIEF_SEVERITY = Object.freeze({ high: '높음', mid: '보통', low: '낮음' });
const DECISIONS = ['ok', 'issue'];

/** 세 문서 내용 해시 — 글자가 하나라도 바뀌면 카드가 옛 내용이 된다 */
export function briefContentHash(project) {
  const h = createHash('sha256');
  for (const doc of BRIEF_DOCS) h.update(`\u0000${doc.key}\u0000${project[doc.field] || ''}`);
  return h.digest('hex');
}

const squash = (value) => String(value).replace(/\s+/gu, ' ').trim();
/** 공백을 무시하고 인용이 문서에 있는지 — 있으면 원문 기준 시작 위치(UI 강조용), 없으면 -1 */
export function locateQuote(text, quote) {
  const q = squash(quote);
  if (!q) return -1;
  const exact = text.indexOf(quote);
  if (exact >= 0) return exact;
  // 공백 차이만 허용 — 원문을 한 칸 공백으로 접으면서 위치 표를 같이 만든다
  let folded = '';
  const map = [];
  let lastSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/u.test(ch)) {
      if (!lastSpace && folded) {
        folded += ' ';
        map.push(i);
      }
      lastSpace = true;
    } else {
      folded += ch;
      map.push(i);
      lastSpace = false;
    }
  }
  const at = folded.indexOf(q);
  return at >= 0 ? map[at] : -1;
}

/** LLM 출력(JSON) → 검사한 카드 묶음. 인용이 원문에 없으면 그 카드는 「인용 불일치」로 뺀다 */
export function validateBrief(project, raw) {
  const texts = Object.fromEntries(BRIEF_DOCS.map((doc) => [doc.key, project[doc.field] || '']));
  const docs = BRIEF_DOCS.map((doc) => {
    const found = (raw.docs || []).find((d) => d.doc === doc.key) || {};
    const summary = (Array.isArray(found.summary) ? found.summary : []).map(String).map(squash).filter(Boolean).slice(0, 6);
    return { doc: doc.key, label: doc.label, chars: texts[doc.key].length, summary };
  });
  const items = [];
  const rejected = [];
  for (const [index, item] of (Array.isArray(raw.items) ? raw.items : []).slice(0, 40).entries()) {
    const doc = BRIEF_DOCS.some((d) => d.key === item?.doc) ? item.doc : null;
    const kind = Object.hasOwn(BRIEF_KINDS, item?.kind) ? item.kind : null;
    const severity = Object.hasOwn(BRIEF_SEVERITY, item?.severity) ? item.severity : 'mid';
    const quote = typeof item?.quote === 'string' ? item.quote.trim() : '';
    const why = squash(item?.why || '');
    const base = { id: `c${String(index + 1).padStart(2, '0')}`, doc, kind, severity, quote, why };
    if (!doc || !kind || !quote || !why) {
      rejected.push({ ...base, reason: '형식 불완전(문서·종류·인용·이유 중 빠짐)' });
      continue;
    }
    const at = locateQuote(texts[doc], quote);
    if (at < 0) {
      rejected.push({ ...base, reason: `인용이 ${doc} 문서에 없음 — 모델이 바꿔 쓴 문장일 수 있어 카드에서 뺐습니다` });
      continue;
    }
    let against = null;
    if (item.against && BRIEF_DOCS.some((d) => d.key === item.against.doc) && typeof item.against.quote === 'string') {
      const otherAt = locateQuote(texts[item.against.doc], item.against.quote.trim());
      against = { doc: item.against.doc, quote: item.against.quote.trim(), at: otherAt, verified: otherAt >= 0 };
    }
    items.push({ ...base, at, against });
  }
  const order = { high: 0, mid: 1, low: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity] || a.doc.localeCompare(b.doc) || a.at - b.at);
  return { docs, items, rejected };
}

// ── 저장 ── .local/review/briefs/<검수 id>.json = { schemaVersion, projectId, briefs:[…] } (내용 해시마다 하나, 최근 5개)
const briefFile = (dataDir, projectId) => join(dataDir, 'briefs', `${projectId}.json`);
export async function readBriefs(dataDir, projectId) {
  try {
    return JSON.parse(await readFile(briefFile(dataDir, projectId), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, projectId, briefs: [] };
    throw error;
  }
}
async function writeBriefs(dataDir, projectId, value) {
  await mkdir(join(dataDir, 'briefs'), { recursive: true, mode: 0o700 });
  const file = briefFile(dataDir, projectId);
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, file);
}

/** 제작 단계(CLI)가 새 카드 묶음을 넣는다 — 같은 내용 해시가 있으면 갈아 끼우되 사람 판정은 같은 인용 카드에 이어 붙인다 */
export async function storeBrief(dataDir, project, brief) {
  const store = await readBriefs(dataDir, project.id);
  const contentHash = briefContentHash(project);
  const previous = store.briefs.find((b) => b.contentHash === contentHash);
  if (previous) {
    for (const item of brief.items) {
      const same = previous.items.find((old) => old.doc === item.doc && old.quote === item.quote && old.decision);
      if (same) Object.assign(item, { decision: same.decision, note: same.note, reviewer: same.reviewer, decidedAt: same.decidedAt });
    }
  }
  const record = { id: randomUUID(), contentHash, projectRevision: project.revision, ...brief };
  store.briefs = [record, ...store.briefs.filter((b) => b.contentHash !== contentHash)].slice(0, 5);
  await writeBriefs(dataDir, project.id, store);
  return record;
}

/** 화면용 — 지금 내용의 카드 묶음(없으면 null) + 옛 내용 묶음 수 */
export async function currentBrief(dataDir, project) {
  const store = await readBriefs(dataDir, project.id);
  const contentHash = briefContentHash(project);
  const brief = store.briefs.find((b) => b.contentHash === contentHash) || null;
  return { brief, stale: store.briefs.filter((b) => b.contentHash !== contentHash).length, contentHash };
}

/** 사람 판정 한 장 */
export async function decideBriefItem(dataDir, project, { contentHash, itemId, decision, note = '', reviewer }) {
  if (!DECISIONS.includes(decision) && decision !== null) throw Object.assign(new Error('판정은 ok · issue 중 하나입니다.'), { status: 400 });
  if (decision === 'issue' && !String(note).trim()) throw Object.assign(new Error('「문제」는 무엇이 문제인지 한 줄 적어 주세요.'), { status: 400 });
  if (decision && !String(reviewer || '').trim()) throw Object.assign(new Error('검수자 이름을 먼저 적어 주세요.'), { status: 400 });
  const store = await readBriefs(dataDir, project.id);
  if (contentHash !== briefContentHash(project)) throw Object.assign(new Error('문서 내용이 바뀌어 이 카드는 옛 내용입니다. 카드를 다시 만들어 주세요.'), { status: 409 });
  const brief = store.briefs.find((b) => b.contentHash === contentHash);
  const item = brief?.items.find((i) => i.id === itemId);
  if (!item) throw Object.assign(new Error('카드를 찾을 수 없습니다.'), { status: 404 });
  if (decision === null) {
    delete item.decision; delete item.note; delete item.reviewer; delete item.decidedAt;
  } else {
    Object.assign(item, { decision, note: String(note).slice(0, 2000), reviewer: String(reviewer).slice(0, 200), decidedAt: new Date().toISOString() });
  }
  await writeBriefs(dataDir, project.id, store);
  return brief;
}

/** 설화 관문 승인 막는 사유 — 지금 내용의 카드가 있을 때만 */
export function briefBlockers(brief) {
  if (!brief) return [];
  const pending = brief.items.filter((i) => !i.decision).length;
  const issues = brief.items.filter((i) => i.decision === 'issue').length;
  const out = [];
  if (pending) out.push({ code: 'brief_pending', message: `핵심 검수 카드 ${pending}장이 아직 판정 전입니다.` });
  if (issues) out.push({ code: 'brief_issue', message: `핵심 검수 카드 ${issues}장에 「문제」가 있습니다 — 문서를 고치거나 반려하세요.` });
  return out;
}
