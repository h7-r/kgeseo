// 공개 에셋 manifest 「놓기」 덧붙이기 — 검수 서버(공간 승인 반영)와 5174 편집기(즉시 반영)가 같이 쓴다 (10/15).
//   검수_배치편집_프로토콜_1015 §3 의 규칙 그대로: 공개 GLB(public/_sf_local)만 · AI허브 금지 · 심볼릭 링크 금지 ·
//   sha256 대조 · GLB 머리(JSON 덩이)에서 높이 · 쓰기 전 .local/review/manifest_bak_<시각>.json 백업 · 임시 파일 → rename.
//   검수 작업대(5180)의 변경안 → 승인 흐름은 server.mjs 가 그대로 쥔다. 여기는 공용 도구와 편집기 전용 쓰기(editor:)만.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative as relativePath, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { forbidden, noSymlinkFile } from './data.mjs';

export const PUBLIC_ROOT = 'public/_sf_local';
export const PUBLIC_MANIFEST = `${PUBLIC_ROOT}/manifest.json`;
/** 편집기(5174)가 직접 놓은 항목의 출처 머리 — 되돌리기는 이 머리가 붙은 항목만 뺀다 */
export const EDITOR_SOURCE_PREFIX = 'editor:';
export const SCALE_RANGE = Object.freeze([0.05, 20]);

