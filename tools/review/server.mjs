import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_CHECKS = Object.freeze({
  source: ['fidelity', 'adaptation'], assets: ['shape', 'fit'],
  space: ['movement', 'placement'], play: ['logic', 'story', 'fun'],
});
const GATES = Object.keys(REQUIRED_CHECKS);
const GATE_NAMES = { source: '설화', assets: '에셋', space: '공간', play: '플레이' };
const RUNTIME_PROFILES = new Set(['naju-base-v1', 'naju-public-sf-v1']);
const EVENTS = new Set(['ready', 'frame', 'navigation', 'metrics', 'checkpoint', 'interaction', 'completed', 'error']);
const MAX_BODY = 600_000;
const CAPTURE_LIMITS = Object.freeze({ imageBytes: 700 * 1024, projectBytes: 12 * 1024 * 1024, perViewRevision: 3, projectCount: 72 });
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const issue = (code, message) => ({ code, message });
const fail = (status, code, message, details) => { throw Object.assign(new Error(message), { status, code, details }); };
const text = (value, name, max, required = false) => {
  if (typeof value !== 'string' || Buffer.byteLength(value) > max || (required && !value.trim())) {
    fail(400, 'invalid_field', `${name}: ${required ? '빈 값 없이 ' : ''}${max}바이트 이하의 문자열을 입력하세요.`);
  }
  return value;
};
function assetIds(value, bootstrap) {
  if (!Array.isArray(value) || value.length > 500 || value.some(v => typeof v !== 'string')) fail(400, 'invalid_assets', '에셋 선택 목록을 확인하세요.');
  const ids = [...new Set(value)];
  const valid = new Set((bootstrap.assets || []).map(a => a.id));
  if (ids.some(id => !valid.has(id))) fail(400, 'unknown_asset', '현재 목록에 없는 에셋이 포함되어 있습니다.');
  return ids;
}
function tokenMatches(token, digest) {
  return typeof token === 'string' && token.length < 200 && timingSafeEqual(Buffer.from(hash(token)), Buffer.from(digest));
}
function currentDecision(project, gate) {
  return [...project.decisions].reverse().find(d => d.gate === gate && !d.invalidatedAt);
}
function invalidateForEvidence(project, fromGate, timestamp, reason) {
  const invalidatedDecisionIds = [];
  for (const decision of project.decisions) if (!decision.invalidatedAt && GATES.indexOf(decision.gate) >= GATES.indexOf(fromGate)) {
    decision.invalidatedAt = timestamp; decision.invalidationReason = reason; invalidatedDecisionIds.push(decision.id);
  }
  if (invalidatedDecisionIds.length) project.history.push({ id: randomUUID(), type: 'evidence-change', at: timestamp, projectRevision: project.revision, reason, invalidatedDecisionIds });
}
function runtimes(bootstrap) {
  return bootstrap.runtimes ?? (bootstrap.game ? [{ id: 'NAJU-01', title: '나주 앙암바위', ...bootstrap.game, revision: bootstrap.gameRevision, sourceRevision: bootstrap.sourceRevision }] : []);
}
function runtimeFor(project, bootstrap) {
  return runtimes(bootstrap).find(runtime => runtime.id === project.runtimeId) || null;
}
function runtimeBinding(input, bootstrap, previous = null) {
  const value = Object.hasOwn(input, 'runtimeId') ? input.runtimeId : previous?.runtimeId ?? null;
  const runtimeId = value === null || value === '' ? null : text(value, '연결 게임', 120, true);
  if (runtimeId && !runtimes(bootstrap).some(runtime => runtime.id === runtimeId)) fail(400, 'unknown_runtime', '등록되지 않은 게임입니다. 설화 입력은 게임 없이 저장할 수 있습니다.');
  const runtimeUse = runtimeId ? (Object.hasOwn(input, 'runtimeUse') ? input.runtimeUse : previous?.runtimeId === runtimeId ? previous.runtimeUse : 'reference') : null;
  if (runtimeId && !['reference', 'target'].includes(runtimeUse)) fail(400, 'invalid_runtime_use', '연결 게임의 용도를 참고 또는 검수 대상으로 선택하세요.');
  return { runtimeId, runtimeUse };
}
function referenceValidity(project, bootstrap) {
  const runtime = runtimeFor(project, bootstrap);
  return {
    source: project.sourceRevision === (project.runtimeUse === 'target' ? runtime?.sourceRevision ?? bootstrap.sourceRevision : hash(project.sourceText)),
    game: !project.runtimeId || Boolean(runtime && project.gameRevision === runtime.revision),
  };
}
function assignReferences(project, bootstrap) {
  const runtime = runtimeFor(project, bootstrap);
  project.gameRevision = runtime?.revision ?? null;
  project.sourceRevision = project.runtimeUse === 'target' ? runtime?.sourceRevision ?? bootstrap.sourceRevision : hash(project.sourceText);
}
function runtimeBlocker(project, bootstrap) {
  if (!project.runtimeId) return issue('runtime_required', '이 관문은 설화에 연결된 실제 게임이 필요합니다. 원문과 GLB 에셋은 게임 없이 검수할 수 있습니다.');
  if (!runtimeFor(project, bootstrap)) return issue('runtime_missing', '연결했던 게임이 현재 등록 목록에 없습니다. 연결을 다시 확인하세요.');
  const runtime = runtimeFor(project, bootstrap);
  if (runtime.available === false) return issue('runtime_unavailable', `연결 게임의 실행 자료가 준비되지 않았습니다. ${runtime.reviewBlockers?.[0] || '공개 에셋 구성을 확인하세요.'}`);
  if (project.runtimeUse !== 'target') return issue('runtime_reference_only', '참고용 게임의 관찰은 이 설화의 공간·플레이·팔레트 승인 근거가 아닙니다. 실제 검수 대상일 때만 연결 용도를 변경하세요.');
  return null;
}
function assetReviewMode(value, project, bootstrap) {
  if (!['individual', 'scene'].includes(value)) fail(400, 'invalid_asset_review_mode', '에셋 검수 방식은 개별 또는 구역 사진 검수여야 합니다.');
  if (value === 'scene' && (project.runtimeUse !== 'target' || !runtimeFor(project, bootstrap)?.visualViews?.length)) fail(422, 'scene_mode_unavailable', '구역 사진 검수는 검수 시점이 등록된 실제 대상 게임에 연결해야 합니다.');
  return value;
}
function publicReady(detail) {
  const assets = detail?.publicAssets;
  return detail?.assetLoadState === 'public-assets-loaded-and-applied' && assets?.source === 'sf' && assets?.phase === 'applied' && Number.isInteger(assets?.total) && assets.total > 0 && assets.loaded === assets.total && assets.failed === 0;
}
function diagnosticReady(project, session, bootstrap) {
  const runtime = runtimeFor(project, bootstrap);
  const validity = referenceValidity(project, bootstrap);
  return Boolean(runtime && runtime.available !== false && validity.game && (project.runtimeUse !== 'target' || validity.source) &&
    session && session.mode === 'diagnostic' && session.projectRevision === project.revision && (session.runtimeId ?? 'NAJU-01') === project.runtimeId && session.gameRevision === project.gameRevision &&
    (session.runtimeProfile ?? null) === (runtime.profile ?? null) && !session.events.some(event => event.type === 'error') &&
    session.events.some(event => event.type === 'ready' && (runtime.profile !== 'naju-public-sf-v1' || publicReady(event.detail))));
}
function visualZones(project, bootstrap) {
  const zones = new Map();
  for (const view of runtimeFor(project, bootstrap)?.visualViews || []) {
    if (!zones.has(view.zoneId)) zones.set(view.zoneId, { zoneId: view.zoneId, zoneName: view.zoneName, views: [] });
    zones.get(view.zoneId).views.push(view);
  }
  return [...zones.values()];
}
function latestCapture(project, viewId) {
  return [...project.sceneCaptures].reverse().find(capture => capture.viewId === viewId && capture.projectRevision === project.revision && capture.gameRevision === project.gameRevision);
}
function sceneReviewStatus(project, bootstrap) {
  return Object.fromEntries(visualZones(project, bootstrap).map(zone => {
    const captures = zone.views.map(view => latestCapture(project, view.id));
    const captureIds = captures.filter(Boolean).map(capture => capture.id);
    const problems = [];
    const bindingProblem = runtimeBlocker(project, bootstrap);
    if (bindingProblem) problems.push(bindingProblem);
    for (let index = 0; index < zone.views.length; index++) {
      const capture = captures[index]; const view = zone.views[index];
      if (!capture) problems.push(issue('scene_capture_required', `${view.label} 사진을 촬영하세요.`));
      else if (!diagnosticReady(project, project.sessions.find(session => session.id === capture.sessionId), bootstrap) || capture.runtimeProfile !== (runtimeFor(project, bootstrap)?.profile ?? null)) problems.push(issue('scene_capture_stale', `${view.label} 사진의 검수 세션이나 실행 버전이 더 이상 유효하지 않습니다.`));
    }
    const review = [...project.sceneReviews].reverse().find(value => value.zoneId === zone.zoneId && value.projectRevision === project.revision && value.gameRevision === project.gameRevision);
    if (review && (review.captureIds.length !== captureIds.length || review.captureIds.some(id => !captureIds.includes(id)))) problems.push(issue('scene_recaptured', '판정 후 사진이 바뀌었습니다. 최신 사진으로 다시 판정하세요.'));
    return [zone.zoneId, { zoneId: zone.zoneId, zoneName: zone.zoneName, requiredViewIds: zone.views.map(view => view.id), latestCaptureIds: captureIds, status: review ? problems.length ? 'stale' : review.decision : 'pending', blockers: problems, reviewId: review?.id ?? null }];
  }));
}
function jpegImage(value) {
  if (typeof value !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)) fail(400, 'invalid_capture_image', 'JPEG 사진만 저장할 수 있습니다.');
  const encoded = value.slice('data:image/jpeg;base64,'.length);
  if (encoded.length > Math.ceil(CAPTURE_LIMITS.imageBytes / 3) * 4) fail(413, 'capture_too_large', '사진 한 장은 700KiB 이하여야 합니다.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > CAPTURE_LIMITS.imageBytes) fail(413, 'capture_too_large', '사진 한 장은 700KiB 이하여야 합니다.');
  if (bytes.toString('base64') !== encoded || bytes.length < 16 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) fail(400, 'invalid_capture_image', 'JPEG 파일 서명을 확인할 수 없습니다.');
  let offset = 2; let width = 0; let height = 0; let scan = false;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) break;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) { height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); }
    if (marker === 0xda) { scan = true; break; }
    offset += length;
  }
  if (!scan || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 8_000_000) fail(400, 'invalid_capture_dimensions', '사진의 가로·세로는 4096 이하, 전체 800만 화소 이하여야 합니다.');
  return { imageDataUrl: value, imageSha256: hash(bytes), bytes: bytes.length, width, height };
}
function selectedObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 8000) fail(400, 'invalid_object', '선택한 물체 정보를 확인하세요.');
  const position = value.position;
  if (!Array.isArray(position) || position.length !== 3 || position.some(number => !Number.isFinite(number) || Math.abs(number) > 1_000_000)) fail(400, 'invalid_object_position', '물체 위치는 유효한 세 좌표여야 합니다.');
  for (const id of [value.instanceId, value.originalInstanceId]) if (id != null && (!Number.isInteger(id) || id < 0 || id > 10_000_000)) fail(400, 'invalid_instance_id', '물체 인스턴스 번호를 확인하세요.');
  return {
    objectId: text(value.objectId || '', '물체 ID', 500), name: text(value.name || '', '물체 이름', 1000), meshName: text(value.meshName || '', '메시 이름', 1000),
    groupName: text(value.groupName || '', '물체 그룹', 1000), zoneId: text(value.zoneId || '', '구역', 200), identityQuality: text(value.identityQuality || 'client-reported', '식별 정보 수준', 200),
    instanceId: value.instanceId ?? null, originalInstanceId: value.originalInstanceId ?? null, position: [...position], clientReported: true, identityVerified: false,
  };
}
function sessionReady(project, kind) {
  return project.sessions.some(s => isReadySession(project, s) && (kind === 'space' || s.kind === kind));
}
function isReadySession(project, session) {
  return Boolean(project.runtimeId && project.runtimeUse === 'target' && session && (session.runtimeId ?? 'NAJU-01') === project.runtimeId && session.projectRevision === project.revision && session.gameRevision === project.gameRevision &&
    session.mode === 'normal' && session.events.some(e => e.type === 'ready') && !session.events.some(e => e.type === 'error'));
}
function referenceSnapshot(bootstrap, project, capturedAt) {
  const file = value => ({ path: value.path ?? null, sha256: value.sha256 ?? null, ...(value.bytes === undefined ? {} : { bytes: value.bytes }) });
  const runtime = runtimeFor(project, bootstrap);
  const target = project.runtimeUse === 'target';
  const runtimeFiles = runtime?.files ?? (runtime?.id === 'NAJU-01' ? bootstrap.game?.files : []) ?? [];
  return {
    capturedAt, runtimeId: project.runtimeId, runtimeUse: project.runtimeUse, sourceRevision: project.sourceRevision, gameRevision: project.gameRevision,
    source: target && bootstrap.source ? { name: bootstrap.source.name ?? null, ...file(bootstrap.source) } : { name: project.sourceName, path: null, sha256: hash(project.sourceText), kind: 'user-input' },
    documents: (target ? bootstrap.documents || [] : []).map(value => ({ id: value.id, ...file(value) })),
    assets: (bootstrap.assets || []).filter(value => project.selectedAssetIds.includes(value.id)).map(value => ({ id: value.id, type: value.type, ...file(value) })),
    game: runtime ? { id: runtime.id, revision: runtime.revision, url: runtime.url ?? null, profile: runtime.profile ?? null, presentation: runtime.presentation ?? null, available: runtime.available !== false, visualViews: structuredClone(runtime.visualViews || []), publicAssetCount: runtime.publicAssetCount ?? null, files: runtimeFiles.map(file), capabilities: structuredClone(runtime.capabilities || {}) } : null,
  };
}
function inputSnapshot(project) {
  const editable = Object.fromEntries(['caseId', 'runtimeId', 'runtimeUse', 'assetReviewMode', 'title', 'sourceText', 'sourceName', 'synopsis', 'sceneNotes', 'selectedAssetIds'].map(key => [key, structuredClone(project[key])]));
  return {
    revision: project.revision, editable, inputHash: hash(JSON.stringify(editable)), sourceTextSha256: hash(project.sourceText),
    sourceRevision: project.sourceRevision, gameRevision: project.gameRevision,
    // Legacy drafts cannot recover an old manifest; never backfill it from current files.
    referenceSnapshot: structuredClone(project.referenceSnapshot ?? null),
  };
}
function blockers(project, gate, bootstrap) {
  const out = [];
  const validity = referenceValidity(project, bootstrap);
  const runtime = runtimeFor(project, bootstrap);
  if (project.runtimeUse === 'target' && (!validity.source || !validity.game)) out.push(issue('input_drift', '검수 대상의 참조 문서 또는 게임 파일이 바뀌었습니다. 입력을 다시 저장해 새 검수 회차를 시작하세요.'));
  const index = GATES.indexOf(gate);
  for (const upstream of GATES.slice(0, index)) {
    if (currentDecision(project, upstream)?.decision !== 'approved') out.push(issue('upstream_pending', `${GATE_NAMES[upstream]} 관문 승인이 먼저 필요합니다.`));
    else if (blockers(project, upstream, bootstrap).length) out.push(issue('upstream_stale', `${GATE_NAMES[upstream]} 관문의 승인 근거가 더 이상 유효하지 않습니다. 다시 검수하세요.`));
  }
  if (gate === 'source' && !project.synopsis.trim()) out.push(issue('synopsis_required', '검수할 시놉시스를 작성하세요.'));
  if (gate !== 'source') {
    if (project.assetReviewMode !== 'scene' && !project.selectedAssetIds.length) out.push(issue('assets_required', '검수할 에셋을 한 개 이상 선택하세요.'));
    const available = new Map((bootstrap.assets || []).map(a => [a.id, a]));
    for (const id of project.selectedAssetIds) {
      const asset = available.get(id);
      if (!asset) out.push(issue('asset_missing', `${id}: 현재 목록에서 찾을 수 없습니다.`));
      else if (gate === 'assets') {
        const inspection = [...project.inspections].reverse().find(i => i.assetId === id && i.projectRevision === project.revision && i.assetSha256 === asset.sha256 && i.gameRevision === project.gameRevision);
        if (asset.type === 'procedural') {
          const bindingProblem = runtimeBlocker(project, bootstrap);
          if (bindingProblem) out.push(bindingProblem);
          if (project.runtimeId && (asset.runtimeId ?? 'NAJU-01') !== project.runtimeId) out.push(issue('asset_runtime_mismatch', `${asset.name || id}: 연결한 게임의 팔레트가 아닙니다.`));
          const inspectedSession = project.sessions.find(s => s.id === inspection?.sessionId);
          if (inspection?.status !== 'observed' || !inspection.note?.trim() || !isReadySession(project, inspectedSession)) out.push(issue('asset_unseen', `${asset.name || id}: 정상 검수 세션에서 이 에셋을 직접 찾고 관찰 메모를 기록하세요. 다른 에셋의 확인이나 진단 세션은 대신 사용할 수 없습니다.`));
        } else {
          if (inspection?.status !== 'loaded') out.push(issue('asset_unseen', `${asset.name || id}: 3D 미리보기가 성공적으로 로드되어야 합니다.`));
        }
      }
    }
  }
  if (gate === 'assets' && project.assetReviewMode === 'scene') {
    const bindingProblem = runtimeBlocker(project, bootstrap);
    if (bindingProblem) out.push(bindingProblem);
    const zones = Object.values(sceneReviewStatus(project, bootstrap));
    if (!zones.length) out.push(issue('visual_views_required', '게임에 등록된 구역별 검수 시점이 필요합니다.'));
    for (const zone of zones) if (zone.status !== 'approved') out.push(issue('scene_review_required', `${zone.zoneName}: 최신 구역 사진에 대한 사람 승인이 필요합니다.`));
  }
  if (gate === 'space' || (gate === 'assets' && project.assetReviewMode === 'scene')) {
    const openIssues = project.objectIssues.filter(value => value.projectRevision === project.revision && value.gameRevision === project.gameRevision);
    if (openIssues.length) out.push(issue('object_issues_unresolved', `현재 공간에 반려·수정 요청 ${openIssues.length}건이 있습니다. 수정 후 새 검수 회차로 확인하세요.`));
  }
  if (['space', 'play'].includes(gate)) {
    const bindingProblem = runtimeBlocker(project, bootstrap);
    if (bindingProblem) out.push(bindingProblem);
  }
  if (gate === 'space') {
    if (!project.sceneNotes.trim()) out.push(issue('scene_notes_required', '공간별 경험·상호작용 및 검수 범위를 작성하세요.'));
    if (!sessionReady(project, 'space')) out.push(issue('space_session_required', '현재 입력 버전의 게임 공간이 실제로 렌더된 정상 검수 세션이 필요합니다. 진단 세션은 승인 근거가 되지 않습니다.'));
  }
  if (gate === 'play') {
    if (runtime?.capabilities?.puzzlePlay !== true) out.push(issue('runtime_puzzles_unavailable', '연결한 게임에는 검수 가능한 설화·퍼즐 진행이 없습니다. 이동 확인만으로 플레이를 승인할 수 없습니다. 반려·보류와 개선 의견을 기록하세요.'));
    else {
      const evidence = project.sessions.some(s => s.kind === 'play' && s.mode === 'normal' && s.projectRevision === project.revision && s.gameRevision === project.gameRevision && s.events.some(e => e.type === 'ready') && s.events.some(e => e.type === 'interaction') && !s.events.some(e => e.type === 'error'));
      if (!evidence) out.push(issue('normal_play_required', '현재 버전의 정상 플레이 세션에서 렌더 및 실제 상호작용 기록이 필요합니다. 진단 세션은 사용할 수 없습니다.'));
    }
  }
  return out;
}
function publicProject(project, bootstrap) {
  const copy = structuredClone(project);
  copy.sessions.forEach(session => { delete session.tokenHash; });
  copy.gateStatus = Object.fromEntries(GATES.map(gate => {
    const decision = currentDecision(project, gate);
    const problems = blockers(project, gate, bootstrap);
    return [gate, { status: decision?.decision === 'approved' && problems.length ? 'stale' : decision?.decision || 'pending', blockers: problems, decisionId: decision?.id || null }];
  }));
  copy.requiredChecks = REQUIRED_CHECKS;
  copy.currentValidity = referenceValidity(project, bootstrap);
  copy.sceneReviewStatus = sceneReviewStatus(project, bootstrap);
  copy.captureLimits = CAPTURE_LIMITS;
  return copy;
}
function guardRequest(req) {
  let host;
  try { host = new URL(`http://${req.headers.host}`).hostname; } catch { fail(403, 'local_only', '로컬 검수 서버에서만 사용할 수 있습니다.'); }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) fail(403, 'local_only', '로컬 검수 서버에서만 사용할 수 있습니다.');
  const address = req.socket?.remoteAddress;
  if (address && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) fail(403, 'local_only', '다른 컴퓨터의 요청은 허용하지 않습니다.');
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) fail(403, 'cross_origin', '다른 출처의 요청은 허용하지 않습니다.');
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'cross_origin', '다른 출처의 요청은 허용하지 않습니다.');
  if (!['GET', 'HEAD'].includes(req.method) && !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) fail(415, 'json_required', 'JSON 요청만 허용합니다.');
}
async function body(req, limit = MAX_BODY) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, 'body_too_large', limit === MAX_BODY ? '설화와 검수 입력 합계는 600KB 이하여야 합니다.' : '사진 요청은 1MB 이하여야 합니다.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { fail(400, 'invalid_json', 'JSON 형식을 확인하세요.'); }
}

