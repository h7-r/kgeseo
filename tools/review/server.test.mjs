import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
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
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'kgeseo-review-api-'));
  const data = bootstrap();
  const handler = createReviewHandler({ dataDir: dir, getBootstrap: async () => structuredClone(data) });
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

async function sceneFixture(t, overrides = {}) {
  const f = await fixture(t); f.data.game.visualViews = visualViews(); f.data.game.publicAssetCount = 92;
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
