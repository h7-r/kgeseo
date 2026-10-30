// 에이전트 공정 설명(10/22 미르) — 「어떤 모델이 어떤 기준으로 일하나」를 시험 화면 안에서 바로 보이게.
//   이야기 에이전트 · 공간·에셋 에이전트 · 퍼즐로 넘어가기 전 판단 · GPU · 데이터 수집·정제
//   모델 이름은 실제 실행 기록(steps[id].model)을 먼저 쓰고, 기록이 없으면 등급만 보인다.
import { useState } from 'react';

const TIER = { judgment: '판단 급', hard: '어려운 원전 급', mechanical: '정리 급' };
const EFFORT = { low: '생각 적게', medium: '생각 보통', high: '생각 많이' };
const modelName = m => (m || '').replace(/^claude-/, 'Claude ').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/sonnet/i, 'Sonnet').replace(/opus/i, 'Opus').replace(/haiku/i, 'Haiku');
function who(step, st, calls) {
  const m = st?.model || [...(calls || [])].reverse().find(c => c.step === step.id)?.model;
  if (step.codeOnly) return '코드 · 비용 0';
  if (st?.provider === 'local') return `로컬 모델${st.model ? ` · ${st.model}` : ''}`;
  return `${m ? modelName(m) : TIER[step.tier] || step.tier} · ${EFFORT[step.effort] || ''}`;
}

const STORY_RULE = {
  s01: ['원문에서 사실·불확실·금지 항목을 뽑음', '원문에 있는 것만 사실(F). 원문이 열어 둔 것은 해석 유보(U), 바꾸면 안 되는 것은 금지 왜곡(NG). 각색 조건은 넣지 않음 — 원전과 창작이 섞이지 않게'],
  s02: ['세계관·각색 조건을 입혀 게임 줄거리로', '새로 만든 내용은 게임 창작(GF)·[NEW] 표시. 01 의 금지 왜곡을 어기지 않음'],
  s03: ['이야기 구조·장면 흐름', '01·02 와 어긋나지 않음'],
  s04: ['장면마다 경험·상호작용·필요한 물건', '기계가 읽는 JSON 형식 — 코드가 형식 검사'],
};
const SPACE_RULE = {
  s05: ['퍼즐 초안 — 퍼즐과, 퍼즐을 받을 물건·자리(호스트)', '팀 계약 안에서만: 행동 5종(살피기·가기·입력·고르기·단서 짝짓기) · 퍼즐 7유형 · 힌트 2단계. 코드가 계약·재미 검사'],
  s06: ['방 2~4칸 세트 · 방 사이 문 · 방마다 살림·생활 흔적·빛', '방 유형 사전(사랑방·안방·건넌방·윗방·대청·부엌·헛간·곳간·골방)의 쓰임과 「꼭 있을 것·두지 않을 것」. 좌표는 정하지 않음'],
  s07: ['살림마다 라이브러리 후보 중에서 고름', '후보는 검색이 찾음(다국어 문장 임베딩 multilingual-e5-small + 한글 자모 유사도). 맞는 것이 없으면 「없음」으로 남겨 생성 요청으로'],
  s08: ['방을 짓고 물건을 놓고 게임 화풍으로 합침', '방 생성기(칸·바닥·벽·문·천장 고증) · 실내 배치 규칙(문 앞 비움 · 벽 가구는 등을 벽에 · 긴 연장은 벽에 기댐 …) · 나주맵과 같은 화풍·배경·바람'],
};

function StepTable({ steps, detail, rules }) {
  const rows = steps.filter(s => rules[s.id]);
  return <table className="trial-table explain-table"><thead><tr><th>단계</th><th>누가</th><th>하는 일</th><th>지켜야 할 기준</th></tr></thead><tbody>
    {rows.map(s => <tr key={s.id}><td><b>{s.no}</b> {s.label}</td><td><span className={`flow-who flow-who-${s.codeOnly ? 'code' : detail.steps[s.id]?.provider === 'local' ? 'local' : 'llm'}`}>{who(s, detail.steps[s.id], detail.calls)}</span></td><td>{rules[s.id][0]}</td><td><small>{rules[s.id][1]}</small></td></tr>)}
  </tbody></table>;
}

