import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getBootstrap, parsePalette } from './data.mjs';

test('palette literal metadata is extracted without evaluating factories', () => {
  const entries = parsePalette(`
    import { makeBench } from './benches.js';
    // { 키: "comment", 이름: "not an asset", 갈래: "fake" }
    export const items = [
      { 키: "씬2.평상", 이름: "평상", 갈래: "씬 2", 표본: (s) => makeBench(s) },
      { 키: "폭발", 이름: "평가 금지", 갈래: "기타", 표본: () => process.exit(99) }
    ];
  `, 'naju01/src/palette.js');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].paletteKey, '씬2.평상');
  assert.deepEqual(entries[0].sourceRefs, ['naju01/src/palette.js', 'naju01/src/benches.js']);
  assert.equal(entries[0].provenanceStatus, 'unverified');
});

test('numbered natural palette entries preserve the actual runtime keys', () => {
  const entries = parsePalette('{ 키: "자연.바위", 이름: "바위", 수: 2, 갈래: "돌", 뽑기: (i) => shapes()[i] }', 'naju01/src/nature.js', true);
  assert.deepEqual(entries.map((asset) => asset.paletteKey), ['자연.바위1', '자연.바위2']);
  assert.deepEqual(entries.map((asset) => asset.name), ['바위 1', '바위 2']);
});

test('bootstrap uses real content, excludes restricted assets and detects revision changes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'naju-review-data-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const put = async (name, text) => {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), text);
  };
  const fact = '프로젝트파일/데이터/게임문서/01 설화 사실 계약서.md';
  await put(fact, '# 검수 계약서\nREVIEW\n실제 저장된 입력');
  await put('프로젝트파일/데이터/게임문서/02 지역 테마 시놉시스.md', '# 시놉시스\n준비된 문서');
  await put('naju01/src/placement/assetCatalog.ts', '{ key: "소품.바위", label: "바위", category: "돌", prototype: () => sample() }');
  await put('naju01/src/main.tsx', 'export const ready = 1;');
  await put('naju01/assets/edits.json', '{"position":1}');
  await put('naju01/에셋/모형/배.glb', 'a');
  await put('public/vfx/물.glb', 'b');
  await put('public/_aihub_local/private.glb', 'restricted');
  await put('naju01/src/loaders/publicAssets.tsx', 'shared loader source only');
  await put('naju01/src/scenes/다른AI허브.jsx', 'restricted');
  await put('naju01/에셋/원본/original.glb', 'original');
  await fs.symlink(path.join(root, 'public/_aihub_local/private.glb'), path.join(root, 'public/vfx/link.glb'));
  const first = await getBootstrap(root);
  assert.equal(first.source.text, '# 검수 계약서\nREVIEW\n실제 저장된 입력');
  assert.equal(first.source.kind, 'fact-contract');
  assert.equal(first.assets.length, 3);
  assert.ok(first.assets.every((asset) => !/aihub|원본|link/iu.test(asset.path)));
  assert.ok(first.game.files.every((entry) => entry.path === 'naju01/src/loaders/publicAssets.tsx' || !/aihub|AI허브|원본|link/iu.test(entry.path)));
  assert.ok(first.game.files.some(entry => entry.path === 'naju01/src/loaders/publicAssets.tsx'));
  assert.equal(first.assets.find((asset) => asset.name === '물').url, '/vfx/%EB%AC%BC.glb');
  assert.equal(first.game.capabilities.puzzlePlay, false);
  assert.deepEqual(first.runtimes.map(runtime => runtime.id), ['NAJU-01']);
  assert.equal(first.runtimes[0].revision, first.gameRevision);
  assert.equal(first.runtimes[0].sourceRevision, first.sourceRevision);
  assert.equal(first.runtimes[0].url, first.game.url);
  assert.equal(first.runtimes[0].profile, 'naju-base-v1');
  assert.equal(first.assets.find(asset => asset.type === 'procedural').runtimeId, 'NAJU-01');
  assert.equal((await getBootstrap(root)).gameRevision, first.gameRevision);
  await put('naju01/assets/edits.json', '{"position":2}');
  const edited = await getBootstrap(root);
  assert.notEqual(edited.gameRevision, first.gameRevision);
  assert.notEqual(edited.assets.find((asset) => asset.kind === 'procedural').sha256, first.assets.find((asset) => asset.kind === 'procedural').sha256);
  await put(fact, '# 검수 계약서\nREVIEW\n수정된 입력');
  const changedSource = await getBootstrap(root);
  assert.notEqual(changedSource.sourceRevision, edited.sourceRevision);
  assert.equal(changedSource.gameRevision, edited.gameRevision);
  await put('naju01/에셋/모형/배.glb', 'c');
  const changedAsset = await getBootstrap(root);
  assert.notEqual(changedAsset.assets.find((asset) => asset.name === '배').sha256, first.assets.find((asset) => asset.name === '배').sha256);
  assert.notEqual(changedAsset.gameRevision, changedSource.gameRevision);
});