const hash = value => createHash('sha256').update(value).digest('hex');
export const fail = (status, code, message, details) => { throw Object.assign(new Error(message), { status, code, details }); };
export const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits || 0;
const text = (value, name, max, required = false) => {
  if (typeof value !== 'string' || Buffer.byteLength(value) > max || (required && !value.trim())) {
    fail(400, 'invalid_field', `${name}: ${required ? '빈 값 없이 ' : ''}${max}바이트 이하의 문자열을 입력하세요.`);
  }
  return value;
};
export function finite(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(400, 'invalid_placement_number', `${name}: ${min}~${max} 사이의 숫자여야 합니다.`);
  return value;
}
export function placementPosition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_placement_position', '배치 위치는 {x, y, z}(m) 형식이어야 합니다.');
  return { x: round(finite(value.x, 'X(m)', -100_000, 100_000)), y: round(finite(value.y, 'Y(m)', -100_000, 100_000)), z: round(finite(value.z, 'Z(m)', -100_000, 100_000)) };
}
export async function fileSha256(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
/** URL(/_sf_local/…) → _sf_local 안의 상대 GLB 경로. data.mjs 의 공개 manifest 경로 규칙과 같다. */
export function publicAssetRef(url) {
  if (typeof url !== 'string' || url.length > 1000) fail(400, 'invalid_asset_url', '에셋 주소를 확인하세요.');
  let decoded;
  try { decoded = decodeURIComponent(url); } catch { fail(400, 'invalid_asset_url', '에셋 주소를 해석할 수 없습니다.'); }
  if (!decoded.startsWith('/_sf_local/')) fail(400, 'asset_not_public', '배치할 수 있는 에셋은 /_sf_local/ 아래의 공개 GLB뿐입니다.');
  const ref = decoded.slice('/_sf_local/'.length).normalize('NFC');
  if (forbidden(decoded) || forbidden(ref)) fail(400, 'asset_forbidden', 'AI허브 원본·가공 자료는 배치할 수 없습니다.');
  if (!ref.endsWith('.glb') || /[\\:%?#]/u.test(ref) || ref.includes('\0') || ref.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) fail(400, 'invalid_asset_url', '에셋 주소는 _sf_local 안의 상대 GLB 경로여야 합니다.');
  return ref;
}
const normalizedComponent = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
function nodeMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix;
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1]; const [sx, sy, sz] = node.scale || [1, 1, 1]; const [tx, ty, tz] = node.translation || [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
function multiply(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let sum = 0; for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k]; out[c * 4 + r] = sum; }
  return out;
}
/** GLB JSON 덩이만 읽어 장면 전체 높이(Y 범위, 원본 단위=m)를 구한다. 실패하면 null(코드 실행·압축 해제 없음). */
export async function glbHeight(file) {
  const size = await glbSize(file);
  return size ? size[1] : null;
}
/** 같은 방식으로 [가로 X, 키 Y, 깊이 Z] (원본 단위) — 배치의 발판(footprint) 계산용(10/19) */
export async function glbSize(file) {
  let handle;
  try {
    handle = await open(file, 'r');
    const header = Buffer.alloc(20);
    await handle.read(header, 0, 20, 0);
    if (header.readUInt32LE(0) !== 0x46546c67 || header.readUInt32LE(16) !== 0x4e4f534a) return null;
    const length = header.readUInt32LE(12);
    if (length > 16 * 1024 * 1024) return null;
    const chunk = Buffer.alloc(length);
    await handle.read(chunk, 0, length, 20);
    const gltf = JSON.parse(chunk.toString('utf8'));
    const nodes = gltf.nodes || [];
    if (nodes.length > 20_000) return null;
    const children = new Set(nodes.flatMap(node => node.children || []));
    const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? nodes.map((_, index) => index).filter(index => !children.has(index));
    let minY = Infinity; let maxY = -Infinity; let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    const visit = (index, parent, depth) => {
      const node = nodes[index];
      if (!node || depth > 64) return;
      const world = multiply(parent, nodeMatrix(node));
      for (const primitive of gltf.meshes?.[node.mesh]?.primitives || []) {
        const accessor = gltf.accessors?.[primitive.attributes?.POSITION];
        if (!accessor?.min || !accessor?.max) continue;
        const divisor = accessor.normalized ? normalizedComponent[accessor.componentType] || 1 : 1;
        const min = accessor.min.map(value => accessor.normalized ? Math.max(value / divisor, -1) : value); const max = accessor.max.map(value => value / divisor);
        for (const cx of [min[0], max[0]]) for (const cy of [min[1], max[1]]) for (const cz of [min[2], max[2]]) {
          const y = world[1] * cx + world[5] * cy + world[9] * cz + world[13];
          const x = world[0] * cx + world[4] * cy + world[8] * cz + world[12];
          const z = world[2] * cx + world[6] * cy + world[10] * cz + world[14];
          minY = Math.min(minY, y); maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
      }
      for (const child of node.children || []) visit(child, world, depth + 1);
    };
    for (const index of roots) visit(index, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
    const height = maxY - minY;
    return Number.isFinite(height) && height > 0 ? [round(maxX - minX, 4), round(height, 4), round(maxZ - minZ, 4)] : null;
  } catch { return null; }
  finally { await handle?.close(); }
}
/**
 * 배치할 에셋 확인 — public/khs 출처 · /_sf_local/ 아래 .glb · AI허브 금지 · 심볼릭 링크 금지 · sha256 대조.
 * requireNames=false 면 id·nameKo 가 없어도 파일 이름으로 채운다(편집기).
 */
export async function placementAsset(root, value, { requireNames = true } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 4000) fail(400, 'invalid_placement_asset', '배치할 에셋 정보를 확인하세요.');
  const source = value.source ?? 'public';
  if (!['public', 'khs'].includes(source)) fail(400, 'asset_not_placeable', '공개 3D·국가유산 GLB만 배치할 수 있습니다. 아직 3D가 없는 항목은 「생성 요청」으로 남기세요.');
  const file = publicAssetRef(value.url);
  const fallbackName = file.split('/').at(-1).replace(/\.glb$/u, '');
  const id = requireNames || value.id != null ? text(value.id, '에셋 ID', 200, true) : `${source}:${file}`;
  const nameKo = requireNames || value.nameKo != null ? text(value.nameKo, '에셋 이름', 300, true) : fallbackName;
  const path = `${PUBLIC_ROOT}/${file}`;
  const safe = await noSymlinkFile(root, path);
  if (!safe.ok) fail(422, 'placement_asset_missing', `${path}: ${safe.reason}`);
  const sha256 = await fileSha256(join(root, path));
  if (value.sha256 != null && value.sha256 !== sha256) fail(409, 'placement_asset_changed', '라이브러리 목록과 실제 파일 내용이 다릅니다. 라이브러리를 새로 읽은 뒤 다시 고르세요.');
  return { id, source, nameKo, url: `/_sf_local/${file.split('/').map(encodeURIComponent).join('/')}`, file, path, sha256, naturalHeightM: await glbHeight(join(root, path)) };
}
/** manifest 를 읽고 「놓기」 형식을 확인한다. { raw, manifest } */
export async function readPublicManifest(root) {
  const safe = await noSymlinkFile(root, PUBLIC_MANIFEST);
  if (!safe.ok) fail(422, 'manifest_invalid', `${PUBLIC_MANIFEST}: ${safe.reason}`);
  const raw = await readFile(join(root, PUBLIC_MANIFEST), 'utf8');
  let manifest;
  try { manifest = JSON.parse(raw); } catch { fail(422, 'manifest_invalid', '공개 에셋 manifest.json을 읽을 수 없어 배치 변경안을 반영하지 않았습니다.'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || (manifest.놓기 !== undefined && !Array.isArray(manifest.놓기))) fail(422, 'manifest_invalid', 'manifest.json의 「놓기」 형식이 잘못되어 배치 변경안을 반영하지 않았습니다.');
  return { raw, manifest };
}
/** 다음 manifest 글(들여쓰기 2 + 끝 줄바꿈 — 기존 파일 모양) */
export const manifestText = manifest => `${JSON.stringify(manifest, null, 2)}\n`;
/**
 * 백업(.local/review/manifest_bak_<시각>.json, 겹치면 꼬리표) → 읽은 뒤 바뀌지 않았는지 확인 → 임시 파일 → rename.
 * { backup, previousSha256, sha256 }
 */
export async function commitManifestText(root, dataDir, raw, nextText, timestamp) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const stamp = timestamp.replace(/[:.]/g, '-');
  let backup = resolve(dataDir, `manifest_bak_${stamp}.json`);
  try { await writeFile(backup, raw, { mode: 0o600, flag: 'wx' }); }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    backup = resolve(dataDir, `manifest_bak_${stamp}_${randomUUID().slice(0, 8)}.json`);
    await writeFile(backup, raw, { mode: 0o600, flag: 'wx' });
  }
  const target = join(root, PUBLIC_MANIFEST);
  if (await readFile(target, 'utf8') !== raw) throw new Error('manifest changed during approval');
  const temp = join(root, PUBLIC_ROOT, `.manifest.json.${randomUUID()}.tmp`);
  await writeFile(temp, nextText);
  await rename(temp, target);
  return { backup: relativePath(root, backup).split('\\').join('/'), previousSha256: hash(raw), sha256: hash(nextText) };
}

// ── 편집기(5174) 즉시 반영 ─────────────────────────────────────────────
// 한 프로세스 안의 쓰기는 줄 세운다(두 번 확정이 겹쳐 서로의 항목을 덮지 않게).
let queue = Promise.resolve();
const serial = task => {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
};
const isEditorEntry = entry => typeof entry?.출처 === 'string' && entry.출처.startsWith(EDITOR_SOURCE_PREFIX);

/** 편집기가 놓은 항목 목록(manifest 순서, index = 놓기 안 위치) */
export async function editorEntries(root) {
  const { manifest } = await readPublicManifest(resolve(root));
  return (manifest.놓기 || []).map((entry, index) => ({ index, entry })).filter(({ entry }) => isEditorEntry(entry));
}

/**
 * 편집기 확정 = manifest 「놓기」 에 곧바로 한 항목 덧붙이기.
 * input: { asset:{source,url,sha256?,id?,nameKo?}, position{x,y,z} m, rotationY 도, scale, groundY?, zoneId?, note? }
 * 돌려줌: { entry, index, backup }
 */
export function editorPlace(root, dataDir, input) {
  root = resolve(root);
  return serial(async () => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'invalid_body', '배치 정보를 JSON 객체로 보내세요.');
    const position = placementPosition(input.position);
    const rotationY = ((round(finite(input.rotationY ?? 0, '회전(도)', -3600, 3600), 2) % 360) + 360) % 360;
    const scale = round(finite(input.scale ?? 1, '크기 배율', SCALE_RANGE[0], SCALE_RANGE[1]), 4);
    const groundY = input.groundY == null ? null : round(finite(input.groundY, '땅 높이(m)', -100_000, 100_000));
    const zoneId = input.zoneId == null ? '' : text(input.zoneId, '구역', 200);
    const note = input.note == null ? '' : text(input.note, '배치 메모', 3000);
    const asset = await placementAsset(root, input.asset, { requireNames: false });
    const heightM = asset.naturalHeightM && round(asset.naturalHeightM * scale, 4);
    if (!heightM) fail(422, 'placement_height_unknown', '에셋의 실제 높이를 GLB 에서 읽지 못해 게임 데이터로 옮길 수 없습니다.');
    const { raw, manifest } = await readPublicManifest(root);
    const timestamp = new Date().toISOString();
    const places = manifest.놓기 || [];
    let source = `${EDITOR_SOURCE_PREFIX}${timestamp}`;
    for (let n = 2; places.some(entry => entry?.출처 === source); n++) source = `${EDITOR_SOURCE_PREFIX}${timestamp}#${n}`;
    const entry = {
      file: asset.file, 키m: heightM, 묻힘m: groundY == null ? 0 : round(groundY - position.y),
      자리: [[position.x, position.z, round(rotationY, 2), 1]],
      메모: `${timestamp.slice(5, 10).replace('-', '/')} 편집기 배치 — ${asset.nameKo}${zoneId ? ` · ${zoneId}` : ''}${note ? ` · ${note.slice(0, 200)}` : ''}`,
      출처: source,
    };
    const next = { ...manifest, 놓기: [...places, entry] };
    const written = await commitManifestText(root, dataDir, raw, manifestText(next), timestamp);
    return { entry, index: places.length, backup: written.backup };
  });
}

