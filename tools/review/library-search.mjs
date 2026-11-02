// 라이브러리 한글 검색 — 정확·부분 일치 + 자모 n-gram 유사도 + 동의어 + (있으면) 로컬 임베딩 의미 유사도.
// 외부 유료 API 없음. 임베딩은 선택 의존성 @huggingface/transformers(Xenova/multilingual-e5-small)를 쓰며,
// 불러오기·모델 내려받기가 실패하면 semantic:false 로 글자 기반 검색만 한다.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const MODEL_ID = 'Xenova/multilingual-e5-small';
/** 점수 결합 가중치 — 문서화된 값(검수_배치편집_프로토콜 §4 「정확·부분 > 자모 > 임베딩」 순). */
export const WEIGHTS = Object.freeze({ lexical: 1.0, synonym: 0.9, jamo: 0.8, semantic: 0.7, agreementBonus: 0.08 });
export const THRESHOLD = 0.35;
export const LIMIT = 60;
/** e5 코사인은 0.7~0.95 에 몰린다 → 이 구간을 0~1 로 편다. */
export const SEMANTIC_RANGE = Object.freeze({ floor: 0.8, ceil: 0.92 });
const JAMO_MIN = 0.5; // 자모 유사도가 이보다 낮으면 신호로 치지 않는다

// ── 동의어(민속 물건) — 부스트 층. 같은 줄의 말은 서로를 찾아 준다. ──
export const SYNONYMS = [
  ['항아리', '독', '옹기', '장독', '단지', '동이', '물항아리'],
  ['가마솥', '솥', '무쇠솥'],
  ['지게', '바지게', '등짐', '지게작대기'],
  ['멍석', '돗자리', '자리', '거적', '깔개'],
  ['바구니', '광주리', '소쿠리', '채반', '대바구니', '고리'],
  ['등잔', '호롱', '호롱불', '등불', '등잔불', '등잔대'],
  ['절구', '절굿공이', '절구통', '방아', '돌확'],
  ['키', '키질', '곡식 키'],
  ['맷돌', '돌매', '풀매'],
  ['평상', '들마루', '마루', '툇마루'],
  ['장승', '벅수', '법수', '장생'],
  ['돌담', '담장', '담', '토담', '울타리'],
  ['초가', '초가집', '집', '가옥', '민가'],
  ['나룻배', '배', '거룻배', '쪽배'],
  ['갈대', '억새', '물억새'],
  ['소반', '밥상', '상', '호족반', '개다리소반'],
  ['뒤주', '쌀독', '쌀뒤주', '곡물 궤'],
  ['삽', '가래', '부삽'],
  ['빗자루', '싸리비', '비질'],
  ['바위', '돌', '큰돌', '암석', '돌무더기'],
  ['자갈', '조약돌', '돌멩이'],
  ['소나무', '솔', '솔나무'],
  ['횃불', '관솔불', '화톳불'],
  ['비석', '석비', '돌비'],
  ['물동이', '동이', '물항아리'],
  ['벼루', '연적', '문방'],
  ['촛대', '초', '등불'],
  ['장작', '땔감', '나뭇짐'],
  ['짚', '짚단', '볏짚', '짚더미'],
];

// ── 자모 분해 ──
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
// 흔한 철자 혼동(ㅐ/ㅔ, ㅒ/ㅖ, ㅙ/ㅞ/ㅚ)은 같은 글자로 본다 — '지개' → '지게'
const LOOSE = { 'ㅐ': 'ㅔ', 'ㅒ': 'ㅖ', 'ㅙ': 'ㅞ', 'ㅚ': 'ㅞ' };

export const normalize = value => String(value ?? '').normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
export const compact = value => normalize(value).replace(/[\s·.,()\-_/]+/gu, '');

