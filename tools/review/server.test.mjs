import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { createReviewHandler, REQUIRED_CHECKS, reviewWorkbenchPlugin } from './server.mjs';

const bootstrap = () => ({
  caseId: 'NAJU-01', gameRevision: 'game-v1', sourceRevision: 'source-v1',
  source: { name: '사실 계약', path: 'docs/facts.md', sha256: 'facts-v1', text: '참고 본문' },
  documents: [{ id: 'story', path: 'docs/story.md', sha256: 'story-v1', text: '전체 문서는 복제하지 않음' }],
  game: { capabilities: { spaceReview: true, puzzlePlay: false }, files: [{ path: 'naju01/src/app/App.tsx', bytes: 1234, sha256: 'app-v1' }] },
  assets: [{ id: 'boat', name: '나룻배', path: 'naju01/boat.glb', type: 'glb', sha256: 'boat-v1' }, { id: 'ground', name: '바닥', type: 'procedural', sha256: 'ground-v1' }],
});
const visualViews = () => ['Z1', 'Z2'].flatMap(zoneId => ['wide', 'detail'].map((label, index) => ({ id: `${zoneId}-${label}`, zoneId, zoneName: `${zoneId} 구역`, label, position: [index, 2, 3], target: [0, 0, 0] })));
// Marker fixture exercises signature/dimension validation; browser rendering is tested separately.
function jpegFixture(seed = 1, width = 640, height = 360, padding = 0) {
  const frame = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0]);
  return 'data:image/jpeg;base64,' + Buffer.concat([frame, Buffer.alloc(padding + 1, seed), Buffer.from([0xff, 0xd9])]).toString('base64');
}
async function fixture(t, { root } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'kgeseo-review-api-'));
  const data = bootstrap();
  const handler = createReviewHandler({ ...(root ? { root } : {}), dataDir: dir, getBootstrap: async () => structuredClone(data) });
  const server = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const request = async (path, method = 'GET', value, headers = {}) => {
    const response = await fetch(base + '/__review' + path, { method, headers: { ...(value === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: value === undefined ? undefined : JSON.stringify(value) });
    return { status: response.status, body: await response.json() };
  };
  const create = async (overrides = {}) => {
    const result = await request('/projects', 'POST', { title: '앙암바위 검수', sourceText: '# 입력 설화\n실제 제출된 원문', sourceName: '설화.md', synopsis: '원문을 바탕으로 작성한 시놉시스', sceneNotes: '나루터에서 배를 살피고 바위로 이동', selectedAssetIds: ['boat'], caseId: 'NAJU-01', runtimeId: 'NAJU-01', runtimeUse: 'target', ...overrides });
    assert.equal(result.status, 201); return result.body;
  };
  const decide = (p, gate, decision = 'approved', extra = {}) => request(`/projects/${p.id}/decisions`, 'POST', { expectedRevision: p.revision, gate, decision, reviewer: '검수자', note: '직접 확인함', checks: REQUIRED_CHECKS[gate], ...extra });
  const session = async (p, kind = 'space', mode = 'normal') => {
    const result = await request(`/projects/${p.id}/sessions`, 'POST', { expectedRevision: p.revision, kind, mode });
    assert.equal(result.status, 201); return result.body;
  };
  const event = (p, s, events = [{ type: 'ready', detail: { renderedFrames: 2 } }]) => request(`/projects/${p.id}/sessions/${s.id}/events`, 'POST', { token: s.token, events });
  const inspect = (p, status = 'loaded', extra = {}) => request(`/projects/${p.id}/inspections`, 'POST', { expectedRevision: p.revision, assetId: 'boat', assetSha256: 'boat-v1', gameRevision: p.gameRevision, status, ...extra });
  const observe = (p, s, assetId = 'ground', extra = {}) => request(`/projects/${p.id}/inspections`, 'POST', { expectedRevision: p.revision, assetId, assetSha256: data.assets.find(a => a.id === assetId)?.sha256, gameRevision: p.gameRevision, status: 'observed', sessionId: s.id, note: `${assetId} 위치에서 형태와 배치를 직접 확인`, ...extra });
  const capture = (p, s, viewId, extra = {}) => request(`/projects/${p.id}/scene-captures`, 'POST', { expectedRevision: p.revision, sessionId: s.id, viewId, imageDataUrl: jpegFixture(), gameRevision: p.gameRevision, runtimeProfile: s.runtimeProfile, ...extra });
  const reviewScene = (p, zoneId, captureIds, extra = {}) => request(`/projects/${p.id}/scene-reviews`, 'POST', { expectedRevision: p.revision, zoneId, captureIds, decision: 'approved', reviewer: '검수자', note: '', ...extra });
  const objectIssue = (p, s, extra = {}) => request(`/projects/${p.id}/object-issues`, 'POST', { expectedRevision: p.revision, sessionId: s.id, gameRevision: p.gameRevision, object: { objectId: 'mesh-1:2', name: '바위', meshName: '돌', groupName: '바위무리', instanceId: 2, position: [1, 2, 3], zoneId: 'Z1', identityQuality: 'instance-name' }, disposition: 'change_requested', reviewer: '검수자', note: '길을 가리는 바위를 옮겨 주세요.', ...extra });
  return { dir, data, base, request, create, decide, session, event, inspect, observe, capture, reviewScene, objectIssue };
}

async function sceneFixture(t, overrides = {}, options = {}) {
  const f = await fixture(t, options); f.data.game.visualViews = visualViews(); f.data.game.publicAssetCount = 92;
  const p = await f.create({ assetReviewMode: 'scene', selectedAssetIds: [], ...overrides });
  const s = await f.session(p, 'space', 'diagnostic'); await f.event(p, s);
  return { ...f, p, s };
}

async function captureAndReviewAll(f, p = f.p, s = f.s) {
  let project = p;
  for (const view of f.data.game.visualViews) {
    const result = await f.capture(project, s, view.id); assert.equal(result.status, 200); project = result.body;
  }
  for (const zone of Object.values(project.sceneReviewStatus)) {
    const result = await f.reviewScene(project, zone.zoneId, zone.latestCaptureIds); assert.equal(result.status, 200); project = result.body;
  }
  return project;
}

test('scene photos replace catalog-wide checks but never replace a normal movement session', async t => {
  const f = await sceneFixture(t); const p = await captureAndReviewAll(f);
  assert.equal(p.sceneCaptures.length, 4); assert.equal(p.sceneReviews.length, 2);
  assert.equal(p.assetReviewMode, 'scene'); assert.equal(p.selectedAssetIds.length, 0);
  assert.deepEqual(p.referenceSnapshot.game.visualViews, visualViews()); assert.equal(p.referenceSnapshot.game.publicAssetCount, 92);
  assert.equal((await f.decide(p, 'assets')).status, 422); // source remains a separate prerequisite
  assert.equal((await f.decide(p, 'source')).status, 200);
  assert.equal((await f.decide(p, 'assets', 'approved', { checks: [] })).status, 422);
  assert.equal((await f.decide(p, 'assets')).status, 200);
  assert.equal((await f.decide(p, 'space')).status, 422);
  const normal = await f.session(p); await f.event(p, normal);
  assert.equal((await f.decide(p, 'space')).status, 200);
});

test('recapturing invalidates photo and final approvals while retaining old images and allowing fresh decisions', async t => {
  const f = await sceneFixture(t); let p = await captureAndReviewAll(f);
  await f.decide(p, 'source'); await f.decide(p, 'assets'); const normal = await f.session(p); await f.event(p, normal); await f.decide(p, 'space');
  const oldIds = p.sceneReviewStatus.Z1.latestCaptureIds;
  const recaptured = await f.capture(p, f.s, 'Z1-wide', { imageDataUrl: jpegFixture(2) });
  assert.equal(recaptured.status, 200); p = recaptured.body;
  assert.equal(p.sceneCaptures.length, 5); assert.equal(p.sceneReviewStatus.Z1.status, 'stale');
  assert.equal(p.gateStatus.source.status, 'approved'); assert.equal(p.gateStatus.assets.status, 'pending'); assert.equal(p.gateStatus.space.status, 'pending');
  assert.ok(p.decisions.find(value => value.gate === 'assets').invalidatedAt);
  assert.equal((await f.reviewScene(p, 'Z1', oldIds)).status, 409);
  const reviewed = await f.reviewScene(p, 'Z1', p.sceneReviewStatus.Z1.latestCaptureIds); assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.sceneReviewStatus.Z1.status, 'approved'); assert.equal(reviewed.body.gateStatus.assets.status, 'pending');
  assert.equal((await f.decide(p, 'assets')).status, 200);
  const next = await f.request(`/projects/${p.id}`, 'PATCH', { expectedRevision: p.revision, sceneNotes: '새 배치 기준' });
  assert.equal(next.body.sceneCaptures.length, 5); assert.equal(next.body.sceneReviews.length, 3);
  assert.equal(next.body.sceneReviewStatus.Z1.status, 'pending'); assert.equal(next.body.history.at(-1).previousSnapshot.editable.assetReviewMode, 'scene');
});

