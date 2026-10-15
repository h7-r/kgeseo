import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

// Read-only adapter: metadata extraction must never evaluate the game's modules.
const hashes = new Map();
const nfc = (value) => value.normalize('NFC');
const slash = (value) => value.split(path.sep).join('/');
// TS 이식(2026-10-15): 옛 scenes/AI허브전시.jsx → loaders/publicAssets.tsx. 파일 해시가 실행 프로필(naju-public-sf-v1)에 들어간다.
const SHARED_PUBLIC_LOADER = 'naju01/src/loaders/publicAssets.tsx';
const PUBLIC_ASSET_ROOT = 'public/_sf_local';
const PUBLIC_MANIFEST = `${PUBLIC_ASSET_ROOT}/manifest.json`;
const VISUAL_VIEWS = 'naju01/src/review/reviewViews.json';
// This exact shared source file also loads the allowed src=sf public dataset.
// Its filename is not permission to ingest any AIHub data or other preview code.
const forbidden = (value) => nfc(value) !== SHARED_PUBLIC_LOADER && /aihub|AI허브|원본보관|\/원본(?:\/|$)/iu.test(nfc(value));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const byPath = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

async function walk(root, relative) {
  if (forbidden(relative)) return [];
  let entries;
  try { entries = await fs.readdir(path.join(root, relative), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : 1)) {
    const name = slash(path.join(relative, entry.name));
    if (forbidden(name) || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) files.push(...await walk(root, name));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}

async function existing(root, relative) {
  try {
    const stat = await fs.lstat(path.join(root, relative));
    return stat.isFile() && !stat.isSymbolicLink() && !forbidden(relative);
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function noSymlinkFile(root, relative) {
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    let stat;
    try { stat = await fs.lstat(path.join(root, ...parts.slice(0, index + 1))); }
    catch (error) { if (error.code === 'ENOENT') return { ok: false, reason: '파일 없음' }; throw error; }
    if (stat.isSymbolicLink()) return { ok: false, reason: '심볼릭 링크 금지' };
    if (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) return { ok: false, reason: '파일 경로 형식 불일치' };
  }
  return { ok: true };
}

async function publicRuntimeProfile(root) {
  const base = { profile: 'naju-base-v1', url: '/naju01/?review=1', presentation: '기본 공간 · 기존 에셋 구성', available: true, reviewBlockers: [], publicManifest: null, publicAssetPaths: [] };
  const manifestPresent = await fs.lstat(path.join(root, PUBLIC_MANIFEST)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  if (!manifestPresent || !await existing(root, SHARED_PUBLIC_LOADER)) return base;
  const selected = { ...base, profile: 'naju-public-sf-v1', url: '/naju01/?review=1&aihub=&src=sf&r=15', presentation: '공개 에셋 교체 · 구역별 초점 연출', publicManifest: PUBLIC_MANIFEST, publicAssetPaths: [] };
  const problem = (_code, message) => { selected.available = false; selected.reviewBlockers.push(message); };
  for (const relative of [PUBLIC_MANIFEST, SHARED_PUBLIC_LOADER]) {
    const safe = await noSymlinkFile(root, relative);
    if (!safe.ok) problem('public_asset_path_invalid', `${relative}: ${safe.reason}`);
  }
  if (!selected.available) return selected;
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(root, PUBLIC_MANIFEST), 'utf8')); }
  catch { problem('public_manifest_invalid', '공개 에셋 manifest.json을 읽을 수 없습니다.'); return selected; }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) { problem('public_manifest_invalid', '공개 에셋 manifest.json은 객체여야 합니다.'); return selected; }
  const refs = new Set();
  for (const section of ['바꿔치기', '덮기', '놓기']) {
    if (manifest[section] === undefined) continue;
    if (!Array.isArray(manifest[section])) { problem('public_manifest_invalid', `${section} 목록 형식이 잘못되었습니다.`); continue; }
    for (const entry of manifest[section]) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { problem('public_manifest_invalid', `${section} 항목이 객체가 아닙니다.`); continue; }
      const paths = entry.files ?? (entry.file === undefined ? [] : [entry.file]);
      if (!Array.isArray(paths) || !paths.length || (entry.원경files !== undefined && !Array.isArray(entry.원경files))) { problem('public_manifest_invalid', `${section} 항목의 files/file 또는 원경files를 확인하세요.`); continue; }
      for (const ref of [...paths, ...(entry.원경files || [])]) refs.add(ref);
    }
  }
  if (!refs.size) problem('public_manifest_empty', '공개 에셋 구성에 실제 파일 참조가 없습니다.');
  for (const ref of refs) {
    if (typeof ref !== 'string' || !ref.endsWith('.glb') || /[\\:%?#\u0000]/u.test(ref) || ref.split('/').some(part => !part || part === '.' || part === '..') || forbidden(ref)) {
      problem('public_asset_path_invalid', `공개 에셋 경로는 _sf_local 안의 상대 GLB 경로여야 합니다: ${String(ref).slice(0, 200)}`); continue;
    }
    const relative = `${PUBLIC_ASSET_ROOT}/${ref}`;
    const safe = await noSymlinkFile(root, relative);
    if (!safe.ok) problem('public_asset_missing', `${relative}: ${safe.reason}`);
    else selected.publicAssetPaths.push(relative);
  }
  selected.publicAssetPaths.sort();
  return selected;
}

