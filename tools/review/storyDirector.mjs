// storyDirector.mjs — 05b 장면 연출 에이전트(10/27 미르: 「장면 연출은 따로 떼라」)
//   05 퍼즐이 다 정해진 뒤에 돈다. 공간마다 이야기 컷(intro: 앞에서 알게 된 것 → 이 공간에서 무엇을 왜) · 회상 장면 맞추기 패널 · 결말(새 사실 + 현장 봉인)을 쓰고,
//   컷마다 그림을 맥북 FLUX(mflux, 로컬·무료)로 그린 뒤 Claude 가 그림을 직접 보고 검수한다(얼굴·글자·컷 글과 일치·앞 컷과 같은 집). 걸리면 그 컷만 다시 그린다.
//   컷 글은 맥 기본 한국어 음성(say)으로 읽어 cine/voice_*.m4a 로 둔다(10/27 미르: 「시네마틱 음성 지원」).
//   결과: cinematics.json + 트라이얼 폴더 cine/*.png. 08 이 방 폴더로 옮겨 뷰어에 싣는다.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const SYSTEM = `너는 지역 설화 방탈출 게임 「왜곡」의 장면 연출 에이전트다. 퍼즐은 이미 정해졌다(05). 너는 플레이어가 공간을 넘어갈 때마다 이야기를 읽고, 다음 공간에서 무엇을 왜 풀어야 하는지 알게 하는 이야기 컷과, 한 판을 닫는 결말을 쓴다.
원칙(10/27 미르)
- 한 판의 게임은 하나의 서사로 완결되고, 새로운 사실을 알며 끝난다. 현장에 가야만 확인할 수 있는 마지막 봉인 하나만 완주자에게 제안한다.
- 컷은 공간에서 다음 공간으로 넘어갈 때마다 이야기를 읽게 하고, 다음 공간에서 무엇을 왜 풀어야 하는지 당위를 준다.
- 세계관(사용자 글의 [세계관 요약])을 어기지 않는다 — 현대의 조사관 강도윤이 텔레포트로 현재의 그 장소에 겹친 왜곡 영역에 들어간다(시간 여행 아님). 설화 속 인물에게 「신고」「실종 접수」 같은 현대 행정 말을 쓰지 않는다. 첫 장면은 본부가 감지한 현재의 이상 징후 → 진입 → 이 이야기의 어디가 어긋났나로 연다(10/28 미르: 「신고가 들어왔다는 건 과거 시대에 신고가 들어왔다는 말인가?」).
- 01 설화 사실만 쓴다. U(해석 유보) 항목은 단정하지 않는다. NG(금지 왜곡)는 어기지 않는다. 원문 방언·옛말은 풀어 쓴 지금 말로.
- 퍼즐의 답, 뒤 공간에서 밝혀질 것은 앞 컷에서 말하지 않는다.
쓸 것(JSON 하나)
1) bible — 컷 그림이 서로 이어지게 하는 고정 묘사(영어). {"house":"이 이야기의 주 무대 생김새 한 줄 — 사용자 글의 [시대·무대] 그대로(조선 처갓집이면 tile-roofed hanok with earthen yard, 삼국시대 강가면 Three Kingdoms-era thatched fishing huts below a steep riverside cliff — 삼국시대에 기와집·한옥을 그리지 않는다)","people":{"groom":"…","woman":"…", …}}. 화풍은 코드가 정한다(수묵 만화풍) — 화풍·분위기를 바꾸는 말은 쓰지 않는다. 사람은 어두운 실루엣이나 뒷모습으로 그린다 — 얼굴 없음. 옷차림·머리 모양으로만 구별(예: groom = young man in a white durumagi coat and black gat hat, woman = long loose black hair, plain white hanbok skirt).
   · 한 컷 = 한 화면 한 장면. 물건·건물·옷은 그 시대·무대 것만(조선 민가면 온돌 방·창호, 삼국시대 어촌이면 초가·나룻배·그물) — 현대 물건·서양 가구 없음.
2) cinematics — 장면마다 intro 하나 + 결말 하나.
   - intro: {"scene_id":"scene-0N","kind":"intro","transition":"cine","panels":[2~3개],"goal":"이 공간에서 무엇을 왜 찾는지 한 문장 — 플레이어에게 하는 말"}
     · 첫 장면 = 게임의 시작(플레이어가 누구이고 왜 여기 왔나, 무엇이 어긋나 있나). 다음 장면 = 앞 장면에서 알게 된 것(04 「나갈 때 들고 가는 것」·앞 퍼즐 learns)을 잇고 이 장면의 질문으로 끝난다.
     · 모든 장면 intro 는 이야기 컷(transition "cine")이다(10/27 미르: 「차단막을 넘어갈 때마다 스토리 이해를 돕는 시네마틱」). 새 공간을 둘러보는 연출(공간 훑기)은 게임이 구역에 처음 들어설 때 따로 낸다 — 너는 쓰지 않는다.
     · 회상 장면 맞추기(hoesang)가 있는 장면은 그 회상이 intro 역할 — panels 는 [] 로, goal 만.
   - 결말: {"kind":"ending","panels":[3~4개],"reveal":"이 판을 끝까지 풀어 새로 알게 된 사실 한 문장(01 근거)","left_open":"아직 모르는 것 한 문장(02 결말의 열린 것)","field":{"place":"02 현장 연결의 장소 이름 그대로","seal":"그곳에 가야만 풀리는 마지막 봉인 — 현장에서 무엇을 직접 보고 확인하면 풀리는지 한 문장","question":"현장에서 답할 물음"}}
