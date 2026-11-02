// agentTrialV2.mjs — 에이전트 시험 공정 2판(10/19). 1판(05 소품 선정 → 06 좌표 찍기)은 배경·장소 시설·인물을 맡은 단계가 없어
// 공간이 텅 비었다(원인 분석: 프로젝트 claude/에이전트공간배치_1차_원인분석_1019.md). 2판 순서 — 미르 결정(10/19):
//   01~04 이야기 문서 → 05 퍼즐 초안(에셋 모름) → 06 공간 구성(장소 맞추기·장소 쓰임에서 나오는 것·인물·배경 층)
//   → 07 에셋 선정(구체 이름으로 검색) → 08 배치(LLM 은 자리 힌트만, 좌표·산포는 scatter.mjs) + 자기 검사.
// 사람 모범답안(나주 공간·사람 문서·장소유형사전)은 어떤 단계의 입력에도 넣지 않는다 — 평가 전용.
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { loadMask, scatterLayer, placeItem, seatSpot, seatRule, understory, REGION_KINDS, CLASSES } from './scatter.mjs';

// 앉힐 자리가 없을 때 넓혀 볼 이웃 영역(물리적으로 이어진 띠)
const REGION_FALLBACK = Object.freeze({ water_edge: ['zone_waterside', 'walk_edge'], water: ['water_edge'], zone_waterside: ['zone_edge', 'zone'], zone_edge: ['zone'], walk_edge: ['hill'], hill: ['walk_edge'], cliff_face: ['hill'] });

export const STEPS_V2 = Object.freeze([
  { id: 's01', no: '01', label: '설화 사실 계약서', tier: 'judgment', maxTokens: 48000, effort: 'low' },
  { id: 's02', no: '02', label: '지역 테마 시놉시스', tier: 'judgment', maxTokens: 40000, effort: 'low' },
  { id: 's03', no: '03', label: '게임 시나리오 기획서', tier: 'judgment', maxTokens: 40000, effort: 'low' },
  { id: 's04', no: '04', label: 'Scene 구성표(JSON)', tier: 'judgment', maxTokens: 48000, effort: 'low' },
  { id: 's05', no: '05', label: '퍼즐 초안', tier: 'judgment', maxTokens: 64000, effort: 'medium', v2: true },
  { id: 's11', no: '05b', label: '장면 연출(이야기 컷·결말 + 그림 후보 → 사람 검수 후 다음 단계)', tier: 'judgment', maxTokens: 24000, effort: 'medium', director: true }, // 10/27: 나주(야외)에도
  { id: 's06', no: '06', label: '공간 구성', tier: 'judgment', maxTokens: 40000, effort: 'medium', v2: true },
  { id: 's07', no: '07', label: '에셋 선정', tier: 'judgment', maxTokens: 32000, effort: 'low', v2: true },
  { id: 's08', no: '08', label: '배치(코드 산포) · 자기 검사', tier: 'judgment', maxTokens: 24000, effort: 'low', v2: true },
  { id: 's09', no: '09', label: '자기 검사 보고 고치기', tier: 'judgment', maxTokens: 24000, effort: 'medium', v2: true },
  { id: 's10', no: '10', label: '사람 의견 반영(영향받는 항목만 다시)', tier: 'judgment', maxTokens: 24000, effort: 'low', v2: true },
]);

// ── 05 퍼즐 초안 ──
// 05 퍼즐 초안 2판(10/20, 미르 결정: 팀 계약에 맞춤) — 공용 인터랙션 카탈로그 v2.0(docs/공용-인터랙션-카탈로그-v2.0.md) ·
//   Puzzle Contract v0.3.1(docs/계약서/03_Puzzle_Contract_v0.3.1.md) · 단조성 규칙(아이템 소모·되돌릴 수 없는 선택·막힘 없음)
// 10/26 미르: 매 판 같은 장치가 반복되면 재미가 없다 — 지난 시험들에서 쓴 장치 횟수를 05 에 알려 덜 쓴 것부터 고르게
const DEVICE_KINDS = ['yundo', 'sangaji', 'geulja', 'munsal', 'maedeup', 'pae', 'buk']; // 10/28 미르: bimil(장석 고르기) 뺌 — 하나씩 눌러 보면 무조건 풀리는 장치
async function deviceHistory(root, trial) {
  const { readdir, readFile } = await import('node:fs/promises'); const path = await import('node:path');
  const dir = path.join(root, '.local/review/trials'); const cnt = Object.fromEntries(DEVICE_KINDS.map(k => [k, 0]));
  try { for (const id of await readdir(dir)) { if (id === trial.id) continue; try { const p = JSON.parse(await readFile(path.join(dir, id, 'puzzle.json'), 'utf8')); for (const z of p.puzzles || []) { const k = z.solve?.device?.kind; if (k in cnt) cnt[k]++; } } catch {} } } catch {}
  const order = Object.entries(cnt).sort((a, b) => a[1] - b[1]);
  return `[지난 시험에서 쓴 장치 — 덜 쓴 것부터 고른다] ${order.map(([k, n]) => `${k} ${n}번`).join(' · ')}`;
}
const PUZZLE_SYSTEM = `너는 지역 설화 기반 방탈출 게임 「왜곡」의 퍼즐 초안(Planner) 에이전트다. 01 설화 사실 계약서와 04 Scene 구성표를 읽고 Scene 마다 퍼즐을 만든다. 아직 공간·에셋은 없다(보지 않는다). 뒤 단계가 네 host_needs 를 보고 공간에 물건을 놓고, 게임이 그 물건을 눌러 조사하게 만든다.
플레이 평가 원칙(10/26 미르 — 아래 모든 규칙보다 먼저 지킨다: 「재미고 뭐고 너무 어렵다. 자연스럽게 추론이 가능해야 하는데 중구난방」)
- 적게, 분명하게: 장면마다 퍼즐 1~2개, 게임 전체 4~6개(결말 연출 제외). 퍼즐마다 찾는 단서(inspect·navigate) 2~3개. 모든 단서는 어느 퍼즐의 required_clue_ids 에 들어간다 — 쓰이지 않는 단서·같은 말을 되풀이하는 단서 금지.
- 추론은 한 걸음: 단서를 본 사람이 「아, 그래서 이거구나」 하고 바로 잇는 정도. 처음 하는 사람이 힌트 없이 1~3분에 푼다.
- 조작법을 일러 주는 쪽지 금지: 「발자국 수를 앞자리에, 신 짝 수를 뒷자리에」「시계 방향으로 두 칸 돌린 곳」처럼 퍼즐 규칙을 적은 글은 이야기 속 사람이 쓸 까닭이 없다.
- 장치의 답 = 화면에 보이는 것 그대로: 문살 무늬판이면 바닥에 비친 창살 빛에서 밝은 칸이 곧 누를 칸(그 빛 단서의 shows.cells 에 그 칸을 적는다), 패 끼우기면 기록에 적힌 차례, 매듭이면 실제로 색이 보이는 물건들의 차례. 외워야 하는 대응표(오방색↔방위 등)를 쓰려면 그 대응표 자체가 방 안에 단서로 있어야 한다.
- 답은 단서로 「확인」한다 — 남는 것을 고르는 소거·짐작으로 정해지는 답 금지(10/27 미르: 그림자가 여인인지 알 단서가 없어 「여인」은 찍어야 맞혔다). 답이 사람·물건이면 그것임을 알아볼 특징이 단서 content 에 그 말 그대로 있고(예: 「쪽진 머리에 치마폭이 넓은 여인의 그림자」), 흔적(mark)이면 화면에도 그 모습으로 그린다(shows.figure). 기록에 없는 사람이 답이면 「기록에 없는 사람」이 아니라 그 사람을 직접 보여 준다.
- 풀면 반드시 무슨 일이 일어난다: 다음 방 문이 열리거나(출구 장치), 다음 퍼즐에 쓰이는 단서를 얻는다(clue_acquired 가 뒤 퍼즐의 required_clue_ids 에 들어감). 풀어도 아무 것도 안 나오는 퍼즐 금지.
이야기 컷·결말은 다음 단계(05b 장면 연출 에이전트)가 쓴다 — 너는 퍼즐만. 단, 마지막 장면의 마지막 퍼즐에는 출구 장치를 두지 않는다(풀면 곧바로 결말로 간다). 회상 장면 맞추기(hoesang)는 쓰지 않는다(10/27 미르: 「맞춰도 아무 일도 일어나지 않는데 왜 있나」) — 회상은 05b 이야기 컷이 공간을 넘어갈 때 보여 준다.
팀 계약(반드시 지킴)
- 플레이어 행동은 5종뿐: inspect(물건·기록·단서 조사) · navigate(구역·조사 지점으로 이동) · input(글자·숫자 입력) · select(선택지·대상 고르기) · combine_clues(얻은 단서 2개를 조사수첩에서 짝짓기). 옛 이름(observe·compare·rotate·align·connect·sequence·collect 등)은 쓰지 않는다.
- 퍼즐 유형(puzzle_type)은 7종뿐: code_input · text_input · single_choice · multiple_choice · observation · navigation · clue_combination.
- 서버 상태가 바뀌는 아이템 인벤토리·아이템 소모·끌어 놓기는 없다. 얻는 것은 단서(clue)뿐이고 조사수첩에 쌓인다(집어 든 서신·쪽지·열쇠도 수첩에 단서로 들어간다). 되돌릴 수 없는 선택·막힘 상태를 만들지 않는다.
- 단, 단서가 「눈에 보이게 나오는」 화면 연출(FE 물리 조작 — 되돌릴 수 있고 서버 상태 없음)은 반드시 적는다: 이불을 들추면 밑에 서신, 반닫이를 열면 안에 쪽지, 짚단을 밀면 뒤에 끈 조각처럼.
발견 연출(10/22 — 방탈출의 기본 흐름: 물건을 만진다 → 물건이 반응한다 → 단서 물건이 보인다 → 집어서 읽는다 → 다음 단서를 짐작한다 → 마지막에 다음 방으로 가는 열쇠를 얻는다)
- inspect·navigate 단서마다 reveal 과 carrier 와 content 를 쓴다.
  · reveal.action: lift(들추기·걷기 — 이불·멍석·덮개) | open(열기 — 반닫이·함·궤·문짝·뚜껑) | empty(비우기 — 물·곡식 든 독·항아리) | slide(밀기·옮기기 — 짚단·항아리·상) | flip(뒤집기 — 바가지·소반·책) | break(깨기·찢기 — 봉한 옹기 항아리·동이·사기 그릇·북 가죽·창호지처럼 깨지거나 찢어질 만한 것. 깬 것은 되돌리지 않는다) | look(가까이 들여다보기 — 바닥 자국·벽·문살처럼 움직이지 않는 것) · reveal.where: under | inside | behind | on · reveal.reaction: 화면에서 일어나는 일 한 문장(예: 「이불이 접혀 올라가고 요 위에 접힌 서신이 드러난다」).
  · carrier: 손에 드는 단서 물건 {kind: letter(서신) | note(쪽지·명부 한 장) | key(열쇠) | piece(물건 조각 — 끈·천 조각·짚신 한 짝 등) | mark(집을 수 없는 자국·빛·소리 — 이때 reveal.action 은 look), name: 화면에 뜨는 이름(예: 「접힌 서신」)}.
  · content: 플레이어가 집어서 읽거나 들여다볼 때 보이는 것 그대로 — 서신·쪽지는 그 안에 적힌 글 원문(그 시대 말투, 1~4줄), 조각·자국은 눈에 보이는 모습 묘사. 결론을 말하지 않는다(「…이므로 신랑이다」 금지). 추론은 플레이어가 풀이에서 한다.
  · text(수첩 요약)는 「무엇을 어디서 찾았다」 한 줄 — 역시 결론이 아니라 사실.
  · 물건(호스트) 하나 = 조사 결과 하나(BE 계약 v1): inspect·navigate 단서는 호스트마다 최대 1개(host_needs.gives 도 1개 이하). 같은 물건에서 둘을 얻게 하지 말고, 둘째 단서는 다른 물건·자리에 둔다(예: 이부자리 밑 서신 + 요 눌린 자국 ✗ → 서신은 이부자리, 눌린 자국은 「베개 자리」 같은 다른 흔적). 답을 넣는 자리(answer_device)는 단서를 주지 않는다.
  · 물건에 맞는 반응만(10/23 미르: 바닥 불빛이 움직이며 쪽지가 나옴 · 문갑이 통째로 들려 위에 쪽지 → 부자연스럽다):
    - 빛·그림자·자국·소리·자리(standing_spot · sound_source · landmark, 또는 흔적 이름)는 움직이지 않는다 → action look, carrier 는 mark 만(빛에서 쪽지가 나오지 않는다).
    - 옷(두루마기·도포·저고리 등)은 단서를 주는 물건(호스트)으로 쓰지 않는다 — 걸린 옷 에셋이 없다(10/26 미르). 옷에 얽힌 단서는 옷을 넣어 둔 함·반닫이, 옷에서 떨어진 고름·끈 조각(piece)으로.
    - lift(들추기)는 이불·요·멍석·가마니·덮개·보자기·방석처럼 부드럽고 납작한 것만. 장·궤·문갑·반닫이 같은 가구는 들지 않는다.
    - open(열기)은 문·뚜껑·서랍이 있는 것(장·궤·뒤주·반닫이·함·솥). empty(비우기)는 물·곡식이 든 독·항아리·동이.
    - slide(밀기)는 옮길 만한 것(항아리·짚단·상·소반·바구니), flip(뒤집기)은 작은 것(바가지·소반·그릇·책).
    - break(깨기, 10/23 미르)는 게임 전체에서 한 번 이하 — 다른 방법으로는 속을 볼 수 없는 것(입을 봉한 항아리, 북 속)에만, 이야기에서 깰 까닭이 있을 때. 깬 물건은 다른 단서·장치 자리로 다시 쓰지 않는다. 귀한 유물(사리함·왕실 물건·불상)은 깨지 않는다. carrier 는 보통 piece·key(깨진 틈에서 나온 물건).
  · 손이 가는 단서를 늘린다(10/23 미르: 눌러도 물건은 그대로고 단서만 뜬다): look(들여다보기)은 단서의 40% 이하. 자국·빛·글씨만 보는 단서 대신, 그 위에 놓인 물건(멍석·가마니·소반·바구니·병풍)을 치우거나 반닫이·함·궤·뒤주·찬장·서랍을 열거나 독을 비우면 나오게 한다. 등잔·초롱은 열지 않는다.
  · 단서 물건을 섞는다(쪽지만 나오면 단조롭다): letter·note 는 이 게임 단서 물건의 3분의 1 이하. 나머지는 piece(물건 — 짚신 한 짝, 끊어진 끈, 반쯤 탄 심지, 엽전 꾸러미, 비녀, 깨진 사기 조각, 젖은 짚) 와 mark(그 자리의 모습 — 자국의 개수·방향, 그릇의 수, 문살 칸).
  · 01 사실에 (원문 「…」)로 남은 방언·옛말은 게임 글(단서·쪽지·힌트·제목)에 그대로 쓰지 않는다 — 01 이 풀어 쓴 뜻으로 쓴다(예: 원문 「한방」 → 「신부와 같은 방」).
  · 문장은 그 시대 사람이 실제로 쓸 법한 자연스러운 한국어로. 뜻이 어색하거나 문법이 틀린 문장 금지(나쁜 예: 「손님 한 분은 한방에 드심」 — 「한방」의 뜻이 안 통한다). 쪽지·서신은 누가 누구에게 왜 쓴 것인지가 보이게.
  · 화면에 보여야 할 것(10/26 미르: 장판의 「흰 줄·누런 줄」 빛을 적어 놓고 화면엔 발자국이 그려져 풀 수 없었다): look 단서(carrier mark)는 shows 를 쓴다 — {"kind":"foot|light|shadow|water|blood|object","count":숫자(foot 만, 1~8)}. 게임이 그릴 수 있는 것은 이것뿐이다:
    - foot: 발자국 한 줄(개수 count 만큼, 젖은 것 가능) · light: 창에서 든 빛 한 덩어리(색·줄 수 구분 못 함) — 단, 창살 칸 모양으로 비치게 하려면 shows 에 "cells":["행-열",…],"grid":[행 수,열 수] 를 적으면 그 칸만 밝게 그린다(문살 무늬판 답과 같은 칸) · shadow: 창호지에 비친 사람 그림자 하나 — 누구인지가 풀이에 쓰이면 "figure":"woman|man|child|elder" 를 적는다(woman=쪽진 머리·넓은 치마폭 실루엣, man=갓 쓴 실루엣, child=작은 키·댕기머리, elder=굽은 등·지팡이). figure 없이는 「사람 모양」만 보인다 · water: 물 고인 자리 하나 · blood: 작은 핏자국 하나 · object: 그 자리에 놓인 물건 자체.
    - content 는 이 그림으로 확인할 수 있는 것만 쓴다. 색·줄 수·글씨·세밀한 무늬처럼 그림으로 못 보이는 정보가 풀이에 필요하면 mark 가 아니라 손에 드는 단서(note·letter — 그것을 적은 기록)로 준다.
  · 한 퍼즐에서 carrier 가 모두 mark 이면 안 된다 — 적어도 하나는 손에 드는 물건(letter·note·key·piece).
- 풀이 장치(10/22 미르 — 단서를 다 모았는데 「뭘 해야 할지 모르겠다」를 막는다): 고르기·입력 퍼즐(solve.interaction 이 select·input)은 반드시 눈에 보이는 장치에서 푼다. solve 에 device 를 쓴다 — 장치 목록(시대에 맞는 것):
  · yundo(윤도 방위 자물쇠 — 조선 나침반 윤도의 방위 눈금을 돌려 맞춤. spec {"labels":["자","축","인","묘","진","사","오","미","신","유","술","해"] 또는 8방위 ["북","북동",…], "count":맞출 칸 수 1~3}, answer = 방위 이름(칸이 여럿이면 순서대로 배열)) → interaction input
  · sangaji(산가지 셈판 자물쇠 — 산가지를 놓아 수를 맞춤. spec {"digits":2~4}, answer = 숫자 문자열) → input
  · bimil(장석 하나 고르기 비밀자물쇠)은 쓰지 않는다 — 10/28 미르: 「하나씩 클릭하다 보면 무조건 풀리는 의미 없는 장치」. 보기 몇 개 중 하나를 고르는 자물쇠는 틀려도 잃는 게 없어 추리 없이 풀린다.
  · geulja(글자 바퀴 자물쇠 — 바퀴 3~4개의 글자를 맞춤. 조선 실물 근거가 약하니 invented 에 「글자 바퀴 자물쇠는 게임 장치」라 적는다. spec {"rings":[["갑","을","병",…],[…]]}, answer = 글자 배열) → input
  · munsal(문살 무늬판 — 창호 문살 칸을 눌러 무늬를 맞춤. spec {"rows":3,"cols":3 또는 4}, answer = 누를 칸 배열 ["1-2","2-3",…](행-열, 1부터) — 3칸 이상, 전체의 절반 이하) → input. 빛·그림자·자국 단서를 칸으로 옮기는 퍼즐에 맞다(달빛 든 칸, 그림자 진 칸).
  · maedeup(오방색 매듭 — 청·적·황·백·흑 매듭 끈을 순서대로 당김. spec {"colors":["청","적","황","백","흑"],"count":3~5}, answer = 색 배열(당기는 순서)) → input. 색 ↔ 방위·사람·물건 대응표 단서에 맞다(동=청, 남=적, 가운데=황, 서=백, 북=흑).
  · pae(패 끼우기 — 호패·나무패를 홈에 끼움. spec {"tags":["…",…] 4~6개(그 방에 실제로 보이는 사람·물건 이름 2~5자, 헛패 포함),"slots":2~3}, answer = 패 이름 배열(홈 수와 같은 개수, 홈 순서, 겹치지 않음)) → input. 자리 배정(누구 신이 어느 댓돌에, 어느 물건이 어느 칸에)처럼 방에서 눈으로 확인되는 대응을 맞추는 퍼즐에만. 게임 전체에 1개까지.
    - 사건의 차례를 외워 늘어놓는 퍼즐로 쓰지 않는다(10/27 미르: 대청 패 「달빛→속삭임→해빛→짚신」 — 흐름을 유추하는 과정이 재미없고 어렵고 몰입을 깬다). 빛·소리·말·기다림·소동·어둠 같은 일·현상 이름은 패가 될 수 없다.
  · buk(북 장단 — 북을 정해진 장단으로 침. spec {"strokes":["덩","쿵","딱"],"beats":4~8}, answer = 장단 배열(덩=가운데 세게, 쿵=가운데 약하게, 딱=테)) → input. 소리 단서(몇 번·어떤 소리)를 박으로 옮기는 퍼즐에 맞다. 게임 장치이므로 invented 에 적는다.
  · hoesang(회상 장면 맞추기)은 쓰지 않는다 — 10/27 미르: 「맞춰도 아무 일도 일어나지 않는다. 게이지 맞추는 게임 같은 미니게임이 훨씬 낫다」.
  · 손맛 미니게임 — 게이지(gate gauge, 10/27 미르): 게임 전체에 1~2개. 단서 하나를 드러내는 「몸짓」에 붙인다 — 그 단서를 얻으려면 물건을 다루는 동작의 세기·때를 게이지로 맞춰야 한다(예: 뻑뻑한 궤 뚜껑을 알맞은 힘으로 들어 올림 · 등잔 심지를 알맞게 돋워 바닥 자국이 보이게 함 · 젖은 창호지를 찢어지지 않게 떼어 냄 · 물 고인 곳간 바닥에서 미끄러지지 않게 디딤). 바늘이 오가는 막대에서 알맞은 칸에 멈추면 성공이다.
    - 그 공간·이야기에 그럴듯한 동작이어야 한다. 성공하면 물건이 움직이고 그 단서가 드러난다 — 그 단서는 뒤 퍼즐의 required_clue_ids 에 꼭 들어간다(맞춰도 아무 일 없는 미니게임 금지).
    - 형식: 그 단서(clue)에 "gate":{"kind":"gauge","name":"짧은 이름(예: 궤 뚜껑 들기)","verb":"플레이어가 하는 동작 한 문장","too_low":"힘이 모자랄 때 반응 한 문장","too_high":"넘칠 때 반응 한 문장","success":"성공했을 때 반응 한 문장"}. 늘 3회 연속(게임이 정한다 — 회차마다 바늘이 빨라지고 칸이 좁아진다). 그 단서는 get_by inspect, 손에 드는 물건이나 자국(carrier)이 있는 단서.
    - 추론과 무관한 손맛이다 — 답·차례를 정하지 않는다. 퍼즐 수에 세지 않는다.
  · 장치의 답 낱말은 그 답을 알려 주는 단서 글에 같은 낱말로 나온다(12차: 쪽지는 「발소리」, 패는 「발자국」이라 한 번 더 짐작해야 했다).
  · 「일어난 차례 맞추기」는 퍼즐로 내지 않는다 — 이야기 순서는 05b 이야기 컷이 보여 준다. 장치 답은 공간에서 보고 셀 수 있는 것(빛이 든 칸·자국 개수·그림자 모양·방위·물건 자리)에서 나온다.
  · 장치는 그 단서에 맞는 것을 고른다(10/26 미르: 종류를 채우려고 억지로 붙인 장치는 추론이 안 된다). 한 게임에서 같은 장치는 두 번까지. 사용자 글에 [지난 시험에서 쓴 장치] 가 있으면 똑같이 맞는 장치끼리일 때만 덜 쓴 쪽을 고른다. observation 퍼즐은 2개 이하.
  · 형식: "solve":{…,"device":{"kind":"yundo","name":"대청 문 윤도 자물쇠","on":"exit_door 또는 이 퍼즐 호스트 need_id(반닫이·궤·함·서안처럼 잠글 수 있는 물건)","spec":{…}}}
  · 찍어서 맞히지 못하게: 글자 바퀴는 바퀴마다 글자 6~10개(그럴듯한 헛글자 포함), 윤도는 8방위 이상, 산가지는 2자리 이상.
  · 퍼즐은 「다 줍고 고르기」가 아니다(10/23 미르: 방 안 물건을 다 누르고 쪽지를 다 읽으면 정답을 누를 수 있다 → 유치원생도 푼다).
    - 고르기(select)의 선택지는 문장·해석이 아니라 물건·문양·사람 패·방위처럼 장치에 새겨진 것이다. 단서를 다 읽어도 답이 글자 그대로 보이지 않는다.
    - 답은 단서를 한 번 이상 「바꿔야」 나온다: 세기(자국 몇 개) · 방향 돌리기(해 뜨는 쪽에서 두 칸) · 대응표(문양 ↔ 사람) · 자리 옮기기(빛이 든 자리 → 문살 칸). 일어난 차례를 늘어놓거나 남는 것을 빼서 고르는 바꾸기는 쓰지 않는다(위 소거·차례 금지). answer_from 에 그 바꾸기를 적는다.
    - 윤도(방위) 퍼즐은 방 안에 방위 기준이 보여야 한다: device.spec.reference = {"label":"동","what":"해가 드는 뒷창"} 처럼 실제 공간의 무엇이 어느 방위인지. 단서는 그 기준에서 몇 칸·어느 쪽인지를 준다.
  · 답은 단서 하나에 그대로 적혀 있으면 안 된다 — 단서 2개 이상을 합치거나 바꿔야 나온다(예: 서신의 「해 뜨는 쪽」 + 명부의 「두 칸 돌려」 → 묘에서 두 칸 → 사). answer_from 에 그 계산을 적는다. 장치에 들어갈 수 없는 답(긴 문장)은 쓰지 않는다.
  · combine_clues 퍼즐은 장치 없이 수첩에서 푼다.
  · 답은 판정하는 말이 아니다(10/26 미르: 글자 바퀴 답 「스스로」 — 스스로인지 끌려갔는지 억지로인지 어디서 알 수 있나). 글자 바퀴·패·비밀자물쇠의 답 글자·이름은 단서 content 에 실제로 적히거나 보이는 것을 모아 만든다(예: 쪽지마다 먹으로 동그라미 친 글자 하나, 패에 새긴 이름, 장석 그림). 「스스로·억지로·끌려감」처럼 단서를 읽고 내리는 판단을 답으로 쓰지 않는다 — 판단은 combine_clues(어느 두 단서가 같은 것을 가리키나)로 묻는다.
  · 헷갈리게 하는 단서(맞지 않는 기록·물건)는 넣지 않는다(10/26 미르: 퀴즈와 상관없는 단서가 혼선만 준다). 모든 단서는 어느 퍼즐의 풀이에 쓰인다.
  · 단서 글(text·reaction)에 쓰는 물건 이름은 그 단서를 주는 호스트(host_needs.object_examples 첫째)와 같은 이름으로 쓴다 — 「서안 서랍」이라 써 놓고 문갑을 두지 않는다.
- 장면 출구: 마지막 Scene(결말 연출 제외)을 뺀 모든 Scene 은 그 Scene 의 마지막 퍼즐을 출구 장치로 푼다 — solve.device.on = "exit_door"(다음 Scene 공간으로 가는 문에 걸린 자물쇠), interaction 은 input 또는 select. 이 장치가 풀리면 문이 열린다. 열쇠(exit.key)는 쓰지 않아도 된다(장치가 kind "key" 일 때만 — 앞 퍼즐에서 열쇠를 얻어 문 자물쇠에 대는 방식). exit 는 {"lock":"…","key":null} 처럼 적어도 된다.
- (옛 방식) 장면 출구: 마지막 Scene(결말 연출 제외)을 뺀 모든 Scene 은, 그 Scene 의 마지막 퍼즐에 exit 를 둔다 — {"key":{"kind":"key|code","name":"예: 사랑방 문 열쇠 / 자물쇠 번호 쪽지","found":"풀이에 성공하면 어디서 어떻게 나오는지 한 문장(예: 서안 서랍이 열리며 놋쇠 열쇠가 나온다)"},"lock":"다음 Scene 공간으로 가는 문·길에 걸린 것(예: 대청으로 나가는 문의 무쇠 자물쇠)"} 그리고 success_effects 에 {"type":"object_unlocked","target_id":"EXIT-<scene_id>"} 를 넣는다. 열쇠를 자물쇠에 대면 문이 열리는 연출이 이 Scene 의 끝이다.
- clue_combination 은 정확히 단서 2개의 짝(순서 무관). 단서는 이 퍼즐 또는 앞 퍼즐에서 얻은 것만.
- 힌트는 2단계: hint_1(방향만) · hint_2(정답).
재미 규칙
- 한 Scene 에 퍼즐 1~2개. 게임 전체에서 puzzle_type 을 3가지 이상 섞는다. 같은 유형이 연달아 3번 나오지 않게.
- 「기록을 읽고 대조」만 반복하지 않는다. 퍼즐의 절반 이상은 그 장소에 원래 있을 생활 물건·인물·지형을 직접 살피는 것으로 푼다(배·그물·말뚝·통발·장승·바위 자국·인물에게 말 걸기 등). 글이 새겨진 판·돌(readable_surface)은 게임 전체 호스트의 3분의 1 이하.
- 답은 단서에서 하나로 정해져야 한다(answer_from 에 어떤 단서로 어떻게 정해지는지). 숫자·순서·이름 같은 답이 장면 물건에서 나오면(말뚝 수, 그물 매듭 수 등) 그 물건 개수·상태는 게임 장치로 지어도 된다 — invented 에 적어 사실과 구분한다. 설화 사실(사건·인물·장소)은 지어내지 않는다(basis 에 F- id, 해석 유보 U- 는 단정하지 않음).
- 결말 장면: 사건이 해소되는 의례·후일담·전승처럼 플레이어의 행동으로 일어나는 일이 아니라 「그 뒤 이렇게 되었다」를 보여 주는 마지막 씬은 퍼즐로 만들지 않는다 — {"puzzle_id":"END","scene_id":"…","presentation":"ending_cinematic","discoveries":[…],"summary":"게임을 끝낸 뒤 보여 줄 장면"} 하나로 적고 host_needs 는 비운다(공간에 놓지 않음). 마지막 퍼즐은 그 앞 씬에서 이야기를 마무리 짓는 것으로.
- 04 필수 발견(required_discoveries)을 하나도 빠짐없이 정확히 한 퍼즐(또는 결말 장면)에 배정한다. 논리 관계를 주장하면 logic 에 성립 조건, 입력만으로 성립하지 않으면 status=blocked_by_story_input 과 blocked_reason.
- difficulty: easy|medium|hard — 앞 Scene 일수록 쉽게.
host_needs(공간에 있어야 할 물건·자리)
- kind: inspectable_object(눌러 살피면 단서가 나오는 생활 물건) | readable_surface(글·그림·표식 면) | npc(말을 거는 인물) | landmark(멀리서 보이는 기준물) | standing_spot(서서 보는 자리 — 물건 아님) | sound_source(소리 나는 곳 — 물건 아님) | answer_device(답을 넣거나 고르는 자리 — 자물쇠 함·제단·문 등 그 장소에 맞는 물건)
- what 은 기능, object_examples 는 그 시대·장소에 맞는 눈에 보이는 물건 2~3개(한국어 명사), place_hint 는 이야기 속 장소. 단서를 주는 호스트는 gives 에 clue_id.
출력: \`\`\`json 코드블록 하나만. 순수 JSON.
{"puzzles":[{"puzzle_id":"PZ-01","scene_id":"scene-01","title":"","discoveries":["RD-S1-01"],"puzzle_type":"code_input","belief_before":"","how":"플레이어가 하는 일을 순서대로","learns":"","clues":[{"clue_id":"CL-01-1","text":"무엇을 어디서 찾았다(사실 한 줄)","get_by":"inspect|navigate|combine_clues","from":"PZ-01-H1","reveal":{"action":"lift","where":"under","reaction":""},"carrier":{"kind":"letter","name":""},"content":"집어 들면 읽히는 글·보이는 모습 그대로","basis":["F-01"]}],"solve":{"interaction":"input|select|combine_clues|navigate|inspect","at":"PZ-01-H3","prompt":"화면에 뜨는 질문","options":null,"answer":"","answer_from":"CL-01-1 과 CL-01-2 로 …","required_clue_ids":["CL-01-1"]},"invented":[],"hint_1":"","hint_2":"","success_effects":[{"type":"clue_acquired","target_id":"CL-01-R"},{"type":"puzzle_completed","target_id":"PZ-01"},{"type":"object_unlocked","target_id":"EXIT-scene-01"}],"exit":{"key":{"kind":"key","name":"","found":""},"lock":""},"basis":["F-01"],"logic":null,"difficulty":"easy","host_needs":[{"need_id":"PZ-01-H1","kind":"inspectable_object","what":"","object_examples":[],"place_hint":"","count":1,"gives":["CL-01-1"]}],"status":"draft","blocked_reason":null}]}`;

