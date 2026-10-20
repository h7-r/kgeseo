// 검수 작업대 에셋 라이브러리 색인 (검수_배치편집_프로토콜_1015 §4).
//   public  = public/_sf_local/manifest.json 이 참조하는 GLB(경량본, khs/ 와 반려·_far 원경본 제외) → 배치 가능
//   khs     = public/_sf_local/khs/*.glb (국가유산청 CC BY 4.0) — 한글명은 tools/review/library-khs-ko.json → 배치 가능
//   lib     = public/_sf_local/lib/*.glb + _index.json (공용 라이브러리 public3d/library 의 복사본 — 입고_게임연결.py) → 배치 가능
//             출처 값은 'public' 으로 두고(배치·검증 경로 그대로) origin:'lib' 로 구분한다.
//   palette = naju01/src/placement/assetCatalog.ts 코드 모형 → 배치 불가(참고)
//   catalog = docs/에셋라이브러리/생성준비_v1/catalog.json 720건(3D 미생성) → 배치 불가, 「생성 요청」만
//   space   = docs/에셋라이브러리/공간/*.space.json — 게임 공간(지형·강·절벽·원경 묶음) 자체. 배치 대상이 아니라 「바탕으로 고르는」 항목(10/19)
// 읽기 전용. 심볼릭 링크·AI허브 경로는 data.mjs 와 같은 규칙으로 뺀다.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parsePalette } from './data.mjs';
import { searchLibrary, semanticState, MODEL_ID, WEIGHTS, THRESHOLD } from './library-search.mjs';

export { searchLibrary, semanticState, MODEL_ID, WEIGHTS, THRESHOLD };

const nfc = value => String(value).normalize('NFC');
const SHARED_PUBLIC_LOADER = 'naju01/src/loaders/publicAssets.tsx';
// data.mjs forbidden() 과 같은 규칙(그 파일은 다른 작업자가 고치므로 복제). AI허브 자료는 목록에 넣지 않는다.
export const forbidden = value => nfc(value) !== SHARED_PUBLIC_LOADER && /aihub|AI허브|원본보관|\/원본(?:\/|$)/iu.test(nfc(value));
const forbiddenText = value => /aihub|AI허브/iu.test(nfc(value || ''));

const PUBLIC_ROOT = 'public/_sf_local';
const MANIFEST = `${PUBLIC_ROOT}/manifest.json`;
const KHS_DIR = `${PUBLIC_ROOT}/khs`;
const KHS_NAMES = 'tools/review/library-khs-ko.json';
const LIB_DIR = `${PUBLIC_ROOT}/lib`;
const LIB_INDEX = `${LIB_DIR}/_index.json`;
// 코드로 그린 게임 소품을 GLB 로 내보낸 임시본(10/19) — naju01/vite/codePropExportPlugin.ts 가 쓴다. 실제 에셋이 생기면 교체
const CODE_DIR = `${PUBLIC_ROOT}/codeprops`;
const CODE_INDEX = `${CODE_DIR}/_index.json`;
const PALETTE = 'naju01/src/placement/assetCatalog.ts';
const CATALOG = 'docs/에셋라이브러리/생성준비_v1/catalog.json';
const SPACE_DIR = 'docs/에셋라이브러리/공간';

