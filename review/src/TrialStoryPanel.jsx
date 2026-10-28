// 설화와 기획 — 에이전트 시험 판(10/28 미르: 「설화가 입력되면 요약도 하고, 사람 확인이 꼭 필요한 지점들을 전처럼 리스트로 컨펌하게 하고, 아래쪽으로는 우리 게임 문서 양식으로 작성된 문서 원본들」)
//   위 → 아래: ① 설화 전문 요약(01 이 끝나면 자동) ② 핵심 검수 카드 — 사람 확인 리스트(04 가 끝나면 자동, 모두 「확인」해야 05 부터 진행) ③ 문서 원본(각색 조건 · 원문 · 01~04).
//   검수 기록(프로젝트)을 고르지 않았을 때 보인다. 고른 시험은 「이야기 컷 검수」와 같이 쓴다(브라우저에 기억).
import { useEffect, useState } from 'react';
import { api } from './api.js';
import BriefPanel from './BriefPanel.jsx';
import StorySummaryPanel from './StorySummaryPanel.jsx';

export const TRIAL_KEY = 'review.trial';
export const readTrialKey = () => { try { return localStorage.getItem(TRIAL_KEY) || localStorage.getItem('cineReview.trial') || ''; } catch { return ''; } };
export const writeTrialKey = id => { try { localStorage.setItem(TRIAL_KEY, id); localStorage.setItem('cineReview.trial', id); } catch { /* 저장 못 해도 됨 */ } };
const DOCS = [['AI-01.md', '01 설화 사실 계약서'], ['AI-02.md', '02 지역 테마 시놉시스'], ['AI-03.md', '03 게임 시나리오 기획서'], ['AI-04.md', '04 Scene 구성표']];

export default function TrialStoryPanel({ reviewer, setReviewer }) {
  const [trials, setTrials] = useState([]); const [id, setId] = useState(readTrialKey); const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api('/trials').then(v => { const list = (v.trials || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); setTrials(list); if (!id && list[0]) setId(list[0].id); }).catch(e => setErr(e.message)); }, []);
  useEffect(() => { if (!id) return; writeTrialKey(id); setD(null); api(`/trials/${id}`).then(setD).catch(e => setErr(e.message)); }, [id]);
  const st = no => d?.steps?.[`s${no}`]?.status;
  return (
    <section className="panel trial-story">
      <div className="panel-head"><div><h2>에이전트 시험 — 설화와 기획</h2><p>① 설화 요약 → ② 사람 확인이 필요한 곳(카드 판정) → ③ 게임 문서 양식 원본. 카드를 모두 확인해야 05 퍼즐 단계로 넘어갑니다.</p></div></div>
      <label className="field"><span>시험</span><select value={id} onChange={e => setId(e.target.value)}>{trials.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
      {err && <p className="error">{err}</p>}
      {d && <>
        <StorySummaryPanel trialId={d.id} />
        <BriefPanel key={d.id} apiBase={`/trial-brief/${d.id}`} makePath={`/trial-brief/${d.id}/make`} reviewer={reviewer} setReviewer={setReviewer} />
        <h3 className="ts-h">문서 원본 — 게임 문서 양식</h3>
        {d.adaptation?.text && <details className="trial-doc"><summary>각색 조건 — 제작팀 방침(원전 사실 아님)</summary><pre className="ts-pre">{d.adaptation.text}</pre></details>}
        <details className="trial-doc"><summary>설화 원문 — {d.source?.name || '출처 미상'} ({(d.source?.text || '').length.toLocaleString()}자)</summary><pre className="ts-pre">{d.source?.text}</pre></details>
        {DOCS.map(([f, label], i) => <details key={f} className="trial-doc"><summary>{label} {st(`0${i + 1}`) === 'done' ? '' : `· ${st(`0${i + 1}`) || '아직 없음'}`}</summary>{d.files?.[f] ? <pre className="ts-pre">{d.files[f]}</pre> : <p className="muted">아직 없습니다.</p>}</details>)}
      </>}
    </section>
  );
}