3) recall — 회상 장면 맞추기 퍼즐의 패널을 다듬는다: [{"puzzle_id":"PZ-..","panels":[…]}]. 패널 id 와 개수·차례(정답)는 그대로 두고 caption·fact_ids·uses·image_prompt 만 고친다.
패널 = {"id":"C1","caption":"40~110자, 1~2문장 — 아래 「대본 쓰기」","fact_ids":["F-.."],"uses":["house","woman"],"image_prompt":"English. ONE moment: place in the house, time of night, light, key objects; people only as dark silhouettes or seen from behind"}
- uses 는 이 컷에 나오는 bible 항목(house 와 people 의 키). 그림 지시문에는 bible 문장을 다시 쓰지 않는다(코드가 붙인다).
- 한 컷 = 한 순간. 글이 말하는 것이 그림에 보여야 한다(달이 해로 바뀌면 하늘의 해가, 여인이 나타나면 여인의 실루엣이).
- 사람(10/27 미르가 「탁월하다」고 한 대청 회상 컷 기준): 컷 그림에서는 사람을 어두운 실루엣·뒷모습으로 그린다. 각색 조건의 「인물 모형 없음」은 3D 공간 이야기다 — 컷에서 사람을 빼라는 뜻이 아니다. bible.people 에 「그리지 않음」을 쓰지 않는다.
- bible 은 짧게: house 20단어 이내(시대 + 지형·건물 생김새만 — 살림·이부자리 금지), people 은 실루엣 생김새(옷·머리)만 — 흔적·물건(이불·신·갓)은 bible 에 쓰지 않는다(쓰면 모든 컷에 같은 물건이 붙는다).
- 컷마다 장소·구도를 바꾼다(11차 1회: 모든 컷이 「마당 전경 + 마루에 편 이부자리」로 같아졌다). 예: 창호지에 비친 그림자 클로즈업 · 하늘의 달이 해로 바뀌는 장면 · 등잔 켠 부엌 안 · 물 고인 곳간 안 · 대문 밖 길 · 디딤돌의 신 클로즈업. 마당 전경은 게임 전체에 한두 번만. 이부자리는 그리지 않는다.
- 그림 생성기는 방 안 살림(이불·상·궤)을 서양식 침대·탁자로 잘못 그린다. 방 안 살림을 크게 그리는 컷은 피하고, 마당·마루·창호·문·하늘의 빛·디딤돌의 신처럼 바깥에서 보이는 것으로 장면을 잡는다.
대본 쓰기(10/27 미르: 「너무 간결하고 어색하고 재미도 없다 — 더 재미있고 말이 되게」). 컷 글은 화면 아래 자막이자 그대로 읽히는 내레이션(음성)이다.
- 말투: 옛이야기를 들려주는 이야기꾼. 「~다」 서술체를 기본으로, 소리 내어 읽었을 때 숨이 자연스럽게 끊기는 길이로. 한 컷 1~2문장.
- 한 intro(2~3컷)는 짧은 한 장면이다: ① 앞에서 알아낸 것을 구체적으로 짚는다(「앞에서 알게 된 그 이름」이 아니라 실제 내용) → ② 지금 서 있는 곳의 구체적인 감각 하나(소리·빛·냄새·물건) → ③ 플레이어가 풀어야 할 의문을 또렷한 물음이나 긴장으로 남긴다(마지막 컷 끝에 「왜?」「누가?」가 생기게).
- 말이 되게: 왜 이 장소로 왔는지, 왜 이것을 풀어야 하는지 인과가 이어져야 한다. 앞뒤 컷·장면과 어긋나는 말, 설명 없이 튀어나오는 인물·물건은 쓰지 않는다. 인물은 처음 나올 때 누구인지(이름·어느 마을·무슨 일을 하는 사람) 밝힌다.
- 재미: 추상 말 대신 장면을 보여 준다. 대비(낮과 밤, 이쪽 마을과 저쪽 마을), 숨은 것을 엿보는 느낌, 짧은 문장과 긴 문장의 리듬. 같은 문형(「~했다. ~했다.」 「~것이다」)을 되풀이하지 않는다.
- 사실과 연출을 가른다: 날씨·빛·소리·플레이어의 움직임과 느낌 같은 분위기 묘사는 자유롭게 쓴다. 설화의 사건·인물·관계·장소 이름은 01 사실에 있는 것만, U 는 「~라고 전한다」「~였을까」처럼 단정하지 않게.
- 인물의 말을 따옴표로 옮기는 것은 01 사실에 그 말이 있을 때만.
- 쓰지 않는 것: 뜻이 모호한 문학 표현(「이야기가 어긋난 자리에 닿았다」), 번역투, 「신비로운」「놀라운」 같은 빈 수식어, 퍼즐 답 누설.
- 형식 예시(내용은 예시일 뿐 — 실제 사실로 쓰지 말 것): 나쁨 「강은 말없이 흐른다. 이 땅의 이야기는 어긋나 있다.」 / 좋음 「물이 빠진 자갈밭에 낡은 나룻배 한 척이 비스듬히 누워 있다. 마을 사람들은 이 배가 밤마다 강을 건넜다고 했다 — 대체 누구를 만나러?」
- goal 은 플레이어에게 하는 한 문장 지시(무엇을 찾아 무엇을 알아내라).
JSON 만 답한다: {"bible":{…},"cinematics":[…],"recall":[…]}`;

const SCRIPT_JUDGE = `너는 「왜곡」 이야기 컷 대본 검수자다(10/27 미르: 「나주 씬1 앞 시네마틱 대본이 이상하다 — 대본 적합성 판단·검증을 추가하라」). 플레이어가 처음 보는 사람이라고 생각하고 대본(컷 글·goal·자막)을 장면 차례대로 읽는다.
점검(걸린 것만 적는다):
S1 처음 보는 사람이 이해하나 — 누가(플레이어/인물)·어디·무엇이 분명. 앞에서 소개하지 않은 인물·대상을 대뜸 「두 사람」「사람이 지워지고」처럼 쓰면 실패.
S2 자연스러운 한국어 — 뜻이 모호한 추상·문학 표현(「이야기가 어긋난 자리에 닿았다」), 번역투, 과장 금지. 소리 내어 읽어 바로 뜻이 통해야 한다.
S3 01 사실과 맞나 — 사실에 없는 장소·인물·인물 속성·사건·목격자를 덧붙이지 않음, U(해석 유보)를 단정하지 않음, NG 를 어기지 않음. 단, 날씨·빛(달빛·노을)·소리·바람·이슬 같은 분위기 묘사와 지금 플레이어(기록 조사자)의 움직임·느낌은 연출이라 S3 실패가 아니다 — 작가에게 허용한 것이다. (현장 봉인의 장소는 02 현장 연결 — 제작팀이 정한 것이라 S3 대상이 아니다. 봉인 글이 원전 사실을 단정할 때만 본다)
S4 누설 — 그 장면 퍼즐의 답이나 뒤 장면에서 밝혀질 것을 미리 말함.
S5 goal 이 그 장면 실제 퍼즐(무엇을 찾나)과 맞나.
S6 흐름 — 앞 장면에서 알게 된 것에서 이 장면 질문으로 자연스럽게 이어지나. 결말은 이 판을 닫고 새 사실을 밝히나.
S7 세계관 — 첫 장면에서 플레이어가 누구이고 왜 여기 왔는지 알 수 있나. [세계관 요약]과 어긋나면 실패: 시간 여행처럼 씀, 설화 속 인물에게 「신고가 들어왔다」「실종 신고」 같은 현대 행정 말, 설화 속 일을 지금 벌어지는 사건처럼 씀, 본부·도윤을 전지·면역으로 씀.
S8 재미·몰입(10/27 미르: 「너무 간결하고 어색하고 재미도 없다」) — 구체적인 장면·감각이 있나, 장면 마지막 컷이 궁금증이나 긴장을 남기나. 설명문투·요약문투, 같은 문형 되풀이, 빈 수식어면 실패.
S9 말이 되나 — 왜 이 장소에 왔고 왜 이것을 풀어야 하는지 인과가 이어지나. 앞뒤 컷과 모순, 소개 없이 튀어나오는 인물·물건, 소리 내어 읽으면 어색한 문장(이 글은 그대로 음성으로 읽힌다)이면 실패.
엄격하게 본다 — 게임 첫 화면에 그대로 나갈 글이다. 모든 컷·goal·자막·reveal 을 하나씩 판정하고, 통과도 까닭을 한 줄 적는다.
특히 첫 장면 첫 컷: 「강은 말없이 흐르는데 이 땅의 이야기는 어긋나 있다」처럼 분위기만 있고 누가 왜 여기 왔는지 없는 글은 S1·S7 실패.
JSON 만: {"items":[{"target":"scene-01 S1-1 | scene-02 goal | ending reveal …","pass":true|false,"fails":["S2"],"why":"한 문장","rewrite":"실패면 그 자리에 그대로 넣을 고친 문장(한 컷 글이면 40~110자 1~2문장, 앞뒤 컷과 이어지게, 이야기꾼 말투)"}]}`;

const JUDGE = `너는 「왜곡」 이야기 컷 그림 검수자다. 그림 한 장과 그 컷 글·고정 묘사를 받는다. 사진에 보이는 것만 판정한다.
점검: F1 사람 얼굴(이목구비)이 또렷이 보임(어두운 실루엣·뒷모습은 괜찮다) · F2 글자·낙관·워터마크가 보임 · F3 컷 글의 주인공(무엇이 — 사람·물건·하늘의 해/달)이 그림에 아예 없음(빛 세기·소품 하나 차이는 통과) · F4 고정 묘사와 어긋남(여인이어야 하는데 남자로 보임, 기와집이어야 하는데 초가) · F5 이야기의 시대·무대(고정 묘사)에 어색한 것이 눈에 띔(서양식 침대·의자·구두·전선·유리창, 삼국시대 이야기에 기와 한옥) — 특히 마당·마루 바닥에 이불·요·방석이 깔려 있으면 반드시 실패(방 밖에 이부자리를 펴지 않는다) · F6 한 장에 여러 칸(만화 페이지)으로 나뉨.
확실하지 않으면 통과시킨다.
JSON 만: {"ok":true|false,"fails":["F1"],"why":"한 문장","fix":"다시 그릴 때 덧붙일 영어 지시(없으면 빈 문자열)"}`;

const STYLE = 'Single full-frame illustration. Korean traditional ink-wash manhwa illustration, muted earthy palette, soft moonlight and lamplight, cinematic wide shot, painterly brush texture, quiet eerie mood, people only as dark silhouettes or seen from behind, no faces, no text, no letters, no watermark.'; // 10/27: 10차(미르가 좋다고 한 대청 회상 컷)와 같은 문구. 「~없음」 목록(침대·가구·이부자리)을 넣으면 그림 생성기가 오히려 그 물건을 그려 모든 컷 마당에 이불이 깔렸다(11차 2~4회)

function run(cmd, args, { cwd, timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd }); let err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${path.basename(cmd)} 시간 초과`)); }, timeoutMs);
    p.stderr.on('data', d => { err += d; }); p.stdout.on('data', () => {});
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', c => { clearTimeout(t); c === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} 실패(${c}): ${err.slice(-400)}`)); });
  });
}
const exists = f => fs.access(f).then(() => true, () => false);
const h8 = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const safe = s => String(s).replace(/[^\w-]/g, '');

