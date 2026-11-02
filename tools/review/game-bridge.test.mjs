import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'rolldown/utils';
import * as THREE from 'three';
// TS 이식(2026-10-15): 검수정책.js → review/reviewPolicy.ts (Node 22.18+ 는 .ts 를 타입만 벗겨 바로 읽는다) · reviewViews.json → review/reviewViews.json
import { readReviewUrl, shouldBlockKeyInReview, readReviewMetrics, reviewErrorText, reviewReturnMessage, readVisualRequest, identifyReviewObject, classifyReviewSurface } from '../../naju01/src/review/reviewPolicy.ts';
const reviewViews = JSON.parse(await fs.readFile(new URL('../../naju01/src/review/reviewViews.json', import.meta.url), 'utf8'));

const token = 'a'.repeat(48);
const href = `http://localhost:5173/naju01/?review=1&reviewProject=project-1&reviewSession=session-1&reviewKind=space&reviewMode=normal&gameRevision=revision-1#reviewToken=${token}`;
const publicHref = href.replace('&gameRevision', '&aihub=&src=sf&r=15&gameRevision');

test('review is opt-in, local-development-only and restricted to Naju', () => {
  assert.equal(readReviewUrl(href, false), null);
  assert.equal(readReviewUrl('http://localhost/naju01/', true), null);
  assert.equal(readReviewUrl(href.replace('/naju01/', '/'), true), null);
  assert.equal(readReviewUrl(href, true).valid, true);
});

test('normal review rejects extra settings, missing revisions and query-string secrets', () => {
  assert.equal(readReviewUrl(href.replace('&gameRevision', '&dev=1&gameRevision'), true).valid, false);
  assert.equal(readReviewUrl(href.replace('&gameRevision=revision-1', ''), true).valid, false);
  assert.equal(readReviewUrl(href.replace('#reviewToken=', '&reviewToken='), true).valid, false);
  assert.equal(readReviewUrl(href.replace('project-1', '../private'), true).valid, false);
});

test('diagnostic permits developer switches but never AIHub previews', () => {
  const diagnostic = href.replace('reviewMode=normal', 'reviewMode=diagnostic');
  assert.equal(readReviewUrl(diagnostic.replace('&gameRevision', '&dev=1&gameRevision'), true).valid, true);
  assert.equal(readReviewUrl(diagnostic.replace('&gameRevision', '&aihub=검수&gameRevision'), true).valid, false);
});

test('only the exact public replacement profile is permitted, including in diagnostic mode', () => {
  assert.equal(readReviewUrl(publicHref, true).runtimeProfile, 'naju-public-sf-v1');
  assert.equal(readReviewUrl(publicHref, true).valid, true);
  assert.equal(readReviewUrl(href, true).runtimeProfile, 'naju-base-v1');
  for (const invalid of [
    publicHref.replace('&src=sf', ''), publicHref.replace('src=sf', 'src=aihub'),
    publicHref.replace('aihub=', 'aihub=면수'), publicHref.replace('r=15', 'r=16'),
    publicHref.replace('&src=sf', '&src=sf&src=sf'), publicHref.replace('&aihub=', '&aihub=&aihub='),
  ]) {
    assert.equal(readReviewUrl(invalid, true).valid, false);
    assert.equal(readReviewUrl(invalid.replace('reviewMode=normal', 'reviewMode=diagnostic'), true).valid, false);
  }
});

test('normal mode blocks teleport, forced completion and editor without blocking walking', () => {
  for (const code of ['Digit1', 'Digit4', 'KeyE', 'KeyO', 'KeyN']) assert.equal(shouldBlockKeyInReview({ code }, 'normal'), true);
  for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyT', 'KeyV', 'Escape']) assert.equal(shouldBlockKeyInReview({ code }, 'normal'), false);
  assert.equal(shouldBlockKeyInReview({ code: 'Digit1', shiftKey: true }, 'normal'), true);
  assert.equal(shouldBlockKeyInReview({ code: 'Digit1' }, 'diagnostic'), false);
  assert.equal(shouldBlockKeyInReview({ code: 'KeyV', ctrlKey: true }, 'normal'), false);
  assert.equal(shouldBlockKeyInReview({ code: 'KeyT', target: { closest: () => ({}) } }, 'diagnostic'), true);
});

test('measurements whitelist serializable fields and do not imply GPU memory or puzzle progress', () => {
  const cyclic = {}; cyclic.self = cyclic;
  const result = readReviewMetrics({ x: 1.23456, z: NaN, placeName: 'Z1', fps: 30.124, junk: cyclic, textures: 8 });
  assert.equal(result.position.x, 1.23);
  assert.equal(result.position.z, null);
  assert.equal(result.fps, 30.12);
  assert.equal(result.gpuMemoryMeasured, false);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal('junk' in result, false);
});

test('error messages never retain the session token', () => {
  assert.ok(!reviewErrorText(new Error(`failed ${href}`), token).includes(token));
  assert.ok(reviewErrorText('x'.repeat(1000)).length <= 500);
});