// ── 06 공간 구성 ──
const regionList = Object.entries(REGION_KINDS).map(([k, v]) => `  - ${k}: ${v}`).join('\n');
const SPACE_SYSTEM = `너는 「왜곡」 공간 구성 에이전트다. 이야기(01 사실·04 Scene·05 퍼즐 초안)를 주어진 게임 공간 위에 「플레이할 수 있고 자연스러운 게임 공간」으로 꾸밀 계획을 세운다. 좌표는 정하지 않는다 — 코드가 지형 칸 지도로 계산한다.
해야 할 일
1) 장소 맞추기(place_map): 이야기에 나오는 장소(01 장소 사실, 04 공간 요구, 05 place_hint)마다 공간의 어느 구역이 맡는지. 맡을 구역이 없으면 distant(원경으로 보이게) 또는 missing(공간 부족). Scene 마다 쓸 구역(scene_zones).
2) 구역 내용(contents): 그 장소의 쓰임에서 당연히 있어야 할 것을 끌어낸다 — 시설(facility)·생활 흔적(life_trace)·기준물(landmark). 장소의 기능에서 생각한다: 사람이 무엇을 하러 오는 곳이고, 그 일을 하려면 무엇이 놓여 있어야 하고, 그 일이 끝난 뒤 무엇이 남는가. 이야기 물건(story_prop)과 퍼즐 호스트(puzzle_host — 05 host_needs 를 모두 받는다, serves 에 need_id)도 넣는다. npc 호스트는 인물(cast)로 넣고 serves 에 need_id. answer_device 는 그 장소에 맞는 물건(puzzle_host)으로. 물건이 아니라 자리인 호스트(standing_spot 서서 바라보는 자리, sound_source 소리가 나는 곳)는 role 을 marker 로 — 에셋 없이 위치 표식만 남긴다(바위·둔덕 같은 것이 필요하면 따로 항목으로).
3) 인물(cast): 01 의 인물 사실마다 등장 Scene·구역·하는 일. 원문에 없는 인물은 일반 인물(마을 사람·뱃사람 등)만, 장소 쓰임상 있어야 할 때만.
4) 배경 층(environment): 걷지 않는 땅을 비워 두지 않는다. 지형 칸 넓이 표를 보고, 그 지역·시대·지형에 맞는 식생·돌을 층으로 적는다. 층마다 class(${Object.keys(CLASSES).filter(c => c !== 'prop').join('|')}), 구체 이름(name_ko, 예: 소나무), region, 밀도(sparse|medium|dense), 크기 범위(m), pattern(patchy=뭉치게|even=고르게). 한 영역에 여러 층(나무+덤불+풀+꽃)을 겹친다.
항목 규칙
- contents·cast 항목 하나 = 눈에 보이는 물건 한 종류. 「A 와 B」「A·B」처럼 묶지 않는다 — 따로 항목으로 나눈다(선착장 / 말뚝).
- size_m 은 그 물건의 실제 높이(m) — 길이·폭이 아니다(배 높이 약 1 m, 길이 4 m 이면 [0.8,1.2]).
연출 일반 원칙
- 걷는 곳(구역 안·길)은 비워 동선을 지키고, 그 둘레(walk_edge)를 가장 풍성하게 — 길과 마당의 테두리가 공간을 읽게 한다.
- 크기를 섞고 뭉치게. 같은 크기를 고르게 깔면 인공적이다.
- 가파른 벼랑면엔 틈 덤불·바위만, 물가엔 물풀·갈대·물가 돌, 물 위엔 배처럼 물에 뜨는 것만.
- 시선이 가야 할 기준물(절벽·의례 자리·퍼즐 호스트) 앞은 막지 않는다.
- 구역마다 성격이 달라 보이게(쓰임이 다르면 놓인 것이 다르다).
씬 흐름(10/20 — 플레이어는 씬마다 그 씬의 이야기를 공간에서 읽으며 풀어 간다)
- scene_zones: 씬마다 주 구역 1개(많아야 2개). 씬 순서대로 길을 따라 나아가게 잡는다(앞 씬 구역과 길로 이어진 곳). 한 씬이 모든 구역을 쓰지 않는다. 앞 구역으로 돌아가면 reason 에 이야기상 이유.
- 그 씬의 퍼즐 호스트·인물은 그 씬 구역에 둔다.
- scenes: 항목이 보일 씬. 늘 있는 시설·생활 흔적은 생략(늘 보임). 사건의 결과로 생기는 흔적(굴린 자국·쓰러진 사람·의례 흔적·소문 게시 등)은 그 사건이 일어난 씬부터 — 앞 씬에서 미리 보이면 이야기 순서가 깨진다. 인물은 scene_ids 에 나오는 씬만.
- ending_cinematic 으로 표시된 장면(05)의 물건·인물은 공간에 놓지 않는다.
- 이야기 물건·시설은 구역 가장자리·구석·물가에 붙여 두고 걷는 길 한가운데를 막지 않는다. 퍼즐 호스트는 플레이어가 지나가며 발견할 자리에.
region kind
${regionList}
출력: \`\`\`json 코드블록 하나만.
{"place_map":[{"place":"","from":["F-03","SPREQ-S1-01"],"zone":"Z1|distant|missing","reason":""}],
 "scene_zones":[{"scene_id":"scene-01","zones":["Z1"],"reason":""}],
 "contents":[{"item_id":"C-01","name_ko":"","role":"facility|life_trace|landmark|story_prop|puzzle_host|marker","zone":"Z1","region":{"kind":"zone_waterside","zones":["Z1"]},"arrangement":"single|group|row","count":1,"size_m":[0.8,1.2],"position_hint":"","why":"","serves":[],"scenes":["scene-02","scene-03"]}],
 "cast":[{"item_id":"P-01","name_ko":"","basis":["F-05"],"scene_ids":["scene-01"],"zone":"Z1","activity":"","size_m":[1.5,1.7],"position_hint":"","serves":[]}],
 "environment":[{"layer_id":"E-01","class":"tree","name_ko":"","region":{"kind":"walk_edge","zones":["Z1","Z2"]},"density":"medium","size_m":[3,8],"pattern":"patchy","why":""}],
 "notes":""}`;

