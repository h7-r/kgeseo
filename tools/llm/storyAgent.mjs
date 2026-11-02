// storyAgent.mjs — 이야기 에이전트(설화 → 01~04 문서) 프롬프트 묶음 (10/19)
//   story-trial.mjs(10/15 통제 실험)의 프롬프트를 그대로 옮겨 검수 작업대 「에이전트 시험」이 같이 쓴다.
//   story-trial.mjs 는 실험 기록 재현을 위해 손대지 않았다(같은 내용이 두 곳에 있다 — 프롬프트를 고치면 둘 다).
//   차이: 04 는 작업대에서 「JSON 만」 받고 마크다운은 코드가 그린다(10/15 시험에서 04 가 출력 한도에 걸려 본문이 비었다).
import fs from 'node:fs';
import path from 'node:path';
import { MODELS } from './claude.mjs';

export function splitResponse(text) {
  const mi = text.indexOf('===MARKDOWN===');
  const jsonPart = mi >= 0 ? text.slice(0, mi) : text;
  const m = jsonPart.match(/```json\s*([\s\S]*?)```/) || jsonPart.match(/```json\s*([\s\S]*)$/);
  const rawJson = (m ? m[1] : jsonPart.replace('===JSON===', '')).trim();
  let md = mi >= 0 ? text.slice(mi + '===MARKDOWN==='.length).trim() : '';
  if (!md && m) md = text.slice(text.indexOf(m[0]) + m[0].length).trim();
  return { rawJson, md };
}

/**
 * kit: { inDir: 작성규격·빈 양식 폴더(읽기 전용), humanDir: 공통 틀 문서 폴더(세계관·캐릭터·조직·인터랙션 — 읽기 전용),
 *        caseId, storyId, promptVersion }
 */
export function createStoryPrompts({ inDir, humanDir, caseId, storyId, promptVersion }) {
  const readIn = (rel) => fs.readFileSync(path.join(inDir, rel), 'utf8');
  const readHuman = (name) => fs.readFileSync(path.join(humanDir, name), 'utf8');
  const stripHeaderLine = (t) => t.replace(/^(> )?AI 시험 생성본[^\n]*\n(\n)?/, '').replace(/^<!--[^\n]*-->\n/, '');
  const tplFile = (k) => fs.readdirSync(path.join(inDir, 'templates')).find((f) => f.startsWith(k) && f.endsWith('.template.md'));
  const CASE_ID = caseId;
  const STORY_ID = storyId;
  const PROMPT_VERSION = promptVersion;
  const FENCE = '```';

function systemPrompt() {
  const spec = stripHeaderLine(readIn('작성규격_v1.md'));
  const frame = [
    ['게임 세계관 설정서', '왜곡 세계관 설정서.md'],
    ['캐릭터 설정집', '캐릭터 설정집.md'],
    ['합동수사본부 조직 설정서', '합동수사본부 조직 설정서.md'],
    ['공용 인터랙션 카탈로그', '00 공용 인터랙션 카탈로그.md'],
  ].map(([t, f]) => `<${t}>\n${readHuman(f)}\n</${t}>`).join('\n\n');
  return [
    '너는 지역 설화 기반 추리·방탈출 게임 「왜곡」의 이야기 에이전트다. 설화 원전을 바탕으로 게임 기획 문서 01~04를 차례로 작성한다.',
    '아래 <작성 규격>을 반드시 지킨다. <게임 세계관 설정서>·<캐릭터 설정집>·<합동수사본부 조직 설정서>·<공용 인터랙션 카탈로그>는 모든 Case에 공통인 게임의 틀이다(특정 설화의 내용이 아니다).',
    '',
    '[출력 형식 — 꼭 지킬 것]',
    '1. 응답은 두 부분뿐이다. 첫 줄에 `===JSON===`, 그 아래 ```json 코드블록 하나(짝 JSON — 규격 0.4: JSON이 기준), 그다음 줄에 `===MARKDOWN===`, 그 아래 사람이 읽는 문서 마크다운. 앞뒤에 다른 말을 쓰지 않는다.',
    '2. 마크다운은 주어진 <빈 양식>의 제목과 표 머리를 그대로, 같은 순서로 쓴다. 양식의 자리표시([인물A], [Scene 제목], [MAP_ID] 등)는 실제 값으로 바꾼다. "(…마다 반복)" 표시가 있는 블록은 필요한 만큼 반복한다. 규격이 요구하는 칸(머리 정보 표, ID, 인용 구간 등)은 덧붙인다.',
    '3. 문서 맨 위에 규격 0.2의 머리 정보 표(case_id, story_id, doc_type, doc_version, author_kind, author, input_hash, status)를 둔다. 값은 과제에 주어진 것을 쓴다. status는 DRAFT.',
    '4. 근거 표시(규격 0.3): 본문 내용 줄(목록 줄, 표의 자료 줄, 문단 줄)마다 줄 끝에 [F] [GF] [U] [NEW] 중 하나를 붙인다. 근거 ID가 있으면 [F: F-03] [GF: GF-01] [U: U-02]처럼 쓴다. 이번에 새로 지어낸 내용은 반드시 [NEW]. 제목 줄과 표 머리줄에는 붙이지 않는다. 표의 자료 줄은 마지막 칸 끝에 붙인다.',
    '5. 사람 작성본용 🟢🟡🔴 표시는 쓰지 않는다.',
    '6. 퍼즐의 정답·암호·풀이 순서는 쓰지 않는다. 퍼즐 수도 정하지 않는다.',
    '7. 앞 문서를 고치지 않는다. 앞 문서와 맞지 않거나 고칠 필요가 보이면 마크다운 맨 끝 `## 막힘 보고` 절에 적는다(없으면 "없음").',
    '8. 한국어로, 짧고 분명한 문장으로 쓴다.',
    '',
    `<작성 규격>\n${spec}\n</작성 규격>`,
    '',
    frame,
  ].join('\n');
}

function headValues(docType, inputHash) {
  return `case_id=${CASE_ID} · story_id=${STORY_ID} · doc_type=${docType} · doc_version=v1.0 · author_kind=agent · author=story-agent/${MODELS.judgment}/${PROMPT_VERSION} · input_hash=${inputHash} · status=DRAFT`;
}
const docBlock = (label, d) => `<${label} — 짝 JSON(기준)>\n${FENCE}json\n${JSON.stringify(d.json)}\n${FENCE}\n</${label} — 짝 JSON(기준)>\n\n<${label} — 마크다운>\n${d.md}\n</${label} — 마크다운>`;

const SHAPES = {
  '01': `{
  "doc_type": "fact_contract",
  "head": { "case_id": "", "story_id": "", "doc_version": "v1.0", "author_kind": "agent", "author": "", "input_hash": "", "status": "DRAFT" },
  "sources": [ { "id": "SRC-01", "name": "", "kind": "원전|학술|공공 아카이브|향토 자료", "location": "", "terms": "이용 조건(모르면 '미확인')", "body_checked": true } ],
  "facts": [ { "id": "F-01", "category": "장소|인물|사건|관계|시대|결말|상징", "text": "한 줄에 한 사실", "src": ["SRC-01"], "loc": "본문 n문단", "quote": "원문에서 글자 그대로 복사한 연속 구간", "lock": "LOCKED|APPROVAL_REQUIRED" } ],
  "order": [ { "seq": 1, "event": "", "facts": ["F-04"], "reorderable": false } ],
  "open": [ { "id": "U-01", "kind": "", "issue": "", "rule": "게임 처리 원칙", "src": ["SRC-01"] } ],
  "ng": [ { "id": "NG-01", "change": "금지할 변경", "reason": "", "refs": ["F-03"] } ],
  "gf": [ { "id": "GF-01", "setting": "", "kind": "", "relation": "원전 사실과의 관계", "status": "제안", "tag": "NEW" } ],
  "tags": { "era": "", "setting": [], "motif": [] }
}`,
  '02': `{
  "doc_type": "synopsis",
  "head": { ... 01과 같은 필드 },
  "title": "", "episode": "", "logline": "",
  "start": { "why_here": "", "first_incident": "", "first_goal": "", "first_belief": "" },
  "questions": [ { "id": "Q-01", "text": "", "central": false, "answered_by": "언제 답을 얻는가" } ],
  "misconception": { "belief": "", "truth": "", "why": "" },
  "reversals": [ { "id": "RV-01", "before": "", "reveal": "", "shift": "", "basis": ["F-07"], "tag": "F|GF|NEW" } ],
  "characters": [ { "name": "", "role": "", "first_seen_as": "", "hidden_truth": "" } ],
  "field_link": [ { "place": "", "online_question": "", "onsite": "", "tag": "NEW" } ],
  "ending": { "final_state": "", "last_image": "", "left_open": "" },
  "handoff": { "must_reveal": [], "hide_early": [], "keep_reversals": [], "keep_emotion": [], "keep_interpretation": [] }
}`,
  '03': `{
  "doc_type": "scenario",
  "head": { ... },
  "player_role": "", "start": { "situation": "", "knows": [], "unknown": [] }, "final_goal": "",
  "questions": [ { "id": "Q-01", "shown_when": "", "answered_when": "" } ],
  "reveal_order": [ { "seq": 1, "content": "", "basis": ["F-03"], "scene_id": "scene-01" } ],
  "reversals": [ { "id": "RV-01", "before": "", "reveal": "", "basis": [] } ],
  "emotion_curve": [ { "stage": "", "emotion": "" } ],
  "avoid": [], "clear_conditions": [],
  "scenes": [ { "scene_id": "scene-01", "name": "", "role": "", "key_finding": "", "answers_q": ["Q-01"] } ]
}`,
  '04': `{
  "doc_type": "scene_table",
  "head": { ... },
  "map": { "map_id": "", "structure": "", "notes": "" },
  "scenes": [ {
    "scene_id": "scene-01", "order": 1, "title": "",
    "entry_knows": [], "purpose": "", "questions": ["Q-01"],
    "required_discoveries": [ { "id": "RD-S1-01", "text": "", "basis": ["F-03"], "logic": null } ],
    "perception": { "before": "", "after": "" },
    "mood": { "base": "", "target_emotion": "", "tension": "" },
    "space_reqs": [ { "space_req_id": "SPREQ-S1-01", "setting": [], "era": "", "must_read_as": "", "playable": true, "layer": "near|mid|far" } ],
    "asset_reqs": [ { "req_id": "REQ-S1-01", "category": "story_object|interactive|dressing", "role_hint": "", "affordances_required": [], "tags_any": [], "setting": [], "era": "", "lore_reason": "", "dressing_only": false } ],
    "puzzle_link": { "story_role": "", "confirms": ["RD-S1-01"], "interactions": ["observe"] },
    "exit": { "complete_when": "", "trigger": "", "carry_info": [], "carry_items": [] }
  } ]
}
※ required_discoveries[].logic: 모순·순서·인과 같은 논리 관계를 주장하면 { "claim": "", "conditions": "같은 시각·장소, 관찰 가능 조건 등" }, 아니면 null.`,
};

function userPrompt(step, ctx) {
  const tpl = (k) => stripHeaderLine(readIn(`templates/${tplFile(k)}`));
  if (step === '01') {
    return [
      `[과제] 「01 설화 사실 계약서」를 작성하라. 머리 정보 값: ${headValues('fact_contract', ctx.hash)}`,
      '',
      '[원전] 아래 SRC-01이 이 설화에 대해 네가 가진 유일한 출처다.',
      '- SRC-02 이후 출처를 지어내지 않는다. 네가 기억하는 다른 판본·자료·지식은 F의 근거로 쓰지 않는다(필요하면 U로 남기거나 막힘 보고에 적는다).',
      '- 원문 첫 두 줄([출처]·[수집])은 수집 메모다. 그 아래 제목 한 줄과 본문 4문단이 원문이다. 위치는 "본문 n문단"으로 적는다.',
      '',
      `<SRC-01 원문>\n${ctx.tale}\n</SRC-01 원문>`,
      '',
      `<빈 양식>\n${tpl('01')}\n</빈 양식>`,
      '',
      '[01 추가 요구 — 규격 1장 "확장에서 추가하는 것"]',
      '- §2 핵심 사실 표에 `원문 인용(SRC-01)` 칸을 덧붙인다. 인용(JSON의 quote)은 원문에서 **글자 그대로 복사한 연속 구간**이다. 맞춤법이 틀린 곳도 고치지 않는다. 말줄임(…)으로 두 구간을 잇지 않는다. 15~80자.',
      '- 한 줄(F 하나)에 사실 하나. 원문이 직접 말하지 않는 것(추론·함의)은 F가 아니라 U로 둔다.',
      '- 이용 조건이 확인되지 않은 출처만을 근거로 한 F는 APPROVAL_REQUIRED로 둔다(규격). 그렇게 둔 경우 이유를 §1 확인 범위에 적는다.',
      '- 시대·장소 유형·모티프 태그(era/setting/motif)를 §0 문서 정보 표에 행으로 덧붙이고 JSON tags에도 적는다. 영어 소문자 snake_case.',
      '- §6 게임용 창작 설정(GF)은 U와 직접 연결된 것만, 승인 상태는 "제안", 근거 표시는 [NEW].',
      '- §7 체크리스트는 규격 0.5를 지켰는지 스스로 확인하는 목록으로 쓴다.',
      '',
      `[짝 JSON 모양]\n${SHAPES['01']}`,
    ].join('\n');
  }
  if (step === '02') {
    return [
      `[과제] 「02 지역 테마 시놉시스」를 작성하라. 머리 정보 값: ${headValues('synopsis', ctx.hash)}`,
      '입력은 앞 단계가 만든 01 설화 사실 계약서뿐이다. 01에 없는 사실을 원전 사실처럼 쓰지 않는다. 01의 NG를 어기지 않는다. U를 사실로 단정하지 않는다.',
      '',
      docBlock('01 설화 사실 계약서', ctx.d01),
      '',
      `<빈 양식>\n${tpl('02')}\n</빈 양식>`,
      '',
      '[02 추가 요구 — 규격 2장]',
      '- 핵심 질문에 Q-01, Q-02 … ID를 단다(03·04가 이 ID로 참조한다).',
      '- 반전마다 근거 ID(F/GF)를 적는다. 근거 없는 반전은 [NEW].',
      '- §8 뒤에 「현장 연결」 절을 덧붙인다: 실제 장소 · 온라인에 남길 질문 · 현장에서 볼 수 있는 것. 모두 [NEW] 초안.',
      '- 게임 고유 해석 표(§10)는 01의 GF를 따르고, 새 해석이 필요하면 [NEW]로 표시한다.',
      '- 퍼즐 수는 정하지 않는다.',
      '',
      `[짝 JSON 모양]\n${SHAPES['02']}`,
    ].join('\n');
  }
  if (step === '03') {
    return [
      `[과제] 「03 게임 시나리오 기획서」를 작성하라. 머리 정보 값: ${headValues('scenario', ctx.hash)}`,
      '입력은 앞 단계가 만든 01·02뿐이다. 앞 문서를 고치지 않는다.',
      '',
      docBlock('01 설화 사실 계약서', ctx.d01),
      '',
      docBlock('02 지역 테마 시놉시스', ctx.d02),
      '',
      `<빈 양식>\n${tpl('03')}\n</빈 양식>`,
      '',
      '[03 추가 요구 — 규격 3장]',
      '- §7 정보 공개 순서 표는 「공개 순번 · 공개되는 내용 · 근거 ID · 해당 Scene(scene_id)」를 담는다(빈 양식 표 머리에 칸을 덧붙여도 된다).',
      '- §14 Scene 개요 표에 scene_id와 그 Scene이 답하는 Q- ID 칸을 덧붙인다.',
      '- 질문 ID는 02의 Q- ID를 그대로 쓴다.',
      '',
      `[짝 JSON 모양]\n${SHAPES['03']}`,
    ].join('\n');
  }
  if (step === '04') {
    return [
      `[과제] 「04 Scene 구성표」를 작성하라. 머리 정보 값: ${headValues('scene_table', ctx.hash)}`,
      '입력은 앞 단계가 만든 01·02·03뿐이다. Scene 수와 순서는 03의 Scene 개요를 따른다. 앞 문서를 고치지 않는다.',
      '',
      docBlock('01 설화 사실 계약서', ctx.d01),
      '',
      docBlock('02 지역 테마 시놉시스', ctx.d02),
      '',
      docBlock('03 게임 시나리오 기획서', ctx.d03),
      '',
      `<빈 양식>\n${tpl('04')}\n</빈 양식>`,
      '',
      '[04 추가 요구 — 규격 4장]',
      '- 필수 발견마다 RD-S{Scene번호}-{nn} ID. 논리 관계(모순·순서·인과)를 주장하는 필수 발견은 성립 조건을 함께 적는다.',
      '- §4 공간 구성: 필수 장소 요소마다 SPREQ-S{n}-{nn}, 스토리 오브젝트·일반 조작·장식 전용마다 REQ-S{n}-{nn}를 달고 자연어로 쓴다. 전체 필드는 짝 JSON에 둔다. 구체 물건명·instance_id는 정하지 않는다. lore_reason은 "퍼즐을 위해"가 아니라 왜 그 자리에 자연스럽게 있는지.',
      '- §5 퍼즐 연결 조건: 이야기 역할과 확인되어야 하는 RD- ID만. 퍼즐 호스트 후보는 정하지 않는다("퍼즐 단계에서 배치된 에셋 중 선택"이라고만 쓴다). 인터랙션은 공용 인터랙션 카탈로그 ID만 쓴다.',
      '- 퍼즐 정답·암호·풀이 순서·퍼즐 수는 쓰지 않는다.',
      '',
      `[짝 JSON 모양]\n${SHAPES['04']}`,
    ].join('\n');
  }
  throw new Error(step);
}

  return { systemPrompt, userPrompt, SHAPES, docBlock, headValues };
}