/** 공용 분류(화면 칩). 모든 출처의 분류를 이 11개로 모은다. */
export const CATEGORIES = Object.freeze([
  { id: 'building', ko: '건축·주거' }, { id: 'household', ko: '생활도구' }, { id: 'farming', ko: '농기구·작업' },
  { id: 'kitchen', ko: '음식·그릇' }, { id: 'clothing', ko: '의복·장신' }, { id: 'ritual', ko: '제례·신앙' },
  { id: 'study', ko: '문방·악기' }, { id: 'nature', ko: '자연물(바위·나무·풀)' }, { id: 'transport', ko: '탈것·운반' },
  { id: 'military', ko: '무기·의장' }, { id: 'other', ko: '기타' }, { id: 'space', ko: '게임 공간' },
]);
const CATEGORY_KO = Object.fromEntries(CATEGORIES.map(c => [c.id, c.ko]));
/** catalog.json category → 공용 분류 */
export const CATALOG_CATEGORY = Object.freeze({
  architecture: 'building', garden: 'nature', furniture: 'household', storage: 'household', lighting: 'household', trade: 'household',
  craft: 'farming', farming: 'farming', kitchen: 'kitchen', clothing: 'clothing', ritual: 'ritual', study: 'study', music: 'study',
  transport: 'transport', military: 'military',
});
/** 게임 팔레트: 열쇠별 → 없으면 갈래별 */
export const PALETTE_CATEGORY = Object.freeze({
  '소품.횃불': 'household', '소품.장승': 'ritual', '소품.비석': 'ritual', '소품.무덤': 'ritual', '소품.명패': 'building', '소품.울타리': 'building',
  '소품.나룻배': 'transport', '소품.나루터': 'building', '돌다리.디딤돌': 'building', '소품.인물': 'other',
  '씬1.그물틀': 'farming', '씬1.통발': 'farming', '씬1.천막': 'building', '씬1.돌탑': 'ritual', '씬1.화톳불': 'household', '씬1.구렁이': 'other',
  '씬2.평상': 'household', '씬2.걸상': 'household', '씬2.지게': 'transport', '씬2.물동이': 'kitchen', '씬2.솟대': 'ritual',
  '씬3.짚신': 'clothing', '씬3.댕기': 'clothing', '씬3.흙덩이': 'nature', '씬3.부러진가지': 'nature',
  '씬4.배자국': 'other', '씬4.말뚝': 'transport', '씬4.발자국': 'other', '씬5.금줄': 'ritual', '씬5.소반': 'kitchen',
  '원경.나무': 'nature', '원경.집': 'building', '땅.언덕': 'nature', '땅.길': 'nature',
});
const PALETTE_GROUP = { '돌': 'nature', '풀·나무': 'nature', '사람이 세운 것': 'building' };
/** public 경량본 파일 → 한글명·분류·태그 (이름의 숫자는 파일 번호) */
const PUBLIC_NAMES = [
  [/^rock\/stone(\d+)/u, '바위', 'nature', ['돌', '큰돌', '바위덩어리']],
  [/^rock\/gravel0*(\d+)/u, '자갈', 'nature', ['돌', '자갈밭']],
  [/^tree\/pine_big_(\d+)/u, '큰 소나무', 'nature', ['나무', '소나무', '솔']],
  [/^tree\/pine_medium_(\d+)/u, '소나무', 'nature', ['나무', '솔']],
  [/^tree\/pine_large_(\d+)/u, '가지 넓은 소나무', 'nature', ['나무', '소나무', '솔']],
  [/^tree\/linden_([LR])/u, '피나무', 'nature', ['나무', '활엽수']],
  [/^plant\/bush_stylized/u, '덤불', 'nature', ['수풀', '풀']],
  [/^plant\/flower_lungwort/u, '풀꽃', 'nature', ['꽃', '들꽃']],
  [/^plant\/foliage_(\d+)/u, '잎덤불', 'nature', ['덤불', '풀']],
  [/^plant\/grass_dry/u, '마른 풀', 'nature', ['풀', '건초']],
  [/^plant\/grass_style(\d+)/u, '풀포기', 'nature', ['풀', '잡초']],
  [/^plant\/reed_(\d+|lp)/u, '갈대', 'nature', ['풀', '물가', '억새']],
  [/^plant\/shrub_cliff/u, '절벽 덤불', 'nature', ['덤불', '수풀']],
  [/^plant2\/(?:ug_)?dandelion_?(\d+)/u, '민들레', 'nature', ['꽃', '들꽃', '풀']],
  [/^plant2\/margarita/u, '들국화', 'nature', ['꽃', '마거리트']],
  [/^plant2\/sf_(\d+)/u, '들꽃', 'nature', ['꽃', '풀꽃']],
  [/^plant2\/ug_lactuca(\d+)/u, '왕고들빼기', 'nature', ['잡초', '풀', '나물']],
  [/^plant2\/ug_plantain(\d+)/u, '질경이', 'nature', ['잡초', '풀', '나물']],
  [/^prop\/ditch_straight/u, '돌도랑', 'building', ['도랑', '물길', '배수로']],
  [/^prop\/dolhwak/u, '돌확', 'kitchen', ['확', '돌절구', '절구']],
  [/^prop\/jangseung/u, '장승', 'ritual', ['벅수', '마을 수호']],
  [/^prop\/jar\./u, '항아리', 'kitchen', ['독', '옹기', '장독']],
  [/^prop\/mat\./u, '멍석', 'farming', ['돗자리', '자리', '깔개']],
  [/^prop\/pyeongsang/u, '평상', 'household', ['마루', '들마루']],
  [/^prop\/soban/u, '소반', 'kitchen', ['밥상', '상', '제물']],
  [/^prop\/straw/u, '짚단', 'farming', ['볏짚', '짚', '짚더미']],
  [/^prop\/tablet/u, '비석', 'ritual', ['석비', '돌비']],
  [/^prop\/torch/u, '횃불', 'household', ['불', '관솔불']],
  [/^prop\/vfx_crown/u, '빛무리 효과', 'other', ['효과', '빛']],
  [/^prop\/vfx_drip/u, '물방울 효과', 'other', ['효과', '물']],
  [/^prop\/water_jar/u, '물동이', 'kitchen', ['동이', '물항아리', '항아리']],
  [/^house\/chogajip0*(\d+)/u, '초가집(원경)', 'building', ['초가', '집', '원경']],
];
const ERA = { cm: '시대 공통', tk: '삼국', gr: '고려', js: '조선' };