function Story({ detail, steps }) {
  return <>
    <p>설화 한 편을 받아 게임 문서 01~04 를 씁니다. 판단은 LLM, 형식·인용 검사는 코드, 통과 여부는 사람(관문 G1)이 정합니다.</p>
    <StepTable steps={steps} detail={detail} rules={STORY_RULE} />
    <p className="muted"><small>모델 세 급 — 판단 급 Sonnet(사실 추출·각색·충돌 검토) · 어려운 원전 급 Opus(고문·방언·출처 충돌이 있을 때만) · 정리 급 Haiku(양식 맞춤·짝짓기). 생각 양을 낮게 둔 이유: 10/19 첫 실행에서 생각이 출력 한도를 거의 다 써 01 본문이 잘림.</small></p>
    <h3>핵심 검수 카드 — 사람이 문서 전체를 읽지 않게</h3>
    <ol className="explain-screen">
      <li><b>위 · 문서별 요약 3~5줄</b><small>이 줄만 읽어도 문서의 뼈대가 보이게</small></li>
      <li className="hl"><b>가운데 · 「사람이 꼭 볼 곳」 카드(중요한 순서, 최대 25장)</b><small>원천에 없는 내용 · 서로 어긋남 · 미확인을 확정함 · 민감·금지 왜곡 의심 · 핵심 사실 빠짐. 카드마다 원문 그대로의 인용 + 무엇을 확인할지 한 문장. 사람이 「확인」 또는 「문제」+의견</small></li>
      <li><b>맨 아래 · 게임 문서 원문</b><small>카드의 「원문에서 보기」를 누르면 그 구간으로</small></li>
    </ol>
    <ul>
      <li>모델(Sonnet, 1회 호출)은 승인·반려를 말하지 않고 볼 곳만 짚음.</li>
      <li>인용은 코드가 원문과 글자 그대로 맞춰 봄 — 바꿔 쓴 카드는 버리고 「뺀 카드」로 따로 보임. 없는 문장으로 사람을 설득하지 못하게.</li>
      <li>문서 내용이 바뀌면(내용 지문) 예전 카드·판정은 새 판에 쓰지 않음.</li>
      <li>실측 1회: 사람이 쓴 앙암바위 문서 3개(약 5.8만 자) → 카드 10장, 뺀 카드 0, $0.27.</li>
      <li>🟡 이 시험의 AI 01~04 에는 아직 카드를 붙이지 않음(지금은 사람 문서 검수 화면에만).</li>
    </ul>
  </>;
}

function Space({ detail, steps }) {
  const c = detail.indoor?.compare, b = detail.indoor?.build;
  return <>
    <p>01~04 가 승인되면 공간 쪽으로 넘어갑니다. LLM 은 「무엇을 어디쯤」까지만 정하고, 좌표·크기·충돌·화풍은 코드가 정합니다. 계산과 검사가 확실해야 하는 일은 코드 몫입니다.</p>
    <StepTable steps={steps} detail={detail} rules={SPACE_RULE} />
    <p><small>06 과 07 사이에 코드가 계획을 다듬음 — 방에 안 맞는 살림 빼기 · 꼭 있을 살림 채우기 · 대청 가운데 비우기 · 옷은 횃대에{c ? ` (이 시험 ${c.fixes.length}건)` : ''}. 마지막에 자기 검사(방 연결 개연성{b ? ` ${b.checks.filter(x => x.ok).length}/${b.checks.length}` : ''} · 퍼즐 호스트{b ? ` ${b.hosts.placed}/${b.hosts.total}` : ''} · 모범답안 기준{c ? ` ${c.summary.final.pass}/${c.summary.final.total}` : ''}) → 사람이 걸어 다니며 검수(관문 G2).</small></p>
    <div className="explain-cols">
      <div><b>할 수 있는 것 🟢</b><ul>
        <li>한옥 실내 9유형으로 방 2~4칸 세트, 방은 따로 불러오고 문으로 이동</li>
        <li>문·창·벽장·아궁이·시렁·횃대가 따로 떨어진 물체 — 조사·상호작용 대상으로 바로 연결</li>
        <li>퍼즐 호스트 배치, 나주맵과 같은 화풍·배경·바람</li>
        <li>문서 → 방까지 사람 손 없이 한 번에</li>
      </ul></div>
      <div><b>아직 못 하는 것 🟡</b><ul>
        <li>라이브러리에 없는 물건(보따리·쪽지·병풍·손수건·빗장·걸쳐 늘어진 옷)</li>
        <li>상태가 바뀌는 물건(열리는 반닫이, 숨은 칸) — 지금은 통짜 모델</li>
        <li>06·07 을 로컬 모델로 돌린 비교, 기준 노트북 성능 [미측정]</li>
      </ul></div>
    </div>
  </>;
}

