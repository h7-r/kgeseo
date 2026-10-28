// 「에이전트 시험」 — 설화 원문 하나로 이야기 에이전트(01~04) → 에셋 선정(05) → 공간 배치 초안(06)을 단계마다 돌려 본다 (10/19)
// 서버: tools/review/agentTrial.mjs. 사람 문서·나주 공간은 읽기만, 결과는 .local/review/trials/ 에만.
// 06 결과는 「빈 지형」 시험 검수 기록으로 가져와 공간·에셋 검수 화면에서 본다(공간 승인해도 게임 데이터에 반영 안 함).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, date } from './api.js';
import GameReviewFrame from './GameReviewFrame.jsx';
import { PlacementAdjustPanel } from './PlacementPanels.jsx';
import './AgentTrialPage.css';
import AgentExplain from './AgentExplain.jsx';
import PuzzleReview from './PuzzleReview.jsx';

const STATUS = { idle: '대기', running: '실행 중', done: '완료', failed: '실패' };
const usd = value => `$${Number(value || 0).toFixed(3)}`;
const HUMAN_SPACE_URL = 'http://localhost:5174/?aihub&src=sf&r=15';
const EMPTY_SPACE_URL = 'http://localhost:5174/?aihub&src=sf&r=15&base=empty';

function NewTrial({ onCreated, defaultBudget, trials = [] }) {
  const [fromTrialId, setFromTrialId] = useState('');
  const [title, setTitle] = useState('나주 앙암바위 — 에이전트 시험');
  const [sourceName, setSourceName] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [budget, setBudget] = useState(defaultBudget || 8);
  const [adaptation, setAdaptation] = useState('');
  const [spaceKind, setSpaceKind] = useState('outdoor');
  const [error, setError] = useState('');
  const loadPreset = async () => {
    try { const preset = await api('/trials/preset'); if (preset) { setSourceText(preset.text); setSourceName(preset.name); } } catch (err) { setError(err.message); }
  };
  const create = async () => {
    setError('');
    try { onCreated(await api('/trials', { method: 'POST', body: { title, sourceName, sourceText, adaptation, spaceKind, budgetUsd: Number(budget), fromTrialId: fromTrialId || undefined } })); } catch (err) { setError(err.message); }
  };
  return <section className="panel trial-new">
    <div className="panel-head"><div><h2>새 에이전트 시험</h2><p>설화 원문 하나만 넣습니다. 사람이 쓴 01~06 문서와 나주 공간은 에이전트에게 주지 않습니다(공통 틀 문서·작성 규격만).</p></div></div>
    <div className="form-grid"><label className="field"><span>시험 이름</span><input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} /></label><label className="field"><span>시험 예산(달러) — 넘을 것 같으면 단계가 멈춥니다</span><input type="number" min="1" max="30" step="1" value={budget} onChange={e => setBudget(e.target.value)} /></label></div>
    <label className="field"><span>원문 출처</span><input value={sourceName} maxLength={200} onChange={e => setSourceName(e.target.value)} placeholder="예: 나주문화원 「앙암바위」" /></label>
    <label className="field"><span>설화 원문</span><textarea rows={10} value={sourceText} onChange={e => setSourceText(e.target.value)} placeholder="설화 원문을 붙여넣으세요." /></label>
    <label className="field"><span>각색 조건(선택) — 제작팀이 정한 각색 방침. 01 사실 계약서에는 넣지 않고 02~06 에만 넣습니다(원전과 창작이 섞이지 않게)</span><textarea rows={6} value={adaptation} onChange={e => setAdaptation(e.target.value)} placeholder="예: 플레이어는 합동수사본부 현장 조사관 강도윤. 인물 모형 없음 — 흔적으로만. 실내 방만." /></label>
    <label className="field"><span>게임 공간</span><select value={spaceKind} onChange={e => setSpaceKind(e.target.value)}><option value="outdoor">나주 앙암바위(야외 지형)</option><option value="indoor">실내 방 세트(코드로 생성하는 한옥 방 2~4칸)</option></select></label>
    <label className="field"><span>앞 시험의 01~04 문서 이어받기(같은 원문일 때 — 문서 단계 비용 없이 05부터 시험)</span><select value={fromTrialId} onChange={e => setFromTrialId(e.target.value)}><option value="">이어받지 않음(01부터)</option>{trials.map(t => <option key={t.id} value={t.id}>{t.title} · {date(t.createdAt)}</option>)}</select></label>
    <div className="button-row"><button className="secondary" onClick={loadPreset}>나주문화원 원문 불러오기</button><button onClick={create} disabled={!sourceText.trim()}>시험 만들기</button></div>
    {error && <div className="message error">{error}</div>}
  </section>;
}

// 실내 방 세트 결과(10/21) — 06 계획 · 07 선정 · 08 방 만들기 결과와 뷰어 링크

const STEP_SHORT = { s01: '사실 뽑기', s02: '세계관·각색', s03: '이야기 구조', s04: '장면·에셋 요구', s05: '퍼즐 초안', s06: '실내 공간 구성', s07: '에셋 선정', s08: '방 만들기·배치' };
function stepOut(id, st, detail) {
  const r = st?.result || {};
  if (id === 's04' && r.counts) return `장면 ${r.counts.scenes} · 에셋 요구 ${r.counts.assetReqs}`;
  if (id === 's05' && r.puzzles != null) return `퍼즐 ${r.puzzles} · 호스트 ${r.hostNeeds}`;
  if (id === 's06' && detail.indoor?.plan) return `방 ${detail.indoor.plan.rooms?.length || 0} · 물건 ${detail.indoor.plan.contents?.length || 0}`;
  if (id === 's07' && r.picked != null) return `고름 ${r.picked} · 없음 ${r.missing}`;
  if (id === 's08' && detail.indoor?.build) { const b = detail.indoor.build; return `방 ${b.rooms.length} · 연결 ${b.checks.filter(c => c.ok).length}/${b.checks.length} · 호스트 ${b.hosts.placed}/${b.hosts.total}`; }
  if (r.chars) return `${r.chars.toLocaleString()}자`;
  return '';
}
function FlowView({ detail, steps, big }) {
  const secs = st => st?.startedAt && st?.finishedAt ? Math.max(0, Math.round((new Date(st.finishedAt) - new Date(st.startedAt)) / 1000)) : null;
  const hasOut = id => (id === 's06' && detail.indoor?.plan) || (id === 's07' && detail.indoor?.selection) || (id === 's08' && detail.indoor?.build);
  return <div className={`flow ${big ? 'flow-big' : ''}`}>
    <div className="flow-node flow-in"><b>설화 원문</b><small>{detail.source?.name}</small><small>{detail.source?.text?.length?.toLocaleString()}자{detail.adaptation?.text ? ' + 각색 조건' : ''}</small></div>
    {steps.map(s => { const st = detail.steps[s.id] || {}; const who = s.codeOnly ? '코드' : st.provider === 'local' ? '로컬 모델' : 'Claude'; const failedButHas = st.status === 'failed' && hasOut(s.id); const status = failedButHas ? 'done' : st.status || 'idle';
      return <Fragment key={s.id}><span className="flow-arrow">→</span>
        <a className={`flow-node flow-${status}`} href={`#step-${s.id}`}><span className="flow-no">{s.no}</span><b>{STEP_SHORT[s.id] || s.label}</b><small className={`flow-who flow-who-${s.codeOnly ? 'code' : st.provider === 'local' ? 'local' : 'llm'}`}>{who}</small>
          <small>{stepOut(s.id, st, detail) || STATUS[st.status || 'idle']}</small>
          <small className="muted">{secs(st) != null ? `${secs(st)}초` : ''}{st.costUsd > 0 ? ` · ${usd(st.costUsd)}` : s.codeOnly ? ' · 비용 0' : ''}</small>
          {failedButHas && <small className="flow-warn">결과 있음 · 마지막 재실행 실패</small>}</a></Fragment>; })}
    <span className="flow-arrow">→</span>
    <div className="flow-node flow-out"><b>방 세트</b>{detail.indoor?.build ? <a href={`${detail.indoor.build.viewer}?v=${encodeURIComponent(detail.indoor.build.at)}`} target="_blank" rel="noreferrer">둘러보기</a> : <small>아직 없음</small>}
      {detail.indoor?.compare?.summary && <small>모범답안 대조 {detail.indoor.compare.summary.final.pass}/{detail.indoor.compare.summary.final.total}</small>}</div>
  </div>;
}
function FlowPanel({ detail, steps }) {
  const [show, setShow] = useState(false);
  const c = detail.indoor?.compare;
  return <section className="panel">
    <div className="panel-head"><div><h2>작동 흐름</h2><p>설화가 어떤 단계를 거쳐 공간이 되는지 — 단계마다 누가(LLM·코드) 무엇을 냈는지, 걸린 시간·비용. 칸을 누르면 그 단계로 갑니다.</p></div><button className="secondary" onClick={() => setShow(true)}>시연 화면으로 크게</button></div>
    <FlowView detail={detail} steps={steps} />
    {show && <div className="flow-overlay" role="dialog" aria-label="작동 흐름 시연">
      <div className="flow-overlay-head"><div><p className="eyebrow">왜곡 · AI 제작 공정</p><h2>{detail.title}</h2></div><button onClick={() => setShow(false)}>닫기 ✕</button></div>
      <FlowView detail={detail} steps={steps} big />
      {c?.summary && <div className="flow-score"><div><b>에이전트 원안</b><span>{c.summary.raw.pass}/{c.summary.raw.total}</span><small>06 LLM 이 낸 그대로</small></div><span className="flow-arrow">→</span><div><b>규칙 적용 뒤</b><span>{c.summary.final.pass}/{c.summary.final.total}</span><small>코드가 고친 것 {c.fixes.length}건</small></div><div className="flow-score-note"><small>기준: 방 유형 사전 + 사람 눈 검수로 정한 규칙(사람 모범답안)</small></div></div>}
      {detail.spaceKind === 'indoor' && <AgentExplain detail={detail} steps={steps} />}
      {detail.indoor?.build && <iframe className="flow-frame" title="방 둘러보기" src={`${detail.indoor.build.viewer}?v=${encodeURIComponent(detail.indoor.build.at)}`} />}
    </div>}
  </section>;
}
const OK = x => x.na ? <span className="muted">—</span> : x.ok ? '🟢' : '🔴';
function IndoorCompare({ detail }) {
  const c = detail.indoor?.compare;
  if (!c) return null;
  if (c.error) return <div className="message error">모범답안 대조 오류: {c.error}</div>;
  return <section className="panel">
    <div className="panel-head"><div><h2>사람 모범답안과 대조</h2><p>기준 = 방 유형 사전 + 사람(미르) 눈 검수로 정한 규칙. 에이전트에 답으로 주지 않고, 결과를 같은 잣대로 잴 때만 씁니다. 「원안」은 06 LLM 이 낸 그대로, 「최종」은 코드 규칙을 적용해 08 로 만든 결과입니다.</p></div>
      <span className="pill">원안 {c.summary.raw.pass}/{c.summary.raw.total} → 최종 {c.summary.final.pass}/{c.summary.final.total}</span></div>
    <table className="trial-table"><thead><tr><th>기준</th><th>근거</th><th>원안</th><th>최종</th></tr></thead><tbody>
      {c.rules.map(r => <tr key={r.id}><td><b>{r.title}</b>{r.code && <small className="muted"> (코드·뷰어 담당)</small>}</td><td><small>{r.src}</small></td>
        <td>{OK(r.raw)} <small className="muted">{r.raw.detail || ''}</small></td><td>{OK(r.final)} <small className="muted">{r.final.detail || ''}</small></td></tr>)}
    </tbody></table>
    {c.fixes.length > 0 && <details><summary>원안 → 최종 사이 코드가 고친 것 {c.fixes.length}건</summary><ul>{c.fixes.map((f, i) => <li key={i}>{f}</li>)}</ul></details>}
    <p className="muted"><small>기준 출처: {c.basis}</small></p>
  </section>;
}

