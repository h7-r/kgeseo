import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLibrary, searchLibrary, libraryRoutes, forbidden, CATEGORIES } from './library.mjs';
import { jamo, jamoSimilarity } from './library-search.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const names = result => result.results.map(r => r.item.nameKo);

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'library-test-'));
  const put = async (relative, content) => { await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await fs.writeFile(path.join(root, relative), content); };
  await put('public/_sf_local/manifest.json', JSON.stringify({
    바꿔치기: [{ target: '씬2.물동이', files: ['prop/water_jar.glb'] }, { target: '소품.바위', files: ['_aihub_local/rock.glb', 'AI허브/stone.glb'] }],
    검수: { 소품: ['prop/jar.glb', 'prop/missing.glb'] }, 반려: { 'prop/jar.glb': '반려 사유' },
  }));
  await put('public/_sf_local/prop/water_jar.glb', 'glb-1');
  await put('public/_sf_local/prop/jar.glb', 'glb-2');
  await put('public/_sf_local/_aihub_local/rock.glb', 'x');
  await put('public/_sf_local/AI허브/stone.glb', 'x');
  await put('public/_sf_local/khs/a_frame_carrier_bc43790f.glb', 'glb-3');
  await put('public/_sf_local/khs/aihub_jar_12345678.glb', 'x');
  await put('tools/review/library-khs-ko.json', JSON.stringify({ files: { 'a_frame_carrier_bc43790f.glb': { nameKo: '지게', nameEn: 'A frame Carrier', category: 'transport', tags: ['등짐'] } } }));
  await put('docs/에셋라이브러리/생성준비_v1/catalog.json', JSON.stringify({ assets: [
    { id: 'cm_jar', name_ko: '옹기 장독', category: 'storage', spaces: ['공통 부엌'], material: '옹기', subject_en: 'a jar' },
    { id: 'cm_jar2', name_ko: '옹기 장독', category: 'storage', spaces: ['공통 창고'], material: '옹기', subject_en: 'a jar' },
    { id: 'cm_bad', name_ko: 'AI허브 바위', category: 'garden', subject_en: 'rock' },
  ] }));
  return root;
}