function Puzzle() {
  return <>
    <p>퍼즐 단계는 아직 이 공정으로 끝까지 돌리지 못했습니다. 넘어가기 전에 정할 두 가지입니다.</p>
    <h3>① 연출을 빼고 기성 에셋만으로 퍼즐을 짜도 재미가 나는가</h3>
    <p className="explain-verdict"><b>판단 🟡</b> 퍼즐 대부분은 기성 에셋으로 충분하지만 「연출 전부 빼기」는 고르지 않음. <b>기성 에셋 + 상태 변형</b>(열림·닫힘, 숨은 칸, 빛이 들면 보이는 표식)이 기본, 사건마다 <b>결정적 순간 1~2개만</b> 전용 에셋·연출.</p>
    <ul>
      <li>실제 방탈출 16퍼즐 분석: 관찰·탐색 50% · 연관·논리 37.5% → 재미의 대부분은 「찾고 잇는」 구조에서 나오고, 보통 물건으로 됨.</li>
      <li>3차 멘토링 「퀴즈 같다」 → 물건이 반응하지 않고 글만 읽혀 답을 넣으면 퀴즈가 됨. 그래서 상태가 필요.</li>
      <li>왜곡이 풀리는 순간이 이 게임의 정체성 → 그 순간만은 연출. 「뒷문으로 드는 빛」처럼 조명·셰이더로 되는 것이 많음.</li>
      <li>자동 검사로는 재미를 보장 못 함 → 사람 플레이 시험(사람 제작본 10/26~30, AI 생성판 11/2~6)으로 잼.</li>
    </ul>
    <h3>② 퍼즐용 에셋 에이전트가 따로 있어야 하는가</h3>
    <p className="explain-verdict"><b>판단 🟡 따로 둠</b> — 새 생성 모델이 아니라 「조합·변형 담당」. 배경은 묻혀야 하고 퍼즐 물건은 찾혀야·반응해야·단서가 읽혀야 해서 기준이 반대. 이 시험 06 원안이 퍼즐 물건을 대청 가운데 늘어놓아 「대청 가운데 비우기」와 부딪힌 것이 실례.</p>
    <ol>
      <li>퍼즐 에이전트가 <b>퍼즐 에셋 요구서</b>를 냄 — 물건 · 필요한 상태 · 단서가 놓일 면 · 쓰는 조작(계약 5종 안)</li>
      <li>라이브러리에서 바탕 찾기 — 기성 소품 또는 국가유산청 부재(문·창호·궤·자물쇠 부품)</li>
      <li>코드로 상태 변형 — 부재 조합으로 숨은 칸 · 돌아가는 축(빗자루 기대기와 같은 회전축) · 표식·글자</li>
      <li>그래도 없으면 생성(그림 → 3D). 생성 3D 는 한 덩어리라 움직이는 부분은 3번에서 따로</li>
      <li>검사 — 상태 전환이 되는가 · 단서가 게임 시점 거리에서 읽히는가 · 구현된 조작만 쓰는가</li>
    </ol>
  </>;
}

function Gpu() {
  return <>
    <p>GIST 서버 V100 32GB 1대(무료, 12월 말까지 가정). 지금 GPU 가 답하려는 질문: <b>라이브러리에 없는 물건을 그림 → 3D 로 만들 때 이미지 모델을 추가 학습시켜야 하나.</b> 화풍은 이미지 단계에서 학습하지 않음(3D 단계에서 통일) — 이미지 모델의 일은 실물과 같은 형태 + 3D 로 바꾸기 좋은 깨끗한 그림.</p>
    <table className="trial-table explain-table"><thead><tr><th>언제</th><th>무엇을</th><th>결과</th></tr></thead><tbody>
      <tr><td>10/12~14</td><td>후보 이미지 모델 3종 같은 자료로 학습 비교</td><td>klein 탈락. Z-Image(학습판 끈 쪽이 더 나음)·Qwen-Image 남음</td></tr>
      <tr><td>10/20~21</td><td>골든셋 평가 — 정답 사진 있는 기준 항목(유물 25 · 생활 12 · 설계안 11)을 두 모델 × 시드 2</td><td>🟡 1차 판정: 두 모델이 늘 틀리는 「체계적 실패」 5/24(약 21%, 탕건·청자 갑발·청동 정병·연상·재갈) → 기준 5% 초과, 학습 필요 쪽. 단 정답 사진 오류 4~5건, Z-Image 는 프롬프트 끝 문구 탓에 박물관 진열 사진으로 나옴</td></tr>
      <tr><td>10/22 오전</td><td>빈 방 껍데기 그림 → 3D(TRELLIS.2) 시험 — 온돌방·대청·부엌·두 칸 방</td><td>🟡 그림은 그럴듯하나 Qwen 은 「지붕 없음」을 어김, 3D 는 벽이 뜯기거나 한 장만 남고 한 덩어리 → 방 껍데기는 지금처럼 코드 생성기(맥 <code>~/flux-test/room_1022/빈방대조_*.jpg</code>)</td></tr>
    </tbody></table>
    <div className="explain-cols">
      <div><b>다음 순서</b><ol>
        <li>틀린 정답 사진 교체 → 1차 판정 사람 확인</li>
        <li>Z-Image 프롬프트 끝을 「회색 단색 배경」 형식으로 바꿔 실패 항목만 재시험(몇 시간)</li>
        <li>남으면 형태 학습 — 관모 · 도자 생산도구 · 불교 의례기 · 문방구 · 마구. 1라운드 약 10시간, 최대 2라운드</li>
        <li>재평가 → 통과하면 없는 물건 본 생성 → 3D 변환</li>
      </ol></div>
      <div><b>기대하는 것</b><ul>
        <li>생성 에셋 최종 오류 ≤ 5%, 사람 확인 ≤ 30분/한 바퀴</li>
        <li>학습 성공: 대상 실패가 절반 이상 줄고, 전에 되던 것이 새로 틀리는 것은 48항목 중 2개 이하</li>
        <li>퍼즐 물건(보따리·쪽지 등) 포함 라이브러리 빈칸을 사람 모델링 없이 채움</li>
      </ul></div>
    </div>
  </>;
}