/** 편집기 되돌리기 — 「editor:」 출처가 붙은 마지막 놓기 항목 하나를 뺀다(백업 남김). { removed, index, remaining, backup } */
export function editorUndo(root, dataDir) {
  root = resolve(root);
  return serial(async () => {
    const { raw, manifest } = await readPublicManifest(root);
    const places = manifest.놓기 || [];
    let index = -1;
    for (let i = places.length - 1; i >= 0; i--) if (isEditorEntry(places[i])) { index = i; break; }
    if (index < 0) fail(404, 'nothing_to_undo', '편집기로 놓은 항목이 없어 되돌릴 것이 없습니다.');
    const removed = places[index];
    const next = { ...manifest, 놓기: places.filter((_, i) => i !== index) };
    const written = await commitManifestText(root, dataDir, raw, manifestText(next), new Date().toISOString());
    return { removed, index, remaining: next.놓기.filter(isEditorEntry).length, backup: written.backup };
  });
}

// ── 편집기(5174) 통합 편집 모드 — 이미 놓인 「놓기」 고치기 · 지우기 · 되살리기 (10/15) ──────────────
//   어떤 놓기 항목이든(출처 editor:/review:/손으로 쓴 것) 고칠 수 있다 — 쓰기마다 백업이 남는다.
//   바꿔치기·덮기 정의는 건드리지 않는다(놓기 배열 안의 한 항목만 바꾼다).
//   ref = { index: manifest 놓기 안 위치, file, spot: 자리 번호, at: [x, z] (지금 자리 — 다른 항목을 고치지 않게 대조) }

