#!/usr/bin/env node
/**
 * exportCase.mjs — 에이전트 시험(실내) 결과를 BE 케이스 콘텐츠(client.json · server.json)로 바꾼다 (10/23 v0)
 *
 * 기준: backend/app/schemas/case_content.py(client — extra 금지) · puzzle_runtime.py(server)
 *       + 김세진 10/23 구현 보고의 새 필드: server.inspections[].on_inspect · on_correct.set_object_states  ← 필드 모양은 추정(BE 공유 뒤 맞춤)
 *
 * 바꾸는 규칙
 *  - 방(room) = Zone. 방 사이 문 = door Object + navigation. 장면 출구 문은 enabled=false 로 시작한다.
 *  - 단서를 주는 호스트 = interactive Object, interaction inspect → inspections[INSP_…]
 *      · 단서 물건(서신·쪽지·조각·열쇠)이 있으면 처음엔 숨긴 clue Object 를 두고, 호스트 조사 = 그 물건 보이기, 물건 조사 = 단서 획득 + 물건 숨김
 *      · 자국(mark)이면 호스트 조사 = 바로 단서 획득
 *  - 풀이 장치(윤도·산가지·글자 바퀴·비밀자물쇠) = lock Object, interaction input → puzzles[]
 *      · 답 문자열: 산가지 「15」 · 윤도/글자 바퀴 여러 칸 「서-동」 · 비밀자물쇠 「나비 장석」(BE 에 select 처리가 없어 input 으로 보낸다)
 *      · 출구 장치 정답 = puzzle_completed + 다음 장면 문 enabled=true
 *  - 단서 짝짓기 퍼즐 = clue_combinations
 *  - 조사형 풀이(inspect·navigate) = 풀이 자리 조사에 퍼즐 완료를 붙인다
 *  - 단서 표시 정보(Q4) = server.json clues[] — 획득할 때만 내려 줄 것이라 서버 쪽 파일에 둔다
 * 사용: node tools/review/exportCase.mjs <시험 id> [--out <폴더>]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const id = process.argv[2];
const outDir = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : path.join(root, '.local/review/trials', id, 'case');
const dir = path.join(root, '.local/review/trials', id);
const build = JSON.parse(await fs.readFile(path.join(dir, 'indoor_build.json'), 'utf8'));
const views = [];
for (let i = 1; i <= build.rooms.length; i++) views.push(JSON.parse(await fs.readFile(path.join(dir, 'rooms', `room_r${i}_furnished_view.json`), 'utf8')));
const PZ = build.puzzle.list, SC = [...(build.puzzle.scenes || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
const caseId = `ai_${id.slice(0, 8)}`;
const warn = [];
// 10/23: BE 에 제안한 선행 단서 조건(requires_clue_ids — puzzles[]·inspections[] 같은 모양). BE 가 아직 모르는 필드라 엄격 검증을 켜면 걸린다 → --no-proposed 로 뺄 수 있다
const PROPOSED = !process.argv.includes('--no-proposed');
const ZONE = i => `ZONE_${String(build.rooms[i].id).toUpperCase()}`;
let seq = 0; const oid = (zi, kind) => `OBJ_${build.rooms[zi].id.toUpperCase()}_${kind}_${String(++seq).padStart(2, '0')}`;
const SOLVE_ONLY = ['combine_clues', 'select', 'input', 'solve'];
const devOf = p => (p.solve?.device && ['yundo', 'sangaji', 'bimil', 'geulja', 'munsal', 'maedeup', 'pae', 'buk'].includes(p.solve.device.kind)) ? p.solve.device : null;
const answerOf = p => { const d = devOf(p), a = p.solve.answer; if (d?.kind === 'sangaji') return String(a).replace(/\D/g, ''); if (d?.kind === 'munsal') return (Array.isArray(a) ? a : String(a).split(/[,\s]+/)).filter(Boolean).map(String).sort().join(','); /* 10/23 문살: 누른 칸 "행-열" 정렬해 쉼표로 */ if (Array.isArray(a)) return a.map(String).join('-'); return String(a); };