test('all registered views and additional selected assets must be reviewed in scene mode', async t => {
  const f = await sceneFixture(t, { selectedAssetIds: ['boat'] });
  let p = (await f.capture(f.p, f.s, 'Z1-wide')).body;
  assert.equal((await f.reviewScene(p, 'Z1', p.sceneReviewStatus.Z1.latestCaptureIds)).status, 409);
  p = await captureAndReviewAll(f); await f.decide(p, 'source');
  const missing = await f.decide(p, 'assets'); assert.equal(missing.status, 422); assert.ok(missing.body.blockers.some(value => value.code === 'asset_unseen'));
  await f.inspect(p); assert.equal((await f.decide(p, 'assets')).status, 200);
});

test('scene capture requires current diagnostic readiness and registered view identity', async t => {
  const f = await sceneFixture(t); const { p } = f;
  const normal = await f.session(p); await f.event(p, normal);
  assert.equal((await f.capture(p, normal, 'Z1-wide')).status, 422);
  const unready = await f.session(p, 'space', 'diagnostic'); assert.equal((await f.capture(p, unready, 'Z1-wide')).status, 422);
  assert.equal((await f.capture(p, f.s, 'unknown')).status, 400);
  assert.equal((await f.capture(p, f.s, 'Z1-wide', { gameRevision: 'old-game' })).status, 409);
  assert.equal((await f.capture(p, f.s, 'Z1-wide', { runtimeProfile: 'wrong-profile' })).status, 409);
  await f.event(p, f.s, [{ type: 'error' }]); assert.equal((await f.capture(p, f.s, 'Z1-wide')).status, 422);
  const next = (await f.request(`/projects/${p.id}`, 'PATCH', { expectedRevision: 1 })).body;
  assert.equal((await f.capture(next, f.s, 'Z1-wide')).status, 422);
});

test('reference pictures may be saved but cannot become scene approval evidence', async t => {
  const f = await fixture(t); f.data.game.visualViews = visualViews();
  const p = await f.create({ runtimeUse: 'reference' }); const s = await f.session(p, 'space', 'diagnostic'); await f.event(p, s);
  await f.capture(p, s, 'Z1-wide'); const captured = await f.capture(p, s, 'Z1-detail'); assert.equal(captured.status, 200);
  const ids = captured.body.sceneReviewStatus.Z1.latestCaptureIds;
  const approval = await f.reviewScene(p, 'Z1', ids); assert.equal(approval.status, 422); assert.equal(approval.body.error, 'runtime_reference_only');
  assert.equal((await f.reviewScene(p, 'Z1', ids, { decision: 'rejected', note: '' })).status, 400);
  assert.equal((await f.reviewScene(p, 'Z1', ids, { decision: 'rejected', note: '이 설화에 맞지 않는 참고 공간' })).status, 200);
  assert.equal((await f.request(`/projects/${p.id}`, 'PATCH', { expectedRevision: 1, assetReviewMode: 'scene' })).status, 422);
  const missingViews = await fixture(t); const other = await missingViews.create();
  assert.equal((await missingViews.request(`/projects/${other.id}`, 'PATCH', { expectedRevision: 1, assetReviewMode: 'scene' })).status, 422);
});

test('JPEG capture validation enforces format dimensions bytes and duplicate/per-view retention limits', async t => {
  const f = await sceneFixture(t); const { p, s } = f;
  for (const imageDataUrl of ['data:image/png;base64,aGVsbG8=', 'data:image/jpeg;base64,aGVsbG8=', jpegFixture(1, 5000, 10), jpegFixture(1, 3000, 3000)]) assert.equal((await f.capture(p, s, 'Z1-wide', { imageDataUrl })).status, 400);
  assert.equal((await f.capture(p, s, 'Z1-wide', { imageDataUrl: jpegFixture(1, 640, 360, 701 * 1024) })).status, 413);
  assert.equal((await f.capture(p, s, 'Z1-wide')).status, 200);
  const duplicate = await f.capture(p, s, 'Z1-wide'); assert.equal(duplicate.body.sceneCaptures.length, 1);
  for (const seed of [2, 3]) assert.equal((await f.capture(p, s, 'Z1-wide', { imageDataUrl: jpegFixture(seed) })).status, 200);
  const over = await f.capture(p, s, 'Z1-wide', { imageDataUrl: jpegFixture(4) }); assert.equal(over.status, 409); assert.equal(over.body.error, 'capture_view_limit');
  assert.equal((await f.request(`/projects/${p.id}`)).body.sceneCaptures.length, 3);
});

test('capture storage count cap preserves every previous photo', async t => {
  const f = await sceneFixture(t); const { p, s } = f;
  const file = join(f.dir, 'projects.json'); const db = JSON.parse(await readFile(file, 'utf8'));
  db.projects[0].sceneCaptures = Array.from({ length: 72 }, (_, index) => ({ id: `past-${index}`, viewId: 'Z1-wide', projectRevision: 0, imageDataUrl: jpegFixture(), bytes: 28 }));
  await writeFile(file, JSON.stringify(db));
  const result = await f.capture(p, s, 'Z2-wide'); assert.equal(result.status, 409); assert.equal(result.body.error, 'capture_storage_limit');
  assert.equal((await f.request(`/projects/${p.id}`)).body.sceneCaptures.length, 72);
});

test('object issues retain client-reported identity and block current visual and space approval', async t => {
  const f = await sceneFixture(t); let p = await captureAndReviewAll(f);
  await f.decide(p, 'source'); await f.decide(p, 'assets'); const normal = await f.session(p); await f.event(p, normal); await f.decide(p, 'space');
  const result = await f.objectIssue(p, f.s); assert.equal(result.status, 200); p = result.body;
  assert.equal(p.objectIssues[0].object.name, '바위'); assert.equal(p.objectIssues[0].object.identityVerified, false); assert.equal(p.objectIssues[0].clientReported, true);
  assert.equal(p.gateStatus.assets.status, 'pending'); assert.equal(p.gateStatus.space.status, 'pending');
  assert.ok(p.gateStatus.assets.blockers.some(value => value.code === 'object_issues_unresolved'));
  assert.equal((await f.decide(p, 'assets')).status, 422); assert.equal((await f.decide(p, 'space')).status, 422);
  assert.equal((await f.objectIssue(p, f.s)).body.objectIssues.length, 1);
  const next = await f.request(`/projects/${p.id}`, 'PATCH', { expectedRevision: 1 });
  assert.equal(next.body.objectIssues.length, 1); assert.ok(!next.body.gateStatus.space.blockers.some(value => value.code === 'object_issues_unresolved'));
});

test('object issues reject stale reference normal unready sessions and unbounded selections', async t => {
  const f = await sceneFixture(t); const { p, s } = f;
  const normal = await f.session(p); await f.event(p, normal);
  assert.equal((await f.objectIssue(p, normal)).status, 422);
  const unready = await f.session(p, 'space', 'diagnostic'); assert.equal((await f.objectIssue(p, unready)).status, 422);
  assert.equal((await f.objectIssue(p, s, { gameRevision: 'old-game' })).status, 409);
  assert.equal((await f.objectIssue(p, s, { note: '' })).status, 400);
  assert.equal((await f.objectIssue(p, s, { disposition: 'approved' })).status, 400);
  assert.equal((await f.objectIssue(p, s, { object: { position: [1e9, 0, 0] } })).status, 400);
  assert.equal((await f.objectIssue(p, s, { object: { position: [0, 0, 0], instanceId: -1 } })).status, 400);
  assert.equal((await f.objectIssue(p, s, { object: { position: [0, 0, 0], name: 'x'.repeat(9000) } })).status, 400);
  const reference = await f.create({ runtimeUse: 'reference' }); const rs = await f.session(reference, 'space', 'diagnostic'); await f.event(reference, rs);
  const denied = await f.objectIssue(reference, rs); assert.equal(denied.status, 422); assert.equal(denied.body.error, 'runtime_reference_only');
  const next = (await f.request(`/projects/${p.id}`, 'PATCH', { expectedRevision: 1 })).body;
  assert.equal((await f.objectIssue(next, s)).status, 422);
});