// ── 07 에셋 선정 ──
const SELECT2_SYSTEM = `너는 「왜곡」 에셋 선정 에이전트다. 공간 구성 계획의 항목마다 공용 라이브러리 후보 중에서 고른다.
규칙
- 그 항목의 후보 목록에 있는 id 만 고른다. 지어내지 않는다.
- 이름·분류·시대·장소·설명·크기를 본다. 대체는 생김새·크기·쓰임이 비슷할 때만(같은 쓰임의 다른 모양 물건) 고르고 reason 에 대체라고 적는다. 생김새가 다른 물건으로 때우지 않는다(바위 자리에 깔개, 기록판 자리에 발자국·동물 모형 X). 맞는 게 없으면 picks 를 비우고 missing 에 필요한 것을 적는다.
- 배경 층(environment)은 같은 종류 안에서 모양이 다른 것을 2~3개 골라 섞는다(복제 티를 줄인다). 낱개 항목은 1개.
- 나무 층은 잎 모양이 맞는 것만: 활엽수(팽나무·느티나무·참나무·버드나무 등) 자리에 소나무(침엽수)를 고르지 않고, 소나무 자리에 활엽수를 고르지 않는다. 같은 잎 모양 안에서는 수관(가지·잎 덩어리)이 넓은 것을 하나 이상 넣는다 — 길가·언덕 테두리의 덩어리감은 수관 넓이에서 나온다.
- 장소·신분·시대에 맞는 것만: 항목의 장소(나루·어촌·마을·들·산길 같은 서민 생활 장소인지, 궁궐·관아·사찰·양반가인지)를 보고, 이름·설명·출처가 다른 계층의 것(궁궐 전각 가구·단청·붉은 칠 장식 기물 등)은 서민 장소에 고르지 않는다. 시대가 어긋나는 것(근현대 물건)도 고르지 않는다. 맞는 게 없으면 missing.
- 「임시본」은 코드 모형을 뽑은 임시 3D(실제 에셋으로 바뀔 예정) — 뜻이 맞으면 써도 된다. 「설명 추정」은 메타를 코드가 추정한 것이니 이름·분류를 더 믿는다.
출력: \`\`\`json 코드블록 하나만. 순수 JSON 값만(문자열 안에 코드·식 금지). 한 항목을 한 줄에.
{"selections":[{"item_id":"C-01","picks":["후보 id"],"reason":"","missing":null 또는 {"name_ko":"","description_ko":"생김새·재질·크기","why":""}}]}`;

// ── 08 배치(낱개 자리 힌트) ──
const LAYOUT2_SYSTEM = `너는 「왜곡」 배치 에이전트다. 공간 구성 계획의 낱개 항목(시설·생활 흔적·기준물·이야기 물건·퍼즐 호스트·인물)마다 놓을 자리 힌트를 미터 좌표로 준다. 코드가 그 힌트를 지정 영역(region)의 가장 가까운 빈 칸으로 옮기고 겹침을 막는다. 배경 층은 코드가 따로 깐다(여기서 다루지 않는다).
규칙
- 좌표는 그 항목 구역 사각형 안. position_hint(말로 쓴 위치)를 따른다. 물가는 구역 경계 중 강 쪽 변, 절벽 발치는 절벽 쪽 변.
- 걷는 동선(구역과 길이 만나는 입구, 구역 가운데)을 막지 않는다. 같은 구역 안 항목끼리 쓰임이 이어지는 것은 가까이(배와 배 매는 시설, 평상과 걸상).
- 인물은 하는 일(activity)에 맞는 물건 곁에.
- rotationY(도)는 그 물건이 향할 쪽: 0 = +z(남쪽, 강 쪽), 90 = +x(동쪽). row 배치면 row_angle(도)로 줄 방향.
출력: \`\`\`json 코드블록 하나만.
{"items":[{"item_id":"C-01","x":0,"z":0,"rotationY":0,"row_angle":null,"reason":""}]}`;

// ── 09 자기 검사 보고 고치기 ──
const REVISE_SYSTEM = `너는 「왜곡」 공간 연출 검토 에이전트다. 공간 구성 계획(배경 층)이 실제로 깔린 결과의 실측과 자기 검사 실패를 보고, 배경 층을 고친다.
판단 기준(일반 원칙)
- 야외 공간은 걷는 곳 둘레와 언덕에 키 큰 덩어리(나무·큰 덤불)가 있어야 공간의 테두리가 선다. 풀·꽃만 있으면 텅 빈 들판으로 보인다.
- 구역마다 성격이 달라 보여야 한다(쓰임·분위기). 이야기 분위기를 거스르지 않는다.
- 기준물(절벽·의례 자리) 앞 시선은 막지 않는다. 걷는 곳은 비운다(코드가 지킴).
- 바꿀 수 있는 것: 기존 층의 density(sparse|medium|dense)·region·size_m·pattern, 층 삭제, 같은 에셋을 쓰는 새 층 추가(same_assets_as 에 기존 layer_id). 새 에셋은 고를 수 없다.
- 실측이 이미 충분한 곳은 건드리지 않는다. 바꾼 이유를 why 에 한 문장.
출력: \`\`\`json 코드블록 하나만.
{"environment_changes":[{"layer_id":"E-05","density":"dense","region":{"kind":"walk_edge","zones":["Z1"]},"size_m":[3,8],"pattern":"patchy","why":""}],"environment_add":[{"layer_id":"E-30","same_assets_as":"E-05","class":"tree","name_ko":"","region":{"kind":"hill","zones":["Z4"]},"density":"medium","size_m":[4,9],"pattern":"patchy","why":""}],"environment_remove":[],"notes":""}`;

/** 구역 둘레(12 m) 실측 — 09 입력 */
function zoneMetrics(mask, space, spots) {
  return space.zones.map(z => {
    const near = s => { const dx = Math.max(z.x[0] - s.x, 0, s.x - z.x[1]); const dz = Math.max(z.z[0] - s.z, 0, s.z - z.z[1]); return Math.hypot(dx, dz) <= 12; };
    const env = spots.filter(s => s.layer === 'environment' && near(s));
    const tall = env.filter(s => (s.heightM || 0) >= 2);
    let total = 0, covered = 0;
    for (let k = 0; k < mask.n; k++) {
      const x = mask.origin[0] + ((k % mask.nx) + 0.5) * mask.cell, zz = mask.origin[1] + (Math.floor(k / mask.nx) + 0.5) * mask.cell;
      if (!near({ x, z: zz }) || mask.walk[k] || mask.water[k]) continue;
      total++; if (tall.some(s => (s.x - x) ** 2 + (s.z - zz) ** 2 <= 16)) covered++;
    }
    return { zone: z.code, tree: env.filter(s => s.cls === 'tree').length, shrub: env.filter(s => s.cls === 'shrub').length, low: env.filter(s => ['grass', 'flower', 'reed'].includes(s.cls)).length, rock: env.filter(s => ['rock', 'pebble'].includes(s.cls)).length, discrete: spots.filter(s => s.layer !== 'environment' && near(s)).length, tallCover: total ? Math.round((covered / total) * 100) : null };
  });
}

// ── 10 사람 의견 반영 ──
export const VERDICTS = Object.freeze({ approve: '승인(그대로 고정)', swap: '다른 에셋으로', adjust: '위치·수량·밀도 고쳐', replan: '계획부터 다시(왜 여기 있나)', remove: '빼', regenerate: '새로 만들어(생성 대기열)' });
const REPLAN_SYSTEM = `너는 「왜곡」 공간 구성 에이전트다. 사람 검수자가 계획의 일부 항목에 「계획부터 다시」 의견을 남겼다. 그 항목만 의견에 맞게 고쳐 다시 써라.
- 같은 item_id(배경 층이면 layer_id)를 유지한다. 의견이 「다른 물건으로」를 뜻하면 name_ko·role·크기를 바꿔도 된다. 「필요 없다」면 drop: true.
- 장소 쓰임·이야기·퍼즐 호스트(serves)를 깨지 않는다. 항목 하나 = 눈에 보이는 물건 한 종류. size_m 은 실제 높이(m).
- region kind 는 원래 목록 안에서.
출력: \`\`\`json 코드블록 하나만. {"items":[{ ...원래 항목과 같은 모양, "why":"고친 이유", "drop":false }]}`;

// ── 지형 칸 요약(06·08 입력) ──
function maskSummary(mask, space) {
  const rect = Object.fromEntries(space.zones.map(z => [z.code, { x: z.x, z: z.z }]));
  mask.zoneRects = rect;
  const rows = [];
  for (const kind of Object.keys(REGION_KINDS)) {
    const perZone = space.zones.map(z => {
      const region = { kind, zones: [z.code] };
      let n = 0; for (let k = 0; k < mask.n; k++) if (inRegionSafe(mask, k, region)) n++;
      return `${z.code} ${Math.round(n * mask.cell * mask.cell)}`;
    });
    let all = 0; for (let k = 0; k < mask.n; k++) if (inRegionSafe(mask, k, { kind })) all++;
    rows.push(`- ${kind}: 전체 ${Math.round(all * mask.cell * mask.cell)} m² · 구역 근처 ${perZone.join(' / ')}`);
  }
  return ['지형 칸 넓이(m², 「구역 근처」는 구역 사각형에서 12 m 안 — 구역 안 칸은 그 구역만):', ...rows].join('\n');
}
let inRegionSafe = null;

