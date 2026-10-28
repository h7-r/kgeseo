// 설화와 기획 — 오른쪽 승인 칸(10/28 미르: 「중앙 내용을 다 검토하고 승인한 다음에 이야기 컷으로 넘어가기 위해 승인하는 단계」)
//   가운데(요약 · 사람 확인 카드 · 문서 원본)를 보고 → 카드가 모두 「확인」이면 승인 → 05 퍼즐 · 05b 장면 연출이 뒤에서 돈다 → 「02 이야기 컷 검수」.
import { useCallback, useEffect, useState } from 'react';
import { api, date } from './api.js';
import { readTrialKey } from './TrialStoryPanel.jsx';

const ST = { done: '끝남', running: '도는 중', failed: '실패', idle: '대기' };

export default function TrialApprovePanel({ reviewer, setReviewer, onGoCine }) {
  const [id, setId] = useState(readTrialKey);
  const [s, setS] = useState(null); const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { const f = e => setId(e.detail || readTrialKey()); window.addEventListener('review-trial', f); return () => window.removeEventListener('review-trial', f); }, []);
  const load = useCallback(() => { if (!id || id === '__new') { setS(null); return; } api(`/trial-brief/${id}`).then(v => { setS(v); setErr(''); }).catch(e => setErr(e.message)); }, [id]);
  useEffect(() => { setS(null); load(); }, [load]);
  // 카드 판정은 가운데에서 하므로 여기서는 주기적으로 다시 읽는다
  useEffect(() => { const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);

  if (!id || id === '__new') return <section className="panel approve-panel"><p className="eyebrow">설화·기획 승인</p><p className="muted">가운데에서 설화를 입력하면 문서·요약·확인 카드가 채워지고, 여기서 승인합니다.</p></section>;
  const items = s?.brief?.items || [];
  const c = { total: items.length, ok: items.filter(i => i.decision === 'ok').length, issue: items.filter(i => i.decision === 'issue').length, pending: items.filter(i => !i.decision).length };
  const docsLeft = (s?.docs || []).filter(d => d.status !== 'done');
  const ap = s?.approval; const approved = Boolean(ap?.valid);
  const why = [
    ...(docsLeft.length ? [`문서가 아직 다 나오지 않았습니다(${docsLeft.map(d => d.id.slice(1)).join('·')}).`] : []),
    ...(!s?.brief ? [s?.making ? '사람 확인 카드를 만드는 중입니다.' : '사람 확인 카드가 아직 없습니다.'] : []),
    ...(c.pending ? [`판정 전 카드 ${c.pending}장 — 가운데 카드에서 「확인」 또는 「문제」를 고르세요.`] : []),
    ...(c.issue ? [`「문제」 카드 ${c.issue}장 — 문서를 고쳐 새 시험으로 시작하거나 판정을 바꿔야 합니다.`] : []),
    ...(!reviewer.trim() ? ['검수자 이름을 적어 주세요.'] : []),
  ];
  const chain = s?.chain || []; const last = chain[chain.length - 1];
  const cineReady = approved && last?.status === 'done';
  const doApprove = async () => { setBusy(true); setErr(''); try { setS(await api(`/trial-brief/${id}/approve`, { method: 'POST', body: { reviewer, note } })); } catch (e) { setErr(e.message); } finally { setBusy(false); } };

  return <section className="panel approve-panel">
    <p className="eyebrow">설화·기획 승인</p>
    <h2>{approved ? '승인됨' : '가운데 내용을 보고 승인'}</h2>
    <p className="muted">요약 · 사람 확인 카드 · 문서 원본을 검토한 뒤 승인하면 05 퍼즐 → 05b 장면 연출(이야기 컷)이 이어서 돌고, 「02 이야기 컷 검수」로 넘어갑니다.</p>
    <dl className="ap-dl">
      <dt>문서 01~04</dt><dd>{docsLeft.length ? `${(s?.docs || []).length - docsLeft.length}/${(s?.docs || []).length}` : '다 나옴'}</dd>
      <dt>확인 카드</dt><dd>{s?.brief ? `확인 ${c.ok} · 문제 ${c.issue} · 판정 전 ${c.pending}` : s?.making ? '만드는 중' : '없음'}</dd>
    </dl>
    {ap && !ap.valid && <p className="warning-text">승인({ap.by} · {date(ap.at)}) 뒤 문서나 카드 판정이 바뀌어 승인이 풀렸습니다. 다시 승인해 주세요.</p>}
    {approved ? <>
      <p className="ap-ok">✓ {ap.by} · {date(ap.at)}{ap.note ? ` — ${ap.note}` : ''}</p>
      <ul className="ap-chain">{chain.map(x => <li key={x.id}><b>{x.id.slice(1)}</b> {x.label}<span className={`ap-st ${x.status}`}>{ST[x.status] || x.status}</span>{x.error && <small className="error">{x.error}</small>}</li>)}</ul>
      <button className="wide" disabled={!cineReady} onClick={onGoCine}>{cineReady ? '02 이야기 컷 검수로 →' : '장면 연출이 끝나면 이야기 컷 검수로 넘어갑니다'}</button>
    </> : <>
      <label className="field"><span>검수자</span><input value={reviewer} onChange={e => setReviewer(e.target.value)} maxLength={100} placeholder="이름" /></label>
      <label className="field"><span>의견(선택)</span><textarea rows={3} value={note} onChange={e => setNote(e.target.value)} /></label>
      {why.length > 0 && <div className="blockers"><b>승인 전 필요한 것</b><ul>{why.map(w => <li key={w}>{w}</li>)}</ul></div>}
      <button className="wide" disabled={busy || why.length > 0} onClick={doApprove}>{busy ? '승인하는 중…' : '설화·기획 승인 → 05 · 05b 시작'}</button>
      <small className="muted">05·05b 는 Claude 로 돕니다(시험마다 약 $1~2).</small>
    </>}
    {err && <p className="error">{err}</p>}
  </section>;
}