// This is a non-rendering unit harness: simulate useFrame callbacks, not WebGL readiness.
async function bridgeHarness(url = href, { embedded = false } = {}) {
  // ReviewBridge.tsx 는 TSX — import 는 여러 줄(prettier)이라 `;` 까지 통째로 걷어내고, 하네스 전역으로 대신 준다
  const text = await fs.readFile(new URL('../../naju01/src/review/ReviewBridge.tsx', import.meta.url), 'utf8');
  // 둘러보기 카메라(FreeCamera)는 review/freeCamera.ts 로 떼어 냈다(10/15) — 같은 방식으로 걷어 앞에 붙인다(이름 겹침은 함수로 가둔다)
  const cameraText = await fs.readFile(new URL('../../naju01/src/review/freeCamera.ts', import.meta.url), 'utf8');
  const cameraSource = cameraText.replace(/^import\b[\s\S]*?;\s*$/gm, '').replace(/^export (const|function|class) /gm, '$1 ');
  const source = `const FreeCamera = (() => {\n${cameraSource}\nreturn FreeCamera;\n})();\n` + text.replace(/^import\b[\s\S]*?;\s*$/gm, '').replace(/^export (const|function|class) /gm, '$1 ').replaceAll('import.meta.env.DEV', 'true').replaceAll('import.meta.hot', 'null');
  const converted = await transform('bridge.tsx', source, { jsx: { runtime: 'classic' } });
  converted.code = converted.code.replace(/^export \{\};?$/gm, ''); // 변환기가 모듈 표식으로 남기는 빈 export
  // 옛 window.__공개에셋상태 는 loaders/publicAssetManifest 의 publicAssetStatus(자리에서 바뀌는 객체) import 가 됐다
  const publicAssetStatus = { source: 'sf', phase: 'off', total: 0, loaded: 0, failed: 0, failures: [], appliedGroups: 0 };
  const setPublicAssetStatus = value => { for (const key of Object.keys(publicAssetStatus)) delete publicAssetStatus[key]; Object.assign(publicAssetStatus, { failures: [] }, value); };
  const calls = [], listeners = [], frames = [], messages = [], navigations = [], displayActions = [], effects = [], canvases = [], draws = [], afterFrames = [];
  const timers = new Map(); let timerId = 0;
  const browserWindow = {
    addEventListener: (...args) => listeners.push(args),
    location: { assign: path => navigations.push(path) },
  };
  browserWindow.parent = embedded ? { postMessage: (...args) => messages.push(args) } : browserWindow;
  const context = vm.createContext({
    URL, URLSearchParams, Date, JSON, console, AbortController, THREE, reviewViewsJson: reviewViews, publicAssetStatus,
    PUBLIC_ASSET_MESH_PREFIX: 'AI허브:', METERS_PER_UNIT: 0.3, UNITS_PER_METER: 1 / 0.3,
    OrbitControls: class {
      constructor() { this.target = new THREE.Vector3(); this.enabled = true; }
      update() {} dispose() {}
    },
    location: { href: url, origin: new URL(url).origin }, crypto: { randomUUID: () => 'unit-visit' },
    window: browserWindow,
    document: {
      exitPointerLock: () => displayActions.push('exit-pointer-lock'),
      exitFullscreen: async () => displayActions.push('exit-fullscreen'),
      documentElement: { requestFullscreen: async () => displayActions.push('request-fullscreen') },
      createElement: type => {
        assert.equal(type, 'canvas');
        const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args) => draws.push(args) }), toDataURL: (mime, quality) => { assert.equal(mime, 'image/jpeg'); assert.equal(quality, 0.8); return 'data:image/jpeg;base64,dGVzdA=='; } };
        canvases.push(canvas); return canvas;
      },
    },
    setTimeout: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (path, options) => { calls.push({ path, body: JSON.parse(options.body) }); return { ok: true }; },
    React: { Component: class {}, createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    useRef: value => ({ current: value }), useFrame: callback => frames.push(callback),
    addAfterEffect: callback => { afterFrames.push(callback); return () => { afterFrames.splice(afterFrames.indexOf(callback), 1); }; },
    useState: value => [value, () => {}], useSyncExternalStore: (_sub, snapshot) => snapshot(), useEffect: callback => effects.push(callback),
    readReviewUrl, shouldBlockKeyInReview, readReviewMetrics, reviewErrorText, reviewReturnMessage, readVisualRequest, identifyReviewObject, classifyReviewSurface,
    VISUAL_REQUEST_TYPES: ['kgeseo-review-capture', 'kgeseo-review-view', 'kgeseo-review-inspection'],
  });
  vm.runInContext(`${converted.code}\n globalThis.bridge = { ReviewBridge, ReviewHud, snapshot, flush, record, returnToWorkbench, toggleFullscreen };`, context);
  return { ...context.bridge, context, setPublicAssetStatus, calls, listeners, frames, messages, navigations, displayActions, timers, effects, canvases, draws, afterFrames };
}

test('regular game has no review listeners and never posts observations', async () => {
  const bridge = await bridgeHarness('http://localhost:5173/naju01/');
  assert.equal(bridge.listeners.length, 0);
  bridge.ReviewBridge({ reportRef: { current: { placeName: 'Z1' } } });
  bridge.frames[0]({ clock: { elapsedTime: 6 } });
  bridge.record('checkpoint', {});
  await bridge.flush();
  assert.equal(bridge.calls.length, 0);
});