const urlFor = relative => '/' + relative.replace(/^public\//u, '').split('/').map(encodeURIComponent).join('/');
const category = id => ({ category: id, categoryKo: CATEGORY_KO[id] });
const clip = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';

async function safeFile(root, relative) {
  if (forbidden(relative)) return null;
  const parts = relative.split('/');
  let stat;
  for (let i = 0; i < parts.length; i++) {
    try { stat = await fs.lstat(path.join(root, ...parts.slice(0, i + 1))); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink()) return null;
    if (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) return null;
  }
  return stat;
}
async function readJson(root, relative) {
  if (!await safeFile(root, relative)) return null;
  try { return JSON.parse(await fs.readFile(path.join(root, relative), 'utf8')); } catch { return null; }
}
const hashes = new Map();
async function sha256(root, relative, stat) {
  const key = `${relative}:${stat.size}:${stat.mtimeMs}`;
  if (hashes.has(key)) return hashes.get(key);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(root, relative))) hash.update(chunk);
  const value = hash.digest('hex'); hashes.set(key, value);
  return value;
}

/** manifest 가 참조하는 GLB 상대경로(_sf_local 기준) + 각 파일이 쓰이는 무리(target) 이름 */
function manifestRefs(manifest) {
  const refs = new Map();
  const add = (file, group) => { if (typeof file !== 'string') return; if (!refs.has(file)) refs.set(file, new Set()); if (group) refs.get(file).add(group); };
  for (const section of ['바꿔치기', '덮기', '놓기']) for (const entry of Array.isArray(manifest?.[section]) ? manifest[section] : []) {
    const group = entry?.target || (Array.isArray(entry?.대상) ? entry.대상.join('·') : entry?.차단물 ? `차단물 ${entry.차단물}` : '');
    for (const file of entry?.files ?? (entry?.file ? [entry.file] : [])) add(file, group);
  }
  for (const [group, files] of Object.entries(manifest?.검수 && typeof manifest.검수 === 'object' ? manifest.검수 : {})) for (const file of Array.isArray(files) ? files : []) add(file, null);
  const rejected = new Set(Object.keys(manifest?.반려 || {}));
  for (const file of [...refs.keys()]) {
    const near = file.replace(/_far\.glb$/u, '.glb');
    if (rejected.has(file) || file.startsWith('khs/') || file.startsWith('lib/') || (near !== file && refs.has(near))) refs.delete(file);
  }
  return refs;
}

function numberDuplicates(items) {
  const counts = new Map();
  for (const item of items) counts.set(`${item.source}:${item.nameKo}`, (counts.get(`${item.source}:${item.nameKo}`) || 0) + 1);
  const seen = new Map();
  for (const item of items) {
    const key = `${item.source}:${item.nameKo}`;
    if (counts.get(key) < 2) continue;
    const n = (seen.get(key) || 0) + 1; seen.set(key, n);
    item.nameKo = `${item.nameKo} ${n}`;
  }
}