export function v2Kit({ readJsonOut, writeOut, extractJson, llm, spaceItem, spaceText, fail, clip }) {
  return async function runV2(root, trial, step, docs) {
    const { inRegion } = await import('./scatter.mjs');
    inRegionSafe = inRegion;
    const need = (...nos) => { for (const n of nos) if (!docs[n]?.json) fail(409, 'previous_step_missing', `앞 단계 ${n} 결과(JSON)가 없습니다.`); };
    const space = await spaceItem(root);
    if (!space) fail(409, 'space_missing', '공용 라이브러리에 공간 항목이 없습니다.');
    const facts = docs['01']?.json;
    const scenes = docs['04']?.json?.scenes || [];
    // 씬 순서(04) — 「씬」은 번호(1..)로 게임에 넘긴다
    const sceneOrder = scenes.map(s => s.scene_id);
    const puzzleDoc = await readJsonOut(root, trial, 'puzzle.json').catch(() => null);
    const factLines = () => [...(facts?.facts || []).map(f => `- ${f.id} [${f.category}] ${f.text}`), ...(facts?.open || []).map(f => `- ${f.id} [해석 유보] ${f.text || f.question || ''}`), ...(facts?.ng || []).map(f => `- ${f.id} [금지 왜곡] ${f.text || ''}`)].join('\n');
    const storyEnd = () => { const d2 = docs['02']?.json || {}; const e = d2.ending || {}; return ['[02 결말 · 현장 연결 — 결말 컷과 현장 봉인 재료]', `- 결말 상태: ${e.final_state || ''}`, `- 마지막 그림: ${e.last_image || ''}`, `- 열린 채 남는 것: ${e.left_open || ''}`, ...(d2.field_link || []).map(f => `- 현장: ${f.place} · 물음 「${f.online_question || ''}」 · 현장에서 볼 것: ${f.onsite || ''}`)].join('\n'); };
    const sceneLines = (doc) => ((doc?.scenes) || scenes).map(s => [
      `## ${s.scene_id} · ${s.title || ''} — ${s.purpose || ''}`,
      `- 분위기: ${s.mood?.base || ''} · 질문: ${(s.questions || []).join(' / ')}`,
      ...(s.required_discoveries || []).map(r => `- ${r.id}: ${r.text} [${(r.basis || []).join(',')}]${r.logic ? ` · 논리: ${r.logic.claim} / 조건: ${r.logic.conditions}` : ''}`),
      ...(s.space_reqs || []).map(r => `- ${r.space_req_id}: ${r.must_read_as} (장소 ${(r.setting || []).join('/')}, ${r.playable === false ? '걷지 않음' : '걷는 곳'}, ${r.layer || ''})`),
      ...(s.asset_reqs || []).map(r => `- ${r.req_id} (${r.category}): ${r.role_hint || ''} · ${(r.tags_any || []).join('/')} · ${r.lore_reason || ''}`),
      s.exit ? `- 나가는 조건: ${s.exit.complete_when || ''}` : '',
      s.exit?.carry_info?.length ? `- 나갈 때 들고 가는 것(다음 장면 intro 재료): ${s.exit.carry_info.join(' / ')}` : '',
    ].join('\n')).join('\n\n');

    // 에셋 실제 크기(키 m · 발판 비율) — 앉힘 규칙(공중에 뜨기·비탈에 박히기 막기, 10/19)에 쓴다. 에셋마다 한 번
    const dims = new Map();
    let broadTreePool = []; // 수관 넓은 나무(발판 비율 ≥ 0.5) — 라이브러리 tree/ 에서 loadDims 가 채움
    const loadDims = async (pickOf) => {
      const { buildLibrary } = await import('./library.mjs');
      const { placementAsset, glbSize } = await import('./manifestPlace.mjs');
      const { realHeight } = await import('./realSize.mjs');
      const lib = new Map((await buildLibrary(root)).items.map(i => [i.id, i]));
      if (!broadTreePool.length) {
        const pool = [];
        for (const item of lib.values()) {
          if (item.source !== 'public' || !/^\/?_sf_local\/tree\//.test(decodeURIComponent(item.url || ''))) continue;
          try { const a = await placementAsset(root, { id: item.id, nameKo: item.nameKo, url: item.url, source: 'public' }); const sz = await glbSize(path.join(root, a.path)); if (!sz || !sz[1]) continue; const foot = Math.max(sz[0], sz[2]) / 2 / sz[1]; const real = await realHeight(root, { file: a.file, naturalHeightM: a.naturalHeightM, boundsM: item.boundsM }); if (foot >= 0.5) { pool.push({ id: item.id, name: item.nameKo, foot }); dims.set(item.id, { h: real.heightM, known: !/기본값/.test(real.source), foot: +Math.min(4, foot).toFixed(3), half: [+(sz[0] / 2 / sz[1]).toFixed(3), +(sz[2] / 2 / sz[1]).toFixed(3)], name: item.nameKo }); } } catch { /* 건너뜀 */ }
        }
        broadTreePool = pool.sort((a, b) => b.foot - a.foot).slice(0, 3);
      }
      for (const sel of pickOf.values()) for (const p of sel.picks || []) {
        if (dims.has(p.id)) continue;
        const item = lib.get(p.id); if (!item) { dims.set(p.id, null); continue; }
        try {
          const a = await placementAsset(root, { id: item.id, nameKo: item.nameKo, url: item.url, source: item.source === 'khs' ? 'khs' : 'public' });
          const size = await glbSize(path.join(root, a.path));
          const real = await realHeight(root, { file: a.file, naturalHeightM: a.naturalHeightM, boundsM: item.boundsM });
          const foot = size && size[1] > 0 ? Math.max(size[0], size[2]) / 2 / size[1] : 0.4; // 키 1 m 당 발판 반지름
          dims.set(p.id, { h: real.heightM, known: !/기본값/.test(real.source), foot: +Math.min(4, foot).toFixed(3), half: size && size[1] > 0 ? [+(size[0] / 2 / size[1]).toFixed(3), +(size[2] / 2 / size[1]).toFixed(3)] : null, name: item.nameKo });
        } catch { dims.set(p.id, null); }
      }
    };
    // 계획 + 선정 + 자리 힌트 → 실제 자리(코드). 08 과 09(고친 뒤 다시 깔기)가 같이 쓴다. 부르기 전에 loadDims(pickOf)
    // 항목이 보일 씬(10/20 미르: 씬별로 플레이어가 겪을 이야기 흐름대로 보여야 한다)
    //   계획이 scenes 를 적었으면 그대로. 없으면 — 인물: scene_ids 에서만 · 퍼즐 호스트: 그 퍼즐 씬부터 끝까지(세상 물건은 사라지지 않는다) · 그 밖: 늘
    const sceneNumsOf = c => {
      const toNum = ids => [...new Set((ids || []).map(id => sceneOrder.indexOf(id) + 1).filter(n => n > 0))].sort((a, b) => a - b);
      if (['facility', 'landmark'].includes(c.role)) return null; // 시설·기준물은 세상에 늘 있다 — 씬이 지나도 사라지지 않는다
      const fromOn = first => sceneOrder.map((_, i) => i + 1).filter(n => n >= first);
      // 물건은 한번 나타나면 사라지지 않는다(단조성) — 계획이 「scene-01 만」이라 적어도 그 씬부터 끝까지. 사라지는 건 인물뿐
      if (Array.isArray(c.scenes) && c.scenes.length) { const n = toNum(c.scenes); return c.role === 'cast' ? n : (n.length ? fromOn(n[0]) : null); }
      if (c.role === 'cast' && c.scene_ids?.length) return toNum(c.scene_ids);
      const pz = (puzzleDoc?.puzzles || []).filter(p => (p.host_needs || []).some(h => (c.serves || []).includes(h.need_id)));
      if (pz.length) return fromOn(Math.min(...toNum(pz.map(p => p.scene_id))));
      return null;
    };
    const realize = (plan, selection, hintItems, mask, pickOf, locked = []) => {
      // locked: 사람이 승인한 항목의 자리 — 그대로 두고 다른 것이 피해 간다(10 「사람 의견 반영」)
      const lockedIds = new Set(locked.map(s => s.itemId));
      const hints = new Map((hintItems || []).map(i => [i.item_id, i]));
      const discreteAll = [...(plan.contents || []), ...(plan.cast || []).map(c => ({ ...c, role: 'cast', region: { kind: 'zone', zones: [c.zone] }, arrangement: 'single', count: 1 }))];
      // 결말 연출(ending_cinematic) 씬에만 보이는 물건은 놓지 않는다 — 게임을 끝낸 뒤 영상으로 보여 줄 장면(10/20 미르)
      const endingNums = new Set((puzzleDoc?.puzzles || []).filter(p => p.presentation === 'ending_cinematic').map(p => sceneOrder.indexOf(p.scene_id) + 1).filter(n => n > 0));
      const endingOnly = c => { const n = sceneNumsOf(c); return n && n.length && n.every(x => endingNums.has(x)); };
      const endingNotes = discreteAll.filter(endingOnly).map(c => `${c.item_id} 「${c.name_ko}」: 결말 연출 장면에만 나와 공간에 놓지 않음`);
      const discrete = discreteAll.filter(c => !endingOnly(c) && (c.role === 'marker' || pickOf.get(c.item_id)?.picks?.length));
      // 큰 것부터 앉힌다 — 넓은 평지가 필요한 것(평상·배)이 작은 물건에 자리를 뺏기지 않게
      const footOfItem = c => { const d = dims.get(pickOf.get(c.item_id)?.picks?.[0]?.id); return d ? d.foot * (d.known ? d.h : Math.max(...(c.size_m || [1]).map(Number))) : 0; };
      discrete.sort((a, b) => footOfItem(b) - footOfItem(a));
      // 승인(고정) 자리도 x·z 만 고정 — 땅에 앉히는 높이(dy)는 앉힘 규칙으로 다시 계산한다(높이 맞춤은 사람 판단이 아니라 물리)
      //   승인 자리가 앉힘 규칙에 어긋나면(배가 뭍에 걸침 등) 그 항목은 고정을 풀고 다시 놓는다 — 메모로 남김
      const notes = [...endingNotes];
      const reseat = s => { if (s.manual) return { ...s }; /* 사람이 배치 화면에서 고친 자리 — 그대로 */ const d = dims.get(s.assetId); const c = discreteAll.find(x => x.item_id === s.itemId); const h = s.layer !== 'environment' && d?.known ? d.h : (s.heightM || 1); const rule = s.rule || seatRule({ cls: s.cls, layer: s.layer, name: `${c?.name_ko || s.name || ''} ${d?.name || ''}`, region: c?.region }); const seat = seatSpot(mask, s.x, s.z, { rule, foot: (d?.foot ?? 0.4) * h, h, steep: c?.region?.kind === 'cliff_face', half: s.half || null, rot: s.rotationY || 0 }); return seat.ok ? { ...s, rule, dy: seat.dy } : { ...s, rule, bad: seat.reason }; };
      const reseated = locked.map(reseat).map(s => { const c = discreteAll.find(x => x.item_id === s.itemId); const scn = c ? sceneNumsOf(c) : null; return scn ? { ...s, scenes: scn } : s; });
      for (const s of reseated.filter(x => x.bad)) { lockedIds.delete(s.itemId); notes.push(`${s.itemId} 「${s.name || ''}」: 승인 자리(${s.x}, ${s.z})가 앉힘 규칙에 어긋나(${s.bad}) 고정을 풀고 다시 놓음`); }
      const kept = reseated.filter(x => !x.bad && lockedIds.has(x.itemId));
      const occ = kept.map(s => ({ x: s.x, z: s.z, r: Math.max(0.5, (dims.get(s.assetId)?.foot ?? 0.35) * (s.heightM || 1)) })); const spots = [...kept];
      for (const c of discrete) {
        if (lockedIds.has(c.item_id)) continue;
        const h = hints.get(c.item_id) || {};
        const assets = c.role === 'marker' ? ['marker'] : pickOf.get(c.item_id).picks.map(p => p.id);
        const d = dims.get(assets[0]);
        // 낱개는 에셋 실제 키로 앉힌다(그려질 때도 실제 키) · 발판 = 실제 가로·깊이
        const sizeM = c.role !== 'marker' && d?.known ? [d.h * 0.95, d.h * 1.05] : c.size_m;
        const hMax = Math.max(...(sizeM || [1]).map(Number));
        const layerName = c.role === 'cast' ? 'cast' : c.role === 'marker' ? 'marker' : 'content';
        const rule = c.role === 'marker' ? 'plant' : seatRule({ ground: c.ground, layer: layerName, name: `${c.name_ko} ${d?.name || ''}`, region: c.region });
        const region0 = c.region || { kind: 'zone', zones: [c.zone] };
        const tryAt = region => placeItem(mask, { id: c.item_id, assets, region, count: c.count, arrangement: c.arrangement, sizeM, foot: c.role === 'marker' ? 0.3 : (d?.foot ?? 0.35) * hMax, half: c.role !== 'marker' && d?.half ? [d.half[0] * hMax, d.half[1] * hMax] : null, rule, x: h.x, z: h.z, rotationY: h.rotationY, rowAngle: h.row_angle }, occ, trial.id);
        let res = tryAt(region0);
        // 계획한 영역에 앉힐 자리가 없으면(좁은 물가 띠에 4 m 배 등) 이웃 영역으로 한 번 넓힌다 — 넓혔다고 메모(10/19)
        if (!res.spots.length) for (const kind of REGION_FALLBACK[region0.kind] || []) {
          const r2 = tryAt({ ...region0, kind });
          if (r2.spots.length) { notes.push(`${c.item_id} 「${c.name_ko}」: ${region0.kind} 에 앉힐 자리가 없어(${res.reason}) ${kind} 로 넓혀 놓음`); res = r2; break; }
        }
        if (!res.spots.length) notes.push(`${c.item_id} 「${c.name_ko}」: ${res.reason}`);
        const scn = sceneNumsOf(c);
        for (const s of res.spots) spots.push({ ...s, ...(c.role === 'marker' ? { assetId: null, heightM: 0 } : {}), itemId: c.item_id, layer: layerName, zone: c.zone, name: c.name_ko, rule, ...(scn ? { scenes: scn } : {}), ...(c.region?.kind === 'cliff_face' ? { steep: true } : {}) });
      }
      const env = (plan.environment || []).filter(e => pickOf.get(e.layer_id)?.picks?.length).sort((a, b) => (b.size_m?.[1] || 0) - (a.size_m?.[1] || 0));
      const envStats = [];
      for (const e of env) {
        if (lockedIds.has(e.layer_id)) continue;
        const res = scatterLayer(mask, { id: e.layer_id, class: e.class, assets: pickOf.get(e.layer_id).picks.map(p => p.id), region: e.region, density: e.density, sizeM: e.size_m, pattern: e.pattern, footOf: id => dims.get(id)?.foot, rule: seatRule({ ground: e.ground, cls: e.class }) }, occ, trial.id);
        envStats.push({ layer_id: e.layer_id, name_ko: e.name_ko, region: e.region, target: res.target ?? 0, placed: res.spots.length, area: res.area, reason: res.reason || null, rejected: res.rejected || {} });
        for (const s of res.spots) spots.push({ ...s, itemId: e.layer_id, layer: 'environment', name: e.name_ko, cls: e.class, rule: seatRule({ ground: e.ground, cls: e.class }), ...(e.region?.kind === 'cliff_face' ? { steep: true } : {}) });
      }
      // ── 야외 테두리 뼈대(10/20) — 미르 원칙: 「언덕 외곽과 길가 옆을 나무·수풀로 무성하게」 해야 공간이 닫히고 몰입이 선다.
      //    배경 계획(06/09 LLM)이 층을 빠뜨리거나 일부 구역에만 깔아도, 코드가 영역×층(큰키나무·떨기·풀)마다 모자란 만큼 채운다.
      //    종(에셋)·크기는 계획이 고른 것을 그대로 쓴다. 걷는 곳·언덕이 없는 공간(실내)에는 해당 칸이 없어 아무것도 안 생긴다.
      const backbone = [];
      {
        const BACKBONE = [
          ['walk_edge', 'tree', 'dense', [3, 9]], ['walk_edge', 'shrub', 'dense', [0.6, 1.8]], ['walk_edge', 'grass', 'dense', [0.3, 0.9]],
          ['hill_rim', 'tree', 'dense', [5, 11]], ['hill', 'tree', 'medium', [3, 9]], ['hill', 'shrub', 'medium', [0.6, 1.8]],
          ['cliff_face', 'shrub', 'dense', [0.4, 1.2]], ['water_edge', 'reed', 'dense', [1, 2.2]],
        ];
        const byClass = cls => (plan.environment || []).filter(e => e.class === cls && pickOf.get(e.layer_id)?.picks?.length);
        const broadTrees = broadTreePool;
        const cellOf = s => Math.floor((s.z - mask.origin[1]) / mask.cell) * mask.nx + Math.floor((s.x - mask.origin[0]) / mask.cell);
        for (const [kind, cls, density, defSize] of BACKBONE) {
          const layers = byClass(cls);
          if (!layers.length) { if (cls !== 'reed') notes.push(`배경 뼈대 ${kind}·${cls}: 계획에 그 종류 층이 없어 못 채움(06 계획에 ${cls} 층 필요)`); continue; }
          let area = 0; for (let k = 0; k < mask.n; k++) if (inRegionSafe(mask, k, { kind })) area++;
          if (!area) continue;
          const target = Math.round(area * mask.cell * mask.cell * CLASSES[cls][0][{ sparse: 0, medium: 1, dense: 2 }[density]] / 100);
          const inK = spots.filter(s => s.layer === 'environment' && s.cls === cls && inRegionSafe(mask, cellOf(s), { kind }));
          const have = inK.length;
          let deficit = target - have;
          // 나무는 그루 수가 아니라 수관 덮임으로 잰다 — 가는 소나무 40그루보다 넓은 나무 15그루가 테두리를 더 닫는다(10/20)
          if (cls === 'tree') {
            const crown = sp => { const f = dims.get(sp.assetId)?.foot ?? 0.4; return Math.PI * (f * (sp.heightM || 5)) ** 2; };
            const coverNeed = { walk_edge: 0.7, hill_rim: 0.85, hill: 0.5 }[kind] ?? 0.4; // 10/20 위에서 본 화면: 0.45 로는 여전히 빈 언덕
            const haveCover = inK.reduce((a, sp) => a + crown(sp), 0) / 1.3; // 겹침 할인
            const ids = [...new Set(layers.flatMap(e => pickOf.get(e.layer_id).picks.map(p => p.id)))];
            const fAvg = ids.reduce((a, id) => a + (dims.get(id)?.foot ?? 0.4), 0) / ids.length;
            const sz = layers.flatMap(e => (e.size_m || []).map(Number)).filter(Number.isFinite); const hAvg = sz.length ? (Math.min(...sz) + Math.max(...sz)) / 2 : 6;
            const per = Math.PI * (fAvg * hAvg) ** 2 / 1.3;
            deficit = Math.max(deficit, Math.ceil((coverNeed * area - haveCover) / per));
            deficit = Math.min(deficit, Math.round(area / 3)); // 3 m² 에 한 그루까지(수관이 겹치는 숲)
          }
          if (deficit < Math.max(2, target * 0.2)) { backbone.push({ kind, cls, target, have, added: 0 }); continue; }
          let assets = [...new Set(layers.flatMap(e => pickOf.get(e.layer_id).picks.map(p => p.id)))].slice(0, 4);
          // 덩어리감 보충(10/20): 계획이 고른 나무가 모두 가는 수관(발판 비율 < 0.5)이면, 라이브러리의 수관 넓은 나무를 섞는다.
          //   가는 소나무만으로는 수를 늘려도 막대기 숲이 된다. 섞은 사실은 메모로 남긴다
          if (cls === 'tree' && broadTrees.length && !assets.some(id => (dims.get(id)?.foot ?? 0) >= 0.5)) {
            assets = [...assets, ...broadTrees.map(b => b.id)];
            notes.push(`배경 뼈대 ${kind}·나무: 고른 나무가 모두 가는 수관이라 수관 넓은 나무(${broadTrees.map(b => b.name).join('·')})를 섞음`);
          }
          const sizes = layers.flatMap(e => (e.size_m || []).map(Number)).filter(Number.isFinite);
          const sizeM = sizes.length ? [Math.min(...sizes), Math.max(...sizes)] : defSize;
          const id = `B-${kind}-${cls}`;
          const opts = { class: cls, assets, region: { kind }, sizeM: kind === 'hill_rim' ? [Math.max(sizeM[0], defSize[0]), Math.max(sizeM[1], defSize[1])] : sizeM, pattern: 'patchy', spacing: cls === 'tree' ? 1.5 : undefined, overlapEnv: true, footOf: aid => dims.get(aid)?.foot, rule: seatRule({ cls }) };
          // 실측 수관 덮임 — 칸 가운데가 수관 안에 드는 비율(어림 계산은 겹침·띠 밖으로 나간 수관 때문에 높게 나왔다)
          const regionCells = []; for (let k = 0; k < mask.n; k++) if (inRegionSafe(mask, k, { kind })) regionCells.push(k);
          const measured = () => { const trees = spots.filter(s => s.layer === 'environment' && s.cls === 'tree'); let c = 0; for (const k of regionCells) { const x = mask.origin[0] + ((k % mask.nx) + 0.5) * mask.cell, z = mask.origin[1] + (Math.floor(k / mask.nx) + 0.5) * mask.cell; if (trees.some(s => { const r = (dims.get(s.assetId)?.foot ?? 0.4) * (s.heightM || 5); return (s.x - x) ** 2 + (s.z - z) ** 2 <= r * r; })) c++; } return regionCells.length ? c / regionCells.length : 1; };
          const needCover = { walk_edge: 0.7, hill_rim: 0.85, hill: 0.5 }[kind] ?? 0.4;
          let placedN = 0, lastRes = null;
          for (let round = 0; round < (cls === 'tree' ? 5 : 1); round++) {
            const count = round === 0 ? deficit : Math.ceil((needCover - measured()) * area / 8);
            if (round > 0 && (measured() >= needCover || count < 2)) break;
            const res = scatterLayer(mask, { ...opts, id: round ? `${id}-r${round}` : id, count }, occ, trial.id);
            for (const sp of res.spots) spots.push({ ...sp, itemId: id, layer: 'environment', name: `${layers[0].name_ko}(배경 뼈대)`, cls, rule: seatRule({ cls }), backbone: true, ...(kind === 'cliff_face' ? { steep: true } : {}) });
            placedN += res.spots.length; lastRes = res;
            if (!res.spots.length) break;
          }
          const res = { ...lastRes, spots: { length: placedN } };
          backbone.push({ kind, cls, target, have, added: placedN, ...(cls === 'tree' ? { crownCover: +measured().toFixed(2), need: needCover } : {}) });
          envStats.push({ layer_id: id, name_ko: `${layers[0].name_ko}(배경 뼈대 · ${kind})`, region: { kind }, target: placedN, placed: placedN, area: lastRes?.area || 0, reason: lastRes?.reason || null, rejected: lastRes?.rejected || {}, backbone: true });
        }
        // 밑층 — 걷는 곳 둘레·언덕 나무 밑동에 떨기·풀
        const under = [...byClass('shrub'), ...byClass('grass')];
        if (under.length) {
          const trees = spots.filter(s => s.layer === 'environment' && s.cls === 'tree');
          const assets = [...new Set(under.flatMap(e => pickOf.get(e.layer_id).picks.map(p => p.id)))].slice(0, 5);
          const res = understory(mask, trees, { id: 'B-understory', class: 'shrub', assets, sizeM: [0.4, 1.3], footOf: aid => dims.get(aid)?.foot }, occ, trial.id);
          for (const sp of res.spots) spots.push({ ...sp, itemId: 'B-understory', layer: 'environment', name: `${under[0].name_ko}(나무 밑층)`, cls: 'shrub', rule: 'plant', backbone: true });
          backbone.push({ kind: 'tree_base', cls: 'understory', target: null, have: trees.length, added: res.spots.length });
          envStats.push({ layer_id: 'B-understory', name_ko: '나무 밑층(떨기·풀)', region: { kind: 'tree_base' }, target: res.spots.length, placed: res.spots.length, area: 0, reason: null, rejected: {}, backbone: true });
        }
      }
      const selfCheck = selfCheckV2({ mask, space, plan, selection, spots, facts, notes, envStats, dims, puzzleDoc, sceneOrder });
      return { version: 2, backbone, spots, envStats, notes, selfCheck, hints: hintItems || [], sceneZones: plan.scene_zones || [], metrics: zoneMetrics(mask, space, spots) };
    };
    // ── 07 선정(10 「사람 의견 반영」도 같이 씀) — targets 만 고른다. notes: { item_id: 사람 의견 } ──
    const targetsOf = (plan, only = null) => [
      ...(plan.contents || []).filter(c => c.role !== 'marker').map(c => ({ id: c.item_id, kind: 'content', name: c.name_ko, extra: c.why, role: c.role })),
      ...(plan.cast || []).map(c => ({ id: c.item_id, kind: 'cast', name: c.name_ko, extra: c.activity, role: 'cast' })),
      ...(plan.environment || []).map(e => ({ id: e.layer_id, kind: 'environment', name: e.name_ko, extra: e.class, role: e.class })),
    ].filter(t => !only || only.has(t.id));
    const selectFor = async (targets, notes, rawName) => {
      const { buildLibrary, searchLibrary } = await import('./library.mjs');
      const { items } = await buildLibrary(root);
      const CLASS_Q = { tree: ['나무', '소나무', '활엽수', '피나무', '버드나무'], shrub: ['덤불', '관목', '잎덤불'], grass: ['풀', '잡초'], flower: ['꽃', '들꽃'], reed: ['갈대'], rock: ['바위', '돌'], pebble: ['자갈', '돌'] };
      const cands = {};
      for (const t of targets) {
        // 긴 이름(「바위 곁 새김글 돌」「선착장 나무 잔교」)은 통째로 찾으면 점수가 낮아 놓친다(10/19) → 낱말로도 나눠 찾고 가장 높은 점수를 쓴다
        const words = String(t.name || '').replace(/[()（）·,]/g, ' ').split(/\s+/).filter(w => w.length >= 2 && !['곁', '위', '아래'].includes(w));
        const queries = [...new Set([t.name, ...words, ...(t.kind === 'cast' ? ['사람', '인물', '어부', '여인'] : []), ...(t.kind === 'environment' ? CLASS_Q[t.extra] || [] : [])].filter(Boolean))].slice(0, 7);
        const best = new Map();
        for (const q of queries) {
          const found = await searchLibrary(items, q, { placeableOnly: true, root, waitSemanticMs: 15000, limit: 20 });
          for (const r of found.results.slice(0, 10)) if (r.item.source !== 'space') best.set(r.item.id, Math.max(best.get(r.item.id) || 0, r.score));
        }
        // 여러 개가 한 덩이로 붙은 에셋(나무 세 그루 줄 등) 빼기(10/20) — 가로·깊이가 키의 2.5배 넘는 나무·돌·풀은 묶음으로 본다.
        //   낱개 자리·산포 층은 한 그루 단위로 다루므로 묶음을 넣으면 같은 간격의 줄이 그대로 찍힌다(느티나무 34.5×11.3 m)
        const isCluster = c => { const b = c?.boundsM; return Array.isArray(b) && b[1] > 0 && Math.max(b[0], b[2]) > 2.5 * b[1] && /자연물|나무|풀|돌|바위/.test(`${c.categoryKo || ''}${c.nameKo || ''}`); };
        cands[t.id] = [...best.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => items.find(i => i.id === id)).filter(c => c && !isCluster(c)).slice(0, 12);
      }
      const line = c => [c.id, c.nameKo, c.categoryKo, c.era || '-', clip(c.description || '', 80) || '-', Array.isArray(c.boundsM) ? c.boundsM.map(v => Number(v).toFixed(1)).join('×') + 'm' : '-', c.needsReplacement ? '임시본' : c.metaQuality === 'auto' ? '설명 추정' : ''].join(' | ');
      const user = targets.map(t => [`### ${t.id} (${t.kind}${t.role ? ' · ' + t.role : ''}) 「${t.name}」 — ${t.extra || ''}`, ...(notes[t.id] ? [`사람 검수 의견(반드시 따른다): ${notes[t.id]}`] : []), ...(cands[t.id] || []).map(c => `- ${line(c)}`), (cands[t.id] || []).length ? '' : '- (검색된 후보 없음)'].join('\n')).join('\n\n');
      const text = await llm(root, trial, step, { system: SELECT2_SYSTEM, user });
      await writeOut(root, trial, rawName, text);
      let json = extractJson(text);
      // 한 줄이 깨져도(10/19: 값 자리에 코드 식을 쓴 줄) 나머지 줄은 살린다
      if (json.__error) json = lenientLines(text);
      if (!json.selections?.length) fail(422, 'json_invalid', `JSON 을 읽지 못했습니다: ${json.__error}`);
      const byId = new Map((json.selections || []).map(s => [s.item_id, s]));
      return targets.map(t => {
        const s = byId.get(t.id) || {};
        const list = cands[t.id] || [];
        const picks = (s.picks || []).map(id => list.find(c => c.id === id)).filter(Boolean).slice(0, t.kind === 'environment' ? 3 : 1);
        return { item_id: t.id, kind: t.kind, name_ko: t.name, picks: picks.map(c => ({ id: c.id, nameKo: c.nameKo, url: c.url, thumbnail: c.thumbnail || null, needsReplacement: Boolean(c.needsReplacement), boundsM: c.boundsM || null })), candidates: list.slice(0, 10).map(c => ({ id: c.id, nameKo: c.nameKo, needsReplacement: Boolean(c.needsReplacement) })), reason: clip(s.reason, 300), missing: picks.length ? null : (s.missing || { name_ko: t.name, description_ko: '', why: '후보 중 고르지 않음' }), invalid: (s.picks || []).filter(id => !list.some(c => c.id === id)) };
      });
    };

    if (step.id === 's05') {
      need('01', '04');
      const local = (trial.llmSteps?.[step.id] || trial.llm) === 'local';
      let json;
      // 10/29 미르: 「공간에서 퍼즐과 연결된 물건을 건드리면 퍼즐도 다시 설계」 — puzzle_rework.json 이 있으면 그 퍼즐만 다시 쓰고 나머지는 그대로 둔다
      const reworkF = path.join(root, '.local/review/trials', trial.id, 'puzzle_rework.json');
      let rework = null; try { rework = JSON.parse(await readFile(reworkF, 'utf8')); } catch { rework = null; }
      const prevPz = rework && !rework.doneAt ? await readJsonOut(root, trial, 'puzzle.json').catch(() => null) : null;
      const reworkIds = prevPz && Object.keys(rework.puzzles || {}).length ? new Set(Object.keys(rework.puzzles)) : null;
      if (reworkIds && !local) {
        const keep = (prevPz.puzzles || []);
        const userR = ['[01 설화 사실]', factLines(), '', '[04 Scene 구성표]', sceneLines(), '', '[게임 전체 퍼즐 — 지금 판. 아래 「다시 설계할 퍼즐」 말고는 바꾸지 않는다]', JSON.stringify({ puzzles: keep.map(p => ({ puzzle_id: p.puzzle_id, scene_id: p.scene_id, title: p.title, learns: p.learns, clue_ids: (p.clues || []).map(c => c.clue_id) })) }), '',
          '[다시 설계할 퍼즐 — 사람이 공간 검수에서 이 퍼즐의 물건을 바꿨다. 같은 puzzle_id·scene_id 를 지키고, 바뀐 물건에 맞게 단서(드러나는 방식 reveal·carrier)·호스트(host_needs)·풀이를 다시 설계한다. 이 퍼즐이 밝히는 것(learns·discoveries)과 다른 퍼즐이 기대는 단서 id 는 되도록 유지. {"puzzles":[…]} 로 이 퍼즐들만 돌려준다]',
          ...[...reworkIds].map(id => `## ${id}\n바뀐 것: ${(rework.puzzles[id] || []).map(x => `${x.name}: ${x.change}`).join(' / ')}\n지금 퍼즐: ${JSON.stringify(keep.find(p => p.puzzle_id === id) || {})}`)].join('\n');
        const textR = await llm(root, trial, step, { system: PUZZLE_SYSTEM, user: userR });
        await writeOut(root, trial, 'raw-s05-rework.txt', textR);
        const jR = extractJson(textR); if (jR.__error || !(jR.puzzles || []).length) fail(422, 'json_invalid', `다시 설계한 퍼즐 JSON 을 읽지 못했습니다: ${jR.__error || '빈 답'}`);
        json = { ...prevPz, puzzles: keep.map(p => reworkIds.has(p.puzzle_id) ? ({ ...((jR.puzzles || []).find(q => q.puzzle_id === p.puzzle_id) || p), puzzle_id: p.puzzle_id, scene_id: p.scene_id }) : p) };
        delete json.check;
      } else if (local) {
        // 로컬 작은 모델은 Scene 5개를 한 번에 맡기면 첫 Scene 하나만 쓰고 끝낸다(10/19 Qwen3-30B 1차) → Scene 마다 한 번씩 부르고 합친다
        const all = []; const raws = [];
        for (const [i, scene] of scenes.entries()) {
          const one = { ...docs['04'].json, scenes: [scene] };
          const sceneText = sceneLines.call(null, one);
          const user = ['[01 설화 사실]', factLines(), '', `[04 Scene 구성표 — 이번에는 ${scene.scene_id} 하나만. 퍼즐 1~2개, puzzle_id 는 PZ-0${i + 1}(둘째는 PZ-0${i + 1}b)]`, sceneText].join('\n');
          const text = await llm(root, trial, step, { system: PUZZLE_SYSTEM, user });
          raws.push(text);
          const part = extractJson(text);
          if (part.__error) fail(422, 'json_invalid', `${scene.scene_id} JSON 을 읽지 못했습니다: ${part.__error}`);
          all.push(...(part.puzzles || []).slice(0, 2).map((p, j) => ({ ...p, puzzle_id: `PZ-0${i + 1}${j ? String.fromCharCode(97 + j) : ''}`, scene_id: scene.scene_id })));
        }
        await writeOut(root, trial, 'raw-s05.txt', raws.join('\n\n----\n\n'));
        json = { puzzles: all };
      } else {
        let vrNote = ''; try { const fb = await readJsonOut(root, trial, 'vr_feedback.json'); if (fb?.clues?.length) vrNote = ['[지난 시각 검수 — 플레이 화면 사진에서 이 단서들이 보이지 않았다. 화면에 그릴 수 있는 것(shows 목록)으로 바꾸거나, 그 정보를 손에 드는 기록(note·letter)으로 옮긴다]', ...fb.clues.map(c => `- ${c.clue_id}: ${c.why}`)].join('\n'); } catch {}
        const user = ['[01 설화 사실]', factLines(), '', '[04 Scene 구성표]', sceneLines(), '', await deviceHistory(root, trial), ...(vrNote ? ['', vrNote] : [])].join('\n');
        const text = await llm(root, trial, step, { system: PUZZLE_SYSTEM, user });
        await writeOut(root, trial, 'raw-s05.txt', text);
        json = extractJson(text);
        if (json.__error) fail(422, 'json_invalid', `JSON 을 읽지 못했습니다: ${json.__error}`);
      }
      const runChecks = (json) => {
        const all = new Set(scenes.flatMap(s => (s.required_discoveries || []).map(r => r.id)));
        const used = (json.puzzles || []).flatMap(p => p.discoveries || []);
        const check = { missing: [...all].filter(id => !used.includes(id)), duplicated: used.filter((id, i) => used.indexOf(id) !== i), unknown: used.filter(id => !all.has(id)), blocked: (json.puzzles || []).filter(p => p.status === 'blocked_by_story_input').map(p => p.puzzle_id) };
        // 계약·재미 검사(10/20) — 사람 답안 없이
        {
          const P = (json.puzzles || []).filter(p => p.presentation !== 'ending_cinematic');
          const TYPES = ['code_input', 'text_input', 'single_choice', 'multiple_choice', 'observation', 'navigation', 'clue_combination'];
          const ACTS = ['inspect', 'navigate', 'input', 'select', 'combine_clues'];
          const hosts = P.flatMap(p => p.host_needs || []);
          const clueIds = new Set(P.flatMap(p => (p.clues || []).map(c => c.clue_id)).concat(P.flatMap(p => (p.success_effects || []).filter(e => e.type === 'clue_acquired').map(e => e.target_id))));
          check.contract = [
            ...P.filter(p => !TYPES.includes(p.puzzle_type)).map(p => `${p.puzzle_id}: 계약에 없는 유형 ${p.puzzle_type}`),
            ...P.filter(p => !ACTS.includes(p.solve?.interaction)).map(p => `${p.puzzle_id}: 계약에 없는 풀이 행동 ${p.solve?.interaction}`),
            ...P.flatMap(p => (p.clues || []).filter(c => !ACTS.includes(c.get_by)).map(c => `${c.clue_id}: 계약에 없는 행동 ${c.get_by}`)),
            ...P.filter(p => !String(p.solve?.answer ?? '').trim() && p.puzzle_type !== 'navigation' && p.puzzle_type !== 'observation').map(p => `${p.puzzle_id}: 정답 없음`),
            ...P.filter(p => !p.hint_1 || !p.hint_2).map(p => `${p.puzzle_id}: 힌트 2단계 없음`),
            ...P.flatMap(p => (p.solve?.required_clue_ids || []).filter(id => !clueIds.has(id)).map(id => `${p.puzzle_id}: 없는 단서 ${id}`)),
            ...P.filter(p => p.puzzle_type === 'clue_combination' && (p.solve?.required_clue_ids || []).length !== 2).map(p => `${p.puzzle_id}: 단서 조합은 정확히 2개`),
          ];
          const types = new Set(P.map(p => p.puzzle_type));
          const readable = hosts.filter(h => h.kind === 'readable_surface').length;
          const GETS = ['inspect', 'navigate'], CARRY = ['letter', 'note', 'key', 'piece', 'mark'], REV = ['lift', 'open', 'slide', 'flip', 'look', 'empty', 'break'];
          const BREAKABLE = /항아리|독$|단지|동이|옹기|사발|대접|그릇|병$|북$|북 |장구|창호|문풍지|초롱|등롱|인형|기와|주전자|뚝배기|질그릇|사기/; const RELIC = /사리|불상|왕실|어보|옥새|보물|국보/;
          const sceneOrder = scenes.map(s => s.scene_id);
          const exitScenes = sceneOrder.filter(id => P.some(p => p.scene_id === id)).slice(0, -1);
          const STILL = ['standing_spot', 'sound_source', 'landmark'];
        const hostOf = (p, id) => (p.host_needs || []).find(h => h.need_id === id);
        const carriers = P.flatMap(p => (p.clues || []).filter(c => GETS.includes(c.get_by)).map(c => c.carrier?.kind)).filter(Boolean);
        const paper = carriers.filter(k => k === 'letter' || k === 'note').length;
        check.reveal = [
          ...P.flatMap(p => (p.clues || []).filter(c => GETS.includes(c.get_by) && (STILL.includes(hostOf(p, c.from)?.kind) || /(빛|그림자|자국|얼룩|소리|(?<!이부|돗|잠|꽃|앉은)자리)$/.test(String((hostOf(p, c.from)?.object_examples || [])[0] || '').trim())) && (c.carrier?.kind !== 'mark' || c.reveal?.action !== 'look')).map(c => `${c.clue_id}: 빛·자국·자리(${(hostOf(p, c.from)?.object_examples || [])[0] || hostOf(p, c.from)?.kind})는 움직이지 않는다 — look + mark 만`)),
          // 10/23 미르: 「상호작용을 해도 물건은 그대로고 단서만 뜬다」 — 들여다보기(look)는 화면에서 아무것도 안 움직인다. 그런 단서는 40% 이하로
          ...(() => { const ins = P.flatMap(p => (p.clues || []).filter(c => GETS.includes(c.get_by))); const lk = ins.filter(c => c.reveal?.action === 'look').length; return ins.length >= 6 && lk / ins.length > 0.4 ? [`들여다보기(look) 단서가 ${ins.length}개 중 ${lk}개 — 40% 이하로. 물건을 들추기·열기·밀기·뒤집기·비우기 하는 단서로 바꾼다(자국 대신 그 자국 위에 놓인 물건을 치우면 나오는 식)`] : []; })(),
          ...P.flatMap(p => (p.clues || []).filter(c => GETS.includes(c.get_by) && c.reveal?.action === 'open' && /등잔|등롱|초롱|좌등|촛대|등경|호롱/.test([hostOf(p, c.from)?.name, ...(hostOf(p, c.from)?.object_examples || [])].filter(Boolean).join(' '))).map(c => `${c.clue_id}: 등잔·초롱은 여는 물건이 아님 — 뒤집기·들여다보기로, 또는 단서를 반닫이·함처럼 열리는 것에`)),
          ...(carriers.length >= 4 && paper / carriers.length > 0.34 ? [`단서 물건 ${carriers.length}개 중 쪽지·서신 ${paper}개 — 3분의 1 이하로(물건 조각·자국으로)`] : []),
          ...P.filter(p => p.solve?.device?.kind === 'yundo' && !p.solve.device.spec?.reference).map(p => `${p.puzzle_id}: 윤도에 방위 기준(spec.reference) 없음`),
          ...P.filter(p => p.solve?.interaction === 'select' && (p.solve.options || p.solve.device?.spec?.knobs || []).some(o => String(o).length > 8)).map(p => `${p.puzzle_id}: 선택지가 문장(물건·문양·패로)`),
            ...P.flatMap(p => (p.clues || []).filter(c => GETS.includes(c.get_by)).flatMap(c => [
              ...(!CARRY.includes(c.carrier?.kind) ? [`${c.clue_id}: 단서 물건(carrier) 없음`] : []),
              ...(!REV.includes(c.reveal?.action) ? [`${c.clue_id}: 발견 연출(reveal) 없음`] : []),
              ...(!String(c.content || '').trim() ? [`${c.clue_id}: 읽히는 내용(content) 없음`] : []),
            ])),
            ...(() => { const br = P.flatMap(p => (p.clues || []).filter(c => GETS.includes(c.get_by) && c.reveal?.action === 'break').map(c => ({ p, c, h: hostOf(p, c.from) }))); const nm = x => [x.h?.name, ...(x.h?.object_examples || [])].filter(Boolean).join(' ');
              const VES = /독|항아리|단지|동이|솥|두멍|자배기|함지|바가지|통$|물통|뒤주|쌀|확$|돌확|대야|버치|옹기/;
              const em = P.flatMap(p => (p.clues || []).filter(c => GETS.includes(c.get_by) && c.reveal?.action === 'empty').map(c => ({ c, h: hostOf(p, c.from) }))).filter(x => !VES.test([x.h?.name, ...(x.h?.object_examples || [])].filter(Boolean).join(' ')));
              return [...em.map(x => `${x.c.clue_id}: 비우기(empty)는 물·곡식 든 독·항아리·솥만(「${(x.h?.object_examples || [])[0] || x.c.from}」 — 10/23 등잔에 비우기가 붙음)`), ...(br.length > 1 ? [`깨기(break)가 ${br.length}번 — 게임 전체에서 한 번 이하`] : []),
                ...br.filter(x => !BREAKABLE.test(nm(x))).map(x => `${x.c.clue_id}: 「${nm(x) || x.c.from}」은(는) 깨질 만한 물건이 아님(옹기·사기·북 가죽·창호지)`),
                ...br.filter(x => RELIC.test(nm(x))).map(x => `${x.c.clue_id}: 귀한 유물은 깨지 않는다`),
                ...br.filter(x => P.some(q => q.solve?.at === x.c.from || q.solve?.device?.on === x.c.from || (q.clues || []).some(d => d !== x.c && d.from === x.c.from))).map(x => `${x.c.clue_id}: 깬 물건(${x.c.from})을 다른 단서·장치 자리로 또 씀`)]; })(),
            ...P.filter(p => (p.clues || []).some(c => GETS.includes(c.get_by)) && (p.clues || []).filter(c => GETS.includes(c.get_by)).every(c => c.carrier?.kind === 'mark')).map(p => `${p.puzzle_id}: 손에 드는 단서 물건이 하나도 없음`),
            ...Object.entries(P.flatMap(p => (p.clues || []).filter(c => GETS.includes(c.get_by))).reduce((a, c) => ((a[c.from] ||= []).push(c.clue_id), a), {})).filter(([, ids]) => ids.length > 1).map(([h, ids]) => `${h}: 물건 하나에 단서 ${ids.length}개(${ids.join(', ')}) — 하나만`),
            ...Object.entries(P.flatMap(p => (p.host_needs || []).filter(h => (h.gives || []).length || (p.clues || []).some(c => GETS.includes(c.get_by) && c.from === h.need_id)).map(h => [`${String(h.place_hint || '').replace(/\s/g, '')}|${String((h.object_examples || [])[0] || h.what || '').replace(/\s/g, '')}`, h.need_id])).reduce((a, [k, id]) => ((a[k] ||= []).push(id), a), {})).filter(([k, ids]) => ids.length > 1 && !k.endsWith('|') && !/(바닥|널|자국|흙|웅덩이|발자국|마당|땅)$/.test(k.split('|')[1])) /* 바닥 자국은 자리마다 따로 표식이 생긴다 */.map(([k, ids]) => `「${k.split('|')[1]}」(${k.split('|')[0]})을 단서 자리 ${ids.join('·')}가 같이 씀 — 물건 하나 = 조사 하나(BE). 다른 퍼즐이라도 다른 물건으로`),
            ...P.flatMap(p => (p.host_needs || []).filter(h => h.need_id === p.solve?.at && P.some(q => (q.clues || []).some(c => GETS.includes(c.get_by) && c.from === h.need_id))).map(h => `${h.need_id}: 답 넣는 자리가 단서도 줌 — 그 단서를 다른 물건으로 옮기거나, 풀이 자리(solve.at)를 단서를 주지 않는 새 물건(host_needs 에 추가)으로`)),
            ...exitScenes.filter(id => !P.some(p => p.scene_id === id && ((p.solve?.device?.on === 'exit_door') || (p.exit?.key?.name && p.exit?.lock)))).map(id => `${id}: 다음 장면으로 가는 출구 장치(device on exit_door) 없음`),
            // 10/26 미르: 문살 답이 바닥 빛과 관계가 없었다 — 문살 답 칸 = 필요한 빛·그림자 단서의 shows.cells
            ...P.filter(p => p.solve?.device?.kind === 'munsal').flatMap(p => { const req = new Set(p.solve.required_clue_ids || []); const ans = (Array.isArray(p.solve.answer) ? p.solve.answer : String(p.solve.answer || '').split(/[,\s]+/)).filter(Boolean).map(String).sort().join(','); const ok = P.some(q => (q.clues || []).some(c => req.has(c.clue_id) && Array.isArray(c.shows?.cells) && c.shows.cells.map(String).sort().join(',') === ans)); return ok ? [] : [`${p.puzzle_id}: 문살 답 칸이 화면에 보이는 빛 단서(shows.cells)와 같지 않음 — 바닥에 비친 밝은 칸이 곧 답이어야 한다`]; }),
            // 10/26 미르: 화면에 못 그리는 것을 look 단서로 쓰지 않는다
            ...P.flatMap(p => (p.clues || []).filter(c => c.carrier?.kind === 'mark' || c.reveal?.action === 'look').flatMap(c => { const k = c.shows?.kind; if (!['foot', 'light', 'shadow', 'water', 'blood', 'object'].includes(k)) return [`${c.clue_id}: look 단서에 shows.kind(foot·light·shadow·water·blood·object) 없음`]; if (k === 'foot' && c.shows.count != null && !(c.shows.count >= 1 && c.shows.count <= 8)) return [`${c.clue_id}: 발자국 개수는 1~8`]; return []; })),
            // 10/27 미르: 그림자 글이 「여인」이라 하면 화면 실루엣도 여인이어야 한다(그 반대도)
            ...P.flatMap(p => (p.clues || []).filter(c => c.shows?.kind === 'shadow').flatMap(c => { const t = `${c.content || ''} ${c.text || ''}`; const FIG = { woman: /여인|여자|아낙|부인|색시|처녀|신부|치마|쪽진/, man: /사내|남자|선비|갓|도령|신랑/, child: /아이|어린/, elder: /노인|늙은|할미|할아비|지팡이/ }; const said = Object.keys(FIG).filter(k => FIG[k].test(t)); const f = c.shows.figure; if (f && !FIG[f]) return [`${c.clue_id}: shows.figure 는 woman·man·child·elder 중 하나`]; if (said.length && !said.includes(f)) return [`${c.clue_id}: 그림자 글은 ${said.join('/')} 인데 화면 실루엣(shows.figure)은 ${f || '없음(그냥 사람 모양)'} — 같게`]; if (f && !said.includes(f)) return [`${c.clue_id}: 화면 실루엣은 ${f} 인데 글에는 그 특징이 없음 — content 에 보이는 모습을 쓴다`]; return []; })),
            // 10/27 미르: 대청 패 「달빛·속삭임·해빛·짚신」 차례 맞추기는 재미없고 몰입을 깬다 — 패는 1개까지, 2~3칸, 일·현상 이름 금지
            ...(() => { const out = []; const PA = P.filter(p => p.solve?.device?.kind === 'pae'); if (PA.length > 1) out.push(`패 끼우기 ${PA.length}개 — 게임 전체에 1개까지`); const ABS = /빛|소리|속삭|어둠|기다림|소동|얘기|이야기|말$|다$|함$|음$/;
              for (const p of PA) { const sp = p.solve.device.spec || {}; const sl = +sp.slots || 0; if (sl < 2 || sl > 3) out.push(`${p.puzzle_id}: 패 홈 ${sl}칸 — 2~3칸`); const bad = (sp.tags || []).filter(t => ABS.test(String(t).trim())); if (bad.length) out.push(`${p.puzzle_id}: 패 이름 「${bad.join('」「')}」 — 일·현상·말은 패가 될 수 없다(방에 보이는 사람·물건 이름만)`); }
              return out; })(),
            // 10/27 미르: 회상 장면 맞추기 금지 · 게이지 미니게임 1~2개, 드러낸 단서는 뒤 퍼즐에 쓰임
            ...P.filter(p => p.solve?.device?.kind === 'bimil').map(p => `${p.puzzle_id}: 비밀자물쇠(장석 고르기)는 쓰지 않는다 — 하나씩 눌러 보면 풀림. 다른 장치나 단서 맞추기로`),
            ...(() => { const out = []; const H = P.filter(p => p.solve?.device?.kind === 'hoesang'); if (H.length) out.push(`회상 장면 맞추기(hoesang) ${H.length}개 — 쓰지 않는다(회상은 05b 이야기 컷)`);
              const G = P.flatMap(p => (p.clues || []).filter(c => c.gate).map(c => ({ p, c }))); if (G.length < 1 || G.length > 2) out.push(`게이지 미니게임(clue.gate) ${G.length}개 — 게임 전체에 1~2개`);
              const req = new Set(P.flatMap(p => p.solve?.required_clue_ids || []));
              for (const { p, c } of G) { const g = c.gate || {}; if (g.kind !== 'gauge') out.push(`${c.clue_id}: gate.kind 는 "gauge"`); for (const k of ['name', 'verb', 'too_low', 'too_high', 'success']) if (!String(g[k] || '').trim()) out.push(`${c.clue_id}: gate.${k} 없음`); if (c.get_by !== 'inspect' || !c.carrier) out.push(`${c.clue_id}: 게이지는 조사(inspect)로 얻는 물건·자국 단서에만`); if (!req.has(c.clue_id)) out.push(`${c.clue_id}: 게이지로 드러낸 단서가 어느 퍼즐의 required_clue_ids 에도 없음 — 맞춰도 아무 일 없는 미니게임`); void p; }
              return out; })(),
            // 10/26 미르: 글자 바퀴 답 「스스로」를 어디서도 읽을 수 없었다 — 글자·패·장석 답은 필요한 단서 content 에 실제로 있어야 한다
            ...P.filter(p => ['geulja', 'pae', 'bimil'].includes(p.solve?.device?.kind)).flatMap(p => { const req = new Set(p.solve.required_clue_ids || []); const txt = P.flatMap(q => (q.clues || []).filter(c => req.has(c.clue_id)).map(c => `${c.content || ''} ${c.text || ''}`)).join(' '); const k = p.solve.device.kind; const parts = k === 'bimil' ? [String(p.solve.answer || '').replace(/\s*장석$/, '')] : (Array.isArray(p.solve.answer) ? p.solve.answer : String(p.solve.answer || '').split(/[,·\s-]+/)).map(String).filter(Boolean); const miss = parts.filter(x => !txt.includes(x)); return miss.length ? [`${p.puzzle_id}: 답 ${miss.map(x => `「${x}」`).join('')} 이(가) 필요한 단서 어디에도 적혀 있지 않음 — 단서에 보이는 글자·이름을 모아 답을 만든다(판단하는 말 금지). 흔적 단서(그림자·발자국)가 그 답을 가리키면 그 단서 content 에 답 말을 그대로 쓰고(「여인의 그림자」) shows.figure 로 그 모습을 그린다 — 소거로 고르게 하지 않는다`] : []; }),
            // 10/26 미르: 「한방」(원문 방언 = 같은 방)이 단서 글에 그대로 나왔다 — 01 이 (원문 「…」)로 남긴 방언·옛말은 게임 글에 쓰지 않고 풀어 쓴 말로
            ...(() => { const toks = [...new Set([...(facts?.facts || []), ...(facts?.open || [])].flatMap(f => [...String(f.text || '').matchAll(/원문 「([^」]{2,8})」/g)].map(m => m[1].trim())))].filter(t => t.length >= 2); return P.flatMap(p => { const txt = [p.title, p.solve?.prompt, p.hint_1, p.hint_2, ...(p.clues || []).flatMap(c => [c.text, c.content, c.carrier?.name, c.reveal?.reaction])].filter(Boolean).join(' '); return toks.filter(t => txt.includes(t)).map(t => `${p.puzzle_id}: 원문 방언 「${t}」을(를) 게임 글에 그대로 씀 — 01 이 풀어 쓴 뜻으로`); }); })(),
            ...P.filter(p => ['select', 'input'].includes(p.solve?.interaction) && !['yundo', 'sangaji', 'bimil', 'geulja', 'munsal', 'maedeup', 'pae', 'buk', 'key'].includes(p.solve?.device?.kind)).map(p => `${p.puzzle_id}: 고르기·입력 풀이에 장치(device) 없음`),
            ...(() => { const ks = P.map(p => p.solve?.device?.kind).filter(k => k && k !== 'key'); const cnt = ks.reduce((a, k) => (a[k] = (a[k] || 0) + 1, a), {}); const obs = P.filter(p => p.puzzle_type === 'observation').length; return [...Object.entries(cnt).filter(([, n]) => n > 2).map(([k, n]) => `장치 ${k} 를 ${n}번 씀 — 같은 장치는 두 번까지`), ...(obs > 2 ? [`observation 퍼즐 ${obs}개 — 2개 이하`] : [])]; })(),
            // 10/26 미르 플레이 평가: 적게·분명하게·쓰이지 않는 단서 없음·풀면 무엇이 일어남
            ...(() => { const out = []; if (P.length < 4 || P.length > 6) out.push(`퍼즐 ${P.length}개 — 게임 전체 4~6개`); const per = P.reduce((a, p) => (a[p.scene_id] = (a[p.scene_id] || 0) + 1, a), {}); for (const [sc, n] of Object.entries(per)) if (n > 2) out.push(`${sc}: 퍼즐 ${n}개 — 장면마다 1~2개`);
              const SO = ['combine_clues', 'select', 'input', 'solve']; const req = new Set(P.flatMap(p => p.solve?.required_clue_ids || []));
              for (const p of P) { const found = (p.clues || []).filter(c => !SO.includes(c.get_by)); if (found.length > 3) out.push(`${p.puzzle_id}: 찾는 단서 ${found.length}개 — 2~3개`); for (const c of found) if (!req.has(c.clue_id)) out.push(`${c.clue_id}: 어느 퍼즐 풀이에도 쓰이지 않는 단서 — 빼거나 풀이에 쓴다`); }
              const exitOf = p => p.solve?.device?.on === 'exit_door' || (p.success_effects || p.effects || []).some(e => /unlock|exit|case_cleared/.test(String(e.type)));
              const lastId = P[P.length - 1]?.puzzle_id;
              for (const p of P) { if (p.puzzle_id === lastId || exitOf(p)) continue; const gives = (p.success_effects || p.effects || []).filter(e => e.type === 'clue_acquired').map(e => e.target_id); if (!gives.some(id => req.has(id))) out.push(`${p.puzzle_id}: 풀어도 문이 열리지 않고 뒤 퍼즐에 쓰일 단서도 안 나옴 — 결과 단서를 뒤 퍼즐 풀이에 쓰거나 출구 장치로`); }
              for (const p of P) for (const c of p.clues || []) if (/셈법|앞자리|뒷자리|시계 ?방향|칸 돌린|칸을 돌|번째 칸을 누르/.test(`${c.content || ''}`)) out.push(`${c.clue_id}: 단서 글이 퍼즐 조작법을 일러 줌 — 이야기 속 사람이 쓸 글로`);
              return out; })(),
            ...P.filter(p => p.solve?.device?.kind === 'munsal').flatMap(p => { const sp = p.solve.device.spec || {}, R = +sp.rows || 0, C = +sp.cols || 0; const cells = (Array.isArray(p.solve.answer) ? p.solve.answer : String(p.solve.answer || '').split(/[,\s]+/)).filter(Boolean); const bad = cells.filter(x => { const m = /^(\d+)-(\d+)$/.exec(String(x)); return !m || +m[1] < 1 || +m[1] > R || +m[2] < 1 || +m[2] > C; }); return [...(R * C < 9 ? [`${p.puzzle_id}: 문살 무늬판이 작음(9칸 이상)`] : []), ...(bad.length ? [`${p.puzzle_id}: 문살 답 칸이 판 밖이거나 형식이 틀림(${bad.join(',')}) — "행-열"`] : []), ...(cells.length < 3 || cells.length > R * C / 2 ? [`${p.puzzle_id}: 문살 누를 칸은 3칸 이상·절반 이하`] : [])]; }),
            ...P.filter(p => ['maedeup', 'pae', 'buk'].includes(p.solve?.device?.kind)).flatMap(p => { const d = p.solve.device, sp = d.spec || {}; const opts = d.kind === 'maedeup' ? (sp.colors || ['청', '적', '황', '백', '흑']) : d.kind === 'pae' ? (sp.tags || []) : (sp.strokes || ['덩', '쿵', '딱']); const ans = (Array.isArray(p.solve.answer) ? p.solve.answer : String(p.solve.answer || '').split(/[,·\s-]+/)).filter(Boolean).map(String); const need = d.kind === 'buk' ? 4 : d.kind === 'pae' ? Math.max(2, +sp.slots || 0) : 3; // 패는 홈(slots 2~3)만큼 — 10/30 프롬프트 2~3칸과 검사 3개 이상이 어긋나 2칸 패가 늘 걸렸다
              return [...(ans.length < need ? [`${p.puzzle_id}: ${d.kind} 답이 짧음(${need}개 이상)`] : []), ...(d.kind === 'pae' && +sp.slots && ans.length > +sp.slots ? [`${p.puzzle_id}: 패 답 ${ans.length}개 — 홈 ${+sp.slots}칸과 같은 개수로`] : []), ...(ans.some(a => !opts.includes(a)) ? [`${p.puzzle_id}: ${d.kind} 답 「${ans.join('·')}」이 장치 목록(${opts.join('·')})에 없음`] : []), ...(d.kind === 'pae' && (opts.length < 4 || opts.length > 6 || opts.some(t => String(t).length > 5) || new Set(ans).size !== ans.length) ? [`${p.puzzle_id}: 패는 4~6개·이름 5자 이하·답에서 겹치지 않게`] : [])]; }),
            ...P.filter(p => p.solve?.device?.kind === 'geulja' && (p.solve.device.spec?.rings || []).some(r => r.length < 6)).map(p => `${p.puzzle_id}: 글자 바퀴 글자가 적음(바퀴마다 6개 이상)`),
            ...P.filter(p => p.solve?.device?.kind === 'bimil' && (p.solve.device.spec?.knobs || []).some(k => String(k).replace(/\s*장석$/, '').length > 4)).map(p => `${p.puzzle_id}: 비밀자물쇠 장석 이름이 문양이 아니라 문장(답을 장석에 씀)`),
          ...P.filter(p => p.solve?.device?.kind === 'bimil' && (p.solve.device.spec?.knobs || []).length < 4).map(p => `${p.puzzle_id}: 비밀자물쇠 장석이 적음(4개 이상)`),
            ...P.filter(p => p.solve?.device?.kind === 'sangaji' && !/^\d{2,4}$/.test(String(p.solve.answer))).map(p => `${p.puzzle_id}: 산가지 답은 숫자 2~4자리`),
            ...P.filter(p => p.solve?.device?.kind === 'bimil' && !(p.solve.device.spec?.knobs || []).includes(p.solve.answer)).map(p => `${p.puzzle_id}: 비밀자물쇠 답이 장석 목록에 없음`),
            ...P.filter(p => p.solve?.device && p.solve.device.kind !== 'hoesang' && (p.solve.required_clue_ids || []).length < 2).map(p => `${p.puzzle_id}: 장치 답이 단서 하나로 나옴(2개 이상)`),
          ];
          check.fun = [
            ...(types.size < Math.min(3, P.length) ? [`유형이 ${types.size}가지뿐(3가지 이상)`] : []),
            ...(hosts.length && readable / hosts.length > 0.34 ? [`글 새긴 면 호스트 ${readable}/${hosts.length} — 3분의 1 넘음`] : []),
          ];
        }
        // 10/27: 이야기 컷·결말 검사는 05b(storyDirector) 로 옮김 — 여기서는 마지막 장면 출구만
        { const P = (json.puzzles || []).filter(p => p.presentation !== 'ending_cinematic' && p.puzzle_type); const scIds = [...new Set(P.map(p => p.scene_id))]; const last = scIds[scIds.length - 1];
          check.story = P.filter(p => p.scene_id === last && p.solve?.device?.on === 'exit_door').map(p => `${p.puzzle_id}: 마지막 장면 퍼즐에 출구 장치 — 마지막 퍼즐을 풀면 결말로`); }
        return check;
      };
      // 10/26 미르: 「자연스럽게 추론이 가능해야 하는데 중구난방」 — 답을 모르는 풀이 시험 에이전트가 플레이어가 보는 것만 가지고 풀어 본다. 못 풀거나 다른 답이 나오면 고쳐 쓴다
      const SOLVER_SYSTEM = `너는 방탈출 게임을 처음 하는 플레이어다. 정답은 모른다. 아래는 화면에서 보고 읽은 것 전부다(장면별 단서·자국, 장치 모양). 퍼즐마다 이것만으로 답을 낸다. 짐작으로 고른 답·남는 것을 고른 답(소거)은 confidence 를 0.4 이하로, why 에 「소거」라고 적는다. 너무 어렵거나 근거가 없으면 솔직히 적는다.
JSON 만: {"answers":[{"puzzle_id":"PZ-..","answer":"장치에 넣을 값(배열이면 배열)","used":["CL-.."],"confidence":0.0~1.0,"difficulty":1~5,"why":"어떻게 이었는지 한 문장 또는 막힌 곳"}]}`;
      const solve = async (js) => {
        if (local) return [];
        const P = (js.puzzles || []).filter(p => p.presentation !== 'ending_cinematic' && p.puzzle_type);
        const SO = ['combine_clues', 'select', 'input', 'solve'];
        const see = c => { const sh = c.shows ? ` [화면: ${c.shows.kind}${c.shows.count ? ` ${c.shows.count}개` : ''}${c.shows.figure ? ` 실루엣 ${({ woman: '쪽진 머리·넓은 치마의 여인', man: '갓 쓴 남자', child: '작은 아이', elder: '굽은 등·지팡이 노인' })[c.shows.figure] || c.shows.figure}` : ''}${c.shows.cells ? ` 밝은 칸 ${c.shows.cells.join(',')}${c.shows.grid ? ` (${c.shows.grid.join('×')})` : ''}` : ''}]` : ''; return `- ${c.clue_id} ${c.text}${c.content ? ` — ${c.content}` : ''}${sh}`; };
        const scenesIn = [...new Set(P.map(p => p.scene_id))];
        const pack = scenesIn.map(sc => [`## ${sc}`, '[찾은 단서]', ...P.filter(p => p.scene_id === sc).flatMap(p => (p.clues || []).filter(c => !SO.includes(c.get_by)).map(see)),
          '[풀 것]', ...P.filter(p => p.scene_id === sc).map(p => { const d = p.solve?.device; return `- ${p.puzzle_id} ${p.title} — ${p.solve?.prompt || ''} · ${p.solve?.interaction}${d ? ` · 장치 ${d.kind} ${JSON.stringify(d.spec || {})}` : ''}${p.solve?.options ? ` · 선택지 ${JSON.stringify(p.solve.options)}` : ''}${d?.kind === 'hoesang' ? ` · 섞인 기억 조각(차례대로 늘어놓아 answer 는 id 배열): ${JSON.stringify([...(d.spec?.panels || [])].sort((a, b) => String(a.caption).length - String(b.caption).length).map(q => ({ id: q.id, caption: q.caption })))}` : ''}${p.solve?.interaction === 'combine_clues' ? ' · (수첩의 단서 두 개를 짝짓는다 — answer 는 "CL-a+CL-b")' : ''}`; })].join('\n')).join('\n\n');
        let res; try { const text = await llm(root, trial, step, { system: SOLVER_SYSTEM, user: pack }); await writeOut(root, trial, 'raw-s05-solver.txt', text); res = extractJson(text); } catch (e) { return [`풀이 시험 실패: ${String(e.message).slice(0, 120)}`]; }
        const norm = (v, keepDash) => (Array.isArray(v) ? v.map(x => Array.isArray(x) ? x.join('-') : x) /* 10/27: 문살 답을 [[1,2],…]로 내 맞는 답을 틀렸다고 봤다 */ : String(v ?? '').split(keepDash ? /[+,\s]+/ : /[+,·\s-]+/)).map(x => String(x).replace(/\s*장석$/, '').trim()).filter(Boolean);
        const same = (p, a) => { const kd = p.solve?.interaction === 'combine_clues' || p.solve?.device?.kind === 'munsal'; const want = norm(p.solve?.answer, kd), got = norm(a, kd); /* 10/26: 「CL-02-1+CL-02-2」를 - 로도 잘라 맞는 답을 틀렸다고 봤다 */ if (p.solve?.interaction === 'combine_clues' || p.solve?.device?.kind === 'munsal') return want.slice().sort().join() === got.slice().sort().join(); return want.join() === got.join(); };
        const out = [];
        for (const p of P) { if (p.puzzle_type === 'observation' || !p.solve?.answer) continue; const a = (res.answers || []).find(x => x.puzzle_id === p.puzzle_id);
          if (!a) { out.push(`${p.puzzle_id}: 풀이 시험 — 플레이어가 풀지 못함`); continue; }
          if (!same(p, a.answer)) out.push(`${p.puzzle_id}: 풀이 시험 — 단서만 보고 낸 답 ${JSON.stringify(a.answer)} ≠ 정답 ${JSON.stringify(p.solve.answer)} (${String(a.why || '').slice(0, 120)}) — 단서에서 답으로 바로 이어지게`);
          else if ((a.difficulty || 0) >= 4 || (a.confidence ?? 1) < 0.5 || /소거|짐작|찍/.test(String(a.why || ''))) out.push(`${p.puzzle_id}: 풀이 시험 — 맞혔지만 너무 어렵거나 짐작(난이도 ${a.difficulty}, 확신 ${a.confidence}): ${String(a.why || '').slice(0, 120)}`); }
        return out;
      };
      let check = runChecks(json);
      check.solver = await solve(json);
      // 자동 고쳐 쓰기 1회(10/22): 발견 연출·풀이 장치 규칙을 어기면(모델이 장치를 통째로 빠뜨린 일) 문제 목록을 주고 한 번 다시 쓰게 한다
      // 10/23: 고쳐 쓰기를 최대 2번 — 고친 판이 걸린 것이 더 적을 때만 바꿔 든다
      const issues = c => [...(c.reveal || []), ...(c.contract || []), ...(c.solver || []), ...(c.story || [])]; // 10/23: 계약(단서 조합 2개 등)도 같이 — 고쳐 쓰다 계약을 깬 판을 받아들였다
      for (let round = 1; round <= 3 && !local && !reworkIds && issues(check).length; round++) {
        const user2 = ['[01 설화 사실]', factLines(), '', '[04 Scene 구성표]', sceneLines(), '', '[네가 쓴 퍼즐 초안]', JSON.stringify({ puzzles: json.puzzles }), '', '[자동 검사에서 걸린 것 — 모두 고쳐서 전체 JSON 을 다시 써라. 이미 맞는 퍼즐은 그대로 둔다]', ...issues(check).map(x => `- ${x}`)].join('\n');
        const text2 = await llm(root, trial, step, { system: PUZZLE_SYSTEM, user: user2 });
        await writeOut(root, trial, round === 1 ? 'raw-s05-fix.txt' : `raw-s05-fix${round}.txt`, text2);
        const json2 = extractJson(text2);
        if (!json2.__error && (json2.puzzles || []).length) { if (!(json2.cinematics || []).length && (json.cinematics || []).length) json2.cinematics = json.cinematics; const check2 = runChecks(json2); check2.solver = await solve(json2); if (issues(check2).length <= issues(check).length) { check2.repaired = { round, before: check.repaired?.before || issues(check), after: issues(check2) }; json = json2; check = check2; } }
      }
      // 10/27 미르: 3번 고쳐 써도 「여인」이 단서에 없는 채로 남아 그대로 다음 단계로 갔다 — 남은 퍼즐만 따로 꺼내 한 번 더 고치고, 그래도 남으면 unresolved 로 적어 08 검수에서 빨갛게 보인다
      { const pid = x => (/^(PZ-[\w-]+?)(?=:)/.exec(x) || [])[1]; const bad = [...new Set(issues(check).map(pid).filter(Boolean))].filter(id => (json.puzzles || []).some(p => p.puzzle_id === id) && (!reworkIds || reworkIds.has(id)));
        if (bad.length && !local) {
          const sub = (json.puzzles || []).filter(p => bad.includes(p.puzzle_id));
          const user3 = ['[01 설화 사실]', factLines(), '', '[04 Scene 구성표]', sceneLines(), '', '[게임 전체 퍼즐 — 참고만]', JSON.stringify({ puzzles: (json.puzzles || []).map(p => ({ puzzle_id: p.puzzle_id, scene_id: p.scene_id, title: p.title, clue_ids: (p.clues || []).map(c => c.clue_id) })) }), '', '[고칠 퍼즐 — 이 퍼즐들만 고쳐서 {"puzzles":[…]} 로 돌려준다. puzzle_id·scene_id·clue_id 는 그대로, 다른 퍼즐은 쓰지 않는다]', JSON.stringify({ puzzles: sub }), '', '[걸린 것]', ...issues(check).filter(x => bad.includes(pid(x))).map(x => `- ${x}`), '', '고치는 길: 답을 바꾸기보다 단서를 고쳐 답이 「보이게」 한다 — 답 말을 단서 content 에 그대로, 흔적이면 shows 로 그 모습을 그린다.'].join('\n');
          try { const text3 = await llm(root, trial, step, { system: PUZZLE_SYSTEM, user: user3 }); await writeOut(root, trial, 'raw-s05-fix-focus.txt', text3); const j3 = extractJson(text3);
            if (!j3.__error && (j3.puzzles || []).length) { const json3 = { ...json, puzzles: (json.puzzles || []).map(p => (j3.puzzles || []).find(q => q.puzzle_id === p.puzzle_id) || p) }; const check3 = runChecks(json3); check3.solver = await solve(json3); if (issues(check3).length < issues(check).length) { check3.repaired = { round: 'focus', before: check.repaired?.before || issues(check), after: issues(check3) }; json = json3; check = check3; } } } catch (e) { check.focusError = String(e.message).slice(0, 160); } }
        check.unresolved = [...(check.reveal || []), ...(check.solver || [])].filter(x => pid(x)).concat(check.story || []); }
      await writeOut(root, trial, 'puzzle.json', JSON.stringify({ ...json, check, ...(reworkIds ? { rework: { puzzles: [...reworkIds], at: new Date().toISOString() } } : {}) }, null, 2));
      if (reworkIds) await writeFile(reworkF, JSON.stringify({ ...rework, doneAt: new Date().toISOString() }, null, 2));
      return { puzzles: (json.puzzles || []).length, hostNeeds: (json.puzzles || []).reduce((a, p) => a + (p.host_needs || []).length, 0), types: [...new Set((json.puzzles || []).map(p => p.puzzle_type))], ...check };
    }

    if (step.id === 's06') {
      need('01', '04');
      const puzzle = await readJsonOut(root, trial, 'puzzle.json');
      if (!puzzle) fail(409, 'previous_step_missing', '05 퍼즐 초안이 없습니다.');
      const mask = loadMask(root);
      const user = [
        spaceText(space), '', maskSummary(mask, space), '',
        '[01 설화 사실]', factLines(), '', '[04 Scene 구성표]', sceneLines(), '',
        '[05 퍼즐 초안 — host_needs 를 모두 contents 의 puzzle_host 로 받을 것]',
        ...(puzzle.puzzles || []).filter(p => p.presentation === 'ending_cinematic').map(p => `- ${p.puzzle_id} (${p.scene_id}) 결말 연출(ending_cinematic — 공간에 놓지 않음): ${p.summary || p.title || ''}`),
        ...(puzzle.puzzles || []).filter(p => p.presentation !== 'ending_cinematic').map(p => `- ${p.puzzle_id} (${p.scene_id}, ${p.difficulty}) ${p.title}: ${p.how} → ${p.learns}\n${(p.host_needs || []).map(h => `  - ${h.need_id} ${h.kind}: ${h.what} · 예 ${(h.object_examples || []).join('/')} · 장소 ${h.place_hint} × ${h.count || 1}`).join('\n')}`),
      ].join('\n');
      const text = await llm(root, trial, step, { system: SPACE_SYSTEM, user });
      await writeOut(root, trial, 'raw-s06.txt', text);
      const json = extractJson(text);
      if (json.__error) fail(422, 'json_invalid', `JSON 을 읽지 못했습니다: ${json.__error}`);
      const needs = (puzzle.puzzles || []).flatMap(p => (p.host_needs || []).map(h => h.need_id));
      const served = new Set([...(json.contents || []), ...(json.cast || [])].flatMap(c => c.serves || [])); // npc 호스트는 인물(cast)이 맡는다
      const zoneCodes = space.zones.map(z => z.code);
      const problems = [
        ...needs.filter(n => !served.has(n)).map(n => `퍼즐 호스트 없음: ${n}`),
        ...[...(json.contents || []), ...(json.cast || [])].filter(c => c.zone && !zoneCodes.includes(c.zone)).map(c => `없는 구역: ${c.item_id} ${c.zone}`),
        ...[...(json.contents || []), ...(json.environment || [])].filter(c => c.region && !REGION_KINDS[c.region.kind]).map(c => `모르는 영역: ${c.item_id || c.layer_id} ${c.region.kind}`),
      ];
      await writeOut(root, trial, 'spaceplan.json', JSON.stringify({ ...json, check: { problems } }, null, 2));
      return { places: (json.place_map || []).length, contents: (json.contents || []).length, cast: (json.cast || []).length, environment: (json.environment || []).length, problems: problems.length };
    }

    if (step.id === 's07') {
      const plan = await readJsonOut(root, trial, 'spaceplan.json');
      if (!plan) fail(409, 'previous_step_missing', '06 공간 구성이 없습니다.');
      const selections = await selectFor(targetsOf(plan), {}, 'raw-s07.txt');
      await writeOut(root, trial, 'selection2.json', JSON.stringify({ selections }, null, 2));
      return { picked: selections.filter(s => s.picks.length).length, missing: selections.filter(s => !s.picks.length).length };
    }

    if (step.id === 's08') {
      const plan = await readJsonOut(root, trial, 'spaceplan.json');
      const selection = await readJsonOut(root, trial, 'selection2.json');
      if (!plan || !selection) fail(409, 'previous_step_missing', '06 공간 구성·07 에셋 선정이 필요합니다.');
      const mask = loadMask(root);
      maskSummary(mask, space);
      const pickOf = new Map(selection.selections.map(s => [s.item_id, s]));
      // 사람이 「라이브러리에 없음」에서 대체를 고른 것
      for (const [itemId, d] of Object.entries(trial.missingDecisions || {})) if (d.decision === 'substitute' && d.assetId && pickOf.has(itemId)) pickOf.get(itemId).picks = [{ id: d.assetId, nameKo: d.assetName || d.assetId }];
      const discrete = [...(plan.contents || []), ...(plan.cast || []).map(c => ({ ...c, role: 'cast', region: { kind: 'zone', zones: [c.zone] }, arrangement: 'single', count: 1 }))].filter(c => c.role === 'marker' || pickOf.get(c.item_id)?.picks?.length);
      const zoneLine = z => `- ${z.code}: x ${z.x.join('~')}, z ${z.z.join('~')}, EL ${z.elevation} · ${z.physicalName}`;
      const user = [
        '구역(미터, x 동서 · z 남북, z 가 클수록 남쪽 강 쪽):', ...space.zones.map(zoneLine), '', '지형 요소:', ...space.features.map(f => `- ${f.name}: ${f.detail}`), '',
        '낱개 항목:', ...discrete.map(c => `- ${c.item_id} 「${c.name_ko}」 (${c.role}) 구역 ${c.zone} · 영역 ${c.region?.kind} · ${c.arrangement || 'single'} × ${c.count || 1} · 크기 ${(c.size_m || []).join('~')} m · 위치: ${c.position_hint || '-'} · 하는 일/이유: ${c.activity || c.why || ''}`),
      ].join('\n');
      const text = await llm(root, trial, step, { system: LAYOUT2_SYSTEM, user });
      await writeOut(root, trial, 'raw-s08.txt', text);
      const json = extractJson(text);
      if (json.__error) fail(422, 'json_invalid', `JSON 을 읽지 못했습니다: ${json.__error}`);
      await loadDims(pickOf);
      const layout = realize(plan, selection, json.items || [], mask, pickOf);
      await writeOut(root, trial, 'layout2.json', JSON.stringify(layout, null, 2));
      const spots = layout.spots; const selfCheck = layout.selfCheck;
      return { spots: spots.length, discrete: spots.filter(s => s.layer !== 'environment').length, environment: spots.filter(s => s.layer === 'environment').length, failed: selfCheck.failed.length };
    }
    if (step.id === 's09') {
      const plan = await readJsonOut(root, trial, 'spaceplan.json');
      const selection = await readJsonOut(root, trial, 'selection2.json');
      const layout = await readJsonOut(root, trial, 'layout2.json');
      if (!plan || !selection || !layout) fail(409, 'previous_step_missing', '08 배치가 먼저 있어야 합니다.');
      const failed = layout.selfCheck.checks.filter(c => !c.ok && !c.id.startsWith('에셋 없음'));
      const user = [
        '[구역]', ...space.zones.map(z => `- ${z.code} ${z.physicalName} · ${z.surface}`), '',
        '[지금 배경 층 — 계획과 실제 깔린 수]', ...(plan.environment || []).map(e => { const st = layout.envStats.find(x => x.layer_id === e.layer_id); return `- ${e.layer_id} ${e.name_ko} (${e.class}) ${e.region?.kind}${e.region?.zones?.length ? ` ${e.region.zones.join('/')} 근처` : ''} · ${e.density} · ${(e.size_m || []).join('~')} m · ${e.pattern} → ${st ? `${st.placed}개 / 영역 ${st.area} m²` : '에셋 없어 못 깖'}`; }), '',
        '[구역 둘레 실측(구역 사각형에서 12 m 안)]', ...layout.metrics.map(m => `- ${m.zone}: 나무 ${m.tree} · 덤불 ${m.shrub} · 풀·꽃·갈대 ${m.low} · 돌 ${m.rock} · 낱개 물건 ${m.discrete} · 키 큰 덩어리 덮임 ${m.tallCover}%`), '',
        '[자기 검사 실패]', ...(failed.length ? failed.map(c => `- ${c.id}: ${c.detail}`) : ['- 없음']), '',
        '[이야기 분위기]', ...(docs['04']?.json?.scenes || []).map(s => `- ${s.scene_id}: ${s.mood?.base || ''} / ${s.mood?.target_emotion || ''}`),
      ].join('\n');
      const text = await llm(root, trial, step, { system: REVISE_SYSTEM, user });
      await writeOut(root, trial, 'raw-s09.txt', text);
      const json = extractJson(text);
      if (json.__error) fail(422, 'json_invalid', `JSON 을 읽지 못했습니다: ${json.__error}`);
      // 고친 계획 — 이전 판은 남긴다
      const round = (plan.revision || 0) + 1;
      await writeOut(root, trial, `spaceplan.r${round - 1}.json`, JSON.stringify(plan, null, 2));
      const env = new Map((plan.environment || []).map(e => [e.layer_id, { ...e }]));
      for (const ch of json.environment_changes || []) { const e = env.get(ch.layer_id); if (!e) continue; for (const k of ['density', 'region', 'size_m', 'pattern']) if (ch[k] != null) e[k] = ch[k]; e.revised = clip(ch.why, 200); }
      for (const id of json.environment_remove || []) env.delete(id);
      const picks = new Map(selection.selections.map(s => [s.item_id, s]));
      const added = [];
      for (const a of json.environment_add || []) {
        const src = picks.get(a.same_assets_as);
        if (!src?.picks?.length || !a.layer_id || env.has(a.layer_id) || !REGION_KINDS[a.region?.kind] || !CLASSES[a.class]) continue;
        env.set(a.layer_id, { layer_id: a.layer_id, class: a.class, name_ko: a.name_ko || src.name_ko, region: a.region, density: a.density || 'medium', size_m: a.size_m || [1, 2], pattern: a.pattern || 'patchy', why: clip(a.why, 200), added: true });
        selection.selections.push({ ...src, item_id: a.layer_id, name_ko: a.name_ko || src.name_ko, reason: `${a.same_assets_as} 와 같은 에셋(09 추가)` });
        added.push(a.layer_id);
      }
      const nextPlan = { ...plan, environment: [...env.values()], revision: round, revisionNotes: [...(plan.revisionNotes || []), { round, notes: clip(json.notes, 600), at: new Date().toISOString() }] };
      await writeOut(root, trial, 'spaceplan.json', JSON.stringify(nextPlan, null, 2));
      await writeOut(root, trial, 'selection2.json', JSON.stringify(selection, null, 2));
      const mask = loadMask(root); maskSummary(mask, space);
      const pickOf = new Map(selection.selections.map(s => [s.item_id, s]));
      await loadDims(pickOf);
      const next = realize(nextPlan, selection, layout.hints, mask, pickOf);
      next.previous = { spots: layout.spots.length, failed: layout.selfCheck.failed.length };
      await writeOut(root, trial, 'layout2.json', JSON.stringify(next, null, 2));
      return { changed: (json.environment_changes || []).length, added: added.length, removed: (json.environment_remove || []).length, spots: next.spots.length, failedBefore: layout.selfCheck.failed.length, failedAfter: next.selfCheck.failed.length };
    }
    // 코드만 다시 앉히기(LLM 없음, 비용 0) — 앉힘 규칙·마스크를 고친 뒤 같은 계획·선정·자리 힌트로 다시 깐다(10/19)
    if (step.id === 'relayout') {
      const plan = await readJsonOut(root, trial, 'spaceplan.json');
      const selection = await readJsonOut(root, trial, 'selection2.json');
      const layout = await readJsonOut(root, trial, 'layout2.json');
      if (!plan || !selection || !layout) fail(409, 'previous_step_missing', '08 배치가 먼저 있어야 합니다.');
      const n = (layout.relayout || 0) + 1;
      await writeOut(root, trial, `layout2.p${n - 1}.json`, JSON.stringify(layout, null, 2));
      const approved = new Set(Object.entries(trial.feedback || {}).filter(([, f]) => f.verdict === 'approve').map(([id]) => id));
      const locked = layout.spots.filter(s => approved.has(s.itemId));
      const mask = loadMask(root); maskSummary(mask, space);
      const pickOf = new Map(selection.selections.map(x => [x.item_id, x]));
      await loadDims(pickOf);
      const next = realize(plan, selection, layout.hints, mask, pickOf, locked);
      Object.assign(next, { previous: { spots: layout.spots.length, failed: layout.selfCheck.failed.length }, relayout: n, feedbackRound: layout.feedbackRound });
      await writeOut(root, trial, 'layout2.json', JSON.stringify(next, null, 2));
      return { spots: next.spots.length, failed: next.selfCheck.failed, notes: next.notes, rejected: next.envStats.filter(e => Object.keys(e.rejected || {}).length).map(e => ({ id: e.layer_id, placed: e.placed, target: e.target, rejected: e.rejected })) };
    }
    if (step.id === 's10') {
      const plan = await readJsonOut(root, trial, 'spaceplan.json');
      const selection = await readJsonOut(root, trial, 'selection2.json');
      const layout = await readJsonOut(root, trial, 'layout2.json');
      if (!plan || !selection || !layout) fail(409, 'previous_step_missing', '08 배치가 먼저 있어야 합니다.');
      const open = Object.entries(trial.feedback || {}).filter(([, f]) => f.status === 'open').map(([id, f]) => ({ id, ...f }));
      if (!open.length) fail(409, 'no_feedback', '반영할 사람 의견이 없습니다. 항목 판정을 먼저 남겨 주세요.');
      const round = (trial.feedbackRound || 0) + 1;
      await writeOut(root, trial, `spaceplan.h${round - 1}.json`, JSON.stringify(plan, null, 2));
      await writeOut(root, trial, `selection2.h${round - 1}.json`, JSON.stringify(selection, null, 2));
      await writeOut(root, trial, `layout2.h${round - 1}.json`, JSON.stringify(layout, null, 2));
      const of = v => open.filter(f => f.verdict === v);
      const log = [];
      // ① 빼기 — 계획에서 지운다(코드)
      const removeIds = new Set(of('remove').map(f => f.id));
      plan.contents = (plan.contents || []).filter(c => !removeIds.has(c.item_id));
      plan.cast = (plan.cast || []).filter(c => !removeIds.has(c.item_id));
      plan.environment = (plan.environment || []).filter(e => !removeIds.has(e.layer_id));
      if (removeIds.size) log.push(`빼기 ${removeIds.size}`);
      // ② 새로 만들어 — 생성 대기열에 올린다(지금 자리는 임시로 유지)
      trial.generationQueue ||= [];
      for (const f of of('regenerate')) if (!trial.generationQueue.some(q => q.itemId === f.id && q.status === 'queued')) trial.generationQueue.push({ itemId: f.id, name: f.name || f.id, note: f.note, reviewer: f.reviewer, at: new Date().toISOString(), status: 'queued' });
      // ③ 계획부터 다시 — 그 항목만 06 에이전트에게(LLM)
      const replan = of('replan');
      const findItem = id => [...(plan.contents || []), ...(plan.cast || []), ...(plan.environment || [])].find(c => (c.item_id || c.layer_id) === id);
      const reselect = new Set();
      if (replan.length) {
        const user = [spaceText(space), '', '[고칠 항목과 사람 의견]', ...replan.map(f => `- ${JSON.stringify(findItem(f.id) || { item_id: f.id })}\n  의견: ${f.note || '(메모 없음)'}`)].join('\n');
        const text = await llm(root, trial, step, { system: REPLAN_SYSTEM, user });
        await writeOut(root, trial, `raw-s10-replan-r${round}.txt`, text);
        const json = extractJson(text);
        for (const it of json.items || []) {
          const id = it.item_id || it.layer_id; if (!replan.some(f => f.id === id)) continue;
          const lists = [plan.contents, plan.cast, plan.environment];
          for (const list of lists) { const i = (list || []).findIndex(c => (c.item_id || c.layer_id) === id); if (i >= 0) { if (it.drop) list.splice(i, 1); else { list[i] = { ...list[i], ...it, serves: it.serves?.length ? it.serves : list[i].serves, replannedRound: round }; /* 퍼즐 호스트 연결은 의견이 바꾸라 하지 않으면 유지 */ reselect.add(id); } } }
        }
        log.push(`계획 다시 ${replan.length}`);
      }
      // ④ 다른 에셋으로 — 사람이 고른 에셋이면 바로, 아니면 07 에이전트가 그 항목만 다시(의견 반영)
      const notes = {};
      for (const f of of('swap')) {
        const sel = selection.selections.find(x => x.item_id === f.id);
        if (f.assetId && sel) sel.picks = [{ id: f.assetId, nameKo: f.assetName || f.assetId }];
        else { reselect.add(f.id); notes[f.id] = f.note || '지금 고른 에셋이 맞지 않는다. 다른 것을 고른다.'; }
      }
      if (reselect.size) {
        const redo = await selectFor(targetsOf(plan, reselect), notes, `raw-s10-select-r${round}.txt`);
        for (const r of redo) { const i = selection.selections.findIndex(x => x.item_id === r.item_id); if (i >= 0) selection.selections[i] = r; else selection.selections.push(r); }
        log.push(`다시 고름 ${redo.length}`);
      }
      // ⑤ 위치·수량·밀도 — 낱개는 08 에이전트가 그 항목 자리 힌트만, 배경 층은 09 에이전트가 그 층만
      const hints = [...(layout.hints || [])];
      const adjust = of('adjust');
      const adjustDiscrete = adjust.filter(f => (plan.contents || []).some(c => c.item_id === f.id) || (plan.cast || []).some(c => c.item_id === f.id));
      const adjustEnv = adjust.filter(f => (plan.environment || []).some(e => e.layer_id === f.id));
      if (adjustDiscrete.length) {
        const zoneLine = z => `- ${z.code}: x ${z.x.join('~')}, z ${z.z.join('~')}, EL ${z.elevation} · ${z.physicalName}`;
        const items = adjustDiscrete.map(f => findItem(f.id));
        const prev = new Map(layout.spots.filter(s => adjustDiscrete.some(f => f.id === s.itemId)).map(s => [s.itemId, s]));
        const user = ['구역(미터):', ...space.zones.map(zoneLine), '', '고칠 낱개 항목(사람 의견을 반드시 따른다 — 수량을 바꾸라면 count 도 답한다):', ...items.map(c => `- ${c.item_id} 「${c.name_ko}」 구역 ${c.zone} · 영역 ${c.region?.kind} · ×${c.count || 1} · 지금 자리 ${prev.get(c.item_id) ? `(${prev.get(c.item_id).x}, ${prev.get(c.item_id).z})` : '-'} · 의견: ${adjust.find(f => f.id === c.item_id)?.note || '-'}`)].join('\n');
        const text = await llm(root, trial, step, { system: LAYOUT2_SYSTEM.replace('{"items":[{"item_id":"C-01","x":0,"z":0,"rotationY":0,"row_angle":null,"reason":""}]}', '{"items":[{"item_id":"C-01","x":0,"z":0,"rotationY":0,"row_angle":null,"count":null,"reason":""}]}'), user });
        await writeOut(root, trial, `raw-s10-layout-r${round}.txt`, text);
        for (const it of extractJson(text).items || []) {
          const i = hints.findIndex(h => h.item_id === it.item_id); if (i >= 0) hints[i] = it; else hints.push(it);
          if (Number.isFinite(it.count)) { const c = findItem(it.item_id); if (c) c.count = Math.max(1, Math.min(12, it.count)); }
        }
      }
      if (adjustEnv.length) {
        const user = ['[고칠 배경 층과 사람 의견]', ...adjustEnv.map(f => { const e = findItem(f.id); const st = layout.envStats.find(x => x.layer_id === f.id); return `- ${f.id} ${e.name_ko} (${e.class}) ${e.region?.kind} ${(e.region?.zones || []).join('/')} · ${e.density} · ${(e.size_m || []).join('~')} m → 지금 ${st?.placed ?? '?'}개 · 의견: ${f.note || '-'}`; }), '', '이 층들만 고친다(environment_changes 만, 추가·삭제 없이).'].join('\n');
        const text = await llm(root, trial, step, { system: REVISE_SYSTEM, user });
        await writeOut(root, trial, `raw-s10-env-r${round}.txt`, text);
        for (const ch of extractJson(text).environment_changes || []) { const e = findItem(ch.layer_id); if (!e || !adjustEnv.some(f => f.id === ch.layer_id)) continue; for (const k of ['density', 'region', 'size_m', 'pattern']) if (ch[k] != null) e[k] = ch[k]; }
      }
      if (adjust.length) log.push(`위치·수량 ${adjust.length}`);
      // ⑥ 승인 — 그 항목 자리는 그대로 고정. 그 밖은 다시 깐다
      const approved = new Set(Object.entries(trial.feedback || {}).filter(([, f]) => f.verdict === 'approve').map(([id]) => id));
      const locked = layout.spots.filter(s => approved.has(s.itemId));
      const mask = loadMask(root); maskSummary(mask, space);
      const pickOf = new Map(selection.selections.map(x => [x.item_id, x]));
      plan.feedbackRound = round;
      await writeOut(root, trial, 'spaceplan.json', JSON.stringify(plan, null, 2));
      await writeOut(root, trial, 'selection2.json', JSON.stringify(selection, null, 2));
      await loadDims(pickOf);
      const next = realize(plan, selection, hints, mask, pickOf, locked);
      next.previous = { spots: layout.spots.length, failed: layout.selfCheck.failed.length };
      next.feedbackRound = round;
      await writeOut(root, trial, 'layout2.json', JSON.stringify(next, null, 2));
      for (const f of open) Object.assign(trial.feedback[f.id], { status: 'resolved', resolvedRound: round });
      trial.feedbackRound = round;
      trial.feedbackLog ||= [];
      trial.feedbackLog.push({ round, at: new Date().toISOString(), applied: open.map(f => ({ id: f.id, verdict: f.verdict, note: f.note, reviewer: f.reviewer })), summary: log.join(' · ') });
      return { round, applied: open.length, summary: log.join(' · ') || '승인 고정만', spots: next.spots.length, failedAfter: next.selfCheck.failed.length, queued: (trial.generationQueue || []).filter(q => q.status === 'queued').length };
    }
    fail(400, 'unknown_step', step.id);
  };
}

/** 정답 없이 돌리는 자기 검사(설화 상관없이) */
/** {"selections":[ 한 줄에 한 항목 ]} 꼴 답을 줄마다 읽는다 */
function lenientLines(text) {
  const selections = []; const broken = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/,$/, '');
    if (!line.startsWith('{"item_id"')) continue;
    try { selections.push(JSON.parse(line)); } catch { const m = line.match(/"item_id":"([^"]+)"/); if (m) broken.push(m[1]); }
  }
  return { selections, broken, __error: broken.length ? `깨진 줄 ${broken.join(', ')}` : undefined };
}