/** 컷 목록 — 검수 페이지·05b 가 같은 열쇠(key)를 쓴다: intro:scene-0N|컷id · ending|컷id · recall:PZ|컷id */
export function panelRefs(doc) {
  const out = [];
  for (const c of doc.cinematics || []) { const sec = c.kind === 'ending' ? 'ending' : `intro:${c.scene_id}`; const tag = c.kind === 'ending' ? 'ending' : `intro-${c.scene_id}`; (c.panels || []).forEach((q, k) => out.push({ key: `${sec}|${q.id || k}`, section: sec, tag, q, k, c })); }
  for (const r of doc.recall || []) (r.panels || []).forEach((q, k) => out.push({ key: `recall:${r.puzzle_id}|${q.id || k}`, section: `recall:${r.puzzle_id}`, tag: r.puzzle_id, q, k, c: r }));
  return out;
}
/** 그림 생성 문구 — 고정 화풍 + 집·인물 고정 묘사 + 컷 지시 */
export function promptFor(bible, q) { const people = (bible || {}).people || {}; return [STYLE, (q.uses || []).includes('house') || !(q.uses || []).length ? `The house: ${(bible || {}).house || ''}` : '', ...(q.uses || []).filter(u => people[u]).map(u => `${u}: ${people[u]}`), `Scene: ${q.image_prompt || q.caption || ''}`].filter(Boolean).join(' '); }
export { STYLE };