async function publicItems(root) {
  const manifest = await readJson(root, MANIFEST);
  if (!manifest) return [];
  const items = [];
  for (const [file, groups] of [...manifestRefs(manifest)].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!/^[\w\-./가-힣]+\.glb$/u.test(file) || file.split('/').some(part => part === '..' || part === '.' || !part)) continue;
    const relative = `${PUBLIC_ROOT}/${file}`;
    const stat = await safeFile(root, relative);
    if (!stat) continue;
    const rule = PUBLIC_NAMES.find(([re]) => re.test(file));
    const number = rule && file.match(rule[0])?.[1];
    const groupTags = [...groups].flatMap(group => group.split('.')).filter(Boolean);
    items.push({
      id: `public:${file}`, nameKo: rule ? `${rule[1]}${number ? ` ${number}` : ''}` : path.basename(file, '.glb'), nameEn: path.basename(file, '.glb').replace(/_/gu, ' '),
      ...category(rule?.[2] || 'other'), source: 'public', url: urlFor(relative), placeable: true, sha256: await sha256(root, relative, stat),
      tags: [...new Set([...(rule?.[3] || []), ...groupTags])], spaces: [], material: null, thumbnail: null, path: relative, bytes: stat.size,
      note: groups.size ? `게임 무리: ${[...groups].join(', ')}` : '검수 목록에만 있음(아직 게임 무리에 안 쓰임)',
    });
  }
  numberDuplicates(items);
  return items;
}

async function khsItems(root) {
  const ledger = (await readJson(root, KHS_NAMES))?.files || {};
  let names = [];
  if (await fs.lstat(path.join(root, KHS_DIR)).then(s => s.isDirectory() && !s.isSymbolicLink(), () => false)) names = (await fs.readdir(path.join(root, KHS_DIR))).filter(name => name.endsWith('.glb') && !name.startsWith('.')).sort();
  const items = [];
  for (const name of names) {
    const relative = `${KHS_DIR}/${name}`;
    const stat = await safeFile(root, relative);
    if (!stat) continue;
    const entry = ledger[name] || {};
    const cat = CATEGORY_KO[entry.category] ? entry.category : 'other';
    items.push({
      id: `khs:${name}`, nameKo: clip(entry.nameKo, 120) || name.replace(/_[0-9a-f]{8}\.glb$/u, '').replace(/_/gu, ' '), nameEn: clip(entry.nameEn, 200) || name,
      ...category(cat), source: 'khs', url: urlFor(relative), placeable: true, sha256: await sha256(root, relative, stat),
      tags: [...new Set([...(Array.isArray(entry.tags) ? entry.tags.map(t => clip(t, 60)) : []), '국가유산청'])], spaces: [], material: null, thumbnail: null,
      path: relative, bytes: stat.size, license: clip(entry.license, 40) || null, credit: clip(entry.credit, 300) || null,
      note: entry.basis ? `한글명 근거: ${entry.basis}` : '한글명 대장에 없음(파일명 그대로)',
    });
  }
  numberDuplicates(items);
  return items;
}

