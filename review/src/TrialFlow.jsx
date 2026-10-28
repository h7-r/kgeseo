// 에이전트 시험의 정식 공정 화면 — 03 공간·에셋 · 04 퍼즐 연결(10/28 미르: 「이야기 컷이 끝나면 공간·에셋, 그다음 퍼즐 — 이 흐름이 끝까지 도는지」)
//   검수 기록(프로젝트)을 고르지 않았을 때 좌측 03 · 04 에 이 화면이 뜬다. 상태는 /__review/trial-flow/<id>, 결과물은 /__review/trials/<id>.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, date } from './api.js';
import { readTrialKey, writeTrialKey } from './TrialStoryPanel.jsx';
import { IndoorResult, PuzzleDraft } from './AgentTrialPage.jsx';
import PuzzleReview from './PuzzleReview.jsx';

const ST = { done: '끝남', running: '도는 중', failed: '실패', idle: '대기' };

export function useTrialFlow(enabled) {
  const [id, setId] = useState(readTrialKey);
  const [flow, setFlow] = useState(null); const [detail, setDetail] = useState(null); const [err, setErr] = useState('');
  const sig = useRef('');
  useEffect(() => { const f = e => setId(e.detail || readTrialKey()); window.addEventListener('review-trial', f); return () => window.removeEventListener('review-trial', f); }, []);
  const loadFlow = useCallback(async () => {
    if (!enabled || !id || id === '__new') { setFlow(null); return; }
    try { const v = await api(`/trial-flow/${id}`); setFlow(v); setErr('');
      // 결과물(방 세트·퍼즐)이 바뀌었을 때만 무거운 시험 상세를 다시 읽는다
      const s = JSON.stringify([v.id, v.space.steps.map(r => r.status), v.space.buildAt, v.cine.steps.map(r => r.status)]);
      if (s !== sig.current) { sig.current = s; setDetail(await api(`/trials/${id}`)); }
    } catch (e) { setErr(e.message); }
  }, [enabled, id]);
  useEffect(() => { setFlow(null); setDetail(null); sig.current = ''; loadFlow(); }, [loadFlow]);
  useEffect(() => { if (!enabled) return; const t = setInterval(loadFlow, 4000); return () => clearInterval(t); }, [enabled, loadFlow]);
  const pick = v => { writeTrialKey(v); setId(v); };
  return { id, flow, detail, err, reload: loadFlow, pick };
}

function Picker({ tf }) {
  const [trials, setTrials] = useState([]);
  useEffect(() => { api('/trials').then(v => setTrials((v.trials || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))))).catch(() => {}); }, []);
  return <label className="field"><span>시험</span><select value={tf.id || ''} onChange={e => tf.pick(e.target.value)}>{!tf.id && <option value="">— 고르기 —</option>}{trials.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>;
}
const Steps = ({ rows }) => <ul className="ap-chain">{rows.map(x => <li key={x.id}><b>{x.id.slice(1)}</b> {x.label}<span className={`ap-st ${x.status}`}>{ST[x.status] || x.status}</span>{x.error && <small className="error">{x.error}</small>}</li>)}</ul>;