export function selfCheckV2({ mask, space, plan, selection, spots, facts, notes, envStats, dims = new Map(), puzzleDoc = null, sceneOrder = [] }) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok, detail });
  // ① 걷지 않는 땅이 비었나 — 걷는 곳 둘레·언덕·물가·벼랑 칸 중 3 m 안에 배경이 하나라도 있는 칸의 비율
  const env = spots.filter(s => s.layer === 'environment');
  for (const kind of ['walk_edge', 'hill', 'water_edge', 'cliff_face']) {
    let total = 0, covered = 0;
    for (let k = 0; k < mask.n; k++) {
      if (!inRegionSafe(mask, k, { kind })) continue;
      total++;
      const x = mask.origin[0] + ((k % mask.nx) + 0.5) * mask.cell, z = mask.origin[1] + (Math.floor(k / mask.nx) + 0.5) * mask.cell;
      if (env.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 <= 9)) covered++;
    }
    if (total) add(`덮임:${kind}`, covered / total >= 0.5, `${Math.round((covered / total) * 100)}% (${covered}/${total}칸, 기준 50% 이상)`);
  }
  // ①-2 키 큰 덩어리(2 m 넘는 나무·큰 덤불) — 풀만 깔려도 「덮임」이 통과하던 구멍(10/19). 걷는 곳 둘레·언덕 칸 중 4 m 안에 키 큰 것이 있는 비율
  {
    const tall = spots.filter(s => s.layer === 'environment' && (s.heightM || 0) >= 2);
    let total = 0, covered = 0;
    for (let k = 0; k < mask.n; k++) {
      if (!inRegionSafe(mask, k, { kind: 'walk_edge' }) && !inRegionSafe(mask, k, { kind: 'hill' })) continue;
      total++;
      const x = mask.origin[0] + ((k % mask.nx) + 0.5) * mask.cell, z = mask.origin[1] + (Math.floor(k / mask.nx) + 0.5) * mask.cell;
      if (tall.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 <= 16)) covered++;
    }
    if (total) add('키 큰 덩어리', covered / total >= 0.3, `${Math.round((covered / total) * 100)}% (나무·큰 덤불 ${tall.length}개, 기준 30% 이상 — 야외 공간 테두리를 세우는 높이)`);
  }
  // ①-3 테두리 숲(10/20 미르 원칙: 언덕 외곽·길가 옆이 무성해야 공간이 닫힌다) — 길가 띠·언덕 바깥 칸 중 나무(2 m+) 4 m 안 비율, 덤불·풀 2 m 안 비율
  {
    const tall = spots.filter(s => s.layer === 'environment' && s.cls === 'tree');
    const low = spots.filter(s => s.layer === 'environment' && ['shrub', 'grass', 'flower', 'reed'].includes(s.cls));
    // 수관 덮임 — 칸 가운데가 어떤 나무의 수관(반지름 = 발판 비율 × 키) 안에 드는 칸의 비율
    const crownCover = kind => { let t = 0, c = 0; for (let k = 0; k < mask.n; k++) { if (!inRegionSafe(mask, k, { kind })) continue; t++; const x = mask.origin[0] + ((k % mask.nx) + 0.5) * mask.cell, z = mask.origin[1] + (Math.floor(k / mask.nx) + 0.5) * mask.cell; if (tall.some(s => { const r = (dims.get(s.assetId)?.foot ?? 0.4) * (s.heightM || 5); return (s.x - x) ** 2 + (s.z - z) ** 2 <= r * r; })) c++; } return t ? c / t : 0; };
    for (const [kind, need] of [['walk_edge', 0.7], ['hill_rim', 0.6]]) {
      let total = 0, t4 = 0, l2 = 0;
      for (let k = 0; k < mask.n; k++) {
        if (!inRegionSafe(mask, k, { kind })) continue;
        total++;
        const x = mask.origin[0] + ((k % mask.nx) + 0.5) * mask.cell, z = mask.origin[1] + (Math.floor(k / mask.nx) + 0.5) * mask.cell;
        if (tall.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 <= 16)) t4++;
        if (low.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 <= 4)) l2++;
      }
      if (total) add(`테두리 숲:${kind}`, t4 / total >= need && l2 / total >= 0.5 && crownCover(kind) >= 0.35, `수관 덮임 ${Math.round(crownCover(kind) * 100)}%(기준 35%) · 나무 4 m 안 ${Math.round((t4 / total) * 100)}%(기준 ${need * 100}%) · 덤불·풀 2 m 안 ${Math.round((l2 / total) * 100)}%(기준 50%) · ${total}칸`);
    }
  }
  // ①-4 씬 흐름(10/20) — 씬마다 주 구역 1~2개 · 그 씬 퍼즐 호스트가 그 씬 구역에 · 씬 1 에 뒤 씬 물건이 미리 보이지 않음
  {
    const sz = new Map((plan.scene_zones || []).map(z => [z.scene_id, z.zones || []]));
    for (const [sid, zones] of sz) add(`씬 구역:${sid}`, zones.length <= 2, `${zones.join('·')}${zones.length > 2 ? ' — 한 씬이 구역 3개 이상을 쓰면 공간에서 씬이 읽히지 않는다' : ''}`);
    for (const p of (puzzleDoc?.puzzles || []).filter(p => p.presentation !== 'ending_cinematic')) {
      const zones = sz.get(p.scene_id) || [];
      const hostItems = [...(plan.contents || []), ...(plan.cast || [])].filter(c => (c.serves || []).some(n => (p.host_needs || []).some(h => h.need_id === n)));
      const out = hostItems.filter(c => c.zone && zones.length && !zones.includes(c.zone));
      if (hostItems.length) add(`씬 호스트:${p.puzzle_id}`, !out.length, out.length ? `${p.scene_id} 구역(${zones.join('·')}) 밖: ${out.map(c => `${c.name_ko}(${c.zone})`).join(', ')}` : `${hostItems.length}개 모두 ${zones.join('·')} 안`);
    }
    const early = spots.filter(s => s.layer !== 'environment' && s.scenes && !s.scenes.includes(1)).length;
    const always = spots.filter(s => s.layer !== 'environment' && s.assetId && !s.scenes).length;
    add('씬별 보이기', true, `씬 지정 ${spots.filter(s => s.scenes).length}자리(씬 1 에 숨김 ${early}) · 늘 보임 ${always}자리`);
    const end = (puzzleDoc?.puzzles || []).filter(p => p.presentation === 'ending_cinematic');
    if (end.length) add('결말 연출', true, end.map(p => `${p.scene_id}: ${p.summary || p.title || ''}`).join(' · ').slice(0, 300));
  }
  // ①-5 반복 티(10/20 미르: 같은 간격·같은 돌림·같은 크기로 서 있으면 현실과 괴리) — 3자리 이상인 항목·층마다
  {
    const by = new Map(); for (const s of spots) if (s.assetId) (by.get(s.itemId) || by.set(s.itemId, []).get(s.itemId)).push(s);
    const cv = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return m ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) / m : 0; };
    const bad = [];
    for (const [id, list] of by) {
      if (list.length < 3) continue;
      const rots = new Set(list.map(s => Math.round((s.rotationY || 0) / 5))).size;
      const hs = cv(list.map(s => (s.hf ?? s.heightM) || 1));
      const nn = list.map(a => Math.min(...list.filter(b => b !== a).map(b => Math.hypot(a.x - b.x, a.z - b.z))));
      const why = [rots <= Math.max(1, list.length / 3) ? '돌림 같음' : '', hs < 0.04 ? '크기 같음' : '', list.length >= 4 && cv(nn) < 0.12 ? '간격 같음' : ''].filter(Boolean);
      if (why.length) bad.push(`${id} ${list[0].name || ''}(${list.length}) ${why.join('·')}`);
    }
    add('반복 티', bad.length === 0, bad.length ? bad.slice(0, 8).join(' · ') : '3자리 이상 항목 모두 돌림·크기·간격이 섞여 있음');
  }
  // ② 원문 인물이 다 있나
  const people = (facts?.facts || []).filter(f => f.category === '인물');
  const castIds = new Set(spots.filter(s => s.layer === 'cast').map(s => s.itemId));
  const castPlan = plan.cast || [];
  for (const f of people) {
    const c = castPlan.find(p => (p.basis || []).includes(f.id));
    add(`인물:${f.id}`, Boolean(c && castIds.has(c.item_id)), c ? `${c.name_ko} ${castIds.has(c.item_id) ? '놓임' : '못 놓음(에셋 없음)'}` : `계획에 없음 — ${f.text}`);
  }
  // ③ 퍼즐 호스트가 다 놓였나
  const placed = new Set(spots.map(s => s.itemId));
  for (const c of (plan.contents || []).filter(c => c.role === 'puzzle_host' || c.role === 'marker')) add(`퍼즐호스트:${c.item_id}`, placed.has(c.item_id), `${c.name_ko} (${(c.serves || []).join(',')})${c.role === 'marker' ? ' · 자리 표식' : ''}`);
  // ④ 구역마다 놓인 낱개 물건
  for (const z of space.zones) { const n = spots.filter(s => (s.layer === 'content' || s.layer === 'cast') && s.zone === z.code).length; add(`구역 내용:${z.code}`, n >= 3, `${n}개`); }
  // ⑤ 배경 층이 목표만큼 깔렸나
  for (const e of envStats) add(`배경층:${e.layer_id}`, e.placed >= Math.max(1, e.target * 0.6), `${e.name_ko} ${e.placed}/${e.target}${e.reason ? ' · ' + e.reason : ''}`);
  // ⑥ 땅에 앉음 — 모든 자리를 앉힘 규칙으로 다시 재서 뜨거나 박힌 것(발판 높낮이·물 위·차단물)을 센다(10/19 공중에 뜬 인물·비탈에 박힌 평상)
  {
    const bad = [];
    for (const s of spots) {
      if (!s.assetId) continue;
      const d = dims.get(s.assetId); const h = s.layer !== 'environment' && d?.known ? d.h : (s.heightM || 1);
      const rule = s.rule || seatRule({ cls: s.cls, layer: s.layer });
      const seat = seatSpot(mask, s.x, s.z, { rule, foot: (d?.foot ?? 0.4) * h, h, steep: s.steep, half: s.half || null, rot: s.rotationY || 0 });
      if (!seat.ok || Math.abs((seat.dy || 0) - (s.dy || 0)) > Math.max(0.05, h * 0.1)) bad.push(`${s.itemId} ${s.name || ''} (${s.x},${s.z}) ${seat.ok ? '높이 보정 안 됨' : seat.reason}`);
    }
    add('땅에 앉음', bad.length === 0, bad.length ? `${bad.length}곳 — ${bad.slice(0, 6).join(' · ')}` : `${spots.filter(s => s.assetId).length}곳 모두 규칙대로 앉음(평평한 물건은 고른 바닥, 바위는 낮은 쪽까지 묻힘, 배는 수면, 차단물 안 없음)`);
  }
  for (const n of notes) add(/고정을 풀고/.test(n) ? '승인 자리 옮김' : /넓혀 놓음/.test(n) ? '영역 넓힘' : /^배경 뼈대/.test(n) ? '배경 뼈대' : /결말 연출/.test(n) ? '결말 연출 제외' : '낱개 실패', /고정을 풀고|넓혀 놓음|섞음|결말 연출/.test(n), n);
  const missing = selection.selections.filter(s => !s.picks.length);
  for (const s of missing) add(`에셋 없음:${s.item_id}`, false, `${s.name_ko}`);
  return { checks, failed: checks.filter(c => !c.ok).map(c => c.id) };
}