test('bootstrap policy and imported text persist without interpretation', async t => {
  const f = await fixture(t);
  const info = await f.request('/bootstrap');
  assert.deepEqual(info.body.reviewPolicy.requiredChecks, REQUIRED_CHECKS);
  const p = await f.create({ sourceText: '<script>alert(1)</script>\n원문' });
  assert.equal(p.sourceText, '<script>alert(1)</script>\n원문');
  assert.equal((await f.request(`/projects/${p.id}`)).body.sourceText, p.sourceText);
  const persisted = JSON.parse(await readFile(join(f.dir, 'projects.json'), 'utf8'));
  assert.equal(persisted.projects[0].id, p.id);
  assert.equal((await f.request('/projects')).body.length, 1);
});

test('a new tale defaults to no case or runtime and reviews source plus GLBs independently', async t => {
  const f = await fixture(t);
  const result = await f.request('/projects', 'POST', { title: '새 설화', sourceText: '다른 지역에서 입력한 설화', synopsis: '직접 작성한 새 시놉시스', selectedAssetIds: ['boat'] });
  assert.equal(result.status, 201); const p = result.body;
  assert.equal(p.caseId, ''); assert.equal(p.runtimeId, null); assert.equal(p.runtimeUse, null); assert.equal(p.gameRevision, null);
  assert.match(p.sourceRevision, /^[a-f0-9]{64}$/); assert.equal(p.referenceSnapshot.game, null); assert.deepEqual(p.referenceSnapshot.documents, []);
  f.data.gameRevision = 'unrelated-game-change'; f.data.sourceRevision = 'unrelated-document-change';
  assert.equal((await f.decide(p, 'source')).status, 200);
  assert.equal((await f.inspect(p)).status, 200);
  const assets = await f.decide(p, 'assets'); assert.equal(assets.status, 200);
  assert.equal(assets.body.gateStatus.source.status, 'approved'); assert.deepEqual(assets.body.currentValidity, { source: true, game: true });
  const session = await f.request(`/projects/${p.id}/sessions`, 'POST', { expectedRevision: 1, kind: 'space', mode: 'normal' });
  assert.equal(session.status, 422); assert.equal(session.body.error, 'runtime_required');
  const space = await f.decide(p, 'space'); assert.equal(space.status, 422);
  assert.ok(space.body.blockers.some(b => b.code === 'runtime_required'));
  assert.equal((await f.decide(p, 'play', 'held')).status, 200);
});

test('arbitrary case codes are independent from explicit target runtime selection', async t => {
  const f = await fixture(t); const p = await f.create({ caseId: 'JEJU-새설화-02', title: '새 설화의 시험 공간', runtimeId: 'NAJU-01', runtimeUse: 'target' });
  assert.equal(p.caseId, 'JEJU-새설화-02'); assert.equal(p.runtimeId, 'NAJU-01');
  await f.decide(p, 'source'); await f.inspect(p); await f.decide(p, 'assets');
  const s = await f.session(p); await f.event(p, s);
  const result = await f.decide(p, 'space'); assert.equal(result.status, 200);
  assert.equal(result.body.decisions.at(-1).runtimeUse, 'target');
});

test('selecting a runtime without a use defaults to reference and its ready event cannot approve space', async t => {
  const f = await fixture(t);
  const result = await f.request('/projects', 'POST', { title: '다른 설화', sourceText: '다른 설화의 원문', caseId: 'TALE-2', synopsis: '다른 이야기', sceneNotes: '새 게임 구성', selectedAssetIds: ['boat'], runtimeId: 'NAJU-01' });
  assert.equal(result.status, 201); const p = result.body; assert.equal(p.runtimeUse, 'reference');
  await f.decide(p, 'source'); await f.inspect(p); await f.decide(p, 'assets');
  const s = await f.session(p); assert.equal(s.runtimeUse, 'reference'); await f.event(p, s);
  const space = await f.decide(p, 'space'); assert.equal(space.status, 422);
  assert.ok(space.body.blockers.some(b => b.code === 'runtime_reference_only'));
  f.data.gameRevision = 'reference-changed'; f.data.sourceRevision = 'reference-docs-changed';
  const reread = (await f.request(`/projects/${p.id}`)).body;
  assert.equal(reread.gateStatus.source.status, 'approved'); assert.equal(reread.gateStatus.assets.status, 'approved');
  assert.equal((await f.inspect(p)).status, 200);
  assert.equal((await f.event(p, s)).status, 409);
});

test('no runtime and reference runtimes cannot validate palette observations', async t => {
  const f = await fixture(t);
  for (const runtimeId of [null, 'NAJU-01']) {
    const p = await f.create({ caseId: 'OTHER', runtimeId, runtimeUse: runtimeId ? 'reference' : null, selectedAssetIds: ['ground'] });
    await f.decide(p, 'source');
    let s = { id: 'missing-session' };
    if (runtimeId) { s = await f.session(p); await f.event(p, s); }
    const observation = await f.observe(p, s); assert.equal(observation.status, 422);
    assert.equal(observation.body.error, runtimeId ? 'runtime_reference_only' : 'runtime_required');
    const assets = await f.decide(p, 'assets'); assert.equal(assets.status, 422);
    assert.ok(assets.body.blockers.some(b => b.code === (runtimeId ? 'runtime_reference_only' : 'runtime_required')));
  }
});

test('runtime binding edits invalidate old approvals and sessions and preserve association history', async t => {
  const f = await fixture(t); const p = await f.create(); await f.decide(p, 'source');
  const s = await f.session(p); await f.event(p, s);
  const result = await f.request(`/projects/${p.id}`, 'PATCH', { expectedRevision: 1, caseId: '독립설화', runtimeId: null, runtimeUse: null });
  assert.equal(result.status, 200); const unlinked = result.body;
  assert.equal(unlinked.runtimeId, null); assert.equal(unlinked.gameRevision, null); assert.equal(unlinked.gateStatus.source.status, 'pending');
  assert.equal(unlinked.history[0].previousSnapshot.editable.runtimeId, 'NAJU-01');
  assert.equal(unlinked.history[0].previousSnapshot.editable.runtimeUse, 'target');
  assert.equal((await f.event(p, s)).status, 409);
  const linked = await f.request(`/projects/${p.id}`, 'PATCH', { expectedRevision: 2, runtimeId: 'NAJU-01' });
  assert.equal(linked.body.runtimeUse, 'reference'); assert.equal(linked.body.caseId, '독립설화');
  const target = await f.request(`/projects/${p.id}`, 'PATCH', { expectedRevision: 3, runtimeUse: 'target' });
  assert.equal(target.body.runtimeUse, 'target'); assert.equal(target.body.sourceRevision, f.data.sourceRevision);
});

test('legacy projects and sessions without runtime fields retain Naju target behavior', async t => {
  const f = await fixture(t); const p = await f.create(); await f.decide(p, 'source'); await f.inspect(p); await f.decide(p, 'assets');
  const s = await f.session(p); await f.event(p, s);
  const file = join(f.dir, 'projects.json'); const db = JSON.parse(await readFile(file, 'utf8'));
  delete db.projects[0].runtimeId; delete db.projects[0].runtimeUse;
  delete db.projects[0].sessions[0].runtimeId; delete db.projects[0].sessions[0].runtimeUse;
  await writeFile(file, JSON.stringify(db));
  const read = (await f.request(`/projects/${p.id}`)).body;
  assert.equal(read.runtimeId, 'NAJU-01'); assert.equal(read.runtimeUse, 'target'); assert.equal(read.gateStatus.assets.status, 'approved');
  assert.equal(read.sessions[0].runtimeId, 'NAJU-01'); assert.equal(read.sessions[0].runtimeUse, 'target');
  assert.equal((await f.decide(read, 'space')).status, 200);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.projects[0].runtimeId, 'NAJU-01');
});

test('runtime registry rejects unknown ids and does not imply registration from tale code', async t => {
  const f = await fixture(t);
  const input = { title: '새 설화', sourceText: '본문', caseId: 'NAJU-01' };
  assert.equal((await f.request('/projects', 'POST', { ...input, runtimeId: 'invented', runtimeUse: 'target' })).status, 400);
  const noRuntime = await f.request('/projects', 'POST', input); assert.equal(noRuntime.body.runtimeId, null);
  f.data.runtimes = [];
  assert.equal((await f.request('/projects', 'POST', { ...input, runtimeId: 'NAJU-01' })).status, 400);
});