export function TrialSpaceMain({ tf, onBack }) {
  const { flow, detail, err } = tf;
  return <section className="panel trial-story">
    <div className="panel-head"><div><h2>에이전트 시험 — 공간·에셋</h2><p>이야기 컷 검수가 끝나면 06 공간 구성 → 07 에셋 선정 → 08 방 세트 → 09 화면 자기 검수가 돌고, 결과가 여기에 나옵니다. 방을 둘러보고 오른쪽에서 승인하면 「04 퍼즐 연결」로 넘어갑니다.</p></div></div>
    <Picker tf={tf} />
    {err && <p className="error">{err}</p>}
    {flow && !flow.cine.done && <div className="cr-wait"><b>이야기 컷 검수가 아직 끝나지 않았습니다</b><p>{!flow.story.done ? '「01 설화와 기획」 승인부터 해 주세요.' : flow.cine.pending ? `검수 전 컷 ${flow.cine.pending}개 — 「02 이야기 컷 검수」에서 승인·반려하면 공간 단계가 저절로 돕니다.` : '05·05b 가 도는 중입니다.'}</p><button className="secondary" onClick={onBack}>{!flow.story.done ? '01 설화와 기획으로' : '02 이야기 컷 검수로'}</button></div>}
    {flow && flow.cine.done && <div className="cr-wait"><b>공간 단계</b><Steps rows={flow.space.steps} />{flow.space.steps.some(r => r.status === 'running') && <p className="muted">도는 중 — 끝나는 대로 아래에 방 세트가 나옵니다(이 화면은 저절로 새로 읽습니다).</p>}</div>}
    {detail && detail.spaceKind === 'indoor' && <IndoorResult detail={detail} noHuman onOpenSpace={null} onRebuild={async () => { try { await api(`/trials/${detail.id}/relayout`, { method: 'POST', body: {} }); await tf.reload(); } catch (e) { alert(e.message); } }} />}
    {detail && detail.spaceKind !== 'indoor' && <p className="note">야외(나주) 시험의 공간 결과는 아직 이 화면에 연결하지 않았습니다 — 「에이전트 시험」에서 보세요.</p>}
  </section>;
}

