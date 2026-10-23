#!/usr/bin/env node
/**
 * interactionClassify.mjs — 라이브러리 에셋을 「퍼즐 상호작용」 기준으로 분류한다 (10/22, 상호작용 분류 기준 v0)
 *
 * [무엇] 게임 라이브러리(검수 서버와 같은 buildLibrary — 에이전트가 고르는 그 목록)의 물건마다
 *   ① 퍼즐에서 맡을 수 있는 역할(호스트 · 단서 물건 · 장식)
 *   ② 할 수 있는 몸짓(겉 보기 · 들어 올리기 · 옆으로 치우기 · 열기 · 비우기 · 펼치기 · 걷기 · 깨기 · 불 켜기 · 돌리기)
 *   ③ 그때 「물건 모양이 바뀌어야 하나」 — 아니면 통째로 들거나 치우는 연출로 충분한가
 *   ④ 단서를 둘 자리(안 · 밑 · 뒤 · 위 · 겉면)
 *   를 LLM(Claude) 이 판정한다. 판정 기준: claude/상호작용분류_기준_v0_1022.md (아래 SYSTEM 과 같은 내용)
 *   모양이 바뀌어야 하는 것은 다음 단계(상호작용판 만들기 — 열린 판·빈 판·접힌 판·깨진 판)의 대상이 된다.
 *
 * [사용] 맥 터미널(검수 서버와 같은 .env.local 키를 쓴다)
 *   node tools/review/interactionClassify.mjs --pilot            실내 시험에서 많이 쓰인 60개만(시범)
 *   node tools/review/interactionClassify.mjs --pilot 100
 *   node tools/review/interactionClassify.mjs --all              배치 가능한 것 전부
 *   node tools/review/interactionClassify.mjs --sheet            결과로 검수판(HTML)만 다시 만들기
 *   node tools/review/interactionClassify.mjs --score            검수판에서 고친 정답(정답_v0.json)과 비교해 정확도
 *   결과: .local/review/interaction/분류_v0.json · 검수판_v0.html · 정답_v0.json(검수판에서 「결과 복사」 → 붙여 넣기)
 *   이미 판정한 것은 건너뛴다(이어하기). 기준을 바꾸면 CRITERIA 버전을 올리고 --redo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLibrary } from './library.mjs';
import { callClaude, MODELS } from '../llm/claude.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, '.local/review/interaction');
const OUT = path.join(OUT_DIR, '분류_v0.json');
const SHEET = path.join(OUT_DIR, '검수판_v0.html');
const GOLD = path.join(OUT_DIR, '정답_v0.json');
const CRITERIA = 'v0-1023'; // 10/23: 변형판 검수 결과로 needed=false 경우 추가(SYSTEM)
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const num = (k, d) => { const i = argv.indexOf(k); const v = Number(argv[i + 1]); return i >= 0 && Number.isFinite(v) ? v : d; };

const ACTIONS = ['look', 'lift', 'move_aside', 'turn', 'open', 'empty', 'fill', 'unfold', 'fold_back', 'break', 'light'];
const KINDS = ['open_lid', 'open_door', 'open_drawer', 'empty', 'fill', 'unfold', 'fold_back', 'break', 'light'];
const SPOTS = ['inside', 'under', 'behind', 'on_top', 'surface'];
const ROLES = ['host', 'clue_item', 'decor'];

const SYSTEM = `너는 한국 전통 공간을 배경으로 한 방탈출 게임의 에셋 분류 담당이다. 3D 물건 목록을 받아 퍼즐 상호작용 기준으로 판정한다.

판정 항목
1. role — 퍼즐에서 맡을 수 있는 역할 하나:
   - host: 단서를 품거나(안·밑·뒤·위) 조작 대상이 되거나 읽을 거리(글·그림·새김)가 있는 물건. 궤·장·뒤주·항아리·이부자리·병풍·두루마리·등잔 등.
   - clue_item: 그 자체가 단서·열쇠로 쓰이기 좋은 작은 물건(열쇠·패·쪽지·엽전·짚신 한 짝 등). 숨길 공간은 없다.
   - decor: 퍼즐에 쓰기 어려운 것(나무·풀·바위·건물 일부·너무 큰 구조물·평범한 반복 소품).
2. actions — 플레이어가 할 수 있는 자연스러운 몸짓(여럿): look(겉 보기·읽기) · lift(들어 올려 밑 보기) · move_aside(옆으로 밀거나 치워 뒤·밑 보기) · turn(돌리거나 뒤집기) · open(뚜껑·문·서랍 열기) · empty(안의 물·곡식 등 비우기) · fill(채우기) · unfold(두루마리·보자기·족자 펼치기) · fold_back(이불·발·덮개 걷기) · break(깨기) · light(불 켜기).
   물건의 실제 쓰임과 크기에 맞는 것만. 2 m 넘는 장·병풍은 lift 불가, 항아리는 크면 lift 대신 move_aside.
3. transform — 가장 퍼즐에 쓸모 있는 몸짓(primary_action)을 했을 때 물건 자체의 모양이나 내용물이 바뀌어야 하는가:
   - needed=false: 물건을 통째로 들거나 옆으로 치우거나 돌리는 연출로 충분(모양 그대로). look 만 하는 것도 false.
   - needed=true: 뚜껑·문·서랍이 열려야 함(open_lid·open_door·open_drawer), 내용물이 사라지거나 생겨야 함(empty·fill), 천·종이가 펼쳐지거나 걷혀야 함(unfold·fold_back), 깨져야 함(break), 불꽃이 생겨야 함(light).
   - 10/23 변형판 검수에서 나온 「모양 바꾸지 않음(needed=false)」 경우 — 아래는 연출(꺼내 든 카드·따르는 효과·통째 치우기)로 처리한다:
     옷·치마·저고리(펼치면 텍스처가 드러남) · 입이 묶이거나 막힌 자루·섬·망태기 · 입이 좁은 병·주전자·뿔잔(따르는 연출) · 뚜껑 없는 그릇·솥 받침(open_lid 아님) ·
     이미 펼쳐진 교지·보자기·한삼(unfold 아님) · 빨랫줄 천·그물 걸이(fold_back 아님) · 문 없는 열린 선반장(open_door 아님) · 여러 개가 한 모델로 묶인 세트(절구 세 벌·바가지 묶음).
   - 뚜껑 달린 솥·향로는 fill 이 아니라 open_lid.
   - 같은 물건이라도 통째로 치우는 연출이 더 자연스러우면 false 를 고른다(예: 작은 함은 뚜껑 열기보다 들어서 밑 보기로 충분할 수 있다). 다만 「안에 든 것」이 이야기에 중요하게 쓰일 물건(궤·뒤주·반닫이·물 찬 항아리)은 열기·비우기를 우선한다.
4. hide_spots — 단서를 둘 수 있는 자리: inside · under · behind · on_top · surface(글·그림·새김이 보이는 겉면). 없으면 빈 배열.
5. confidence — 0~1. 이름·설명만으로 형태를 확신하기 어려우면 낮게.
6. reason — 한국어 한 문장(30자 안팎).

출력: JSON 배열만. 원소 = {"id","role","actions":[],"primary_action","transform":{"needed":bool,"kind":"open_lid|open_door|open_drawer|empty|fill|unfold|fold_back|break|light|none","from":"지금 상태(짧게)","to":"바뀐 상태(짧게)"},"hide_spots":[],"confidence":0.0,"reason":""}
needed=false 이면 kind="none", from/to 는 빈 문자열.`;

const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.part', JSON.stringify(v, null, 1)); fs.renameSync(f + '.part', f); };

/** 실내 시험에서 고른 물건 — 많이 쓰인 순 */
function trialUsage() {
  const dir = path.join(ROOT, '.local/review/trials');
  const count = new Map();
  if (!fs.existsSync(dir)) return count;
  for (const t of fs.readdirSync(dir)) {
    const sel = read(path.join(dir, t, 'indoor_selection.json'), null);
    if (!sel) continue;
    const walk = (x) => {
      if (Array.isArray(x)) return x.forEach(walk);
      if (!x || typeof x !== 'object') return;
      for (const [k, v] of Object.entries(x)) {
        if (['asset_id', 'assetId', 'id'].includes(k) && typeof v === 'string' && /^(public|khs|palette|catalog):/.test(v)) count.set(v, (count.get(v) || 0) + 1);
        else walk(v);
      }
    };
    walk(sel);
  }
  return count;
}