test('public runtime sessions bind profile and wait for all public models to be applied', async t => {
  const f = await fixture(t);
  Object.assign(f.data.game, { profile: 'naju-public-sf-v1', url: '/naju01/?review=1&aihub=&src=sf&r=15', presentation: '공개 에셋 교체', available: true });
  const p = await f.create();
  assert.equal(p.referenceSnapshot.game.profile, 'naju-public-sf-v1'); assert.equal(p.referenceSnapshot.game.url, f.data.game.url);
  await f.decide(p, 'source'); await f.inspect(p); await f.decide(p, 'assets');
  const s = await f.session(p); assert.equal(s.runtimeProfile, 'naju-public-sf-v1');
  assert.equal((await f.event(p, s)).status, 409);
  assert.equal((await f.event(p, s, [{ type: 'ready', detail: { runtimeProfile: 'naju-base-v1' } }])).status, 409);
  assert.equal((await f.event(p, s, [{ type: 'ready', detail: { runtimeProfile: s.runtimeProfile } }])).status, 422);
  const detail = { runtimeProfile: s.runtimeProfile, assetLoadState: 'public-assets-loaded-and-applied', publicAssets: { source: 'sf', phase: 'applied', total: 3, loaded: 2, failed: 0 } };
  assert.equal((await f.event(p, s, [{ type: 'ready', detail }])).status, 422);
  assert.equal((await f.decide(p, 'space')).status, 422);
  detail.publicAssets.loaded = 3;
  assert.equal((await f.event(p, s, [{ type: 'ready', detail }])).status, 200);
  assert.equal((await f.decide(p, 'space')).status, 200);
  assert.equal((await f.request(`/projects/${p.id}`)).body.sessions[0].events.length, 1);
});

test('unavailable public manifests block sessions and space approval without blocking independent tale entry', async t => {
  const f = await fixture(t);
  Object.assign(f.data.game, { profile: 'naju-public-sf-v1', available: false, reviewBlockers: ['rock/missing.glb: 파일 없음'] });
  const p = await f.create(); assert.equal((await f.decide(p, 'source')).status, 200);
  const result = await f.request(`/projects/${p.id}/sessions`, 'POST', { expectedRevision: 1, kind: 'space', mode: 'normal' });
  assert.equal(result.status, 422); assert.equal(result.body.error, 'runtime_unavailable');
  const space = await f.decide(p, 'space'); assert.equal(space.status, 422);
  assert.ok(space.body.blockers.some(blocker => blocker.code === 'runtime_unavailable'));
  const unlinked = await f.create({ runtimeId: null, runtimeUse: null });
  assert.equal((await f.decide(unlinked, 'source')).status, 200);
  assert.equal((await f.inspect(unlinked)).status, 200);
  assert.equal((await f.decide(unlinked, 'assets')).status, 200);
});

test('new base sessions require profile identity while older profileless sessions remain compatible', async t => {
  const f = await fixture(t); const p = await f.create(); const legacy = await f.session(p);
  f.data.game.profile = 'naju-base-v1';
  assert.equal((await f.event(p, legacy)).status, 200);
  const fresh = await f.session(p); assert.equal(fresh.runtimeProfile, 'naju-base-v1');
  assert.equal((await f.event(p, fresh)).status, 409);
  assert.equal((await f.event(p, fresh, [{ type: 'ready', detail: { runtimeProfile: 'naju-base-v1' } }])).status, 200);
  f.data.game.profile = 'naju-public-sf-v1';
  assert.equal((await f.event(p, fresh, [{ type: 'metrics', detail: { runtimeProfile: 'naju-base-v1' } }])).status, 409);
  f.data.game.profile = 'unknown-profile';
  const rejected = await f.request(`/projects/${p.id}/sessions`, 'POST', { expectedRevision: 1, kind: 'space', mode: 'normal' });
  assert.equal(rejected.status, 422); assert.equal(rejected.body.error, 'runtime_profile_unknown');
});

test('approval gates enforce sequence, human checks and real loading evidence', async t => {
  const f = await fixture(t); const p = await f.create();
  assert.equal((await f.decide(p, 'assets')).status, 422);
  assert.equal((await f.decide(p, 'source', 'approved', { checks: [] })).status, 422);
  assert.equal((await f.decide(p, 'source')).status, 200);
  assert.equal((await f.decide(p, 'assets')).status, 422);
  assert.equal((await f.inspect(p)).status, 200);
  assert.equal((await f.decide(p, 'assets')).status, 200);
  assert.equal((await f.decide(p, 'space')).status, 422);
  const s = await f.session(p); assert.equal((await f.event(p, s)).status, 200);
  const done = await f.decide(p, 'space'); assert.equal(done.status, 200);
  assert.equal(done.body.gateStatus.space.status, 'approved');
  assert.equal(done.body.revision, 1);
});

test('greybox runtime never allows play approval despite forged success events', async t => {
  const f = await fixture(t); const p = await f.create();
  await f.decide(p, 'source'); await f.inspect(p); await f.decide(p, 'assets');
  const s = await f.session(p, 'play');
  await f.event(p, s, [{ type: 'ready' }, { type: 'interaction' }, { type: 'completed' }]);
  await f.decide(p, 'space');
  const result = await f.decide(p, 'play');
  assert.equal(result.status, 422);
  assert.ok(result.body.blockers.some(b => b.code === 'runtime_puzzles_unavailable'));
  assert.equal((await f.decide(p, 'play', 'held')).status, 200);
});

test('reject and hold work before prerequisite approvals and require reasons', async t => {
  const f = await fixture(t); const p = await f.create();
  assert.equal((await f.decide(p, 'play', 'rejected', { note: '', checks: [] })).status, 400);
  const result = await f.decide(p, 'play', 'rejected', { checks: [] });
  assert.equal(result.status, 200); assert.equal(result.body.gateStatus.play.status, 'rejected');
  assert.equal((await f.decide(p, 'assets', 'held', { checks: [] })).status, 200);
});

test('PATCH makes a new revision, preserves history and invalidates every decision', async t => {
  const f = await fixture(t); const p = await f.create();
  await f.decide(p, 'source'); const s = await f.session(p);
  const patched = await f.request(`/projects/${p.id}`, 'PATCH', { expectedRevision: 1, sceneNotes: '변경된 공간 검수 기준' });
  assert.equal(patched.status, 200); assert.equal(patched.body.revision, 2);
  assert.equal(patched.body.gateStatus.source.status, 'pending');
  assert.equal(patched.body.decisions[0].decision, 'approved');
  assert.ok(patched.body.decisions[0].invalidatedAt);
  assert.equal(patched.body.history.length, 1);
  assert.equal((await f.event(p, s)).status, 409);
  assert.equal((await f.decide(p, 'source')).status, 409);
  assert.equal((await f.decide(patched.body, 'source')).status, 200);
});