export function TrialSpaceRail({ tf, reviewer, setReviewer, onNext }) {
  const { flow } = tf; const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  if (!flow) return <section className="panel approve-panel"><p className="eyebrow">공간·에셋 승인</p><p className="muted">시험을 고르세요.</p></section>;
  const sp = flow.space; const ok = Boolean(sp.approval?.valid);
  const why = [
    ...(!flow.cine.done ? ['이야기 컷 검수가 먼저 끝나야 합니다.'] : []),
    ...sp.steps.filter(r => r.status === 'running' || (r.status !== 'done' && r.id !== 's09')).map(r => `${r.id.slice(1)} ${r.label} — ${ST[r.status] || r.status}`),
    ...(flow.cine.done && !sp.built ? ['방 세트(08 결과)가 아직 없습니다.'] : []),
    ...(!reviewer.trim() ? ['검수자 이름을 적어 주세요.'] : []),
  ];
  const approve = async () => { setBusy(true); setErr(''); try { await api(`/trial-flow/${flow.id}/space/approve`, { method: 'POST', body: { reviewer, note } }); await tf.reload(); onNext?.(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return <section className="panel approve-panel">
    <p className="eyebrow">공간·에셋 승인</p>
    <h2>{ok ? '승인됨' : '방 세트를 보고 승인'}</h2>
    <p className="muted">방 구성 · 고른 에셋 · 배치를 둘러보고 승인하면 「04 퍼즐 연결」로 넘어갑니다.</p>
    {sp.regressRed.length > 0 && <p className="warning-text">자동 회귀 검사 🔴 {sp.regressRed.join(', ')} — 확인하고 승인하세요.</p>}
    {sp.approval && !sp.approval.valid && <p className="warning-text">승인({sp.approval.by} · {date(sp.approval.at)}) 뒤 방 세트가 다시 만들어져 승인이 풀렸습니다.</p>}
    {ok ? <><p className="ap-ok">✓ {sp.approval.by} · {date(sp.approval.at)}{sp.approval.note ? ` — ${sp.approval.note}` : ''}</p><button className="wide" onClick={onNext}>04 퍼즐 연결로 →</button></> : <>
      <label className="field"><span>검수자</span><input value={reviewer} onChange={e => setReviewer(e.target.value)} maxLength={100} placeholder="이름" /></label>
      <label className="field"><span>의견(선택)</span><textarea rows={3} value={note} onChange={e => setNote(e.target.value)} /></label>
      {why.length > 0 && <div className="blockers"><b>승인 전 필요한 것</b><ul>{why.map(w => <li key={w}>{w}</li>)}</ul></div>}
      <button className="wide" disabled={busy || why.length > 0} onClick={approve}>{busy ? '승인하는 중…' : '공간·에셋 승인 → 퍼즐 연결로'}</button>
    </>}
    {err && <div className="blockers ap-err"><b>승인하지 못했습니다</b><p>{err}</p></div>}
  </section>;
}

export function TrialPuzzleMain({ tf, reviewer, onBack }) {
  const { flow, detail, err } = tf;
  return <section className="panel trial-story">
    <div className="panel-head"><div><h2>에이전트 시험 — 퍼즐 연결</h2><p>05 퍼즐 초안이 08 방 세트의 물건에 어떻게 이어졌는지 보고, 퍼즐마다 「화면에서 보기」로 직접 풀어 본 뒤 승인 또는 수정 요청을 고릅니다. 모두 승인하면 이 시험의 공정이 끝납니다.</p></div></div>
    <Picker tf={tf} />
    {err && <p className="error">{err}</p>}
    {flow && !flow.space.done && <div className="cr-wait"><b>공간·에셋 승인이 아직 없습니다</b><p>「03 공간·에셋」에서 방 세트를 보고 승인하면 여기서 퍼즐을 검수합니다.</p><button className="secondary" onClick={onBack}>03 공간·에셋으로</button></div>}
    {flow?.puzzle.done && <div className="cr-wait ok"><b>✅ 퍼즐 {flow.puzzle.total}개 모두 승인 — 이 시험의 공정이 끝났습니다</b><p>설화·기획 → 이야기 컷 → 공간·에셋 → 퍼즐 연결까지 사람 승인이 모두 남았습니다.</p></div>}
    {detail && flow?.space.done && <>{reviewer.trim() ? null : <p className="warning-text">오른쪽에 검수자 이름을 적어야 퍼즐 판정이 저장됩니다.</p>}<PuzzleReview key={detail.indoor?.build?.at} detail={detail} reviewer={reviewer} onChange={() => tf.reload()} /><PuzzleDraft detail={detail} /></>}
  </section>;
}

export function TrialPuzzleRail({ tf, reviewer, setReviewer }) {
  const { flow } = tf;
  if (!flow) return <section className="panel approve-panel"><p className="eyebrow">퍼즐 승인</p><p className="muted">시험을 고르세요.</p></section>;
  const p = flow.puzzle;
  return <section className="panel approve-panel">
    <p className="eyebrow">퍼즐 승인</p>
    <h2>{p.done ? '공정 완료' : `승인 ${p.approved}/${p.total}`}</h2>
    <dl className="ap-dl"><dt>승인</dt><dd>{p.approved}</dd><dt>수정 요청</dt><dd>{p.revise}</dd><dt>판정 전</dt><dd>{p.pending}</dd><dt>코드로 풀림</dt><dd>{p.solvable ?? '—'}/{p.total}</dd></dl>
    <label className="field"><span>검수자</span><input value={reviewer} onChange={e => setReviewer(e.target.value)} maxLength={100} placeholder="이름" /></label>
    {p.done ? <p className="ap-ok">✓ 모든 퍼즐 승인 — 공정 끝</p> : <div className="blockers"><b>남은 것</b><ul>{!flow.space.done && <li>공간·에셋 승인이 먼저입니다.</li>}{p.pending > 0 && <li>판정 전 퍼즐 {p.pending}개</li>}{p.revise > 0 && <li>수정 요청 {p.revise}개 — 고친 뒤 다시 승인해야 끝납니다.</li>}</ul></div>}
  </section>;
}

/** 좌측 메뉴 아래 작은 글씨 */
export function flowLabel(flow, gate) {
  if (!flow) return null;
  if (gate === 'source') return flow.story.done ? '승인됨' : `카드 판정 전 ${flow.story.cards.pending}`;
  if (gate === 'space') return flow.space.done ? '승인됨' : flow.space.steps.some(r => r.status === 'running') ? '만드는 중' : flow.cine.done ? '검수 전' : '이야기 컷 뒤';
  if (gate === 'play') return flow.puzzle.done ? '공정 완료' : flow.space.done ? `승인 ${flow.puzzle.approved}/${flow.puzzle.total}` : '공간 승인 뒤';
  return null;
}
