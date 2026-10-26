// indoorTrial.mjs — 에이전트 시험 「실내 방 세트」 공정(10/21, 미르: 실내 공간만으로 각색하는 설화로 에이전트 시험).
//   야외(앙암바위) 공정(agentTrialV2.mjs 06~10)은 건드리지 않는다. 시험의 spaceKind === 'indoor' 일 때만 06~08 이 이 파일로 온다.
//   06 실내 공간 구성(LLM) — 방 목록·방 사양(정해진 선택지 안)·방 사이 연결·방별 살림/이야기 물건/퍼즐 호스트 계획. 좌표 없음
//   07 에셋 선정(LLM)     — 항목마다 공용 라이브러리 후보 중에서 고름
//   08 방 만들기·배치(코드) — tools/rooms: rooms_set.py(방 생성 + 연결 개연성 검사) → place_room.py(실내 배치 규칙 v0)
//                          → build_view.py(조명·부딪힘·문 이동) → compose.mjs(방+물건 GLB) → 뷰어 rooms/index.html. LLM 없음, 비용 0
//   사람 모범답안·사람 문서는 입력에 넣지 않는다(평가 전용). 결과는 .local/review/trials/<id>/ 에만.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export const INDOOR_SPACE_ID = 'space:indoor-rooms';
export const STEPS_INDOOR = Object.freeze([
  { id: 's01', no: '01', label: '설화 사실 계약서', tier: 'judgment', maxTokens: 48000, effort: 'low' },
  { id: 's02', no: '02', label: '지역 테마 시놉시스', tier: 'judgment', maxTokens: 40000, effort: 'low' },
  { id: 's03', no: '03', label: '게임 시나리오 기획서', tier: 'judgment', maxTokens: 40000, effort: 'low' },
  { id: 's04', no: '04', label: 'Scene 구성표(JSON)', tier: 'judgment', maxTokens: 48000, effort: 'low' },
  { id: 's05', no: '05', label: '퍼즐 초안', tier: 'judgment', maxTokens: 64000, effort: 'medium', v2: true },
  { id: 's06', no: '06', label: '실내 공간 구성(방 세트·살림 계획)', tier: 'judgment', maxTokens: 32000, effort: 'medium', indoor: true },
  { id: 's07', no: '07', label: '에셋 선정', tier: 'judgment', maxTokens: 24000, effort: 'low', indoor: true },
  { id: 's08', no: '08', label: '방 만들기·배치(코드, 비용 0)', tier: 'judgment', maxTokens: 1000, effort: 'low', indoor: true, codeOnly: true },
  { id: 's09', no: '09', label: '시각 자기 검수(사진 → 판정 → 고쳐 다시 짓기)', tier: 'judgment', maxTokens: 16000, effort: 'low', indoor: true },
]);

const ROOMS_DIR = 'tools/rooms';
// 대문간은 뺌(10/21 미르: 무엇을 하는 공간인지 안 읽힘 — 통로라 방탈출 방으로 부자연스러움)
const ROLES = ['사랑방', '안방', '건넌방', '윗방', '대청', '부엌', '헛간', '곳간', '골방'];
/** 실내 방 유형 사전(tools/rooms/room_types.json) — 일반 생활 상식. 06 입력 + 코드 검사 */
let TYPES = null;
async function roomTypes(root) { if (!TYPES) TYPES = JSON.parse(await fs.readFile(path.join(root, 'tools/rooms/room_types.json'), 'utf8')); return TYPES; }
const typeText = T => [...Object.entries(T.kinds || {}).map(([k, d]) => `- [공간 종류 ${k}] ${d}`), ...Object.entries(T.types).map(([role, t]) => `- ${role}(${t.kind || 'room'}): ${t.purpose} · 꼭 있을 것: ${t.must.map(m => m.name_ko).join(', ')} · 있어도 됨: ${t.optional.join(', ') || '없음'} · 두지 않음: ${t.forbid.join(', ')}${t.center === 'empty' ? ' · 가운데 비움(벽 가구만 — 나머지 살림은 쓸 때만 꺼내므로 두지 않는다. 이야기 물건은 벽 가구 위나 마루 끝)' : ''}${t.back === 'doors' ? ' · 뒷벽은 창이 아니라 문(뒤뜰로)' : ''}${t.link ? ` · 붙는 자리: ${t.link}` : ''}`)].join('\n'); // 10/22: 공간 종류(방·마루) · 가운데 비움 · 뒷벽 문을 사전에서 읽게
// 옷인가 = 이름의 마지막 낱말(머리 명사)이 옷(10/22): 「끊어진 끈 두루마기」는 옷, 「두루마기 끈」·「옷자락 얼룩」은 옷이 아님
export const isGarment = (T, name) => { const n = String(name || '').trim(); const head = n.split(/\s+/).pop() || ''; return T.garment_words.some(w => head.endsWith(w) || head === w) && !/(끈|고름|조각|얼룩|자국|흔적)$/.test(head); };
/** 붙박이(방 생성기가 이미 짓는 구조) — 에셋을 찾지 않고 방 노드에 잇는다(10/22) */
export const FIXTURES = [[/기둥/, n => n === '기둥'], [/문창호|방문|문살|문짝|여닫이|덧문|부엌문|사랑방문|뒷문|쪽문/, n => /^문_/.test(n)], [/환기창|창호|창살|들창|봉창|^창$|\s창$/, n => /^창_/.test(n)], [/시렁/, n => /^시렁_/.test(n)], [/부뚜막/, n => /^부뚜막_/.test(n)], [/아궁이/, n => /^아궁이_/.test(n)], [/벽장/, n => /^벽장/.test(n)], [/횃대/, n => /^횃대_/.test(n)]];
export const fixtureOf = name => { const n = String(name || '').trim(); if (/자물쇠|쪽지|기록|서찰|궤|함$|장$/.test(n) || TRACE_NAME.test(n)) return null; return FIXTURES.find(([re]) => re.test(n)) || null; };
const STONE = /디딤돌|댓돌|섬돌/;
// 단서 글 속 가구·살림 이름(10/26) — 앞은 글 시작·띄어쓰기·괄호, 뒤는 조사·띄어쓰기·끝
export const FURN_IN_TEXT = /(?:^|[\s「(])(서안|문갑|반닫이|뒤주|찬장|사방탁자|탁자장|의걸이장|장롱|궤짝|궤|함|이부자리|이불|베개|병풍|소반|가마니|멍석|방석|돗자리|보자기|짚단|항아리|단지|동이|가마솥|솥|바가지|광주리|바구니|소쿠리|등잔|화로|맷돌|절구|시루)(?=[\s이가을를의에은는도과와로만,.」)]|$)/g;
/** 풀이의 결과로만 얻는 단서 — 이 밖의 get_by(inspect·navigate·observe …)는 그 호스트에 가면 얻는다 */
export const SOLVE_GET = new Set(['combine_clues', 'select', 'input', 'solve']);
/** 07 고른 에셋의 상식 검사(10/22) — 평상은 마당 가구라 실내 살림 대체 금지, 2 m 넘는 후보는 이름이 같을 때만 */
export function sanePick(name, c) { if (!c) return null; const nm = String(c.nameKo || ''); const head = String(name || '').trim().split(/\s+/).pop(); if (/평상/.test(nm) && !/평상/.test(name || '')) return null; const big = Array.isArray(c.boundsM) && Math.max(...c.boundsM.map(Number).filter(Number.isFinite)) > 2.0; if (big && !nm.includes(head)) return null; return c; }
/** 06 계획을 방 유형 사전으로 다듬는다 — 안 맞는 살림 빼기 · 필수 살림 채우기 · 옷은 횃대에 걸기 · 횃대 물건은 방이 그림 */
export function enforceTypes(plan, T) {
  const fixes = [];
  const rooms = (plan.rooms || []).filter(r => r && r.id);
  let out = [...(plan.contents || [])];
  const usedIds = new Set(out.map(c => c.item_id));
  const newId = rid => { let k = 1; while (usedIds.has(`M-${rid}-${k}`)) k++; const id = `M-${rid}-${k}`; usedIds.add(id); return id; };
  for (const r of rooms) {
    const t = T.types[r.role]; if (!t) continue;
    const mine = () => out.filter(c => c.room === r.id);
    for (const c of mine()) {
      const bad = t.forbid.find(w => String(c.name_ko || '').includes(w));
      if (bad && ['furniture', 'life_trace'].includes(c.role)) { out = out.filter(x => x !== c); fixes.push(`${r.name || r.role}: 「${c.name_ko}」 뺌 — ${r.role}에 두지 않는 살림(${bad})`); }
      else if (bad) fixes.push(`${r.name || r.role}: 「${c.name_ko}」 은 ${r.role}에 어울리지 않지만 이야기·퍼즐 물건이라 둠`);
    }
    // 옷 — 횃대에 건다(흙바닥 방은 횃대가 없어 뺌). 횃대 물건(3D)은 방이 횃대를 그리므로 뺀다
    const garments = mine().filter(c => isGarment(T, c.name_ko));
    // 10/26 미르: 사람이 입은 모양으로 굳은 옷 에셋(두루마기 등)은 쓰지 않기로 함 — 걸린·개킨 옷 에셋이 생길 때까지 살림 옷은 놓지 않는다. 퍼즐 호스트인 옷은 표식으로
    for (const g of garments) {
      if (!(g.serves || []).length) { out = out.filter(x => x !== g); fixes.push(`${r.name || r.role}: 「${g.name_ko}」 뺌 — 입은 모양 옷 에셋은 쓰지 않음(걸린 옷 에셋 전까지)`); continue; }
      if (g.place !== 'marker') { g.place = 'marker'; fixes.push(`${r.name || r.role}: 「${g.name_ko}」 퍼즐 호스트 — 입은 모양 옷 에셋 대신 자리 표식으로`); }
    }
    for (const g of garments.filter(g => out.includes(g) && g.place !== 'marker')) {
      if (r.floor === 'earth' && ['furniture', 'life_trace'].includes(g.role)) { out = out.filter(x => x !== g); fixes.push(`${r.name || r.role}: 「${g.name_ko}」 뺌 — 흙바닥 방 살림으로 옷을 두지 않음`); continue; }
      // 이야기·퍼즐 물건인 옷은 흙바닥 방이라도 벽 걸이(횃대)에 건다 — 서 있는 옷 금지(10/22)
      if (g.place !== 'hang') fixes.push(`${r.name || r.role}: 「${g.name_ko}」 을 횃대에 검(사람이 입지 않은 옷은 서 있을 수 없음)`);
      g.place = 'hang'; g.on_item = null;
      if (!r.rail) { r.rail = { wall: 'left' }; fixes.push(`${r.name || r.role}: 옷을 걸 횃대를 넣음`); }
    }
    for (const c of mine()) if (/횃대/.test(c.name_ko || '') && r.rail && ['furniture', 'life_trace'].includes(c.role)) { out = out.filter(x => x !== c); fixes.push(`${r.name || r.role}: 「${c.name_ko}」 물건 뺌 — 방에 횃대를 그림`); }
    // 필수 살림 — 이름이나 검색어가 겹치는 물건이 없으면 넣는다
    let n = 0;
    for (const m of t.must) {
      if (m.place === 'on_pot' && !r.buttumak) continue;
      const have = mine().some(c => [m.name_ko, ...m.q].some(w => String(c.name_ko || '').includes(w)) || (m.q || []).some(w => String(w).includes(String(c.name_ko || '').trim()) && String(c.name_ko || '').trim().length >= 2));
      if (have) continue;
      n++; out.push({ item_id: newId(r.id), room: r.id, name_ko: m.name_ko, q: m.q, role: 'furniture', place: m.place, on_item: null, serves: [], scenes: [], why: `${r.role}에 당연히 있을 살림(방 유형 사전)`, auto: true });
      fixes.push(`${r.name || r.role}: 필수 살림 「${m.name_ko}」 넣음`);
    }
    // 창고(헛간·곳간): 오래 쌓아 둔 물건이 빽빽해야 창고로 읽힌다 — 사전 fill 목록으로 최소 개수까지(10/21 미르)
    if (t.min_items && Array.isArray(t.fill)) {
      for (const f of t.fill) {
        // 살림만 센다 — 이야기·퍼즐 물건은 에셋이 없어 빠질 수 있고, 방은 살림만으로도 쓰임이 읽혀야 한다
        if (mine().filter(c => ['furniture', 'life_trace'].includes(c.role) && c.place !== 'marker').length >= t.min_items) break;
        if (mine().some(c => [f.name_ko, ...f.q].some(w => String(c.name_ko || '').includes(w)))) continue;
        const sup = f.on ? mine().find(c => String(c.name_ko || '').includes(f.on)) : null;
        n++; out.push({ item_id: newId(r.id), room: r.id, name_ko: f.name_ko, q: f.q, role: 'life_trace', place: sup ? 'on_item' : (f.place === 'on_item' ? 'floor' : f.place), on_item: sup ? sup.item_id : null, serves: [], scenes: [], why: `${r.role}의 쓰임에서 나오는 살림(방 유형 사전)`, auto: true });
        fixes.push(`${r.name || r.role}: 살림 「${f.name_ko}」 넣음(${r.role}은 최소 ${t.min_items}개)`);
      }
    }
    // 가운데 비움 방(대청): 살림은 사전의 벽 가구만 남긴다. 이야기·퍼즐 물건은 받침이 빠지면 벽 가구 위로, 바닥 것은 마루 끝으로(10/21 미르)
    if (t.center === 'empty') {
      const wallOk = t.must.filter(m => m.place === 'wall').flatMap(m => [m.name_ko, ...m.q]);
      for (const c of mine()) {
        if (!['furniture', 'life_trace'].includes(c.role)) continue;
        if (c.place === 'wall' && wallOk.some(w => String(c.name_ko || '').includes(w))) continue;
        out = out.filter(x => x !== c); fixes.push(`${r.name || r.role}: 「${c.name_ko}」 뺌 — ${r.role} 가운데는 비워 두고 벽 가구만`);
      }
      const top = mine().find(c => /반닫이|반다지/.test(c.name_ko || '')) || mine().find(c => c.place === 'wall' && ['furniture', 'life_trace'].includes(c.role) && !/찬장/.test(c.name_ko || ''));
      for (const c of mine()) {
        if (['furniture', 'life_trace'].includes(c.role) || c.place === 'marker' || c.role === 'marker') continue;
        const nm = String(c.name_ko || '');
        if (/댓돌|디딤돌|섬돌|마루 끝|문턱/.test(nm)) { if (c.place !== 'edge_step') { c.place = 'edge_step'; c.on_item = null; fixes.push(`${r.name || r.role}: 「${nm}」 → 마루 끝 디딤돌 자리`); } continue; }
        if (/보따리|봇짐|꾸러미/.test(nm)) { if (c.place !== 'edge') { c.place = 'edge'; c.on_item = null; fixes.push(`${r.name || r.role}: 「${nm}」 → 마루 끝(나갈 채비한 짐)`); } continue; }
        if (c.place === 'on_item' && !mine().some(x => x.item_id === c.on_item)) {
          if (top) { c.on_item = top.item_id; fixes.push(`${r.name || r.role}: 「${nm}」 받침이 빠져 「${top.name_ko}」 위로`); }
          else { c.place = 'edge'; c.on_item = null; fixes.push(`${r.name || r.role}: 「${nm}」 받침이 없어 마루 끝으로`); }
        } else if (['floor', 'corner', 'wall_low'].includes(c.place)) { c.place = 'edge'; fixes.push(`${r.name || r.role}: 「${nm}」 → 마루 끝(가운데 비움)`); }
      }
    }
    // 10/26 미르: 「방 전체 배치가 엉망 — 도둑이라도 든 것 같다」 — 살림 수에 상한. 사전 필수 살림을 먼저 남기고 나머지(LLM 이 더 넣은 것)를 덜어 낸다. 퍼즐·이야기 물건은 세지 않는다
    { const CAP = { 대청: 3, 부엌: 7, 헛간: 9, 곳간: 9 }[r.role] ?? 6; const life = mine().filter(c => ['furniture', 'life_trace'].includes(c.role) && c.place !== 'marker');
      if (life.length > CAP) { const isMust = c => t.must.some(m => [m.name_ko, ...(m.q || [])].some(w => String(c.name_ko || '').includes(w))); const keep = [...life.filter(isMust), ...life.filter(c => !isMust(c))].slice(0, CAP); for (const c of life) if (!keep.includes(c) && !out.some(x => x.on_item === c.item_id && (x.serves || []).length)) { out = out.filter(x => x !== c); fixes.push(`${r.name || r.role}: 「${c.name_ko}」 뺌 — 살림이 너무 많음(${r.role} ${CAP}개까지)`); } } }
    // 검색어 붙이기(07) — 사전의 같은 물건 이름
    for (const c of mine()) if (!c.q) { const m = t.must.find(x => [x.name_ko, ...x.q].some(w => String(c.name_ko || '').includes(w))); if (m) c.q = m.q; }
  }
  return { contents: out, fixes };
}
const FLOORS = ['jangpan', 'maru', 'earth'];