test('revision history retains exact old input and lightweight file manifests', async t => {
  const f = await fixture(t); const p = await f.create();
  const originalReferences = structuredClone(p.referenceSnapshot);
  assert.deepEqual(originalReferences.game.files, f.data.game.files);
  assert.equal(originalReferences.documents[0].text, undefined);
  f.data.gameRevision = 'game-v2'; f.data.game.files[0].sha256 = 'app-v2';
  f.data.sourceRevision = 'source-v2'; f.data.documents[0].sha256 = 'story-v2';
  f.data.assets[0].sha256 = 'boat-v2';
  const result = await f.request(`/projects/${p.id}`, 'PATCH', {
    expectedRevision: 1, title: '수정 제목', sourceText: '수정 설화\n\n공백 유지', sourceName: '수정.txt',
    synopsis: '수정 시놉시스', sceneNotes: '수정 씬', selectedAssetIds: ['ground'],
  });
  assert.equal(result.status, 200);
  const snapshot = result.body.history[0].previousSnapshot;
  for (const key of ['caseId', 'title', 'sourceText', 'sourceName', 'synopsis', 'sceneNotes', 'selectedAssetIds']) assert.deepEqual(snapshot.editable[key], p[key]);
  assert.equal(snapshot.revision, 1); assert.equal(snapshot.sourceRevision, 'source-v1'); assert.equal(snapshot.gameRevision, 'game-v1');
  assert.match(snapshot.inputHash, /^[a-f0-9]{64}$/); assert.match(snapshot.sourceTextSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(snapshot.referenceSnapshot, originalReferences);
  assert.equal(result.body.referenceSnapshot.game.files[0].sha256, 'app-v2');
  assert.equal(result.body.referenceSnapshot.documents[0].sha256, 'story-v2');
  assert.deepEqual(result.body.referenceSnapshot.assets.map(a => a.id), ['ground']);
  const next = await f.request(`/projects/${p.id}`, 'PATCH', { expectedRevision: 2, title: '세번째 제목' });
  assert.deepEqual(next.body.history[0].previousSnapshot, snapshot);
  assert.equal(next.body.history[1].previousSnapshot.editable.sourceText, '수정 설화\n\n공백 유지');
});

test('unsupported project actions fail before revision checks without mutating records', async t => {
  const f = await fixture(t); const p = await f.create();
  assert.equal((await f.request(`/projects/${p.id}`, 'POST', {})).status, 405);
  assert.equal((await f.request(`/projects/${p.id}`, 'POST', { expectedRevision: 1 })).status, 405);
  assert.equal((await f.request(`/projects/${p.id}/decisions`, 'PATCH', { expectedRevision: 1 })).status, 405);
  assert.equal((await f.request(`/projects/${p.id}`)).body.revision, 1);
});

test('concurrent conflicting decisions serialize and only one wins', async t => {
  const f = await fixture(t); const p = await f.create();
  const results = await Promise.all([f.decide(p, 'source'), f.decide(p, 'source', 'rejected')]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await f.request(`/projects/${p.id}`)).body.decisions.length, 1);
});

test('stale PATCH conflict cannot overwrite a newer edit', async t => {
  const f = await fixture(t); const p = await f.create();
  const results = await Promise.all(['첫째', '둘째'].map(title => f.request(`/projects/${p.id}`, 'PATCH', { expectedRevision: 1, title })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await f.request(`/projects/${p.id}`)).body.revision, 2);
});

test('session token exposed only once and never stored as plaintext', async t => {
  const f = await fixture(t); const p = await f.create(); const s = await f.session(p);
  assert.ok(s.token.length >= 40); assert.equal(s.tokenHash, undefined);
  assert.equal((await f.request(`/projects/${p.id}/sessions/${s.id}/events`, 'POST', { token: 'bad', events: [{ type: 'ready' }] })).status, 403);
  await f.event(p, s);
  const result = await f.request(`/projects/${p.id}`);
  assert.equal(result.body.sessions[0].token, undefined); assert.equal(result.body.sessions[0].tokenHash, undefined);
  assert.equal((await readFile(join(f.dir, 'projects.json'), 'utf8')).includes(s.token), false);
});

test('event delivery deduplicates stable IDs and records server timestamp', async t => {
  const f = await fixture(t); const p = await f.create(); const s = await f.session(p);
  const events = [{ id: 'ready-1', type: 'ready', at: '2020-01-01', detail: { gameRevision: 'game-v1' } }];
  assert.equal((await f.event(p, s, events)).body.accepted, 1);
  assert.equal((await f.event(p, s, events)).body.accepted, 0);
  const saved = (await f.request(`/projects/${p.id}`)).body.sessions[0].events[0];
  assert.equal(saved.clientAt, '2020-01-01'); assert.notEqual(saved.at, saved.clientAt);
});

test('game or source drift blocks approval and refreshes only with new revision', async t => {
  const f = await fixture(t); const p = await f.create();
  await f.decide(p, 'source'); f.data.gameRevision = 'game-v2';
  const current = (await f.request(`/projects/${p.id}`)).body;
  assert.equal(current.gateStatus.source.status, 'stale');
  const decision = await f.decide(p, 'assets'); assert.equal(decision.status, 422);
  assert.ok(decision.body.blockers.some(b => b.code === 'input_drift'));
  const refreshed = await f.request(`/projects/${p.id}`, 'PATCH', { expectedRevision: 1 });
  assert.equal(refreshed.body.gameRevision, 'game-v2');
  assert.equal(refreshed.body.gateStatus.source.status, 'pending');
  f.data.sourceRevision = 'source-v2';
  assert.equal((await f.decide(refreshed.body, 'source')).status, 422);
});

test('procedural assets need actual rendered game; failed model load blocks approval', async t => {
  const f = await fixture(t); const p = await f.create({ selectedAssetIds: ['boat', 'ground'] });
  await f.decide(p, 'source'); await f.inspect(p, 'failed');
  assert.equal((await f.decide(p, 'assets')).status, 422);
  await f.inspect(p, 'loaded'); assert.equal((await f.decide(p, 'assets')).status, 422);
  const s = await f.session(p); await f.event(p, s);
  assert.equal((await f.decide(p, 'assets')).status, 422);
  assert.equal((await f.observe(p, s)).status, 200);
  assert.equal((await f.decide(p, 'assets')).status, 200);
});

test('diagnostic rendering cannot approve procedural assets or space', async t => {
  const f = await fixture(t); const p = await f.create({ selectedAssetIds: ['ground'] });
  await f.decide(p, 'source');
  const diagnostic = await f.session(p, 'space', 'diagnostic'); await f.event(p, diagnostic);
  assert.equal((await f.observe(p, diagnostic)).status, 422);
  const assets = await f.decide(p, 'assets'); assert.equal(assets.status, 422);
  assert.ok(assets.body.blockers.some(b => b.code === 'asset_unseen'));
  const space = await f.decide(p, 'space'); assert.equal(space.status, 422);
  assert.ok(space.body.blockers.some(b => b.code === 'space_session_required'));
  const normal = await f.session(p, 'space', 'normal'); await f.event(p, normal);
  assert.equal((await f.observe(p, normal)).status, 200);
  assert.equal((await f.decide(p, 'assets')).status, 200);
  assert.equal((await f.decide(p, 'space')).status, 200);
});

test('one palette observation cannot stand in for another selected asset', async t => {
  const f = await fixture(t);
  f.data.assets.push({ id: 'ground2', type: 'procedural', sha256: 'ground2-v1', name: '두번째 바닥' });
  const p = await f.create({ selectedAssetIds: ['ground', 'ground2'] }); await f.decide(p, 'source');
  const s = await f.session(p); await f.event(p, s);
  assert.equal((await f.observe(p, s, 'ground')).status, 200);
  const blocked = await f.decide(p, 'assets'); assert.equal(blocked.status, 422);
  assert.ok(blocked.body.blockers.some(b => b.message.startsWith('두번째 바닥')));
  assert.equal((await f.observe(p, s, 'ground2')).status, 200);
  assert.equal((await f.decide(p, 'assets')).status, 200);
});

test('palette observations need a current normal rendered session and a human note', async t => {
  const f = await fixture(t); const p = await f.create({ selectedAssetIds: ['ground'] });
  const s = await f.session(p);
  assert.equal((await f.observe(p, s)).status, 422);
  await f.event(p, s);
  assert.equal((await f.observe(p, s, 'ground', { note: '' })).status, 400);
  assert.equal((await f.observe(p, s, 'ground', { status: 'loaded' })).status, 400);
  assert.equal((await f.observe(p, s)).status, 200);
  const next = (await f.request(`/projects/${p.id}`, 'PATCH', { expectedRevision: 1 })).body;
  assert.equal((await f.observe(next, s)).status, 422);
});

test('inspection fingerprints bind the actual loaded model to current game and source', async t => {
  const f = await fixture(t); const p = await f.create();
  assert.equal((await f.inspect(p, 'loaded', { assetSha256: undefined })).status, 409);
  assert.equal((await f.inspect(p, 'loaded', { gameRevision: 'old-game' })).status, 409);
  assert.equal((await f.inspect(p, 'loaded', { assetSha256: 'old-boat' })).status, 409);
  assert.equal((await f.inspect(p, 'observed')).status, 400);
  assert.equal((await f.inspect(p)).status, 200);
  f.data.assets[0].sha256 = 'boat-v2';
  assert.equal((await f.inspect(p)).status, 409);
  f.data.assets[0].sha256 = 'boat-v1'; f.data.gameRevision = 'game-v2';
  assert.equal((await f.inspect(p)).status, 409);
  f.data.gameRevision = 'game-v1'; f.data.sourceRevision = 'source-v2';
  assert.equal((await f.inspect(p)).status, 409);
  assert.equal((await f.request(`/projects/${p.id}`)).body.inspections.length, 1);
});