/** 에이전트 단독 결과 ↔ 사람 완성본을 화면 안에서 나란히(10/22) — 에이전트 시험 · 공간·에셋 검수 두 곳에서 쓴다
 *  사람 완성본 = humanFinal 표시가 있는 시험(같은 원문)의 결과. 그 시험 자신을 볼 때는 첫 실행 재현본(buildAgent)이 에이전트 단독 */
export function IndoorSide({ detail, noHuman }) {
  const [side, setSide] = useState(true);
  const I = detail.indoor || {}, own = I.build;
  // 10/28 미르: 공간·에셋 검수 탭에서는 사람 완성본을 보이지 않는다(noHuman)
  const human = noHuman ? null : detail.humanFinal ? (own && { ...own, title: detail.title }) : I.humanRef;
  const opts = [];
  if (detail.humanFinal && I.buildAgent) opts.push(['agent', I.buildAgent, '에이전트 단독 결과', '이 시험의 사람 검수 전 첫 실행(10/21) — 계획·선정·배치 그대로, 화풍·배경·바람은 자동']);
  if (!detail.humanFinal && own) opts.push(['own', own, '에이전트 단독 결과', '이 시험 — 사람 손 없이 지금 공정(에이전트 + 자동 규칙)이 만든 그대로']);
  if (I.buildRaw) opts.push(['raw', I.buildRaw, '06 계획 그대로', '코드 보정(방 유형 사전 맞춤·대청 고정 규칙) 전 — LLM 판단만 얼마나 맞는지']);
  const [pick, setPick] = useState(opts[0]?.[0] || '');
  const left = opts.find(o => o[0] === pick) || opts[0];
  if (!own) return null;
  const sum = b => `방 ${b.rooms.length} · 놓음 ${b.rooms.reduce((a, r) => a + r.placed, 0)} · 퍼즐 호스트 ${b.hosts.placed}/${b.hosts.total}`;
  const pair = side && left && human;
  const right = human || own;
  return <>
      {!noHuman && <label className="trial-compare-check"><input type="checkbox" checked={side} disabled={!left || !human} onChange={e => setSide(e.target.checked)} /> 에이전트 단독 결과와 사람 완성본을 나란히 비교{!human ? ' — 사람 완성본이 아직 없음' : ''}</label>}
      {pair && opts.length > 1 && <label className="field indoor-left-pick"><span>왼쪽 화면</span><select value={left[0]} onChange={e => setPick(e.target.value)}>{opts.map(o => <option key={o[0]} value={o[0]}>{o[2]} — {o[3].split(' — ')[0]}</option>)}</select></label>}
      <div className={pair ? 'indoor-side' : ''}>
        {pair && <figure className="indoor-pane"><figcaption><b>{left[2]}</b> <small className="muted">{left[3]}</small></figcaption><iframe className="indoor-frame" title="에이전트 결과 둘러보기" src={`${left[1].viewer}?compact=1&v=${encodeURIComponent(left[1].at)}`} /></figure>}
        <figure className="indoor-pane"><figcaption><b>{pair ? '사람 완성본' : '방 둘러보기'}</b> <small className="muted">{pair ? `${human.title || ''} — 사람 눈 검수 26건을 규칙·생성기에 반영` : ''}</small></figcaption><iframe className="indoor-frame" title="방 둘러보기" src={`${(pair ? right : own).viewer}?${pair ? 'compact=1&' : ''}v=${encodeURIComponent((pair ? right : own).at)}`} /></figure>
      </div>
      {pair && <p className="muted"><small>두 화면은 따로 움직입니다(방 구성이 다를 수 있음). {left[2]}: {sum(left[1])} / 사람 완성본: {sum(human)}</small></p>}
  </>;
}