/** 공용 라이브러리(lib) — 시대·장소 한글, 태그 → 공용 분류(위에서부터 먼저 맞는 것) */
const LIB_ERA = Object.freeze({ ancient: '고대(삼국·통일신라)', goryeo: '고려', joseon: '조선', premodern_generic: '전근대 공통', timeless: '시대 공통' });
const LIB_SETTING = Object.freeze({ interior: '실내', village: '마을', fortress: '성곽', mountain_temple: '산사', grave: '무덤', coast: '바닷가', river: '강·하천', bureau: '관아', field: '논밭', palace: '궁궐', kitchen: '부엌', shrine: '사당', market: '장터' });
const LIB_TAG_CATEGORY = [
  ['military', ['무기', '전쟁', '화포', '칼', '총통', '화살', '활', '편전', '환도', '군기', '포탄', '군사', '무예', '무구', '군영', '화약', '장수', '무관']],
  ['clothing', ['복식', '의복', '치마', '예복', '관모', '신발', '장신구', '귀걸이', '반지', '허리띠', '저고리', '원삼', '적의', '관복', '한삼', '머리장식', '가발', '혜', '겉옷', '상의', '띠', '웃치마', '소매']],
  ['transport', ['배', '수레', '말', '마구', '화물', '가마']],
  ['study', ['글씨', '책', '두루마리', '그림', '병풍', '책상', '악기', '타악기', '관악기', '현악기', '국악', '궁중음악', '북', '피리', '장구', '바둑', '바둑판', '놀이', '경전', '목판', '도량형', '자', '문방']],
  ['ritual', ['불교', '의례', '제례', '제사', '불상', '향로', '사리장엄', '사리함', '장례', '12지신', '벽사', '제기', '범종', '탑', '능', '고분', '다라니', '사찰', '혼례']],
  ['farming', ['농사', '농기구', '곡식', '짚', '작물', '채소']],
  ['kitchen', ['그릇', '식기', '술잔', '음식', '잔', '접시', '밥상', '소반', '국자', '항아리', '병', '토기', '백자', '도자기', '부엌', '취사', '가마솥', '술병', '국그릇', '잔받침', '합', '옹기']],
  ['household', ['가구', '살림', '조명', '촛대', '등', '탁자', '방석', '생활용품', '자물쇠', '수납함', '바구니', '평상', '상', '함']],
  ['building', ['기와', '수막새', '막새', '전돌', '벽돌', '현판', '정자', '초가', '담장', '문']],
];
function libCategory(entry) {
  if (entry.kit === 'building') return 'building';
  if (entry.kit === 'terrain') return 'nature';
  const tags = new Set(Array.isArray(entry.tags) ? entry.tags : []);
  if (entry.kit === 'character') return [...tags].some(t => /무예|군|의장|취/u.test(t)) || /무예|군|의장|내취/u.test(entry.display_name || '') ? 'military' : 'other';
  for (const [cat, words] of LIB_TAG_CATEGORY) if (words.some(w => tags.has(w))) return cat;
  return 'other';
}
const strings = (value, max, n) => (Array.isArray(value) ? value : []).filter(v => typeof v === 'string').slice(0, n).map(v => clip(v, max));

async function libItems(root, { dir = LIB_DIR, indexFile = LIB_INDEX, origin = 'lib', idPrefix = 'lib' } = {}) {
  const index = await readJson(root, indexFile);
  const items = [];
  for (const entry of Array.isArray(index?.assets) ? index.assets : []) {
    if (!entry || typeof entry.file !== 'string' || !/^[a-z0-9][a-z0-9-]*\.glb$/u.test(entry.file)) continue;
    const relative = `${dir}/${entry.file}`;
    const stat = await safeFile(root, relative);
    if (!stat) continue;
    const era = LIB_ERA[entry.era] || null;
    const spaces = strings(entry.setting, 40, 8).map(s => LIB_SETTING[s] || s);
    const preview = typeof entry.preview === 'string' && /^[a-z0-9][a-z0-9-]*\.jpg$/u.test(entry.preview) && await safeFile(root, `${dir}/${entry.preview}`) ? urlFor(`${dir}/${entry.preview}`) : null;
    const tri = Number.isFinite(entry.tri) ? entry.tri : null;
    items.push({
      id: `public:${idPrefix}/${entry.file}`, nameKo: clip(entry.display_name, 120) || entry.asset_id, nameEn: clip(entry.original_name, 200) || entry.asset_id,
      ...category(CATEGORY_KO[entry.category] ? entry.category : libCategory(entry)), source: 'public', origin, url: urlFor(relative), placeable: true, sha256: await sha256(root, relative, stat),
      tags: [...new Set([...strings(entry.tags, 60, 12), era, ...spaces, clip(entry.provider, 40), origin === 'code' ? '임시 코드 모형' : '공용 라이브러리'].filter(Boolean))], spaces, material: null, thumbnail: preview,
      subjectEn: clip([entry.original_name, entry.description].filter(Boolean).join(' — '), 400), era, assetId: clip(entry.asset_id, 120),
      loreHints: strings(entry.lore_hints, 120, 6), requiresContext: strings(entry.requires_context, 80, 6), notFor: strings(entry.not_for, 80, 6),
      tri, budget: clip(entry.budget, 10) || null, boundsM: Array.isArray(entry.bounds_m) ? entry.bounds_m.slice(0, 3) : null,
      path: relative, bytes: stat.size, license: clip(entry.license, 40) || null, credit: clip(entry.attribution, 300) || null,
      needsReplacement: entry.needs_replacement === true,
      generationQueue: entry.generation_queue === true, // 실제 에셋 생성 대기(코드 임시본으로 메운 자리)
      description: clip(entry.description, 400) || null,
      note: origin === 'code' ? `게임 코드 모형을 GLB 로 뽑은 임시본(${clip(entry.group_id, 40)}) — 실제 에셋으로 교체 필요` : `공용 라이브러리 ${clip(entry.asset_id, 120)} · ${clip(entry.budget, 10) || '-'}${tri ? ` · ${tri}면` : ''}${entry.check ? ` · 확인 필요: ${clip(entry.check, 160)}` : ''}`,
    });
  }
  numberDuplicates(items);
  return items;
}