test('ready requires the second real-frame callback and never fabricates puzzle events', async () => {
  const bridge = await bridgeHarness();
  bridge.ReviewBridge({ reportRef: { current: { placeName: 'Z1', x: 1, z: 2 } } });
  const tick = bridge.frames[0];
  tick({ clock: { elapsedTime: 0.1 } });
  assert.equal(bridge.snapshot().ready, false);
  tick({ clock: { elapsedTime: 0.2 } });
  assert.equal(bridge.snapshot().ready, true);
  tick({ clock: { elapsedTime: 6 } });
  await bridge.flush();
  const request = bridge.calls[0];
  assert.equal(request.path, '/__review/projects/project-1/sessions/session-1/events');
  assert.equal(request.body.token, token);
  assert.deepEqual(request.body.events.map(event => event.type), ['ready', 'metrics', 'navigation']);
  assert.equal(request.body.events[0].detail.capabilities.puzzlePlay, false);
  assert.ok(request.body.events.every(event => event.detail.runtimeProfile === 'naju-base-v1'));
  assert.ok(request.body.events.every(event => event.id && !JSON.stringify(event).includes(token)));
});

test('public ready waits for complete replacement application and two subsequent frames', async () => {
  const bridge = await bridgeHarness(publicHref);
  bridge.ReviewBridge({ reportRef: { current: { placeName: 'Z1', terrainSource: '새(블렌더)' } } });
  const tick = elapsedTime => bridge.frames[0]({ clock: { elapsedTime } });
  tick(0.1); tick(0.2);
  assert.equal(bridge.snapshot().ready, false);
  bridge.setPublicAssetStatus({ source: 'sf', phase: 'loading', total: 2, loaded: 1, failed: 0 });
  tick(1);
  bridge.setPublicAssetStatus({ source: 'sf', phase: 'loaded', total: 2, loaded: 2, failed: 0 });
  tick(2); tick(3);
  assert.equal(bridge.snapshot().ready, false);
  bridge.setPublicAssetStatus({ source: 'sf', phase: 'applied', total: 2, loaded: 2, failed: 0, appliedGroups: 1 });
  tick(4); tick(4.1);
  assert.equal(bridge.snapshot().ready, false);
  tick(4.2);
  assert.equal(bridge.snapshot().ready, true);
  tick(6);
  await bridge.flush();
  const events = bridge.calls.flatMap(call => call.body.events);
  const ready = events.find(event => event.type === 'ready');
  assert.equal(ready.detail.assetLoadState, 'public-assets-loaded-and-applied');
  assert.equal(ready.detail.publicAssets.loaded, ready.detail.publicAssets.total);
  assert.ok(events.every(event => event.detail.runtimeProfile === 'naju-public-sf-v1'));
  assert.equal(events.find(event => event.type === 'metrics').detail.terrain, '새(블렌더)');
});

test('public loader failures become explicit errors and cannot silently pass on the base scene', async () => {
  const bridge = await bridgeHarness(publicHref);
  bridge.ReviewBridge({ reportRef: { current: { placeName: 'Z1' } } });
  bridge.setPublicAssetStatus({ source: 'sf', phase: 'failed', total: 2, loaded: 1, failed: 1, failures: [{ file: 'rock/missing.glb', message: `failed ${token}` }] });
  for (let i = 1; i <= 6; i++) bridge.frames[0]({ clock: { elapsedTime: i } });
  assert.equal(bridge.snapshot().ready, false);
  await bridge.flush();
  const events = bridge.calls.flatMap(call => call.body.events);
  assert.equal(events.filter(event => event.type === 'error').length, 1);
  assert.ok(!events.some(event => event.type === 'ready'));
  assert.ok(!JSON.stringify(events).includes(token));
  // 같은 실패 실행 안에서 상태 값을 나중에 바꿔도 승인 가능한 새 실행으로 둔갑하지 않는다.
  bridge.setPublicAssetStatus({ source: 'sf', phase: 'applied', total: 2, loaded: 2, failed: 0, appliedGroups: 1 });
  for (let i = 7; i <= 10; i++) bridge.frames[0]({ clock: { elapsedTime: i } });
  assert.equal(bridge.snapshot().ready, false);
});