test('missing example source leaves general tale entry available without fabricating text or runtime', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'naju-review-empty-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bootstrap = await getBootstrap(root);
  assert.equal(bootstrap.source, null);
  assert.deepEqual(bootstrap.runtimes, []);
  assert.deepEqual(bootstrap.assets, []);
  assert.ok(bootstrap.warnings.some(warning => warning.includes('직접 입력한 설화')));
});

async function publicFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'naju-public-profile-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const put = async (relative, content) => {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), content);
  };
  await put('naju01/src/main.tsx', 'export const main = true;');
  await put('naju01/src/loaders/publicAssets.tsx', 'export const sharedLoader = 1;');
  await put('public/_sf_local/rock/stone.glb', 'public model');
  const manifest = async value => put('public/_sf_local/manifest.json', JSON.stringify(value));
  await manifest({ 바꿔치기: [{ target: '바위', files: ['rock/stone.glb'] }] });
  return { root, put, manifest };
}

test('public profile fingerprints its exact URL, source loader and public models while excluding AIHub data', async t => {
  const f = await publicFixture(t);
  await f.put('public/_aihub_local/private.glb', 'restricted data');
  const first = await getBootstrap(f.root);
  assert.equal(first.game.profile, 'naju-public-sf-v1');
  assert.equal(first.runtimes[0].profile, 'naju-public-sf-v1');
  assert.equal(first.runtimes[0].url, '/naju01/?review=1&aihub=&src=sf&r=15');
  assert.equal(first.runtimes[0].available, true); assert.deepEqual(first.runtimes[0].reviewBlockers, []);
  assert.ok(first.game.files.some(file => file.path === 'naju01/src/loaders/publicAssets.tsx'));
  assert.ok(first.game.files.some(file => file.path === 'public/_sf_local/rock/stone.glb'));
  assert.ok(first.game.files.every(file => !file.path.includes('_aihub_local')));
  await f.put('public/_aihub_local/private.glb', 'changed restricted data');
  assert.equal((await getBootstrap(f.root)).gameRevision, first.gameRevision);
  await f.put('naju01/src/loaders/publicAssets.tsx', 'export const sharedLoader = 2;');
  const loaderChange = await getBootstrap(f.root); assert.notEqual(loaderChange.gameRevision, first.gameRevision);
  await f.put('public/_sf_local/rock/stone.glb', 'public model changed');
  const modelChange = await getBootstrap(f.root); assert.notEqual(modelChange.gameRevision, loaderChange.gameRevision);
  await fs.rm(path.join(f.root, 'public/_sf_local/manifest.json'));
  const base = await getBootstrap(f.root); assert.equal(base.game.profile, 'naju-base-v1'); assert.notEqual(base.gameRevision, modelChange.gameRevision);
});

test('public manifest missing and unsafe paths disable its profile instead of silently approving the base map', async t => {
  const f = await publicFixture(t);
  const invalid = ['../outside.glb', '/absolute.glb', 'https://example.test/model.glb', 'rock/%2e%2e/model.glb', 'rock\\model.glb', '_aihub_local/private.glb', 'rock/missing.glb'];
  for (const file of invalid) {
    await f.manifest({ 놓기: [{ file }] });
    const result = await getBootstrap(f.root);
    assert.equal(result.game.profile, 'naju-public-sf-v1'); assert.equal(result.runtimes[0].available, false, file);
    assert.ok(result.runtimes[0].reviewBlockers.length); assert.equal(typeof result.runtimes[0].reviewBlockers[0], 'string');
  }
});

test('public manifest rejects both file and parent-directory symlinks', async t => {
  const f = await publicFixture(t);
  await f.put('other/model.glb', 'not from selected root');
  await fs.symlink(path.join(f.root, 'other/model.glb'), path.join(f.root, 'public/_sf_local/link.glb'));
  await f.manifest({ 바꿔치기: [{ files: ['link.glb'] }] });
  assert.equal((await getBootstrap(f.root)).game.available, false);
  await fs.symlink(path.join(f.root, 'other'), path.join(f.root, 'public/_sf_local/linked'));
  await f.manifest({ 덮기: [{ files: ['linked/model.glb'] }] });
  assert.equal((await getBootstrap(f.root)).game.available, false);
  await f.put('other/manifest.json', JSON.stringify({ 놓기: [{ file: 'rock/stone.glb' }] }));
  await fs.rm(path.join(f.root, 'public/_sf_local/manifest.json'));
  await fs.symlink(path.join(f.root, 'other/manifest.json'), path.join(f.root, 'public/_sf_local/manifest.json'));
  assert.equal((await getBootstrap(f.root)).game.available, false);
});

