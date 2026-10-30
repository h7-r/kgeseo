import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editorEntries, editorPlace, editorRemove, editorRestore, editorUndo, editorUpdate } from './manifestPlace.mjs';

// 편집기(5174) 즉시 배치 — manifest 「놓기」 덧붙이기 · 되돌리기 (10/15)
function glbFixture() {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ children: [1], scale: [1, 2, 1] }, { mesh: 0, translation: [0, 5, 0] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ componentType: 5126, count: 3, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }] }));
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, padded]);
}
const baseManifest = { 설명: '시험', 놓기: [{ file: 'rock/stone21.glb', 키m: 3.6, 묻힘m: 0.8, 자리: [[32.9, 21.8, 20, 1]], 메모: '기존' }, { file: 'prop/jar.glb', 키m: 1, 자리: [[1, 2, 0, 1]], 출처: 'review:abc' }], 검수: {} };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'kgeseo-editor-place-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'public/_sf_local/prop'), { recursive: true });
  await writeFile(join(root, 'public/_sf_local/prop/jar.glb'), glbFixture());
  await mkdir(join(root, 'public/_sf_local/AI허브'), { recursive: true }); await writeFile(join(root, 'public/_sf_local/AI허브/x.glb'), glbFixture());
  await symlink(join(root, 'public/_sf_local/prop/jar.glb'), join(root, 'public/_sf_local/prop/link.glb'));
  await writeFile(join(root, 'public/_sf_local/manifest.json'), `${JSON.stringify(baseManifest, null, 2)}\n`);
  return { root, dataDir: join(root, '.local/review') };
}
const read = async root => JSON.parse(await readFile(join(root, 'public/_sf_local/manifest.json'), 'utf8'));
const body = (extra = {}) => ({ asset: { source: 'public', url: '/_sf_local/prop/jar.glb' }, position: { x: 10.5, y: 3.1, z: -4 }, rotationY: -30, scale: 1.5, groundY: 3.2, ...extra });

test('editor placement validates like the review server and appends a 놓기 entry with backup', async t => {
  const { root, dataDir } = await fixture(t);
  for (const asset of [{ url: '/naju01/assets/a.glb' }, { url: '/_sf_local/AI허브/x.glb' }, { url: '/_sf_local/../manifest.json' }, { url: '/_sf_local/prop/jar.png' }, { source: 'catalog', url: '/_sf_local/prop/jar.glb' }]) {
    await assert.rejects(editorPlace(root, dataDir, body({ asset })), error => error.status === 400, JSON.stringify(asset));
  }
  await assert.rejects(editorPlace(root, dataDir, body({ asset: { url: '/_sf_local/prop/link.glb' } })), error => error.status === 422);
  await assert.rejects(editorPlace(root, dataDir, body({ asset: { url: '/_sf_local/prop/jar.glb', sha256: 'f'.repeat(64) } })), error => error.status === 409);
  await assert.rejects(editorPlace(root, dataDir, body({ scale: 0 })), error => error.status === 400);
  assert.equal((await read(root)).놓기.length, 2);
  const sha = createHash('sha256').update(glbFixture()).digest('hex');
  const result = await editorPlace(root, dataDir, body({ asset: { source: 'public', url: '/_sf_local/prop/jar.glb', sha256: sha, nameKo: '항아리' }, note: '마당' }));
  const manifest = await read(root);
  assert.equal(manifest.놓기.length, 3); assert.deepEqual(Object.keys(manifest), Object.keys(baseManifest));
  const entry = manifest.놓기[2];
  assert.deepEqual(entry, result.entry); assert.equal(result.index, 2);
  assert.equal(entry.file, 'prop/jar.glb'); assert.equal(entry.키m, 3); assert.equal(entry.묻힘m, 0.1);
  assert.deepEqual(entry.자리, [[10.5, -4, 330, 1]]); assert.ok(entry.출처.startsWith('editor:')); assert.ok(entry.메모.includes('항아리') && entry.메모.includes('마당'));
  assert.equal((await readdir(dataDir)).filter(name => name.startsWith('manifest_bak_')).length, 1);
  assert.equal((await editorEntries(root)).length, 1);
});

