import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { briefBlockers, currentBrief, decideBriefItem } from './brief.mjs';
import { realHeight, scaledHeight } from './realSize.mjs';
import * as agentTrial from './agentTrial.mjs';
import { noSymlinkFile } from './data.mjs';
import { PUBLIC_MANIFEST, commitManifestText, fileSha256, finite, placementAsset, placementPosition, readPublicManifest } from './manifestPlace.mjs';

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
// 검수 배치 변경안(10/15 규약 §3) — 공개 GLB(_sf_local)만, 공간 승인 때 manifest 「놓기」에 덧붙인다
const PLACEMENT_LIMIT = 300;
const SCENE_COUNT = 5;
const DISPOSITIONS = ['rejected', 'change_requested', 'regenerate'];
// AI 공간 배치 초안 가져오기(규약 §6) — 한 번에 300개까지, 출처는 ai-draft 만
const IMPORT_ORIGINS = ['ai-draft'];
const PLACEMENT_ORIGINS = ['ai-draft', 'human'];
const IMPORT_ITEM_LIMIT = 300;
/** 씬 탭 경계 여유(m) — naju01/src/review/sceneScope.ts SCENE_MARGIN_M 과 같은 값 */
const SCENE_MARGIN_M = 8;
const SITE_PLAN = 'naju01/src/plan/sitePlan.ts';
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
function sceneNumber(value) {
  if (value == null || value === 0) return null;
  if (!Number.isInteger(value) || value < 0 || value > SCENE_COUNT) fail(400, 'invalid_scene', `씬 번호는 0(전체)~${SCENE_COUNT} 사이의 정수여야 합니다.`);
  return value;
}
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits || 0;
function currentPlacements(project) {
  return (project.placements || []).filter(value => value.status === 'proposed' && value.projectRevision === project.revision && value.gameRevision === project.gameRevision);
}
function checksFor(project, gate) {
  return gate === 'assets' && currentPlacements(project).length ? [...REQUIRED_CHECKS.assets, 'placements'] : REQUIRED_CHECKS[gate];
}
// ── AI 배치 초안 가져오기(규약 §6) ─────────────────────────────────────────
// 구역 표는 게임 도면(sitePlan.ts ZONES · CORE)을 글자로 읽는다 — 표를 고치면 경계도 따라 바뀐다(코드 실행 없음).
let sitePlanCache = null;
async function siteZones(root) {
  const safe = await noSymlinkFile(root, SITE_PLAN);
  if (!safe.ok) fail(422, 'site_plan_unavailable', `${SITE_PLAN}: ${safe.reason} — 구역 경계를 읽지 못해 배치 초안을 가져오지 않았습니다.`);
  const stat = await lstat(join(root, SITE_PLAN));
  const key = `${root}:${stat.mtimeMs}:${stat.size}`;
  if (sitePlanCache?.key === key) return sitePlanCache.value;
  const source = await readFile(join(root, SITE_PLAN), 'utf8');
  const range = (block, name) => {
    const found = block.match(new RegExp(`\\b${name}:\\s*\\[\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*\\]`));
    return found ? [Number(found[1]), Number(found[2])] : null;
  };
  const coreBlock = source.match(/export const CORE\b[^=]*=\s*(\{[^}]*\})/)?.[1] || '';
  const zonesBlock = source.match(/export const ZONES\b[^=]*=\s*\[([\s\S]*?)\n\];/)?.[1] || '';
  const zones = zonesBlock.split(/\n\s*\{/).map(block => {
    const code = block.match(/\bcode:\s*"([^"]+)"/)?.[1];
    const x = range(block, 'x'); const z = range(block, 'z');
    const scenes = [...(block.match(/\bscenes:\s*"([^"]*)"/)?.[1] || '').matchAll(/S(\d)/g)].map(found => Number(found[1]));
    return code && x && z ? { code, x, z, scenes } : null;
  }).filter(Boolean);
  const core = { x: range(coreBlock, 'x'), z: range(coreBlock, 'z') };
  if (!zones.length || !core.x || !core.z || [...zones.flatMap(zone => [...zone.x, ...zone.z]), ...core.x, ...core.z].some(value => !Number.isFinite(value))) fail(422, 'site_plan_unavailable', '게임 도면의 구역 표(ZONES·CORE)를 읽지 못해 배치 초안을 가져오지 않았습니다.');
  const value = { zones, core };
  sitePlanCache = { key, value };
  return value;
}
const inside = (bounds, x, z) => x >= bounds.x[0] && x <= bounds.x[1] && z >= bounds.z[0] && z <= bounds.z[1];
const grow = (zone, margin) => ({ x: [zone.x[0] - margin, zone.x[1] + margin], z: [zone.z[0] - margin, zone.z[1] + margin] });
/** 씬 N 의 경계(구역 합 + 여유) — 게임 sceneScope.sceneScopeFor 와 같은 계산. 0/null = 전체(CORE) */
function sceneBounds(site, sceneNo) {
  if (!sceneNo) return site.core;
  const zones = site.zones.filter(zone => zone.scenes.includes(sceneNo));
  if (!zones.length) return null;
  return grow({ x: [Math.min(...zones.map(zone => zone.x[0])), Math.max(...zones.map(zone => zone.x[1]))], z: [Math.min(...zones.map(zone => zone.z[0])), Math.max(...zones.map(zone => zone.z[1]))] }, SCENE_MARGIN_M);
}
/** 점의 구역 — 구역 안이면 그 구역, 아니면 여유 8 m 안의 가장 가까운 구역(씬이 있으면 그 씬 구역 중에서) */
function zoneForPoint(site, x, z, sceneNo) {
  let best = null; let bestDistance = SCENE_MARGIN_M;
  for (const zone of site.zones) {
    if (sceneNo && !zone.scenes.includes(sceneNo)) continue;
    const distance = Math.hypot(Math.max(zone.x[0] - x, 0, x - zone.x[1]), Math.max(zone.z[0] - z, 0, z - zone.z[1]));
    if (distance <= bestDistance) { bestDistance = distance; best = zone.code; }
  }
  return best;
}
/** 라이브러리 ID(public:<파일> · khs:<파일>) → /_sf_local 주소. 라이브러리 색인이 있으면 이름·출처도 거기서 */
async function importAsset(root, item, libraryItems) {
  const assetId = item.assetId == null ? null : text(item.assetId, '에셋 ID', 200, true);
  if (item.url != null && typeof item.url !== 'string') fail(400, 'invalid_asset_url', '에셋 주소를 확인하세요.');
  if (!assetId && !item.url) fail(400, 'invalid_placement_asset', 'assetId 또는 url 중 하나가 필요합니다.');
  const known = libraryItems?.find(entry => (assetId && entry.id === assetId) || (!assetId && item.url && entry.url === item.url)) || null;
  if (known && !known.placeable) fail(400, 'asset_not_placeable', `${known.nameKo || known.id}: 아직 3D가 없는 항목이라 배치할 수 없습니다. 「생성 요청」으로 남기세요.`);
  let url = item.url ?? known?.url ?? null;
  let source = item.source ?? known?.source ?? null;
  if (!url && assetId) {
    const found = assetId.match(/^(public|khs):(.+\.glb)$/u);
    if (!found) fail(400, 'asset_not_placeable', `${assetId}: 공개 3D(public:)·국가유산(khs:) GLB 의 ID 만 배치할 수 있습니다.`);
    source ??= found[1];
    url = `/_sf_local/${found[1] === 'khs' ? 'khs/' : ''}${found[2]}`;
  }
  const decoded = value => { try { return decodeURIComponent(value).normalize('NFC'); } catch { return value; } };
  if (known && decoded(known.url) !== decoded(url)) fail(409, 'placement_asset_mismatch', `${assetId || url}: 에셋 ID 와 주소가 라이브러리와 다릅니다.`);
  return placementAsset(root, { id: assetId ?? known?.id ?? undefined, url, source: source ?? 'public', nameKo: item.nameKo ?? known?.nameKo ?? undefined, ...(item.sha256 != null ? { sha256: item.sha256 } : {}) }, { requireNames: false });
}
/** 가져올 항목 하나 확인 — 문제가 있으면 fail(던짐), 통과하면 저장할 값 */
async function importItem(root, site, item, libraryItems) {
  if (!item || typeof item !== 'object' || Array.isArray(item) || Buffer.byteLength(JSON.stringify(item)) > 6000) fail(400, 'invalid_item', '항목은 6KB 이하 JSON 객체여야 합니다.');
  const sceneNo = sceneNumber(item.sceneNo);
  const raw = item.position;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(400, 'invalid_placement_position', '배치 위치는 {x, z, y?}(m) 형식이어야 합니다.');
  const snap = raw.y == null;
  const position = placementPosition({ x: raw.x, y: snap ? 0 : raw.y, z: raw.z });
  if (snap) position.y = null;
  const rotationY = ((round(finite(item.rotationY ?? 0, '회전(도)', -3600, 3600), 2) % 360) + 360) % 360;
  const scale = round(finite(item.scale ?? 1, '크기 배율', 0.05, 20), 4);
  const reqId = item.reqId == null ? null : text(item.reqId, '요구 ID', 200, true);
  const reason = item.reason == null ? '' : text(item.reason, '배치 이유', 3000);
  let zoneId = item.zoneId == null || item.zoneId === '' ? null : text(item.zoneId, '구역', 200);
  if (zoneId) {
    const zone = site.zones.find(value => value.code === zoneId);
    if (!zone) fail(400, 'unknown_zone', `${zoneId}: 게임 도면에 없는 구역입니다(${site.zones.map(value => value.code).join('·')}).`);
    if (sceneNo && !zone.scenes.includes(sceneNo)) fail(422, 'zone_not_in_scene', `${zoneId} 는 씬${sceneNo} 의 구역이 아닙니다.`);
    if (!inside(grow(zone, SCENE_MARGIN_M), position.x, position.z)) fail(422, 'placement_out_of_bounds', `X ${position.x} · Z ${position.z} m 는 ${zoneId} 구역 경계(+${SCENE_MARGIN_M} m) 밖입니다.`);
  } else {
    const bounds = sceneBounds(site, sceneNo);
    if (!bounds) fail(422, 'scene_without_zones', `씬${sceneNo} 에 연결된 구역이 도면에 없습니다.`);
    if (!inside(bounds, position.x, position.z)) fail(422, 'placement_out_of_bounds', `X ${position.x} · Z ${position.z} m 는 ${sceneNo ? `씬${sceneNo} 경계` : '전체 공간(CORE)'} 밖입니다.`);
    zoneId = zoneForPoint(site, position.x, position.z, sceneNo);
  }
  if (item.groundSnap != null && typeof item.groundSnap !== 'boolean') fail(400, 'invalid_ground_snap', 'groundSnap 은 참·거짓 값이어야 합니다.');
  const asset = await importAsset(root, item, libraryItems);
  const heightM = asset.naturalHeightM && round(asset.naturalHeightM * scale, 4);
  if (!heightM) fail(422, 'placement_height_unknown', `${asset.nameKo}: GLB 에서 실제 높이를 읽지 못해 게임 데이터로 옮길 수 없습니다.`);
  return { sceneNo, zoneId: zoneId || '', asset, position, rotationY, scale, heightM, reqId, reason, groundSnap: snap || item.groundSnap === true };
}
/**
 * 에이전트 시험 배치 한 항목 → importItem. 키는 realSize 로 정한다(GLB 원래 키를 그대로 쓰면 stone21 이 30 m 가 된다).
 * 씬 번호는 사람 기획의 씬→구역 표에 묶여 있어 넣지 않는다(에이전트 씬은 reason 머리에).
 */