function validate(r) {
  if (!r || typeof r.id !== 'string') return null;
  const t = r.transform || {};
  const needed = Boolean(t.needed);
  return {
    role: ROLES.includes(r.role) ? r.role : 'decor',
    actions: (Array.isArray(r.actions) ? r.actions : []).filter((a) => ACTIONS.includes(a)),
    primary_action: ACTIONS.includes(r.primary_action) ? r.primary_action : null,
    transform: { needed, kind: needed && KINDS.includes(t.kind) ? t.kind : 'none', from: needed ? String(t.from || '').slice(0, 40) : '', to: needed ? String(t.to || '').slice(0, 40) : '' },
    hide_spots: (Array.isArray(r.hide_spots) ? r.hide_spots : []).filter((s) => SPOTS.includes(s)),
    confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
    reason: String(r.reason || '').slice(0, 80),
  };
}

const brief = (it) => ({
  id: it.id, 이름: it.nameKo, 원래이름: it.nameEn, 분류: it.categoryKo || it.category,
  크기_m: it.boundsM, 태그: (it.tags || []).slice(0, 8), 설명: String(it.description || it.subjectEn || '').slice(0, 160),
});

async function classify(items) {
  const db = read(OUT, { criteria: CRITERIA, model: MODELS.judgment, items: {} });
  const todo = items.filter((it) => flag('--redo') || !db.items[it.id]);
  console.log(`대상 ${items.length} · 이미 판정 ${items.length - todo.length} · 남음 ${todo.length} · 모델 ${MODELS.judgment}`);
  const B = num('--batch', 20);
  let tin = 0, tout = 0, bad = 0;
  for (let i = 0; i < todo.length; i += B) {
    const batch = todo.slice(i, i + B);
    let parsed = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const r = await callClaude({ tier: 'judgment', system: SYSTEM, maxTokens: 8000, messages: [{ role: 'user', content: `물건 ${batch.length}개:\n${JSON.stringify(batch.map(brief), null, 0)}` }] });
      tin += r.usage?.input_tokens || 0; tout += r.usage?.output_tokens || 0;
      try { parsed = JSON.parse(r.text.slice(r.text.indexOf('['), r.text.lastIndexOf(']') + 1)); } catch { parsed = null; }
    }
    if (!parsed) { bad += batch.length; console.warn(`✗ ${i + 1}~${i + batch.length} 판정 읽기 실패 — 다시 실행하면 이어서 함`); continue; }
    for (const r of parsed) {
      const v = validate(r);
      if (v && batch.some((b) => b.id === r.id)) db.items[r.id] = { ...v, criteria: CRITERIA, at: new Date().toISOString() };
    }
    write(OUT, db);
    console.log(`${Math.min(i + B, todo.length)}/${todo.length} · 토큰 입력 ${tin} 출력 ${tout}`);
  }
  return { db, bad };
}