async function visualReviewViews(root) {
  if (!await existing(root, VISUAL_VIEWS)) return { views: [], warning: null };
  try {
    const views = JSON.parse(await fs.readFile(path.join(root, VISUAL_VIEWS), 'utf8'));
    const point = value => Array.isArray(value) && value.length === 3 && value.every(number => Number.isFinite(number) && Math.abs(number) <= 1_000_000);
    const short = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
    if (!Array.isArray(views) || !views.length || views.length > 32 || views.some(view => !view || !short(view.id) || !short(view.zoneId) || !short(view.zoneName) || !short(view.label) || !point(view.position) || !point(view.target)) || new Set(views.map(view => view.id)).size !== views.length) throw new Error('invalid views');
    return { views: views.map(({ id, zoneId, zoneName, label, position, target }) => ({ id, zoneId, zoneName, label, position, target })), warning: null };
  } catch { return { views: [], warning: '구역 검수 시점 파일 형식이 잘못되어 사진 검수 모드를 사용할 수 없습니다. 개별 검수는 계속할 수 있습니다.' }; }
}

async function manifestEntry(root, relative) {
  const absolute = path.join(root, relative);
  const before = await fs.stat(absolute, { bigint: true });
  const stamp = `${before.dev}:${before.ino}:${before.size}:${before.mtimeNs}:${before.ctimeNs}`;
  const cached = hashes.get(absolute);
  if (cached?.stamp === stamp) return { ...cached.value };
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(absolute)) hash.update(chunk);
  const after = await fs.stat(absolute, { bigint: true });
  if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
    throw new Error(`검수 자료를 읽는 동안 파일이 바뀌었습니다. 다시 불러오세요: ${relative}`);
  }
  const value = { path: relative, bytes: Number(before.size), sha256: hash.digest('hex') };
  hashes.set(absolute, { stamp, value });
  return { ...value };
}

// Drop comments while preserving quoted values. No eval, Function, imports or AST execution.
function withoutComments(text) {
  let out = '', quote = '', line = false, block = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (line) { if (char === '\n') { line = false; out += char; } continue; }
    if (block) { if (char === '*' && next === '/') { block = false; i++; } else if (char === '\n') out += char; continue; }
    if (quote) {
      out += char;
      if (char === '\\') { out += next || ''; i++; }
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; out += char; }
    else if (char === '/' && next === '/') { line = true; i++; }
    else if (char === '/' && next === '*') { block = true; i++; }
    else out += char;
  }
  return out;
}

/** Current palette's literal fields only; dynamic factories remain game-side code. */
export function parsePalette(text, sourcePath, expandCounts = false) {
  const clean = withoutComments(text);
  const entries = [];
  const imports = new Map();
  for (const match of clean.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/gu)) {
    for (const name of match[1].split(',').map((item) => item.trim()).filter(Boolean)) {
      imports.set(name, slash(path.join(path.dirname(sourcePath), match[2])));
    }
  }
  // 옛 JS 팔레트(키/이름/갈래/수/표본·뽑기)와 TS 팔레트(key/label/category/count/prototype·pick) 둘 다 읽는다
  for (const match of clean.matchAll(/\{\s*(?:키|key):\s*"([^"\\]+)"\s*,\s*(?:이름|label):\s*"([^"\\]+)"([^}]+)\}/gu)) {
    const [, key, name, body] = match;
    const category = body.match(/(?:갈래|category):\s*"([^"\\]+)"/u)?.[1] || '기타';
    const count = expandCounts ? Number(body.match(/(?:^|,)\s*(?:수|count):\s*(\d+)/u)?.[1] || 1) : 1;
    const factory = body.match(/(?:표본|뽑기|prototype|pick):[\s\S]*?=>\s*\[?\s*([\p{L}\p{N}_$]+)\s*\(/u)?.[1];
    const sourceRefs = [...new Set([sourcePath, imports.get(factory)].filter(Boolean))];
    for (let index = 0; index < count; index++) {
      const paletteKey = expandCounts ? `${key}${index + 1}` : key;
      entries.push({
        id: `palette:${paletteKey}`, paletteKey,
        runtimeId: 'NAJU-01',
        name: expandCounts && count > 1 ? `${name} ${index + 1}` : name,
        kind: 'procedural', type: 'procedural', path: sourcePath, url: null,
        category, sourceRefs, factory: factory || null,
        usage: `현재 게임 편집기 팔레트 · ${category}. 게임 코드가 표본을 만듭니다.`,
        provenanceStatus: 'unverified', shapeStatus: 'unreviewed',
      });
    }
  }
  return entries;
}