const entryFile = entry => (typeof entry?.file === 'string' ? entry.file : Array.isArray(entry?.files) && typeof entry.files[0] === 'string' ? entry.files[0] : null);

function placeRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_place_ref', '고칠 놓기 항목 정보({index, file, spot, at})를 보내세요.');
  const index = finite(value.index, '놓기 번호', 0, 1_000_000);
  const spot = finite(value.spot ?? 0, '자리 번호', 0, 1_000_000);
  if (!Number.isInteger(index) || !Number.isInteger(spot)) fail(400, 'invalid_place_ref', '놓기 번호·자리 번호는 정수여야 합니다.');
  const file = text(value.file, '파일', 1000, true);
  if (!Array.isArray(value.at) || value.at.length !== 2) fail(400, 'invalid_place_ref', 'at 은 [x, z] 이어야 합니다.');
  const at = [finite(value.at[0], 'at X', -100_000, 100_000), finite(value.at[1], 'at Z', -100_000, 100_000)];
  return { index, spot, file, at };
}

/** ref 가 가리키는 놓기 항목의 manifest 위치 — 번호가 밀렸으면 파일·자리로 하나만 맞는 항목을 찾는다 */
function findPlace(places, ref) {
  const matches = entry => {
    const spot = Array.isArray(entry?.자리) ? entry.자리[ref.spot] : null;
    return entryFile(entry) === ref.file && Array.isArray(spot) && Math.abs(spot[0] - ref.at[0]) < 0.01 && Math.abs(spot[1] - ref.at[1]) < 0.01;
  };
  if (matches(places[ref.index])) return ref.index;
  const found = places.flatMap((entry, index) => (matches(entry) ? [index] : []));
  if (found.length === 1) return found[0];
  return fail(409, 'place_entry_changed', 'manifest 「놓기」가 그사이 바뀌어 고칠 항목을 찾지 못했습니다. 새로고침한 뒤 다시 고르세요.');
}