// 미리보기가 없는 물건(국가유산청 khs·코드 모형·prop 등)은 렌더해 둔 사진(.local/review/interaction/thumbs/<id>.jpg)을 쓴다
const thumbFile = (id) => path.join(OUT_DIR, 'thumbs', id.replace(/[:/]/g, '__') + '.jpg');
function thumbData(it) {
  const files = [it.thumbnail ? path.join(ROOT, 'public', decodeURIComponent(it.thumbnail.replace(/^\//, ''))) : null, thumbFile(it.id)].filter(Boolean);
  for (const f of files) { try { return 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64'); } catch { /* 다음 */ } }
  return '';
}

function makeSheet(items, db) {
  const rows = items.filter((it) => db.items[it.id]).map((it) => ({ it, r: db.items[it.id] }));
  rows.sort((a, b) => Number(b.r.transform.needed) - Number(a.r.transform.needed) || a.r.role.localeCompare(b.r.role));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const opt = (list, cur) => list.map((v) => `<option${v === cur ? ' selected' : ''}>${v}</option>`).join('');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>상호작용 분류 검수판 ${CRITERIA}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:16px;color:#222}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;vertical-align:top;text-align:left}img{width:96px;height:96px;object-fit:contain;background:#f3f3f3;border-radius:6px}.need{background:#fff7e6}.bad td{background:#ffecec}select{font-size:13px}small{color:#666}#out{width:100%;height:120px;margin-top:10px}button{font-size:14px;padding:6px 12px}</style></head><body>
<h2>상호작용 분류 검수판 <small>${CRITERIA} · ${rows.length}개 · 모델 ${esc(db.model)}</small></h2>
<p>틀린 칸만 고치세요(고친 줄은 붉게 표시). 다 보면 아래 「결과 복사」 → 붙여 넣어 주시면 정답 표가 됩니다. 노란 줄 = 모양이 바뀌어야 한다고 판정한 것.</p>
<table><tr><th>모습</th><th>이름 · 크기</th><th>역할</th><th>모양 변형</th><th>변형 종류</th><th>대표 몸짓</th><th>단서 자리 · 이유</th></tr>
${rows.map(({ it, r }) => `<tr data-id="${esc(it.id)}" class="${r.transform.needed ? 'need' : ''}"><td>${(() => { const t = thumbData(it); return t ? `<img src="${t}" alt="">` : '<div style="width:96px;height:96px;background:#f3f3f3;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#999">사진 없음</div>'; })()}</td>
<td><b>${esc(it.nameKo)}</b><br><small>${esc(it.id)}<br>${(it.boundsM || []).map((v) => (+v).toFixed(2)).join(' × ')} m</small></td>
<td><select data-k="role">${opt(ROLES, r.role)}</select></td>
<td><select data-k="needed">${opt(['true', 'false'], String(r.transform.needed))}</select><br><small>${esc(r.transform.from)} → ${esc(r.transform.to)}</small></td>
<td><select data-k="kind">${opt(['none', ...KINDS], r.transform.kind)}</select></td>
<td><select data-k="primary_action">${opt(ACTIONS, r.primary_action)}</select><br><small>${esc(r.actions.join(' · '))}</small></td>
<td><small>${esc(r.hide_spots.join(' · ') || '—')}<br>${esc(r.reason)} (${r.confidence})</small></td></tr>`).join('\n')}
</table>
<p><button id="copy">결과 복사</button> <small id="msg"></small></p><textarea id="out" readonly></textarea>
<script>
const orig={};document.querySelectorAll('tr[data-id]').forEach(tr=>{orig[tr.dataset.id]={};tr.querySelectorAll('select').forEach(s=>{orig[tr.dataset.id][s.dataset.k]=s.value;s.onchange=()=>tr.classList.toggle('bad',[...tr.querySelectorAll('select')].some(x=>x.value!==orig[tr.dataset.id][x.dataset.k]))})});
document.getElementById('copy').onclick=async()=>{const out={criteria:'${CRITERIA}',checked:[],fixed:{}};document.querySelectorAll('tr[data-id]').forEach(tr=>{const id=tr.dataset.id;out.checked.push(id);const v={};tr.querySelectorAll('select').forEach(s=>{if(s.value!==orig[id][s.dataset.k])v[s.dataset.k]=s.value});if(Object.keys(v).length)out.fixed[id]=v});const t=JSON.stringify(out);document.getElementById('out').value=t;try{await navigator.clipboard.writeText(t);document.getElementById('msg').textContent='복사됨 — 고친 것 '+Object.keys(out.fixed).length+'개'}catch{document.getElementById('msg').textContent='아래 칸을 전부 선택해 복사하세요'}};
</script></body></html>`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(SHEET, html);
  console.log(`검수판 → ${path.relative(ROOT, SHEET)} (${rows.length}개)`);
}

function score(db) {
  const gold = read(GOLD, null);
  if (!gold) { console.error(`정답 파일이 없습니다: ${path.relative(ROOT, GOLD)} — 검수판 「결과 복사」 내용을 붙여 넣어 저장하세요`); process.exit(2); }
  const keys = ['role', 'needed', 'kind', 'primary_action'];
  const hit = Object.fromEntries(keys.map((k) => [k, 0]));
  let n = 0;
  for (const id of gold.checked) {
    const r = db.items[id]; if (!r) continue; n++;
    const f = gold.fixed[id] || {};
    const cur = { role: r.role, needed: String(r.transform.needed), kind: r.transform.kind, primary_action: r.primary_action };
    for (const k of keys) if (!(k in f) || f[k] === cur[k]) hit[k]++;
  }
  console.log(`검수한 ${n}개 기준 맞은 비율`);
  for (const k of keys) console.log(`  ${k}: ${hit[k]}/${n} (${(hit[k] / n * 100).toFixed(0)}%)`);
}

const lib = await buildLibrary(ROOT);
// 붙박이(부뚜막 등)는 방 생성기 담당 — 분류 대상에서 뺀다(10/22 미르)
const FIXTURE = /buttumak/i;
const all = (lib.items || lib).filter((it) => it.placeable && !FIXTURE.test(it.id));
let items = all;
if (flag('--pilot')) {
  const used = trialUsage();
  const n = num('--pilot', 60);
  items = all.filter((it) => used.has(it.id)).sort((a, b) => used.get(b.id) - used.get(a.id)).slice(0, n);
  console.log(`시범: 실내 시험에서 쓰인 ${used.size}종 중 많이 쓰인 ${items.length}개`);
}
if (flag('--score')) { score(read(OUT, { items: {} })); process.exit(0); }
if (!flag('--sheet')) await classify(items);
const db = read(OUT, { items: {}, model: MODELS.judgment });
makeSheet(items, db);
const done = items.filter((it) => db.items[it.id]);
const need = done.filter((it) => db.items[it.id].transform.needed);
const by = {}; for (const it of need) { const k = db.items[it.id].transform.kind; by[k] = (by[k] || 0) + 1; }
const roles = {}; for (const it of done) { const k = db.items[it.id].role; roles[k] = (roles[k] || 0) + 1; }
console.log(`판정 ${done.length}개 · 역할 ${JSON.stringify(roles)} · 모양 변형 필요 ${need.length}개 ${JSON.stringify(by)}`);