/** 컷 글 → 음성 파일(macOS say + afconvert). 파일 이름에 글·목소리 해시 — 글이 바뀌면 새로 만든다 */
async function makeVoices({ out, dir, notes }) {
  const list = await new Promise(res => { const p = spawn('say', ['-v', '?']); let o = ''; p.stdout.on('data', d => { o += d; }); p.on('error', () => res('')); p.on('close', () => res(o)); });
  const ko = list.split('\n').filter(l => /\bko[_-]KR\b/.test(l)).map(l => l.replace(/\s+ko[_-]KR.*$/, '').trim()).filter(Boolean);
  const want = process.env.TTS_VOICE; const name = (want && ko.includes(want) && want) || ko.find(v => /Yuna.*(Premium|Enhanced|고품질)/i.test(v)) || ko.find(v => /Yuna/i.test(v)) || ko[0];
  if (!name) { notes.push('한국어 음성(say -v ?)을 찾지 못함 — 음성 없이 글만'); return null; }
  const rate = String(Number(process.env.TTS_RATE) || 175);
  const panels = [...(out.cinematics || []).flatMap(c => c.panels || []), ...(out.recall || []).flatMap(r => r.panels || [])];
  let made = 0, failed = 0;
  for (const q of panels) {
    const text = String(q.caption || '').trim(); if (!text) continue;
    const base = `voice_${safe(q.id)}_${h8(text + name + rate)}`; const m4a = path.join(dir, `${base}.m4a`), aiff = path.join(dir, `${base}.aiff`);
    try {
      if (!(await exists(m4a))) { await run('say', ['-v', name, '-r', rate, '-o', aiff, text], { timeoutMs: 60000 }); await run('afconvert', ['-f', 'm4af', '-d', 'aac', aiff, m4a], { timeoutMs: 60000 }); await fs.rm(aiff, { force: true }); }
      q.voice = `${base}.m4a`; made++;
    } catch (e) { failed++; notes.push(`${q.id}: 음성 만들기 실패 — ${String(e.message).slice(0, 120)}`); }
  }
  return { engine: 'macos-say', name, rate: Number(rate), made, failed };
}

