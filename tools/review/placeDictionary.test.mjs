// 장소 유형 사전(docs/에셋라이브러리/공간/장소유형사전_v0.json) — 라이브러리 경로가 실제로 있고 자리 유형이 정의된 것인지
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

const root = join(import.meta.dirname, '../..');
const dict = JSON.parse(readFileSync(join(root, 'docs/에셋라이브러리/공간/장소유형사전_v0.json'), 'utf8'));
const exists = pattern => {
  const dir = join(root, 'public/_sf_local', dirname(pattern));
  if (!pattern.includes('*')) return existsSync(join(root, 'public/_sf_local', pattern));
  const re = new RegExp(`^${basename(pattern).replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`);
  return existsSync(dir) && readdirSync(dir).some(f => re.test(f));
};

test('장소 유형 사전 — 라이브러리 경로가 모두 있다', () => {
  const missing = [];
  for (const place of dict.placeTypes) for (const e of [...(place.required || []), ...(place.optional || [])]) for (const p of e.library || []) if (!exists(p)) missing.push(`${place.id} · ${e.element} · ${p}`);
  assert.deepEqual(missing, []);
});
test('장소 유형 사전 — 자리 유형은 slotKinds 의 것만', () => {
  const kinds = Object.keys(dict.slotKinds);
  for (const place of dict.placeTypes) for (const e of [...(place.required || []), ...(place.optional || [])]) if (e.slot) assert.ok(kinds.some(k => e.slot.startsWith(k) || e.slot.includes(k)), `${place.id} · ${e.element} · ${e.slot}`);
});
test('장소 유형 사전 — 크기 범위는 [작은, 큰]', () => {
  for (const place of dict.placeTypes) for (const e of [...(place.required || []), ...(place.optional || [])]) if (e.sizeM) assert.ok(e.sizeM[0] > 0 && e.sizeM[0] <= e.sizeM[1], `${place.id} · ${e.element}`);
});
