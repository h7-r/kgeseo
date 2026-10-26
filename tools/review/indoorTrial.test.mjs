// indoorTrial.test.mjs — 실내 공정 회귀 시험(10/22 미르: 사람이 짚었던 문제가 다음 실행에서 다시 생기지 않게)
// 각 시험은 실제로 짚였던 일 하나씩. 규칙을 바꾸다 이 시험이 깨지면 그 문제가 되살아난 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planToSet, enforceTypes, isGarment, fixtureOf, TRACE_NAME } from './indoorTrial.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/rooms/room_types.json'), 'utf8'));
const room = (id, role, extra = {}) => ({ id, name: role, role, kind: 'room', kan_x: 2, kan_m: 'medium', depth: 'medium', floor: ['부엌', '헛간', '곳간'].includes(role) ? 'earth' : role === '대청' ? 'maru' : 'jangpan', front_door: { kan: 0, at: 0.5 }, windows: [], scenes: [], ...extra });

test('대청은 마루 — LLM 이 kind maru 로 적으면 앞벽 없이·뒷문으로 짓는다(1차: 닫힌 방)', () => {
  const plan = { rooms: [room('r1', '사랑방'), room('r2', '대청', { kind: 'maru', front_door: null, back: 'doors' })], links: [{ a: 'r1', b: 'r2', wall_a: 'right' }], contents: [] };
  for (const raw of [true, false]) {
    const { set } = planToSet(plan, null, { raw });
    const d = set.rooms.find(r => r.role === '대청').spec;
    assert.equal(d.front_wall, false);
    assert.ok(d.openings.some(o => o.wall === 'back' && o.type === 'door'));
    assert.ok(!d.openings.some(o => o.wall === 'front'));
  }
});

test('창고 칸 수 — 바닥 물건이 많으면 2칸(곳간 1칸 × 최소 12개 충돌)', () => {
  const contents = Array.from({ length: 12 }, (_, i) => ({ item_id: `C${i}`, room: 'r1', name_ko: `독${i}`, place: 'corner', role: 'furniture' }));
  const { set } = planToSet({ rooms: [room('r1', '곳간', { kan_x: 1 })], links: [], contents }, null);
  assert.equal(set.rooms[0].spec.kan_x, 2);
  const few = planToSet({ rooms: [room('r1', '곳간', { kan_x: 3 })], links: [], contents: contents.slice(0, 5) }, null);
  assert.equal(few.set.rooms[0].spec.kan_x, 1);
});

test('흔적 이름은 물건이 아님 — 「마루 젖은 발자국」에 평상이 놓였던 일', () => {
  for (const n of ['마루 끝 젖은 발자국', '옷자락 얼룩', '문 밖 목소리 자리', '마루 끝자리', '문창호 그림자']) assert.ok(TRACE_NAME.test(n), n);
  for (const n of ['이부자리', '돗자리', '삿자리', '핏자국 묻은 베개', '코피 닦은 수건', '짚신']) assert.ok(!TRACE_NAME.test(n), n);
});

test('옷 판정은 머리 명사 — 「끊어진 끈 두루마기」가 서 있던 일', () => {
  assert.ok(isGarment(T, '끊어진 끈 두루마기'));
  assert.ok(isGarment(T, '두루마기'));
  assert.ok(!isGarment(T, '두루마기 끈'));
  assert.ok(!isGarment(T, '옷자락 얼룩'));
});

test('옷 — 입은 모양 에셋은 쓰지 않는다(10/26 미르): 퍼즐 호스트 옷은 표식, 살림 옷은 뺌', () => {
  const plan = { rooms: [room('r1', '곳간')], links: [], contents: [{ item_id: 'C1', room: 'r1', name_ko: '끊어진 끈 두루마기', place: 'on_item', role: 'puzzle_host', serves: ['PZ-1-H1'] }, { item_id: 'C2', room: 'r1', name_ko: '두루마기', place: 'hang', role: 'furniture' }] };
  const out = enforceTypes(plan, T);
  assert.equal(out.contents.find(c => c.item_id === 'C1').place, 'marker');
  assert.ok(!out.contents.some(c => c.item_id === 'C2'));
});

test('붙박이 호스트는 에셋 대신 방 구조에 — 「굵은 기둥」「물 자국 남은 기둥」이 라이브러리에 없어 퍼즐을 못 풀던 일', () => {
  assert.ok(fixtureOf('굵은 기둥'));
  assert.ok(fixtureOf('물 자국 남은 기둥'));
  assert.ok(fixtureOf('창호 환기창'));
  assert.ok(!fixtureOf('자물쇠 찬장'));
  assert.ok(!fixtureOf('굿 하자던 쪽지'));
  assert.ok(!fixtureOf('창호 그림자'), '흔적은 붙박이가 아님(창호 그림자가 사라졌던 일)');
  const [, pick] = fixtureOf('굵은 기둥');
  assert.ok(pick('기둥') && !pick('문_back'));
});

test('대체 상식 — 서안 자리에 평상을 골라 놓지 못해 퍼즐이 끊겼던 일', async () => {
  const { sanePick } = await import('./indoorTrial.mjs');
  assert.equal(sanePick('서안', { nameKo: '평상', boundsM: [2.3, 0.45, 2.2] }), null);
  assert.equal(sanePick('마당 평상', { nameKo: '평상', boundsM: [2.3, 0.45, 2.2] })?.nameKo, '평상');
  assert.equal(sanePick('반닫이', { nameKo: '궤', boundsM: [0.46, 0.4, 0.3] })?.nameKo, '궤');
  assert.equal(sanePick('쪽지', { nameKo: '방문 게시판', boundsM: [0.3, 1.8, 2.4] }), null);
});