test('a later session failure invalidates its palette observation approval', async t => {
  const f = await fixture(t); const p = await f.create({ selectedAssetIds: ['ground'] });
  await f.decide(p, 'source'); const s = await f.session(p); await f.event(p, s); await f.observe(p, s);
  assert.equal((await f.decide(p, 'assets')).status, 200);
  await f.event(p, s, [{ type: 'error', detail: { reason: 'render failed' } }]);
  const result = (await f.request(`/projects/${p.id}`)).body;
  assert.equal(result.gateStatus.assets.status, 'stale');
  assert.ok(result.gateStatus.assets.blockers.some(b => b.code === 'asset_unseen'));
});

test('a later model loading failure makes existing and downstream approvals ineffective', async t => {
  const f = await fixture(t); const p = await f.create();
  await f.decide(p, 'source'); await f.inspect(p); await f.decide(p, 'assets');
  const s = await f.session(p); await f.event(p, s); await f.decide(p, 'space');
  await f.inspect(p, 'failed');
  const result = (await f.request(`/projects/${p.id}`)).body;
  assert.equal(result.gateStatus.assets.status, 'stale');
  assert.equal(result.gateStatus.space.status, 'stale');
  assert.ok(result.gateStatus.space.blockers.some(b => b.code === 'upstream_stale'));
});

test('normal interaction requirements survive future puzzle capability enablement', async t => {
  const f = await fixture(t); f.data.game.capabilities.puzzlePlay = true;
  const p = await f.create(); await f.decide(p, 'source'); await f.inspect(p); await f.decide(p, 'assets');
  const diagnostic = await f.session(p, 'play', 'diagnostic'); await f.event(p, diagnostic, [{ type: 'ready' }, { type: 'interaction' }]);
  assert.equal((await f.decide(p, 'space')).status, 422); assert.equal((await f.decide(p, 'play')).status, 422);
  const normal = await f.session(p, 'play', 'normal'); await f.event(p, normal, [{ type: 'ready' }, { type: 'navigation' }]);
  assert.equal((await f.decide(p, 'space')).status, 200);
  assert.equal((await f.decide(p, 'play')).status, 422);
  await f.event(p, normal, [{ type: 'interaction' }]);
  assert.equal((await f.decide(p, 'play')).status, 200);
});

test('loopback and same-origin protections reject cross-site writes and DNS rebinding hosts', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/projects', 'POST', {}, { Origin: 'https://evil.example' })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(f.base + '/__review/bootstrap', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(hostStatus, 403);
  assert.equal((await f.request('/projects', 'POST', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await f.request('/projects', 'POST', {}, { 'Content-Type': 'text/plain' })).status, 415);
});

test('source, asset and observation bounds reject invalid inputs', async t => {
  const f = await fixture(t);
  const base = { title: '나주', sourceText: '설화', caseId: 'NAJU-01' };
  assert.equal((await f.request('/projects', 'POST', { ...base, sourceText: 'x'.repeat(400001) })).status, 400);
  assert.equal((await f.request('/projects', 'POST', { ...base, selectedAssetIds: ['missing'] })).status, 400);
  assert.equal((await f.request('/projects', 'POST', { ...base, caseId: 42 })).status, 400);
  const p = await f.create(); const s = await f.session(p);
  assert.equal((await f.event(p, s, Array(31).fill({ type: 'ready' }))).status, 400);
  assert.equal((await f.event(p, s, [{ type: 'made-up' }])).status, 400);
  assert.equal((await f.event(p, s, [{ type: 'ready', detail: { text: 'x'.repeat(13000) } }])).status, 400);
  assert.equal((await f.event(p, s, [{ type: 'ready', detail: { gameRevision: 'wrong' } }])).status, 409);
});

test('Vite plugin is dev-only and prevents direct reads of local persisted data', () => {
  const plugin = reviewWorkbenchPlugin(); const handlers = [];
  assert.equal(plugin.apply, 'serve');
  plugin.configureServer({ middlewares: { use: fn => handlers.push(fn) } });
  for (const url of ['/.local/review/projects.json', '/@fs/project/.local/review/projects.json', '/%2elocal/review/projects.json']) {
    const response = { end() {} }; let next = false;
    handlers[0]({ url }, response, () => { next = true; });
    assert.equal(response.statusCode, 404); assert.equal(next, false);
  }
});

// 검수 배치 변경안(10/15) — 임시 저장소 뿌리에 _sf_local 공개 GLB 와 manifest 를 만든다
function glbFixture(nodeScaleY = 2) {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ children: [1], scale: [1, nodeScaleY, 1] }, { mesh: 0, translation: [0, 5, 0] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ componentType: 5126, count: 3, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }] }));
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, padded]);
}
const baseManifest = { 설명: '시험', 바꿔치기: [], 놓기: [{ file: 'rock/stone21.glb', 키m: 3.6, 묻힘m: 0.8, 자리: [[32.9, 21.8, 20, 1]], 메모: '기존' }], 검수: {} };
async function placementRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'kgeseo-review-root-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'public/_sf_local/prop'), { recursive: true }); await mkdir(join(root, 'public/_sf_local/rock'), { recursive: true });
  await writeFile(join(root, 'public/_sf_local/prop/jar.glb'), glbFixture());
  await writeFile(join(root, 'public/_sf_local/rock/stone21.glb'), glbFixture(1));
  await mkdir(join(root, 'public/_sf_local/AI허브'), { recursive: true }); await writeFile(join(root, 'public/_sf_local/AI허브/x.glb'), glbFixture());
  await symlink(join(root, 'public/_sf_local/prop/jar.glb'), join(root, 'public/_sf_local/prop/link.glb'));
  await writeFile(join(root, 'public/_sf_local/manifest.json'), `${JSON.stringify(baseManifest, null, 2)}\n`);
  return root;
}
const jarAsset = (extra = {}) => ({ id: 'public:prop/jar.glb', nameKo: '항아리', source: 'public', url: '/_sf_local/prop/jar.glb', ...extra });
const place = (f, p, s, extra = {}) => f.request(`/projects/${p.id}/placements`, 'POST', { expectedRevision: p.revision, sessionId: s.id, gameRevision: p.gameRevision, sceneNo: 2, zoneId: 'Z2', asset: jarAsset(), position: { x: 150.25, y: 3.1, z: 120.5 }, rotationY: -30, scale: 1.5, groundY: 3.2, reviewer: '검수자', note: '바위 아래 빈 자리', ...extra });

test('regenerate disposition records a generation request and blocks visual and space approval like other issues', async t => {
  const f = await sceneFixture(t); let p = await captureAndReviewAll(f);
  assert.equal((await f.objectIssue(p, f.s, { disposition: 'regenerate', sceneNo: 9 })).status, 400);
  const result = await f.objectIssue(p, f.s, { disposition: 'regenerate', sceneNo: 2, note: '형태가 시대와 맞지 않음. 새로 생성 요청' });
  assert.equal(result.status, 200); p = result.body;
  assert.equal(p.objectIssues[0].disposition, 'regenerate'); assert.equal(p.objectIssues[0].sceneNo, 2);
  assert.equal(p.regenerationRequests.length, 1); assert.equal(p.regenerationRequests[0].id, p.objectIssues[0].id);
  assert.ok(p.gateStatus.assets.blockers.some(value => value.code === 'object_issues_unresolved'));
  assert.equal((await f.objectIssue(p, f.s, { disposition: 'regenerate', sceneNo: 2, note: '형태가 시대와 맞지 않음. 새로 생성 요청' })).body.objectIssues.length, 1);
  assert.equal((await f.objectIssue(p, f.s, { disposition: 'change_requested' })).body.regenerationRequests.length, 1);
});