/** A loopback-only development workbench, not production identity/authentication. */
export function createReviewHandler({ root = ROOT, dataDir = resolve(root, '.local/review'), getBootstrap } = {}) {
  const database = resolve(dataDir, 'projects.json');
  const bootstrapLoader = getBootstrap || (async () => (await import('./data.mjs')).getBootstrap(root));
  let queue = Promise.resolve();
  const serial = fn => {
    const task = queue.then(fn);
    queue = task.catch(() => {});
    return task;
  };
  async function load() {
    try {
      const db = JSON.parse(await readFile(database, 'utf8'));
      for (const project of db.projects) {
        // Only pre-generalization records lack the field. Explicit null means unlinked.
        if (!Object.hasOwn(project, 'runtimeId')) { project.runtimeId = 'NAJU-01'; project.runtimeUse = 'target'; }
        project.assetReviewMode ??= 'individual'; project.sceneCaptures ??= []; project.sceneReviews ??= []; project.objectIssues ??= [];
        for (const session of project.sessions || []) if (!Object.hasOwn(session, 'runtimeId')) { session.runtimeId = 'NAJU-01'; session.runtimeUse = 'target'; }
      }
      return db;
    }
    catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, projects: [] }; throw error; }
  }
  async function save(db) {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const temp = `${database}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(db, null, 2), { mode: 0o600 });
    await rename(temp, database);
  }
  return async function reviewMiddleware(req, res, next = () => {}) {
    const path = (req.url || '').split('?')[0];
    if (!path.startsWith('/__review/')) return next();
    const send = (status, value) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(JSON.stringify(value));
    };
    try {
      guardRequest(req);
      const input = ['POST', 'PATCH'].includes(req.method) ? await body(req, path.endsWith('/scene-captures') ? 1_000_000 : MAX_BODY) : null;
      if (req.method === 'GET' && path === '/__review/bootstrap') return send(200, { ...await bootstrapLoader(root), reviewPolicy: { requiredChecks: REQUIRED_CHECKS, localOnly: true, decisions: ['approved', 'rejected', 'held'] } });
      const result = await serial(async () => {
        // Read current references when this operation owns the queue, not before waiting.
        const bootstrap = await bootstrapLoader(root);
        const db = await load();
        if (path === '/__review/projects') {
          if (req.method === 'GET') return { status: 200, value: db.projects.map(p => publicProject(p, bootstrap)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
          if (req.method !== 'POST') fail(405, 'method_not_allowed', '허용되지 않는 요청입니다.');
          if (db.projects.length >= 1000) fail(409, 'storage_limit', '로컬 검수 프로젝트 한도에 도달했습니다.');
          const timestamp = now();
          const project = {
            id: randomUUID(), caseId: text(input.caseId ?? '', '설화 코드', 200), ...runtimeBinding(input, bootstrap), title: text(input.title, '제목', 400, true),
            sourceText: text(input.sourceText, '설화 원문', 400_000, true), sourceName: text(input.sourceName || '직접 입력', '자료 이름', 1000),
            synopsis: text(input.synopsis || '', '시놉시스', 50_000), sceneNotes: text(input.sceneNotes || '', '씬 구성', 80_000),
            selectedAssetIds: assetIds(input.selectedAssetIds || [], bootstrap), revision: 1,
            createdAt: timestamp, updatedAt: timestamp, decisions: [], sessions: [], inspections: [], sceneCaptures: [], sceneReviews: [], objectIssues: [], history: [],
          };
          project.assetReviewMode = assetReviewMode(input.assetReviewMode ?? 'individual', project, bootstrap);
          assignReferences(project, bootstrap);
          project.referenceSnapshot = referenceSnapshot(bootstrap, project, timestamp);
          db.projects.push(project); await save(db);
          return { status: 201, value: publicProject(project, bootstrap) };
        }
        const match = path.match(/^\/__review\/projects\/([a-zA-Z0-9-]+)(?:\/(decisions|sessions|inspections|scene-captures|scene-reviews|object-issues)(?:\/([a-zA-Z0-9-]+)\/(events))?)?$/);
        if (!match) fail(404, 'not_found', '검수 경로를 찾을 수 없습니다.');
        const [, id, action, sessionId] = match;
        const project = db.projects.find(p => p.id === id);
        if (!project) fail(404, 'project_not_found', '검수 프로젝트를 찾을 수 없습니다.');
        if (req.method === 'GET' && !action) return { status: 200, value: publicProject(project, bootstrap) };
        if (!((req.method === 'PATCH' && !action) || (req.method === 'POST' && action))) fail(405, 'method_not_allowed', '허용되지 않는 요청입니다.');
        if (!sessionId && input.expectedRevision !== project.revision) fail(409, 'revision_conflict', '다른 창에서 입력이 변경되었습니다. 최신 내용을 다시 불러오세요.', { currentRevision: project.revision });
        const timestamp = now();
        if (req.method === 'PATCH' && !action) {
          const previousSnapshot = inputSnapshot(project);
          const changed = [];
          const limits = { caseId: 200, title: 400, sourceText: 400_000, sourceName: 1000, synopsis: 50_000, sceneNotes: 80_000 };
          const validityBefore = referenceValidity(project, bootstrap);
          const drift = project.runtimeUse === 'target' && (!validityBefore.source || !validityBefore.game);
          if (Object.hasOwn(input, 'runtimeId') || Object.hasOwn(input, 'runtimeUse')) {
            const binding = runtimeBinding(input, bootstrap, project);
            for (const key of ['runtimeId', 'runtimeUse']) if (binding[key] !== project[key]) { project[key] = binding[key]; changed.push(key); }
          }
          const nextReviewMode = assetReviewMode(input.assetReviewMode ?? project.assetReviewMode, project, bootstrap);
          if (nextReviewMode !== project.assetReviewMode) { project.assetReviewMode = nextReviewMode; changed.push('assetReviewMode'); }
          for (const [key, limit] of Object.entries(limits)) if (Object.hasOwn(input, key)) {
            const value = text(input[key], key, limit, ['title', 'sourceText'].includes(key));
            if (value !== project[key]) { project[key] = value; changed.push(key); }
          }
          if (Object.hasOwn(input, 'selectedAssetIds')) {
            const value = assetIds(input.selectedAssetIds, bootstrap);
            if (JSON.stringify(value) !== JSON.stringify(project.selectedAssetIds)) { project.selectedAssetIds = value; changed.push('selectedAssetIds'); }
          }
          const invalidated = [];
          // This initial workbench conservatively rechecks every gate after an edit.
          for (const decision of project.decisions) if (!decision.invalidatedAt) { decision.invalidatedAt = timestamp; decision.invalidationReason = drift ? 'reference_changed' : changed.length ? 'input_changed' : 'review_reopened'; invalidated.push(decision.id); }
          project.history.push({ id: randomUUID(), type: 'revision', at: timestamp, previousRevision: project.revision, previousSnapshot, changed, invalidatedDecisionIds: invalidated });
          project.revision += 1; assignReferences(project, bootstrap);
          project.referenceSnapshot = referenceSnapshot(bootstrap, project, timestamp);
        } else if (req.method === 'POST' && action === 'decisions' && !sessionId) {
          const { gate, decision } = input;
          if (!GATES.includes(gate) || !['approved', 'rejected', 'held'].includes(decision)) fail(400, 'invalid_decision', '관문과 판정 값을 확인하세요.');
          if (currentDecision(project, gate)) fail(409, 'already_decided', '이미 판정한 관문입니다. 입력 저장으로 새 검수 회차를 시작하세요.');
          const reviewer = text(input.reviewer, '검수자', 200, true);
          const note = text(input.note || '', '판정 의견', 15_000, decision !== 'approved');
          if (!Array.isArray(input.checks) || input.checks.some(c => !REQUIRED_CHECKS[gate].includes(c))) fail(400, 'invalid_checks', '확인 항목을 다시 선택하세요.');
          const checks = [...new Set(input.checks)];
          if (decision === 'approved') {
            const problems = blockers(project, gate, bootstrap);
            for (const check of REQUIRED_CHECKS[gate]) if (!checks.includes(check)) problems.push(issue('check_required', `${check} 항목의 사람 확인이 필요합니다.`));
            if (problems.length) fail(422, 'approval_blocked', '승인 조건이 충족되지 않았습니다.', { blockers: problems });
          }
          project.decisions.push({ id: randomUUID(), at: timestamp, gate, decision, reviewer, note, checks, projectRevision: project.revision, runtimeId: project.runtimeId, runtimeUse: project.runtimeUse, assetReviewMode: project.assetReviewMode, gameRevision: project.gameRevision, sourceRevision: project.sourceRevision, evidenceSessionIds: project.sessions.filter(s => s.projectRevision === project.revision).map(s => s.id), inspectionIds: project.inspections.filter(i => i.projectRevision === project.revision).map(i => i.id), sceneReviewIds: project.sceneReviews.filter(value => value.projectRevision === project.revision).map(value => value.id) });
        } else if (req.method === 'POST' && action === 'scene-captures' && !sessionId) {
          const runtime = runtimeFor(project, bootstrap);
          const session = project.sessions.find(value => value.id === input.sessionId);
          if (!runtime || input.gameRevision !== project.gameRevision || runtime.revision !== project.gameRevision || (input.runtimeProfile ?? null) !== (runtime.profile ?? null)) fail(409, 'capture_stale', '사진과 현재 게임 버전·실행 구성이 다릅니다. 새 검수 화면에서 다시 촬영하세요.');
          if (!diagnosticReady(project, session, bootstrap)) fail(422, 'capture_session_required', '현재 회차의 진단 화면이 실제 렌더된 뒤 사진을 저장하세요. 오류·정상 플레이·과거 세션은 사용할 수 없습니다.');
          const view = (runtime.visualViews || []).find(value => value.id === input.viewId);
          if (!view) fail(400, 'unknown_visual_view', '게임에 등록된 검수 시점만 촬영할 수 있습니다.');
          const image = jpegImage(input.imageDataUrl);
          const previous = latestCapture(project, view.id);
          if (previous?.imageSha256 === image.imageSha256 && previous.sessionId === session.id) return { status: 200, value: publicProject(project, bootstrap) };
          if (project.sceneCaptures.filter(value => value.viewId === view.id && value.projectRevision === project.revision).length >= CAPTURE_LIMITS.perViewRevision) fail(409, 'capture_view_limit', '한 검수 회차에서 같은 시점은 세 번까지 저장할 수 있습니다. 기존 사진을 보존하려면 새 회차를 시작하세요.');
          if (project.sceneCaptures.length >= CAPTURE_LIMITS.projectCount || project.sceneCaptures.reduce((sum, value) => sum + (value.bytes || 0), 0) + image.bytes > CAPTURE_LIMITS.projectBytes) fail(409, 'capture_storage_limit', '이 프로젝트의 사진 보존 한도에 도달했습니다. 기록을 내보낸 뒤 새 프로젝트에서 검수하세요. 기존 사진은 삭제하지 않았습니다.');
          project.sceneCaptures.push({ id: randomUUID(), at: timestamp, viewId: view.id, zoneId: view.zoneId, zoneName: view.zoneName, label: view.label, view: structuredClone(view), sessionId: session.id, projectRevision: project.revision, runtimeId: project.runtimeId, runtimeUse: project.runtimeUse, gameRevision: project.gameRevision, runtimeProfile: runtime.profile ?? null, ...image, clientReported: true, evidenceSource: 'client-captured-game-frame' });
          if (project.assetReviewMode === 'scene') invalidateForEvidence(project, 'assets', timestamp, 'scene_recaptured');
        } else if (req.method === 'POST' && action === 'scene-reviews' && !sessionId) {
          const states = sceneReviewStatus(project, bootstrap);
          const state = Object.hasOwn(states, input.zoneId) ? states[input.zoneId] : null;
          if (!state) fail(400, 'unknown_visual_zone', '게임에 등록된 구역을 선택하세요.');
          if (!['approved', 'rejected', 'held'].includes(input.decision)) fail(400, 'invalid_decision', '구역 판정 값을 확인하세요.');
          const reviewer = text(input.reviewer, '검수자', 200, true);
          const note = text(input.note || '', '구역 판정 의견', 6000, input.decision !== 'approved');
          if (!Array.isArray(input.captureIds) || input.captureIds.length !== state.requiredViewIds.length || new Set(input.captureIds).size !== input.captureIds.length || input.captureIds.some(id => !state.latestCaptureIds.includes(id))) fail(409, 'capture_conflict', '이 구역의 모든 최신 사진을 기준으로 판정하세요. 사진이 바뀌었다면 다시 불러오세요.');
          if (state.blockers.some(value => ['scene_capture_required', 'scene_capture_stale'].includes(value.code))) fail(422, 'scene_capture_not_current', '현재 검수 세션의 모든 구역 사진이 필요합니다. 다시 촬영하세요.');
          const bindingProblem = runtimeBlocker(project, bootstrap);
          if (input.decision === 'approved' && bindingProblem) fail(422, bindingProblem.code, bindingProblem.message);
          if (project.sceneReviews.length >= 500) fail(409, 'scene_review_limit', '구역 판정 보존 한도에 도달했습니다. 기록을 내보내고 새 프로젝트를 시작하세요.');
          project.sceneReviews.push({ id: randomUUID(), at: timestamp, zoneId: state.zoneId, zoneName: state.zoneName, decision: input.decision, reviewer, note, captureIds: [...state.latestCaptureIds], projectRevision: project.revision, gameRevision: project.gameRevision, runtimeId: project.runtimeId, runtimeUse: project.runtimeUse, scope: 'visual-shape-and-placement-only' });
          if (project.assetReviewMode === 'scene') invalidateForEvidence(project, 'assets', timestamp, 'scene_review_changed');
        } else if (req.method === 'POST' && action === 'object-issues' && !sessionId) {
          const bindingProblem = runtimeBlocker(project, bootstrap);
          if (bindingProblem) fail(422, bindingProblem.code, bindingProblem.message);
          const runtime = runtimeFor(project, bootstrap);
          const session = project.sessions.find(value => value.id === input.sessionId);
          if (input.gameRevision !== project.gameRevision || runtime.revision !== project.gameRevision) fail(409, 'object_issue_stale', '물체를 선택한 게임과 현재 버전이 다릅니다. 새 검수 화면에서 선택하세요.');
          if (!diagnosticReady(project, session, bootstrap)) fail(422, 'object_issue_session_required', '현재 회차의 진단 화면이 실제 렌더된 뒤 물체 의견을 기록하세요.');
          if (!['rejected', 'change_requested'].includes(input.disposition)) fail(400, 'invalid_disposition', '물체 의견은 반려 또는 수정 요청으로 기록하세요.');
          const reviewer = text(input.reviewer, '검수자', 200, true);
          const note = text(input.note, '물체 수정 의견', 6000, true);
          const object = selectedObject(input.object);
          const signature = hash(JSON.stringify({ sessionId: session.id, object, reviewer, note, disposition: input.disposition }));
          if (project.objectIssues.some(value => value.projectRevision === project.revision && value.signature === signature)) return { status: 200, value: publicProject(project, bootstrap) };
          if (project.objectIssues.length >= 200) fail(409, 'object_issue_limit', '물체 의견 보존 한도에 도달했습니다. 기록을 내보내고 새 프로젝트를 시작하세요.');
          project.objectIssues.push({ id: randomUUID(), at: timestamp, sessionId: session.id, object, disposition: input.disposition, reviewer, note, signature, status: 'unresolved', projectRevision: project.revision, gameRevision: project.gameRevision, runtimeId: project.runtimeId, runtimeProfile: runtime.profile ?? null, clientReported: true, identityVerified: false });
          invalidateForEvidence(project, project.assetReviewMode === 'scene' ? 'assets' : 'space', timestamp, 'object_issue_added');
        } else if (req.method === 'POST' && action === 'inspections' && !sessionId) {
          const asset = (bootstrap.assets || []).find(a => a.id === input.assetId);
          if (!asset || !project.selectedAssetIds.includes(asset.id)) fail(400, 'invalid_asset', '선택한 에셋만 검수할 수 있습니다.');
          const validity = referenceValidity(project, bootstrap);
          if ((project.runtimeUse === 'target' && (!validity.source || !validity.game)) || input.gameRevision !== project.gameRevision || input.assetSha256 !== asset.sha256) fail(409, 'inspection_stale', '화면이 사용한 에셋·게임 버전과 현재 참조가 다릅니다. 입력을 다시 저장하고 미리보기를 새로 여세요.');
          const procedural = asset.type === 'procedural';
          if (!(procedural ? input.status === 'observed' : ['loaded', 'failed'].includes(input.status))) fail(400, 'invalid_inspection', procedural ? '팔레트 에셋은 개별 사람 관찰 기록이 필요합니다.' : 'GLB는 실제 미리보기 로드 결과를 기록해야 합니다.');
          const note = text(input.note || '', '미리보기 메모', 3000, procedural);
          let observedSession = null;
          if (procedural) {
            const bindingProblem = runtimeBlocker(project, bootstrap);
            if (bindingProblem) fail(422, bindingProblem.code, bindingProblem.message);
            if ((asset.runtimeId ?? 'NAJU-01') !== project.runtimeId) fail(422, 'asset_runtime_mismatch', '연결한 게임의 팔레트가 아닙니다.');
            observedSession = project.sessions.find(s => s.id === input.sessionId);
            if (!isReadySession(project, observedSession)) fail(422, 'observation_session_required', '현재 입력 버전의 정상 검수 세션이 실제로 렌더된 뒤 관찰을 기록하세요. 진단·만료된 세션은 사용할 수 없습니다.');
          }
          if (project.inspections.length >= 5000) fail(409, 'inspection_limit', '검수 기록 한도에 도달했습니다.');
          project.inspections.push({ id: randomUUID(), at: timestamp, assetId: asset.id, assetSha256: input.assetSha256, gameRevision: input.gameRevision, projectRevision: project.revision, status: input.status, note, ...(observedSession ? { sessionId: observedSession.id } : {}) });
        } else if (req.method === 'POST' && action === 'sessions' && !sessionId) {
          if (!['space', 'play'].includes(input.kind) || !['normal', 'diagnostic'].includes(input.mode)) fail(400, 'invalid_session', '검수 세션 유형을 확인하세요.');
          if (project.sessions.length >= 200) fail(409, 'session_limit', '프로젝트의 검수 세션 한도에 도달했습니다.');
          const runtime = runtimeFor(project, bootstrap);
          if (!runtime) fail(422, project.runtimeId ? 'runtime_missing' : 'runtime_required', '게임을 연결한 뒤 세션을 여세요. 설화·GLB 검수는 게임 없이 진행할 수 있습니다.');
          if (runtime.available === false) fail(422, 'runtime_unavailable', `연결 게임의 공개 에셋 구성이 준비되지 않았습니다. ${runtime.reviewBlockers?.[0] || ''}`);
          if (runtime.profile && !RUNTIME_PROFILES.has(runtime.profile)) fail(422, 'runtime_profile_unknown', '지원하지 않는 게임 실행 구성입니다.');
          const validity = referenceValidity(project, bootstrap);
          if (!validity.game || (project.runtimeUse === 'target' && !validity.source)) fail(409, 'input_drift', '연결 게임의 참조 파일이 바뀌었습니다. 입력을 다시 저장하세요.');
          const token = randomBytes(32).toString('base64url');
          const session = { id: randomUUID(), kind: input.kind, mode: input.mode, runtimeId: project.runtimeId, runtimeUse: project.runtimeUse, runtimeProfile: runtime.profile ?? null, at: timestamp, projectRevision: project.revision, gameRevision: project.gameRevision, tokenHash: hash(token), events: [] };
          project.sessions.push(session); project.updatedAt = timestamp; await save(db);
          const { tokenHash, ...visible } = session;
          return { status: 201, value: { ...visible, token } };
        } else if (req.method === 'POST' && action === 'sessions' && sessionId) {
          const session = project.sessions.find(s => s.id === sessionId);
          if (!session || !tokenMatches(input.token, session.tokenHash)) fail(403, 'invalid_session_token', '유효하지 않은 검수 세션입니다.');
          const runtime = runtimeFor(project, bootstrap);
          const validity = referenceValidity(project, bootstrap);
          if (session.projectRevision !== project.revision || (session.runtimeId ?? 'NAJU-01') !== project.runtimeId || !runtime || runtime.available === false || session.gameRevision !== runtime.revision || (session.runtimeProfile && session.runtimeProfile !== runtime.profile) || (project.runtimeUse === 'target' && !validity.source)) fail(409, 'session_stale', '입력 또는 연결 게임이 바뀌어 세션 기록을 중단했습니다. 새 세션을 여세요.');
          if (!Array.isArray(input.events) || !input.events.length || input.events.length > 30 || session.events.length + input.events.length > 1000) fail(400, 'event_limit', '한 번에 1~30개, 세션당 1,000개까지 기록할 수 있습니다.');
          let accepted = 0;
          for (const event of input.events) {
            if (!event || !EVENTS.has(event.type)) fail(400, 'invalid_event', '지원하지 않는 관찰 기록입니다.');
            const clientId = event.id == null ? null : text(event.id, '관찰 ID', 120, true);
            if (clientId && session.events.some(e => e.clientId === clientId)) continue;
            const detail = event.detail ?? {};
            if (typeof detail !== 'object' || detail === null || Array.isArray(detail) || Buffer.byteLength(JSON.stringify(detail)) > 12_000) fail(400, 'invalid_event_detail', '관찰 기록 상세는 12KB 이하 객체여야 합니다.');
            if (detail.gameRevision && detail.gameRevision !== session.gameRevision) fail(409, 'session_stale', '화면과 검수 세션의 게임 버전이 다릅니다.');
            if (session.runtimeProfile && detail.runtimeProfile !== session.runtimeProfile) fail(409, 'runtime_profile_mismatch', '화면의 실행 구성과 검수 세션의 실행 구성이 다릅니다. 새 세션을 여세요.');
            if (event.type === 'ready' && session.runtimeProfile === 'naju-public-sf-v1' && !publicReady(detail)) fail(422, 'public_assets_not_ready', '공개 에셋이 모두 로드되어 실제 공간에 적용된 뒤 준비 완료를 기록해야 합니다.');
            session.events.push({ id: randomUUID(), clientId, type: event.type, at: timestamp, clientAt: typeof event.at === 'string' ? event.at.slice(0, 80) : null, detail });
            accepted += 1;
          }
          project.updatedAt = timestamp; await save(db);
          return { status: 200, value: { accepted, total: session.events.length } };
        } else fail(405, 'method_not_allowed', '허용되지 않는 요청입니다.');
        project.updatedAt = timestamp; await save(db);
        return { status: 200, value: publicProject(project, bootstrap) };
      });
      send(result.status, result.value);
    } catch (error) {
      send(error.status || 500, { error: error.code || 'review_server_error', message: error.status ? error.message : '로컬 검수 기록을 읽거나 저장하지 못했습니다.', ...(error.details || {}) });
    }
  };
}

export function reviewWorkbenchPlugin(options = {}) {
  return { name: 'local-review-workbench', apply: 'serve', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      let path;
      try { path = decodeURIComponent((req.url || '').split('?')[0]); } catch { path = req.url; }
      if (/(?:^|\/)\.local(?:\/|$)/.test(path)) { res.statusCode = 404; return res.end('Not found'); }
      next();
    });
    server.middlewares.use(createReviewHandler(options));
  } };
}
export default reviewWorkbenchPlugin;