// The shared local preview loader is intentionally not checked in. Exercise it when
// present without loading any local asset bytes or requiring a WebGL context.
async function localLoaderHarness(t, { url = publicHref, failedFile = null, manifestOk = true, sharedCover = false } = {}) {
  let text;
  try { text = await fs.readFile(new URL('../../naju01/src/scenes/AI허브전시.jsx', import.meta.url), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') { t.skip('optional local loader is absent'); return null; } throw error; }
  const source = text.replace(/^import .*;$/gm, '').replace(/export (?:default )?(const|function|class) /g, '$1 ')
    .replaceAll('import.meta.env.DEV', 'true').replaceAll('import.meta.env.BASE_URL', '"/"');
  const converted = await transform('local-loader.jsx', source, { jsx: { runtime: 'classic' } });
  const effects = [], frames = [], loadedPaths = [], storageCalls = [], listeners = [];
  const state = [], refs = []; let stateIndex = 0, refIndex = 0;
  const manifest = { 바꿔치기: [{ target: 'test-tree', files: ['tree.glb', 'rock.glb', 'tree.glb'] }] };
  if (sharedCover) manifest.덮기 = [{ files: ['rock.glb'] }];
  const context = vm.createContext({
    THREE, URLSearchParams, Event, Float32Array,
    location: { href: url, search: new URL(url).search, reload() {} },
    window: { dispatchEvent() {} },
    localStorage: {
      getItem: key => { storageCalls.push(['read', key]); return '["old-hidden-cover"]'; },
      setItem: (...args) => storageCalls.push(['write', ...args]),
    },
    console: { info() {}, warn() {} },
    fetch: async () => ({ ok: manifestOk, status: manifestOk ? 200 : 404, json: async () => manifest }),
    새GLTF로더: () => ({ loadAsync: async path => {
      loadedPaths.push(path);
      if (path.endsWith(failedFile || 'never-matches')) throw new Error('fixture GLB decode failed');
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
      return { scene };
    } }),
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    useState: initial => { const i = stateIndex++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; },
    useRef: initial => { const i = refIndex++; return refs[i] ||= { current: initial }; },
    useEffect: callback => effects.push(callback), useFrame: callback => frames.push(callback),
    readReviewUrl, 미터: 1, 통로: [], 구역: [], TOON_GRADIENT: null,
    그리기반경: () => 0, 초점: { 잠시끔: false },
  });
  vm.runInContext(`${converted.code}\n globalThis.loader = { AI허브바꿔치기, 덮기뺌, 덮기뺌저장 };`, context);
  const render = () => {
    stateIndex = 0; refIndex = 0;
    const element = context.loader.AI허브바꿔치기();
    if (!element.props.ref.current) element.props.ref.current = new THREE.Group();
    return element;
  };
  render(); effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  render();
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const gl = { domElement: {
    addEventListener: (...args) => listeners.push(args),
    getBoundingClientRect: () => { throw new Error('normal review must not enter cover editing'); },
  } };
  const tick = () => frames.at(-1)({ scene, camera, gl });
  return { context, loader: context.loader, storageCalls, loadedPaths, listeners, tick };
}

test('local public loader reports failed decode and manifest requests instead of silently succeeding', async t => {
  const fixture = await localLoaderHarness(t, { failedFile: 'rock.glb' });
  if (!fixture) return;
  const status = fixture.context.window.__공개에셋상태;
  assert.equal(status.phase, 'failed');
  assert.equal(status.total, 2);
  assert.equal(status.loaded, 1);
  assert.equal(status.failed, 1);
  assert.equal(status.failures[0].file, 'rock.glb');
  assert.equal(fixture.loadedPaths.length, 2, 'duplicate manifest references share one load');
  const missing = await localLoaderHarness(t, { manifestOk: false });
  assert.equal(missing.context.window.__공개에셋상태.phase, 'failed');
  assert.equal(missing.context.window.__공개에셋상태.failures[0].file, 'manifest.json');
  assert.equal(missing.loadedPaths.length, 0);
});

test('public progress counts unique source files when replacement and cover loaders use separate caches', async t => {
  const fixture = await localLoaderHarness(t, { sharedCover: true });
  if (!fixture) return;
  const status = fixture.context.window.__공개에셋상태;
  assert.equal(fixture.loadedPaths.filter(path => path.endsWith('/rock.glb')).length, 2, 'cover cache remains independent');
  assert.equal(status.total, 2);
  assert.equal(status.loaded, 2, 'a source file counts once even when decoded for both uses');
  assert.equal(status.failed, 0);
  assert.equal(status.phase, 'loaded');
});

test('local public review ignores private hidden-cover state, blocks editing and waits for actual replacement meshes', async t => {
  const fixture = await localLoaderHarness(t);
  if (!fixture) return;
  assert.equal(fixture.context.window.__공개에셋상태.phase, 'loaded');
  for (let i = 0; i < 40; i++) fixture.tick();
  assert.equal(fixture.context.window.__공개에셋상태.phase, 'loaded', 'an empty target group is not applied geometry');
  fixture.listeners.find(([type]) => type === 'pointerdown')[1]({ altKey: true });
  fixture.loader.덮기뺌.add('temporary');
  fixture.loader.덮기뺌저장();
  assert.equal(fixture.loader.덮기뺌.has('old-hidden-cover'), false);
  assert.deepEqual(fixture.storageCalls, []);
  const ordinary = await localLoaderHarness(t, { url: 'http://localhost:5174/?aihub&src=sf&r=15' });
  assert.equal(ordinary.loader.덮기뺌.has('old-hidden-cover'), true);
  ordinary.loader.덮기뺌저장();
  assert.deepEqual(ordinary.storageCalls.map(([type]) => type), ['read', 'write']);
});

test('developer scene removal is diagnostic evidence and not puzzle interaction', async () => {
  const bridge = await bridgeHarness(href.replace('reviewMode=normal', 'reviewMode=diagnostic'));
  bridge.ReviewBridge({ reportRef: { current: { placeName: 'Z2' } }, clearedBlockers: () => ['gate-1'] });
  bridge.frames[0]({ clock: { elapsedTime: 6 } });
  await bridge.flush();
  const events = bridge.calls[0].body.events;
  const diagnostic = events.find(event => event.detail.source === 'diagnostic-scene-state');
  assert.equal(diagnostic.type, 'checkpoint');
  assert.equal(diagnostic.detail.countsAsPuzzleProgress, false);
  assert.ok(!events.some(event => ['completed', 'interaction'].includes(event.type)));
});

test('failed event delivery keeps ids for deduplicated retry and preserves pending evidence', async () => {
  const bridge = await bridgeHarness();
  const requests = [];
  bridge.context.fetch = async (_url, options) => { requests.push(JSON.parse(options.body)); throw new Error('temporary network failure'); };
  bridge.record('checkpoint', { note: '배치 확인', countsAsPuzzleProgress: false });
  await bridge.flush();
  assert.equal(bridge.snapshot().pending, 1);
  assert.equal(bridge.snapshot().saved, 0);
  bridge.context.fetch = async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true }; };
  await bridge.flush();
  assert.equal(bridge.snapshot().pending, 0);
  assert.equal(bridge.snapshot().saved, 1);
  assert.equal(requests[0].events[0].id, requests[1].events[0].id);
});