test('placements validate public GLB paths, numbers and file identity, and can be withdrawn', async t => {
  const root = await placementRoot(t);
  const f = await sceneFixture(t, {}, { root }); const { p, s } = f;
  for (const asset of [jarAsset({ url: '/naju01/assets/models/a.glb' }), jarAsset({ url: '/_sf_local/AI허브/x.glb' }), jarAsset({ url: '/_sf_local/../manifest.json' }), jarAsset({ url: '/_sf_local/prop/jar.png' }), jarAsset({ source: 'catalog' }), jarAsset({ nameKo: '' })]) assert.equal((await place(f, p, s, { asset })).status, 400, JSON.stringify(asset));
  assert.equal((await place(f, p, s, { asset: jarAsset({ url: '/_sf_local/prop/none.glb' }) })).status, 422);
  assert.equal((await place(f, p, s, { asset: jarAsset({ url: '/_sf_local/prop/link.glb' }) })).status, 422);
  assert.equal((await place(f, p, s, { asset: jarAsset({ sha256: 'f'.repeat(64) }) })).status, 409);
  for (const extra of [{ position: { x: null, y: 0, z: 0 } }, { position: [1, 2, 3] }, { scale: 0 }, { scale: 99 }, { rotationY: 'x' }, { heightM: -1 }, { sceneNo: 6 }]) assert.equal((await place(f, p, s, extra)).status, 400, JSON.stringify(extra));
  assert.equal((await place(f, p, s, { gameRevision: 'old-game' })).status, 409);
  const normal = await f.session(p); await f.event(p, normal);
  assert.equal((await place(f, p, normal)).status, 422);
  const created = await place(f, p, s); assert.equal(created.status, 200);
  const [placement] = created.body.placements;
  const sha = createHash('sha256').update(await readFile(join(root, 'public/_sf_local/prop/jar.glb'))).digest('hex');
  assert.equal(placement.status, 'proposed'); assert.equal(placement.asset.sha256, sha); assert.equal(placement.asset.file, 'prop/jar.glb');
  assert.equal(placement.rotationY, 330); assert.equal(placement.heightM, 3); assert.equal(placement.heightSource, 'glb-bounds'); assert.equal(placement.sceneNo, 2);
  assert.deepEqual(created.body.currentPlacementIds, [placement.id]); assert.ok(created.body.decisionChecks.assets.includes('placements'));
  assert.equal((await place(f, p, s)).body.placements.length, 1);
  assert.equal((await place(f, p, s, { heightM: 0.8, position: { x: 1, y: 2, z: 3 } })).body.placements[1].heightM, 0.8);
  assert.equal((await f.request(`/projects/${p.id}/placements/${placement.id}/withdraw`, 'POST', { expectedRevision: p.revision, reviewer: '' })).status, 400);
  const withdrawn = await f.request(`/projects/${p.id}/placements/${placement.id}/withdraw`, 'POST', { expectedRevision: p.revision, reviewer: '검수자' });
  assert.equal(withdrawn.status, 200); assert.equal(withdrawn.body.placements[0].status, 'withdrawn'); assert.equal(withdrawn.body.currentPlacementIds.length, 1);
  assert.equal((await f.request(`/projects/${p.id}/placements/${placement.id}/withdraw`, 'POST', { expectedRevision: p.revision, reviewer: '검수자' })).status, 409);
  assert.equal((await f.request(`/projects/${p.id}/placements/${placement.id}/events`, 'POST', { expectedRevision: p.revision })).status, 404);
  assert.equal((await f.request(`/projects/${p.id}/sessions/${s.id}/withdraw`, 'POST', { expectedRevision: p.revision })).status, 404);
});

test('space approval applies current proposals to the manifest after recording approval and keeps a backup', async t => {
  const root = await placementRoot(t);
  const f = await sceneFixture(t, {}, { root });
  let p = (await place(f, f.p, f.s)).body;
  const placementId = p.placements[0].id;
  p = await captureAndReviewAll(f, p);
  assert.equal((await f.decide(p, 'source')).status, 200);
  const unchecked = await f.decide(p, 'assets'); assert.equal(unchecked.status, 422); assert.ok(unchecked.body.blockers.some(value => value.code === 'placements_check_required' && value.message.includes('1건')));
  assert.equal((await f.decide(p, 'assets', 'approved', { checks: [...REQUIRED_CHECKS.assets, 'placements'] })).status, 200);
  assert.equal((await f.decide(p, 'space', 'approved', { checks: [...REQUIRED_CHECKS.space, 'placements'] })).status, 400);
  const normal = await f.session(p); await f.event(p, normal);
  const before = await readFile(join(root, 'public/_sf_local/manifest.json'), 'utf8');
  const approved = await f.decide(p, 'space'); assert.equal(approved.status, 200);
  const manifest = JSON.parse(await readFile(join(root, 'public/_sf_local/manifest.json'), 'utf8'));
  assert.equal(manifest.놓기.length, 2); assert.deepEqual(Object.keys(manifest), Object.keys(baseManifest));
  const entry = manifest.놓기[1];
  assert.equal(entry.출처, `review:${placementId}`); assert.equal(entry.file, 'prop/jar.glb'); assert.equal(entry.키m, 3); assert.equal(entry.묻힘m, 0.1);
  assert.deepEqual(entry.자리, [[150.25, 120.5, 330, 1]]); assert.match(entry.메모, /항아리/);
  const backups = (await readdir(f.dir)).filter(name => name.startsWith('manifest_bak_'));
  assert.equal(backups.length, 1); assert.equal(await readFile(join(f.dir, backups[0]), 'utf8'), before);
  const after = approved.body;
  const decision = after.decisions.find(value => value.gate === 'space');
  assert.equal(decision.placementApply, 'applied'); assert.deepEqual(decision.placementIds, [placementId]);
  assert.equal(after.placements[0].status, 'applied'); assert.equal(after.placements[0].manifestEntryId, `review:${placementId}`); assert.ok(after.placements[0].appliedAt);
  assert.equal(after.history.at(-1).type, 'placements-applied'); assert.equal(after.history.at(-1).backup.split('/').at(-1), backups[0]);
  assert.equal(after.currentPlacementIds.length, 0);
  const reopened = (await f.request(`/projects/${p.id}`, 'PATCH', { expectedRevision: p.revision })).body;
  assert.equal(reopened.placements.length, 1); assert.equal(reopened.placements[0].status, 'applied');
  assert.equal(JSON.parse(await readFile(join(root, 'public/_sf_local/manifest.json'), 'utf8')).놓기.length, 2);
});

test('a changed placement file blocks space approval before anything is recorded and old revisions are never applied', async t => {
  const root = await placementRoot(t);
  const f = await sceneFixture(t, {}, { root });
  let p = (await place(f, f.p, f.s)).body;
  p = await captureAndReviewAll(f, p);
  await f.decide(p, 'source'); await f.decide(p, 'assets', 'approved', { checks: [...REQUIRED_CHECKS.assets, 'placements'] });
  const normal = await f.session(p); await f.event(p, normal);
  await writeFile(join(root, 'public/_sf_local/prop/jar.glb'), glbFixture(3));
  const blocked = await f.decide(p, 'space'); assert.equal(blocked.status, 422); assert.ok(blocked.body.blockers.some(value => value.code === 'placement_asset_changed'));
  const current = (await f.request(`/projects/${p.id}`)).body;
  assert.ok(!current.decisions.some(value => value.gate === 'space')); assert.equal(current.placements[0].status, 'proposed');
  assert.equal(JSON.parse(await readFile(join(root, 'public/_sf_local/manifest.json'), 'utf8')).놓기.length, 1);
  const reopened = (await f.request(`/projects/${p.id}`, 'PATCH', { expectedRevision: p.revision })).body;
  assert.equal(reopened.currentPlacementIds.length, 0); assert.ok(!reopened.decisionChecks.assets.includes('placements'));
  assert.equal((await f.request(`/projects/${p.id}/placements/${reopened.placements[0].id}/withdraw`, 'POST', { expectedRevision: reopened.revision, reviewer: '검수자' })).status, 409);
});

// ── AI 배치 초안 가져오기 · 변경안 고치기(규약 §6) ─────────────────────────────
async function importRoot(t) {
  const root = await placementRoot(t);
  await mkdir(join(root, 'naju01/src/plan'), { recursive: true });
  await writeFile(join(root, 'naju01/src/plan/sitePlan.ts'), await readFile(new URL('../../naju01/src/plan/sitePlan.ts', import.meta.url)));
  return root;
}
const importPlan = (f, p, items, extra = {}) => f.request(`/projects/${p.id}/placements/import`, 'POST', { origin: 'ai-draft', trialId: 'trial-0001', reviewer: 'AI 배치 초안', items, ...extra });
const draftItem = (extra = {}) => ({ assetId: 'public:prop/jar.glb', source: 'public', position: { x: 45, z: 35 }, rotationY: 0, scale: 1, sceneNo: 5, reqId: 'R-01', reason: '바위 아래 자갈밭 — 추락 흔적 근처에 깨진 항아리', ...extra });