async function paletteItems(root) {
  if (!await safeFile(root, PALETTE)) return [];
  const text = await fs.readFile(path.join(root, PALETTE), 'utf8');
  return parsePalette(text, PALETTE).map(entry => {
    const cat = PALETTE_CATEGORY[entry.paletteKey] || PALETTE_GROUP[entry.category] || 'other';
    return {
      id: `palette:${entry.paletteKey}`, nameKo: entry.name, nameEn: entry.paletteKey, ...category(cat), source: 'palette', url: null, placeable: false,
      tags: [...new Set([entry.category, ...entry.paletteKey.split('.')])], spaces: [], material: null, thumbnail: null, path: PALETTE,
      note: '게임 편집기 팔레트의 코드 모형 — 게임 편집기에서 놓는다(이 작업대 배치 불가).',
    };
  });
}

async function catalogItems(root) {
  const data = await readJson(root, CATALOG);
  const byName = new Map();
  for (const asset of Array.isArray(data?.assets) ? data.assets : []) {
    if (!asset || asset.excluded || typeof asset.id !== 'string' || typeof asset.name_ko !== 'string') continue;
    const nameKo = clip(asset.name_ko, 120);
    if ([nameKo, asset.subject_en, asset.notes_ko].some(forbiddenText)) continue;
    const spaces = Array.isArray(asset.spaces) ? asset.spaces.map(s => clip(s, 60)).filter(Boolean) : [];
    const groups = Array.isArray(asset.groups) ? asset.groups.map(s => clip(s, 40)).filter(Boolean) : [];
    const era = ERA[asset.era_pack] || null;
    const existing = byName.get(nameKo);
    if (existing) { existing.spaces = [...new Set([...existing.spaces, ...spaces])]; existing.mergedIds.push(asset.id); continue; } // 같은 이름 = 한 항목
    byName.set(nameKo, {
      id: `catalog:${asset.id}`, nameKo, nameEn: asset.id.replace(/^[a-z]{2}_/u, '').replace(/_/gu, ' '), ...category(CATALOG_CATEGORY[asset.category] || 'other'),
      source: 'catalog', url: null, placeable: false, tags: [...new Set([clip(asset.material, 40), ...groups, era].filter(Boolean))], spaces,
      material: clip(asset.material, 40) || null, thumbnail: null, subjectEn: clip(asset.subject_en, 400), era, period: clip(asset.period_hint, 120) || null,
      catalogId: asset.id, mergedIds: [], path: CATALOG, note: '3D 미생성 — 「생성 요청」만 기록할 수 있습니다.',
    });
  }
  return [...byName.values()];
}