test('public manifest validates far-distance replacements and malformed data', async t => {
  const f = await publicFixture(t);
  await f.manifest({ 바꿔치기: [{ files: ['rock/stone.glb'], 원경files: ['rock/missing-lo.glb'] }] });
  assert.equal((await getBootstrap(f.root)).game.available, false);
  await f.put('public/_sf_local/manifest.json', '{ broken');
  assert.equal((await getBootstrap(f.root)).game.available, false);
  await f.manifest({ 바꿔치기: [{ files: 'rock/stone.glb' }] });
  assert.equal((await getBootstrap(f.root)).game.available, false);
  await f.manifest({ 설명: 'no models' });
  assert.equal((await getBootstrap(f.root)).game.available, false);
});

test('only active public models affect revision; unused bake outputs and disabled public data do not', async t => {
  const f = await publicFixture(t);
  await f.put('public/_sf_local/rock/stone-lo.glb', 'active far model');
  await f.manifest({ 바꿔치기: [{ files: ['rock/stone.glb'], 원경files: ['rock/stone-lo.glb'] }] });
  const first = await getBootstrap(f.root);
  for (const relative of ['anime_bake/new-model.glb', 'anime/rock/stone.glb', 'rock/not-selected.glb']) {
    await f.put(`public/_sf_local/${relative}`, 'new unused output');
    assert.equal((await getBootstrap(f.root)).gameRevision, first.gameRevision);
    await f.put(`public/_sf_local/${relative}`, 'changed unused output');
    assert.equal((await getBootstrap(f.root)).gameRevision, first.gameRevision);
  }
  const unchanged = await getBootstrap(f.root);
  assert.deepEqual(unchanged.game.files.filter(file => file.path.startsWith('public/_sf_local/')).map(file => file.path).sort(), [
    'public/_sf_local/manifest.json', 'public/_sf_local/rock/stone-lo.glb', 'public/_sf_local/rock/stone.glb',
  ]);
  await f.put('public/_sf_local/rock/stone-lo.glb', 'changed active far model');
  const changed = await getBootstrap(f.root); assert.notEqual(changed.gameRevision, first.gameRevision);
  await fs.rm(path.join(f.root, 'public/_sf_local/manifest.json'));
  const base = await getBootstrap(f.root); assert.equal(base.game.profile, 'naju-base-v1');
  await f.put('public/_sf_local/rock/stone.glb', 'changed but profile disabled');
  const stillBase = await getBootstrap(f.root); assert.equal(stillBase.gameRevision, base.gameRevision);
  assert.ok(stillBase.game.files.every(file => !file.path.startsWith('public/_sf_local/')));
  await f.put('public/unrelated-shared.txt', 'shared runtime resource');
  assert.notEqual((await getBootstrap(f.root)).gameRevision, base.gameRevision);
});

test('registered visual views are bounded metadata included in runtime revisions, separate from asset counts', async t => {
  const f = await publicFixture(t);
  const views = ['wide', 'detail'].map((label, index) => ({ id: `Z1-${label}`, zoneId: 'Z1', zoneName: '나루터', label, position: [index, 2, 3], target: [0, 0, 0] }));
  await f.put('naju01/src/review/reviewViews.json', JSON.stringify(views));
  const first = await getBootstrap(f.root);
  assert.deepEqual(first.runtimes[0].visualViews, views); assert.equal(first.runtimes[0].publicAssetCount, 1);
  assert.notEqual(first.assets.length, first.runtimes[0].publicAssetCount); // library count is not placed/active model count
  assert.ok(first.game.files.some(value => value.path === 'naju01/src/review/reviewViews.json'));
  views[0].position[0] = 5; await f.put('naju01/src/review/reviewViews.json', JSON.stringify(views));
  assert.notEqual((await getBootstrap(f.root)).gameRevision, first.gameRevision);
  views[0].position[0] = 'not a number'; await f.put('naju01/src/review/reviewViews.json', JSON.stringify(views));
  const invalid = await getBootstrap(f.root); assert.deepEqual(invalid.runtimes[0].visualViews, []); assert.equal(invalid.runtimes[0].available, true);
  assert.ok(invalid.warnings.some(value => value.includes('사진 검수 모드')));
});