test('ai-draft import validates each item like a placement plus scene/zone bounds and stores the rest as proposals', async t => {
  const root = await importRoot(t);
  const f = await fixture(t, { root }); const p = await f.create(); // 진단 세션 없이도 가져온다
  const items = [
    draftItem(),
    draftItem({ assetId: undefined, url: '/_sf_local/prop/jar.glb', position: { x: 20, y: 0.5, z: 35 }, rotationY: -90, scale: 2, sceneNo: 1, zoneId: 'Z1', reqId: 'R-02' }),
    draftItem({ sceneNo: 2, position: { x: 10, z: 10 }, reqId: 'R-out' }),
    draftItem({ sceneNo: 1, zoneId: 'Z3', position: { x: 40, z: 15 } }),
    draftItem({ assetId: undefined, url: '/_sf_local/AI허브/x.glb' }),
    draftItem({ assetId: undefined, url: '/_sf_local/prop/link.glb' }),
    draftItem({ assetId: 'catalog:jar_01' }),
    draftItem({ assetId: undefined, url: '/_sf_local/prop/jar.png' }),
    draftItem({ scale: 0 }),
    draftItem({ zoneId: 'Z9' }),
    draftItem({ sha256: 'f'.repeat(64) }),
    draftItem({ sceneNo: 0, position: { x: 90, z: 10 } }),
    'not-an-object',
  ];
  const result = await importPlan(f, p, items);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.accepted.length, 2);
  assert.deepEqual(result.body.rejected.map(value => value.index), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const codes = Object.fromEntries(result.body.rejected.map(value => [value.index, value.code]));
  assert.equal(codes[2], 'placement_out_of_bounds'); assert.equal(codes[3], 'zone_not_in_scene'); assert.equal(codes[4], 'asset_forbidden');
  assert.equal(codes[5], 'placement_asset_missing'); assert.equal(codes[6], 'asset_not_placeable'); assert.equal(codes[7], 'invalid_asset_url');
  assert.equal(codes[8], 'invalid_placement_number'); assert.equal(codes[9], 'unknown_zone'); assert.equal(codes[10], 'placement_asset_changed');
  assert.equal(codes[11], 'placement_out_of_bounds'); assert.equal(codes[12], 'invalid_item');
  assert.equal(result.body.rejected[0].reqId, 'R-out'); assert.ok(result.body.rejected.every(value => value.reason));
  const project = result.body.project;
  const [snap, given] = project.placements;
  const sha = createHash('sha256').update(await readFile(join(root, 'public/_sf_local/prop/jar.glb'))).digest('hex');
  assert.equal(snap.origin, 'ai-draft'); assert.equal(snap.trialId, 'trial-0001'); assert.equal(snap.reqId, 'R-01'); assert.match(snap.reason, /항아리/);
  assert.equal(snap.status, 'proposed'); assert.equal(snap.groundSnap, true); assert.equal(snap.position.y, null); assert.equal(snap.zoneId, 'Z2'); assert.equal(snap.sessionId, null);
  assert.equal(snap.asset.sha256, sha); assert.equal(snap.asset.file, 'prop/jar.glb'); assert.equal(snap.heightM, 2);
  assert.equal(given.groundSnap, false); assert.equal(given.position.y, 0.5); assert.equal(given.rotationY, 270); assert.equal(given.zoneId, 'Z1'); assert.equal(given.heightM, 4);
  assert.deepEqual(project.currentPlacementIds, result.body.accepted); assert.ok(project.decisionChecks.assets.includes('placements'));
  assert.equal(project.history.at(-1).type, 'placements-imported'); assert.equal(project.history.at(-1).rejectedCount, 11);
  // 같은 시행·자리 다시 가져오기 = 중복 → 넣을 것이 없으면 422 + rejected
  const again = await importPlan(f, project, [draftItem()]);
  assert.equal(again.status, 422); assert.equal(again.body.error, 'import_all_rejected'); assert.equal(again.body.rejected[0].code, 'placement_duplicate');
  // 조회 — origin 필터
  const drafts = await f.request(`/projects/${p.id}/placements?origin=ai-draft`);
  assert.equal(drafts.status, 200); assert.equal(drafts.body.placements.length, 2); assert.deepEqual(drafts.body.currentPlacementIds, result.body.accepted);
  assert.equal((await f.request(`/projects/${p.id}/placements?origin=human`)).body.placements.length, 0);
  assert.equal((await f.request(`/projects/${p.id}/placements?origin=robot`)).status, 400);
  assert.equal((await f.request(`/projects/${p.id}/placements/import`)).status, 405);
});

test('ai-draft import rejects bad envelopes, stale revisions and more than 300 items', async t => {
  const root = await importRoot(t);
  const f = await fixture(t, { root }); const p = await f.create();
  assert.equal((await importPlan(f, p, [draftItem()], { origin: 'human' })).status, 400);
  assert.equal((await importPlan(f, p, [draftItem()], { trialId: '' })).status, 400);
  assert.equal((await importPlan(f, p, [draftItem()], { reviewer: '' })).status, 400);
  assert.equal((await importPlan(f, p, [])).status, 400);
  assert.equal((await importPlan(f, p, 'items')).status, 400);
  const tooMany = await importPlan(f, p, Array.from({ length: 301 }, (_, index) => draftItem({ reqId: `R-${index}` })));
  assert.equal(tooMany.status, 413); assert.equal(tooMany.body.error, 'import_too_many');
  assert.equal((await importPlan(f, p, [draftItem()], { expectedRevision: p.revision + 1 })).status, 409);
  assert.equal((await importPlan(f, p, [draftItem()], { expectedRevision: p.revision })).status, 200);
  const unlinked = await f.create({ runtimeId: null, runtimeUse: null });
  assert.equal((await importPlan(f, unlinked, [draftItem()])).status, 422);
  assert.equal((await f.request(`/projects/${p.id}/decisions/import`, 'POST', { expectedRevision: p.revision })).status, 404);
  // 도면이 없으면 경계를 확인할 수 없어 가져오지 않는다
  await rm(join(root, 'naju01/src/plan/sitePlan.ts'));
  const noPlan = await importPlan(f, p, [draftItem({ reqId: 'R-x' })]);
  assert.equal(noPlan.status, 422); assert.equal(noPlan.body.error, 'site_plan_unavailable');
});

test('committing an edited proposal records a new placement and withdraws the old one in the same write', async t => {
  const root = await importRoot(t);
  const f = await sceneFixture(t, {}, { root });
  const imported = await importPlan(f, f.p, [draftItem()]); assert.equal(imported.status, 200);
  const oldId = imported.body.accepted[0]; const p = imported.body.project;
  assert.equal((await place(f, p, f.s, { replaces: '00000000-0000-0000-0000-000000000000' })).status, 404);
  const edited = await place(f, p, f.s, { replaces: oldId, sceneNo: 5, position: { x: 46, y: 1.2, z: 36 }, rotationY: 15, scale: 1, groundY: 1.1 });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const old = edited.body.placements.find(value => value.id === oldId);
  const next = edited.body.placements.find(value => value.id !== oldId);
  assert.equal(old.status, 'withdrawn'); assert.equal(old.replacedBy, next.id); assert.equal(old.withdrawnBy, '검수자'); assert.ok(old.withdrawnAt);
  assert.equal(next.status, 'proposed'); assert.equal(next.replaces, oldId); assert.equal(next.origin, 'human'); assert.equal(next.editedFrom, 'ai-draft');
  assert.equal(next.groundSnap, false); assert.equal(next.position.y, 1.2); assert.equal(next.reqId, 'R-01'); assert.equal(next.trialId, 'trial-0001');
  assert.deepEqual(edited.body.currentPlacementIds, [next.id]);
  // 같은 요청 재전송은 같은 결과(새로 쌓지 않음), 이미 바뀐 변경안을 다시 고치면 409
  const retry = await place(f, p, f.s, { replaces: oldId, sceneNo: 5, position: { x: 46, y: 1.2, z: 36 }, rotationY: 15, scale: 1, groundY: 1.1 });
  assert.equal(retry.status, 200); assert.equal(retry.body.placements.length, 2);
  assert.equal((await place(f, p, f.s, { replaces: oldId, position: { x: 47, y: 1.2, z: 36 } })).status, 409);
  // 사람이 고친 것도 다시 고칠 수 있다
  const twice = await place(f, p, f.s, { replaces: next.id, position: { x: 47, y: 1.3, z: 36 } });
  assert.equal(twice.status, 200); assert.equal(twice.body.placements.find(value => value.id === next.id).status, 'withdrawn'); assert.equal(twice.body.currentPlacementIds.length, 1);
  const human = await f.request(`/projects/${p.id}/placements?origin=human&current=1`);
  assert.equal(human.body.placements.length, 1); assert.equal(human.body.placements[0].replaces, next.id);
});