const INDOOR_SYSTEM = `너는 지역 설화 기반 방탈출 게임 「왜곡」의 실내 공간 구성 에이전트다. 이야기(01 사실·04 Scene·05 퍼즐 초안)와 제작팀의 각색 조건을 읽고,
코드가 만들 「한옥 한 채」의 계획을 세운다. 좌표·치수는 정하지 않는다 — 정해진 선택지만 고른다. 코드가 공간을 만들고 물건을 규칙대로 놓는다.
한옥은 실내만으로 이루어지지 않는다. 공간 종류(kind)는 둘이다 — room(문을 닫는 방) · maru(대청·툇마루처럼 지붕은 있지만 앞이 마당으로 트인 반외부 공간. 실내가 아니다). 마당은 걸어 들어가지 않지만 마루와 문에서 보이는 배경으로 코드가 늘 만든다.
해야 할 일
1) 공간(rooms) 2~4개: 이야기가 일어나는 집의 방·마루. role 은 ${ROLES.join('·')} 중 하나, kind 는 [방 유형 사전]의 그 유형 종류를 따른다. 이름(name)은 짧은 한국어(같은 role 이 둘이면 이름으로 구분).
   - maru 는 앞문·앞벽·앞창이 없다(front_door: null). 뒷벽 back 은 doors(뒤뜰로 나가는 문 — 대청의 보통 모습)|windows|wall. sees: 마루에 앉은 자리에서 바깥으로 꼭 보여야 할 것(이야기·퍼즐 근거 — 예: 목소리가 들리는 대문, 발자국이 끝나는 디딤돌, 달). 마루 바닥에 두는 물건은 floor 가 아니라 edge(마루 끝, 마당 쪽 가장자리)로, 마루 끝 디딤돌·댓돌 자리는 edge_step.
   - 크기 kan_x(칸 수 1~3), kan_m(한 칸 폭 small|medium|large), depth(small|medium|large). 바닥 floor: jangpan(장판, 방)·maru(마루, 대청)·earth(흙, 부엌·헛간·대문간).
   - 벽 wall: hanji(창호지 바른 방)·plaster(흙벽). 천장 ceiling: banja(반자, 방)·rafters(서까래 드러남, 부엌·대청·헛간).
   - front_door: 앞쪽(열린 면) 문. 플레이어가 처음 들어오는 방에는 반드시. kan 은 0부터. at 은 그 칸 안 위치 0~1.
   - windows 0~2: wall 은 back·front, size 는 small|medium. closet(벽장, back 벽) 0~1. shelf(시렁) 0~1: wall 은 back|left|right. rail(횃대, 옷 거는 막대) 0~1.
   - buttumak(부뚜막, 아궁이 n 개)은 부엌만, wall 은 left|right.
   - scenes: 이 방에서 일어나는 Scene id. why: 왜 이 방이 필요한가(이야기·퍼즐 근거).
2) 방 사이 연결(links): 방들은 한 줄로 옆으로 붙어 있다. a 방의 wall_a(left|right) 쪽 문이 b 방의 반대쪽 문으로 이어진다. 모든 방이 이어지게. 순서는 장면 순서가 아니라 집의 구조를 따른다 — [방 유형 사전]의 「붙는 자리」(예: 마루를 가운데, 부엌은 마루 옆, 창고는 부엌 다음 끝). 장면이 창고에서 먼저 일어나도 창고를 마루에 바로 붙이지 않는다(부엌을 지나 들어간다). 부엌과 안방이 둘 다 있으면 붙인다(아궁이가 안방 구들을 데운다).
3) 물건(contents): 방마다 그 방의 쓰임에서 당연히 있어야 할 살림(furniture·life_trace)과 이야기 물건(story_prop), 05 퍼즐 호스트(puzzle_host — host_needs 를 모두 받는다, serves 에 need_id).
   - 항목 하나 = 눈에 보이는 물건 한 종류(「A 와 B」로 묶지 않는다). name_ko 는 라이브러리에서 찾을 구체 명사(예: 등잔걸이, 반닫이, 놋요강, 짚신, 두루마기) — 「정돈된」「접힌」 같은 꾸밈말은 why 에. q: 라이브러리 검색어 2~4개(같은 물건의 다른 이름·더 넓은 이름, 예: 이부자리 → 이불·요·침구 / 반닫이 → 궤·함 / 서찰 → 편지·문서).
   - place: wall(벽에 등을 붙임: 장·궤·반닫이·뒤주) | corner(구석: 항아리·등잔걸이·땔나무) | floor(방바닥 빈 곳: 소반·방석·화로) | wall_low(벽 따라 낮게: 개킨 이불·자리) | on_shelf(시렁 위) | on_pot(부뚜막 솥 자리, 솥만) | on_item(다른 물건 위 — on_item 에 그 item_id) | hang(횃대에 건 옷) | edge(마루 끝, maru 만) | edge_step(마루 끝 디딤돌 자리, maru 만) | marker(물건 없이 자리 표식).
   - 방은 「무엇을 하는 방인지」가 살림으로 읽혀야 한다. 아래 [방 유형 사전]의 그 방 쓰임과 꼭 있을 것을 따르고, 두지 않음 목록의 살림은 넣지 않는다. 옷은 사람이 입지 않으면 서 있을 수 없으므로 hang(횃대) 또는 개켜 둔다.
   - 창고(헛간·곳간)는 자주 쓰지 않고 오래 쌓아 둔 여러 종류의 물건으로 빽빽하게(10~16개): 농기구·바구니·독·가마니·낡은 궤 등을 벽을 따라 겹쳐 둔다.
   - on_item 은 윗면이 평평한 받침(궤·반닫이·뒤주·소반·서안·장) 위에만. 항아리·독·동이·솥·바구니처럼 둥근 것 위에는 올리지 않는다.
   - 이야기 물건·퍼즐 호스트도 그 방의 쓰임 안에서 자연스러운 자리에 둔다(사랑방이면 서안 위 장부, 부엌이면 부뚜막 옆 쪽지). 방 한가운데 뜬금없는 물건을 세우지 않는다.
   - 발자국·자국·흔적·얼룩·그림자·「~자리」 같은 흔적은 물건이 아니다 — place 를 marker 로(뷰어가 바닥·창에 그린다). 흔적을 대신할 가구를 두지 않는다.
   - 방마다 살림 4~9개 + 이야기 물건·퍼즐 호스트. 바닥에 놓는 것(floor·corner·wall·wall_low)은 칸 하나에 4개 안팎까지 — 좁은 방에 몰면 놓을 자리가 없다. 방 성격에 안 맞는 것(안방에 장독, 부엌에 이불)은 넣지 않는다.
   - 인물(npc)·귀신·사람 모형은 넣지 않는다(각색 조건). 05 에 npc·sound_source·standing_spot 호스트가 있으면 그 자리를 보여 줄 물건이나 흔적(신발·등잔·문창호 그림자 자국 등)으로 바꾸거나 place 를 marker 로 한다.
   - scenes: 사건의 결과로 생기는 흔적은 그 Scene 부터. 늘 있는 살림은 비운다.
4) light_story: 시간·빛이 이야기 장치라면(밤↔낮 등) 창·문 빛을 어떻게 바꿀지 한두 문장(코드는 아직 기록만 한다).
출력: \`\`\`json 코드블록 하나만. 순수 JSON.
{"set_name":"","rooms":[{"id":"r1","name":"","role":"사랑방","kind":"room","back":null,"sees":[],"kan_x":2,"kan_m":"medium","depth":"medium","floor":"jangpan","wall":"hanji","ceiling":"banja",
 "front_door":{"kan":0,"at":0.5},"windows":[{"wall":"back","kan":0,"at":0.5,"size":"medium"}],"closet":null,"shelf":{"wall":"back"},"rail":null,"buttumak":null,"scenes":["scene-01"],"why":""}],
 "links":[{"a":"r1","b":"r2","wall_a":"right","at":0.5}],
 "contents":[{"item_id":"C-01","room":"r1","name_ko":"","q":[],"role":"furniture|life_trace|story_prop|puzzle_host|marker","place":"wall","on_item":null,"serves":[],"scenes":[],"why":""}],
 "light_story":"","notes":""}`;

const SELECT_SYSTEM = `너는 「왜곡」 실내 에셋 선정 에이전트다. 실내 공간 계획의 물건 항목마다 공용 라이브러리 후보 중에서 하나를 고른다.
- 항목에 「필요: 열려야 함」·「필요: 물·곡식이 들어 있어야 함」·「필요: 걷혀야 함」·「필요: 깨져야 함」이 붙어 있으면 후보 가운데 [열리는 판]·[찬 판]·[걷히는 판]·[깨지는 판] 표시가 있는 것을 고른다(이름이 조금 달라도 같은 쓰임이면 — 문갑 자리에 서랍이 열리는 탁자장). 퍼즐에서 그 물건을 열거나 비워 단서가 나오기 때문이다.
- 단, 그런 표시가 있는 후보가 없거나 맞지 않으면 이름·쓰임이 맞는 보통 후보를 고른다. 퍼즐 호스트(puzzle_host)는 비워 두지 않는다 — 비우면 그 단서를 얻을 수 없어 퍼즐이 끊긴다(10/23: 초롱·서안을 「열리는 판이 없다」며 비움). 궁궐 재현품도 민가에 놓을 만한 살림이면 쓴다. missing 은 후보가 하나도 그 물건이 될 수 없을 때만. 열리는 판을 얻으려고 다른 물건으로 바꾸지 않는다 — 같은 물건(초롱 자리에 등·초롱·등롱)이 열리는 판보다 먼저다(나쁜 예: 초롱 자리에 다기장, 가마솥 자리에 탁자장). 서안 자리의 탁자장처럼 쓰임이 같은 가구(문갑·서랍 있는 책상)만 바꿔 쓸 수 있다.
규칙
- 그 항목의 후보 목록에 있는 id 만 고른다. 지어내지 않는다.
- 이름·분류·시대·설명·크기를 본다. 방 안에 놓일 크기여야 한다(건물·나무·바위·배 같은 큰 것은 고르지 않는다).
- 고르는 것은 그 항목의 물건 자체다. 다른 물건의 「자리·호스트」로 아무 가구를 고르지 않는다. 발자국·자국·흔적·얼룩 항목은 물건이 아니므로 pick null(missing 도 null).
- 대체는 생김새·크기·쓰임이 비슷할 때만, reason 에 대체라고 적는다. 맞는 게 없으면 pick 을 null 로 두고 missing 에 필요한 것을 적는다.
- 장소·신분·시대에 맞는 것: 서민·중인·지방 양반 집의 살림이면 「궁궐 재현품」 표시 후보는 고르지 않는다(대체로도 쓰지 않는다 — 맞는 민가 것이 없으면 pick null + missing 으로 생성 요청). 붉은 칠 장식 기물·근현대 물건도 고르지 않는다.
- 「임시본」은 코드 모형 임시 3D — 뜻이 맞으면 써도 된다. 「설명 추정」은 메타를 코드가 추정한 것 — 이름·분류를 더 믿는다.
출력: \`\`\`json 코드블록 하나만. 한 항목을 한 줄에.
{"selections":[{"item_id":"C-01","pick":"후보 id 또는 null","reason":"","missing":null 또는 {"name_ko":"","description_ko":"","why":""}}]}`;

/** 윗면이 둥글거나 열린 그릇 — 그 위에 물건을 올리면 떠 보인다(10/21 미르: 항아리 위 바가지) */
const LEAN = /빗자루|싸리비|대비|갈퀴|쇠스랑|도리깨|장대|작대기|괭이|삽$|가래|살포|지팡이|빨래방망이|다듬이 ?방망이/;
const ROUND = /항아리|독|단지|동이|솥|병|요강|바구니|삼태기|소쿠리|함지|바가지|물두멍|옹기/;
const KAN = { small: 2.2, medium: 2.5, large: 2.8 };
const DEPTH = { small: 2.6, medium: 3.0, large: 3.4 };
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const pickOf = (v, list, d) => (list.includes(v) ? v : d);
const opp = w => (w === 'left' ? 'right' : 'left');