test('실제 저장소 색인이 만들어지고 출처·분류가 채워진다', async () => {
  const library = await buildLibrary(ROOT);
  assert.ok(library.items.length > 100);
  for (const source of ['public', 'khs', 'catalog']) assert.ok(library.sources[source] > 0, source);
  assert.equal(new Set(library.items.map(i => i.id)).size, library.items.length);
  const ids = new Set(CATEGORIES.map(c => c.id));
  for (const item of library.items) {
    assert.ok(ids.has(item.category), item.id);
    assert.equal(item.placeable, item.source === 'public' || item.source === 'khs');
    if (item.placeable) { assert.match(item.url, /^\/_sf_local\//); assert.match(item.sha256, /^[0-9a-f]{64}$/); }
    else assert.equal(item.url, null);
    assert.ok(!forbidden(item.url || '') && !/aihub|AI허브/i.test(item.nameKo));
  }
  assert.equal(await buildLibrary(ROOT), library, 'mtime 이 같으면 캐시를 돌려준다');
});

test('AI허브 경로·반려·없는 파일·같은 이름 중복을 뺀다', async () => {
  const root = await fixture();
  const { items, sources } = await buildLibrary(root);
  assert.deepEqual(sources, { public: 1, khs: 1, palette: 0, catalog: 1, space: 0 });
  assert.ok(items.every(i => !/aihub|AI허브/i.test(`${i.path} ${i.url} ${i.nameKo}`)));
  assert.equal(items.find(i => i.source === 'public').nameKo, '물동이');
  const jar = items.find(i => i.source === 'catalog');
  assert.deepEqual(jar.spaces, ['공통 부엌', '공통 창고']);
  assert.equal(jar.placeable, false);
  await fs.rm(root, { recursive: true, force: true });
});

test('자모 분해와 유사도', () => {
  assert.equal(jamo('지게'), jamo('지개'));
  assert.ok(jamoSimilarity('가마솟', '가마솥') > 0.5);
  assert.equal(jamoSimilarity('', '지게'), 0);
});

test('한글 검색: 정확 일치, 오타, 동의어, 의미 모델 없음', async () => {
  const { items } = await buildLibrary(ROOT);
  const noModel = async () => { throw new Error('모델 없음(테스트)'); };
  const exact = await searchLibrary(items, '지게', { embedder: noModel, waitSemanticMs: 2000 });
  assert.equal(exact.semantic, false);
  assert.equal(exact.semanticStatus, 'unavailable');
  assert.equal(exact.results[0].item.nameKo.startsWith('지게'), true);
  assert.ok(exact.results.some(r => r.item.source === 'khs' && r.item.nameKo === '지게'));
  const typo = await searchLibrary(items, '지개', { embedder: noModel });
  assert.ok(names(typo).includes('지게'), '오타 지개 → 지게');
  const jar = await searchLibrary(items, '항아리', { embedder: noModel });
  assert.ok(jar.results.some(r => r.reasons.some(reason => reason.startsWith('동의어')) && /독|옹기/.test(`${r.item.nameKo} ${r.item.tags.join(' ')}`)), '항아리 → 독·옹기 동의어');
  const placeable = await searchLibrary(items, '항아리', { embedder: noModel, placeableOnly: true });
  assert.ok(placeable.results.length && placeable.results.every(r => r.item.placeable));
  assert.ok(jar.results.length <= 60);
  const none = await searchLibrary(items, '우주선레이저', { embedder: noModel });
  assert.equal(none.results.length, 0);
});

test('의미 검색: 임베더가 있으면 semantic:true 로 결합한다(가짜 임베더)', async () => {
  const root = await fixture();
  const { items } = await buildLibrary(root);
  // '물 긷는 그릇' 질의와 물동이 문서만 같은 방향
  const vec = text => Float32Array.from(/물동이|물 긷/.test(text) ? [1, 0] : [0, 1]);
  const embedder = async () => async texts => texts.map(vec);
  const result = await searchLibrary(items, '물 긷는 그릇', { root, embedder, waitSemanticMs: 3000 });
  assert.equal(result.semantic, true);
  assert.equal(result.results[0].item.nameKo, '물동이');
  assert.ok(result.results[0].reasons.some(r => r.startsWith('의미 유사')));
  const cache = JSON.parse(await fs.readFile(path.join(root, '.local/review/library-embeddings.json'), 'utf8'));
  assert.equal(cache.model, 'Xenova/multilingual-e5-small');
  await fs.rm(root, { recursive: true, force: true });
});

test('HTTP: /__review/library 와 /search', async () => {
  const handler = libraryRoutes(ROOT);
  const call = async url => {
    let status, body;
    const handled = await handler({ method: 'GET', url }, {}, url.split('?')[0], (s, v) => { status = s; body = v; });
    return { handled, status, body };
  };
  assert.equal((await call('/__review/projects')).handled, false);
  const all = await call('/__review/library');
  assert.equal(all.status, 200);
  assert.ok(all.body.items.length > 100 && all.body.categories.length === CATEGORIES.length);
  const found = await call(`/__review/library/search?q=${encodeURIComponent('지게')}&placeableOnly=1&semantic=0`);
  assert.equal(found.status, 200);
  assert.ok(found.body.results.every(r => r.item.placeable));
  assert.equal(found.body.semantic, false);
  assert.equal((await call('/__review/library/search?category=nope')).status, 400);
});

// 10/19 — 공간 항목(나주 앙암바위)의 구역 수치가 게임 도면(sitePlan.ts)과 어긋나지 않는지
test('공간 항목 구역 수치 = sitePlan ZONES', async () => {
  const { readFile } = await import('node:fs/promises');
  const root = new URL('../../', import.meta.url);
  const space = JSON.parse(await readFile(new URL('docs/에셋라이브러리/공간/naju01_angam.space.json', root), 'utf8'));
  const plan = await readFile(new URL('naju01/src/plan/sitePlan.ts', root), 'utf8');
  const block = plan.match(/export const ZONES\b[^=]*=\s*\[([\s\S]*?)\n\];/)[1];
  const range = (b, k) => b.match(new RegExp(`\\b${k}:\\s*\\[\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*\\]`)).slice(1).map(Number);
  const zones = block.split(/\n\s*\{/).map(b => { const code = b.match(/\bcode:\s*"([^"]+)"/)?.[1]; return code ? { code, x: range(b, 'x'), z: range(b, 'z'), elevation: Number(b.match(/elevation:\s*(-?[\d.]+)/)[1]) } : null; }).filter(Boolean);
  assert.equal(space.zones.length, zones.length);
  for (const zone of zones) {
    const mine = space.zones.find(z => z.code === zone.code);
    assert.deepEqual([mine.x, mine.z, mine.elevation], [zone.x, zone.z, zone.elevation], zone.code);
  }
});