/** 검사 — 고칠 것 목록 */
export function checkDirector(out, { facts, d02, puzzles, indoor = false }) {
  const bad = []; const C = out.cinematics || [];
  const fid = new Set([...(facts?.facts || []), ...(facts?.open || [])].map(f => f.id));
  const P = (puzzles || []).filter(p => p.presentation !== 'ending_cinematic' && p.puzzle_type);
  const scIds = [...new Set(P.map(p => p.scene_id))];
  const bibleKeys = new Set(['house', ...Object.keys(out.bible?.people || {})]);
  const places = (d02?.field_link || []).map(f => String(f.place || '').trim()).filter(Boolean);
  const pan = (tag, ps) => { for (const q of ps || []) {
    if (!String(q.id || '').trim()) bad.push(`${tag}: 컷 id 없음 — 컷마다 id(S1-1, E1 …)`); /* 13차: id 없는 컷이 그림 파일 이름에 undefined 로 남음 */
    const c = String(q.caption || ''); if (c.length < 25 || c.length > 130) bad.push(`${tag} ${q.id}: 컷 글 ${c.length}자 — 40~110자`);
    if (!/[a-z]{3}/i.test(String(q.image_prompt || ''))) bad.push(`${tag} ${q.id}: image_prompt(영어) 없음`);
    const bf = (q.fact_ids || []).filter(f => !fid.has(f)); if (!(q.fact_ids || []).length || bf.length) bad.push(`${tag} ${q.id}: fact_ids 가 01 사실이 아님(${bf.join(',') || '없음'})`);
    const bu = (q.uses || []).filter(u => !bibleKeys.has(u)); if (bu.length) bad.push(`${tag} ${q.id}: uses 에 bible 에 없는 키(${bu.join(',')})`);
  } };
  if (!out.bible?.house) bad.push('bible.house 없음 — 컷끼리 같은 집으로 이어지지 않는다');
  { const all = [...C.flatMap(c => c.panels || []), ...(out.recall || []).flatMap(r => r.panels || [])]; const bed = all.filter(q => /bedding|quilt|mattress|futon|\byo\b/i.test(String(q.image_prompt || ''))).map(q => q.id); if (bed.length > 1) bad.push(`이부자리를 그리는 컷 ${bed.length}개(${bed.join(',')}) — 그리지 않는다(서양식 침대로 나온다)`);
    const wide = all.filter(q => /courtyard|yard/i.test(String(q.image_prompt || '')) && /wide|whole|overview|establishing/i.test(String(q.image_prompt || ''))).map(q => q.id); if (wide.length > 2) bad.push(`마당 전경 컷 ${wide.length}개(${wide.join(',')}) — 두 개까지, 나머지는 다른 장소·구도로`);
    if (/bedding|quilt|mattress|\byo\b|sleeping/i.test(String(out.bible?.house || ''))) bad.push('bible.house 에 이부자리 — 넣으면 모든 컷에 이불이 깔린다'); const bp = JSON.stringify(out.bible?.people || {}); if (/bedding|quilt|shoe|hat|gat|straw|sash|footprint/i.test(bp)) bad.push('bible.people 에 물건·흔적이 들어 있음 — 실루엣 생김새만'); }
  for (const sc of scIds) {
    const it = C.find(c => c.kind === 'intro' && c.scene_id === sc); const hasRecall = P.some(p => p.scene_id === sc && p.solve?.device?.kind === 'hoesang');
    if (!it) { bad.push(`${sc}: 이야기 컷(intro) 없음 — 이 공간에서 무엇을 왜 푸는지`); continue; }
    if (!String(it.goal || '').trim()) bad.push(`${sc}: intro goal(무엇을 왜) 없음`);
    const n = (it.panels || []).length; void indoor;
    if ((it.transition || 'cine') !== 'cine') bad.push(`${sc}: 장면 intro 는 모두 이야기 컷(transition "cine") — 막을 넘을 때마다 이야기를 들려준다`);
    if (!hasRecall && (n < 2 || n > 3)) bad.push(`${sc}: intro 컷 ${n}개 — 2~3개`); if (hasRecall && n) bad.push(`${sc}: 회상 장면이 있는 장면은 intro panels 를 [] 로`);
    pan(`${sc} intro`, it.panels);
  }
  const en = C.find(c => c.kind === 'ending');
  if (!en) bad.push('결말 컷(ending) 없음 — 새로 알게 된 사실 + 현장 봉인으로 마무리');
  else {
    const n = (en.panels || []).length; if (n < 3 || n > 4) bad.push(`결말 컷 ${n}개 — 3~4개`); pan('ending', en.panels);
    if (!String(en.reveal || '').trim()) bad.push('결말 reveal(새로 알게 된 사실) 없음');
    if (!en.field?.place || !en.field?.seal) bad.push('결말 field(현장 장소·봉인) 없음');
    else if (places.length && !places.includes(String(en.field.place).trim())) bad.push(`결말 현장 「${en.field.place}」이(가) 02 현장 연결(${places.join(', ')})에 없음`);
  }
  for (const p of P.filter(p => p.solve?.device?.kind === 'hoesang')) {
    const r = (out.recall || []).find(x => x.puzzle_id === p.puzzle_id); const want = (p.solve.device.spec?.panels || []).map(q => String(q.id));
    if (!r) { bad.push(`${p.puzzle_id}: 회상 패널(recall) 없음`); continue; }
    const got = (r.panels || []).map(q => String(q.id)); if (got.join() !== want.join()) bad.push(`${p.puzzle_id}: 회상 패널 id·차례는 05 그대로(${want.join(',')})`);
    pan(`${p.puzzle_id} recall`, r.panels);
  }
  return bad;
}