/** 게임 공간 — 공간 하나 = 파일 하나. 에이전트에게 줄 물리 정보만 싣는다(사람 기획의 이야기 칸은 humanPlanRef 로 따로) */
async function spaceItems(root) {
  let names = [];
  if (await fs.lstat(path.join(root, SPACE_DIR)).then(s => s.isDirectory() && !s.isSymbolicLink(), () => false)) names = (await fs.readdir(path.join(root, SPACE_DIR))).filter(name => name.endsWith('.space.json')).sort();
  const items = [];
  for (const name of names) {
    const relative = `${SPACE_DIR}/${name}`;
    const data = await readJson(root, relative);
    if (!data || typeof data.id !== 'string' || !data.id.startsWith('space:')) continue;
    const zones = (Array.isArray(data.zones) ? data.zones : []).slice(0, 20).map(z => ({
      code: clip(z.code, 10), physicalName: clip(z.physicalName, 60), x: z.x, z: z.z, elevation: z.elevation, sizeLabel: clip(z.sizeLabel, 40), surface: clip(z.surface, 120),
    }));
    items.push({
      id: clip(data.id, 120), nameKo: clip(data.nameKo, 120), nameEn: clip(data.nameEn, 200), ...category('space'), source: 'space', url: null, placeable: false,
      kind: clip(data.kind, 20), region: clip(data.region, 120), era: clip(data.era, 40) || null, sizeM: Array.isArray(data.sizeM) ? data.sizeM.slice(0, 2) : null,
      tags: [...new Set(['게임 공간', clip(data.kind === 'outdoor' ? '야외' : data.kind === 'indoor' ? '실내' : data.kind, 20), ...(data.features || []).map(f => clip(f.name, 40))].filter(Boolean))],
      spaces: zones.map(z => z.physicalName), material: null, thumbnail: clip(data.thumbnail, 300) || null,
      subjectEn: clip(data.description, 600), description: clip(data.description, 1200),
      features: (Array.isArray(data.features) ? data.features : []).slice(0, 30).map(f => ({ kind: clip(f.kind, 20), name: clip(f.name, 60), detail: clip(f.detail, 160) })),
      zones, runtime: data.runtime && typeof data.runtime === 'object' ? { id: clip(data.runtime.id, 40), url: clip(data.runtime.url, 300), emptyBaseQuery: clip(data.runtime.emptyBaseQuery, 60) } : null,
      license: clip(data.license, 60) || null, path: relative, note: `게임 공간 — 에셋을 놓는 바탕. 구역 ${zones.length}개`,
    });
  }
  return items;
}

/**
 * 메타데이터 보강(10/19) — 나주 교체본(public)·국가유산청 경량본(khs)은 이름·태그뿐이라 에이전트가 시대·장소로 거를 수 없었다.
 * 이름에 든 낱말로 시대를, 분류로 어울리는 장소를 추정해 채운다. 추정값은 metaQuality: 'auto' 로 표시한다(사람 확인 전).
 */
const ERA_RULES = [
  [/금관총|식리총|비단벌레|서수형|금동관|금제|토기|가야|신라|백제|고구려|말다래|재갈|굴레/u, '고대(삼국·통일신라)'],
  [/청자|고려|나전/u, '고려'],
  [/백자|분청|조선|갓|도포|족두리|지게|장승|소반|멍석|짚|물동이|평상|횃불|항아리|옹기|다듬잇돌|화로|부삽|장작|소쿠리|광주리/u, '조선'],
];
const CATEGORY_SPACES = {
  nature: ['강·하천', '마을', '산사'], building: ['마을'], household: ['실내', '마을'], farming: ['마을', '논밭'], kitchen: ['부엌', '마을'],
  clothing: ['실내', '인물 소지품'], ritual: ['사당', '산사', '마을'], study: ['실내', '관아'], transport: ['마을', '강·하천'], military: ['성곽', '관아'], other: [],
};
function enrich(item) {
  if (!['public', 'khs'].includes(item.source) || item.origin) return item;
  const text = `${item.nameKo} ${item.nameEn} ${(item.tags || []).join(' ')}`;
  const era = item.category === 'nature' ? '시대 공통' : (ERA_RULES.find(([re]) => re.test(text))?.[1] || '전근대 공통(추정)');
  const spaces = item.spaces?.length ? item.spaces : CATEGORY_SPACES[item.category] || [];
  const description = `${item.nameKo} — ${item.categoryKo}. ${item.source === 'khs' ? '국가유산청 소장품 3D 경량본' : '나주 맵 공개 3D 교체본'}${item.tags?.length ? ` · ${item.tags.slice(0, 6).join(', ')}` : ''}`;
  return { ...item, era: item.era || era, spaces, description: item.description || description, tags: [...new Set([...(item.tags || []), era])], metaQuality: 'auto' };
}

const caches = new Map(); // root -> { stamp, value }
async function stampFor(root) {
  const parts = [];
  for (const relative of [MANIFEST, KHS_NAMES, PALETTE, CATALOG, SPACE_DIR, KHS_DIR, LIB_DIR, LIB_INDEX, CODE_DIR, CODE_INDEX, `${PUBLIC_ROOT}/rock`, `${PUBLIC_ROOT}/tree`, `${PUBLIC_ROOT}/plant`, `${PUBLIC_ROOT}/plant2`, `${PUBLIC_ROOT}/prop`, `${PUBLIC_ROOT}/house`]) {
    const stat = await fs.lstat(path.join(root, relative)).catch(() => null);
    parts.push(`${relative}:${stat ? `${stat.size}:${stat.mtimeMs}` : '-'}`);
  }
  return parts.join('|');
}