/** 자리 한 칸 — [X m, Z m, 돌림°, 키배?] */
function spotRow(x, z, rotationDeg, heightFactor) {
  const row = [round(x), round(z), round(((rotationDeg % 360) + 360) % 360, 2)];
  if (heightFactor !== 1) row.push(round(heightFactor, 4));
  return row;
}

/**
 * 놓기 한 자리 고치기. input: { ref, position{x,y,z} m, rotationY 도, scale(지금 크기에 곱할 배율), groundY? }
 *   높이는 자리가 하나뿐인 항목만 「묻힘m」(= 땅 높이 − y)으로 옮긴다 — 자리 여럿이 묻힘m 하나를 같이 쓰기 때문.
 * 돌려줌: { entry, previous, index, heightIgnored, backup }
 */
export function editorUpdate(root, dataDir, input) {
  root = resolve(root);
  return serial(async () => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'invalid_body', '고칠 정보를 JSON 객체로 보내세요.');
    const ref = placeRef(input.ref);
    const position = placementPosition(input.position);
    const rotationY = finite(input.rotationY ?? 0, '회전(도)', -3600, 3600);
    const scale = finite(input.scale ?? 1, '크기 배율', SCALE_RANGE[0], SCALE_RANGE[1]);
    const groundY = input.groundY == null ? null : finite(input.groundY, '땅 높이(m)', -100_000, 100_000);
    const { raw, manifest } = await readPublicManifest(root);
    const places = manifest.놓기 || [];
    const index = findPlace(places, ref);
    const previous = places[index];
    const spot = previous.자리[ref.spot];
    const heightFactor = (Number.isFinite(spot[3]) ? spot[3] : 1) * scale;
    if (!(heightFactor > 0 && heightFactor <= 1000)) fail(400, 'invalid_placement_number', '크기 배율이 너무 크거나 작습니다.');
    const 자리 = previous.자리.map((row, i) => (i === ref.spot ? spotRow(position.x, position.z, rotationY, heightFactor) : row));
    const single = previous.자리.length === 1;
    const entry = { ...previous, 자리 };
    if (single && groundY != null) entry.묻힘m = round(groundY - position.y);
    const heightIgnored = !single && groundY != null && Math.abs(groundY - (previous.묻힘m ?? 0) - position.y) > 0.01;
    const next = { ...manifest, 놓기: places.map((item, i) => (i === index ? entry : item)) };
    const written = await commitManifestText(root, dataDir, raw, manifestText(next), new Date().toISOString());
    return { entry, previous, index, heightIgnored, backup: written.backup };
  });
}

/** 놓기 한 자리 지우기 — 자리가 하나뿐이면 항목째 뺀다. 돌려줌: { previous, entry(남은 항목 또는 null), index, backup } */
export function editorRemove(root, dataDir, input) {
  root = resolve(root);
  return serial(async () => {
    const ref = placeRef(input?.ref);
    const { raw, manifest } = await readPublicManifest(root);
    const places = manifest.놓기 || [];
    const index = findPlace(places, ref);
    const previous = places[index];
    const rest = previous.자리.filter((_, i) => i !== ref.spot);
    const entry = rest.length ? { ...previous, 자리: rest } : null;
    const next = { ...manifest, 놓기: entry ? places.map((item, i) => (i === index ? entry : item)) : places.filter((_, i) => i !== index) };
    const written = await commitManifestText(root, dataDir, raw, manifestText(next), new Date().toISOString());
    return { previous, entry, index, backup: written.backup };
  });
}