export function jamo(value) {
  let out = '';
  for (const char of compact(value)) {
    const code = char.codePointAt(0) - 0xac00;
    if (code >= 0 && code < 11172) {
      const jung = JUNG[Math.floor(code / 28) % 21];
      // 받침은 첫소리와 다른 글자(U+11A8~ 종성 자모)로 적는다 — '가마솟' 이 '가마 소성' 에 끼어 맞지 않게
      const jong = code % 28;
      out += CHO[Math.floor(code / 588)] + (LOOSE[jung] || jung) + (jong ? String.fromCharCode(0x11a7 + jong) : '');
    } else out += LOOSE[char] || char;
  }
  return out;
}
function grams(value) {
  const set = new Set();
  if (value.length < 2) { if (value) set.add(value); return set; }
  for (let n = 2; n <= 3; n++) for (let i = 0; i + n <= value.length; i++) set.add(value.slice(i, i + n));
  return set;
}
/** 질의 자모 n-gram 이 필드에 얼마나 들어 있는가(0~1). 0.7·포함률 + 0.3·Dice. */
export function jamoSimilarity(query, field) {
  const q = jamo(query), f = jamo(field);
  if (!q || !f) return 0;
  if (q.length >= 3 && f.includes(q)) return 1;
  const Q = grams(q), F = grams(f);
  let inter = 0; for (const g of Q) if (F.has(g)) inter++;
  if (!inter) return 0;
  return 0.7 * (inter / Q.size) + 0.3 * (2 * inter / (Q.size + F.size));
}

// ── 글자 일치 ──
function lexical(query, item) {
  const q = compact(query);
  if (!q) return { score: 0, reason: null };
  const name = compact(item.nameKo);
  if (name === q) return { score: 1, reason: '이름 일치' };
  if (name.startsWith(q)) return { score: 0.92, reason: '이름 앞부분 일치' };
  if (name.includes(q)) return { score: 0.85, reason: '이름에 포함' };
  const tags = (item.tags || []).map(compact);
  if (tags.includes(q)) return { score: 0.8, reason: `태그 「${query}」` };
  if (name.length >= 2 && q.includes(name)) return { score: 0.75, reason: '질의에 이름 포함' };
  if (q.length >= 2 && tags.some(tag => tag.includes(q))) return { score: 0.65, reason: '태그에 포함' };
  if (/[a-z]{3,}/u.test(q) && compact(`${item.nameEn} ${item.subjectEn || ''}`).includes(q)) return { score: 0.6, reason: '영문명 일치' };
  if (q.length >= 2 && compact(item.categoryKo).includes(q)) return { score: 0.5, reason: `분류 ${item.categoryKo}` };
  if (q.length >= 2 && (item.spaces || []).some(space => compact(space).includes(q))) return { score: 0.45, reason: '쓰이는 공간 일치' };
  return { score: 0, reason: null };
}
function synonymTerms(term) {
  const q = compact(term);
  const out = new Set();
  for (const group of SYNONYMS) if (group.some(word => compact(word) === q)) for (const word of group) if (compact(word) !== q) out.add(word);
  return [...out];
}

