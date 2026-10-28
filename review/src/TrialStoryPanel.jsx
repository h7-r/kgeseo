// 설화와 기획 — 에이전트 시험 판(10/28 미르: 「이야기 에이전트 설화와 기획 쪽은 왜 텅 비어 있냐」)
//   검수 기록(프로젝트)을 고르지 않았을 때, 지금 다루는 에이전트 시험의 설화 요약 · 각색 조건 · 원문 · 01~04 문서를 보여 준다.
//   고른 시험은 이야기 컷 검수와 같이 쓴다(브라우저에 기억).
import { useEffect, useState } from 'react';
import { api } from './api.js';
import StorySummaryPanel from './StorySummaryPanel.jsx';

export const TRIAL_KEY = 'review.trial';
export const readTrialKey = () => { try { return localStorage.getItem(TRIAL_KEY) || localStorage.getItem('cineReview.trial') || ''; } catch { return ''; } };
export const writeTrialKey = id => { try { localStorage.setItem(TRIAL_KEY, id); localStorage.setItem('cineReview.trial', id); } catch { /* 저장 못 해도 됨 */ } };
const DOCS = [['AI-01.md', '01 설화 사실 계약서'], ['AI-02.md', '02 지역 테마 시놉시스'], ['AI-03.md', '03 게임 시나리오 기획서'], ['AI-04.md', '04 Scene 구성표']];

export default function TrialStoryPanel() {
  const [trials, setTrials] = useState([]); const [id, setId] = useState(readTrialKey); const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api('/trials').then(v => { const list = (v.trials || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); setTrials(list); if (!id && list[0]) setId(list[0].id); }).catch(e => setErr(e.message)); }, []);
  useEffect(() => { if (!id) return; writeTrialKey(id); setD(null); api(`/trials/${id}`).then(setD).catch(e => setErr(e.message)); }, [id]);
  const st = no => d?.steps?.[`s${no}`]?.status;
  return (
    <section className="panel trial-story">
      <div className="panel-head"><div><h2>에이전트 시험 — 설화와 기획</h2><p>지금 다루는 시험의 설화 요약 · 각색 조건 · 원문 · 01~04 문서입니다. 고른 시험은 「이야기 컷 검수」와 같이 씁니다.</p></div></div>
      <label className="field"><span>시험</span><select value={id} onChange={e => setId(e.target.value)}>{trials.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
      {err && <p className="error">{err}</p>}
      {d && <>
        <StorySummaryPanel trialId={d.id} />
        {d.adaptation?.text && <details className="trial-doc" open><summary>각색 조건 — 제작팀 방침(원전 사실 아님)</summary><pre className="ts-pre">{d.adaptation.text}</pre></details>}
        <details className="trial-doc"><summary>설화 원문 — {d.source?.name || '출처 미상'} ({(d.source?.text || '').length.toLocaleString()}자)</summary><pre className="ts-pre">{d.source?.text}</pre></details>
        {DOCS.map(([f, label], i) => <details key={f} className="trial-doc"><summary>{label} {st(`0${i + 1}`) === 'done' ? '' : `· ${st(`0${i + 1}`) || '아직 없음'}`}</summary>{d.files?.[f] ? <pre className="ts-pre">{d.files[f]}</pre> : <p className="muted">아직 없습니다.</p>}</details>)}
      </>}
    </section>
  );
}