function Data() {
  return <>
    <table className="trial-table explain-table"><thead><tr><th>데이터</th><th>어떻게 모으나</th><th>어떻게 거르나</th><th>지금</th></tr></thead><tbody>
      <tr><td><b>설화 원자료</b></td><td>자체 크롤러 — 한국민속대백과사전 · 지역N문화 · 한국민족문화대백과사전 + 관광 공식 페이지 + 지도(OSM) 주변 장소</td><td>공통 7필드(제목·본문·출처·수집일·출처 표기 등) · 지역 맥락 필터 · 제외 규칙 9건 · 판본 중복 제거 · 원문 대조로 빠진 문단 복원</td><td>설화·민속 25건(약 6.7만 자), 관광 207건. 민속대백과 후보 258건 중 19건만 남김</td></tr>
      <tr><td><b>퍼즐 기준선</b></td><td>실제 방탈출 3테마 퍼즐 16개 기록</td><td>학술 분류(도전 유형 21종) 라벨</td><td>관찰·탐색 50% · 연관·논리 37.5%</td></tr>
      <tr><td><b>3D 에셋</b></td><td>국가유산청·한국문화정보원 공개 3D(CC BY) · 국가유산청 유니티 에셋 · AI허브 3D</td><td>라이선스 먼저 → 경량화(이어 붙일 부재는 가장자리 잠금) → 중복·텍스처 없음 보류 → 쓰임 분류 → 에이전트용 설명 초안(시대·쓰임·안 맞는 곳)</td><td>부재·소품·건물·지형으로 등록. 유니티 에셋은 웹 배포 조건이 정해질 때까지 게임 연결에서 빠짐 🔴</td></tr>
      <tr><td><b>이미지 정답</b></td><td>기관 사진 · 공개 3D 렌더 · 사전 정의문</td><td>출처 2곳 이상이 같은 물건이면 A등급. 형태 특징은 정의문에서 먼저 뽑아 사진과 서로 검증</td><td>틀린 정답 교체 중</td></tr>
      <tr><td><b>플레이·방문</b></td><td>허용 이벤트 19종만, 익명 세션</td><td>이동 좌표·얼굴·연락처 수집 안 함</td><td>사람 플레이 시험부터</td></tr>
    </tbody></table>
    <ul>
      <li>라이선스가 1단계 — 수집할 때 이용 조건을 함께 저장, 비상업·변경 금지는 자동으로 뺌.</li>
      <li>AI허브 데이터는 맥과 GPU 서버 밖으로 나가지 않음(국외 반출 금지).</li>
      <li>검색으로 찾은 사진은 판정 참고용만, 학습에 넣지 않음.</li>
    </ul>
  </>;
}

const TABS = [['story', '이야기 에이전트', Story], ['space', '공간·에셋 에이전트', Space], ['puzzle', '퍼즐 — 넘어가기 전 판단', Puzzle], ['gpu', 'GPU 에서 하는 일', Gpu], ['data', '데이터 수집·정제', Data]];
export default function AgentExplain({ detail, steps }) {
  const [tab, setTab] = useState('story');
  const [, , Body] = TABS.find(t => t[0] === tab);
  return <section className="panel explain">
    <div className="panel-head"><div><h2>이 공정은 어떻게 일하나</h2><p>단계마다 어떤 모델이 어떤 기준으로 일하는지, 사람은 어디서 판정하는지. 모델 이름은 이 시험의 실제 실행 기록입니다.</p></div></div>
    <div className="explain-tabs" role="tablist">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? '' : 'secondary'} onClick={() => setTab(id)}>{label}</button>)}</div>
    <div className="explain-body" role="tabpanel"><Body detail={detail} steps={steps} /></div>
  </section>;
}