export function IndoorResult({ detail, onRebuild, onOpenSpace, noHuman }) {
  const [view, setView] = useState(true);
  const plan = detail.indoor?.plan, sel = detail.indoor?.selection?.selections || [], build = detail.indoor?.build;
  if (!plan && !build) return null;
  const roomName = id => plan?.rooms?.find(r => r.id === id)?.name || id;
  return <section className="panel">
    <div className="panel-head"><div><h2>실내 방 세트</h2><p>06 계획(방·연결·살림) → 07 에셋 선정 → 08 코드가 방을 만들고 실내 배치 규칙으로 놓음. 「방 둘러보기」는 나주맵과 같은 조작(T 시작 · WASD · 클릭/E 조사 · 문으로 이동).</p></div>
      <div className="button-row">{build && <button className={view ? 'secondary' : ''} onClick={() => setView(v => !v)}>{view ? '둘러보기 닫기' : '방 둘러보기'}</button>}{build && onOpenSpace && <button className="secondary" onClick={() => onOpenSpace(detail)}>공간·에셋 검수에서 보기</button>}{build && <a className="button secondary" href={`${build.viewer}?v=${encodeURIComponent(build.at)}`} target="_blank" rel="noreferrer">새 탭</a>}{plan && sel.length > 0 && <button className="secondary" onClick={onRebuild}>방 다시 만들기(코드만, 비용 0)</button>}</div></div>
    {build && view && <IndoorSide detail={detail} noHuman={noHuman} />}
    {build && <>
      <h3>방 {build.rooms.length}개 · 연결 검사 {build.checks.filter(c => c.ok).length}/{build.checks.length} · 퍼즐 호스트 {build.hosts.placed}/{build.hosts.total}</h3>
      <table className="trial-table"><thead><tr><th>방</th><th>성격</th><th>칸·바닥</th><th>놓음/계획</th><th>바닥 점유</th><th>못 놓은 것</th></tr></thead><tbody>
        {build.rooms.map(r => <tr key={r.id}><td><b>{r.name}</b><br /><small className="muted">{r.why}</small></td><td>{r.role}</td><td>{r.kanX}칸 · {r.floor}</td><td>{r.placed}/{r.planned}</td><td>{r.coverPct}%</td><td>{r.failed.length ? r.failed.map(f => `${f.name}(${typeof f.why === 'object' ? Object.values(f.why || {}).join('·') : f.result})`).join(', ') : '—'}</td></tr>)}
      </tbody></table>
      {build.puzzle && <div className="indoor-puzzle"><h3>퍼즐 연결 — 코드로 미리 풀어 보면 {build.puzzle.solvable}/{build.puzzle.total} 풀림</h3><p className="muted"><small>05 퍼즐의 호스트를 08 에 놓인 물건·흔적에 잇고, 조사 → 단서 → 풀이를 코드가 차례로 돌려 본 결과입니다. 「방 둘러보기」에서 직접 풀어 볼 수 있습니다(시험 화면이라 정답 판정이 브라우저에 있음).</small></p>
        <table className="trial-table"><thead><tr><th>퍼즐</th><th>장면</th><th>풀이 방식</th><th>호스트 놓임</th><th>풀림</th><th>못 푸는 이유</th></tr></thead><tbody>
          {build.puzzle.checks.map(c => <tr key={c.id}><td><b>{c.id}</b> {c.title}</td><td>{c.scene_id}</td><td>{c.interaction}</td><td>{c.hostsBound}/{c.hostsTotal}</td><td>{c.solvable ? '🟢' : '🔴'}</td><td><small>{c.why}</small></td></tr>)}
        </tbody></table></div>}
      {build.regress && <div className="indoor-regress"><h3>자동 회귀 검사 {build.regress.filter(x => x.ok || x.warn).length}/{build.regress.length}{build.regress.some(x => !x.ok && !x.warn) ? ' — 🔴 있음: 다음 단계로 넘기지 않음' : ''}</h3><p className="muted"><small>사람이 짚었던 문제가 다시 생기지 않았는지 08 이 매번 코드로 잽니다.</small></p>
        <ul className="trial-checks">{build.regress.map(x => <li key={x.id} className={x.ok ? 'ok' : 'bad'}>{x.ok ? '🟢' : x.warn ? '🟡' : '🔴'} <b>{x.id}</b> {x.what}{!x.ok && <small className="muted"> — {x.bad.slice(0, 6).join(', ')}</small>}</li>)}</ul></div>}
      <details><summary>연결 개연성 검사</summary><ul>{build.checks.map((c, i) => <li key={i}>{c.ok ? '🟢' : '🔴'} {c.what} <small className="muted">{c.detail}</small></li>)}</ul></details>
      {build.hosts.missing.length > 0 && <p className="message warning">공간에 못 놓은 퍼즐 호스트: {build.hosts.missing.join(', ')}</p>}
      {build.notes.length > 0 && <details><summary>코드가 고친 것·메모 {build.notes.length}건</summary><ul>{build.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>}
      {build.lightStory && <p className="muted">빛 연출(기록만): {build.lightStory}</p>}
    </>}
    {sel.length > 0 && <details><summary>07 에셋 선정 — 고름 {sel.filter(s => s.pick).length} · 없음 {sel.filter(s => !s.pick).length}</summary>
      <table className="trial-table"><thead><tr><th>항목</th><th>방</th><th>역할</th><th>고른 에셋</th><th>이유 / 없는 것</th></tr></thead><tbody>
        {sel.map(s => <tr key={s.item_id}><td>{s.item_id} {s.name_ko}</td><td>{roomName(s.room)}</td><td>{s.role}</td><td>{s.pick ? <>{s.pick.thumbnail && <img src={s.pick.thumbnail} alt="" width="40" height="40" loading="lazy" />} {s.pick.nameKo}{s.pick.needsReplacement ? ' (임시본)' : ''}</> : '—'}</td><td><small>{s.pick ? s.reason : `없음: ${s.missing?.description_ko || s.missing?.why || ''}`}</small></td></tr>)}
      </tbody></table></details>}
    {plan && <details><summary>06 계획 원본 — 방 {plan.rooms?.length || 0} · 물건 {plan.contents?.length || 0}{plan.check?.hostsMissing?.length ? ` · 계획에서 빠진 호스트 ${plan.check.hostsMissing.length}` : ''}</summary><pre>{JSON.stringify({ rooms: plan.rooms, links: plan.links, light_story: plan.light_story, notes: plan.notes }, null, 1)}</pre></details>}
  </section>;
}

function StepCard({ step, state, previousDone, running, onEstimate, onRun, estimate, provider, onProvider, anchor }) {
  const status = state?.status || 'idle';
  return <li className={`trial-step ${status}`} id={anchor}>
    <div className="trial-step-head">
      <span className="trial-step-no">{step.no}</span>
      <div><strong>{step.label}</strong><small>{step.tier} · 출력 한도 {step.maxTokens.toLocaleString()} · 생각 양 {step.effort}</small></div>
      <span className={`pill trial-pill-${status}`}>{STATUS[status]}{status === 'running' && state.progressChars ? ` · ${state.progressChars.toLocaleString()}자` : ''}</span>
    </div>
    {estimate && <p className="trial-estimate">예상 — 입력 약 {estimate.inputTokensApprox.toLocaleString()} 토큰 · 보통 {usd(estimate.typicalUsd)} · 최악 {usd(estimate.worstUsd)} (지금까지 {usd(estimate.spentUsd)} / 예산 ${estimate.budgetUsd})</p>}
    {state?.provider === 'local' && <p className="trial-meta">로컬 모델 {state.model?.replace('local:', '')} · 무료 · {Math.round((state.ms || 0) / 1000)}초 · 출력 {state.outputTokens?.toLocaleString?.() ?? '—'} 토큰{state.truncated ? ' · ⚠️ 출력 한도에서 잘림' : ''}</p>}
    {state?.costUsd > 0 && <p className="trial-meta">쓴 돈 {usd(state.costUsd)} · 끝난 이유 {state.stopReason || '—'} · 출력 {state.outputTokens?.toLocaleString?.() ?? '—'} 토큰{state.thinkingTokens != null ? ` (그중 생각 ${state.thinkingTokens.toLocaleString()})` : ''}{state.thinkingParam === 'rejected' ? ' · ⚠️ 생각 양 지정을 API 가 받지 않아 빼고 실행' : ''}{state.truncated ? ' · ⚠️ 출력 한도에서 잘림 — 문서 끝이 빠졌을 수 있음' : ''}</p>}
    {state?.result && <p className="trial-meta">결과 — {Object.entries(state.result).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${typeof v === 'object' ? Object.entries(v).map(([a, b]) => `${a} ${b}`).join(' · ') : v}`).join(' · ')}</p>}
    {state?.error && <pre className="trial-error">{state.error}</pre>}
    <div className="button-row">
      {onProvider && <select className="trial-provider" value={provider} disabled={running} onChange={e => onProvider(e.target.value)} title="이 단계를 돌릴 모델"><option value="claude">Claude(유료)</option><option value="local">로컬 맥북(무료)</option></select>}
      {provider !== 'local' && <button className="secondary" onClick={onEstimate} disabled={running}>예상 비용</button>}
      <button onClick={onRun} disabled={running || !previousDone}>{status === 'done' || status === 'failed' ? '다시 실행' : '실행'}</button>
      {!previousDone && <small className="muted">앞 단계가 끝나야 실행할 수 있습니다.</small>}
    </div>
  </li>;
}

function Selection({ detail, reviewer, onDecide }) {
  const rows = detail.selection?.selections || [];
  const scenes = detail.scenes || [];
  const missing = rows.filter(r => !r.pick);
  if (!rows.length) return null;
  return <>
    <section className="panel">
      <div className="panel-head"><div><h2>05 에셋 선정 결과</h2><p>요구(REQ)마다 라이브러리 후보 12개 중 에이전트가 고른 것. 「임시본」은 코드 모형을 뽑은 임시 3D입니다.</p></div><span className="pill">고름 {rows.length - missing.length} · 없음 {missing.length}</span></div>
      {scenes.map(scene => {
        const list = rows.filter(r => r.scene_id === scene.scene_id);
        if (!list.length) return null;
        return <div key={scene.scene_id} className="trial-scene">
          <h3>{scene.scene_id} · {scene.title}</h3>
          <table className="trial-table"><thead><tr><th>요구</th><th>역할</th><th>고른 에셋</th><th>개수</th><th>이유</th></tr></thead><tbody>
            {list.map(r => <tr key={r.req_id} className={r.pick ? '' : 'trial-missing-row'}>
              <td><code>{r.req_id}</code><small>{r.req.category}{r.req.dressing_only ? ' · 장식' : ''}</small></td>
              <td>{r.req.role_hint}<small>{r.req.lore_reason}</small></td>
              <td>{r.pick ? <div className="trial-pick">{r.thumbnail ? <img src={r.thumbnail} alt="" loading="lazy" /> : <span className="trial-noimg">3D</span>}<span>{r.pickName}{r.needsReplacement && <em className="trial-temp">임시본</em>}<small>{r.pick}</small>{r.alternatives?.length > 0 && <small>차선: {r.alternatives.map(a => a.nameKo).join(', ')}</small>}</span></div> : <strong className="trial-none">라이브러리에 없음</strong>}{r.invalidPick && <small className="warning-text">후보 밖 ID를 답해 버림: {r.invalidPick}</small>}</td>
              <td>{r.pick ? r.count : '—'}</td>
              <td>{r.reason || r.missing?.why}</td>
            </tr>)}
          </tbody></table>
        </div>;
      })}
    </section>
    {missing.length > 0 && <section className="panel trial-missing">
      <div className="panel-head"><div><h2>라이브러리에 없음 — 신규 에셋이 필요한 곳</h2><p>대체 후보로 쓰거나, 생성 대기열에 넣거나, 빼고 갑니다. 생성 대기열은 지금은 기록만 하고 생성 공정(GIST 서버·외부 API)에 넘기기 전에 한 번 더 승인합니다.</p></div><span className="pill">{missing.length}건</span></div>
      <ul className="records">{missing.map(r => {
        const decision = detail.missingDecisions?.[r.req_id];
        const cands = detail.candidates?.[r.req_id] || [];
        return <li key={r.req_id}>
          <strong>{r.missing?.name_ko || r.req.role_hint} <code>{r.req_id}</code></strong>
          <span>{decision ? { substitute: `대체: ${decision.assetName || decision.assetId}`, queue: '생성 대기열', drop: '제외' }[decision.decision] : '판단 전'}</span>
          <small>{r.missing?.description_ko}{r.missing?.why ? ` — ${r.missing.why}` : ''}</small>
          <div className="trial-missing-actions">
            <select defaultValue="" onChange={e => { const c = cands.find(x => x.id === e.target.value); if (c) onDecide(r.req_id, { decision: 'substitute', assetId: c.id, assetName: c.nameKo }); }} disabled={!reviewer.trim() || !cands.length}>
              <option value="">대체 후보 고르기{cands.length ? ` (${cands.length})` : ' (후보 없음)'}</option>
              {cands.map(c => <option key={c.id} value={c.id}>{c.nameKo}{c.needsReplacement ? ' · 임시본' : ''} — {c.categoryKo}{c.era ? ` · ${c.era}` : ''}</option>)}
            </select>
            <button className="secondary" disabled={!reviewer.trim()} onClick={() => onDecide(r.req_id, { decision: 'queue' })}>생성 대기열</button>
            <button className="secondary" disabled={!reviewer.trim()} onClick={() => onDecide(r.req_id, { decision: 'drop' })}>제외</button>
            {decision && <button className="quiet" onClick={() => onDecide(r.req_id, { decision: null })}>되돌리기</button>}
          </div>
        </li>;
      })}</ul>
      {!reviewer.trim() && <small className="warning-text">검수자 이름을 위에 적어야 고를 수 있습니다.</small>}
      <small className="muted">대체로 고른 것은 06 배치 초안에 함께 들어갑니다(06을 다시 실행).</small>
    </section>}
  </>;
}

function Layout({ detail, reviewer, onOpenSpace, busy }) {
  const layout = detail.layout;
  if (!layout) return null;
  return <section className="panel">
    <div className="panel-head"><div><h2>06 공간 배치 초안</h2><p>나주 공간의 구역(물리 정보만)을 보고 에이전트가 처음부터 놓은 자리. 코드가 구역 사각형 밖·선정 밖 항목을 걸렀습니다.</p></div><span className="pill">놓음 {layout.accepted.length} · 뺌 {layout.rejected.length}</span></div>
    <table className="trial-table"><thead><tr><th>Scene</th><th>구역</th><th>이유</th></tr></thead><tbody>{(layout.sceneZones || []).map(z => <tr key={z.scene_id}><td>{z.scene_id}</td><td>{(z.zones || []).join(' · ')}</td><td>{z.reason}</td></tr>)}</tbody></table>
    {layout.rejected.length > 0 && <details><summary>뺀 항목 {layout.rejected.length}개</summary><ul>{layout.rejected.map(r => <li key={r.index}><code>{r.req_id}</code> {r.asset_id} — {r.why}</li>)}</ul></details>}
    {layout.warnings.length > 0 && <details><summary>겹침 경고 {layout.warnings.length}개</summary><ul>{layout.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
    <div className="button-row">
      <button onClick={onOpenSpace} disabled={busy || !reviewer.trim()}>{detail.reviewProjectId ? '빈 지형 검수 기록에 다시 가져오고 열기' : '빈 지형 공간에서 보기(시험 검수 기록 만들기)'}</button>
      <a className="button secondary" href={EMPTY_SPACE_URL} target="_blank" rel="noreferrer">빈 지형 게임 열기 ↗</a>
      <a className="button secondary" href={HUMAN_SPACE_URL} target="_blank" rel="noreferrer">사람이 만든 공간 열기 ↗</a>
    </div>
    <small className="muted">시험 검수 기록은 공간 승인을 해도 게임 데이터(manifest)에 반영하지 않습니다.</small>
  </section>;
}

// 배치 화면(10/19 미르: 「에이전트 시험란에서 실제 공간과 에셋을 골라 배치된 화면을 보게」)
//   공간(라이브러리 「게임 공간」) · 바탕(빈 지형 / 사람 공간 위 겹쳐 보기) · 보일 에셋을 고르고 「배치 화면 열기」 →
//   시험 검수 기록으로 진단 세션을 열어 실제 게임을 이 페이지 안에 띄운다. 게임은 &trial=<id> 로 /trials/<id>/places 를 읽어
//   에이전트가 놓은 자리에 실제 GLB 를 그린다(manifest 파일은 그대로).
const TRIAL_SPACES = [{ id: 'space:naju01-angam', name: '나주 앙암바위(야외 강변 절벽)', runtimeId: 'NAJU-01-EMPTY' }];
function PlacedView({ detail, reviewer, onChanged, onFocusItem }) {
  // 1판: layout.accepted(asset_id) · 2판: layout2.spots(assetId·layer)
  const v2 = detail.layout2?.version === 2;
  const accepted = useMemo(() => v2 ? detail.layout2.spots.filter(s => s.assetId).map(s => ({ asset_id: s.assetId, req_id: s.itemId, layer: s.layer })) : (detail.layout?.accepted || []), [v2, detail.layout2, detail.layout]);
  const picks = useMemo(() => {
    const byId = new Map();
    for (const item of accepted) {
      const row = byId.get(item.asset_id) || { id: item.asset_id, count: 0, reqs: new Set(), name: null, temp: false, thumbnail: null };
      row.count += 1; row.reqs.add(item.req_id);
      const sel = (detail.selection?.selections || []).find(s => s.pick === item.asset_id);
      if (sel) { row.name = sel.pickName; row.temp = sel.needsReplacement; row.thumbnail = sel.thumbnail; }
      for (const s2 of detail.selection2?.selections || []) { const p = s2.picks.find(x => x.id === item.asset_id); if (p) { row.name = p.nameKo; row.temp = p.needsReplacement; row.thumbnail = p.thumbnail; } }
      row.layer = item.layer || null;
      byId.set(item.asset_id, row);
    }
    return [...byId.values()].sort((a, b) => String(a.layer).localeCompare(String(b.layer)) || b.count - a.count);
  }, [accepted, detail.selection, detail.selection2]);
  const [spaceId, setSpaceId] = useState(TRIAL_SPACES[0].id);
  const [base, setBase] = useState('empty');
  const [off, setOff] = useState(() => new Set(detail.view?.off || []));
  const [launch, setLaunch] = useState(null);
  const [humanLaunch, setHumanLaunch] = useState(null);
  const [compare, setCompare] = useState(true);
  const [runtime, setRuntime] = useState(null);
  const [project, setProject] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  // 자리 고치기(10/20) — 에이전트가 놓은 물건 하나를 배치 화면에서 직접 옮기기·돌리기·크기·빼기
  const [edit, setEdit] = useState(null); // { item, assetId, asset, rawH, from:{x,z}, hidden }
  const [editDraft, setEditDraft] = useState(null);
  const [editMode, setEditMode] = useState('move');
  const [editSaving, setEditSaving] = useState(false);
  const frameRef = useRef(null);
  const humanRef = useRef(null);
  const sectionRef = useRef(null);
  // 위에서 보기(10/20) — 두 화면 카메라를 같은 높은 시점에 묶고 구역 안개를 걷는다. 「둘러보기로 돌아가기」로 풉니다.
  const holdRef = useRef([]);
  const [overview, setOverview] = useState(null);
  const releaseOverview = () => {
    for (const h of holdRef.current) { try { h.win.clearInterval(h.timer); Object.assign(h.focus, h.saved); } catch { /* 화면 닫힘 */ } }
    holdRef.current = []; setOverview(null);
  };
  const OVERVIEWS = { all: { name: '공간 전체', pos: [40, 42, 88], at: [40, 0, 22] }, z1: { name: '나루터(Z1) 쪽', pos: [8, 16, 58], at: [18, 0, 36] }, hill: { name: '언덕 뒤(Z3·Z4) 쪽', pos: [72, 24, 52], at: [55, 0, 16] }, west: { name: '서쪽 언덕', pos: [-12, 22, 30], at: [18, 0, 20] } };
  const showOverview = key => {
    releaseOverview();
    const v = OVERVIEWS[key]; const frames = [...(sectionRef.current?.querySelectorAll('iframe') || [])];
    for (const f of frames) {
      try {
        const win = f.contentWindow; const g = win.__game?.naju; if (!g) continue;
        const saved = { radiusM: g.focus.radiusM, openRadiusM: g.focus.openRadiusM, mistFactor: g.focus.mistFactor };
        Object.assign(g.focus, { radiusM: 200, openRadiusM: 200, mistFactor: 0 });
        const U = 10 / 3; // 게임 단위/미터(plan/sitePlan UNITS_PER_METER)
        const set = () => { g.camera.position.set(v.pos[0] * U, v.pos[1] * U, v.pos[2] * U); g.camera.lookAt(v.at[0] * U, v.at[1] * U, v.at[2] * U); g.camera.updateMatrixWorld(true); }; // 행렬을 바로 갱신 — 둘러보기 카메라가 낡은 방향으로 되돌리지 않게
        set(); holdRef.current.push({ win, timer: win.setInterval(set, 30), focus: g.focus, saved });
      } catch (err) { setError(`위에서 보기를 못 켰습니다: ${err.message}`); }
    }
    setOverview(key);
  };
  const shownCount = accepted.filter(item => !off.has(item.asset_id) && !off.has(`layer:${item.layer}`)).length;

  useEffect(() => {
    if (!launch || !project) return;
    const timer = setInterval(async () => { try { setProject(await api(`/projects/${project.id}`)); } catch { /* 다음 차례 */ } }, 4000);
    return () => clearInterval(timer);
  }, [launch, project?.id]);

  const agentWin = () => sectionRef.current?.querySelector('iframe')?.contentWindow;
  // 원래 자리 인스턴스를 잠시 숨김(고치는 동안 겹쳐 보이지 않게) — 취소하면 되살림
  const hideSpot = (key, x, z) => {
    const g = agentWin()?.__game?.naju; if (!g) return null;
    const T = g.THREE, U = 10 / 3, M = new T.Matrix4(), p = new T.Vector3(); let best = null;
    g.scene.traverse(o => {
      if (!o.isInstancedMesh || !o.userData?.trialItems || !o.userData.placeSpots) return;
      for (let i = 0; i < o.count; i++) {
        if (o.userData.trialItems[o.userData.placeSpots[i]]?.startsWith(key) !== true) continue;
        o.getMatrixAt(i, M); p.setFromMatrixPosition(M).applyMatrix4(o.matrixWorld);
        const d = Math.hypot(p.x / U - x, p.z / U - z);
        if (!best || d < best.d - 0.01) best = { d, list: [{ o, i }] }; else if (Math.abs(d - best.d) <= 0.01) best.list.push({ o, i });
      }
    });
    if (!best) return null;
    const saved = best.list.map(({ o, i }) => { const m = new T.Matrix4(); o.getMatrixAt(i, m); const z0 = m.clone().scale(new T.Vector3(0, 0, 0)); o.setMatrixAt(i, z0); o.instanceMatrix.needsUpdate = true; return { o, i, m }; });
    return () => { for (const { o, i, m } of saved) { o.setMatrixAt(i, m); o.instanceMatrix.needsUpdate = true; } };
  };
  // 작업대가 받는 고른 물체 위치는 게임 단위(1 m = 10/3) — 미터로
  const selM = () => selected?.position ? [selected.position[0] * 0.3, selected.position[1] * 0.3, selected.position[2] * 0.3] : null;
  const startEdit = async () => {
    if (!selected?.groupName?.startsWith('에이전트:')) return;
    if (!reviewer.trim()) { setError('검수자 이름을 위에 적은 뒤 고쳐 주세요.'); return; }
    const [item, assetId] = selected.groupName.slice(5).split('|');
    try {
      const { places } = await api(`/trials/${detail.id}/places`);
      const key = `${item}|${assetId}`;
      let best = null;
      const pm = selM();
      for (const pl of places) (pl.항목 || []).forEach((t, k) => { if (!t.startsWith(key)) return; const [x, z] = pl.자리[k]; const d = pm ? Math.hypot(x - pm[0], z - pm[2]) : 0; if (!best || d < best.d) best = { d, pl, k }; });
      if (!best) throw new Error('이 물건의 자리를 찾지 못했습니다. 배치를 다시 연 뒤 시도해 주세요.');
      const [x, z, rot = 0, hf = 1] = best.pl.자리[best.k];
      const rawH = best.pl.원래키 || best.pl.키m;
      const heightM = best.pl.키m * hf;
      const restore = hideSpot(key, x, z);
      setEdit({ item, assetId, asset: best.pl.에셋, rawH, from: { x, z }, restore, name: best.pl.에셋?.nameKo });
      setEditMode('move');
      releaseOverview(); // 위에서 보기 시점 고정을 풀어야 손잡이로 끌 수 있다
      frameRef.current?.post('kgeseo-review-place-start', { asset: best.pl.에셋, at: { x, y: pm?.[1] ?? 0, z }, rotationY: rot, scale: heightM / rawH });
    } catch (err) { setError(err.message); }
  };
  const cancelEdit = () => { frameRef.current?.post('kgeseo-review-place-cancel'); edit?.restore?.(); setEdit(null); setEditDraft(null); setEditSaving(false); };
  const saveEdit = async (to) => {
    setEditSaving(true);
    try {
      await api(`/trials/${detail.id}/spot-edit`, { method: 'POST', body: { itemId: edit.item, assetId: edit.assetId, from: edit.from, to, reviewer } });
      setEdit(null); setEditDraft(null); setSelected(null);
      onChanged(); await open();
    } catch (err) { setError(err.message); } finally { setEditSaving(false); }
  };
  const onGameMessage = message => {
    if (!edit) return;
    if (message.type === 'kgeseo-review-place-changed') setEditDraft(message.draft || null);
    if (message.type === 'kgeseo-review-place-committed' && message.draft) {
      const d = message.draft;
      saveEdit({ x: d.position.x, z: d.position.z, rotationY: d.rotationY, heightM: d.scale * edit.rawH });
    }
  };
  const removeSelected = async () => {
    if (!selected?.groupName?.startsWith('에이전트:')) return;
    if (!reviewer.trim()) { setError('검수자 이름을 위에 적은 뒤 빼 주세요.'); return; }
    const [item, assetId] = selected.groupName.slice(5).split('|');
    if (!confirm(`「${item}」 이 자리를 뺄까요? (판정 기록에 남습니다)`)) return;
    const pm = selM() || [0, 0, 0];
    setEdit({ item, assetId, from: { x: pm[0], z: pm[2] } });
    await api(`/trials/${detail.id}/spot-edit`, { method: 'POST', body: { itemId: item, assetId, from: { x: pm[0], z: pm[2] }, to: null, reviewer } }).then(async () => { setEdit(null); setSelected(null); onChanged(); await open(); }).catch(err => { setEdit(null); setError(err.message); });
  };
  const close = async () => {
    releaseOverview();
    for (const ref of [frameRef, humanRef]) { try { await ref.current?.flush(); } catch { /* 진단 기록이라 넘긴다 */ } }
    setLaunch(null); setHumanLaunch(null); setSelected(null);
  };
  const open = async () => {
    setBusy(true); setError('');
    try {
      if (launch) await close();
      let projectId = detail.reviewProjectId;
      if (!projectId) {
        if (!reviewer.trim()) throw new Error('처음 열 때는 위 「검수자」 칸에 이름을 적어 주세요(시험 검수 기록을 만듭니다).');
        projectId = (await api(`/trials/${detail.id}/space`, { method: 'POST', body: { reviewer } })).projectId;
        onChanged();
      }
      await api(`/trials/${detail.id}/view`, { method: 'POST', body: { off: [...off] } });
      const boot = await api('/bootstrap');
      const space = TRIAL_SPACES.find(s => s.id === spaceId);
      const rt = boot.runtimes?.find(r => r.id === space.runtimeId);
      if (!rt) throw new Error('빈 지형 실행 구성(NAJU-01-EMPTY)이 없습니다. 공개 에셋 구성을 확인하세요.');
      let current = await api(`/projects/${projectId}`);
      const newSession = async () => {
        try { return await api(`/projects/${projectId}/sessions`, { method: 'POST', body: { expectedRevision: current.revision, kind: 'space', mode: 'diagnostic' } }); }
        catch (err) {
          if (err.status !== 409) throw err;
          // 게임 코드·참조가 바뀌었으면 시험 검수 기록을 현재 자료로 다시 연다(시험 기록이라 게임 데이터 반영 없음)
          current = await api(`/projects/${projectId}`, { method: 'PATCH', body: { expectedRevision: current.revision } });
          return api(`/projects/${projectId}/sessions`, { method: 'POST', body: { expectedRevision: current.revision, kind: 'space', mode: 'diagnostic' } });
        }
      };
      // variant: agent(에이전트 배치) · model(사람 모범답안 — 빈 지형·시험 배치 없이 사람이 만든 그대로)
      const build = async variant => {
        const session = await newSession();
        const url = new URL(rt.url, location.origin);
        if (variant === 'model' || base === 'human') url.searchParams.delete('base');
        if (variant === 'agent') url.searchParams.set('trial', detail.id);
        url.searchParams.set('review', '1'); url.searchParams.set('reviewProject', projectId);
        url.searchParams.set('reviewSession', session.id); url.searchParams.set('reviewKind', session.kind);
        url.searchParams.set('reviewMode', session.mode); url.searchParams.set('gameRevision', session.gameRevision);
        url.hash = new URLSearchParams({ reviewToken: session.token }).toString();
        return { session, url: url.toString(), visual: true };
      };
      const agent = await build('agent');
      const model = compare ? await build('model') : null;
      setRuntime({ ...rt, title: `${space.name} · ${base === 'human' ? '사람 공간 + 에이전트 배치' : '에이전트 배치(빈 지형에서 시작)'}`, presentation: `에이전트 배치 ${shownCount}자리` });
      setProject(await api(`/projects/${projectId}`));
      setLaunch(agent); setHumanLaunch(model);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const toggle = id => setOff(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const [agentScene, setAgentScene] = useState(1);
  // 씬 보기(10/20) — 에이전트 화면의 「지금 씬」을 정한다(게임 publicAssets ③-2 가 window.__agentTrialScene 을 읽음). -1 = 모든 씬
  const showScene = (n, z) => {
    const f = sectionRef.current?.querySelector('iframe');
    try { if (f?.contentWindow) f.contentWindow.__agentTrialScene = n; } catch (err) { setError(err.message); }
    setAgentScene(n);
    if (z?.zones?.length) jump(`${z.zones[0]}-wide`);
  };
  const jump = viewId => { releaseOverview(); for (const ref of [frameRef, humanRef]) ref.current?.view(viewId).catch(err => setError(err.message)); };
  const wideViews = (runtime?.visualViews || []).filter(view => view.id.endsWith('-wide'));
  const events = project?.sessions?.find(s => s.id === launch?.session.id)?.events || [];
  const humanEvents = project?.sessions?.find(s => s.id === humanLaunch?.session.id)?.events || [];
  if (!accepted.length) return null;
  return <section className="panel trial-placed" ref={sectionRef}>
    <div className="panel-head"><div><h2>배치 화면</h2><p>실제 나주 공간에 에이전트가 고른 에셋을 실제 3D로 놓아 봅니다. 공간·바탕·보일 에셋을 고른 뒤 「배치 화면 열기」. 바꾼 뒤에는 다시 열어야 반영됩니다.</p></div><span className="pill">보임 {shownCount} / {accepted.length}자리</span></div>
    <div className="trial-placed-pick">
      <label className="field"><span>공간(라이브러리 「게임 공간」)</span><select value={spaceId} onChange={e => setSpaceId(e.target.value)}>{TRIAL_SPACES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="trial-compare-check"><input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} /> 사람 모범답안을 옆에 나란히 띄워 같은 시점으로 비교</label>
      <label className="field"><span>바탕</span><select value={base} onChange={e => setBase(e.target.value)}><option value="empty">빈 지형(지형·강·절벽·원경만) + 에이전트 배치</option><option value="human">사람이 만든 공간 위에 겹쳐 보기</option></select></label>
    </div>
    <div className="trial-placed-assets">
      <div className="trial-placed-assets-head"><b>보일 에셋 {picks.length - picks.filter(p => off.has(p.id)).length}/{picks.length}종</b><button className="quiet" onClick={() => setOff(new Set())}>모두 켜기</button><button className="quiet" onClick={() => setOff(new Set(picks.map(p => p.id)))}>모두 끄기</button>{v2 && ['environment', 'content', 'cast'].map(l => <label key={l} className="trial-layer-toggle"><input type="checkbox" checked={!off.has(`layer:${l}`)} onChange={() => toggle(`layer:${l}`)} /> {{ environment: '배경', content: '구역 내용', cast: '인물' }[l]}</label>)}</div>
      <ul>{picks.map(p => <li key={p.id} className={off.has(p.id) ? 'off' : ''}><label>
        <input type="checkbox" checked={!off.has(p.id)} onChange={() => toggle(p.id)} />
        {p.thumbnail ? <img src={p.thumbnail} alt="" loading="lazy" /> : <span className="trial-noimg">3D</span>}
        <span>{p.name || p.id}{p.temp && <em className="trial-temp">임시본</em>}<small>{p.count}자리{p.layer ? ` · ${{ environment: '배경', content: '구역 내용', cast: '인물' }[p.layer] || p.layer}` : ''} · {[...p.reqs].slice(0, 4).join(', ')}</small></span>
      </label></li>)}</ul>
    </div>
    <div className="button-row">
      <button onClick={open} disabled={busy || !shownCount}>{busy ? '여는 중…' : launch ? '고른 대로 다시 열기' : '배치 화면 열기'}</button>
      {launch && <button className="secondary" onClick={close}>닫기</button>}
      {!detail.reviewProjectId && !reviewer.trim() && <small className="warning-text">처음 열 때는 위 「검수자」 이름이 필요합니다.</small>}
    </div>
    {error && <div className="message error" role="alert">{error}<button className="quiet" onClick={() => setError('')}>×</button></div>}
    {launch && <>
      <div className="trial-placed-jumps">
        <span>씬 보기</span>{((v2 ? detail.layout2.sceneZones : detail.layout?.sceneZones) || []).map((z, i) => <button key={z.scene_id} className={agentScene === i + 1 ? '' : 'secondary'} onClick={() => showScene(i + 1, z)} disabled={!z.zones?.length}>{z.scene_id} → {(z.zones || []).join('·')}</button>)}
        <button className={agentScene === -1 ? '' : 'secondary'} onClick={() => showScene(-1)}>모든 씬 겹쳐 보기</button>
        <small className="muted">에이전트 화면에 그 씬에서 보이는 물건·인물만 남깁니다(사건 뒤 흔적은 그 씬부터).</small>
      </div>
      <div className="trial-placed-jumps"><span>위에서 보기</span>{Object.entries(OVERVIEWS).map(([k, v]) => <button key={k} className={overview === k ? '' : 'secondary'} onClick={() => showOverview(k)}>{v.name}</button>)}{overview && <button className="quiet" onClick={releaseOverview}>둘러보기로 돌아가기</button>}<small className="muted">두 화면이 같은 높은 시점으로 묶이고 구역 안개가 걷힙니다.</small></div>
      {wideViews.length > 0 && <div className="trial-placed-jumps"><span>구역</span>{wideViews.map(view => <button key={view.id} className="secondary" onClick={() => jump(view.id)}>{view.zoneId} · {view.zoneName}</button>)}</div>}
      <div className={humanLaunch ? 'trial-side-by-side' : ''}>
        <GameReviewFrame launch={launch} runtime={runtime} projectId={project?.id} events={events} stale={false} controlRef={frameRef} visual
          onObjectSelected={setSelected} onGameMessage={onGameMessage} onClose={close} onForceClose={() => { setLaunch(null); setHumanLaunch(null); setSelected(null); }} onReturn={() => {}} />
        {humanLaunch && <GameReviewFrame launch={humanLaunch} runtime={{ ...runtime, title: '사람 모범답안(현재 나주 공간)', presentation: '사람이 만든 그대로' }} projectId={project?.id} events={humanEvents} stale={false} controlRef={humanRef} visual
          onObjectSelected={setSelected} onGameMessage={() => {}} onClose={close} onForceClose={() => { setLaunch(null); setHumanLaunch(null); }} onReturn={() => {}} />}
      </div>
      {selected?.groupName?.startsWith('에이전트:') && !edit && <p className="trial-meta">에이전트 항목 <code>{selected.groupName.slice(5).split('|')[0]}</code> <button onClick={startEdit}>이 자리 고치기(옮기기·돌리기·크기)</button> <button className="secondary" onClick={removeSelected}>이 자리 빼기</button> <button className="secondary" onClick={() => onFocusItem?.(selected.groupName.slice(5).split('|')[0])}>이 항목 판정하러 가기</button></p>}
      {edit && edit.asset && <PlacementAdjustPanel draft={editDraft} asset={{ nameKo: edit.name }} mode={editMode} note="" saving={editSaving} disabled={false} replacing={null}
        onNote={() => {}} onMode={m => { setEditMode(m); frameRef.current?.post('kgeseo-review-place-adjust', { mode: m }); }}
        onAdjust={patch => frameRef.current?.post('kgeseo-review-place-adjust', patch)} onCancel={cancelEdit}
        onCommit={() => frameRef.current?.post('kgeseo-review-place-commit')} />}
      {edit && edit.asset && <small className="muted">확정하면 이 시험의 배치에 바로 반영되고, 그 항목은 「승인(고정)」으로 기록돼 다시 깔아도 이 자리를 지킵니다. 높이(Y)는 땅에 붙여 다시 앉힙니다.</small>}
      {selected && <p className="trial-meta">고른 물체: <b>{selected.name || selected.groupName || '이름 없음'}</b>{selected.zoneId ? ` · ${selected.zoneId}` : ''}{selected.position ? ` · X ${(selected.position[0] * 0.3).toFixed(1)} Z ${(selected.position[2] * 0.3).toFixed(1)} m` : ''}</p>}
    </>}
  </section>;
}

// ── 공정 2판 화면(10/19) — 05 퍼즐 초안 · 06 공간 구성 · 07 에셋 선정 · 08 배치 자기 검사 ──
const ROLE_KO = { facility: '시설', life_trace: '생활 흔적', landmark: '기준물', story_prop: '이야기 물건', puzzle_host: '퍼즐 호스트', cast: '인물' };
const DENSITY_KO = { sparse: '성김', medium: '보통', dense: '빽빽' };
const PUZZLE_TYPE_KO = { code_input: '숫자·암호 입력', text_input: '글자 입력', single_choice: '하나 고르기', multiple_choice: '여럿 고르기', observation: '살펴서 찾기', navigation: '그 자리로 가기', clue_combination: '단서 2개 짝짓기' };
const ACT_KO = { inspect: '살피기', navigate: '가기', input: '입력', select: '고르기', combine_clues: '단서 짝짓기' };
export function PuzzleDraft({ detail }) {
  const p = detail.puzzle;
  if (!p) return null;
  // 호스트 → 실제 에셋·놓임(06 serves · 07 선정 · 08 배치)
  const plan = detail.spacePlan; const sel = detail.selection2?.selections || []; const spots = detail.layout2?.spots || [];
  const hostOf = needId => [...(plan?.contents || []), ...(plan?.cast || [])].filter(c => (c.serves || []).includes(needId)).map(c => {
    const pick = sel.find(x => x.item_id === c.item_id)?.picks?.[0];
    return { id: c.item_id, name: c.name_ko, asset: c.role === 'marker' ? '자리 표식' : pick?.nameKo || '에셋 없음', placed: spots.some(sp => sp.itemId === c.item_id) };
  });
  const v2 = (p.puzzles || []).some(z => z.puzzle_type);
  return <section className="panel">
    <div className="panel-head"><div><h2>05 퍼즐 초안</h2><p>{v2 ? '팀 계약(행동 5종: 살피기·가기·입력·고르기·단서 짝짓기 / 퍼즐 7유형 / 힌트 2단계)에 맞춘 퍼즐. 단서를 주는 물건과 답을 넣는 자리가 공간의 어떤 에셋으로 놓였는지 함께 보입니다.' : '에셋을 모르는 상태에서 설화·Scene 만 보고 만든 퍼즐 틀(옛 형식 — 계약 미적용).'}</p></div><span className="pill">퍼즐 {p.puzzles?.length || 0}{p.check?.missing?.length ? ` · 배정 안 된 발견 ${p.check.missing.length}` : ''}</span></div>
    {(p.check?.contract?.length > 0 || p.check?.fun?.length > 0) && <div className="message warning">{[...(p.check.contract || []), ...(p.check.fun || [])].join(' · ')}</div>}
    {p.check && v2 && !p.check.contract?.length && !p.check.fun?.length && <div className="message">🟢 계약 검사·재미 검사 통과</div>}
    <table className="trial-table"><thead><tr><th>퍼즐</th><th>플레이어가 하는 일 → 알게 되는 것</th><th>단서 · 풀이</th><th>필요한 물건 → 놓인 에셋</th></tr></thead><tbody>
      {(p.puzzles || []).map(z => <tr key={z.puzzle_id} className={z.status === 'blocked_by_story_input' ? 'trial-missing-row' : ''}>
        <td><code>{z.puzzle_id}</code><small>{z.scene_id} · {z.difficulty}{z.puzzle_type ? ` · ${PUZZLE_TYPE_KO[z.puzzle_type] || z.puzzle_type}` : z.player_action ? ` · ${z.player_action}(옛 이름)` : ''}</small><b>{z.title}</b></td>
        <td>{z.belief_before && <small>믿던 것: {z.belief_before}</small>}{z.how} → <b>{z.learns}</b>{z.blocked_reason && <small className="warning-text">막힘: {z.blocked_reason}</small>}</td>
        <td>{(z.clues || []).map(c => <small key={c.clue_id}><code>{c.clue_id}</code> {ACT_KO[c.get_by] || c.get_by} {c.from} — {c.text}</small>)}
          {z.solve && <small><b>풀이: {ACT_KO[z.solve.interaction] || z.solve.interaction} @ {z.solve.at}</b> — {z.solve.prompt}{z.solve.options ? ` [${z.solve.options.join(' / ')}]` : ''} · 정답 <b>{String(z.solve.answer ?? '')}</b><br />근거: {z.solve.answer_from}</small>}
          {(z.hint_1 || z.hint_2) && <small>힌트1: {z.hint_1} · 힌트2: {z.hint_2}</small>}
          {z.invented?.length > 0 && <small className="muted">게임 장치로 지은 것: {z.invented.join(' · ')}</small>}</td>
        <td>{(z.host_needs || []).map(h => { const hs = hostOf(h.need_id); return <small key={h.need_id}><code>{h.need_id}</code> {h.kind}{h.gives?.length ? ` (단서 ${h.gives.join(',')})` : ''} — {h.what}<br />→ {hs.length ? hs.map(x => `${x.name} = ${x.asset}${x.placed ? '' : ' (안 놓임)'}`).join(' · ') : <span className="warning-text">06 이 아직 안 받음</span>}</small>; })}</td>
      </tr>)}
    </tbody></table>
  </section>;
}
function SpacePlan({ detail }) {
  const p = detail.spacePlan;
  if (!p) return null;
  return <section className="panel">
    <div className="panel-head"><div><h2>06 공간 구성</h2><p>이야기 장소를 공간 구역에 맞추고, 장소 쓰임에서 나오는 시설·생활 흔적·인물과 배경 층을 계획했습니다. 좌표는 08에서 코드가 정합니다.</p></div><span className="pill">내용 {p.contents?.length || 0} · 인물 {p.cast?.length || 0} · 배경 층 {p.environment?.length || 0}{p.check?.problems?.length ? ` · 문제 ${p.check.problems.length}` : ''}</span></div>
    {p.check?.problems?.length > 0 && <div className="message warning">{p.check.problems.join(' · ')}</div>}
    <h3 className="trial-h3">장소 맞추기</h3>
    <table className="trial-table"><tbody>{(p.place_map || []).map((m, i) => <tr key={i}><td>{m.place}<small>{(m.from || []).join(', ')}</small></td><td><b>{m.zone}</b></td><td>{m.reason}</td></tr>)}</tbody></table>
    <h3 className="trial-h3">Scene → 구역</h3>
    <table className="trial-table"><tbody>{(p.scene_zones || []).map(z => <tr key={z.scene_id}><td>{z.scene_id}</td><td><b>{(z.zones || []).join(' · ')}</b></td><td>{z.reason}</td></tr>)}</tbody></table>
    <h3 className="trial-h3">구역 내용 · 인물</h3>
    <table className="trial-table"><thead><tr><th>항목</th><th>역할</th><th>구역·자리</th><th>근거</th></tr></thead><tbody>
      {[...(p.contents || []), ...(p.cast || []).map(c => ({ ...c, role: 'cast', why: `${(c.basis || []).join(',')} · ${c.activity || ''}`, region: { kind: 'zone' } }))].map(c => <tr key={c.item_id}>
        <td><code>{c.item_id}</code> {c.name_ko}<small>{c.arrangement || 'single'} × {c.count || 1} · {(c.size_m || []).join('~')} m</small></td>
        <td>{ROLE_KO[c.role] || c.role}{c.serves?.length ? <small>{c.serves.join(', ')}</small> : null}</td>
        <td>{c.zone} · {c.region?.kind}<small>{c.position_hint}</small></td><td>{c.why}</td>
      </tr>)}
    </tbody></table>
    <h3 className="trial-h3">배경 층</h3>
    <table className="trial-table"><tbody>{(p.environment || []).map(e => <tr key={e.layer_id}><td><code>{e.layer_id}</code> {e.name_ko}<small>{e.class} · {(e.size_m || []).join('~')} m · {e.pattern}</small></td><td>{e.region?.kind}{e.region?.zones?.length ? ` (${e.region.zones.join('/')} 근처)` : ''}</td><td>{DENSITY_KO[e.density] || e.density}</td><td>{e.why}</td></tr>)}</tbody></table>
  </section>;
}
function Selection2({ detail, reviewer, onDecide }) {
  const rows = detail.selection2?.selections || [];
  if (!rows.length) return null;
  const missing = rows.filter(r => !r.picks.length);
  return <section className="panel">
    <div className="panel-head"><div><h2>07 에셋 선정</h2><p>06 계획의 구체 물건 이름으로 라이브러리를 검색해 고른 것. 배경 층은 모양이 다른 것 2~3개를 섞습니다.</p></div><span className="pill">고름 {rows.length - missing.length} · 없음 {missing.length}</span></div>
    <table className="trial-table"><tbody>{rows.map(r => <tr key={r.item_id} className={r.picks.length ? '' : 'trial-missing-row'}>
      <td><code>{r.item_id}</code> {r.name_ko}<small>{r.kind}</small></td>
      <td>{r.picks.length ? r.picks.map(p => <div key={p.id} className="trial-pick">{p.thumbnail ? <img src={p.thumbnail} alt="" loading="lazy" /> : <span className="trial-noimg">3D</span>}<span>{p.nameKo}{p.needsReplacement && <em className="trial-temp">임시본</em>}<small>{p.id}</small></span></div>) : <strong className="trial-none">라이브러리에 없음</strong>}</td>
      <td>{r.reason || r.missing?.why}{!r.picks.length && <div className="trial-missing-actions">
        <span className="muted">{detail.missingDecisions?.[r.item_id] ? { substitute: '대체 지정', queue: '생성 대기열', drop: '제외' }[detail.missingDecisions[r.item_id].decision] : '판단 전'}</span>
        <button className="secondary" disabled={!reviewer.trim()} onClick={() => onDecide(r.item_id, { decision: 'queue' })}>생성 대기열</button>
        <button className="secondary" disabled={!reviewer.trim()} onClick={() => onDecide(r.item_id, { decision: 'drop' })}>제외</button>
      </div>}</td>
    </tr>)}</tbody></table>
  </section>;
}
function SelfCheck({ detail, onRelayout }) {
  const l = detail.layout2;
  if (!l) return null;
  const failed = l.selfCheck.checks.filter(c => !c.ok);
  return <section className="panel">
    <div className="panel-head"><div><h2>08 배치 · 자기 검사</h2><p>사람 답안 없이 돌리는 검사: 걷지 않는 땅이 비었나 · 원문 인물이 다 있나 · 퍼즐 호스트가 놓였나 · 구역마다 물건이 있나 · 배경 층이 깔렸나 · 땅에 제대로 앉았나(뜸·박힘·물 위·차단물).</p></div><span className={`pill ${failed.length ? 'amber' : ''}`}>놓음 {l.spots.length} · 실패 {failed.length}/{l.selfCheck.checks.length}</span></div>
    {l.previous && <p className="trial-meta">09 고치기 전: {l.previous.spots}자리 · 실패 {l.previous.failed} → 지금 {l.spots.length}자리 · 실패 {failed.length}</p>}
    {l.metrics && <table className="trial-table"><thead><tr><th>구역 둘레(12 m)</th><th>나무</th><th>덤불</th><th>풀·꽃·갈대</th><th>돌</th><th>낱개 물건</th><th>키 큰 덩어리 덮임</th></tr></thead><tbody>{l.metrics.map(m => <tr key={m.zone}><td>{m.zone}</td><td>{m.tree}</td><td>{m.shrub}</td><td>{m.low}</td><td>{m.rock}</td><td>{m.discrete}</td><td>{m.tallCover}%</td></tr>)}</tbody></table>}
    {onRelayout && <p className="trial-meta"><button className="secondary" onClick={onRelayout}>코드만 다시 앉히기(무료)</button> 계획·선정·자리 힌트는 그대로 두고 배치 코드(땅에 앉히기·겹침)만 다시 돌립니다.{l.relayout ? ` · 다시 앉힌 횟수 ${l.relayout}` : ''}</p>}
    <ul className="trial-checks">{l.selfCheck.checks.map((c, i) => <li key={i} className={c.ok ? 'ok' : 'bad'}>{c.ok ? '🟢' : '🔴'} <b>{c.id}</b> {c.detail}</li>)}</ul>
  </section>;
}

// ── 항목 판정(10/19) — 사람 검수 의견이 원인 단계로 돌아간다(10 단계). 게임에서 물체를 눌러 남긴 의견도 여기로 온다 ──
const VERDICT_KO = { approve: '승인(고정)', swap: '다른 에셋으로', adjust: '위치·수량·밀도', replan: '계획부터 다시', remove: '빼', regenerate: '새로 만들어' };
const VERDICT_STEP = { approve: '그대로 고정', swap: '07 선정 다시(그 항목만)', adjust: '08·09 자리·밀도 다시', replan: '06 계획 다시 → 07·08', remove: '계획에서 지움', regenerate: '생성 대기열' };
function ItemRow({ row, fb, reviewer, onSave, highlight }) {
  const [verdict, setVerdict] = useState(fb?.verdict || '');
  const [note, setNote] = useState(fb?.note || '');
  const [assetId, setAssetId] = useState(fb?.assetId || '');
  useEffect(() => { setVerdict(fb?.verdict || ''); setNote(fb?.note || ''); setAssetId(fb?.assetId || ''); }, [fb?.at]);
  const status = !fb ? '판정 전' : fb.status === 'locked' ? '고정' : fb.status === 'resolved' ? `반영됨 r${fb.resolvedRound}` : '반영 대기';
  return <tr id={`item-${row.id}`} className={highlight ? 'trial-item-hl' : ''}>
    <td><code>{row.id}</code> {row.name}<small>{row.kindKo} · {row.where} · 놓은 수 {row.placed}{fb?.source === 'object-issue' ? ' · 게임에서 남긴 의견' : ''}</small></td>
    <td>{row.assets || <span className="trial-none">에셋 없음</span>}</td>
    <td className="trial-verdict">
      <select value={verdict} onChange={e => setVerdict(e.target.value)}><option value="">— 판정 —</option>{Object.entries(VERDICT_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      {verdict === 'swap' && row.candidates?.length > 0 && <select value={assetId} onChange={e => setAssetId(e.target.value)}><option value="">에이전트가 다시 고름</option>{row.candidates.map(c => <option key={c.id} value={c.id}>{c.nameKo}{c.needsReplacement ? ' · 임시본' : ''}</option>)}</select>}
      <input value={note} onChange={e => setNote(e.target.value)} placeholder={verdict === 'adjust' ? '예: 물가 쪽으로 · 3개로 · 더 빽빽하게' : verdict === 'replan' ? '예: 여기엔 어구가 아니라 배 매는 시설이 맞다' : '메모(에이전트가 따름)'} maxLength={1000} />
      <button className="secondary" disabled={!verdict || !reviewer.trim()} onClick={() => onSave(row, { verdict, note, assetId: assetId || undefined, assetName: row.candidates?.find(c => c.id === assetId)?.nameKo })}>저장</button>
      {fb && <button className="quiet" onClick={() => onSave(row, { verdict: null })}>지우기</button>}
      <small>{status}{verdict ? ` → ${VERDICT_STEP[verdict]}` : ''}</small>
    </td>
  </tr>;
}
function ItemReview({ detail, reviewer, onChanged, onRework, focusItem }) {
  useEffect(() => { if (focusItem) document.getElementById(`item-${focusItem}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [focusItem]);
  const plan = detail.spacePlan; const l = detail.layout2;
  if (!plan || !l) return null;
  const sel = new Map((detail.selection2?.selections || []).map(s => [s.item_id, s]));
  const placed = id => l.spots.filter(s => s.itemId === id).length;
  const assetsOf = id => (sel.get(id)?.picks || []).map(p => p.nameKo).join(', ');
  const rows = [
    ...(plan.contents || []).map(c => ({ id: c.item_id, name: c.name_ko, kindKo: ROLE_KO[c.role] || c.role, where: `${c.zone} · ${c.region?.kind}`, placed: placed(c.item_id), assets: c.role === 'marker' ? '자리 표식' : assetsOf(c.item_id), candidates: sel.get(c.item_id)?.candidates })),
    ...(plan.cast || []).map(c => ({ id: c.item_id, name: c.name_ko, kindKo: '인물', where: c.zone, placed: placed(c.item_id), assets: assetsOf(c.item_id), candidates: sel.get(c.item_id)?.candidates })),
    ...(plan.environment || []).map(e => ({ id: e.layer_id, name: e.name_ko, kindKo: `배경 층 · ${e.class}`, where: `${e.region?.kind}${e.region?.zones?.length ? ` ${e.region.zones.join('/')}` : ''} · ${DENSITY_KO[e.density] || e.density}`, placed: placed(e.layer_id), assets: assetsOf(e.layer_id), candidates: sel.get(e.layer_id)?.candidates })),
  ];
  const fb = detail.feedback || {};
  const open = Object.values(fb).filter(f => f.status === 'open').length;
  const save = async (row, body) => {
    try { await api(`/trials/${detail.id}/feedback`, { method: 'POST', body: { itemId: row.id, name: row.name, reviewer, ...body } }); onChanged(); } catch (err) { alert(err.message); }
  };
  return <section className="panel trial-items">
    <div className="panel-head"><div><h2>항목 판정 — 사람 검수</h2><p>항목마다 판정과 메모를 남기면 「의견 반영해 다시 돌리기」가 원인 단계만 다시 돌립니다(에셋 → 07, 자리·수량 → 08·09, 계획 → 06, 없음·모양 불량 → 생성 대기열). 승인한 항목은 자리를 고정합니다. 배치 화면이나 검수 작업대에서 물체를 눌러 남긴 의견도 여기로 옵니다.</p></div><span className="pill">반영 대기 {open}{detail.feedbackRound ? ` · 반영 ${detail.feedbackRound}회` : ''}</span></div>
    <div className="button-row"><button disabled={!open} onClick={onRework}>의견 반영해 다시 돌리기(10 단계)</button>{!reviewer.trim() && <small className="warning-text">위 「검수자」 이름이 있어야 판정을 저장합니다.</small>}</div>
    <table className="trial-table"><thead><tr><th>항목</th><th>고른 에셋</th><th>판정 · 메모</th></tr></thead><tbody>
      {rows.map(r => <ItemRow key={r.id} row={r} fb={fb[r.id]} reviewer={reviewer} onSave={save} highlight={focusItem === r.id} />)}
    </tbody></table>
    {detail.generationQueue?.length > 0 && <details><summary>생성 대기열 {detail.generationQueue.length}건</summary><ul>{detail.generationQueue.map((q, i) => <li key={i}><code>{q.itemId}</code> {q.name} — {q.note || '메모 없음'} ({q.status}, {q.reviewer})</li>)}</ul><small className="muted">생성 공정(맥북 이미지 → GIST 3D → G2 관문)과는 아직 연결 전입니다. 입고되면 그 항목만 07이 다시 고릅니다.</small></details>}
    {detail.feedbackLog?.length > 0 && <details><summary>반영 이력 {detail.feedbackLog.length}회</summary><ul>{detail.feedbackLog.map(r => <li key={r.round}>r{r.round} · {date(r.at)} · {r.summary} · {r.applied.length}건</li>)}</ul></details>}
  </section>;
}

function Compare({ trialId, version }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/trials/${trialId}/compare`).then(setData, err => setError(err.message)); }, [trialId, version]);
  if (error) return <div className="message error">{error}</div>;
  if (!data) return null;
  return <section className="panel">
    <div className="panel-head"><div><h2>사람본과 비교</h2><p>사람이 쓴 문서·만든 공간은 읽기만 했습니다. 숫자는 같은 기준으로 센 값이며, 사람본은 다른 출처(SRC-02~06)도 썼습니다.</p></div></div>
    <table className="trial-table"><thead><tr><th>항목</th><th>사람본</th><th>에이전트</th></tr></thead><tbody>{data.docs.map(([k, h, a]) => <tr key={k}><td>{k}</td><td>{String(h)}</td><td>{a == null ? '—' : String(a)}</td></tr>)}</tbody></table>
    <div className="trial-compare-space">
      <div><h3>사람 공간의 물체 무리 {data.space.human.objectGroups.length}종</h3><p className="muted">{data.space.human.objectGroups.join(' · ') || '대조표 없음'}</p></div>
      <div><h3>에이전트가 고른 에셋 {data.space.agent.picks.length}종 · 놓은 자리 {data.space.agent.placed}개</h3><p className="muted">{data.space.agent.picks.map(p => `${p.name}×${p.count}`).join(' · ') || '아직 없음'}</p></div>
    </div>
  </section>;
}

export default function AgentTrialPage({ onOpenProject, onOpenIndoor }) {
  const [list, setList] = useState(null);
  const [trialId, setTrialId] = useState(() => new URLSearchParams(location.search).get('trial') || '');
  const [detail, setDetail] = useState(null);
  const [estimates, setEstimates] = useState({});
  const [error, setError] = useState('');
  // 검수자 이름은 이 브라우저에 기억 — 배치 화면을 처음 열 때마다 막히지 않게(10/20)
  const [reviewer, setReviewerRaw] = useState(() => { try { return localStorage.getItem('agentTrialReviewer') || ''; } catch { return ''; } });
  const setReviewer = value => { setReviewerRaw(value); try { localStorage.setItem('agentTrialReviewer', value); } catch { /* 저장 안 돼도 됨 */ } };
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [focusItem, setFocusItem] = useState(null);

  const loadList = useCallback(async () => { try { setList(await api('/trials')); } catch (err) { setError(err.message); } }, []);
  const load = useCallback(async () => {
    if (!trialId) { setDetail(null); return; }
    try { setDetail(await api(`/trials/${trialId}`)); setError(''); } catch (err) { setError(err.message); }
  }, [trialId]);
  useEffect(() => { loadList(); }, [loadList]);
  // 주소에 시험이 없으면 가장 최근 시험을 연다(10/19 미르: 예전 화면이 그대로 보였다)
  useEffect(() => { if (!trialId && list?.trials?.length) setTrialId(list.trials[0].id); }, [list, trialId]);
  useEffect(() => { load(); }, [load]);
  const isRunning = Boolean(detail?.running || Object.values(detail?.steps || {}).some(s => s.status === 'running'));
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [isRunning, load]);
  useEffect(() => { if (!isRunning) loadList(); }, [isRunning, loadList]);

  const steps = detail?.stepTable || list?.steps || [];
  const order = useMemo(() => steps.map(s => s.id), [steps]);
  const estimate = async stepId => {
    try { const value = await api(`/trials/${trialId}/steps/${stepId}/estimate`, { method: 'POST', body: {} }); setEstimates(old => ({ ...old, [stepId]: value })); } catch (err) { setError(err.message); }
  };
  const providerOf = stepId => detail?.llmSteps?.[stepId] || detail?.llm || 'claude';
  const setProvider = async (stepId, value) => {
    try { await api(`/trials/${trialId}/llm`, { method: 'POST', body: { steps: { ...(detail?.llmSteps || {}), [stepId]: value } } }); await load(); } catch (err) { setError(err.message); }
  };
  const [localStatus, setLocalStatus] = useState(null);
  const checkLocal = async () => { try { setLocalStatus(await api('/trials/llm-status')); } catch (err) { setLocalStatus({ ok: false, error: err.message }); } };
  const run = async stepId => {
    const value = estimates[stepId];
    if (providerOf(stepId) === 'local' || steps.find(s => s.id === stepId)?.codeOnly) { setError(''); try { await api(`/trials/${trialId}/steps/${stepId}/run`, { method: 'POST', body: {} }); await load(); } catch (err) { setError(err.message); } return; }
    if (!confirm(`${stepId} 단계를 실행합니다(Claude API 호출 — 비용 발생).${value ? `\n예상 보통 ${usd(value.typicalUsd)} · 최악 ${usd(value.worstUsd)}` : ''}\n계속할까요?`)) return;
    setError('');
    try { await api(`/trials/${trialId}/steps/${stepId}/run`, { method: 'POST', body: {} }); await load(); } catch (err) { setError(err.message); }
  };
  const decide = async (reqId, body) => {
    try { await api(`/trials/${trialId}/missing`, { method: 'POST', body: { reqId, reviewer, ...body } }); await load(); } catch (err) { setError(err.message); }
  };
  const openSpace = async () => {
    setBusy(true); setError('');
    try {
      const result = await api(`/trials/${trialId}/space`, { method: 'POST', body: { reviewer } });
      if (result.rejected?.length) alert(`가져오지 못한 항목 ${result.rejected.length}개:\n${result.rejected.slice(0, 8).map(r => `${r.reqId} ${r.assetId} — ${r.reason}`).join('\n')}`);
      await load();
      onOpenProject(result.projectId);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const pick = id => { setTrialId(id); setCreating(false); const url = new URL(location.href); url.searchParams.set('trial', id); history.replaceState({}, '', url); };

  return <div className="agent-trial">
    <div className="page-head"><div><p className="eyebrow">AGENT TRIAL</p><h1>에이전트 시험</h1><p>설화 원문 → 01~04 문서 → 에셋 선정 → 빈 지형 배치 초안. 단계마다 버튼으로 실행하고 결과를 사람본과 견줍니다.</p></div></div>
    {error && <div className="message error" role="alert">{error}<button className="quiet" onClick={() => setError('')}>×</button></div>}
    <section className="panel trial-top">
      <label className="field"><span>시험</span><select value={trialId} onChange={e => pick(e.target.value)}><option value="">— 고르기 —</option>{list?.trials?.map(t => <option key={t.id} value={t.id}>{t.title} · {date(t.createdAt)} · {t.done}/{t.total || 6}{t.pipeline === 2 ? ' · 2판' : ''} · {usd(t.spentUsd)}</option>)}</select></label>
      <label className="field"><span>검수자</span><input value={reviewer} onChange={e => setReviewer(e.target.value)} placeholder="이름 또는 담당자명" maxLength={100} /></label>
      <button className="secondary" onClick={() => setCreating(v => !v)}>{creating ? '닫기' : '＋ 새 시험'}</button>
    </section>
    {creating && <NewTrial trials={list?.trials || []} defaultBudget={list?.defaultBudgetUsd} onCreated={trial => { loadList(); pick(trial.id); }} />}
    {detail && <>
      <FlowPanel detail={detail} steps={steps} />
      {detail.spaceKind === 'indoor' && <AgentExplain detail={detail} steps={steps} />}
      <section className="panel">
        {detail.pipeline !== 2 && <div className="message warning">이 시험은 <b>1판 공정</b>(소품 고르기 → 좌표 찍기, 배경·인물 없음)입니다. 퍼즐 초안·공간 구성·배경 층이 들어간 2판은 위 「시험」에서 「· 2판」이 붙은 것을 고르세요.{list?.trials?.find(t => t.pipeline === 2) && <button className="secondary" onClick={() => pick(list.trials.find(t => t.pipeline === 2).id)}>최신 2판 시험 열기</button>}</div>}
        <div className="panel-head"><div><h2>{detail.title}</h2><p>원문: {detail.source.name} · {detail.source.text.length.toLocaleString()}자 · 공간: {detail.spaceKind === 'indoor' ? '실내 방 세트(코드 생성)' : '나주 앙암바위(야외, 직접 지정)'}{detail.adaptation?.text ? ` · 각색 조건 ${detail.adaptation.text.length.toLocaleString()}자` : ''}</p></div><span className="pill">{usd(detail.spentUsd)} / 예산 ${detail.budgetUsd}</span></div>
        {detail.stale && <div className="trial-stale" style={{ margin: '8px 0', padding: '8px 12px', borderRadius: 8, background: '#fde8e1', color: '#7a2a12', fontSize: 13 }}>⚠️ 이 시험은 {detail.stale.label} 규칙으로 만든 예전 판입니다 — 그 뒤 고친 퍼즐 규칙(장치 다양화·단서에서 읽히는 답·방언 풀어 쓰기)이 들어 있지 않습니다.{detail.stale.latest ? <> 최신 시험: <b>{detail.stale.latest.title}</b></> : null}</div>}
        <div className="trial-local"><button className="secondary" onClick={checkLocal}>로컬 모델 연결 확인</button>{localStatus && <span className={localStatus.ok ? 'ok' : 'bad'}>{localStatus.ok ? `🟢 연결됨 · ${localStatus.model}` : `🔴 ${localStatus.error}`}</span>}<small className="muted">단계마다 Claude(유료)와 로컬 맥북(무료)을 고를 수 있습니다. 같은 01~04 를 이어받은 시험 둘을 Claude·로컬로 돌려 자기 검사·배치 화면으로 견주면 됩니다.</small></div>
        <ol className="trial-steps">{steps.map((step, index) => <StepCard key={step.id} anchor={`step-${step.id}`} step={step} state={detail.steps[step.id]} estimate={estimates[step.id]} running={isRunning}
          previousDone={index === 0 || detail.steps[order[index - 1]]?.status === 'done'} onEstimate={() => estimate(step.id)} onRun={() => run(step.id)}
          provider={step.codeOnly ? 'local' : providerOf(step.id)} onProvider={detail.pipeline === 2 && !step.codeOnly ? value => setProvider(step.id, value) : null} />)}</ol>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>01~04 문서</h2><p>에이전트가 쓴 문서(원본 아님). 핵심 검수 카드는 「빈 지형 공간에서 보기」로 만든 시험 검수 기록의 설화와 기획 화면에서 만들 수 있습니다.</p></div></div>
        {['01', '02', '03', '04'].map(no => detail.files[`AI-${no}.md`] && <details key={no} className="trial-doc"><summary>AI-{no} · {steps.find(s => s.no === no)?.label}</summary><pre>{detail.files[`AI-${no}.md`]}</pre></details>)}
        {!['01', '02', '03', '04'].some(no => detail.files[`AI-${no}.md`]) && <p className="empty">아직 문서가 없습니다. 01부터 실행하세요.</p>}
      </section>
      {detail.adaptation?.text && <details className="trial-doc"><summary>각색 조건(02~06 입력)</summary><pre>{detail.adaptation.text}</pre></details>}
      {detail.spaceKind === 'indoor' ? <>
        <PuzzleDraft detail={detail} />
        <IndoorResult detail={detail} onOpenSpace={onOpenIndoor} onRebuild={async () => { setError(''); try { await api(`/trials/${trialId}/relayout`, { method: 'POST', body: {} }); await load(); } catch (err) { setError(err.message); } }} />
        <PuzzleReview key={detail.indoor?.build?.at} detail={detail} reviewer={reviewer} />
        <IndoorCompare detail={detail} />
      </> : detail.pipeline === 2 ? <>
        <PuzzleDraft detail={detail} />
        <SpacePlan detail={detail} />
        <Selection2 detail={detail} reviewer={reviewer} onDecide={decide} />
        <SelfCheck detail={detail} onRelayout={async () => { setError(''); try { await api(`/trials/${trialId}/relayout`, { method: 'POST', body: {} }); await load(); } catch (err) { setError(err.message); } }} />
        <ItemReview detail={detail} reviewer={reviewer} onChanged={load} onRework={() => run('s10')} focusItem={focusItem} />
      </> : <>
        <Selection detail={detail} reviewer={reviewer} onDecide={decide} />
        <Layout detail={detail} reviewer={reviewer} onOpenSpace={openSpace} busy={busy} />
      </>}
      {detail.spaceKind !== 'indoor' && <PlacedView key={detail.id} detail={detail} reviewer={reviewer} onChanged={load} onFocusItem={setFocusItem} />}
      {detail.spaceKind !== 'indoor' && <Compare trialId={detail.id} version={detail.updatedAt} />}
    </>}
    {!detail && !creating && <p className="empty">시험을 고르거나 「＋ 새 시험」으로 시작하세요.</p>}
  </div>;
}