async function trialImport(root, site, item, libraryItems, reason) {
  const base = { assetId: item.asset_id, position: { x: item.x, z: item.z }, rotationY: item.rotationY, scale: 1, reqId: item.req_id, reason, zoneId: item.zone, sceneNo: null };
  const probe = await importItem(root, site, base, libraryItems);
  const natural = probe.asset.naturalHeightM;
  const heightM = Number.isFinite(item.heightM) ? item.heightM : scaledHeight(await realHeight(root, { file: probe.asset.file, naturalHeightM: natural, boundsM: item.boundsM }), item.scale);
  if (!natural) return probe;
  return importItem(root, site, { ...base, scale: Math.min(20, Math.max(0.05, heightM / natural)) }, libraryItems);
}
/**
 * 공정 2판 배치(layout2.json) → 게임 「놓기」 항목. 에셋마다 한 항목(자리 여럿) — 수백 개 배경도 인스턴스 하나로.
 * 키m = 에셋 실제 키(realSize), 자리마다 키배 = 그 자리 키 / 실제 키. 에셋 확인(placementAsset)은 에셋마다 한 번.
 */
// 배경 식물 → 게임 무리 이름(바람 흔들림이 이름의 「나무·덤불·풀·꽃·갈대」를 보고 붙는다, 10/20). 바위·자갈은 흔들리지 않는다
const PLANT_GROUP = { tree: '에이전트.나무', shrub: '에이전트.덤불', grass: '에이전트.풀', flower: '에이전트.꽃', reed: '에이전트.갈대' };
async function trialPlacesV2(root, detail, off) {
  const { buildLibrary } = await import('./library.mjs');
  const library = new Map((await buildLibrary(root)).items.map(i => [i.id, i]));
  const byAsset = new Map(); const skipped = [];
  for (const s of detail.layout2.spots) {
    if (!s.assetId || off.has(s.assetId) || off.has(`layer:${s.layer}`)) continue; // 자리 표식(marker)은 그리지 않는다
    const key = `${s.assetId}#${(s.scenes || []).join(',')}`; // 씬이 다르면 따로 묶는다(게임이 씬마다 켜고 끈다)
    (byAsset.get(key) || byAsset.set(key, []).get(key)).push(s);
  }
  const places = [];
  for (const [key, spots] of byAsset) {
    const assetId = key.split('#')[0];
    const item = library.get(assetId);
    try {
      if (!item) throw Object.assign(new Error('라이브러리에 없는 id'), { status: 404 });
      const asset = await placementAsset(root, { id: item.id, nameKo: item.nameKo, url: item.url, source: item.source === 'khs' ? 'khs' : 'public' });
      const real = await realHeight(root, { file: asset.file, naturalHeightM: asset.naturalHeightM, boundsM: item.boundsM });
      const clampH = h => Math.min(real.range[1], Math.max(real.range[0], h));
      // 낱개(시설·이야기 물건·인물)는 에셋 실제 키를 따른다 — LLM 이 적은 크기는 길이·높이가 섞여(배 길이 4 m 를 키로) 거대해졌다(10/19).
      //   실제 키를 모를 때(분류 기본값)만 LLM 크기를 범위 안에서 쓴다. 배경 층은 LLM 크기(나무 3~8 m 등)를 범위 안에서.
      const knownReal = !/기본값/.test(real.source);
      const heightOf = s => (s.layer !== 'environment' && knownReal ? real.heightM * (Number.isFinite(s.hf) ? s.hf : 0.95 + ((Math.abs(Math.round(s.x * 31 + s.z * 17)) % 11) / 100)) : clampH(s.heightM || real.heightM)); // hf: 배치 코드가 정한 크기 배(줄·무리 0.86~1.12)
      // 원경판(10/20) — 같은 이름의 _far.glb 가 있으면 넘긴다(게임이 22 m 밖은 그것으로 그려 면수를 줄인다)
      const farFile = asset.file.replace(/(_lod\d+)?\.glb$/u, '_far.glb');
      const hasFar = farFile !== asset.file && existsSync(join(root, 'public/_sf_local', farFile));
      places.push({ ...(hasFar ? { 원경file: farFile } : {}), 에셋: { id: item.id, url: asset.url, nameKo: item.nameKo, source: asset.source }, 원래키: asset.naturalHeightM, file: asset.file, 키m: real.heightM, 묻힘m: 0, 자리: spots.map(s => [s.x, s.z, s.rotationY || 0, +(heightOf(s) / real.heightM).toFixed(3), +(s.dy || 0).toFixed(3)]), /* 5번째 = 앉힘 높이 보정(배는 수면·바위는 낮은 쪽, scatter.mjs seatSpot) */ 항목: spots.map(s => `${s.itemId}|${assetId}|${String(s.name || '').replace(/\|/g, '/').slice(0, 60)}`), 메모: `에이전트 시험 · ${item.nameKo} × ${spots.length} · ${[...new Set(spots.map(s => s.layer))].join('/')}`, 에이전트: true, ...(spots[0].scenes?.length ? { 씬: spots[0].scenes } : {}), ...(PLANT_GROUP[spots[0].cls] ? { 무리: PLANT_GROUP[spots[0].cls] } : {}) });
    } catch (error) {
      if (!error?.status) throw error;
      skipped.push({ assetId, count: spots.length, reason: error.message });
    }
  }
  return { trialId: detail.id, version: 2, places, skipped, off: [...off] };
}
/** 기존 「놓기」 항목 형식: { file, 키m, 묻힘m, 자리:[[X m, Z m, 돌림°, 키배]], 메모 } + 출처 */
function placeEntry(placement) {
  return {
    file: placement.asset.file, 키m: placement.heightM, 묻힘m: placement.groundY == null ? 0 : round(placement.groundY - placement.position.y),
    자리: [[placement.position.x, placement.position.z, round(placement.rotationY, 2), 1]],
    메모: `${placement.at.slice(5, 10).replace('-', '/')} 검수 배치 — ${placement.asset.nameKo}${placement.sceneNo ? ` · 씬${placement.sceneNo}` : ''}${placement.zoneId ? ` · ${placement.zoneId}` : ''}${placement.note ? ` · ${placement.note.slice(0, 200)}` : ''} (${placement.reviewer})`,
    출처: `review:${placement.id}`,
  };
}
/** 승인 기록 전에 모든 확인을 끝낸다 — 여기서 실패하면 아무것도 기록하지 않는다. */
async function prepareManifestApply(root, placements) {
  const { raw, manifest } = await readPublicManifest(root);
  const problems = [];
  for (const placement of placements) {
    const fileSafe = await noSymlinkFile(root, placement.asset.path);
    if (!fileSafe.ok) problems.push(issue('placement_asset_missing', `${placement.asset.nameKo}: ${fileSafe.reason}`));
    else if (await fileSha256(join(root, placement.asset.path)) !== placement.asset.sha256) problems.push(issue('placement_asset_changed', `${placement.asset.nameKo}: 변경안을 기록한 뒤 파일 내용이 바뀌었습니다. 철회하고 다시 배치하세요.`));
    if ((manifest.놓기 || []).some(entry => entry?.출처 === `review:${placement.id}`)) problems.push(issue('placement_already_applied', `${placement.asset.nameKo}: 이미 manifest에 반영된 변경안입니다.`));
  }
  if (problems.length) fail(422, 'approval_blocked', '배치 변경안을 게임 데이터에 반영할 수 없어 승인을 기록하지 않았습니다.', { blockers: problems });
  const entries = placements.map(placeEntry);
  const next = { ...manifest, 놓기: [...(manifest.놓기 || []), ...entries] };
  return { raw, text: `${JSON.stringify(next, null, 2)}\n`, entries, ids: placements.map(value => value.id) };
}
function commitManifestApply(root, dataDir, apply, timestamp) {
  return commitManifestText(root, dataDir, apply.raw, apply.text, timestamp);
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
    if (openIssues.length) out.push(issue('object_issues_unresolved', `현재 공간에 반려·수정·새로 생성 요청 ${openIssues.length}건이 있습니다. 수정 후 새 검수 회차로 확인하세요.`));
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
  copy.decisionChecks = Object.fromEntries(GATES.map(gate => [gate, checksFor(project, gate)]));
  copy.placements ??= [];
  copy.currentPlacementIds = currentPlacements(project).map(value => value.id);
  copy.regenerationRequests = copy.objectIssues.filter(value => value.disposition === 'regenerate');
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
  // 라이브러리 색인(tools/review/library.mjs, 별도 작업) — 파일이 없으면 503 으로 알리고 나머지 검수는 그대로 쓴다
  let library;
  const libraryRoute = async () => {
    if (library) return library;
    // 없을 때는 기억하지 않는다 — 서버를 켠 뒤에 파일이 생겨도 다음 요청에서 바로 잡히게
    try { library = (await import('./library.mjs')).libraryRoutes(root); }
    catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !String(error.message).includes('library.mjs')) throw error;
      return null;
    }
    return library;
  };
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
        project.assetReviewMode ??= 'individual'; project.sceneCaptures ??= []; project.sceneReviews ??= []; project.objectIssues ??= []; project.placements ??= [];
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
      if (path === '/__review/library' || path.startsWith('/__review/library/')) {
        const route = await libraryRoute();
        if (!route) return send(503, { error: 'library_unavailable', message: '라이브러리 색인이 아직 준비되지 않았습니다.' });
        if (await route(req, res, path, send)) return;
        return send(404, { error: 'not_found', message: '라이브러리 경로를 찾을 수 없습니다.' });
      }
      const input = ['POST', 'PATCH'].includes(req.method) ? await body(req, path.endsWith('/scene-captures') ? 1_000_000 : MAX_BODY) : null;
      // ── 에이전트 시험(agentTrial.mjs, 10/19) — 긴 LLM 단계는 직렬 큐 밖에서 돈다. 검수 기록을 만드는 /space 만 큐 안에서 ──
      if (path === '/__review/trials' || path.startsWith('/__review/trials/')) {
        if (path === '/__review/trials/llm-status' && req.method === 'GET') return send(200, await (await import('../llm/local.mjs')).localStatus());
        const m = path.match(/^\/__review\/trials(?:\/(preset)|\/([a-f0-9-]{36})(?:\/(steps)\/(s0[1-9]|s10)\/(estimate|run)|\/(missing|compare|space|places|view|llm|feedback|relayout|spot-edit))?)?$/);
        if (!m) return send(404, { error: 'not_found', message: '에이전트 시험 경로를 찾을 수 없습니다.' });
        const [, preset, trialId, , stepId, stepAction, sub] = m;
        if (preset && req.method === 'GET') return send(200, await agentTrial.presetSource(root));
        if (!trialId && req.method === 'GET') return send(200, { trials: await agentTrial.listTrials(root), steps: agentTrial.STEPS, defaultBudgetUsd: agentTrial.DEFAULT_BUDGET_USD });
        if (!trialId && req.method === 'POST') return send(201, await agentTrial.createTrial(root, input));
        if (trialId && !stepId && !sub && req.method === 'GET') return send(200, await agentTrial.trialDetail(root, trialId));
        if (stepAction === 'estimate' && req.method === 'POST') return send(200, await agentTrial.estimateStep(root, trialId, stepId));
        if (stepAction === 'run' && req.method === 'POST') return send(202, await agentTrial.startStep(root, trialId, stepId));
        // 코드만 다시 앉히기(LLM 없음·비용 0) — 앉힘 규칙·지형 칸 지도를 고친 뒤 같은 계획으로 다시 깐다
        if (sub === 'spot-edit' && req.method === 'POST') return send(200, await agentTrial.editSpot(root, trialId, input)); // 배치 화면에서 사람이 자리 고침·빼기(10/20)
        if (sub === 'relayout' && req.method === 'POST') return send(200, await agentTrial.relayoutTrial(root, trialId));
        if (sub === 'missing' && req.method === 'POST') return send(200, await agentTrial.decideMissing(root, trialId, input));
        if (sub === 'compare' && req.method === 'GET') return send(200, await agentTrial.compareWithHuman(root, trialId));
        if (sub === 'feedback' && req.method === 'POST') return send(200, await agentTrial.setFeedback(root, trialId, input));
        if (sub === 'llm' && req.method === 'POST') return send(200, await agentTrial.setLlm(root, trialId, input));
        if (sub === 'view' && req.method === 'POST') return send(200, await agentTrial.setView(root, trialId, input));
        // 배치 화면(10/19) — 게임이 &trial=<id> 로 읽는 「놓기」 항목. layout.accepted 를 /space 와 같은 확인(importItem)으로 바꾼다. 게임 데이터(manifest)는 건드리지 않는다
        if (sub === 'places' && req.method === 'GET') {
          const detail = await agentTrial.trialDetail(root, trialId);
          const off = new Set(detail.view?.off || []);
          if (detail.layout2?.version === 2) return send(200, await trialPlacesV2(root, detail, off));
          const site = await siteZones(root);
          let libraryItems = null;
          try { libraryItems = (await (await import('./library.mjs')).buildLibrary(root)).items; } catch { libraryItems = null; }
          const places = []; const skipped = [];
          for (const item of detail.layout?.accepted || []) {
            if (off.has(item.asset_id)) continue;
            try {
              const value = await trialImport(root, site, item, libraryItems, '');
              places.push({ file: value.asset.file, 키m: value.heightM, 묻힘m: 0, 자리: [[value.position.x, value.position.z, value.rotationY, 1]], 메모: `에이전트 시험 ${item.req_id} · ${value.asset.nameKo} · ${item.scene_id} · ${item.zone}`, 에이전트: true });
            } catch (error) {
              if (!error?.status) throw error;
              skipped.push({ reqId: item.req_id, assetId: item.asset_id, reason: error.message });
            }
          }
          return send(200, { trialId, places, skipped, off: [...off] });
        }
        if (sub !== 'space' || req.method !== 'POST') return send(405, { error: 'method_not_allowed', message: '허용되지 않는 요청입니다.' });
      }
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
            createdAt: timestamp, updatedAt: timestamp, decisions: [], sessions: [], inspections: [], sceneCaptures: [], sceneReviews: [], objectIssues: [], placements: [], history: [],
          };
          project.assetReviewMode = assetReviewMode(input.assetReviewMode ?? 'individual', project, bootstrap);
          assignReferences(project, bootstrap);
          project.referenceSnapshot = referenceSnapshot(bootstrap, project, timestamp);
          db.projects.push(project); await save(db);
          return { status: 201, value: publicProject(project, bootstrap) };
        }
        // 에이전트 시험 → 빈 지형 검수 기록 만들기 + 배치 초안 가져오기(공간 승인해도 manifest 반영 안 함)
        const trialSpace = path.match(/^\/__review\/trials\/([a-f0-9-]{36})\/space$/);
        if (trialSpace) {
          const detail = await agentTrial.trialDetail(root, trialSpace[1]);
          if (!detail.layout?.accepted?.length && detail.layout2?.version !== 2) fail(409, 'layout_missing', '배치 초안이 없습니다.'); // 2판은 검수 기록만 만들고 배치는 게임이 &trial= 로 읽는다
          const runtime = runtimes(bootstrap).find(r => r.id === 'NAJU-01-EMPTY');
          if (!runtime) fail(422, 'runtime_missing', '빈 지형 실행 구성(NAJU-01-EMPTY)이 없습니다. 공개 에셋 구성을 확인하세요.');
          const reviewer = text(input.reviewer || '', '검수자', 200, true);
          const timestamp = now();
          let project = detail.reviewProjectId ? db.projects.find(p => p.id === detail.reviewProjectId) : null;
          if (!project) {
            project = {
              id: randomUUID(), caseId: 'AGENT-TRIAL', runtimeId: runtime.id, runtimeUse: 'target', title: `[에이전트 시험] ${detail.title}`.slice(0, 400),
              sourceText: detail.source.text, sourceName: `${detail.source.name} · 에이전트 시험 입력`.slice(0, 900),
              synopsis: (detail.files['AI-02.md'] || '').slice(0, 49_000), sceneNotes: (detail.files['AI-04.md'] || '').slice(0, 79_000),
              selectedAssetIds: [], revision: 1, createdAt: timestamp, updatedAt: timestamp, decisions: [], sessions: [], inspections: [], sceneCaptures: [], sceneReviews: [], objectIssues: [], placements: [], history: [],
              agentTrial: { trialId: detail.id, noApply: true },
            };
            project.assetReviewMode = assetReviewMode('scene', project, bootstrap);
            assignReferences(project, bootstrap);
            project.referenceSnapshot = referenceSnapshot(bootstrap, project, timestamp);
            db.projects.push(project);
          }
          const site = await siteZones(root);
          let libraryItems = null;
          try { libraryItems = (await (await import('./library.mjs')).buildLibrary(root)).items; } catch { libraryItems = null; }
          const accepted = []; const rejected = [];
          for (const [index, item] of (detail.layout?.accepted || []).entries()) {
            try {
              const value = await trialImport(root, site, item, libraryItems, `[${item.scene_id}] ${item.reason || ''}`.slice(0, 2900)); // 씬 번호는 사람 기획의 씬→구역 표에 묶여 있어 넣지 않는다(에이전트 씬은 reason 머리에)
              const signature = hash(JSON.stringify({ origin: 'ai-draft', trialId: detail.id, reqId: value.reqId, url: value.asset.url, position: value.position, rotationY: value.rotationY, scale: value.scale }));
              if (project.placements.some(other => other.signature === signature && other.status === 'proposed')) continue;
              project.placements.push({ id: randomUUID(), at: timestamp, reviewer, note: '', projectRevision: project.revision, gameRevision: project.gameRevision, runtimeId: project.runtimeId, sessionId: null, sceneNo: value.sceneNo, zoneId: value.zoneId, asset: value.asset, position: value.position, rotationY: value.rotationY, scale: value.scale, groundY: null, heightM: value.heightM, heightSource: 'glb-bounds', signature, status: 'proposed', origin: 'ai-draft', trialId: detail.id, reqId: value.reqId, reason: value.reason, groundSnap: value.groundSnap, clientReported: true });
              accepted.push(index);
            } catch (error) {
              if (!error?.status) throw error;
              rejected.push({ index, reqId: item.req_id, assetId: item.asset_id, reason: error.message });
            }
          }
          project.history.push({ id: randomUUID(), type: 'agent-trial-imported', at: timestamp, projectRevision: project.revision, trialId: detail.id, accepted: accepted.length, rejected: rejected.length });
          project.updatedAt = timestamp; await save(db);
          await agentTrial.setReviewProject(root, detail.id, project.id);
          return { status: 200, value: { projectId: project.id, accepted: accepted.length, rejected } };
        }
        // 설화·기획 핵심 검수 카드(brief.mjs) — 읽기 · 카드 판정. 카드 만들기(API 호출)는 터미널 `npm run story:brief` 만 한다.
        const briefMatch = path.match(/^\/__review\/projects\/([a-zA-Z0-9-]+)\/brief(?:\/items\/([a-zA-Z0-9-]+))?$/);
        if (briefMatch) {
          const target = db.projects.find(p => p.id === briefMatch[1]);
          if (!target) fail(404, 'project_not_found', '검수 프로젝트를 찾을 수 없습니다.');
          const command = `npm run story:brief -- ${target.id}`;
          if (req.method === 'GET' && !briefMatch[2]) return { status: 200, value: { ...await currentBrief(dataDir, target), command } };
          if (req.method === 'POST' && briefMatch[2]) {
            try { await decideBriefItem(dataDir, target, { ...input, itemId: briefMatch[2] }); }
            catch (error) { fail(error.status || 500, 'brief_error', error.message); }
            return { status: 200, value: { ...await currentBrief(dataDir, target), command } };
          }
          fail(405, 'method_not_allowed', '허용되지 않는 요청입니다.');
        }
        const match = path.match(/^\/__review\/projects\/([a-zA-Z0-9-]+)(?:\/(decisions|sessions|inspections|scene-captures|scene-reviews|object-issues|placements)(?:\/([a-zA-Z0-9-]+)\/(events|withdraw)|\/(import))?)?$/);
        if (!match) fail(404, 'not_found', '검수 경로를 찾을 수 없습니다.');
        const [, id, action, childId, sub, importRoute] = match;
        if (sub && !((action === 'sessions' && sub === 'events') || (action === 'placements' && sub === 'withdraw'))) fail(404, 'not_found', '검수 경로를 찾을 수 없습니다.');
        if (importRoute && action !== 'placements') fail(404, 'not_found', '검수 경로를 찾을 수 없습니다.');
        const sessionId = action === 'sessions' ? childId : undefined;
        const project = db.projects.find(p => p.id === id);
        if (!project) fail(404, 'project_not_found', '검수 프로젝트를 찾을 수 없습니다.');
        if (req.method === 'GET' && !action) return { status: 200, value: publicProject(project, bootstrap) };
        if (req.method === 'GET' && action === 'placements' && !childId && !importRoute) {
          // 배치 변경안 조회 — ?origin=ai-draft|human · ?trialId= · ?current=1(이번 회차 제안만)
          const params = new URL(req.url || '', 'http://localhost').searchParams;
          const origin = params.get('origin') || '';
          if (origin && !PLACEMENT_ORIGINS.includes(origin)) fail(400, 'invalid_origin', `origin 은 ${PLACEMENT_ORIGINS.join('·')} 중 하나여야 합니다.`);
          const trialId = params.get('trialId') || '';
          const currentIds = new Set(currentPlacements(project).map(value => value.id));
          const placements = project.placements.filter(value => (!origin || (value.origin || 'human') === origin) && (!trialId || value.trialId === trialId) && (params.get('current') !== '1' || currentIds.has(value.id)));
          return { status: 200, value: { projectId: project.id, revision: project.revision, gameRevision: project.gameRevision, currentPlacementIds: [...currentIds], placements: structuredClone(placements) } };
        }
        if (!((req.method === 'PATCH' && !action) || (req.method === 'POST' && action))) fail(405, 'method_not_allowed', '허용되지 않는 요청입니다.');
        // 일괄 가져오기는 바깥 생성 공정이 보내므로 expectedRevision 이 없어도 된다(주면 맞아야 한다)
        const revisionOptional = Boolean(importRoute) && input.expectedRevision === undefined;
        if (!sessionId && !revisionOptional && input.expectedRevision !== project.revision) fail(409, 'revision_conflict', '다른 창에서 입력이 변경되었습니다. 최신 내용을 다시 불러오세요.', { currentRevision: project.revision });
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
          const allowedChecks = checksFor(project, gate);
          if (!Array.isArray(input.checks) || input.checks.some(c => !allowedChecks.includes(c))) fail(400, 'invalid_checks', '확인 항목을 다시 선택하세요.');
          const checks = [...new Set(input.checks)];
          const proposals = currentPlacements(project);
          let apply = null;
          if (decision === 'approved') {
            const problems = blockers(project, gate, bootstrap);
            if (gate === 'source') problems.push(...briefBlockers((await currentBrief(dataDir, project)).brief));
            for (const check of allowedChecks) if (!checks.includes(check)) problems.push(check === 'placements' ? issue('placements_check_required', `배치 변경안 ${proposals.length}건을 확인하세요.`) : issue('check_required', `${check} 항목의 사람 확인이 필요합니다.`));
            if (problems.length) fail(422, 'approval_blocked', '승인 조건이 충족되지 않았습니다.', { blockers: problems });
            // 공간 승인 = 배치 변경안 반영. 파일·manifest 확인을 승인 기록 전에 모두 끝낸다.
            // 에이전트 시험 기록은 승인해도 게임 데이터(manifest)에 반영하지 않는다(10/19)
            if (gate === 'space' && proposals.length && !project.agentTrial?.noApply) apply = await prepareManifestApply(root, proposals);
          }
          const record = { id: randomUUID(), at: timestamp, gate, decision, reviewer, note, checks, projectRevision: project.revision, runtimeId: project.runtimeId, runtimeUse: project.runtimeUse, assetReviewMode: project.assetReviewMode, gameRevision: project.gameRevision, sourceRevision: project.sourceRevision, evidenceSessionIds: project.sessions.filter(s => s.projectRevision === project.revision).map(s => s.id), inspectionIds: project.inspections.filter(i => i.projectRevision === project.revision).map(i => i.id), sceneReviewIds: project.sceneReviews.filter(value => value.projectRevision === project.revision).map(value => value.id), placementIds: proposals.map(value => value.id) };
          project.decisions.push(record);
          if (apply) {
            // ① 승인을 먼저 저장한다(이 시점의 gameRevision 으로). ② 그다음 manifest 를 바꾼다 →
            // 게임 버전 해시가 바뀌어 이 승인을 포함한 현재 판정은 「버전 변경」이 된다(의도). 반영 사실은 이력에 남긴다.
            record.placementApply = 'pending';
            project.updatedAt = timestamp; await save(db);
            let written;
            try { written = await commitManifestApply(root, dataDir, apply, timestamp); }
            catch {
              record.placementApply = 'failed';
              project.history.push({ id: randomUUID(), type: 'placements-apply-failed', at: timestamp, projectRevision: project.revision, decisionId: record.id, placementIds: apply.ids });
              await save(db);
              fail(500, 'manifest_write_failed', '공간 승인은 기록했지만 manifest 반영에 실패했습니다. 변경안은 제안 상태로 남아 있습니다. 재검수 회차를 열어 다시 배치·승인하세요.');
            }
            for (const placement of proposals) Object.assign(placement, { status: 'applied', appliedAt: timestamp, decisionId: record.id, manifestEntryId: `review:${placement.id}` });
            record.placementApply = 'applied';
            project.history.push({ id: randomUUID(), type: 'placements-applied', at: timestamp, projectRevision: project.revision, gameRevision: project.gameRevision, decisionId: record.id, placementIds: apply.ids, manifest: PUBLIC_MANIFEST, backup: written.backup, previousManifestSha256: written.previousSha256, manifestSha256: written.sha256, entries: apply.entries });
          }
        } else if (req.method === 'POST' && action === 'placements' && importRoute) {
          // AI 공간 배치 초안 일괄 가져오기(규약 §6) — 세션 없이, 항목마다 일반 배치와 같은 에셋 확인 + 구역 경계 확인
          const bindingProblem = runtimeBlocker(project, bootstrap);
          if (bindingProblem) fail(422, bindingProblem.code, bindingProblem.message);
          const runtime = runtimeFor(project, bootstrap);
          if (runtime.revision !== project.gameRevision) fail(409, 'placement_stale', '연결 게임 버전이 바뀌었습니다. 재검수 회차를 연 뒤 다시 가져오세요.');
          if (!IMPORT_ORIGINS.includes(input.origin)) fail(400, 'invalid_origin', '가져오기 origin 은 "ai-draft" 여야 합니다.');
          const reviewer = text(input.reviewer, '검수자', 200, true);
          const trialId = text(input.trialId, '시행 ID', 200, true);
          if (!Array.isArray(input.items) || !input.items.length) fail(400, 'invalid_items', 'items 는 1개 이상의 배열이어야 합니다.');
          if (input.items.length > IMPORT_ITEM_LIMIT) fail(413, 'import_too_many', `한 번에 ${IMPORT_ITEM_LIMIT}개까지 가져올 수 있습니다(${input.items.length}개).`);
          const site = await siteZones(root);
          let libraryItems = null;
          try { libraryItems = (await (await import('./library.mjs')).buildLibrary(root)).items; } catch { libraryItems = null; }
          const accepted = []; const rejected = [];
          for (const [index, item] of input.items.entries()) {
            const label = { index, reqId: typeof item?.reqId === 'string' ? item.reqId.slice(0, 200) : null, assetId: typeof item?.assetId === 'string' ? item.assetId.slice(0, 200) : null, url: typeof item?.url === 'string' ? item.url.slice(0, 300) : null };
            try {
              const value = await importItem(root, site, item, libraryItems);
              const signature = hash(JSON.stringify({ origin: input.origin, trialId, reqId: value.reqId, url: value.asset.url, position: value.position, rotationY: value.rotationY, scale: value.scale }));
              if (project.placements.some(other => other.projectRevision === project.revision && other.status === 'proposed' && other.signature === signature)) fail(409, 'placement_duplicate', '같은 시행·자리·에셋의 변경안이 이미 제안 상태로 있습니다.');
              if (project.placements.length >= PLACEMENT_LIMIT) fail(409, 'placement_limit', `배치 변경안 보존 한도(${PLACEMENT_LIMIT}건)에 도달해 이 항목은 넣지 못했습니다.`);
              const record = { id: randomUUID(), at: timestamp, reviewer, note: '', projectRevision: project.revision, gameRevision: project.gameRevision, runtimeId: project.runtimeId, sessionId: null, sceneNo: value.sceneNo, zoneId: value.zoneId, asset: value.asset, position: value.position, rotationY: value.rotationY, scale: value.scale, groundY: null, heightM: value.heightM, heightSource: 'glb-bounds', signature, status: 'proposed', origin: input.origin, trialId, reqId: value.reqId, reason: value.reason, groundSnap: value.groundSnap, clientReported: true };
              project.placements.push(record); accepted.push(record.id);
            } catch (error) {
              if (!error?.status) throw error;
              rejected.push({ ...label, code: error.code || 'invalid_item', reason: error.message });
            }
          }
          if (!accepted.length) fail(422, 'import_all_rejected', '가져올 수 있는 항목이 없습니다. rejected 의 이유를 확인하세요.', { accepted, rejected });
          project.history.push({ id: randomUUID(), type: 'placements-imported', at: timestamp, projectRevision: project.revision, gameRevision: project.gameRevision, origin: input.origin, trialId, reviewer, acceptedIds: accepted, rejectedCount: rejected.length });
          invalidateForEvidence(project, 'assets', timestamp, 'placements_imported');
          project.updatedAt = timestamp; await save(db);
          return { status: 200, value: { project: publicProject(project, bootstrap), accepted, rejected } };
        } else if (req.method === 'POST' && action === 'placements' && !childId) {
          const bindingProblem = runtimeBlocker(project, bootstrap);
          if (bindingProblem) fail(422, bindingProblem.code, bindingProblem.message);
          const runtime = runtimeFor(project, bootstrap);
          const session = project.sessions.find(value => value.id === input.sessionId);
          if (input.gameRevision !== project.gameRevision || runtime.revision !== project.gameRevision) fail(409, 'placement_stale', '배치한 게임과 현재 버전이 다릅니다. 새 검수 화면에서 다시 배치하세요.');
          if (!diagnosticReady(project, session, bootstrap)) fail(422, 'placement_session_required', '현재 회차의 둘러보기 화면이 실제 렌더된 뒤 배치 변경안을 기록하세요.');
          const reviewer = text(input.reviewer, '검수자', 200, true);
          const note = text(input.note || '', '배치 메모', 3000);
          const position = placementPosition(input.position);
          const rotationY = ((round(finite(input.rotationY ?? 0, '회전(도)', -3600, 3600), 2) % 360) + 360) % 360;
          const scale = round(finite(input.scale ?? 1, '크기 배율', 0.05, 20), 4);
          const groundY = input.groundY == null ? null : round(finite(input.groundY, '땅 높이(m)', -100_000, 100_000));
          const zoneId = text(input.zoneId || '', '구역', 200);
          const sceneNo = sceneNumber(input.sceneNo);
          const asset = await placementAsset(root, input.asset);
          const heightM = input.heightM == null ? asset.naturalHeightM && round(asset.naturalHeightM * scale, 4) : round(finite(input.heightM, '실제 높이(m)', 0.01, 500), 4);
          if (!heightM) fail(422, 'placement_height_unknown', '에셋의 실제 높이를 알 수 없어 게임 데이터로 옮길 수 없습니다. 게임 화면에서 다시 배치하세요.');
          const replacesId = input.replaces == null ? null : text(input.replaces, '바꿀 변경안 ID', 100, true);
          const signature = hash(JSON.stringify({ sessionId: session.id, url: asset.url, position, rotationY, scale, reviewer, ...(replacesId ? { replaces: replacesId } : {}) }));
          if (project.placements.some(value => value.projectRevision === project.revision && value.status === 'proposed' && value.signature === signature)) return { status: 200, value: publicProject(project, bootstrap) };
          // 변경안 고치기(규약 §6-2) — 옛 변경안 철회와 새 변경안 기록을 한 번에 저장한다(같은 줄 세운 쓰기 안)
          const replaced = replacesId ? project.placements.find(value => value.id === replacesId) : null;
          if (replacesId && !replaced) fail(404, 'placement_not_found', '고칠 배치 변경안을 찾을 수 없습니다.');
          if (replaced && replaced.status !== 'proposed') fail(409, 'placement_not_proposed', '제안 상태의 변경안만 고칠 수 있습니다. 목록을 새로 읽어 주세요.');
          if (replaced && (replaced.projectRevision !== project.revision || replaced.gameRevision !== project.gameRevision)) fail(409, 'placement_past_revision', '지난 회차의 변경안은 기록으로만 남습니다.');
          if (project.placements.length >= PLACEMENT_LIMIT) fail(409, 'placement_limit', '배치 변경안 보존 한도에 도달했습니다. 기록을 내보내고 새 프로젝트를 시작하세요.');
          const record = { id: randomUUID(), at: timestamp, reviewer, note, projectRevision: project.revision, gameRevision: project.gameRevision, runtimeId: project.runtimeId, sessionId: session.id, sceneNo, zoneId, asset, position, rotationY, scale, groundY, heightM, heightSource: input.heightM == null ? 'glb-bounds' : 'game-reported', signature, status: 'proposed', origin: 'human', groundSnap: false, clientReported: true };
          if (replaced) {
            Object.assign(record, { replaces: replaced.id, ...(replaced.trialId ? { trialId: replaced.trialId } : {}), ...(replaced.reqId ? { reqId: replaced.reqId } : {}), ...(replaced.reason ? { reason: replaced.reason } : {}), editedFrom: replaced.origin || 'human' });
            Object.assign(replaced, { status: 'withdrawn', withdrawnAt: timestamp, withdrawnBy: reviewer, replacedBy: record.id });
          }
          project.placements.push(record);
          invalidateForEvidence(project, 'assets', timestamp, replaced ? 'placement_replaced' : 'placement_added');
        } else if (req.method === 'POST' && action === 'placements' && sub === 'withdraw') {
          const placement = project.placements.find(value => value.id === childId);
          if (!placement) fail(404, 'placement_not_found', '배치 변경안을 찾을 수 없습니다.');
          if (placement.status !== 'proposed') fail(409, 'placement_not_proposed', '제안 상태의 변경안만 철회할 수 있습니다.');
          if (placement.projectRevision !== project.revision) fail(409, 'placement_past_revision', '지난 회차의 변경안은 기록으로만 남습니다.');
          const reviewer = text(input.reviewer, '검수자', 200, true);
          Object.assign(placement, { status: 'withdrawn', withdrawnAt: timestamp, withdrawnBy: reviewer });
          invalidateForEvidence(project, 'assets', timestamp, 'placement_withdrawn');
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
          if (!DISPOSITIONS.includes(input.disposition)) fail(400, 'invalid_disposition', '물체 의견은 수정 요청·반려·반려 후 새로 생성 요청 중 하나로 기록하세요.');
          const sceneNo = sceneNumber(input.sceneNo);
          const reviewer = text(input.reviewer, '검수자', 200, true);
          const note = text(input.note, '물체 수정 의견', 6000, true);
          const object = selectedObject(input.object);
          const signature = hash(JSON.stringify({ sessionId: session.id, object, reviewer, note, disposition: input.disposition }));
          if (project.objectIssues.some(value => value.projectRevision === project.revision && value.signature === signature)) return { status: 200, value: publicProject(project, bootstrap) };
          if (project.objectIssues.length >= 200) fail(409, 'object_issue_limit', '물체 의견 보존 한도에 도달했습니다. 기록을 내보내고 새 프로젝트를 시작하세요.');
          project.objectIssues.push({ id: randomUUID(), at: timestamp, sessionId: session.id, object, disposition: input.disposition, reviewer, note, signature, status: 'unresolved', sceneNo, ...(input.disposition === 'regenerate' ? { generation: 'requested-not-connected' } : {}), projectRevision: project.revision, gameRevision: project.gameRevision, runtimeId: project.runtimeId, runtimeProfile: runtime.profile ?? null, clientReported: true, identityVerified: false });
          invalidateForEvidence(project, project.assetReviewMode === 'scene' ? 'assets' : 'space', timestamp, 'object_issue_added');
          // 에이전트 시험 물체(groupName 「에이전트:항목id|에셋id」) → 시험 항목 판정으로도 남긴다(10/19) — 10 단계가 원인 단계로 돌린다
          if (project.agentTrial?.trialId && /^에이전트:/.test(object.groupName)) {
            const [itemId] = object.groupName.slice('에이전트:'.length).split('|');
            const verdict = { change_requested: 'adjust', rejected: 'remove', regenerate: 'regenerate' }[input.disposition];
            try { await agentTrial.setFeedback(root, project.agentTrial.trialId, { itemId, verdict, note, reviewer, name: object.name, source: 'object-issue' }); }
            catch (error) { if (!error?.status) throw error; }
          }
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