const zones = build.rooms.map((r, i) => ({ zone_id: ZONE(i), zone_name: r.name, zone_type: r.role === '대청' ? 'transition' : 'exploration', description: String(r.why || '').slice(0, 200), objects: [], navigation: [], metadata: {} }));
const server = { schema_version: '0.2-draft', case_id: caseId, puzzles: [], clue_combinations: [], inspections: [], clues: [] };
const objByHost = new Map(); // `${room}|${node}` → object_id
const hostObj = (zi, node, name, type = 'interactive') => { const k = `${zi}|${node}`; if (objByHost.has(k)) return objByHost.get(k); const o = { object_id: oid(zi, type === 'lock' ? 'LOCK' : 'OBJ'), object_name: String(name || node), object_type: type, asset_key: null, visible: true, enabled: true, interaction: null }; zones[zi].objects.push(o); objByHost.set(k, o.object_id); return o.object_id; };
const objById = id => zones.flatMap(z => z.objects).find(o => o.object_id === id);
const effect = () => ({ grant_clue_ids: [], complete_puzzle_ids: [], set_flags: {}, set_object_states: [] });

// 1) 문 — 방마다 이어진 문, 장면 출구 문은 잠근다
const sceneOfRoom = zi => SC.find(s => (s.rooms || []).includes(zi));
const exitDoors = new Map(); // scene id → [door object id]
views.forEach((v, zi) => {
  for (const g of v.goes || []) {
    const door = { object_id: oid(zi, 'DOOR'), object_name: `${g.to}(으)로 가는 문`, object_type: 'door', asset_key: null, visible: true, enabled: true, interaction: { type: 'navigate', target_id: ZONE(g.tab) } };
    const s = sceneOfRoom(zi), si = SC.indexOf(s), nx = SC[si + 1];
    if (s && nx && (nx.rooms || []).includes(g.tab)) { door.enabled = false; (exitDoors.get(s.id) || exitDoors.set(s.id, []).get(s.id)).push(door.object_id); }
    zones[zi].objects.push(door); zones[zi].navigation.push({ door_object_id: door.object_id, target_zone_id: ZONE(g.tab) });
  }
});

// 2) 단서 · 조사
let inspN = 0;
for (const p of PZ) {
  for (const c of p.clues) {
    server.clues.push({ clue_id: c.id, title: c.carrier?.name || (SOLVE_ONLY.includes(c.get_by) ? `${p.title} — 알아낸 것` : null) || String(c.text || '').slice(0, 24) || c.id, /* 10/23 BE: CL-03-R 제목이 ID 그대로 */ carrier_kind: c.carrier?.kind || 'mark', body: c.content || c.text, summary: c.text });
    if (SOLVE_ONLY.includes(c.get_by)) continue;
    const h = p.hosts.find(h => h.need_id === c.from); const at = h?.at?.[0];
    if (!at) { warn.push(`${c.id}: 호스트가 공간에 없음 — 건너뜀`); continue; }
    const ho = hostObj(at.room, at.node, h.assets?.[0]?.name || at.node);
    const hobj = objById(ho);
    if (hobj.interaction && hobj.interaction.type === 'inspect') { warn.push(`${c.id}: 「${at.node}」에 조사가 이미 있음(물건 하나 = 조사 하나) — 건너뜀`); continue; }
    const insp = { inspection_id: `INSP_${String(++inspN).padStart(3, '0')}`, object_id: ho, on_inspect: effect(), message: c.reveal?.reaction || null };
    if (c.carrier && c.carrier.kind && c.carrier.kind !== 'mark') {
      const carrier = { object_id: oid(at.room, 'CLUE'), object_name: c.carrier.name, object_type: 'clue', asset_key: `carrier:${c.carrier.kind}`, visible: false, enabled: true, interaction: null };
      zones[at.room].objects.push(carrier);
      insp.on_inspect.set_object_states.push({ object_id: carrier.object_id, visible: true });
      const take = { inspection_id: `INSP_${String(++inspN).padStart(3, '0')}`, object_id: carrier.object_id, on_inspect: { ...effect(), grant_clue_ids: [c.id], set_object_states: [{ object_id: carrier.object_id, visible: false }] }, message: null };
      carrier.interaction = { type: 'inspect', target_id: take.inspection_id };
      server.inspections.push(insp, take);
    } else { insp.on_inspect.grant_clue_ids.push(c.id); server.inspections.push(insp); }
    hobj.interaction = { type: 'inspect', target_id: insp.inspection_id };
  }
}