/** 라이브러리 색인. 원본 파일·폴더 mtime 이 같으면 같은 배열을 돌려준다(임베딩 색인도 이 배열 기준). */
export async function buildLibrary(root) {
  root = path.resolve(root);
  const stamp = await stampFor(root);
  const cached = caches.get(root);
  if (cached?.stamp === stamp) return cached.value;
  const all = [...await publicItems(root), ...await libItems(root), ...await libItems(root, { dir: CODE_DIR, indexFile: CODE_INDEX, origin: 'code', idPrefix: 'codeprops' }), ...await khsItems(root), ...await paletteItems(root), ...await catalogItems(root), ...await spaceItems(root)];
  const seen = new Set();
  const items = all.map(enrich).filter(item => {
    if ([item.path, item.url || ''].some(forbidden) || forbiddenText(item.nameKo) || forbiddenText(item.nameEn)) return false;
    const key = `${item.origin || item.source}:${item.nameKo}`; // 같은 출처·같은 이름 중복 제거(GLB 는 위에서 번호를 붙여 살림)
    if (seen.has(key) || seen.has(item.id)) return false;
    seen.add(key); seen.add(item.id);
    return true;
  });
  const categories = CATEGORIES.map(c => ({ ...c, count: items.filter(i => i.category === c.id).length, placeableCount: items.filter(i => i.category === c.id && i.placeable).length }));
  const sources = Object.fromEntries(['public', 'khs', 'palette', 'catalog', 'space'].map(s => [s, items.filter(i => i.source === s).length]));
  const origins = { lib: items.filter(i => i.origin === 'lib').length, code: items.filter(i => i.origin === 'code').length };
  const value = { items, categories, sources, origins, revision: createHash('sha256').update(stamp).digest('hex').slice(0, 16), builtAt: new Date().toISOString() };
  caches.set(root, { stamp, value });
  return value;
}

const routeCache = new Map();
/**
 * server.mjs 의 reviewMiddleware 안에서 한 줄로 붙인다:
 *   if (path.startsWith('/__review/library') && await (await import('./library.mjs')).libraryRoutes(root)(req, res, path, send)) return;
 * 처리한 경로면 true.
 */
export function libraryRoutes(root) {
  root = path.resolve(root);
  if (routeCache.has(root)) return routeCache.get(root);
  const handler = async (req, res, pathname, send) => {
    if (pathname !== '/__review/library' && pathname !== '/__review/library/search') return false;
    if (!['GET', 'HEAD'].includes(req.method)) { send(405, { error: 'method_not_allowed', message: '허용되지 않는 요청입니다.' }); return true; }
    try {
      const library = await buildLibrary(root);
      if (pathname === '/__review/library') {
        send(200, { ...library, semantic: semanticState(root), weights: WEIGHTS, threshold: THRESHOLD });
        return true;
      }
      const params = new URL(req.url || '', 'http://localhost').searchParams;
      const q = params.get('q') || '';
      const cat = params.get('category') || '';
      const source = params.get('source') || '';
      if (q.length > 100) { send(400, { error: 'query_too_long', message: '검색어는 100자 이하로 입력하세요.' }); return true; }
      if (cat && !CATEGORY_KO[cat]) { send(400, { error: 'unknown_category', message: '없는 분류입니다.' }); return true; }
      if (source && !['public', 'khs', 'palette', 'catalog'].includes(source)) { send(400, { error: 'unknown_source', message: '없는 출처입니다.' }); return true; }
      const result = await searchLibrary(library.items, q, { root, category: cat, source, placeableOnly: params.get('placeableOnly') === '1', semantic: params.get('semantic') !== '0' });
      send(200, { query: q, revision: library.revision, ...result });
    } catch (error) {
      send(500, { error: 'library_error', message: '에셋 라이브러리를 읽지 못했습니다.', detail: String(error?.message || error).slice(0, 300) });
    }
    return true;
  };
  routeCache.set(root, handler);
  return handler;
}