async function projectDocuments(root) {
  const rootEntries = await fs.readdir(root, { withFileTypes: true });
  const project = rootEntries.find((entry) => entry.isDirectory() && nfc(entry.name) === '프로젝트파일');
  if (!project) return [];
  const all = await walk(root, project.name);
  const specifications = [
    ['fact-contract', '01 설화 사실 계약서.md'],
    ['synopsis', '02 지역 테마 시놉시스.md'],
    ['scenario', '03 게임 시나리오 기획서.md'],
    ['scenes', '04 Scene 구성표.md'],
  ];
  const documents = [];
  for (const [id, name] of specifications) {
    const relative = all.find((file) => nfc(file).includes('/데이터/게임문서/') && nfc(path.basename(file)) === name);
    if (!relative) continue;
    const text = await fs.readFile(path.join(root, relative), 'utf8');
    documents.push({ id, title: name.replace(/\.md$/u, ''), path: relative, text, sha256: digest(text) });
  }
  for (const [id, relative, title] of [
    ['layout', 'naju01/src/plan/sitePlan.ts', '현재 게임 공간도면'],
    ['placements', 'naju01/assets/edits.json', '현재 저장된 배치 수정'],
    ['palette', 'naju01/src/placement/assetCatalog.ts', '현재 게임 에셋 팔레트'],
  ]) {
    if (!await existing(root, relative)) continue;
    const text = await fs.readFile(path.join(root, relative), 'utf8');
    documents.push({ id, title, path: relative, text, sha256: digest(text) });
  }
  return documents;
}

const urlFor = (relative) => '/' + (relative.startsWith('public/') ? relative.slice(7) : relative).split('/').map(encodeURIComponent).join('/');