// ── 의미(임베딩) ──
const engines = new Map(); // root -> engine
const hashText = text => createHash('sha256').update(`${MODEL_ID}\n${text}`).digest('hex').slice(0, 32);
export const passageText = item => ['passage:', item.nameKo, item.nameEn, item.categoryKo, ...(item.tags || []), item.subjectEn || ''].filter(Boolean).join(' ').slice(0, 600);
const toB64 = vector => Buffer.from(new Float32Array(vector).buffer).toString('base64');
const fromB64 = text => { const b = Buffer.from(text, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** 기본 임베더: @huggingface/transformers 를 늦게 불러온다. 없거나 모델을 못 받으면 null. */
async function defaultEmbedder(root) {
  const mod = await import('@huggingface/transformers');
  mod.env.cacheDir = path.join(root, '.local/review/hf-cache'); // node_modules 밖, 서버가 내주지 않는 곳
  mod.env.allowLocalModels = false;
  const extractor = await mod.pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
  return async texts => {
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    const [n, dim] = output.dims;
    return Array.from({ length: n }, (_, i) => Float32Array.from(output.data.subarray(i * dim, (i + 1) * dim)));
  };
}

function engineFor(root, embedderFactory) {
  const key = `${root}::${embedderFactory ? 'custom' : 'default'}`;
  let engine = engines.get(key);
  if (!engine) {
    engine = { status: 'idle', error: null, embed: null, vectors: new Map(), queryCache: new Map(), indexing: null, failedAt: 0, loading: null,
      cacheFile: path.join(root, '.local/review/library-embeddings.json'), factory: embedderFactory || (() => defaultEmbedder(root)) };
    engines.set(key, engine);
  }
  return engine;
}
async function loadCache(engine) {
  try {
    const data = JSON.parse(await fs.readFile(engine.cacheFile, 'utf8'));
    if (data?.model === MODEL_ID && data.vectors && typeof data.vectors === 'object') for (const [k, v] of Object.entries(data.vectors)) if (typeof v === 'string') engine.vectors.set(k, fromB64(v));
  } catch { /* 없거나 깨졌으면 새로 만든다 */ }
}
async function saveCache(engine, keep) {
  const vectors = {};
  for (const k of keep) if (engine.vectors.has(k)) vectors[k] = toB64(engine.vectors.get(k));
  await fs.mkdir(path.dirname(engine.cacheFile), { recursive: true, mode: 0o700 });
  const temp = `${engine.cacheFile}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ model: MODEL_ID, prefix: 'passage: ', createdAt: new Date().toISOString(), vectors }), { mode: 0o600 });
  await fs.rename(temp, engine.cacheFile);
}
/** 모델 준비 + 항목 색인을 뒤에서 진행. 끝나면 status 'ready'. */
function startSemantic(engine, items) {
  if (engine.status === 'failed' && Date.now() - engine.failedAt < 10 * 60_000) return;
  if (engine.loading) return;
  engine.loading = (async () => {
    try {
      engine.status = 'loading';
      if (!engine.embed) { await loadCache(engine); engine.embed = await engine.factory(); }
      engine.status = 'indexing';
      const wanted = items.map(item => [item, passageText(item)]).map(([item, text]) => ({ item, text, key: hashText(text) }));
      const missing = wanted.filter(entry => !engine.vectors.has(entry.key));
      for (let i = 0; i < missing.length; i += 32) {
        const batch = missing.slice(i, i + 32);
        const vectors = await engine.embed(batch.map(entry => entry.text));
        batch.forEach((entry, j) => engine.vectors.set(entry.key, vectors[j]));
      }
      engine.itemKeys = new Map(wanted.map(entry => [entry.item.id, entry.key]));
      if (missing.length) await saveCache(engine, wanted.map(entry => entry.key)).catch(() => {});
      engine.status = 'ready'; engine.indexedFor = items;
    } catch (error) {
      engine.status = 'failed'; engine.failedAt = Date.now(); engine.embed = null;
      engine.error = String(error?.message || error).slice(0, 300);
    } finally { engine.loading = null; }
  })();
}
export function semanticState(root, embedderFactory) {
  const engine = engines.get(`${root}::${embedderFactory ? 'custom' : 'default'}`);
  return { model: MODEL_ID, status: engine?.status || 'idle', error: engine?.error || null };
}
async function queryVector(engine, query) {
  const text = `query: ${query}`;
  if (engine.queryCache.has(text)) return engine.queryCache.get(text);
  const [vector] = await engine.embed([text]);
  engine.queryCache.set(text, vector);
  if (engine.queryCache.size > 200) engine.queryCache.delete(engine.queryCache.keys().next().value);
  return vector;
}

const SOURCE_ORDER = { public: 0, khs: 1, palette: 2, catalog: 3 };
/**
 * @param {object[]} items buildLibrary().items
 * @param {string} query
 * @param {{category?:string, placeableOnly?:boolean, source?:string, limit?:number, threshold?:number,
 *          semantic?:boolean, root?:string, embedder?:() => Promise<(texts:string[]) => Promise<Float32Array[]>>, waitSemanticMs?:number}} opts
 */
export async function searchLibrary(items, query, opts = {}) {
  const { category = '', placeableOnly = false, source = '', limit = LIMIT, threshold = THRESHOLD, semantic = true, root = process.cwd(), embedder = null, waitSemanticMs = 0 } = opts;
  const pool = items.filter(item => (!category || item.category === category) && (!placeableOnly || item.placeable) && (!source || item.source === source));
  const q = normalize(query).slice(0, 100);
  let semanticOn = false, semanticStatus = 'off', semanticError = null, qv = null, engine = null;
  if (q && semantic) {
    engine = engineFor(path.resolve(root), embedder);
    if (engine.status !== 'ready' || engine.indexedFor !== items) { if (engine.status === 'ready') engine.status = 'indexing'; startSemantic(engine, items); }
    if (engine.loading && waitSemanticMs > 0) await Promise.race([engine.loading, new Promise(resolve => setTimeout(resolve, waitSemanticMs))]);
    semanticStatus = engine.status === 'failed' ? 'unavailable' : engine.status; semanticError = engine.error;
    if (engine.status === 'ready') {
      try { qv = await queryVector(engine, q); semanticOn = true; }
      catch (error) { semanticStatus = 'unavailable'; semanticError = String(error?.message || error).slice(0, 300); }
    }
  }
  if (!q) return { results: pool.map(item => ({ item, score: 0, reasons: [] })), semantic: false, semanticStatus, total: pool.length };
  const tokens = q.split(' ').filter(Boolean);
  const terms = tokens.length > 1 ? [q, ...tokens] : [q];
  const synonyms = [...new Set(terms.flatMap(synonymTerms))];
  const scored = [];
  for (const item of pool) {
    const reasons = [];
    // (a) 글자 일치: 전체 질의, 여러 낱말이면 낱말 평균과 비교
    let L = lexical(q, item);
    if (tokens.length > 1) {
      const parts = tokens.map(token => lexical(token, item));
      const mean = parts.reduce((s, p) => s + p.score, 0) / parts.length;
      if (mean > L.score) L = { score: mean, reason: parts.find(p => p.reason)?.reason || null };
    }
    if (L.reason) reasons.push(L.reason);
    // 동의어
    let S = 0, synWord = null;
    for (const word of synonyms) {
      const hit = lexical(word, item);
      // 한 글자 동의어(배·독·솥·상…)는 이름·태그가 정확히 같을 때만 — '배' 가 '배수로' 를 끌어오지 않게
      const ok = compact(word).length < 2 ? hit.score === 1 || hit.score === 0.8 : hit.score >= 0.65;
      if (ok && hit.score > S) { S = hit.score; synWord = word; }
    }
    if (synWord) reasons.push(`동의어 「${synWord}」`);
    // (b) 자모 n-gram
    let F = 0;
    for (const term of tokens.length > 1 ? tokens : [q]) {
      let best = 0;
      for (const field of [item.nameKo, ...(item.tags || [])]) best = Math.max(best, jamoSimilarity(term, field));
      F += best;
    }
    F /= tokens.length > 1 ? tokens.length : 1;
    if (F < JAMO_MIN) F = 0; else if (!L.score) reasons.push(`글자 유사 ${Math.round(F * 100)}%`);
    // (c) 의미
    let E = 0;
    if (semanticOn) {
      const key = engine.itemKeys?.get(item.id); const vector = key && engine.vectors.get(key);
      if (vector) {
        const cos = dot(qv, vector);
        E = Math.min(1, Math.max(0, (cos - SEMANTIC_RANGE.floor) / (SEMANTIC_RANGE.ceil - SEMANTIC_RANGE.floor)));
        if (E >= 0.3) reasons.push(`의미 유사 ${cos.toFixed(2)}`);
      }
    }
    const signals = [WEIGHTS.lexical * L.score, WEIGHTS.synonym * S, WEIGHTS.jamo * F, WEIGHTS.semantic * E];
    const best = Math.max(...signals);
    // 글자 일치와 자모 유사도는 같은 종류의 증거라 하나로 센다 → 서로 다른 증거(글자·동의어·의미)가 겹칠 때만 덧점
    const agree = [Math.max(signals[0], signals[2]), signals[1], signals[3]].filter(value => value >= 0.3).length - 1;
    const score = Math.min(1, best + WEIGHTS.agreementBonus * Math.max(0, agree));
    if (score >= threshold) scored.push({ item, score: Math.round(score * 1000) / 1000, reasons });
  }
  scored.sort((a, b) => b.score - a.score || Number(b.item.placeable) - Number(a.item.placeable) || SOURCE_ORDER[a.item.source] - SOURCE_ORDER[b.item.source] || a.item.nameKo.localeCompare(b.item.nameKo, 'ko'));
  return { results: scored.slice(0, limit), semantic: semanticOn, semanticStatus, ...(semanticError ? { semanticError } : {}), total: scored.length };
}