/** 06 계획 → room_gen 사양 세트(rooms_set.py 입력). 범위·모순은 코드가 고치고 고친 것을 notes 에 남긴다 */
export function planToSet(plan, picked = null, { raw = false } = {}) {
  const notes = [];
  const rooms = (plan.rooms || []).filter(r => r && r.id).slice(0, 4);
  if (rooms.length < 1) throw Object.assign(new Error('06 계획에 방이 없습니다.'), { status: 422, code: 'no_rooms' });
  // 방은 한 줄로 옆에 붙는다 — 깊이는 하나로 맞춘다(맞닿은 벽 길이 검사)
  const depthKey = rooms.map(r => r.depth).find(d => DEPTH[d]) || 'medium';
  const D = DEPTH[depthKey];
  if (rooms.some(r => r.depth && r.depth !== depthKey)) notes.push(`방 깊이를 하나로 맞춤(${depthKey}, ${D} m) — 옆으로 붙은 방은 맞닿은 벽 길이가 같아야 함`);
  const links = (plan.links || []).filter(l => l && rooms.some(r => r.id === l.a) && rooms.some(r => r.id === l.b) && l.a !== l.b).map(l => ({ a: l.a, b: l.b, wall_a: l.wall_a === 'left' ? 'left' : 'right' }));
  // 한 방의 한 벽에는 연결 문 하나 — 겹치면 반대 벽으로, 그래도 겹치면 뺌
  const used = new Set(); const kept = [];
  for (const l of links) {
    const ok = w => !used.has(`${l.a}|${w}`) && !used.has(`${l.b}|${opp(w)}`);
    let w = l.wall_a;
    if (!ok(w)) { if (ok(opp(w))) { notes.push(`${l.a}↔${l.b} 연결 벽을 ${opp(w)} 로 옮김(같은 벽에 연결 문이 둘)`); w = opp(w); } else { notes.push(`${l.a}↔${l.b} 연결을 뺌(양쪽 벽에 이미 연결 문)`); continue; } }
    used.add(`${l.a}|${w}`); used.add(`${l.b}|${opp(w)}`); kept.push({ ...l, wall_a: w });
  }
  const linkWalls = id => new Set(kept.flatMap(l => (l.a === id ? [l.wall_a] : l.b === id ? [opp(l.wall_a)] : [])));
  const ids = new Set(); const names = new Set();
  const out = rooms.map((r, i) => {
    let id = String(r.id || `r${i + 1}`).replace(/[^\w-]/g, '').slice(0, 20) || `r${i + 1}`;
    while (ids.has(id)) id += 'x'; ids.add(id);
    const role = pickOf(r.role, ROLES, '안방');
    let name = String(r.name || role).replace(/[\\/:*?"<>|↔]/g, '').slice(0, 12) || role;
    if (!raw && /대문/.test(name) && role !== '대문간') name = role; // 쓰지 않는 방 유형 이름이 남으면 헷갈림(10/21)
    while (names.has(name)) name += '2'; names.add(name);
    // 창고는 좁게(1칸) — 넓은 바닥에 물건이 흩어지면 창고로 안 읽힘(10/21 미르)
    const STORE = !raw && ['헛간', '곳간'].includes(role); // raw = 원안 비교판(10/22): 10/21 미르 검수 규칙은 끈다
    // 창고 칸 수(10/22): 1칸이 기본(빽빽하게), 바닥 물건이 9개 넘으면 2칸 — 「창고 1칸」과 「최소 12개」가 부딪혀 물건을 못 놓던 문제
    const storeN = STORE ? (plan.contents || []).filter(c => c.room === r.id && c.place !== 'marker' && c.role !== 'marker' && !['on_shelf', 'on_item'].includes(c.place) && (!picked || picked.has(c.item_id))).length : 0;
    const storeK = storeN > 9 ? 2 : 1;
    if (STORE && Number(r.kan_x) !== storeK) notes.push(`${name}: 창고라 ${storeK}칸으로 맞춤(바닥 물건 ${storeN}개 — 벽을 따라 빽빽하게)`);
    let kanX = STORE ? storeK : Math.round(num(r.kan_x, 1, 3, 1));
    // 넓이 ↔ 물건 수 — 물건 하나에 바닥 2 m² 안팎(흔적·자리 표식 제외). 모자라면 칸을 줄인다
    // 08 에서는 실제로 고른 물건만 센다(라이브러리에 없어 못 놓을 물건으로 방을 키우지 않게)
    const things = (plan.contents || []).filter(c => c.room === r.id && c.place !== 'marker' && c.role !== 'marker' && (!picked || picked.has(c.item_id))).length;
    const need = Math.max(1, Math.ceil((things * 2.0) / ((KAN[r.kan_m] || KAN.medium) * (DEPTH[r.depth] || 3.0))));
    // 대청은 원래 넓고 비어 있는 마루 — 물건 수로 줄이지 않는다(가운데 비움, 10/21 미르)
    if (!raw && (role === '대청' || r.kind === 'maru')) kanX = Math.max(2, kanX);
    if (!STORE && (raw || (role !== '대청' && r.kind !== 'maru')) && kanX > need) { notes.push(`${name}: 물건 ${things}개에 비해 넓어 ${kanX}칸 → ${need}칸으로 줄임`); kanX = need; }
    const K = STORE ? KAN.large : (KAN[r.kan_m] || KAN.medium);
    const floor = pickOf(r.floor, FLOORS, ['부엌', '헛간', '대문간', '곳간'].includes(role) ? 'earth' : role === '대청' ? 'maru' : 'jangpan');
    const lift = floor === 'earth' ? 0.15 : 0.45;
    const W = K * kanX;
    const lw = linkWalls(r.id);
    const spec = { kan_x: kanX, kan_m: K, wall_h: +(2.75 - lift).toFixed(2), floor_lift: lift, floor, depth_m: D, role,
      wall: pickOf(r.wall, ['hanji', 'plaster'], floor === 'earth' ? 'plaster' : 'hanji'),
      ceiling: pickOf(r.ceiling, ['banja', 'rafters'], floor === 'jangpan' ? 'banja' : 'rafters'), openings: [], shelves: [], rails: [] };
    if (spec.ceiling === 'rafters') spec.rafter_wood = 'wood_dk';
    // 마루(kind maru) = 앞이 마당으로 트인 반외부(10/22 미르: 대청은 실내가 아니라 마루). LLM 이 kind 로 적은 것을 따르고, 원안 비교판이 아니면 대청은 늘 마루
    const OPEN = r.kind === 'maru' || (!raw && role === '대청');
    const BACKDOORS = OPEN && (r.back === 'doors' || (!raw && role === '대청'));
    if (OPEN) { spec.front_wall = false; spec.front_frame = true; } // 10/21 미르: 대청은 마당을 내다보는 마루
    const fd = OPEN ? null : (r.front_door || (i === 0 ? { kan: 0, at: 0.5 } : null));
    if (!r.front_door && i === 0) notes.push(`${name}: 처음 들어오는 방이라 앞문을 넣음`);
    if (fd) spec.openings.push({ wall: 'front', type: 'door', kan: Math.round(num(fd.kan, 0, kanX - 1, 0)), at: num(fd.at, 0.3, 0.7, 0.5), w: floor === 'earth' ? 0.85 : 0.8, h: floor === 'earth' ? 1.75 : 1.65 });
    // 대청 뒷벽은 창이 아니라 문 두 짝(뒤뜰로 나가는 대청 뒷문) — 10/21 미르
    if (BACKDOORS) { const ks = kanX >= 2 ? [0, kanX - 1] : [0]; for (const kan of ks) spec.openings.push({ wall: 'back', type: 'door', kan, at: 0.5, w: 0.9, h: 1.7 }); if (r.back !== 'doors') notes.push(`${name}: 뒷벽은 창 대신 대청 뒷문 ${ks.length}짝`); }
    for (const w of (BACKDOORS ? [] : (r.windows || []).filter(w => !OPEN || w?.wall !== 'front')).slice(0, 2)) {
      if (!w) continue;
      const wall = OPEN ? 'back' : (['back', 'front'].includes(w.wall) ? w.wall : 'back');
      const kan = Math.round(num(w.kan, 0, kanX - 1, 0));
      if (spec.openings.some(o => o.wall === wall && o.kan === kan)) { notes.push(`${name}: ${wall} ${kan}칸에 이미 문·창이 있어 창 하나를 뺌`); continue; }
      const big = w.size === 'medium';
      spec.openings.push({ wall, type: 'window', kan, at: 0.5, w: big ? 0.85 : 0.6, h: big ? 0.7 : 0.45, sill: floor === 'earth' ? 1.5 : 0.8 });
    }
    if (r.closet) {
      const kan = Math.round(num(r.closet.kan, 0, kanX - 1, kanX - 1));
      if (!spec.openings.some(o => o.wall === 'back' && o.kan === kan)) spec.openings.push({ wall: 'back', type: 'closet', kan, at: 0.55, w: +Math.min(1.0, K - 0.6).toFixed(2), h: 1.1, sill: 0.7 });
      else notes.push(`${name}: 벽장 자리(뒷벽 ${kan}칸)에 창이 있어 벽장을 뺌`);
    }
    if (r.shelf) {
      let wall = ['back', 'left', 'right'].includes(r.shelf.wall) ? r.shelf.wall : 'back';
      if (lw.has(wall)) { notes.push(`${name}: 시렁 벽(${wall})에 연결 문이 있어 뒷벽으로 옮김`); wall = 'back'; }
      const len = wall === 'back' ? W : D;
      spec.shelves.push({ wall, from: +(len * 0.15).toFixed(2), to: +(len * 0.15 + Math.min(1.6, len * 0.6)).toFixed(2), y: floor === 'earth' ? 1.7 : 1.95, depth: 0.42 });
    }
    if (r.rail && (floor !== 'earth' || (plan.contents || []).some(c => c.room === r.id && c.place === 'hang'))) {
      // 횃대 벽: 원하는 벽 → 반대쪽 → 뒷벽 순으로, 연결 문·시렁이 없는 벽(10/21)
      const want = ['left', 'right', 'back'].includes(r.rail.wall) ? r.rail.wall : 'left';
      const wall = [want, opp(want), 'back'].find(w => !lw.has(w) && !spec.shelves.some(s => s.wall === w)) || want;
      const hung = (plan.contents || []).some(c => c.room === r.id && c.place === 'hang');
      if (!lw.has(wall) && !spec.shelves.some(s => s.wall === wall)) spec.rails.push({ wall, from: 0.25, to: +Math.min(1.4, D - 0.6).toFixed(2), y: 1.75, cloth: hung ? [] : [{ mat: 'cloth_a' }] });
      else if (hung) notes.push(`${name}: 횃대를 걸 벽이 없어 옷을 못 검`);
    }
    if (r.buttumak && role === '부엌') {
      let wall = r.buttumak.wall === 'left' ? 'left' : 'right';
      if (lw.has(wall) && !lw.has(opp(wall))) { notes.push(`${name}: 부뚜막 벽에 연결 문이 있어 ${opp(wall)} 벽으로 옮김`); wall = opp(wall); }
      // 같은 벽에 연결 문(위치 0.8·D)이 있으면 부뚜막은 뒤쪽 0.62·D 까지만
      const to = lw.has(wall) ? Math.min(1.95, D * 0.62) : Math.min(1.95, D - 0.5);
      spec.buttumak = [{ wall, from: 0.15, to: +to.toFixed(2), n: Math.round(num(r.buttumak.n, 1, 2, 2)), h: 0.55, depth: 0.8 }];
    } else if (r.buttumak) notes.push(`${name}: 부뚜막은 부엌에만 — 뺌`);
    return { id, name, role, spec, planId: r.id, scenes: r.scenes || [], why: String(r.why || '').slice(0, 300) };
  });
  const byPlan = new Map(out.map(r => [r.planId, r]));
  const setLinks = kept.map(l => ({ a: byPlan.get(l.a).name, b: byPlan.get(l.b).name, wall_a: l.wall_a, at: 0.8, w: 0.75, h: 1.55 }));
  // 이어지지 않은 방은 이웃 방에 붙인다(모든 방이 이어짐 검사)
  const reach = new Set([out[0].name]); let grew = true;
  const grow = () => { grew = true; while (grew) { grew = false; for (const l of setLinks) if (reach.has(l.a) !== reach.has(l.b)) { reach.add(l.a); reach.add(l.b); grew = true; } } };
  grow();
  const usedN = new Set(setLinks.flatMap(l => [`${l.a}|${l.wall_a}`, `${l.b}|${opp(l.wall_a)}`]));
  for (const r of out) if (!reach.has(r.name)) {
    const host = out.find(o => reach.has(o.name) && ['right', 'left'].some(w => !usedN.has(`${o.name}|${w}`) && !usedN.has(`${r.name}|${opp(w)}`)));
    if (!host) { notes.push(`${r.name}: 이어 붙일 벽이 없음`); continue; }
    const w = ['right', 'left'].find(x => !usedN.has(`${host.name}|${x}`) && !usedN.has(`${r.name}|${opp(x)}`));
    setLinks.push({ a: host.name, b: r.name, wall_a: w, at: 0.8, w: 0.75, h: 1.55 }); usedN.add(`${host.name}|${w}`); usedN.add(`${r.name}|${opp(w)}`);
    notes.push(`${r.name}: 어느 방과도 이어지지 않아 ${host.name} ${w} 쪽에 붙임`); grow();
  }
  // 연결 벽에 생긴 부뚜막 충돌 다시 확인(붙인 뒤)
  const adjacency = [];
  const kitchen = out.find(r => r.role === '부엌'), anbang = out.find(r => r.role === '안방');
  if (kitchen && anbang) adjacency.push({ pair: [kitchen.name, anbang.name], why: '아궁이 불이 안방 구들을 데운다' });
  return { set: { name: String(plan.set_name || '실내 방 세트').slice(0, 60), depth_m: D, rooms: out.map(r => ({ id: r.id, name: r.name, role: r.role, spec: r.spec })), links: setLinks, adjacency_rules: adjacency }, rooms: out, notes, byPlan };
}

// ── 흔적(10/21) — 발자국·빛 얼룩·물 고인 바닥·그림자·핏자국·소리 나는 곳·서는 자리. 3D 에셋이 아니라 뷰어가 바닥·창에 그린다 ──
export const TRACE_KO = { step: '디딤돌(마루 끝)', foot: '발자국', light: '빛 얼룩', water: '물 고인 바닥', shadow: '창호 그림자', blood: '핏자국', sound: '소리 나는 곳', spot: '서는 자리' };
export const TRACE_NAME = /(발자국|자국|흔적|얼룩|물때|그림자|지점)$|(\s|끝)자리$/; // 「이부자리·돗자리·삿자리」는 물건(10/22)
export function traceKind(name) {
  const n = String(name || '');
  // 「~자리」「~지점」은 게임이 쓰는 위치(서는 곳·소리 나는 곳·끝 지점)일 뿐 눈에 보이는 흔적이 아니다 — 플레이 화면에 그리지 않는다
  if (/자리|지점|위치/.test(n) && !/자국|발자국|그림자/.test(n)) return /목소리|소리/.test(n) ? 'sound' : 'spot';
  if (/그림자/.test(n)) return 'shadow';
  if (/목소리|소리|울음|부르는/.test(n)) return 'sound';
  if (/피|핏|코피/.test(n)) return 'blood';
  if (/물 고인|물길|웅덩이|젖은 바닥|물 자국|물웅덩이/.test(n)) return 'water';
  if (/빛|달빛|햇빛|낮빛|창살/.test(n) && !/발자국|신 자국|신자국/.test(n)) return 'light'; // 10/26: 「창살 빛 자국」이 발자국으로 그려져 첫 방 단서를 못 찾음
  if (/발자국|신 자국|신자국|걸음|자국|흔적/.test(n)) return 'foot';
  return 'spot';
}
function openingAt(meta, o) {
  const nd = meta.nodes?.[o.name]; if (!nd?.hinge) return null;
  const [hx, hy, hz] = nd.hinge; const W = meta.walk.x[1] + meta.walk.x[0]; const D = meta.spec.depth_m;
  const c = { left: { x: 0.06, z: hz + o.w / 2, nx: 1, nz: 0 }, right: { x: W - 0.06, z: hz - o.w / 2, nx: -1, nz: 0 }, back: { x: hx + o.w / 2, z: 0.06, nx: 0, nz: 1 }, front: { x: hx + o.w / 2, z: D - 0.06, nx: 0, nz: -1 } }[o.wall];
  return c ? { ...c, name: o.name, type: o.type, wall: o.wall, w: o.w, h: o.h, y: hy, link: o.link || null } : null;
}
export function traceLayout(meta, markers, rooms, room) {
  const traces = [], notes = [];
  if (!markers.length) return { traces, notes };
  const ops = (meta.openings || []).map(o => openingAt(meta, o)).filter(Boolean);
  const windows = ops.filter(o => o.type === 'window' || (room.spec?.front_wall === false && o.type === 'door' && o.wall === 'back' && !o.link)).sort((a, b) => (a.wall === 'back' ? -1 : 1) - (b.wall === 'back' ? -1 : 1));
  const doors = ops.filter(o => o.type === 'door');
  const idx = rooms.findIndex(x => x.id === room.id);
  // 발자국이 향할 문: 다음 방으로 가는 연결 문 → 앞문 → 아무 문
  const next = rooms[idx + 1]?.name;
  let target = doors.find(d => d.link && next && d.link.includes(next)) || doors.find(d => d.wall === 'front') || doors[0];
  const W = meta.walk.x[1] + meta.walk.x[0], D = meta.spec.depth_m, FY = meta.floor_y;
  const OPEN = room.spec?.front_wall === false;
  if (OPEN) target = { x: W / 2, z: D - 0.06, nx: 0, nz: -1, name: '마루 끝', type: 'edge', wall: 'front', w: 1.2 };
  const center = { x: W / 2, z: D / 2 };
  const clampIn = p => ({ x: Math.min(W - 0.3, Math.max(0.3, p.x)), z: Math.min(D - 0.3, Math.max(0.3, p.z)) });
  const pl = meta.placements || [];
  let lightAt = null;
  for (const [k, c] of markers.entries()) {
    const kind = c.pending ? 'spot' : (c.show?.kind && c.show.kind !== 'object') ? c.show.kind : c.place === 'edge_step' ? 'step' : traceKind(c.name_ko); // 10/26: 단서가 「발자국」이라 하면 디딤돌 자리라도 발자국을 그린다 // pending = 에셋 없는 퍼즐 호스트의 임시 자리(10/22) · 10/26: 05 가 적은 shows.kind 를 먼저
    const t = { id: c.item_id, name: String(c.name_ko).slice(0, 30), kind, ...(c.show?.cells?.length ? { cells: c.show.cells, grid: c.show.grid || null } : {}), ...(c.show?.figure ? { figure: c.show.figure } : {}), wet: /젖은|물/.test(c.name_ko || ''), faint: /옅|희미|사라/.test(c.name_ko || ''), y: FY };
    if (kind === 'foot') {
      if (!target) { notes.push(`「${c.name_ko}」: 이어질 문이 없어 못 그림`); continue; }
      const end = clampIn({ x: target.x + target.nx * 0.45, z: target.z + target.nz * 0.45 });
      const anchor = pl.find(q => /이부자리|이불|요$/.test(q.name)) || null;
      const start = clampIn(anchor ? { x: anchor.x + (center.x - anchor.x) * 0.4, z: anchor.z + (center.z - anchor.z) * 0.4 } : center);
      // 사람 발걸음은 방 전체에 찍히지 않는다 — 흙·물이 묻은 첫 걸음(출발점 근처)과 문턱 앞 몇 걸음만 남는다
      const L = Math.hypot(end.x - start.x, end.z - start.z), ux = (end.x - start.x) / (L || 1), uz = (end.z - start.z) / (L || 1);
      let seed = [...String(c.item_id)].reduce((a, ch) => a + ch.charCodeAt(0), 7);
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const steps = [];
      const at = (d, i) => { const side = (i % 2 ? 1 : -1) * (0.075 + rnd() * 0.03); return [+(start.x + ux * d - uz * side).toFixed(3), +(start.z + uz * d + ux * side).toFixed(3), +((rnd() - 0.5) * 0.35).toFixed(3), +(0.9 + rnd() * 0.2).toFixed(2)]; };
      const stride = () => 0.5 + rnd() * 0.12;
      if (c.show?.count) { /* 10/26: 단서가 「발자국 n개」라 하면 정확히 n개를 문 쪽으로 고르게 */ const n = Math.max(1, Math.min(8, c.show.count)); const st = Math.min(0.62, Math.max(0.3, (L - 0.3) / Math.max(1, n - 1))); let d = Math.max(0.15, L - 0.15 - st * (n - 1)); for (let i = 0; i < n; i++) { steps.push(at(d, i)); d += st; } }
      else { if (L > 1.6) { let d = 0.1; for (let i = 0; i < 2; i++) { steps.push(at(d, i)); d += stride(); } }
      { let d = Math.max(0.2, L - 0.15); const tail = []; for (let i = 0; i < 3 && d > 0.2; i++) { tail.unshift(at(d, i + (L > 1.6 ? 2 : 0))); d -= stride(); } steps.push(...tail); } }
      t.steps = steps; t.to = target.name;
    } else if (kind === 'light' || kind === 'spot') {
      const w = windows[0];
      if (kind === 'light' && w && w.type === 'door') {
        // 바깥(뒤뜰) 달빛이 문 창호지를 지나 마루로 든다 — 문지방에서 시작해 안쪽으로 길게, 문 자체도 밝게
        const L = 1.5; t.pos = { x: +(w.x + w.nx * (L / 2 + 0.04)).toFixed(3), z: +(w.z + w.nz * (L / 2 + 0.04)).toFixed(3) }; t.size = [+(w.w * 1.1).toFixed(2), L];
        t.rot = +Math.atan2(w.nx, w.nz).toFixed(4); t.src = { x: +w.x.toFixed(3), z: +w.z.toFixed(3), nx: w.nx, nz: w.nz, w: w.w, h: w.h, from: '바깥(뒤뜰) 달빛·햇빛' };
        lightAt = { x: w.x + w.nx * 1.0, z: w.z + w.nz * 1.0 }; t.window = w.name; t.n = [w.nx, w.nz];
      } else if (kind === 'light' && w) { t.pos = clampIn({ x: w.x + w.nx * 1.0, z: w.z + w.nz * 1.0 }); t.size = [+(w.w * 1.5).toFixed(2), 0.9]; t.axis = w.wall === 'back' || w.wall === 'front' ? 'x' : 'z'; lightAt = t.pos; t.window = w.name; t.n = [w.nx, w.nz]; }
      else if (kind === 'light') { t.pos = clampIn(center); t.size = [1.0, 0.8]; t.axis = 'x'; lightAt = t.pos; notes.push(`「${c.name_ko}」: 창이 없어 방 가운데에 그림`); }
      else { const base = lightAt || (w ? { x: w.x + w.nx * 1.0, z: w.z + w.nz * 1.0 } : center); t.pos = clampIn({ x: base.x + (w ? w.nx : 0) * 0.7, z: base.z + (w ? w.nz : 0.6) * 0.7 }); t.size = [0.6, 0.6]; }
    } else if (kind === 'water') {
      if (traces.some(x => x.kind === 'water')) { notes.push(`「${c.name_ko}」: 물 흔적은 방에 하나만 — 앞 것과 합침`); continue; }
      const src = pl.find(q => /물동이|물항아리|항아리|독|물두멍|가마솥/.test(q.name));
      const d = target || doors[0];
      const p0 = src ? { x: src.x + (center.x - src.x) * 0.35, z: src.z + (center.z - src.z) * 0.35 } : d ? { x: d.x + d.nx * 0.55, z: d.z + d.nz * 0.55 } : center;
      t.pos = clampIn(p0); t.size = [0.75, 0.5]; t.rot = +(Math.atan2(center.x - p0.x, center.z - p0.z)).toFixed(3); t.from = src ? src.name : (d ? d.name : null);
    } else if (kind === 'blood') {
      const d = target || doors[0];
      t.pos = clampIn(d ? { x: d.x + d.nx * 0.8, z: d.z + d.nz * 0.8 } : center); t.size = [0.35, 0.3];
    } else if (kind === 'shadow') {
      const w = windows.find(x => x.wall === 'front') || windows[0];
      if (!w) { notes.push(`「${c.name_ko}」: 창이 없어 못 그림`); continue; }
      t.wall = w.wall; t.window = w.name; t.pos = { x: w.x + w.nx * 0.03, z: w.z + w.nz * 0.03 }; t.y = w.y; t.size = [w.w, w.h]; t.normal = [w.nx, w.nz];
    } else if (kind === 'step') {
      if (OPEN) { t.pos = { x: W / 2, z: D + 0.35 }; t.y = FY * 0.55 + 0.002; t.size = [1.2, 0.42]; }
      else { const d = doors.find(x => x.wall === 'front') || doors[0]; t.pos = clampIn(d ? { x: d.x + d.nx * 0.5, z: d.z + d.nz * 0.5 } : center); t.size = [0.8, 0.5]; }
    } else if (kind === 'sound' && OPEN) {
      t.pos = { x: Math.min(W - 0.3, W / 2 + 1.0), z: D - 0.3 }; t.size = [0.7, 0.7]; t.from = '대문 밖';
    } else if (kind === 'sound') {
      const screen = pl.find(q => /병풍/.test(q.name));
      const d = target || doors[0];
      t.pos = clampIn(screen ? { x: screen.x + 0.6, z: screen.z + 0.5 } : d ? { x: d.x + d.nx * 0.5, z: d.z + d.nz * 0.5 } : center); t.size = [0.7, 0.7];
    }
    traces.push(t);
  }
  // 점 모양 흔적(임시 자리·디딤돌·소리·핏자국)이 같은 자리에 겹치면 옆으로 비킨다(10/22: 「부뚜막 글조각」과 「곳간 자물쇠」, 「디딤돌」과 「짚신」이 한 점에 겹쳐 하나를 누를 수 없던 일)
  const POINT = new Set(['spot', 'step', 'sound', 'blood']), taken = [];
  for (const t of traces) {
    if (!POINT.has(t.kind) || !t.pos) continue;
    const base = { ...t.pos }; let p = { ...base }, k = 0;
    while (taken.some(q => Math.hypot(q.x - p.x, q.z - p.z) < 0.55) && k < 8) { k++; const off = Math.ceil(k / 2) * 0.75 * (k % 2 ? 1 : -1); p = { x: Math.min(W - 0.35, Math.max(0.35, base.x + off)), z: base.z }; }
    if (k) notes.push(`「${t.name}」: 다른 흔적과 겹쳐 옆으로 ${(p.x - base.x).toFixed(2)} m`);
    t.pos = { x: +p.x.toFixed(3), z: +p.z.toFixed(3) }; taken.push(t.pos);
  }
  return { traces, notes };
}

// ── 마당 풍광(10/21) — 대청 앞으로 보이는 마당. 걸어 나갈 수 없다(걷는 범위는 마루까지). 좌표: 마루 앞 끝 z=D, 마당 땅 y=0 ──
const YARD_ASSETS = { wall: '신라 귀족 가옥 · 기와 돌담', gate: '신라 귀족 가옥 · 대문', jar: ['옹기 항아리(독)', '항아리 1', '항아리', '단지 1'], tree: '피나무 L', pine: '큰 소나무 1', flower: ['풀꽃', '풀포기 1', '풀포기 2', '풀포기 3', '들국화'], shrub: '덤불', bench: '평상' };
async function yardLayout(root, W, D, seedStr) {
  const { buildLibrary } = await import('./library.mjs');
  const { placementAsset, glbSize } = await import('./manifestPlace.mjs');
  const { items } = await buildLibrary(root);
  const byName = n => items.find(i => i.placeable && i.nameKo === n && /_sf_local/.test(decodeURIComponent(i.url || '')));
  const cache = new Map();
  const asset = async n => { if (cache.has(n)) return cache.get(n); const i = byName(n); let v = null; if (i) { try { const a = await placementAsset(root, { id: i.id, nameKo: i.nameKo, url: i.url, source: i.source === 'khs' ? 'khs' : 'public' }); const ext = await glbSize(path.join(root, a.path)); if (ext) v = { file: path.join(root, a.path), ext }; } catch { v = null; } } cache.set(n, v); return v; };
  let seed = [...seedStr].reduce((a, ch) => a + ch.charCodeAt(0), 11); const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = []; const notes = [];
  const put = async (n, x, z, h, rot = 0, tag = n) => { const a = await asset(n); if (!a) { notes.push(`마당: 「${n}」 에셋 없음`); return null; } const sc = h / a.ext[1]; out.push({ id: `Y-${out.length + 1}`, name: `${tag}${'·'.repeat(out.filter(q => q.name.startsWith(tag)).length)}`, file: a.file, scale: +sc.toFixed(4), x: +x.toFixed(3), y: 0, z: +z.toFixed(3), rot, cls: 'yard', on: 'yard', h: +h.toFixed(3), dims: a.ext.map(v => +(v * sc).toFixed(3)) }); return a; };
  const zWall = D + 8.5, x0 = -6, x1 = W + 6, gateX = W / 2 + 1.6;
  // 담장 — 기와 돌담 토막을 이어 세우고 대문 자리만 비운다
  const wa = await asset(YARD_ASSETS.wall);
  const ga = await asset(YARD_ASSETS.gate);
  if (wa) {
    // 조각을 20 % 겹쳐 잇고 구간 양끝에 딱 맞춘다(겉 상자에 처마가 들어 있어 몸체 사이가 뜨던 것)
    const WH = 1.9, sc = WH / wa.ext[1], seg = wa.ext[0] * sc, th = wa.ext[2] * sc;
    const gw = ga ? ga.ext[0] * (3.6 / ga.ext[1]) : 3.0;
    const run_ = async (a, b, fixed, alongX) => { const L = b - a; if (L <= 0.05) return; const n = L <= seg ? 1 : Math.ceil((L - seg) / (seg * 0.8)) + 1; const st = n > 1 ? (L - seg) / (n - 1) : 0; for (let i = 0; i < n; i++) { const u = n > 1 ? a + seg / 2 + st * i : (a + b) / 2; await put(YARD_ASSETS.wall, alongX ? u : fixed, alongX ? fixed : u, WH, alongX ? 0 : 90, '돌담'); } };
    // 대문 겉 상자 폭에는 처마가 들어 있다 — 몸체(문간 벽)는 그 절반쯤이라 담을 몸체까지 붙인다
    await run_(x0 - th / 2, gateX - gw * 0.22, zWall, true);
    await run_(gateX + gw * 0.22, x1 + th / 2, zWall, true);
    for (const xs of [x0, x1]) await run_(D + 0.6, zWall + th / 2, xs, false);
    notes.push(`마당: 담 조각 길이 ${seg.toFixed(2)} m · 두께 ${th.toFixed(2)} m · 대문 폭 ${gw.toFixed(2)} m`);
  }
  await put(YARD_ASSETS.gate, gateX, zWall + 0.1, 3.6, 0, '대문');
  // 장독대 — 마당 왼쪽 앞, 낮은 돌단 위에 크고 작은 독(돌단은 뷰어가 그림)
  const jx = -0.8, jz = D + 4.2;
  const jarSpots = [[-0.55, -0.25, 0.95], [0.1, -0.3, 0.8], [0.7, -0.2, 0.65], [-0.3, 0.35, 0.6], [0.4, 0.35, 0.5], [0.95, 0.3, 0.4]];
  for (const [k, [dx, dz, h]] of jarSpots.entries()) await put(YARD_ASSETS.jar[k % YARD_ASSETS.jar.length], jx + dx, jz + dz, h, Math.round(rnd() * 360), '장독');
  // 나무 — 마당 오른쪽 안 한 그루, 담 너머 소나무 두 그루
  const TREES = [[W + 2.4, D + 6.0, 7.5, 40, true], [x0 + 1.4, zWall - 1.5, 6.5, 200, true], [x0 + 1.5, zWall + 3.5, 9, 0, false], [x1 - 2.5, zWall + 4.5, 10.5, 120, false], [x0 - 3.5, D + 2.5, 11, 70, false], [x1 + 3.2, D + 4.0, 10, 250, false], [gateX + 6.5, zWall + 7.0, 12, 300, false]];
  for (const [x, z, h, rot, inside] of TREES) await put(YARD_ASSETS.pine, x, z, h, rot, inside ? '마당 소나무' : '담 너머 소나무');
  await put(YARD_ASSETS.bench, W + 0.6, D + 4.6, 0.45, 90, '평상');
  // 담 밑 꽃·풀 — 뭉치게
  for (let k = 0; k < 16; k++) { const x = x0 + 0.6 + rnd() * (x1 - x0 - 1.2); if (Math.abs(x - gateX) < 1.9) continue; await put(YARD_ASSETS.flower[k % YARD_ASSETS.flower.length], x, zWall - 0.7 - rnd() * 0.5, 0.35 + rnd() * 0.35, Math.round(rnd() * 360), '담 밑 꽃'); }
  const yard = { ground: [x0 - 4, D - 0.3, x1 + 4, zWall + 14], wallZ: zWall, gateX, step: { x: W / 2, z: D + 0.35, w: 1.3, d: 0.45 }, platform: { x: jx, z: jz, w: 2.6, d: 1.4, h: 0.28 }, bench: { x: W + 0.6, z: D + 4.6, w: 2.3, d: 2.3 }, trees: TREES.map(([x, z, , , inside]) => ({ x, z, in: inside })), sky: 'night' };
  return { placements: out, yard, notes };
}


/** 사람 모범답안 대조(10/22 미르) — 기준 = 방 유형 사전 + 미르 눈 검수로 정한 규칙(평가에만 씀, 에이전트 입력 아님은 규칙 자체가 아니라 「이 공간의 사람 배치」).
 *  에이전트 원안 = 06 LLM 이 낸 그대로(raw-s06.txt), 최종 = 코드 규칙을 적용하고 08 로 만든 결과. 둘 다 같은 잣대로 잰다. */
export async function indoorCompare(root, trial, { readJsonOut, trialDirOf }) {
  const T = JSON.parse(await fs.readFile(path.join(root, ROOMS_DIR, 'room_types.json'), 'utf8'));
  const dir = trialDirOf(root, trial.id);
  const plan = await readJsonOut(root, trial, 'indoor_plan.json').catch(() => null);
  if (!plan) return null;
  let raw = null;
  try { const txt = await fs.readFile(path.join(dir, 'raw-s06.txt'), 'utf8'); raw = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); } catch { raw = null; }
  const build = await readJsonOut(root, trial, 'indoor_build.json').catch(() => null);
  const puzzle = await readJsonOut(root, trial, 'puzzle.json').catch(() => null);
  const views = {}, places = {};
  for (const r of build?.rooms || []) {
    try { views[r.id] = JSON.parse(await fs.readFile(path.join(dir, 'rooms', `room_${r.id}_furnished_view.json`), 'utf8')); } catch { /* 없음 */ }
    try { places[r.id] = JSON.parse(await fs.readFile(path.join(dir, 'rooms', `place_${r.id}.json`), 'utf8')).placements; } catch { /* 없음 */ }
  }
  const life = c => ['furniture', 'life_trace'].includes(c.role);
  const has = (cs, m) => cs.some(c => [m.name_ko, ...(m.q || [])].some(w => String(c.name_ko || '').includes(w)));
  const nm = r => (r.name && !/대문/.test(r.name) ? r.name : r.role); // 08 이 「대문간」 이름을 방 유형으로 바꾸므로 같게
  const needIds = new Set((puzzle?.puzzles || []).filter(p => p.presentation !== 'ending_cinematic').flatMap(p => (p.host_needs || []).map(h => h.need_id)));
  const P = { raw: raw && { rooms: raw.rooms || [], contents: raw.contents || [] }, final: { rooms: plan.rooms || [], contents: plan.contents || [] } };
  const rules = [
    { id: 'role', title: '방마다 쓰임이 분명한 방 유형(대문간처럼 애매한 방 없음)', src: '10/21 · 방 유형 사전', ev: p => { const bad = p.rooms.filter(r => !T.types[r.role] || r.role === '대문간'); return { ok: !bad.length, detail: bad.length ? `애매한 방 ${bad.map(nm).join(', ')}` : `${p.rooms.length}개 모두 사전 유형` }; } },
    { id: 'must', title: '방 유형마다 꼭 있을 살림', src: '10/21 · 방 유형 사전', ev: p => { const miss = []; for (const r of p.rooms) { const t = T.types[r.role]; if (!t) continue; const cs = p.contents.filter(c => c.room === r.id); for (const m of t.must) { if (m.place === 'on_pot' && !r.buttumak) continue; if (!has(cs, m)) miss.push(`${nm(r)}:${m.name_ko}`); } } return { ok: !miss.length, detail: miss.length ? `빠짐 ${miss.length} — ${miss.slice(0, 8).join(', ')}` : '모두 있음' }; } },
    { id: 'forbid', title: '방에 두지 않을 살림 없음', src: '10/21 · 방 유형 사전', ev: p => { const bad = []; for (const r of p.rooms) { const t = T.types[r.role]; if (!t) continue; for (const c of p.contents.filter(c => c.room === r.id && life(c))) { const w = t.forbid.find(f => String(c.name_ko || '').includes(f)); if (w) bad.push(`${nm(r)}:${c.name_ko}`); } } return { ok: !bad.length, detail: bad.length ? bad.slice(0, 8).join(', ') : '없음' }; } },
    { id: 'center', title: '대청 가운데는 비우고 벽 가구만', src: '10/21 미르', ev: p => { const r = p.rooms.find(r => r.role === '대청' || r.kind === 'maru'); if (!r) return { na: true }; const t = T.types['대청']; const ok = t.must.filter(m => m.place === 'wall').flatMap(m => [m.name_ko, ...m.q]); const bad = p.contents.filter(c => c.room === r.id && life(c) && !['edge', 'edge_step'].includes(c.place) && !(c.place === 'wall' && ok.some(w => String(c.name_ko || '').includes(w)))); return { ok: !bad.length, detail: bad.length ? `벽 가구 밖 살림 ${bad.length} — ${bad.map(c => c.name_ko).join(', ')}` : '벽 가구만' }; } },
    { id: 'daecheong', title: '대청은 마루 — 앞이 마당으로 트이고 뒷벽은 창이 아니라 문', src: '10/21~22 미르', ev: (p, which) => { const r = p.rooms.find(r => r.role === '대청' || r.kind === 'maru'); if (!r) return { na: true }; if (which === 'raw') { const w = (r.windows || []).length; const open = r.kind === 'maru' && !r.front_door; const back = r.back === 'doors' || (!w && open); return { ok: open && back, detail: `종류 ${r.kind || '(안 적음)'} · 앞문 ${r.front_door ? '있음' : '없음'} · 뒷벽 ${r.back || (w ? `창 ${w}` : '—')}${(r.sees || []).length ? ` · 보여야 할 것 ${r.sees.join('·')}` : ''}` }; } const v = views[r.id]; if (!v) return { na: true }; const doors = (v.openings || []).filter(o => o.wall === 'back' && o.type === 'door').length; return { ok: v.spec?.front_wall === false && doors >= 1, detail: `앞 트임 ${v.spec?.front_wall === false ? '예' : '아니오'} · 뒷문 ${doors}짝` }; } },
    { id: 'order', title: '공간 순서가 집 구조를 따름(부엌은 마루·안방 옆, 창고는 부엌 다음)', src: '10/22 미르', ev: (p, which) => { const L = (which === 'raw' ? raw?.links : plan.links) || []; const role = id => p.rooms.find(r => r.id === id)?.role; const nb = id => L.filter(l => l.a === id || l.b === id).map(l => role(l.a === id ? l.b : l.a)); const bad = []; const hasK = p.rooms.some(r => r.role === '부엌'); for (const r of p.rooms) { if (['헛간', '곳간'].includes(r.role) && hasK && nb(r.id).some(x => x !== '부엌' && !['헛간', '곳간'].includes(x))) bad.push(`${nm(r)}가 ${nb(r.id).join('·')}에 붙음`); if (r.role === '부엌' && !nb(r.id).some(x => ['대청', '안방'].includes(x))) bad.push(`부엌이 ${nb(r.id).join('·') || '—'}에만 붙음`); } if (!hasK && !p.rooms.some(r => ['헛간', '곳간'].includes(r.role))) return { na: true }; return { ok: !bad.length, detail: bad.length ? bad.join(', ') : p.rooms.map(nm).join(' – ') }; } },
    { id: 'garment', title: '옷은 횃대에 건다(물건 위에 세워 두지 않음)', src: '10/21 미르', ev: p => { const g = p.contents.filter(c => isGarment(T, c.name_ko)); if (!g.length) return { na: true }; const bad = g.filter(c => c.place !== 'hang'); return { ok: !bad.length, detail: bad.length ? bad.map(c => `${c.name_ko}(${c.place})`).join(', ') : `${g.length}벌 모두 횃대` }; } },
    { id: 'round', title: '둥근 그릇 위에 물건을 올리지 않음', src: '10/21 미르', ev: p => { const bad = p.contents.filter(c => c.place === 'on_item' && ROUND.test(String(p.contents.find(x => x.item_id === c.on_item)?.name_ko || ''))); return { ok: !bad.length, detail: bad.length ? bad.map(c => c.name_ko).join(', ') : '없음' }; } },
    { id: 'store', title: '창고(헛간·곳간)는 오래 쌓아 둔 물건으로 빽빽(최소 개수)', src: '10/21 미르', ev: p => { const rs = p.rooms.filter(r => ['헛간', '곳간'].includes(r.role)); if (!rs.length) return { na: true }; const bad = []; const all = []; for (const r of rs) { const n = p.contents.filter(c => c.room === r.id && life(c) && c.place !== 'marker').length; const need = T.types[r.role]?.min_items || 0; all.push(`${nm(r)} ${n}/${need}`); if (n < need) bad.push(nm(r)); } return { ok: !bad.length, detail: all.join(', ') }; } },
    { id: 'hosts', title: '05 퍼즐 호스트를 모두 받음', src: '05 퍼즐', ev: (p, which) => { if (!needIds.size) return { na: true }; if (which === 'final' && build) return { ok: !build.hosts.missing.length, detail: `${build.hosts.placed}/${build.hosts.total}${build.hosts.missing.length ? ` — 못 놓음 ${build.hosts.missing.join(', ')}` : ''}` }; const got = [...needIds].filter(id => p.contents.some(c => (c.serves || []).includes(id))); return { ok: got.length === needIds.size, detail: `계획에 ${got.length}/${needIds.size}` }; } },
    { id: 'lean', title: '긴 연장(빗자루·괭이 등)은 혼자 서지 않고 벽에 기댐', src: '10/21 미르', code: true, ev: (p, which) => { if (which === 'raw') return { na: true, detail: '배치는 코드 담당' }; const tall = Object.values(places).flat().filter(q => LEAN.test(q.name || '') && (q.dims || [0, 0, 0])[1] >= 2.2 * Math.max((q.dims || [0, 0, 0])[0], (q.dims || [0, 0, 0])[2])); if (!tall.length) return { na: true }; const bad = tall.filter(q => !q.tilt); return { ok: !bad.length, detail: tall.map(q => `${q.name}${q.tilt ? ` ${Math.abs(q.tilt.deg)}°` : ' 곧게'}`).join(', ') }; } },
    { id: 'markers', title: '「~자리·지점」 표식은 플레이 화면에 그리지 않음(검수 화면에만)', src: '10/21 미르', code: true, ev: (p, which) => { if (which === 'raw') return { na: true, detail: '그리기는 뷰어 담당' }; const tr = Object.values(views).flatMap(v => v.traces || []); const n = tr.filter(t => t.kind === 'spot' || t.kind === 'sound').length; return { ok: true, detail: `자리·소리 표식 ${n}개 — 검수 화면에만` }; } },
  ];
  const out = rules.map(r => ({ id: r.id, title: r.title, src: r.src, code: !!r.code, raw: P.raw ? r.ev(P.raw, 'raw') : { na: true, detail: '06 원문 없음' }, final: r.ev(P.final, 'final') }));
  const score = k => { const xs = out.map(r => r[k]).filter(x => !x.na); return { pass: xs.filter(x => x.ok).length, total: xs.length }; };
  return { rules: out, summary: { raw: score('raw'), final: score('final') }, fixes: plan.check?.fixes || [], notes: build?.notes || [], basis: '방 유형 사전(tools/rooms/room_types.json) + 미르 눈 검수 규칙(claude/에이전트시험_실내1차_동문다리_1021.md)' };
}

function run(cmd, args, { cwd, timeoutMs = 170000, env } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...(env || {}) } });
    let out = '', err = '';
    const name = path.basename(args[0] && !String(args[0]).startsWith('-') ? args[0] : cmd);
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${name} 시간 초과`)); }, timeoutMs);
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(Object.assign(new Error(`${name} 실패(${code}): ${(err || out).slice(-1500)}`), { stdout: out })); });
  });
}

/** 08 방 만들기 — 서버 밖(CLI)에서도 부른다: node tools/rooms/build-trial.mjs <trialId> */
export async function buildIndoor(root, trial, { readJsonOut, writeOut, fail, trialDirOf }, { raw = false } = {}) {
  // raw(10/22 미르) = 「원안」 비교판: 06 LLM 출력 그대로(방 유형 사전·검수 규칙 적용 전)를 같은 생성기·화풍으로 지어 rooms_raw/ 에. 사람 검수 반영본(rooms/)과 나란히 본다
  let plan = await readJsonOut(root, trial, 'indoor_plan.json');
  if (raw) {
    let txt = ''; try { txt = await fs.readFile(path.join(trialDirOf(root, trial.id), 'raw-s06.txt'), 'utf8'); } catch { fail(409, 'raw_missing', '06 원답(raw-s06.txt)이 없습니다.'); }
    plan = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    for (const r of plan.rooms || []) if (r && !ROLES.includes(r.role)) { r.role = '헛간'; r.floor = 'earth'; }
    const ids = new Set((plan.rooms || []).map(r => r.id)); plan.contents = (plan.contents || []).filter(c => c && c.item_id && ids.has(c.room)).slice(0, 80);
  }
  const sel = await readJsonOut(root, trial, 'indoor_selection.json');
  if (!plan || !sel) fail(409, 'previous_step_missing', '06 계획·07 선정 결과가 없습니다.');
  const puzzleDoc = await readJsonOut(root, trial, 'puzzle.json').catch(() => null);
  const conv = planToSet(plan, new Set(sel.selections.filter(x => x.pick).map(x => x.item_id)), { raw });
  const dir = path.join(trialDirOf(root, trial.id), raw ? 'rooms_raw' : 'rooms');
  // 지우지 않고 덮어쓴다(같은 이름 파일만 바뀜) — 지우기 권한이 없는 환경에서도 돌게
  await fs.mkdir(dir, { recursive: true });
  const tools = path.join(root, ROOMS_DIR);
  // 맥 Homebrew 파이썬은 pip 전역 설치를 막는다(PEP 668, 10/23) → 전용 가상환경 ~/.venvs/kgeseo-rooms 가 있으면 그것을 쓴다
  const venvPy = path.join(process.env.HOME || '', '.venvs', 'kgeseo-rooms', 'bin', 'python');
  const py = process.env.ROOMS_PYTHON || (await fs.access(venvPy).then(() => venvPy, () => 'python3'));
  try { await run(py, ['-c', 'import numpy, trimesh, PIL'], { timeoutMs: 30000 }); }
  catch { fail(503, 'python_missing', '방 생성기에 numpy·trimesh·pillow 가 필요합니다. 맥 터미널에서 한 번만: python3 -m venv ~/.venvs/kgeseo-rooms && ~/.venvs/kgeseo-rooms/bin/pip install numpy trimesh pillow'); }
  await fs.writeFile(path.join(dir, 'set.json'), JSON.stringify(conv.set, null, 1));
  const log1 = await run(py, [path.join(tools, 'rooms_set.py'), path.join(dir, 'set.json'), dir], { cwd: tools });
  const setInfo = JSON.parse(await fs.readFile(path.join(dir, 'rooms_set.json'), 'utf8'));
  const { placementAsset, glbSize } = await import('../review/manifestPlace.mjs');
  const { realHeight } = await import('../review/realSize.mjs');
  const byItem = new Map(sel.selections.map(s => [s.item_id, { ...s, pick: sanePick(s.name_ko, s.pick) }]));
  const notes = [...conv.notes];
  const plansOut = {};
  const markersBy = {}; // 방별 흔적·자리 표식(물건 3D 없이 그린다)
  const fixturesBy = {}; // 방별 붙박이 호스트(방 노드에 연결)
  // 10/27 미르: 출구 문 장치(패 자물쇠 등)의 호스트는 물건이 아니라 문이다 — 뷰어가 문에 자물쇠를 그린다. 07 이 「자물쇠」를 살림으로 넣으면 라이브러리에 없어 방 가운데 바닥 표식(쓸모없는 불빛)이 됐다
  const exitHosts = new Set((puzzleDoc?.puzzles || []).filter(p => p.solve?.device?.on === 'exit_door' && p.solve.at).map(p => p.solve.at));
  for (const r of conv.rooms) {
    const rj = JSON.parse(await fs.readFile(path.join(dir, `room_${r.id}.json`), 'utf8'));
    const shelf = (rj.surfaces || []).find(s => s.kind === 'shelf')?.name || null;
    const pots = (rj.surfaces || []).filter(s => s.kind === 'pot_seat').map(s => s.name);
    const items = []; const hangs = []; const edges = [];
    const mine = plan.contents.filter(c => conv.byPlan.get(c.room)?.id === r.id);
    for (const c of mine) {
      if ((c.serves || []).length && c.serves.every(n => exitHosts.has(n))) { notes.push(`${r.name} 「${c.name_ko}」: 출구 문 장치 자리 — 물건으로 놓지 않고 문에 그림`); continue; }
      // 붙박이 호스트는 자리(마루 끝·횃대 …)와 상관없이 방 구조에 잇는다(10/22) — 흔적·표식은 제외
      if (c.place !== 'marker' && c.role !== 'marker' && (c.fixture || (fixtureOf(c.name_ko) && !byItem.get(c.item_id)?.pick))) { (fixturesBy[r.id] ||= []).push(c); continue; }
      if (c.place === 'hang') { if (!r.spec.rails?.[0] && (c.serves || []).length) { edges.push(c); notes.push(`${r.name} 「${c.name_ko}」: 횃대가 없어 마루 끝 바닥에 둠(퍼즐 호스트라 빼지 않음)`); continue; } hangs.push(c); continue; } // 10/23: 횃대 없는 방의 초롱(퍼즐 호스트)이 통째로 빠져 단서를 못 얻음
      if (c.place === 'edge') { edges.push(c); continue; }
      if (c.place === 'edge_step') {
        (markersBy[r.id] ||= []).push(c);
        // 디딤돌 자리에 놓인 물건(짚신 등)은 흔적만 그리지 않고 실제로 놓는다(10/22) — 마루 끝으로
        if (!STONE.test(c.name_ko || '') && !TRACE_NAME.test(c.name_ko || '') && byItem.get(c.item_id)?.pick) edges.push(c);
        continue;
      }
      if (c.place === 'marker' || c.role === 'marker') { (markersBy[r.id] ||= []).push(c); continue; }
      const s = byItem.get(c.item_id);
      if (!s?.pick) { if ((c.serves || []).length) { (markersBy[r.id] ||= []).push({ ...c, pending: true }); notes.push(`${r.name} ${c.item_id} 「${c.name_ko}」: 라이브러리에 없음 — 퍼즐 호스트라 임시 자리 표식으로(에셋 생성 대기)`); } else notes.push(`${r.name} ${c.item_id} 「${c.name_ko}」: 라이브러리에 없음 — 못 놓음`); continue; }
      let a;
      try { a = await placementAsset(root, { id: s.pick.id, nameKo: s.pick.nameKo, url: s.pick.url, source: s.pick.source === 'khs' ? 'khs' : 'public' }); }
      catch (e) { notes.push(`${r.name} ${c.item_id}: 파일을 못 읽음(${e.message})`); continue; }
      const real = await realHeight(root, { file: a.file, naturalHeightM: a.naturalHeightM, boundsM: s.pick.boundsM });
      const ext = await glbSize(path.join(root, a.path)); // 압축 GLB 는 python(trimesh)이 못 읽어 크기를 여기서 넘긴다
      if (!ext) { notes.push(`${r.name} ${c.item_id}: GLB 크기를 못 읽음 — 못 놓음`); continue; }
      let cls = { wall: 'wall', corner: 'corner', floor: 'floor', wall_low: 'wall_low' }[c.place] || null;
      if (c.place === 'on_shelf') cls = shelf ? `on:${shelf}` : 'wall';
      if (c.place === 'on_pot') cls = pots.length ? `on:${pots.shift()}` : 'floor';
      if (c.place === 'on_item') {
        // 10/26 미르: 「도둑 든 것 같다」 — 받침(서안)에 에셋이 없어 서책·장부가 방바닥 한가운데 흩어졌다 → 실제로 놓이는 다른 평평한 가구 위로
        let sup = mine.find(x => x.item_id === c.on_item);
        if (!sup || !byItem.get(sup.item_id)?.pick) { const alt = mine.find(x => x !== c && byItem.get(x.item_id)?.pick && /서안|문갑|반닫이|궤$|궤짝|소반|탁자|사방탁자|함$|뒤주/.test(x.name_ko || '') && !ROUND.test(x.name_ko || '')); if (alt) { notes.push(`${r.name} 「${c.name_ko}」: 받침 「${sup?.name_ko || c.on_item}」이(가) 없어 「${alt.name_ko}」 위로`); c.on_item = alt.item_id; sup = alt; } }
        if (sup && ROUND.test(sup.name_ko || '')) { cls = 'floor'; notes.push(`${r.name} 「${c.name_ko}」: 「${sup.name_ko}」 은 윗면이 둥글어 올리지 않고 바닥에 둠`); }
        else cls = sup ? `on:${c.on_item}` : 'floor';
      }
      if (!cls) cls = 'floor';
      // 창고: 바닥 한가운데에 흩지 않고 벽·구석에 붙여 쌓는다
      if (['헛간', '곳간'].includes(r.role) && cls === 'floor') cls = items.filter(x => x.cls === 'corner').length < 4 ? 'corner' : 'wall';
      // 이름 겹침 막기(뷰어가 노드 이름으로 물건을 묶음)
      let name = String(c.name_ko || s.pick.nameKo).replace(/__/g, '_').slice(0, 30);
      while (items.some(x => x.name === name)) name += '·';
      // 10/26: 납작한 자리(멍석 mat.glb 두께 0.8cm)를 「키 1m」로 맞추면 125배(가로 240m)가 돼 어디에도 못 놓였다 — 납작한 것은 긴 변으로 맞춘다
      const longE = Math.max(ext[0], ext[2]); let size = ['h', real.heightM];
      if (ext[1] < 0.06 * longE && real.heightM / ext[1] * longE > 3) size = ['L', longE <= 3 && longE >= 0.3 ? longE : 1.8];
      items.push({ id: c.item_id, name, file: path.join(root, a.path), ext, cls, size, role: c.role, serves: c.serves || [] });
    }
    // 솥 자리마다 솥 하나(아궁이가 둘이면 솥도 둘) — 모자라면 고른 솥을 하나 더
    const potItems = items.filter(it => it.cls.startsWith('on:솥자리'));
    for (const seat of pots) { const src = potItems[0]; if (!src) break; const extra = { ...src, id: `${src.id}-${seat}`, name: `${src.name}·`, cls: `on:${seat}` }; items.push(extra); notes.push(`${r.name}: ${seat} 에도 솥을 얹음(아궁이마다 솥)`); }
    // 올려놓기 받침이 이 방에 없으면 바닥으로
    for (const it of items) if (it.cls.startsWith('on:') && !it.cls.startsWith('on:시렁') && !it.cls.startsWith('on:솥자리') && !items.some(x => x.id === it.cls.slice(3))) it.cls = 'floor';
    plansOut[r.id] = items;
    await fs.writeFile(path.join(dir, `plan_${r.id}.json`), JSON.stringify({ room_role: r.role, items }, null, 1));
    await run(py, [path.join(tools, 'place_room.py'), path.join(dir, `room_${r.id}.json`), path.join(dir, `plan_${r.id}.json`), path.join(dir, `place_${r.id}.json`)], { cwd: tools });
    // 퍼즐 호스트인데 자리가 없어 못 놓은 물건 → 임시 자리 표식(퍼즐이 끊기지 않게, 10/22)
    {
      const placedNow = new Set(JSON.parse(await fs.readFile(path.join(dir, `place_${r.id}.json`), 'utf8')).placements.map(q => q.id));
      for (const it of items) { const c = mine.find(x => x.item_id === it.id); if (c && (c.serves || []).length && !placedNow.has(it.id) && !(markersBy[r.id] || []).some(x => x.item_id === c.item_id)) { (markersBy[r.id] ||= []).push({ ...c, pending: true }); notes.push(`${r.name} 「${c.name_ko}」: 놓을 자리가 없음 — 퍼즐 호스트라 임시 자리 표식으로`); } }
    }
    // 긴 연장은 혼자 곧게 서지 못한다 — 벽에 비스듬히 기대게(밑동을 벽에서 띄우고 위를 벽 쪽으로 15~19°)
    if (!raw) {
      const placeF = path.join(dir, `place_${r.id}.json`); const pj = JSON.parse(await fs.readFile(placeF, 'utf8')); let n = 0;
      const W = r.spec.kan_m * r.spec.kan_x, D = r.spec.depth_m;
      for (const q of pj.placements) {
        const d = q.dims || [0, 0, 0]; if (!LEAN.test(q.name || '') || d[1] < 2.2 * Math.max(d[0], d[2])) continue;
        const wall = q.wall || (q.z < 0.6 ? 'back' : q.x < 0.6 ? 'left' : q.x > W - 0.6 ? 'right' : null); if (!wall) continue;
        const deg = 15 + ((q.name.length * 7) % 5), s = Math.sin(deg * Math.PI / 180) * d[1] * 0.92;
        if (wall === 'back') { q.z = +(q.z + s).toFixed(3); q.tilt = { axis: [1, 0, 0], deg: -deg }; }
        else if (wall === 'left') { q.x = +(q.x + s).toFixed(3); q.tilt = { axis: [0, 0, 1], deg }; }
        else if (wall === 'right') { q.x = +(q.x - s).toFixed(3); q.tilt = { axis: [0, 0, 1], deg: -deg }; }
        else continue;
        n++; notes.push(`${r.name} 「${q.name}」: 혼자 서지 못하는 긴 연장 — ${wall} 벽에 ${deg}° 기댐`);
      }
      if (n) await fs.writeFile(placeF, JSON.stringify(pj, null, 1));
    }
    // 마루 끝 — 가운데를 비우는 방에서 바닥 물건은 앞(마당 쪽) 가장자리에 나란히
    if (edges.length) {
      const placeF = path.join(dir, `place_${r.id}.json`); const pj = JSON.parse(await fs.readFile(placeF, 'utf8'));
      const W = r.spec.kan_m * r.spec.kan_x, D = r.spec.depth_m, FY = r.spec.floor_lift;
      let ex = W / 2 + 0.9;
      for (const c of edges) {
        const s = byItem.get(c.item_id);
        if (!s?.pick) { if ((c.serves || []).length && !(markersBy[r.id] || []).some(x => x.item_id === c.item_id)) { (markersBy[r.id] ||= []).push({ ...c, pending: true }); notes.push(`${r.name} 「${c.name_ko}」: 라이브러리에 없음 — 퍼즐 호스트라 임시 자리 표식으로(에셋 생성 대기)`); } else notes.push(`${r.name} ${c.item_id} 「${c.name_ko}」: 라이브러리에 없음 — 못 놓음(마루 끝 자리)`); continue; }
        const a = await placementAsset(root, { id: s.pick.id, nameKo: s.pick.nameKo, url: s.pick.url, source: s.pick.source === 'khs' ? 'khs' : 'public' }).catch(() => null);
        const ext = a && await glbSize(path.join(root, a.path)); if (!ext) { notes.push(`${r.name} 「${c.name_ko}」: GLB 를 못 읽어 못 놓음`); continue; }
        const real = await realHeight(root, { file: a.file, naturalHeightM: a.naturalHeightM, boundsM: s.pick.boundsM });
        const sc = real.heightM / ext[1], w = ext[0] * sc, d = ext[2] * sc;
        const x = Math.min(W - 0.3 - w / 2, ex + w / 2), z = D - 0.3 - d / 2; ex = x + w / 2 + 0.25;
        let name = String(c.name_ko).slice(0, 30); while (pj.placements.some(q => q.name === name)) name += '·';
        pj.placements.push({ id: c.item_id, name, file: path.join(root, a.path), scale: +sc.toFixed(4), x: +x.toFixed(3), y: +FY.toFixed(3), z: +z.toFixed(3), rot: 0, cls: 'edge', on: 'floor', h: +real.heightM.toFixed(3), dims: [+w.toFixed(3), +real.heightM.toFixed(3), +d.toFixed(3)] });
        pj.log.push({ id: c.item_id, name, result: '놓음', where: '마루 끝', pos: [+x.toFixed(2), +FY.toFixed(2), +z.toFixed(2)] });
        items.push({ id: c.item_id, name, cls: 'edge' });
      }
      await fs.writeFile(placeF, JSON.stringify(pj, null, 1));
    }
    // 옷 — 방 횃대에 건다(배치 규칙 밖, 횃대 위치에서 계산)
    if (hangs.length) {
      const placeF = path.join(dir, `place_${r.id}.json`); const pj = JSON.parse(await fs.readFile(placeF, 'utf8'));
      const rail = r.spec.rails?.[0];
      const W = r.spec.kan_m * r.spec.kan_x, FY = r.spec.floor_lift;
      for (const [k, c] of hangs.entries()) {
        const s = byItem.get(c.item_id);
        if (!rail || !s?.pick) { notes.push(`${r.name} 「${c.name_ko}」: ${rail ? '라이브러리에 없음' : '횃대가 없음'} — 못 걺`); continue; }
        const a = await placementAsset(root, { id: s.pick.id, nameKo: s.pick.nameKo, url: s.pick.url, source: s.pick.source === 'khs' ? 'khs' : 'public' }).catch(() => null);
        const ext = a && await glbSize(path.join(root, a.path)); if (!ext) { notes.push(`${r.name} 「${c.name_ko}」: GLB 를 못 읽어 못 걺`); continue; }
        const span = rail.to - rail.from, slot = span / hangs.length;
        const wide = Math.max(ext[0], ext[2]);
        const sc = Math.min((rail.y - 0.15) / ext[1], (slot - 0.05) / wide);
        const h = ext[1] * sc, d = Math.min(ext[0], ext[2]) * sc, u = rail.from + slot * (k + 0.5);
        const turn = ext[2] > ext[0] ? 90 : 0; // 넓은 면을 벽과 나란히
        const at = { left: [0.17 + d / 2, u, 90], right: [W - 0.17 - d / 2, u, -90], back: [u, 0.17 + d / 2, 0] }[rail.wall] || [u, 0.17 + d / 2, 0];
        let name = String(c.name_ko).slice(0, 30); while (pj.placements.some(q => q.name === name)) name += '·';
        pj.placements.push({ id: c.item_id, name, file: path.join(root, a.path), scale: +sc.toFixed(4), x: +at[0].toFixed(3), y: +(FY + rail.y - h + 0.03).toFixed(3), z: +at[1].toFixed(3), rot: at[2] + turn, cls: 'hang', on: 'rail', h: +h.toFixed(3), dims: [+(ext[0] * sc).toFixed(3), +h.toFixed(3), +(ext[2] * sc).toFixed(3)] });
        pj.log.push({ id: c.item_id, name, result: '놓음', where: '횃대', pos: [+at[0].toFixed(2), +(FY + rail.y - h).toFixed(2), +at[1].toFixed(2)] });
        items.push({ id: c.item_id, name, cls: 'hang' });
      }
      await fs.writeFile(placeF, JSON.stringify(pj, null, 1));
    }
  }
  await run(py, [path.join(tools, 'build_view.py'), dir], { cwd: tools });
  const places_ = {};
  for (const r of conv.rooms) places_[r.id] = JSON.parse(await fs.readFile(path.join(dir, `place_${r.id}.json`), 'utf8')).placements;
  const viewItems = [];
  for (const r of conv.rooms) {
    const glb = `room_${r.id}_furnished.glb`;
    let placeForCompose = path.join(dir, `place_${r.id}.json`), yard = null;
    if (r.spec.front_wall === false) {
      const W = r.spec.kan_m * r.spec.kan_x, D = r.spec.depth_m;
      const y = await yardLayout(root, W, D, trial.id + r.id); yard = y.yard; notes.push(...y.notes.map(n => `${r.name} ${n}`));
      const pj = JSON.parse(await fs.readFile(placeForCompose, 'utf8'));
      placeForCompose = path.join(dir, `place_${r.id}_with_yard.json`);
      await fs.writeFile(placeForCompose, JSON.stringify({ ...pj, placements: [...pj.placements, ...y.placements] }, null, 1));
      notes.push(`${r.name}: 앞이 마당으로 트인 마루 — 마당 풍광 ${y.placements.length}점(담·대문·장독·나무·꽃), 걸어 나갈 수 없음`);
      // 06 이 적은 「마루에서 보여야 할 것」 — 마당이 갖춘 것과 맞춰 본다(10/22). 마당에 없는 것은 메모로 남긴다
      const HAVE = { 대문: /대문|문간/, 담: /담|울타리|돌담/, 디딤돌: /디딤돌|댓돌|섬돌|돌길/, 달: /달|하늘|별|밤/, 장독: /장독|항아리|독/, 나무: /나무|소나무|숲/, 풀: /풀|꽃|덤불/, 평상: /평상/ };
      const pr = conv.byPlan ? [...conv.byPlan.entries()].find(([, v]) => v.id === r.id)?.[0] : null;
      const sees = (plan.rooms || []).find(x => x.id === pr)?.sees || [];
      const miss = sees.filter(t => !Object.values(HAVE).some(re => re.test(t)));
      notes.push(`${r.name}: 마루에서 보여야 할 것 ${sees.length}개 — ${sees.length ? (miss.length ? `마당에 없음: ${miss.join(', ')}` : '모두 마당에 있음') : '06 에 없음'}`);
    }
    await run(process.execPath, [process.env.ROOMS_COMPOSE || path.join(tools, 'compose.mjs'), path.join(dir, `room_${r.id}.glb`), placeForCompose, path.join(dir, glb)], { cwd: root, timeoutMs: 175000 });
    const meta = JSON.parse(await fs.readFile(path.join(dir, `room_${r.id}_furnished_view.json`), 'utf8'));
    meta.placements = places_[r.id] || [];
    { const showOf = new Map((puzzleDoc?.puzzles || []).flatMap(p => (p.clues || []).filter(c => c.shows && c.from).map(c => [c.from, c.shows]))); for (const m of markersBy[r.id] || []) { const sh = (m.serves || []).map(id => showOf.get(id)).find(Boolean); if (sh) m.show = sh; } }
    const tr = traceLayout(meta, markersBy[r.id] || [], conv.rooms, r);
    delete meta.placements;
    if (yard) meta.yard = yard;
    meta.traces = tr.traces;
    meta.hangs = (places_[r.id] || []).filter(q => q.cls === 'hang').map(q => ({ name: q.name, x: q.x, z: q.z, dims: q.dims })); // 뷰어가 걸친 천으로 바꿈(10/22)
    for (const t of tr.traces) { meta.nodes[t.name] = { role: 'prop', cls: 'trace', kind: t.kind }; meta.log = [...(meta.log || []), { id: t.id, name: t.name, result: '놓음', where: `흔적(${TRACE_KO[t.kind]})` }]; }
    notes.push(...tr.notes.map(n => `${r.name} ${n}`));
    await fs.writeFile(path.join(dir, `room_${r.id}_furnished_view.json`), JSON.stringify(meta, null, 1));
    const mb = +((await fs.stat(path.join(dir, glb))).size / 1e6).toFixed(2);
    viewItems.push({ name: r.name, meta, mb, url: glb });
  }
  const tpl = await fs.readFile(path.join(tools, 'viewer_template.html'), 'utf8');
  const BK = {};
  for (const n of ['bush2', 'bush3', 'weed1', 'weed2', 'pebble1', 'pebble2', 'pebble4', 'gravelPatch1']) { try { const m = JSON.parse(await fs.readFile(path.join(root, 'naju01/src/models/baked', `${n}.json`), 'utf8')); BK[n] = { size: m.size, positions: m.positions, indices: m.indices }; } catch { notes.push(`마당: 나주맵 모형 ${n} 을 못 읽음`); } }
  // ── 퍼즐 연결(10/22) — 05 퍼즐 호스트(need_id) ↔ 08 에 실제로 놓인 물건·흔적. 뷰어가 조사 → 단서 → 풀이를 돌리고, 코드가 풀 수 있는지 미리 돌려 본다 ──
  const roomIdx = new Map(conv.rooms.map((r, i) => [r.id, i]));
  const binds = {};
  for (const c of (plan.contents || []).filter(c => (c.serves || []).length)) {
    const r = conv.byPlan.get(c.room); if (!r) continue; const i = roomIdx.get(r.id);
    const q = (places_[r.id] || []).find(q => q.id === c.item_id);
    const t = (viewItems[i]?.meta?.traces || []).find(t => t.id === c.item_id);
    const fx = !q && !t && (fixturesBy[r.id] || []).includes(c) ? Object.keys(viewItems[i]?.meta?.nodes || {}).find(fixtureOf(c.name_ko)?.[1] || (() => false)) : null;
    if (fx) { for (const n of c.serves) (binds[n] ||= []).push({ room: i, roomName: r.name, node: fx, item_id: c.item_id, name: c.name_ko, kind: 'fixture' }); continue; }
    for (const n of c.serves) (binds[n] ||= []).push({ room: i, roomName: r.name, node: q ? q.name : t ? t.name : null, item_id: c.item_id, name: c.name_ko, kind: q ? 'object' : t ? `trace:${t.kind}` : 'missing' });
  }
  // 검수용 정보(10/22 미르: 퍼즐은 사람이 눈으로 검수 — 이야기 근거 · 연결된 에셋 · 상호작용 순서 · 장면 잠금)
  const a01 = await readJsonOut(root, trial, 'AI-01.json').catch(() => null), a04 = await readJsonOut(root, trial, 'AI-04.json').catch(() => null);
  // 10/26 미르: 화면에는 풀어 쓴 말만 — 「(원문 「한방」)」 같은 원문 괄호는 검수 문서(01)에만 남긴다
  const plain = t => String(t || '').replace(/\s*\(원문 「[^」]*」[^)]*\)/g, '');
  const factText = id => plain([...(a01?.facts || []), ...(a01?.open || []), ...(a01?.gf || [])].find(f => f.id === id)?.text);
  const rdText = id => plain((a04?.scenes || []).flatMap(sc => sc.required_discoveries || []).find(d => d.id === id)?.text);
  const pickOf = id => byItem.get(id)?.pick || null;
  const SCENES = (a04?.scenes || []).map(sc => ({ id: sc.scene_id, title: sc.title, order: sc.order, rooms: conv.rooms.map((r, i) => ((r.scenes || []).includes(sc.scene_id) ? i : -1)).filter(i => i >= 0), exit: sc.exit?.trigger || '', complete_when: sc.exit?.complete_when || '' }));
  // 10/26: 손에 드는 단서 물건(짚신 한 짝·놋대접·버선·끈…)을 공용 라이브러리의 실제 작은 물건으로 — 노란 고리 같은 대용 모형만 보여 「무엇이 나왔는지」 화면에서 알 수 없었다(09 시각 검수)
  const carrierAsset = new Map();
  try {
    const { buildLibrary, searchLibrary } = await import('./library.mjs');
    const { glbSize, placementAsset } = await import('./manifestPlace.mjs');
    const { items } = await buildLibrary(root);
    for (const p of puzzleDoc?.puzzles || []) for (const c of p.clues || []) {
      const k = c.carrier?.kind, nm = String(c.carrier?.name || '').trim();
      if (!nm || !['piece', 'key'].includes(k) || carrierAsset.has(nm)) continue;
      const words = nm.replace(/[()·,]/g, ' ').split(/\s+/).filter(w => w.length >= 2 && !/^(한|두|세|반쯤|끊어진|젖은|낡은|작은|헌|새|짝|조각|가닥|묶음|꾸러미)$/.test(w));
      if (!words.length) continue;
      let pick = null;
      for (const q of [nm, ...words]) {
        const found = await searchLibrary(items, q, { placeableOnly: true, root, waitSemanticMs: 15000, limit: 12 });
        for (const r of found.results) {
          const it = r.item; if (!/^\/?_sf_local\//.test(decodeURIComponent(it.url || '')) || it.source === 'space') continue;
          { const head = words[words.length - 1]; const nk = String(it.nameKo || ''); if (!(nk.includes(head) || (head.length >= 3 && nk.includes(head.slice(-2))))) continue; } // 머리 명사가 같은 물건만(「새김 놋대접」에 「나무 새김판」이 오던 일)
          try { const a = await placementAsset(root, { id: it.id, nameKo: it.nameKo, url: it.url, source: it.source === 'khs' ? 'khs' : 'public' }); const ext = await glbSize(path.join(root, a.path)); const L = ext ? Math.max(ext[0], ext[1], ext[2]) : null; if (L && L > 1.2) continue; pick = { url: a.url, nameKo: it.nameKo, size: L && L >= 0.05 ? +Math.min(0.3, L).toFixed(3) : 0.22 }; break; } catch { continue; }
        }
        if (pick) break;
      }
      carrierAsset.set(nm, pick);
    }
  } catch (e) { notes.push(`단서 물건 에셋 찾기 실패: ${e.message}`); }
  const PZ = (puzzleDoc?.puzzles || []).filter(p => p.presentation !== 'ending_cinematic').map(p => ({
    id: p.puzzle_id, scene_id: p.scene_id, title: p.title, type: p.puzzle_type, learns: p.learns || '',
    review: { belief_before: p.belief_before || '', how: p.how || '', difficulty: p.difficulty || '', invented: p.invented || [],
      basis: (p.basis || []).map(id => ({ id, text: factText(id) })), discoveries: (p.discoveries || []).map(id => ({ id, text: rdText(id) })) },
    clues: (p.clues || []).map(c => ({ id: c.clue_id, text: c.text, get_by: c.get_by, from: c.from, reveal: c.reveal || null, carrier: c.carrier ? { ...c.carrier, asset: carrierAsset.get(String(c.carrier.name || '').trim()) || null } : null, content: c.content || '' })),
    exit: p.exit || null, // 10/22: 장면 마지막 퍼즐 — 풀면 나오는 열쇠와 다음 방 문의 자물쇠
    solve: p.solve || {}, hint_1: p.hint_1 || '', hint_2: p.hint_2 || '', effects: p.success_effects || [],
    hosts: (p.host_needs || []).map(h => ({ need_id: h.need_id, kind: h.kind, what: h.what, at: (binds[h.need_id] || []).filter(b => b.node).map(b => ({ room: b.room, node: b.node })),
      assets: (binds[h.need_id] || []).map(b => ({ room: b.room, roomName: b.roomName, node: b.node, name: b.name, kind: b.kind, pending: (markersBy[conv.rooms[b.room]?.id] || []).some(x => x.item_id === b.item_id && x.pending), asset: pickOf(b.item_id) ? { nameKo: pickOf(b.item_id).nameKo, thumbnail: pickOf(b.item_id).thumbnail || null } : null })) })),
  }));
  const bound = need => (binds[need] || []).some(b => b.node);
  // 10/26 미르: 「화면에 빛 무늬가 없는데 왜 풀린다고 봤나」 — 단서 글이 아니라 화면에 그려진 것으로 얻을 수 있는지를 잰다
  const traceOf = (ri, name) => (viewItems[ri]?.meta?.traces || []).find(t => t.name === name || t.id === name) || null;
  const showBad = new Map();
  for (const p of puzzleDoc?.puzzles || []) for (const c of p.clues || []) {
    if (!c.from || SOLVE_GET.has(c.get_by)) continue;
    const bs = (binds[c.from] || []).filter(b => b.node); if (!bs.length) continue;
    const b = bs[0], isMark = c.carrier?.kind === 'mark' || c.reveal?.action === 'look';
    if (isMark && c.shows?.kind) {
      const want = c.shows.kind, got = String(b.kind || '');
      if (want === 'object') { if (!/^(object|fixture)$/.test(got)) showBad.set(c.clue_id, `「${b.name}」은(는) ${got} — 놓인 물건이어야 함`); }
      else if (got !== `trace:${want}`) showBad.set(c.clue_id, `「${b.name}」이(가) ${got.replace('trace:', '') || '없음'}(으)로 그려짐 — ${want} 이어야 함`);
      else if (want === 'foot' && c.shows.count) { const t = traceOf(b.room, b.node); const n = t?.steps?.length || 0; if (n !== c.shows.count) showBad.set(c.clue_id, `발자국 ${n}개 그려짐 — 단서는 ${c.shows.count}개`); }
    }
  }

  // 풀이 자리: 단서 짝짓기는 수첩에서, 출구 장치는 다음 방 문에서 — 공간에 따로 놓을 자리가 없어도 된다(10/22)
  const solveOk = p => p.solve.interaction === 'combine_clues' || p.solve.device?.on === 'exit_door' || bound(p.solve.at);
  // 장면 순서대로(10/22): 첫 장면부터, 앞 장면의 퍼즐을 다 풀어야 다음 장면이 열린다(NPC 계약 v0.3 enter_when 기본). 열린 장면의 호스트만 조사할 수 있다
  const sceneIds = [...new Set(PZ.map(p => p.scene_id))].sort((x, y) => (parseInt(String(x).replace(/\D/g, ''), 10) || 0) - (parseInt(String(y).replace(/\D/g, ''), 10) || 0));
  const got = new Set(), done = new Set(); let moved = true, open = 1;
  const sceneDone = k => PZ.filter(p => p.scene_id === sceneIds[k]).every(p => done.has(p.id));
  while (moved) {
    moved = false;
    while (open < sceneIds.length && sceneDone(open - 1)) { open++; moved = true; }
    const live = new Set(sceneIds.slice(0, open));
    for (const p of PZ) {
      if (!live.has(p.scene_id)) continue;
      for (const c of p.clues) if (!SOLVE_GET.has(c.get_by) && bound(c.from) && !showBad.has(c.id) && !got.has(c.id)) { got.add(c.id); moved = true; } // 조사·이동·관찰로 얻는 단서(10/22: navigate 단서를 못 얻던 일)
      if (done.has(p.id)) continue;
      if (solveOk(p) && (p.solve.required_clue_ids || []).every(id => got.has(id) || p.effects.some(e => e.type === 'clue_acquired' && e.target_id === id))) { done.add(p.id); for (const e of p.effects) if (e.type === 'clue_acquired') got.add(e.target_id); moved = true; }
    }
  }
  const stuckScene = sceneIds[open - 1] && !sceneDone(open - 1) ? sceneIds[open - 1] : null;
  const puzzleChecks = PZ.map(p => {
    const hb = p.hosts.filter(h => h.at.length).length;
    const missClues = (p.solve.required_clue_ids || []).filter(id => !got.has(id) && !p.effects.some(e => e.type === 'clue_acquired' && e.target_id === id));
    return { id: p.id, title: p.title, scene_id: p.scene_id, interaction: p.solve.interaction, hostsBound: hb, hostsTotal: p.hosts.length, solveAtBound: solveOk(p), solvable: done.has(p.id),
      why: done.has(p.id) ? '' : !sceneIds.slice(0, open).includes(p.scene_id) ? `장면 ${p.scene_id} 가 열리지 않음(앞 장면 ${stuckScene} 에서 막힘)` : !solveOk(p) ? `풀이 자리(${p.solve.at})가 공간에 없음` : `얻을 수 없는 단서 ${missClues.join(', ')}` };
  });
  // ── 자동 회귀 검사(10/22 미르: 다음에 다시 돌려도 같은 일이 생기면 안 됨) — 사람이 짚었던 문제를 매번 코드로 잰다 ──
  const T0 = await roomTypes(root);
  const allPl = conv.rooms.flatMap((r, i) => (places_[r.id] || []).map(q => ({ ...q, room: r, ri: i })));
  const regress = [
    { id: 'RG-GARMENT', what: '옷이 서 있지 않음(횃대에 걸림)', bad: allPl.filter(q => q.cls !== 'yard' && isGarment(T0, q.name) && q.cls !== 'hang').map(q => `${q.room.name}:${q.name}`) },
    { id: 'RG-TRACE', what: '흔적 이름의 항목에 가구가 놓이지 않음', bad: allPl.filter(q => q.cls !== 'yard' && TRACE_NAME.test(String(q.name || '').replace(/·+$/, ''))).map(q => `${q.room.name}:${q.name}`) },
    { id: 'RG-MARU', what: '마루 가운데 비움(벽·마루 끝·디딤돌 외 물건 없음)', bad: allPl.filter(q => q.room.spec.front_wall === false && !['wall', 'edge', 'hang', 'yard'].includes(q.cls) && !String(q.cls || '').startsWith('on:')).map(q => `${q.room.name}:${q.name}(${q.cls})`) },
    { id: 'RG-ORDER', what: '창고는 부엌 다음(마루·방에 바로 붙지 않음)', bad: (() => { const L = conv.set.links || []; const role = n => conv.rooms.find(r => r.name === n)?.role; const hasK = conv.rooms.some(r => r.role === '부엌'); return hasK ? L.filter(l => [l.a, l.b].some(n => ['헛간', '곳간'].includes(role(n))) && [l.a, l.b].some(n => !['헛간', '곳간', '부엌'].includes(role(n)))).map(l => `${l.a}–${l.b}`) : []; })() },
    { id: 'RG-HOST', what: '05 퍼즐 호스트가 모두 공간에 연결됨', bad: PZ.flatMap(p => p.hosts.filter(h => !h.at.length).map(h => `${p.id}:${h.need_id}`)) },
    { id: 'RG-PENDING', what: '퍼즐 호스트가 임시 표식이 아니라 실제 물건(없으면 에셋 생성 요청)', warn: true, bad: Object.values(markersBy).flat().filter(c => c.pending).map(c => c.name_ko) },
    { id: 'RG-NAME', what: '단서 글의 물건 이름 = 그 단서를 주는 물건', warn: true, bad: PZ.flatMap(p => p.clues.filter(c => c.reveal && c.reveal.action !== 'look').flatMap(c => { const h = p.hosts.find(h => h.need_id === c.from); const node = String(h?.at?.[0]?.node || '').replace(/·+$/, ''); if (!node) return []; const named = [...new Set([...String(c.text || '').matchAll(FURN_IN_TEXT)].map(m => m[1]))]; return named.length && !named.some(n => node.includes(n)) ? [`${c.id}: 글 「${named.join('·')}」 ↔ 물건 「${node}」`] : []; })) },
    { id: 'RG-SHOW', what: '단서가 말하는 것이 화면에 그려짐(빛·발자국 개수·물건) — 안 그려지면 그 단서는 얻을 수 없음', bad: [...showBad].map(([id, why]) => `${id}: ${why}`) },
    { id: 'RG-REVEAL', what: '손에 드는 단서는 실제 물건 밑·안·뒤에서 드러남(표식 자리면 카드로만 뜸)', warn: true, bad: PZ.flatMap(p => p.clues.filter(c => c.carrier && c.carrier.kind && c.carrier.kind !== 'mark' && c.reveal && c.reveal.action !== 'look').flatMap(c => { const h = p.hosts.find(h => h.need_id === c.from); const a = (h?.assets || [])[0]; return a && (a.kind !== 'object' || a.pending) ? [`${c.id}: 「${a.name}」(${a.pending ? '임시 표식' : a.kind})`] : []; })) },
    { id: 'RG-DIALECT', what: '화면 글에 원문 방언이 그대로 없음(01 이 풀어 쓴 뜻으로)', bad: (() => { const toks = [...new Set([...(a01?.facts || []), ...(a01?.open || [])].flatMap(f => [...String(f.text || '').matchAll(/원문 「([^」]{2,8})」/g)].map(m => m[1].trim())))].filter(t => t.length >= 2); const txt = JSON.stringify({ PZ, SCENES }); return toks.filter(t => txt.includes(t)).map(t => `「${t}」`); })() },
    { id: 'RG-LOGIC', what: '05 가 고치지 못한 풀이 문제 없음(답이 단서에 보이고, 짐작·소거 없이 풀림)', bad: puzzleDoc?.check?.unresolved || [] }, // 10/27 미르: 「여인」을 찍어야 맞히는 퍼즐이 검사를 통과한 것처럼 지나갔다
    { id: 'RG-PUZZLE', what: '장면 순서대로 모든 퍼즐을 풀 수 있음', bad: puzzleChecks.filter(c => !c.solvable).map(c => `${c.id}: ${c.why}`) },
  ].map(x => ({ ...x, ok: !x.bad.length }));
  const vdata = { SC: SCENES, PZ, BK, ITEMS: viewItems, TRIAL: { id: trial.id, title: trial.title } };
  const html = (await import('../rooms/renderViewer.mjs')).renderViewer(tpl, vdata);
  await fs.writeFile(path.join(dir, 'viewer_data.json'), JSON.stringify(vdata));
  await fs.writeFile(path.join(dir, 'index.html'), html);
  // 자기 검사 — 사람 답안 없이
  const places = {};
  for (const r of conv.rooms) places[r.id] = JSON.parse(await fs.readFile(path.join(dir, `place_${r.id}.json`), 'utf8'));
  const placedIds = new Set([...Object.values(places).flatMap(p => p.placements.map(q => q.id)), ...Object.values(markersBy).flat().map(c => c.item_id)]);
  const needIds = new Set((puzzleDoc?.puzzles || []).filter(p => p.presentation !== 'ending_cinematic').flatMap(p => (p.host_needs || []).map(h => h.need_id)));
  const hostOk = [...needIds].filter(id => plan.contents.some(c => (c.serves || []).includes(id) && (placedIds.has(c.item_id) || c.place === 'marker')));
  const build = {
    at: new Date().toISOString(), setName: conv.set.name, notes,
    checks: setInfo.checks,
    rooms: conv.rooms.map(r => ({ id: r.id, name: r.name, role: r.role, scenes: r.scenes, why: r.why, traces: (markersBy[r.id] || []).length, kanX: r.spec.kan_x, floor: r.spec.floor, coverPct: places[r.id].floor_cover_pct, placed: places[r.id].placements.length, planned: plansOut[r.id].length, failed: places[r.id].log.filter(l => !String(l.result).startsWith('놓음')).map(l => ({ name: l.name, result: l.result, why: l.why })), mb: viewItems.find(v => v.name === r.name)?.mb })),
    hosts: { total: needIds.size, placed: hostOk.length, missing: [...needIds].filter(id => !hostOk.includes(id)) },
    lightStory: plan.light_story || '',
    puzzle: { binds, list: PZ, scenes: SCENES, checks: puzzleChecks, solvable: puzzleChecks.filter(c => c.solvable).length, total: puzzleChecks.length },
    regress,
    viewer: `/__review/trials/${trial.id}/${raw ? 'rooms_raw' : 'rooms'}/index.html`, raw,
    log: String(log1).slice(-2000),
  };
  await writeOut(root, trial, raw ? 'indoor_build_raw.json' : 'indoor_build.json', JSON.stringify(build, null, 2));
  return { rooms: build.rooms.length, checksOk: `${build.checks.filter(c => c.ok).length}/${build.checks.length}`, placed: build.rooms.reduce((a, r) => a + r.placed, 0), hosts: `${build.hosts.placed}/${build.hosts.total}` };
}

export function indoorKit({ readJsonOut, writeOut, extractJson, llm, fail, clip, trialDirOf }) {
  return async function runIndoor(root, trial, step, docs) {
    const need = (...nos) => { for (const n of nos) if (!docs[n]?.json) fail(409, 'previous_step_missing', `앞 단계 ${n} 결과(JSON)가 없습니다.`); };
    const facts = docs['01']?.json;
    const scenes = docs['04']?.json?.scenes || [];
    const puzzleDoc = await readJsonOut(root, trial, 'puzzle.json').catch(() => null);
    const adapt = trial.adaptation?.text ? ['[각색 조건 — 제작팀이 정한 게임 각색 방침. 원전 사실이 아니다. 반드시 따른다]', trial.adaptation.text, ''] : [];
    const factLines = () => [...(facts?.facts || []).map(f => `- ${f.id} [${f.category}] ${f.text}`), ...(facts?.open || []).map(f => `- ${f.id} [해석 유보] ${f.text || f.question || ''}`), ...(facts?.ng || []).map(f => `- ${f.id} [금지 왜곡] ${f.text || ''}`)].join('\n');
    const sceneLines = () => scenes.map(s => [
      `## ${s.scene_id} · ${s.title || ''} — ${s.purpose || ''}`, `- 분위기: ${s.mood?.base || ''}`,
      ...(s.required_discoveries || []).map(r => `- ${r.id}: ${r.text}`),
      ...(s.space_reqs || []).map(r => `- ${r.space_req_id}: ${r.must_read_as} (장소 ${(r.setting || []).join('/')})`),
      ...(s.asset_reqs || []).map(r => `- ${r.req_id} (${r.category}): ${r.role_hint || ''} · ${(r.tags_any || []).join('/')} · ${r.lore_reason || ''}`),
    ].join('\n')).join('\n\n');
    const hostLines = () => (puzzleDoc?.puzzles || []).filter(p => p.presentation !== 'ending_cinematic').map(p => [`## ${p.puzzle_id} (${p.scene_id}, ${p.puzzle_type}) ${p.title || ''}`, ...(p.host_needs || []).map(h => `- ${h.need_id} [${h.kind}] ${h.what} · 예: ${(h.object_examples || []).join('/')} · 장소: ${h.place_hint || ''}`)].join('\n')).join('\n\n');

    if (step.id === 's06') {
      need('01', '04');
      const T = await roomTypes(root);
      const user = [...adapt, '[방 유형 사전 — 조선 후기 민가 일반 상식]', typeText(T), '', '[01 설화 사실]', factLines(), '', '[04 Scene 구성표]', sceneLines(), '', '[05 퍼즐 초안 — 공간에 있어야 할 호스트]', hostLines() || '(퍼즐 초안 없음)'].join('\n');
      const text = await llm(root, trial, step, { system: INDOOR_SYSTEM, user });
      await writeOut(root, trial, 'raw-s06.txt', text);
      const plan = extractJson(text);
      if (plan.__error) fail(422, 'json_invalid', `JSON 을 읽지 못했습니다: ${plan.__error}. 원답은 raw-s06.txt`);
      // 없는 방 유형(대문간 등)은 가장 가까운 쓰임으로 — 코드가 바꾸고 기록
      const typeFix = [];
      for (const r of plan.rooms || []) if (r && !ROLES.includes(r.role)) { typeFix.push(`${r.name || r.role}: 방 유형 「${r.role}」 은 쓰지 않음 → 헛간`); r.role = '헛간'; r.floor = 'earth'; }
      const roomIds = new Set((plan.rooms || []).map(r => r.id));
      plan.contents = (plan.contents || []).filter(c => c && c.item_id && roomIds.has(c.room)).slice(0, 80);
      // 흔적 이름인데 물건 자리로 적힌 것 → 표식(10/22 미르: 「마루 젖은 발자국」에 평상이 놓임)
      for (const c of plan.contents) if (TRACE_NAME.test(String(c.name_ko || '').trim()) && c.place !== 'marker' && c.place !== 'edge_step') { typeFix.push(`「${c.name_ko}」: 흔적이라 물건 대신 표식으로`); c.place = 'marker'; }
      const enforced = enforceTypes(plan, T);
      plan.contents = enforced.contents;
      // 붙박이 이름(기둥·문·창·시렁·부뚜막·아궁이·벽장·횃대)은 에셋을 찾지 않고 방 노드에 잇는다
      for (const c of plan.contents) if (c.place !== 'marker' && fixtureOf(c.name_ko)) { c.fixture = true; typeFix.push(`「${c.name_ko}」: 붙박이 — 에셋 대신 방 구조에 연결`); }
      // 05 호스트를 계획이 빠뜨리면 채운다(10/22) — 서는 곳·소리는 표식, 물건 호스트는 05 의 예시 물건으로
      {
        const sceneRoom = sid => (plan.rooms || []).find(r => (r.scenes || []).includes(sid)) || (plan.rooms || [])[0];
        const servedNow = new Set(plan.contents.flatMap(c => c.serves || []));
        let k = 0;
        for (const p of (puzzleDoc?.puzzles || []).filter(p => p.presentation !== 'ending_cinematic')) for (const h of p.host_needs || []) {
          if (servedNow.has(h.need_id)) continue;
          const r = sceneRoom(p.scene_id); if (!r) continue;
          const spot = ['standing_spot', 'sound_source'].includes(h.kind);
          const nm = spot ? `${(h.what || '').slice(0, 10) || '조사'} 자리` : ((h.object_examples || [])[0] || (h.what || '').slice(0, 10) || '조사 대상');
          const flat = plan.contents.find(x => x.room === r.id && ['wall', 'floor'].includes(x.place) && /궤|반닫이|뒤주|장$|서안|소반|상$|문갑/.test(x.name_ko || ''));
          const small = /쪽지|서찰|기록|편지|종이|책|부적/.test(nm);
          const c = { item_id: `H-${++k}`, room: r.id, name_ko: nm, q: h.object_examples || [], role: 'puzzle_host', place: spot ? 'marker' : (small && flat ? 'on_item' : (h.kind === 'readable_surface' && !small ? 'wall' : 'floor')), on_item: small && flat ? flat.item_id : null, serves: [h.need_id], scenes: [], why: `05 호스트 ${h.need_id} 를 06 이 빠뜨려 코드가 채움`, auto: true };
          if (!spot && fixtureOf(nm)) c.fixture = true;
          plan.contents.push(c); servedNow.add(h.need_id); typeFix.push(`${r.name || r.role}: 05 호스트 ${h.need_id} 빠짐 → 「${nm}」 넣음`);
        }
      }
      // 10/23: 물건 하나 = 조사 하나(BE) — 한 물건이 단서 자리 둘 이상을 맡으면(문창호 하나가 창호·문틈 둘을) 나눈다. 붙박이·표식은 표식으로, 물건은 05 예시 물건으로
      {
        const needOfId = new Map((puzzleDoc?.puzzles || []).flatMap(p => (p.host_needs || []).map(h => [h.need_id, { h, p }])));
        const gives = id => { const x = needOfId.get(id); return x && (x.p.clues || []).some(c => ['inspect', 'navigate'].includes(c.get_by) && c.from === id); };
        const add = [];
        for (const c of plan.contents) {
          const cl = (c.serves || []).filter(gives); if (cl.length < 2) continue;
          c.serves = (c.serves || []).filter(id => !cl.slice(1).includes(id));
          cl.slice(1).forEach((id, i) => { const { h } = needOfId.get(id); const ex = (h.object_examples || [])[0] || (h.what || '').slice(0, 10) || '조사';
            const asMark = c.fixture || c.place === 'marker' || ['standing_spot', 'sound_source'].includes(h.kind) || fixtureOf(ex);
            add.push({ ...c, item_id: `${c.item_id}-${i + 2}`, name_ko: asMark ? (TRACE_NAME.test(ex) ? ex : `${ex} 자리`) : ex, q: h.object_examples || [], serves: [id], place: asMark ? 'marker' : (c.place === 'marker' ? 'floor' : c.place), fixture: false, why: `${c.item_id} 이 맡던 단서 자리를 나눔(물건 하나 = 조사 하나)` });
            typeFix.push(`「${c.name_ko}」: 단서 자리 ${cl.join('·')} 를 혼자 맡음 → ${id} 는 「${add[add.length - 1].name_ko}」로 나눔`); });
        }
        plan.contents.push(...add);
      }
      // 10/26 미르: 단서 글은 「서안 서랍」인데 놓인 물건 이름은 「문갑」 — 단서 글이 가리키는 가구 이름 하나로 호스트 이름을 맞춘다
      {
        const needOfId = new Map((puzzleDoc?.puzzles || []).flatMap(p => (p.host_needs || []).map(h => [h.need_id, p])));
        for (const c of plan.contents.filter(c => c.role === 'puzzle_host' && !c.fixture && c.place !== 'marker' && (c.serves || []).length)) {
          const txt = (c.serves || []).flatMap(id => (needOfId.get(id)?.clues || []).filter(k => k.from === id).map(k => `${k.text || ''} ${k.reveal?.reaction || ''}`)).join(' ');
          const named = [...new Set([...txt.matchAll(FURN_IN_TEXT)].map(m => m[1]))];
          if (named.length === 1 && !String(c.name_ko || '').includes(named[0])) { typeFix.push(`「${c.name_ko}」 → 「${named[0]}」: 단서 글이 가리키는 물건 이름으로 맞춤`); c.q = [...new Set([named[0], ...(c.q || [])])]; c.name_ko = named[0]; }
        }
      }
      const conv = planToSet(plan); // 방 사양을 만들 수 없는 계획이면 여기서 바로 알린다
      const contents = plan.contents;
      const needIds = new Set((puzzleDoc?.puzzles || []).filter(p => p.presentation !== 'ending_cinematic').flatMap(p => (p.host_needs || []).map(h => h.need_id)));
      const served = new Set(contents.flatMap(c => c.serves || []));
      const check = { rooms: conv.rooms.length, contents: contents.length, hostsMissing: [...needIds].filter(id => !served.has(id)), fixes: [...typeFix, ...enforced.fixes, ...conv.notes] };
      await writeOut(root, trial, 'indoor_plan.json', JSON.stringify({ ...plan, contents, check }, null, 2));
      return { rooms: check.rooms, contents: check.contents, hostsMissing: check.hostsMissing.length, fixes: check.fixes.length };
    }

    if (step.id === 's07') {
      const plan = await readJsonOut(root, trial, 'indoor_plan.json');
      if (!plan) fail(409, 'previous_step_missing', '06 실내 공간 구성 결과가 없습니다.');
      const { buildLibrary, searchLibrary } = await import('./library.mjs');
      const { items } = await buildLibrary(root);
      const targets = plan.contents.filter(c => c.place !== 'marker' && c.role !== 'marker' && !c.fixture && !(c.place === 'edge_step' && (STONE.test(c.name_ko || '') || TRACE_NAME.test(c.name_ko || ''))));
      const cands = {}; const stripDropped = [];
      let block = {}; try { block = JSON.parse(await fs.readFile(path.join(trialDirOf(root, trial.id), 'asset_block.json'), 'utf8')); } catch { block = {}; }
      // 퍼즐이 그 물건을 열거나 비우면(05 reveal) 상태 변형판이 있는 에셋을 고른다(10/23 미르: 서랍이 열리는 판을 만들어 놓고 쓰지 않았다)
      const puzzleDoc7 = await readJsonOut(root, trial, 'puzzle.json').catch(() => null);
      const VESSEL = /솥|항아리|독$|동이|단지|대야|자배기|병$|사발|그릇/;
      const needOf = t => { const acts = (puzzleDoc7?.puzzles || []).flatMap(p => (p.clues || []).filter(c => (t.serves || []).includes(c.from)).map(c => c.reveal?.action)); if (VESSEL.test(t.name_ko || '')) return acts.includes('empty') ? 'filled' : null; /* 10/26: 들추기(lift)는 뷰어가 그 자리에서 접는다(foldSoft) — 접힌 판을 요구하면 방석에 1.9m 돗자리(mat.glb)가 골라져 방에 못 놓였다 */ if (acts.includes('break')) return 'broken'; return acts.includes('open') ? 'opened' : acts.includes('empty') ? 'filled' : null; };
      const hasState = (c, need) => need === 'broken' ? Boolean(c?.states?.broken) : need === 'folded' ? Boolean(c?.states?.folded) : need === 'opened' ? Boolean(c?.states?.opened) : need === 'filled' ? Boolean((c?.initialState && String(c.initialState).startsWith('filled')) || c?.states?.emptied) : false; // 10/23: 기본판이 찬 것(돌확) — 빈 판(emptied)이 있으면 찬 판으로 친다
      const STATE_Q = { folded: ['이불', '이부자리', '멍석', '돗자리', '보료'], opened: ['반닫이', '탁자장', '사방탁자', '다기장', '찬장', '뒤주', '의걸이장', '함', '궤'], filled: ['항아리', '독', '물독', '동이', '가마솥', '대야', '말'], broken: ['항아리', '옹기', '동이', '단지', '북', '사발'] };
      const { placementAsset: pa, glbSize: gs } = await import('./manifestPlace.mjs');
      const sizeCache = new Map();
      // 10/22: 의미 검색 색인이 준비될 때까지 한 번 기다린다(라이브러리가 커져 첫 색인이 오래 걸리면 글자 검색만 돌아 같은 이름도 후보가 들쭉날쭉했다)
      const warm = await searchLibrary(items, '반닫이', { placeableOnly: true, root, waitSemanticMs: 170000, limit: 1 });
      const searchStatus = warm.semanticStatus;
      const qCache = new Map();
      const T = await roomTypes(root);
      const dictQ = name => Object.values(T.types).flatMap(t => t.must).filter(m => [m.name_ko, ...(m.q || [])].some(w => String(name || '').includes(w))).flatMap(m => [m.name_ko, ...(m.q || [])]);
      const sizeOf = async c => { if (sizeCache.has(c.id)) return sizeCache.get(c.id); let v = null; try { const a = await pa(root, { id: c.id, nameKo: c.nameKo, url: c.url, source: c.source === 'khs' ? 'khs' : 'public' }); v = await gs(path.join(root, a.path)); } catch { v = null; } sizeCache.set(c.id, v); return v; };
      const tooBig = c => Array.isArray(c?.boundsM) && Math.max(...c.boundsM.map(Number).filter(Number.isFinite)) > 3.2;
      for (const t of targets) {
        const words = String(t.name_ko || '').replace(/[()（）·,]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
        const best = new Map();
        for (const q of [...new Set([t.name_ko, ...(t.q || []), ...words, ...dictQ(t.name_ko)])].filter(Boolean).slice(0, 9)) {
          if (!qCache.has(q)) qCache.set(q, await searchLibrary(items, q, { placeableOnly: true, root, waitSemanticMs: 15000, limit: 20 }));
          const found = qCache.get(q);
          for (const r of found.results.slice(0, 10)) if (r.item.source !== 'space' && /^\/?_sf_local\//.test(decodeURIComponent(r.item.url || ''))) best.set(r.item.id, Math.max(best.get(r.item.id) || 0, r.score));
        }
        const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => items.find(i => i.id === id)).filter(c => c && !tooBig(c) && !(block[t.item_id] || []).includes(c.id) && !(block[`name:${t.name_ko}`] || []).includes(c.id)); // 10/26: 09 시각 검수가 「이 물건에 이 에셋은 안 된다」고 한 것은 빼고 고른다
        const kept = [];
        for (const c of ranked) {
          if (kept.length >= 10) break;
          const sz = await sizeOf(c);
          // 긴 띠 모양(긴 변이 키·짧은 변보다 4배 넘음) = 같은 물건을 한 줄로 붙인 묶음일 가능성 — 낱개 자리에는 쓰지 않는다
          if (sz && Math.max(sz[0], sz[2]) > 0.9 && Math.max(sz[0], sz[2]) > 4 * Math.max(sz[1], Math.min(sz[0], sz[2]))) { stripDropped.push(`${t.name_ko}: ${c.nameKo} (${sz.map(v => v.toFixed(2)).join('×')} m, 줄 묶음으로 보임)`); continue; }
          kept.push(c);
        }
        const need = needOf(t);
        if (need && !kept.some(c => hasState(c, need))) {
          const extra = [];
          for (const c of ranked) if (hasState(c, need) && !kept.includes(c)) extra.push(c);
          for (const q of STATE_Q[need]) { if (extra.length >= 3) break; if (!qCache.has(q)) qCache.set(q, await searchLibrary(items, q, { placeableOnly: true, root, waitSemanticMs: 15000, limit: 20 })); for (const r of qCache.get(q).results) if (hasState(r.item, need) && !extra.includes(r.item) && !tooBig(r.item)) extra.push(r.item); }
          kept.unshift(...extra.slice(0, 3));
        }
        t.__need = need;
        cands[t.item_id] = kept.slice(0, 12);
      }
      const PALACE = /궁|전각|교태전|강녕전|천추전|사정전|근정전|운현궁|종묘|왕실|궁중/;
      const line = c => [c.id, c.nameKo, PALACE.test(`${c.nameKo} ${c.description || ''} ${[].concat(c.tags || []).join(' ')}`) ? '궁궐 재현품' : '', c.categoryKo, c.era || '-', clip(c.description || '', 80) || '-', Array.isArray(c.boundsM) ? c.boundsM.map(v => Number(v).toFixed(2)).join('×') + 'm' : '-', c.needsReplacement ? '임시본' : c.metaQuality === 'auto' ? '설명 추정' : ''].join(' | ');
      const roomName = new Map((plan.rooms || []).map(r => [r.id, `${r.name || r.role}(${r.role})`]));
      const picks = new Map();
      // 12개씩 나눠 부른다 — 로컬 작은 모델이 긴 목록의 앞부분만 답하는 문제(10/19) 대비
      for (let i = 0; i < targets.length; i += 12) {
        const chunk = targets.slice(i, i + 12);
        const user = chunk.map(t => [`### ${t.item_id} 「${t.name_ko}」 — ${roomName.get(t.room) || t.room} · ${t.role} · ${t.why || ''}${t.__need === 'opened' ? ' · 필요: 열려야 함(문·뚜껑·서랍)' : t.__need === 'filled' ? ' · 필요: 물·곡식이 들어 있어야 함' : t.__need === 'folded' ? ' · 필요: 걷혀야 함(이불·자리)' : t.__need === 'broken' ? ' · 필요: 깨져야 함(옹기·북)' : ''}`, ...(cands[t.item_id] || []).map(c => `- ${line(c)}${c.states?.opened ? ' [열리는 판]' : ''}${c.states?.folded ? ' [걷히는 판]' : ''}${c.states?.broken ? ' [깨지는 판]' : ''}${String(c.initialState || '').startsWith('filled') || c.states?.emptied ? ' [찬 판]' : ''}`), (cands[t.item_id] || []).length ? '' : '- (검색된 후보 없음)'].join('\n')).join('\n\n');
        const text = await llm(root, trial, step, { system: SELECT_SYSTEM, user });
        await writeOut(root, trial, `raw-s07-${i / 12 + 1}.txt`, text);
        const json = extractJson(text);
        for (const s of json.selections || []) picks.set(s.item_id, s);
      }
      // 대체 금지(10/22): 평상은 마당 가구 — 실내 살림 대체로 쓰지 않음 · 2 m 넘는 후보는 이름이 같을 때만(서안 → 평상 같은 대체가 놓이지 못해 퍼즐이 끊김)
      const sane = (t, c) => sanePick(t.name_ko, c);
      const selections = targets.map(t => {
        const s = picks.get(t.item_id) || {};
        let c = sane(t, (cands[t.item_id] || []).find(x => x.id === s.pick) || null);
        // 10/23 안전망: 퍼즐 호스트를 비우면 단서를 못 얻는다 — 모델이 「궁궐 재현품이라」며 비우면 같은 이름(병풍 → 병풍 B)인 후보로 채운다(다른 물건으로 바꾸지는 않는다)
        let auto = false;
        if (!c && t.role === 'puzzle_host') { const head = String(t.name_ko || '').trim().split(/\s+/).pop(); const same = (cands[t.item_id] || []).find(x => head && String(x.nameKo || '').includes(head) && sane(t, x)); if (same) { c = same; auto = true; } }
        // (10/23) 코드로 강제로 바꾸지 않는다 — 가마솥 자리에 탁자장이 들어간 일. 표시와 규칙으로 모델이 고르게 하고, 결과는 검사로 본다
        return { item_id: t.item_id, room: t.room, name_ko: t.name_ko, role: t.role, pick: c ? { id: c.id, nameKo: c.nameKo, url: c.url, source: c.source, thumbnail: c.thumbnail || null, boundsM: c.boundsM || null, needsReplacement: Boolean(c.needsReplacement) } : null,
          candidates: (cands[t.item_id] || []).map(x => ({ id: x.id, nameKo: x.nameKo })), reason: auto ? `(자동) 같은 이름 후보로 채움 — 모델 이유: ${clip(s.reason, 200)}` : clip(s.reason, 300), missing: c ? null : (s.missing || { name_ko: t.name_ko, description_ko: '', why: (cands[t.item_id] || []).length ? '후보 중 고르지 않음' : '검색된 후보 없음' }), invalid: s.pick && !c ? s.pick : null };
      });
      await writeOut(root, trial, 'indoor_selection.json', JSON.stringify({ selections, stripDropped, searchStatus }, null, 2));
      return { picked: selections.filter(s => s.pick).length, missing: selections.filter(s => !s.pick).length };
    }

    if (step.id === 's08' || step.id === 'relayout') {
      const res = await buildIndoor(root, trial, { readJsonOut, writeOut, fail, trialDirOf });
      // 원안 비교판도 같이 짓는다 — 실패해도 본 결과는 그대로
      try { res.raw = await buildIndoor(root, trial, { readJsonOut, writeOut, fail, trialDirOf }, { raw: true }); } catch (e) { res.rawError = e.message; }
      return res;
    }
    if (step.id === 's09') {
      // 10/26 미르: 에이전트가 자기 결과를 눈으로 보고 고친다 — 사진 → 판정 → (에셋 바꾸기·살림 빼기) 07·08 다시 → 다시 보기. 최대 2바퀴
      const vr = await import('./visualReview.mjs');
      const dir = trialDirOf(root, trial.id);
      const set = JSON.parse(await fs.readFile(path.join(dir, 'rooms', 'rooms_set.json'), 'utf8'));
      const rel = f => path.relative(dir, f);
      const rounds = [];
      const SNAP = ['puzzle.json', 'indoor_plan.json', 'indoor_selection.json', 'indoor_build.json', 'AI-05.json'];
      const snap = async n => { const d = path.join(dir, 'vr', `r${n}`, 'snapshot'); await fs.mkdir(d, { recursive: true }); for (const f of SNAP) { try { await fs.copyFile(path.join(dir, f), path.join(d, f)); } catch {} } await fs.cp(path.join(dir, 'rooms'), path.join(d, 'rooms'), { recursive: true }).catch(() => {}); };
      const restore = async n => { const d = path.join(dir, 'vr', `r${n}`, 'snapshot'); for (const f of SNAP) { try { await fs.copyFile(path.join(d, f), path.join(dir, f)); } catch {} } await fs.rm(path.join(dir, 'rooms'), { recursive: true, force: true }); await fs.cp(path.join(d, 'rooms'), path.join(dir, 'rooms'), { recursive: true }); };
      const unsolved = async () => { try { const ib = await readJsonOut(root, trial, 'indoor_build.json'); return ((ib.regress || []).find(r => r.id === 'RG-PUZZLE')?.bad || []).length; } catch { return 99; } };
      const MAXR = 3;
      for (let round = 1; round <= MAXR; round++) {
        await snap(round);
        const shot = await vr.shoot(root, trial.id, { outDir: path.join(dir, 'vr', `r${round}`) });
        const res = [];
        for (const room of shot.rooms) {
          const rr = set.rooms[room.room]; if (!rr) continue;
          room.name = rr.name;
          let place = { placements: [] }; try { place = JSON.parse(await fs.readFile(path.join(dir, 'rooms', `place_${rr.id}.json`), 'utf8')); } catch {}
          const names = [...new Set((place.placements || []).map(q => q.name))];
          const text = await vr.judgeRoom({ llm, root, trial, step, room, items: names });
          const j = extractJson(text);
          res.push({ room: room.room, id: rr.id, name: rr.name, clues: (j.clues || []), issues: (j.room || []), shots: room.shots.map(x => ({ tag: x.tag, file: rel(x.file) })), clueShots: room.clues.map(c => ({ clue_id: c.clue_id, node: c.node, before: rel(c.before), after: rel(c.after) })), placements: place.placements || [] });
        }
        const clueBad = res.flatMap(r => r.clues.filter(c => c.judged !== false && c.ok === false).map(c => ({ ...c, room: r.name })));
        const roomBad = res.flatMap(r => r.issues.map(x => ({ ...x, room: r.name })));
        rounds.push({ round, rooms: res.map(({ placements, ...x }) => x), clueBad, roomBad, unsolved: await unsolved(), errors: shot.errors });
        await writeOut(root, trial, 'visual_review.json', JSON.stringify({ checklist: vr.CHECKLIST, rounds }, null, 2));
        if (round === MAXR) break;
        // 고치기 — 에셋 바꾸기(그 물건에 그 에셋 금지) · 퍼즐과 상관없는 살림 빼기
        const plan = await readJsonOut(root, trial, 'indoor_plan.json');
        const sel = await readJsonOut(root, trial, 'indoor_selection.json');
        let block = {}; try { block = JSON.parse(await fs.readFile(path.join(dir, 'asset_block.json'), 'utf8')); } catch {}
        const byName = new Map(); for (const r of res) for (const q of r.placements) byName.set(`${r.name}|${String(q.name).replace(/·+$/, '')}`, { q, r });
        const findItem = (roomName, nm) => { const k = String(nm || '').replace(/·+$/, ''); const hit = byName.get(`${roomName}|${k}`) || [...byName.entries()].find(([kk]) => kk.endsWith(`|${k}`))?.[1]; return hit ? (plan.contents || []).find(c => c.item_id === hit.q.id) : null; };
        const applied = [];
        for (const x of [...roomBad, ...clueBad]) {
          if (!['replace_asset', 'remove'].includes(x.fix) || !x.item) continue;
          if (x.clue_id && !(x.fails || []).some(f => f === 'C2' || f === 'C4')) continue; // 단서 판정에서 에셋을 바꾸는 것은 움직임 없음(C2)·종류 다름(C4)일 때만 — 단서 모형이 안 보이는 것(C3)은 호스트 에셋 탓이 아니다
          const c = findItem(x.room, x.item); if (!c) continue;
          if (x.fix === 'remove' && !(c.serves || []).length) { plan.contents = plan.contents.filter(z => z !== c); applied.push(`${x.room} 「${c.name_ko}」 뺌 — ${x.check || (x.fails || []).join(',')}: ${x.why}`); continue; }
          const pick = (sel.selections || []).find(z => z.item_id === c.item_id)?.pick?.id; if (!pick) continue;
          (block[c.item_id] ||= []).includes(pick) || block[c.item_id].push(pick);
          (block[`name:${c.name_ko}`] ||= []).includes(pick) || block[`name:${c.name_ko}`].push(pick);
          applied.push(`${x.room} 「${c.name_ko}」 에셋 바꿈(${pick} 금지) — ${x.check || (x.fails || []).join(',')}: ${x.why}`);
        }
        // 단서 글이 화면에 그릴 수 없는 것을 말함 → 05 를 그 메모와 함께 다시 쓰고 06~08 을 다시(에이전트가 이야기 쪽도 스스로 고친다)
        let rgShow = []; try { const ib = await readJsonOut(root, trial, 'indoor_build.json'); rgShow = ((ib.regress || []).find(r => r.id === 'RG-SHOW')?.bad || []).map(t => ({ clue_id: String(t).split(':')[0], why: `화면에 그릴 수 없음(코드 검사) — ${String(t).split(':').slice(1).join(':').trim()}`, fix: 'clue' })); } catch {}
        const clueFix = [...clueBad.filter(c => c.fix === 'clue'), ...rgShow.filter(r => !clueBad.some(c => c.clue_id === r.clue_id && c.fix === 'clue'))];
        if (clueFix.length) { await writeOut(root, trial, 'vr_feedback.json', JSON.stringify({ at: new Date().toISOString(), clues: clueFix.map(c => ({ clue_id: c.clue_id, why: c.why })) }, null, 2)); applied.push(`단서 ${clueFix.length}개가 화면에 그릴 수 없는 것을 말함 → 05 를 다시 씀(${clueFix.map(c => c.clue_id).join(', ')})`); }
        rounds[rounds.length - 1].applied = applied;
        await writeOut(root, trial, 'visual_review.json', JSON.stringify({ checklist: vr.CHECKLIST, rounds }, null, 2));
        if (!applied.length) break;
        await writeOut(root, trial, 'indoor_plan.json', JSON.stringify(plan, null, 2));
        await fs.writeFile(path.join(dir, 'asset_block.json'), JSON.stringify(block, null, 2));
        const { runStepInline } = await import('./agentTrial.mjs');
        if (clueFix.length) { for (const id of ['s05', 's06', 's07', 's08']) await runStepInline(root, trial, id); }
        else { for (const id of ['s07', 's08']) await runStepInline(root, trial, id); }
      }
      // 마지막 바퀴가 더 나빠질 수 있다(이야기를 다시 쓰면 새 문제가 생김) — 풀 수 있고 문제가 가장 적은 바퀴의 결과를 남긴다
      const score = r => r.unsolved * 100 + r.clueBad.length + r.roomBad.length;
      const best = rounds.reduce((a, r) => (score(r) < score(a) ? r : a), rounds[0]);
      if (best !== rounds[rounds.length - 1]) { await restore(best.round); }
      const kept = { round: best.round, unsolved: best.unsolved, clueBad: best.clueBad.length, roomBad: best.roomBad.length };
      await writeOut(root, trial, 'visual_review.json', JSON.stringify({ checklist: vr.CHECKLIST, rounds, kept }, null, 2));
      const first = rounds[0], last = rounds[rounds.length - 1];
      return { rounds: rounds.length, firstClueBad: first.clueBad.length, firstRoomBad: first.roomBad.length, firstUnsolved: first.unsolved, lastClueBad: last.clueBad.length, lastRoomBad: last.roomBad.length, kept };
    }
    fail(409, 'indoor_step', `실내 공간 시험은 ${step.id} 단계가 없습니다(06~09 까지).`);
  };
}