test('embedded return exits pointer lock and fullscreen, posts only identifiers to the same origin', async () => {
  const bridge = await bridgeHarness(href, { embedded: true });
  bridge.context.document.fullscreenElement = {};
  assert.equal(await bridge.returnToWorkbench(), true);
  assert.deepEqual(bridge.displayActions, ['exit-pointer-lock', 'exit-fullscreen']);
  assert.equal(bridge.navigations.length, 0);
  assert.equal(bridge.messages.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.messages[0])), [
    { type: 'kgeseo-review-return', projectId: 'project-1', sessionId: 'session-1' },
    'http://localhost:5173',
  ]);
  assert.ok(!JSON.stringify(bridge.messages).includes(token));
});

test('return waits for existing delivery, then flushes remaining records before notifying the parent', async () => {
  const bridge = await bridgeHarness(href, { embedded: true });
  let resolveRequest;
  bridge.context.fetch = async () => new Promise(resolve => { resolveRequest = resolve; });
  bridge.record('checkpoint', { note: '현장 기록' });
  const sending = bridge.flush();
  const returning = bridge.returnToWorkbench();
  assert.equal(bridge.messages.length, 0);
  assert.equal(bridge.snapshot().returning, true);
  resolveRequest({ ok: true });
  await sending;
  assert.equal(await returning, true);
  assert.equal(bridge.snapshot().pending, 0);
  assert.equal(bridge.messages.length, 1);
});

test('return preserves embedded game and pending observations when saving fails', async () => {
  const bridge = await bridgeHarness(href, { embedded: true });
  bridge.context.fetch = async () => { throw new Error('offline'); };
  bridge.record('checkpoint', { note: '저장할 관찰' });
  assert.equal(await bridge.returnToWorkbench(), false);
  assert.equal(bridge.messages.length, 0);
  assert.equal(bridge.navigations.length, 0);
  assert.equal(bridge.snapshot().pending, 1);
  assert.match(bridge.snapshot().blocked, /먼저 저장/u);
});

test('embedded HUD starts compact, identifies its actual runtime and provides fullscreen without iframe navigation', async () => {
  const bridge = await bridgeHarness(href, { embedded: true });
  const tree = bridge.ReviewHud();
  const elements = [];
  const walk = value => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    elements.push(value);
    walk(value.props?.children);
  };
  walk(tree);
  assert.equal(elements.find(element => 'aria-expanded' in element.props).props['aria-expanded'], false);
  assert.ok(!elements.some(element => element.type === 'a'));
  assert.match(JSON.stringify(tree), /연결 화면: 나주 앙암바위/u);
  assert.match(JSON.stringify(tree), /공간 검수/u);
  await bridge.toggleFullscreen();
  assert.deepEqual(bridge.displayActions, ['request-fullscreen']);
});

test('parent flush drains observations queued behind an in-flight batch and stops generation before ack', async () => {
  const bridge = await bridgeHarness(href, { embedded: true });
  const requests = [];
  let releaseFirst;
  bridge.context.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) return new Promise(resolve => { releaseFirst = resolve; });
    return { ok: true };
  };
  for (let i = 0; i < 25; i++) bridge.record('checkpoint', { note: `관찰 ${i}` });
  const sending = bridge.flush();
  for (let i = 25; i < 30; i++) bridge.record('checkpoint', { note: `관찰 ${i}` });
  const receive = bridge.listeners.find(([type]) => type === 'message')[1];
  const flush = receive({
    origin: 'http://localhost:5173', source: bridge.context.window.parent,
    data: { type: 'kgeseo-review-flush', projectId: 'project-1', sessionId: 'session-1', requestId: 'flush-1' },
  });
  assert.equal(bridge.snapshot().flushing, true);
  assert.equal(bridge.record('metrics', { fps: 60 }), false);
  assert.equal(bridge.messages.length, 0);
  releaseFirst({ ok: true });
  await sending;
  await flush;
  assert.equal(requests.flatMap(request => request.events).length, 30);
  assert.equal(bridge.snapshot().pending, 0);
  assert.equal(bridge.snapshot().quiescent, true);
  assert.equal(bridge.record('checkpoint', { note: '종료 후 추가 금지' }), false);
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.messages[0])), [
    { type: 'kgeseo-review-flushed', projectId: 'project-1', sessionId: 'session-1', requestId: 'flush-1', ok: true },
    'http://localhost:5173',
  ]);
  assert.equal(bridge.navigations.length, 0);
});