// 3) 풀이
for (const p of PZ) {
  const reward = (p.effects || []).filter(e => e.type === 'clue_acquired').map(e => e.target_id);
  for (const r of reward) if (!server.clues.some(c => c.clue_id === r)) server.clues.push({ clue_id: r, title: p.title, carrier_kind: 'deduction', body: p.learns, summary: p.learns });
  const d = devOf(p);
  const unlock = d?.on === 'exit_door' ? (exitDoors.get(p.scene_id) || []).map(o => ({ object_id: o, enabled: true })) : [];
  if (d?.on === 'exit_door' && !unlock.length) warn.push(`${p.id}: 출구 장치인데 잠글 문을 못 찾음`);
  if (d) {
    let zi, node;
    if (d.on === 'exit_door') { const doorId = (exitDoors.get(p.scene_id) || [])[0]; zi = zones.findIndex(z => z.objects.some(o => o.object_id === doorId)); }
    else { const h = p.hosts.find(h => h.need_id === p.solve.at); zi = h?.at?.[0]?.room; node = h?.at?.[0]?.node; }
    if (zi == null || zi < 0) { warn.push(`${p.id}: 장치 자리를 못 찾음`); continue; }
    const lock = { object_id: oid(zi, 'LOCK'), object_name: d.name || p.title, object_type: 'lock', asset_key: `device:${d.kind}`, visible: true, enabled: true, interaction: { type: 'input', target_id: p.id } };
    zones[zi].objects.push(lock);
    const ans = answerOf(p); const accepted = [...new Set([ans, ...(d.kind === 'sangaji' ? [String(Number(ans))] : [])])]; /* 10/23 BE: 산가지 「05」·「5」 */
    const last = p.scene_id === SC[SC.length - 1]?.id && PZ.filter(q => q.scene_id === p.scene_id).slice(-1)[0] === p;
    server.puzzles.push({ puzzle_id: p.id, accepted_answers: accepted, ...(PROPOSED && (p.solve.required_clue_ids || []).length ? { requires_clue_ids: p.solve.required_clue_ids } : {}), on_correct: { ...effect(), grant_clue_ids: reward, set_object_states: unlock, ...(last ? { set_flags: { case_cleared: true } } : {}) } }); /* 10/23 BE: 마지막 장치 정답 뒤 효과 없음 → 게임 끝 표시 */
  } else if (p.solve.interaction === 'combine_clues') {
    const ids = p.solve.required_clue_ids || [];
    if (ids.length !== 2) { warn.push(`${p.id}: 짝짓기 단서가 2개가 아님(${ids.length})`); continue; }
    server.clue_combinations.push({ combination_id: `COMB_${p.id}`, clue_ids: ids, on_success: { ...effect(), grant_clue_ids: reward, complete_puzzle_ids: [p.id] } });
  } else if (['inspect', 'navigate'].includes(p.solve.interaction)) {
    const h = p.hosts.find(h => h.need_id === p.solve.at); const at = h?.at?.[0];
    const ho = at && objByHost.get(`${at.room}|${at.node}`); const insp = ho && server.inspections.find(x => x.object_id === ho);
    if (!at) { warn.push(`${p.id}: 조사형 풀이 자리가 공간에 없음`); continue; }
    const need = PROPOSED ? (p.solve.required_clue_ids || []) : [];
    if (insp) { insp.on_inspect.complete_puzzle_ids.push(p.id); insp.on_inspect.grant_clue_ids.push(...reward); if (need.length) insp.requires_clue_ids = [...new Set([...(insp.requires_clue_ids || []), ...need])]; }
    else { const o = objById(hostObj(at.room, at.node, h.assets?.[0]?.name || at.node)); const ni = { inspection_id: `INSP_${String(++inspN).padStart(3, '0')}`, object_id: o.object_id, on_inspect: { ...effect(), grant_clue_ids: reward, complete_puzzle_ids: [p.id] }, ...(need.length ? { requires_clue_ids: need } : {}), message: p.learns || null }; o.interaction = { type: 'inspect', target_id: ni.inspection_id }; server.inspections.push(ni); }
    warn.push(`${p.id}: 조사형 풀이 — ${need.length ? `requires_clue_ids(${need.join(',')}) 제안 필드로 넣음 · BE 미지원` : '선행 단서 조건 없음(BE 가 보지 않음)'}`);
  } else warn.push(`${p.id}: 바꿀 수 없는 풀이(${p.solve.interaction}) — 건너뜀`);
}