export async function runDirector({ root, trial, step, docs, readJsonOut, writeOut, extractJson, llm, fail, trialDirOf, notes = [] }) {
  const facts = docs['01']?.json, d02 = docs['02']?.json || {}, scenes = docs['04']?.json?.scenes || [];
  if (!facts || !scenes.length) fail(409, 'previous_step_missing', '01·04 결과가 없습니다.');
  const puzzleDoc = await readJsonOut(root, trial, 'puzzle.json').catch(() => null);
  if (!puzzleDoc?.puzzles?.length) fail(409, 'previous_step_missing', '05 퍼즐 초안이 없습니다.');
  const P = puzzleDoc.puzzles.filter(p => p.presentation !== 'ending_cinematic' && p.puzzle_type);
  const factLines = [...(facts.facts || []).map(f => `- ${f.id} [${f.category}] ${f.text}`), ...(facts.open || []).map(f => `- ${f.id} [해석 유보] ${f.text || f.issue || ''}${f.rule ? ` — ${f.rule}` : ''}`), ...(facts.ng || []).map(f => `- ${f.id} [금지 왜곡] ${f.text || f.change || ''}`)].join('\n');
  const orderLines = (facts.order || []).map(o => `${o.seq}. ${o.event} [${(o.facts || []).join(',')}]`).join('\n');
  const sceneLines = scenes.map(s => [`## ${s.scene_id} · ${s.title || ''} — ${s.purpose || ''}`, `- 질문: ${(s.questions || []).join(' / ')}`, s.exit?.carry_info?.length ? `- 나갈 때 들고 가는 것: ${s.exit.carry_info.join(' / ')}` : '',
    ...P.filter(p => p.scene_id === s.scene_id).map(p => `- 퍼즐 ${p.puzzle_id} 「${p.title}」(${p.solve?.device?.kind || p.solve?.interaction}) → 풀면 알게 되는 것: ${p.learns || ''}${p.solve?.device?.kind === 'hoesang' ? `\n  · 회상 장면 맞추기 — 05 패널(차례대로): ${(p.solve.device.spec?.panels || []).map(q => `${q.id} 「${q.caption}」[${(q.fact_ids || []).join(',')}]`).join(' / ')}` : ''}`)].filter(Boolean).join('\n')).join('\n\n');
  const endLines = ['- 결말 상태: ' + (d02.ending?.final_state || ''), '- 마지막 그림: ' + (d02.ending?.last_image || ''), '- 열린 채 남는 것: ' + (d02.ending?.left_open || ''), ...(d02.field_link || []).map(f => `- 현장: ${f.place} · 물음 「${f.online_question || ''}」 · 현장에서 볼 것: ${f.onsite || ''}`)].join('\n');
  // 장면마다 「이 intro 에서 말해도 되는 것 / 아직 말하면 안 되는 것」(10/27: 앞 장면 퍼즐 답은 써도 되고, 이 장면·뒤 장면 퍼즐이 밝힐 것은 누설)
  const scOrder = scenes.map(s => s.scene_id);
  const learnsOf = sid => P.filter(p => p.scene_id === sid).map(p => `${p.puzzle_id}: ${p.learns || p.title || ''}`);
  const knowLines = scOrder.map((sid, i) => [`## ${sid} intro 를 쓸 때`, `- 말해도 되는 것(앞 장면에서 플레이어가 이미 알아냄): ${scOrder.slice(0, i).flatMap(learnsOf).join(' / ') || '없음 — 각색 조건(플레이어가 누구, 왜 왔나)과 이 장면의 겉모습·물음만'}`, `- 아직 말하면 안 되는 것(이 장면부터 퍼즐이 밝힐 것 — 물음으로만 던진다): ${scOrder.slice(i).flatMap(learnsOf).join(' / ') || '없음'}`].join('\n')).join('\n\n');
  const world = await fs.readFile(path.join(root, 'tools/review/world_brief.md'), 'utf8').catch(() => '');
  const adapt = trial.adaptation?.text ? `\n\n[각색 조건 — 제작팀 방침, 원전 사실 아님]\n${trial.adaptation.text}` : '';
  const eras = [...new Set(scenes.flatMap(s => (s.space_reqs || []).map(r => r.era)).filter(Boolean))]; const settings = [...new Set(scenes.flatMap(s => (s.space_reqs || []).flatMap(r => r.setting || [])))];
  const user = [`[시대·무대] 시대: ${eras.join(', ') || '01 사실에서'} · 무대: ${settings.join(', ') || '04 장면에서'}`, '', '[01 설화 사실]', factLines, '', '[01 사건 순서]', orderLines, '', '[04 장면 + 05 퍼즐]', sceneLines, '', '[02 결말 · 현장 연결]', endLines, '', '[장면별로 말해도 되는 것 · 아직 말하면 안 되는 것 — 반드시 지킨다]', knowLines].join('\n') + adapt + (world ? `\n\n[세계관 요약 — 반드시 지킨다]\n${world}` : '');

  let out = extractJson(await llm(root, trial, step, { system: SYSTEM, user }));
  if (out.__error) fail(422, 'json_invalid', `JSON 을 읽지 못했습니다: ${out.__error}`);
  let bad = checkDirector(out, { facts, d02, puzzles: P, indoor: trial.spaceKind === 'indoor' }); const before = bad.slice();
  for (let r = 1; r <= 2 && bad.length; r++) {
    const o2 = extractJson(await llm(root, trial, step, { system: SYSTEM, user: `${user}\n\n[네가 쓴 것]\n${JSON.stringify(out)}\n\n[자동 검사에서 걸린 것 — 모두 고쳐 전체 JSON 을 다시 써라]\n${bad.map(x => `- ${x}`).join('\n')}` }));
    if (!o2.__error) { const b2 = checkDirector(o2, { facts, d02, puzzles: P, indoor: trial.spaceKind === 'indoor' }); if (b2.length <= bad.length) { out = o2; bad = b2; } }
  }
  // 대본 검수 — 다른 눈(검수자)이 플레이어처럼 읽고 걸린 것만 고쳐 쓴다(2번까지)
  // 회상 장면 맞추기가 있는 장면은 회상 패널이 intro 역할 — 검수자에게 함께 보여 준다(12차: 「scene-02 intro 컷이 없다」 오탐)
  const recallOf = (o, sid) => (o.recall || []).filter(r => P.some(p => p.puzzle_id === r.puzzle_id && p.scene_id === sid)).flatMap(r => (r.panels || []).map(q => `${r.puzzle_id} ${q.id}(회상 — 이 장면 intro 역할, 플레이어가 차례를 맞춘다): ${q.caption}`));
  const scriptOf = o => (o.cinematics || []).map(c => [`## ${c.kind === 'ending' ? 'ending' : c.scene_id} (${c.transition || ''})`, c.goal ? `goal: ${c.goal}` : '', c.sweep_line ? `자막: ${c.sweep_line}` : '', ...(c.kind === 'intro' && !(c.panels || []).length ? recallOf(o, c.scene_id) : []), ...(c.panels || []).map(q => `${q.id}: ${q.caption} [${(q.fact_ids || []).join(',')}]`), c.reveal ? `reveal: ${c.reveal}` : '', c.left_open ? `left_open: ${c.left_open}` : '', c.field ? `현장 봉인: ${c.field.place} — ${c.field.seal}` : ''].filter(Boolean).join('\n')).join('\n\n');
  const review = async o => { try { const v = extractJson(await llm(root, trial, { ...step, maxTokens: 6000, effort: 'low' }, { system: SCRIPT_JUDGE, user: ['[01 설화 사실]', factLines, '', '[04 장면 + 05 퍼즐]', sceneLines, '', '[장면별로 말해도 되는 것 · 아직 말하면 안 되는 것 — S4 판정 기준]', knowLines, adapt, '', '[세계관 요약 — S7 판정 기준]', world, '', '[대본]', scriptOf(o)].join('\n') })); await writeOut(root, trial, 'raw-s05b-script.json', JSON.stringify(v, null, 1)).catch(() => {}); if (v.__error) return [{ target: '대본 검수', fails: ['ERR'], why: '검수 답을 읽지 못함', rewrite: '' }].slice(0, 0); return (v.items || v.issues || []).filter(x => x.pass === false || (x.pass == null && (x.fails || []).length)); } catch (e) { notes.push(`대본 검수 실패: ${String(e.message).slice(0, 120)}`); return []; } };
  // 검수자가 고친 문장을 걸린 자리에만 그대로 넣는다(전체를 다시 쓰게 하면 잘 맞던 컷까지 흔들렸다) → 다시 검수
  const applyRewrites = (o, items) => { const c2 = JSON.parse(JSON.stringify(o)); let n = 0;
    for (const it of items) { const rw = String(it.rewrite || '').trim(); if (!rw) continue; const t = String(it.target || ''); const sc = (t.match(/scene-0\d/) || [])[0]; const isEnd = /^ending/.test(t);
      const C = (c2.cinematics || []).find(c => isEnd ? c.kind === 'ending' : c.kind === 'intro' && c.scene_id === sc) || (sc ? null : null);
      const R = !C && sc ? null : null; void R;
      if (!C) { for (const r of c2.recall || []) for (const q of r.panels || []) if (t.includes(` ${q.id}`) || t.endsWith(q.id)) { q.caption = rw; n++; } continue; }
      if (/goal/.test(t)) { C.goal = rw; n++; continue; }
      if (/자막|sweep/.test(t)) { C.sweep_line = rw; n++; continue; }
      if (/reveal/.test(t)) { C.reveal = rw; n++; continue; }
      if (/left_open|아직 모르는/.test(t)) { C.left_open = rw; n++; continue; }
      if (/봉인|seal|field/.test(t) && C.field) { C.field.seal = rw; n++; continue; }
      const q = (C.panels || []).find(q => t.includes(` ${q.id}`) || t.endsWith(q.id)); if (q) { q.caption = rw; n++; } }
    return { o: c2, n }; };
  // 걸린 줄만 갈아 끼우면(11차~나주 1회) 앞뒤가 끊겨 오히려 더 어색해졌다 → 걸린 장면을 작가가 장면 단위로 다시 쓴다(id·컷 수·그림 지시는 유지), 검수가 줄면 받는다
  const rewriteScenes = async (o, items) => {
    const keys = [...new Set(items.map(x => (String(x.target || '').match(/scene-0\d|ending/) || [])[0]).filter(Boolean))];
    if (!keys.length) return null;
    const pick = (o.cinematics || []).filter(c => keys.includes(c.kind === 'ending' ? 'ending' : c.scene_id));
    const v = extractJson(await llm(root, trial, step, { system: SYSTEM, user: `${user}\n\n[지금 대본 전체 — 앞뒤 흐름 참고]\n${scriptOf(o)}\n\n[대본 검수에서 걸린 것]\n${items.map(x => `- ${x.target} [${(x.fails || []).join(',')}] ${x.why || ''}`).join('\n')}\n\n[다시 쓸 장면 — 이 JSON 의 글(caption·goal·reveal·left_open·field.seal)만 고쳐 같은 모양으로 돌려준다. 컷 id·개수는 그대로, fact_ids 는 글에 맞게, image_prompt 는 글이 그림과 어긋날 때만 고친다. 걸린 줄만이 아니라 장면을 한 편으로 읽히게 다시 쓴다]\n${JSON.stringify({ cinematics: pick })}\n\nJSON 만: {"cinematics":[…]}` }));
    if (v.__error || !Array.isArray(v.cinematics)) return null;
    const o2 = JSON.parse(JSON.stringify(o));
    for (const nc of v.cinematics) {
      const c = (o2.cinematics || []).find(x => nc.kind === 'ending' ? x.kind === 'ending' : x.scene_id === nc.scene_id && x.kind === 'intro'); if (!c) continue;
      for (const k of ['goal', 'reveal', 'left_open']) if (typeof nc[k] === 'string' && nc[k].trim()) c[k] = nc[k];
      if (c.field && nc.field?.seal) c.field.seal = nc.field.seal;
      for (const nq of nc.panels || []) { const q = (c.panels || []).find(x => x.id === nq.id); if (!q) continue; for (const k of ['caption', 'fact_ids', 'image_prompt']) if (nq[k]) q[k] = nq[k]; }
    }
    return o2;
  };
  let script = await review(out); const scriptBefore = script.length; const scriptRounds = [scriptBefore];
  for (let r = 1; r <= 3 && script.length; r++) {
    const o2 = await rewriteScenes(out, script); if (!o2) break;
    const b2 = checkDirector(o2, { facts, d02, puzzles: P, indoor: trial.spaceKind === 'indoor' }); if (b2.length > bad.length) { notes.push(`대본 다시 쓰기 ${r}회: 자동 검사 ${b2.length}건으로 늘어 버림`); continue; }
    const s2 = await review(o2); scriptRounds.push(s2.length); if (s2.length < script.length) { out = o2; bad = b2; script = s2; }
  }
  void applyRewrites;

  // 그림 — 10/28 미르: 「그림을 보고 검수·선택·미세 조정·반려는 클로드가 아니라 사람이」 → 컷마다 후보를 CINE_CANDIDATES 장(기본 2) 그려 두고 사람 검수(검수 페이지 「이야기 컷 검수」)를 기다린다.
  //   Claude 그림 검수는 CINE_AI_JUDGE=1 일 때만(기본 끔). 첫 후보를 임시로 싣고, 사람 결정(고른 그림·승인·반려)은 글·그림 지시가 같으면 다시 돌아도 이어받는다
  const bin = process.env.MFLUX_BIN || path.join(process.env.HOME || '', 'flux-test/.venv/bin/mflux-generate-flux2');
  const haveBin = await exists(bin);
  const dir = path.join(trialDirOf(root, trial.id), 'cine'); await fs.mkdir(dir, { recursive: true });
  const bible = out.bible || {};
  const NC = Math.max(1, Math.min(4, Number(process.env.CINE_CANDIDATES) || 2)); const AI_JUDGE = process.env.CINE_AI_JUDGE === '1';
  const prev = await readJsonOut(root, trial, 'cinematics.json').catch(() => null); const prevBy = new Map(); for (const x of panelRefs(prev || {})) prevBy.set(x.key, x.q);
  // 10/29 미르: 공간 검수로 퍼즐 일부만 다시 설계했으면(puzzle.json rework) 그 퍼즐의 장면만 새 컷 — 나머지 장면·결말은 사람이 검수한 컷을 그대로 둔다
  if (puzzleDoc?.rework?.puzzles?.length && !puzzleDoc.rework.cineDone && prev?.cinematics?.length) {
    const affected = new Set(P.filter(p => puzzleDoc.rework.puzzles.includes(p.puzzle_id)).map(p => p.scene_id));
    const lastId = [...scenes].sort((a, b) => (a.order || 0) - (b.order || 0)).pop()?.scene_id;
    out.cinematics = (out.cinematics || []).map(c => { const keepIt = c.kind === 'ending' ? !affected.has(lastId) : !affected.has(c.scene_id); if (!keepIt) return c; const pc = prev.cinematics.find(x => x.kind === c.kind && (c.kind === 'ending' || x.scene_id === c.scene_id)); return pc ? JSON.parse(JSON.stringify(pc)) : c; });
    notes.push(`퍼즐 일부 다시 설계(${puzzleDoc.rework.puzzles.join(', ')}) — 새 컷은 ${[...affected].join(', ')} 장면만, 나머지는 검수한 컷 유지`);
    await writeOut(root, trial, 'puzzle.json', JSON.stringify({ ...puzzleDoc, rework: { ...puzzleDoc.rework, cineDone: new Date().toISOString() } }, null, 2));
  }
  const jobs = panelRefs(out);
  const judged = { candidates: 0, carried: 0, failed: 0, aiJudge: AI_JUDGE };
  if (!haveBin) notes.push(`그림 생성기(mflux)를 찾지 못함(${bin}) — 글만`);
  for (const { key, tag, q, k } of jobs) {
    const old = prevBy.get(key);
    if (old && old.caption === q.caption && old.image_prompt === q.image_prompt && (old.candidates || []).length) { q.candidates = old.candidates; q.img = old.img; q.review = old.review || { status: 'pending' }; judged.carried++; continue; }
    q.candidates = []; q.review = { status: 'pending' };
    if (!haveBin) continue;
    const prompt = promptFor(bible, q);
    for (let t = 0; t < NC; t++) {
      const seed = 11 + k + t * 100; const file = `cine_${safe(tag)}_${safe(q.id)}_${h8(prompt + seed)}.png`; const f = path.join(dir, file);
      if (!(await exists(f))) { try { await run(bin, ['--model', 'flux2-klein-4b', '--prompt', prompt, '--steps', '4', '--width', '1024', '--height', '576', '--seed', String(seed), '--output', f], { cwd: dir }); } catch (e) { judged.failed++; notes.push(`${tag} ${q.id}: 그림 생성 실패 — ${String(e.message).slice(0, 140)}`); continue; } }
      q.candidates.push(file); judged.candidates++;
    }
    q.img = q.candidates[0];
    if (AI_JUDGE && q.img) { /* 예전 방식 참고용 — 사람 검수가 기본 */
      try { const small = path.join(dir, q.img.replace(/\.png$/, '_s.jpg')); await run('sips', ['-s', 'format', 'jpeg', '-Z', '640', path.join(dir, q.img), '--out', small], { timeoutMs: 30000 }).catch(() => {});
        const v = extractJson(await llm(root, trial, { ...step, maxTokens: 1500, effort: 'low' }, { system: JUDGE, user: [{ type: 'text', text: `[컷 글] ${q.caption}\n[그림 지시] ${q.image_prompt}` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: (await fs.readFile(small)).toString('base64') } }] }));
        if (!v.__error) q.aiReview = { ok: !!v.ok, fails: v.fails || [], why: v.why || '' }; } catch { /* 참고용 */ } }
  }
  // 목소리(10/27 미르: 「시네마틱 음성 지원」) — 컷 글을 맥 기본 한국어 음성(say)으로 읽어 m4a 로. 로컬·무료. 없으면 글만
  // 10/27 미르: 「지금 음성은 쓸 수 없다(나이 든 남성 음성이 아니면) — 우선 꺼 두자」 → 기본 끔. TTS_ON=1 일 때만 만든다
  const voice = process.env.TTS_ON === '1' ? await makeVoices({ out, dir, notes }) : null;
  const doc = { ...out, voice, check: { script: { before: scriptBefore, rounds: scriptRounds, after: script }, issues: bad, before: before.length !== bad.length ? before : undefined, images: judged, notes }, humanReview: prev?.humanReview || [] };
  await writeOut(root, trial, 'cinematics.json', JSON.stringify(doc, null, 2));
  // 10/28 미르: 마지막 방의 「진상 복원」 장치 — 결말이 정해진 뒤 한 번 더(실패해도 05b 는 성공)
  try { const { makeFinale } = await import(new URL(`./finale.mjs?t=${Date.now()}`, import.meta.url).href); await makeFinale(root, trial.id, async (system, user) => llm(root, trial, { ...step, maxTokens: 4000, effort: 'low' }, { system, user })); notes.push('마지막 장치(진상 복원) 만듦'); }
  catch (e) { notes.push(`마지막 장치 실패 — ${String(e.message || e).slice(0, 160)}`); }
  return { script: `${scriptBefore}→${script.length}`, intros: (out.cinematics || []).filter(c => c.kind === 'intro').length, ending: !!(out.cinematics || []).find(c => c.kind === 'ending'), panels: jobs.length, issues: bad.length, images: judged, humanReview: 'pending' };
}