test('flush requests must match the parent window, origin, project, session and request id', async () => {
  const bridge = await bridgeHarness(href, { embedded: true });
  const receive = bridge.listeners.find(([type]) => type === 'message')[1];
  const event = {
    origin: 'http://localhost:5173', source: bridge.context.window.parent,
    data: { type: 'kgeseo-review-flush', projectId: 'project-1', sessionId: 'session-1', requestId: 'flush-1' },
  };
  for (const invalid of [
    { ...event, origin: 'https://elsewhere.test' }, { ...event, source: {} },
    { ...event, data: { ...event.data, projectId: 'different-project' } },
    { ...event, data: { ...event.data, sessionId: 'different-session' } },
    { ...event, data: { ...event.data, requestId: 'x'.repeat(81) } },
  ]) await receive(invalid);
  assert.equal(bridge.messages.length, 0);
  assert.equal(bridge.snapshot().flushing, false);
  assert.equal(bridge.snapshot().quiescent, false);
});

test('failed parent flush acknowledges failure without losing queued observations and resumes recording', async () => {
  const bridge = await bridgeHarness(href, { embedded: true });
  bridge.context.fetch = async () => { throw new Error(`offline ${token}`); };
  bridge.record('checkpoint', { note: '보존할 관찰' });
  const receive = bridge.listeners.find(([type]) => type === 'message')[1];
  await receive({
    origin: 'http://localhost:5173', source: bridge.context.window.parent,
    data: { type: 'kgeseo-review-flush', projectId: 'project-1', sessionId: 'session-1', requestId: 'flush-error' },
  });
  assert.equal(bridge.messages[0][0].ok, false);
  assert.ok(!JSON.stringify(bridge.messages).includes(token));
  assert.equal(bridge.snapshot().pending, 1);
  assert.equal(bridge.snapshot().flushing, false);
  assert.equal(bridge.snapshot().quiescent, false);
  assert.equal(bridge.record('checkpoint', { note: '실패 뒤 새 관찰' }), true);
  assert.equal(bridge.snapshot().pending, 2);
});

test('parent flush times out before the parent deadline without dropping the in-flight event', async () => {
  const bridge = await bridgeHarness(href, { embedded: true });
  let releaseRequest;
  bridge.context.fetch = async () => new Promise(resolve => { releaseRequest = resolve; });
  bridge.record('checkpoint', { note: '느린 연결 관찰' });
  const receive = bridge.listeners.find(([type]) => type === 'message')[1];
  const waiting = receive({
    origin: 'http://localhost:5173', source: bridge.context.window.parent,
    data: { type: 'kgeseo-review-flush', projectId: 'project-1', sessionId: 'session-1', requestId: 'flush-timeout' },
  });
  const deadline = [...bridge.timers.values()].find(timer => timer.ms === 12000);
  assert.ok(deadline);
  deadline.callback();
  await waiting;
  assert.equal(bridge.messages[0][0].ok, false);
  assert.match(bridge.messages[0][0].error, /제한 시간/u);
  assert.equal(bridge.snapshot().pending, 1);
  assert.equal(bridge.snapshot().quiescent, false);
  releaseRequest({ ok: true });
  await bridge.flush();
  assert.equal(bridge.snapshot().pending, 0);
});

async function visualHarness({ mode = 'diagnostic', ready = true } = {}) {
  const bridge = await bridgeHarness(href.replace('reviewMode=normal', `reviewMode=${mode}`), { embedded: true });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 4000);
  const pointers = new Map(), teleportCalls = [];
  const canvas = {
    width: 1920, height: 1080,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
    addEventListener: (name, callback) => pointers.set(name, callback),
    removeEventListener: (name, callback) => { if (pointers.get(name) === callback) pointers.delete(name); },
  };
  // 옛 window.__NAJU 의 텔레포트·플레이어상태·지형.지면 은 ReviewBridge props(teleport · playerState · terrain.groundAt)가 됐다
  const links = {
    teleport: { current: (...args) => teleportCalls.push(args) },
    playerState: { current: { position: new THREE.Vector3() } },
    terrain: { groundAt: () => ({ y: 0, zone: 'Z1' }) },
  };
  bridge.ReviewBridge({ reportRef: { current: { placeName: 'Z1' } }, ...links });
  const cleanup = bridge.effects[0]();
  const tick = time => {
    bridge.frames[0]({ clock: { elapsedTime: time }, scene, camera, gl: { domElement: canvas } });
    for (const callback of bridge.afterFrames) callback();
  };
  if (ready) { tick(0.1); tick(0.2); }
  const send = (type, extra = {}) => bridge.listeners.find(([name]) => name === 'message')[1]({
    origin: 'http://localhost:5173', source: bridge.context.window.parent,
    data: { type, projectId: 'project-1', sessionId: 'session-1', requestId: `request-${bridge.messages.length + 1}`, ...extra },
  });
  return { ...bridge, links, scene, camera, canvas, pointers, teleportCalls, tick, send, cleanup };
}