// 4) 검사 — case_content.py 규칙 + 참조
const client = { case_id: caseId, entry_zone_id: zones[0].zone_id, zones };
const errs = [];
const allObj = new Set(zones.flatMap(z => z.objects.map(o => o.object_id)));
for (const z of zones) { const ids = z.objects.map(o => o.object_id); if (new Set(ids).size !== ids.length) errs.push(`${z.zone_id}: object_id 중복`); for (const n of z.navigation) if (!ids.includes(n.door_object_id)) errs.push(`${z.zone_id}: 문 참조 없음`); }
for (const o of zones.flatMap(z => z.objects)) for (const k of Object.keys(o)) if (!['object_id', 'object_name', 'object_type', 'asset_key', 'visible', 'enabled', 'interaction'].includes(k)) errs.push(`${o.object_id}: 허용 안 된 필드 ${k}`);
for (const o of zones.flatMap(z => z.objects)) if (o.interaction && !o.interaction.target_id) errs.push(`${o.object_id}: interaction target_id 비어 있음`);
const effs = [...server.puzzles.map(p => p.on_correct), ...server.clue_combinations.map(c => c.on_success), ...server.inspections.map(i => i.on_inspect)];
const clueIds = new Set(server.clues.map(c => c.clue_id));
for (const e of effs) { for (const s of e.set_object_states) if (!allObj.has(s.object_id)) errs.push(`상태 변경 대상 없음 ${s.object_id}`); for (const c of e.grant_clue_ids) if (!clueIds.has(c)) errs.push(`없는 단서 ${c}`); }
for (const x of [...server.puzzles, ...server.inspections]) for (const c of x.requires_clue_ids || []) if (!clueIds.has(c)) errs.push(`${x.puzzle_id || x.inspection_id}: 선행 단서 없음 ${c}`);
for (const c of server.clue_combinations) for (const x of c.clue_ids) if (!clueIds.has(x)) errs.push(`${c.combination_id}: 없는 단서 ${x}`);
// 10/23 BE 계약 맞춤(김세진 실제 로더 검증): inspection_id → inspect_id · 조사 object_id 빼기(Object 쪽 interaction 이 가리킴) · set_object_states 에 zone_id
//   message·carrier_kind·requires_clue_ids 는 협의 중인 제안 필드 — --no-proposed 면 뺀다
const zoneOfObj = new Map(zones.flatMap(z => z.objects.map(o => [o.object_id, z.zone_id])));
const fixEff = e => e && { ...e, set_object_states: (e.set_object_states || []).map(x => ({ zone_id: zoneOfObj.get(x.object_id), ...x })) };
const out = { ...server,
  puzzles: server.puzzles.map(p => { const q = { ...p, on_correct: fixEff(p.on_correct) }; if (!PROPOSED) delete q.requires_clue_ids; return q; }),
  clue_combinations: server.clue_combinations.map(c => ({ ...c, on_success: fixEff(c.on_success) })),
  inspections: server.inspections.map(({ inspection_id, object_id, message, requires_clue_ids, on_inspect }) => ({ inspect_id: inspection_id, on_inspect: fixEff(on_inspect), ...(PROPOSED && requires_clue_ids?.length ? { requires_clue_ids } : {}), ...(PROPOSED && message ? { message } : {}) })),
  clues: server.clues.map(({ carrier_kind, ...c }) => (PROPOSED ? { ...c, carrier_kind } : c)) };
for (const e of [...out.puzzles.map(p => p.on_correct), ...out.clue_combinations.map(c => c.on_success), ...out.inspections.map(i => i.on_inspect)]) for (const x of e.set_object_states) if (!x.zone_id) errs.push(`상태 변경 ${x.object_id}: zone 없음`);
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, `${caseId}.client.json`), JSON.stringify(client, null, 2));
await fs.writeFile(path.join(outDir, `${caseId}.server.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ caseId, zones: zones.length, objects: allObj.size, inspections: server.inspections.length, puzzles: server.puzzles.length, combinations: server.clue_combinations.length, clues: server.clues.length, errors: errs, warnings: warn }, null, 1));
if (errs.length) process.exit(1);