/**
 * 놓기 한 자리 복제(통합 편집 모드 Ctrl+C/V, 10/20) — 고른 자리의 돌림·키배를 그대로 새 X·Z 에 한 칸 더 둔다.
 *   같은 항목의 「자리」 에 덧붙이므로 묻힘m 은 그 항목 것을 같이 쓴다. input: { ref, x, z } (m)
 * 돌려줌: { entry, previous, index, spot(새 자리 번호), backup }
 */
export function editorDuplicate(root, dataDir, input) {
  root = resolve(root);
  return serial(async () => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'invalid_body', '붙일 정보를 JSON 객체로 보내세요.');
    const ref = placeRef(input.ref);
    const x = finite(input.x, 'X(m)', -100_000, 100_000);
    const z = finite(input.z, 'Z(m)', -100_000, 100_000);
    const { raw, manifest } = await readPublicManifest(root);
    const places = manifest.놓기 || [];
    const index = findPlace(places, ref);
    const previous = places[index];
    const src = previous.자리[ref.spot];
    const row = spotRow(x, z, Number.isFinite(src[2]) ? src[2] : 0, Number.isFinite(src[3]) ? src[3] : 1);
    const entry = { ...previous, 자리: [...previous.자리, row] };
    const next = { ...manifest, 놓기: places.map((item, i) => (i === index ? entry : item)) };
    const written = await commitManifestText(root, dataDir, raw, manifestText(next), new Date().toISOString());
    return { entry, previous, index, spot: entry.자리.length - 1, backup: written.backup };
  });
}

/** 되살릴 놓기 항목 모양 확인 — 공개 GLB 경로 · 숫자 자리만 */
function restorableEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_place_entry', '되살릴 놓기 항목이 객체가 아닙니다.');
  const files = value.file != null ? [value.file] : value.files;
  if (!Array.isArray(files) || !files.length) fail(400, 'invalid_place_entry', '놓기 항목에 file 이 없습니다.');
  for (const file of files) publicAssetRef(`/_sf_local/${typeof file === 'string' ? file : ''}`);
  if (!Array.isArray(value.자리) || !value.자리.length || value.자리.some(row => !Array.isArray(row) || row.length < 2 || row.length > 4 || row.some(v => typeof v !== 'number' || !Number.isFinite(v)))) fail(400, 'invalid_place_entry', '놓기 항목의 「자리」 형식이 잘못되었습니다.');
  return value;
}

/**
 * 되돌리기용 — manifest 놓기 index 자리를 바꾼다(백업 남김).
 *   expect 가 있으면 그 자리 항목이 expect 와 같아야 한다(다르면 409). entry 가 null 이면 빼고, 있으면 바꾼다.
 *   expect 가 null 이면 entry 를 index 에 끼운다(지운 항목 되살리기).
 * 돌려줌: { index, backup }
 */
export function editorRestore(root, dataDir, input) {
  root = resolve(root);
  return serial(async () => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'invalid_body', '되돌릴 정보를 JSON 객체로 보내세요.');
    const index = finite(input.index, '놓기 번호', 0, 1_000_000);
    if (!Number.isInteger(index)) fail(400, 'invalid_place_ref', '놓기 번호는 정수여야 합니다.');
    const expect = input.expect ?? null;
    const entry = input.entry == null ? null : restorableEntry(input.entry);
    if (!expect && !entry) fail(400, 'invalid_body', 'expect 나 entry 중 하나는 있어야 합니다.');
    const { raw, manifest } = await readPublicManifest(root);
    const places = manifest.놓기 || [];
    let next;
    if (expect) {
      if (!isDeepStrictEqual(places[index], expect)) fail(409, 'place_entry_changed', '그사이 그 놓기 항목이 바뀌어 되돌리지 않았습니다.');
      next = entry ? places.map((item, i) => (i === index ? entry : item)) : places.filter((_, i) => i !== index);
    } else {
      if (index > places.length) fail(409, 'place_entry_changed', '놓기 목록이 그사이 줄어 되돌리지 않았습니다.');
      next = [...places.slice(0, index), entry, ...places.slice(index)];
    }
    const written = await commitManifestText(root, dataDir, raw, manifestText({ ...manifest, 놓기: next }), new Date().toISOString());
    return { index, backup: written.backup };
  });
}