test('eight fixed views cover every zone twice and use finite world coordinates', () => {
  assert.equal(reviewViews.length, 8);
  assert.equal(new Set(reviewViews.map(view => view.id)).size, 8);
  for (const zone of ['Z1', 'Z2', 'Z3', 'Z4']) assert.equal(reviewViews.filter(view => view.zoneId === zone).length, 2);
  for (const view of reviewViews) {
    assert.equal(view.position.length, 3); assert.equal(view.target.length, 3);
    assert.ok([...view.position, ...view.target].every(Number.isFinite));
    assert.ok(new THREE.Vector3(...view.position).distanceTo(new THREE.Vector3(...view.target)) > 1);
  }
});

test('visual requests reject normal sessions, unready scenes, unknown views and free coordinates', async () => {
  const normal = await visualHarness({ mode: 'normal' });
  await normal.send('kgeseo-review-capture', { viewId: 'Z1-wide' });
  assert.equal(normal.messages[0][0].ok, false);
  assert.equal(normal.messages[0][0].mode, 'normal');
  assert.equal(normal.teleportCalls.length, 0);
  const waiting = await visualHarness({ ready: false });
  await waiting.send('kgeseo-review-capture', { viewId: 'Z1-wide' });
  assert.equal(waiting.messages[0][0].ok, false);
  const diagnostic = await visualHarness();
  await diagnostic.send('kgeseo-review-capture', { viewId: 'not-a-view' });
  await diagnostic.send('kgeseo-review-capture', { viewId: 'Z1-wide', position: [0, 0, 0] });
  assert.ok(diagnostic.messages.every(([message]) => !message.ok));
  assert.equal(diagnostic.teleportCalls.length, 0);
  const event = { origin: 'http://localhost:5173', source: diagnostic.context.window.parent, data: { type: 'kgeseo-review-capture', projectId: 'project-1', sessionId: 'session-1', requestId: 'safe-id', viewId: 'Z1-wide' } };
  for (const invalid of [{ ...event, source: {} }, { ...event, origin: 'https://foreign.test' }, { ...event, data: { ...event.data, sessionId: 'other' } }]) {
    assert.equal(readVisualRequest(invalid, readReviewUrl(href, true), diagnostic.context.window.parent, 'http://localhost:5173', reviewViews), null);
  }
});