export async function getBootstrap(root) {
  root = path.resolve(root);
  const documents = await projectDocuments(root);
  const fact = documents.find((document) => document.id === 'fact-contract');
  const runtimeProfile = await publicRuntimeProfile(root);
  const visualReview = await visualReviewViews(root);
  const warnings = [
    '설화는 직접 입력하거나 MD·TXT를 가져올 수 있습니다. 게임 연결은 별도 선택이며, 참고용 게임은 해당 설화의 공간 승인 근거가 아닙니다.',
    fact ? '나주 예제 입력은 저장소의 설화 사실 계약서(v0.5.1, REVIEW)입니다. 설화 원전 전체 본문이 아니며, 문서에 적힌 출처·미확인 사항·창작 설정을 그대로 구분합니다.' : '나주 사실 계약서를 찾지 못했습니다. 예제 원문을 만들지 않았으며, 직접 입력한 설화로 검수를 시작할 수 있습니다.',
    '현재 나주 맵·에셋은 DEC-55에 따른 초안입니다. 이름이나 파일 존재만으로 형태·고증·라이선스 승인이 된 것으로 보지 않습니다.',
    'AI허브 원본·가공본 및 _aihub_local 데이터는 목록과 검수 자료에서 제외했습니다. 공개 자료의 _sf_local 구성은 별도로 구분하며, 이 화면의 승인도 외부 배포 허가를 대신하지 않습니다.',
    '목록의 GLB와 팔레트 표본은 같은 이름이어도 같은 메시라는 보장이 없습니다. 파일 미리보기와 실제 게임 배치를 각각 확인하세요.',
    '현재 연결하는 나주 게임은 공간 그레이박스입니다. 퍼즐 플레이 기능이 구현되지 않아 공간 검수는 가능하지만 퍼즐 완주 승인 근거로 사용할 수 없습니다.',
  ];
  warnings.push('에셋 카탈로그는 선택 가능한 자료 목록이며 실제 배치 수가 아닙니다. 공개 구성의 참조 파일 수와 구역별 실제 화면 검수를 별도로 확인하세요.');
  if (visualReview.warning) warnings.push(visualReview.warning);
  if (runtimeProfile.profile === 'naju-public-sf-v1') warnings.push('현재 연결은 src=sf 공개 에셋 교체 구성입니다. 공유 로더 파일명에 AI허브가 포함되지만 _aihub_local 데이터는 사용하지 않습니다.');
  if (!runtimeProfile.available) warnings.push('공개 에셋 구성에 누락되거나 허용되지 않는 경로가 있어 정상 게임 검수를 막았습니다. 공개 자료 파일을 확인하세요.');

  // Conservatively fingerprint current game sources plus shared runtime/public assets.
  // This intentionally invalidates a review when a shared runtime changes too.
  const candidates = new Set();
  // The fixed public profile does not enable anime variants or baking outputs.
  // Fingerprint only models actually referenced by its active manifest, including LODs.
  const activePublicFiles = new Set(runtimeProfile.profile === 'naju-public-sf-v1' ? [PUBLIC_MANIFEST, ...runtimeProfile.publicAssetPaths] : []);
  for (const directory of ['naju01/src', 'naju01/assets', 'naju01/에셋', 'src', 'public', '시작페이지/src/데이터']) {
    for (const file of await walk(root, directory)) {
      if (file.startsWith(`${PUBLIC_ASSET_ROOT}/`) && !activePublicFiles.has(file)) continue;
      candidates.add(file);
    }
  }
  for (const file of ['naju01/index.html', 'package.json', 'package-lock.json']) {
    if (await existing(root, file)) candidates.add(file);
  }
  const files = [];
  for (const file of [...candidates].sort()) files.push(await manifestEntry(root, file));
  const revision = digest(JSON.stringify({ files, runtime: { profile: runtimeProfile.profile, url: runtimeProfile.url, available: runtimeProfile.available, reviewBlockers: runtimeProfile.reviewBlockers } }));
  const manifest = new Map(files.map((file) => [file.path, file]));

  const assets = [];
  for (const file of files) {
    if (!/\.glb$/iu.test(file.path) || !(file.path.startsWith('naju01/assets/models/') || file.path.startsWith('naju01/에셋/모형/') || file.path.startsWith('public/vfx/'))) continue;
    assets.push({
      id: `glb:${file.path}`, name: path.basename(file.path, '.glb'), kind: 'glb', type: 'glb',
      ...file, url: urlFor(file.path), sourceRefs: [file.path],
      usage: file.path.startsWith('public/vfx/') ? '준비된 효과·소품 GLB. 실제 게임 사용 여부와 모양은 별도 검수.' : '준비된 나주 모형 GLB. 팔레트 표본과의 동일성은 별도 검수.',
      provenanceStatus: 'unverified', shapeStatus: 'unreviewed',
    });
  }
  for (const [relative, expand] of [['naju01/src/placement/assetCatalog.ts', false], ['naju01/src/models/nature.ts', true]]) {
    if (!manifest.has(relative)) continue;
    const text = await fs.readFile(path.join(root, relative), 'utf8');
    for (const asset of parsePalette(text, relative, expand)) {
      const refs = asset.sourceRefs.map((ref) => manifest.get(ref)).filter(Boolean);
      // Include the full game revision: factories use imported geometries/materials.
      asset.sha256 = digest(JSON.stringify({ key: asset.paletteKey, revision, refs }));
      asset.bytes = refs.reduce((sum, ref) => sum + ref.bytes, 0);
      asset.bytesMeaning = '참조 소스 파일 크기 합계이며 완성된 3D 파일 크기가 아닙니다.';
      assets.push(asset);
    }
  }
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length) throw new Error('중복 에셋 ID가 있어 검수 대상을 확정할 수 없습니다.');
  const sourceRevision = digest(JSON.stringify(documents.map(({ id, path: file, sha256 }) => ({ id, path: file, sha256 }))));
  const game = { ...runtimeProfile, visualViews: visualReview.views, publicAssetCount: runtimeProfile.publicAssetPaths.length, revision, files: files.sort(byPath), capabilities: { spaceReview: true, puzzlePlay: false }, revisionScope: '현재 나주 소스·배치·에셋 + 공통 src·public 자원 + 실행 주소·공개 에셋 구성. 검수 대상으로 연결한 경우 변경 시 보수적으로 재검수합니다.' };
  const runtimes = files.some(file => file.path.startsWith('naju01/')) ? [{ id: 'NAJU-01', title: '나주 앙암바위 · 현재 공간 초안', url: game.url, profile: game.profile, presentation: game.presentation, available: game.available, reviewBlockers: game.reviewBlockers, visualViews: game.visualViews, publicAssetCount: game.publicAssetCount, revision, sourceRevision, capabilities: { ...game.capabilities } }] : [];
  return {
    caseId: 'NAJU-01', title: '설화 제작 검수 · 연결 가능한 나주 공간 포함',
    source: fact ? { name: '나주 앙암바위 설화 사실 계약서 · 원전 전체 본문 아님', path: fact.path, text: fact.text, kind: 'fact-contract', sha256: fact.sha256 } : null,
    documents, assets, warnings, runtimes, game,
    gameRevision: revision, sourceRevision,
  };
}