test('editor undo removes only the last editor entry and keeps review entries', async t => {
  const { root, dataDir } = await fixture(t);
  await assert.rejects(editorUndo(root, dataDir), error => error.status === 404);
  const [a, b] = await Promise.all([editorPlace(root, dataDir, body()), editorPlace(root, dataDir, body({ position: { x: 1, y: 3.2, z: 1 } }))]);
  assert.notEqual(a.entry.출처, b.entry.출처);
  assert.equal((await read(root)).놓기.length, 4);
  const undone = await editorUndo(root, dataDir);
  assert.equal(undone.remaining, 1);
  const manifest = await read(root);
  assert.equal(manifest.놓기.length, 3); assert.equal(manifest.놓기[1].출처, 'review:abc');
  assert.equal(manifest.놓기.filter(entry => entry.출처?.startsWith('editor:')).length, 1);
  await editorUndo(root, dataDir);
  await assert.rejects(editorUndo(root, dataDir), error => error.status === 404);
  assert.deepEqual((await read(root)).놓기, baseManifest.놓기);
  assert.equal((await readdir(dataDir)).filter(name => name.startsWith('manifest_bak_')).length, 4);
});

test('editor update/remove/restore edit any 놓기 spot with backup and undo exactly', async t => {
  const { root, dataDir } = await fixture(t);
  const ref = { index: 0, file: 'rock/stone21.glb', spot: 0, at: [32.9, 21.8] };
  await assert.rejects(editorUpdate(root, dataDir, { ref: { ...ref, at: [0, 0] }, position: { x: 1, y: 0, z: 1 } }), error => error.status === 409);
  await assert.rejects(editorUpdate(root, dataDir, { ref: { ...ref, index: 'a' }, position: { x: 1, y: 0, z: 1 } }), error => error.status === 400);
  // 번호가 밀려도 파일·자리로 찾는다
  const updated = await editorUpdate(root, dataDir, { ref: { ...ref, index: 5 }, position: { x: 30, y: 1.2, z: 20 }, rotationY: 400, scale: 2, groundY: 2 });
  assert.equal(updated.index, 0); assert.deepEqual(updated.previous, baseManifest.놓기[0]);
  let manifest = await read(root);
  assert.deepEqual(manifest.놓기[0], { ...baseManifest.놓기[0], 묻힘m: 0.8, 자리: [[30, 20, 40, 2]] });
  assert.deepEqual(Object.keys(manifest), Object.keys(baseManifest)); assert.deepEqual(manifest.놓기[1], baseManifest.놓기[1]);
  // 되돌리기 = restore(expect 지금 → entry 이전)
  await assert.rejects(editorRestore(root, dataDir, { index: 0, expect: baseManifest.놓기[0], entry: baseManifest.놓기[0] }), error => error.status === 409);
  await editorRestore(root, dataDir, { index: 0, expect: updated.entry, entry: updated.previous });
  assert.deepEqual((await read(root)).놓기, baseManifest.놓기);
  // 지우기(자리 하나뿐 → 항목째) → 되살리기(끼우기)
  const removed = await editorRemove(root, dataDir, { ref: { index: 1, file: 'prop/jar.glb', spot: 0, at: [1, 2] } });
  assert.equal(removed.entry, null); manifest = await read(root);
  assert.equal(manifest.놓기.length, 1);
  await assert.rejects(editorRestore(root, dataDir, { index: 0, entry: { file: '../x.glb', 자리: [[0, 0]] } }), error => error.status === 400);
  await editorRestore(root, dataDir, { index: removed.index, entry: removed.previous });
  assert.deepEqual((await read(root)).놓기, baseManifest.놓기);
  assert.equal((await readdir(dataDir)).filter(name => name.startsWith('manifest_bak_')).length, 4);
});

test('editor remove keeps the other spots of a multi-spot entry', async t => {
  const { root, dataDir } = await fixture(t);
  const multi = { ...baseManifest, 놓기: [{ file: 'prop/jar.glb', 키m: 1, 묻힘m: 0.2, 자리: [[1, 1, 0, 1], [5, 5, 90]] }] };
  await writeFile(join(root, 'public/_sf_local/manifest.json'), `${JSON.stringify(multi, null, 2)}\n`);
  const result = await editorUpdate(root, dataDir, { ref: { index: 0, file: 'prop/jar.glb', spot: 1, at: [5, 5] }, position: { x: 6, y: 9, z: 6 }, rotationY: 90, scale: 1, groundY: 0 });
  assert.equal(result.heightIgnored, true); assert.equal(result.entry.묻힘m, 0.2);
  assert.deepEqual(result.entry.자리, [[1, 1, 0, 1], [6, 6, 90]]);
  const removed = await editorRemove(root, dataDir, { ref: { index: 0, file: 'prop/jar.glb', spot: 0, at: [1, 1] } });
  assert.deepEqual(removed.entry.자리, [[6, 6, 90]]);
  assert.equal((await read(root)).놓기.length, 1);
});