test('capture waits for camera/player placement, 45 frames, 1.5 seconds and the completed render', async () => {
  const bridge = await visualHarness();
  await bridge.send('kgeseo-review-capture', { viewId: 'Z3-wide' });
  for (let i = 0; i < 45; i++) bridge.tick(0.3 + i * 0.01);
  assert.equal(bridge.canvases.length, 0, 'frame count alone is insufficient');
  const view = reviewViews.find(item => item.id === 'Z3-wide');
  assert.deepEqual(bridge.camera.position.toArray(), view.position);
  assert.deepEqual(bridge.links.playerState.current.position.toArray(), view.position);
  assert.deepEqual(bridge.teleportCalls[0], [view.position[0] * 0.3, view.position[2] * 0.3]);
  bridge.frames[0]({ clock: { elapsedTime: 2 }, scene: bridge.scene, camera: bridge.camera, gl: { domElement: bridge.canvas } });
  assert.equal(bridge.canvases.length, 0, 'must wait until after the actual render');
  bridge.afterFrames[0]();
  const reply = bridge.messages[0][0];
  assert.equal(reply.type, 'kgeseo-review-captured'); assert.equal(reply.ok, true);
  assert.equal(reply.mode, 'diagnostic'); assert.equal(reply.runtimeProfile, 'naju-base-v1');
  assert.equal(reply.gameRevision, 'revision-1');
  assert.match(reply.imageDataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(bridge.canvases[0].width, 960); assert.equal(bridge.canvases[0].height, 540);
  assert.equal(bridge.draws[0][0], bridge.canvas, 'only the game canvas is copied');
  await bridge.flush();
  assert.ok(bridge.calls.flatMap(call => call.body.events).every(event => event.detail.mode === 'diagnostic'));
});

test('view requests and captures run sequentially while view changes do not create images', async () => {
  const bridge = await visualHarness();
  await bridge.send('kgeseo-review-view', { requestId: 'view-one', viewId: 'Z1-wide' });
  await bridge.send('kgeseo-review-capture', { requestId: 'capture-two', viewId: 'Z2-detail' });
  for (let i = 0; i < 45; i++) bridge.tick(0.3 + i * 0.04);
  assert.equal(bridge.messages.length, 1); assert.equal(bridge.messages[0][0].type, 'kgeseo-review-view-changed');
  assert.equal(bridge.canvases.length, 0);
  for (let i = 0; i < 45; i++) bridge.tick(2.2 + i * 0.04);
  assert.equal(bridge.messages.length, 2); assert.equal(bridge.messages[1][0].requestId, 'capture-two');
  assert.equal(bridge.canvases.length, 1);
});

test('capture deadlines and unmount cancel queued work without later images', async () => {
  const bridge = await visualHarness();
  await bridge.send('kgeseo-review-capture', { viewId: 'Z1-wide' });
  [...bridge.timers.values()].find(timer => timer.ms === 19000).callback();
  assert.equal(bridge.messages[0][0].ok, false);
  bridge.tick(1);
  assert.equal(bridge.teleportCalls.length, 0);
  await bridge.send('kgeseo-review-capture', { requestId: 'capture-unmount', viewId: 'Z2-wide' });
  bridge.tick(2);
  bridge.cleanup();
  assert.equal(bridge.messages.at(-1)[0].ok, false);
  assert.equal(bridge.afterFrames.length, 0);
  assert.equal(bridge.canvases.length, 0);
});

test('inspection selects visible instances, keeps stable source indices and removes the highlight before capture', async () => {
  const bridge = await visualHarness();
  bridge.camera.position.set(0, 0, 5); bridge.camera.lookAt(0, 0, 0); bridge.camera.updateMatrixWorld(true);
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
  mesh.name = 'AI허브:소품.항아리'; mesh.userData.groupId = '소품.항아리'; mesh.userData.ids = Int32Array.from([73]);
  mesh.setMatrixAt(0, new THREE.Matrix4()); bridge.scene.add(mesh); bridge.scene.updateMatrixWorld(true);
  await bridge.send('kgeseo-review-inspection', { enabled: true });
  bridge.pointers.get('pointerdown')({ button: 0, clientX: 480, clientY: 270 });
  bridge.pointers.get('pointerup')({ button: 0, clientX: 480, clientY: 270 });
  const selected = bridge.messages.at(-1)[0];
  assert.equal(selected.type, 'kgeseo-review-object-selected');
  assert.equal(selected.object.objectId, '소품.항아리#73');
  assert.equal(selected.object.originalInstanceId, 73);
  assert.equal(selected.object.identityQuality, 'exact');
  assert.ok(bridge.scene.children.some(item => item.userData.reviewSelection));
  const beforeDrag = bridge.messages.length;
  bridge.pointers.get('pointerdown')({ button: 0, clientX: 470, clientY: 270 });
  bridge.pointers.get('pointerup')({ button: 0, clientX: 490, clientY: 270 });
  assert.equal(bridge.messages.length, beforeDrag, 'orbit drags do not select objects');
  await bridge.send('kgeseo-review-capture', { viewId: 'Z1-wide' }); bridge.tick(0.3);
  assert.ok(!bridge.scene.children.some(item => item.userData.reviewSelection));
  await bridge.send('kgeseo-review-inspection', { enabled: false });
  assert.equal(bridge.pointers.size, 0);
  assert.equal(bridge.snapshot().inspection, false);
});

test('unmapped object identities stay group-level instead of inventing exact asset names', () => {
  assert.equal(identifyReviewObject({ meshName: 'AI허브:나무', instanceId: 2 }).identityQuality, 'group');
  assert.equal(identifyReviewObject({ instanceId: 2 }).name, '이름 미등록');
  const mapped = identifyReviewObject({ groupName: '나무', instanceId: 2, originalInstanceId: 91 });
  const reordered = identifyReviewObject({ groupName: '나무', instanceId: 5, originalInstanceId: 91 });
  assert.equal(mapped.objectId, reordered.objectId, 'LOD compaction does not change mapped identity');
});

test('inspection HUD is a small collapsed overlay with one information toggle and no duplicate navigation controls', async () => {
  const bridge = await visualHarness();
  await bridge.send('kgeseo-review-inspection', { enabled: true });
  const tree = bridge.ReviewHud(), buttons = [];
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'button') buttons.push(node);
    walk(node.props?.children);
  };
  walk(tree);
  assert.equal(tree.props.style.top, 'auto');
  assert.equal(tree.props.style.bottom, 12);
  assert.ok(tree.props.style.width < 300);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props['aria-expanded'], false);
  const text = JSON.stringify(tree);
  assert.match(text, /배치 둘러보기/u);
  assert.ok(!text.includes('검수 화면으로'));
  assert.ok(!text.includes('전체 화면'));
  assert.ok(!text.includes('조작 해제 Esc'));
});

test('empty clicks, view changes, captures and inspection shutdown clear the parent object selection', async () => {
  for (const action of ['empty', 'view', 'capture', 'disable']) {
    const bridge = await visualHarness();
    bridge.camera.position.set(0, 0, 5); bridge.camera.lookAt(0, 0, 0); bridge.camera.updateMatrixWorld(true);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.name = '확인할 바위'; bridge.scene.add(mesh); bridge.scene.updateMatrixWorld(true);
    await bridge.send('kgeseo-review-inspection', { enabled: true });
    const click = (x, y) => {
      bridge.pointers.get('pointerdown')({ button: 0, clientX: x, clientY: y });
      bridge.pointers.get('pointerup')({ button: 0, clientX: x, clientY: y });
    };
    click(480, 270);
    assert.ok(bridge.snapshot().selected);
    const before = bridge.messages.length;
    if (action === 'empty') click(5, 5);
    else if (action === 'disable') await bridge.send('kgeseo-review-inspection', { enabled: false });
    else { await bridge.send(`kgeseo-review-${action}`, { viewId: 'Z1-wide' }); bridge.tick(0.3); }
    assert.equal(bridge.snapshot().selected, null, action);
    const cleared = bridge.messages.slice(before).find(([message]) => message.type === 'kgeseo-review-object-selected' && message.object === null);
    assert.ok(cleared, `${action} must clear the parent form as well as the HUD`);
    assert.equal(cleared[0].projectId, 'project-1');
    assert.equal(cleared[0].sessionId, 'session-1');
    assert.equal(cleared[1], 'http://localhost:5173');
    assert.ok(!bridge.scene.children.some(item => item.userData.reviewSelection));
    bridge.cleanup();
  }
});
