// 이야기 컷 검수(10/28 미르: 「그림을 보고 검수·선택·미세 조정·반려는 클로드가 아니라 사람이 해야 한다 — 좌측 메뉴에 정식 공정으로」)
//   05b 장면 연출 에이전트가 컷마다 후보 그림을 그려 두면, 여기서 사람이: 후보 고르기 · 글·그림 지시 고쳐 다시 그리기 · 승인 · 반려(그림 없이 글만).
//   결정은 바로 게임 화면(실내 방 뷰어 · 나주 미리보기)에 반영된다.
import { useEffect, useRef, useState } from 'react';
import { api, date } from './api.js';
import './CineReviewPage.css';

const STATUS = { pending: ['검수 전', 'cr-pending'], approved: ['승인', 'cr-approved'], rejected: ['반려 · 글만', 'cr-rejected'] };
const img = (id, f) => `/__review/trials/${id}/cine/${encodeURIComponent(f)}`;

function Panel({ trialId, p, onChange, busy }) {
  const [cap, setCap] = useState(p.caption); const [prompt, setPrompt] = useState(p.image_prompt); const [note, setNote] = useState(p.review?.note || ''); const [open, setOpen] = useState(false);
  useEffect(() => { setCap(p.caption); setPrompt(p.image_prompt); }, [p.caption, p.image_prompt]);
  const st = STATUS[p.review?.status || 'pending'] || STATUS.pending; const drawing = p.job?.status === 'running';
  const act = (action, extra = {}) => onChange(() => api(`/cine/${trialId}/decide`, { method: 'POST', body: { key: p.key, action, note, ...extra } }));
  const redraw = () => onChange(() => api(`/cine/${trialId}/redraw`, { method: 'POST', body: { key: p.key, n: 2, image_prompt: prompt !== p.image_prompt ? prompt : undefined, caption: cap !== p.caption ? cap : undefined } }));
  return (
    <article className={`cr-panel ${st[1]}`}>
      <div className="cr-main">
        {p.img ? <img src={img(trialId, p.img)} alt="" className={p.review?.status === 'rejected' ? 'cr-dim' : ''} /> : <div className="cr-noimg">그림 없음</div>}
        <div className="cr-side">
          <div className="cr-head"><b>{p.id}</b><span className={`cr-pill ${st[1]}`}>{st[0]}</span>{p.review?.at && <small>{date(p.review.at)}</small>}</div>
          <p className="cr-cap">{p.caption}</p>
          <div className="cr-actions">
            <button disabled={busy || !p.img} onClick={() => act('approve')}>승인</button>
            <button className="secondary" disabled={busy} onClick={() => act('reject')}>반려(글만)</button>
            {(p.review?.status || 'pending') !== 'pending' && <button className="secondary" disabled={busy} onClick={() => act('reset')}>검수 전으로</button>}
            <button className="secondary" disabled={busy} onClick={() => setOpen(!open)}>{open ? '고치기 닫기' : '미세 조정'}</button>
          </div>
          <input className="cr-note" placeholder="검수 메모(반려 까닭 등)" value={note} onChange={e => setNote(e.target.value)} />
          {p.aiReview && <small className="cr-ai">참고 — AI 판정: {p.aiReview.ok ? '통과' : `걸림 ${p.aiReview.fails?.join(',')}`} {p.aiReview.why}</small>}
        </div>
      </div>
      {(p.candidates || []).length > 0 && <div className="cr-cands">{p.candidates.map(f => <button key={f} className={`cr-cand ${f === p.img ? 'on' : ''}`} disabled={busy || f === p.img} onClick={() => act('pick', { img: f })} title="이 그림으로 고르기"><img src={img(trialId, f)} alt="" />{f === p.img && <span>선택됨</span>}</button>)}
        {drawing && <div className="cr-cand cr-drawing">그리는 중 {p.job.done}/{p.job.n}…</div>}</div>}
      {p.job?.status === 'failed' && <div className="cr-err">다시 그리기 실패: {p.job.error}</div>}
      {open && <div className="cr-edit">
        <label>컷 글(자막)<textarea rows={2} value={cap} onChange={e => setCap(e.target.value)} /></label>
        <label>그림 지시(영어)<textarea rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} /></label>
        <div className="cr-actions">
          <button disabled={busy || (cap === p.caption && prompt === p.image_prompt)} onClick={() => act('edit', { caption: cap, image_prompt: prompt })}>글·지시만 저장</button>
          <button disabled={busy || drawing} onClick={redraw}>{prompt !== p.image_prompt ? '고친 지시로 다시 그리기(2장)' : '같은 지시로 2장 더 그리기'}</button>
        </div>
        <small>다시 그리기는 맥북 FLUX(로컬·무료)로 한 장에 20~40초. 새 후보가 위 후보 줄에 붙으면 골라 주세요.</small>
      </div>}
    </article>
  );
}

export default function CineReviewPage() {
  const [trials, setTrials] = useState([]); const [id, setId] = useState(() => { try { return localStorage.getItem('cineReview.trial') || ''; } catch { return ''; } });
  const [d, setD] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [filter, setFilter] = useState('all');
  const timer = useRef(0);
  const load = async (tid = id) => { if (!tid) return; try { setD(await api(`/cine/${tid}`)); setErr(''); } catch (e) { setErr(e.message); } };
  useEffect(() => { api('/cine').then(v => { setTrials(v.trials || []); if (!id && v.trials?.[0]) setId(v.trials[0].id); }).catch(e => setErr(e.message)); }, []);
  useEffect(() => { try { localStorage.setItem('cineReview.trial', id); } catch { /* 저장 못 해도 됨 */ } setD(null); load(id); }, [id]);
  const drawing = d?.sections?.some(s => s.panels.some(p => p.job?.status === 'running'));
  useEffect(() => { clearInterval(timer.current); if (drawing) timer.current = setInterval(() => load(), 4000); return () => clearInterval(timer.current); }, [drawing, id]);
  const change = async fn => { setBusy(true); try { const v = await fn(); if (v?.sections) setD(v); else await load(); setErr(''); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const all = d?.sections?.flatMap(s => s.panels) || []; const cnt = k => all.filter(p => (p.review?.status || 'pending') === k).length;
  const shown = p => filter === 'all' || (p.review?.status || 'pending') === filter;
  return (
    <section className="agent-trial cine-review">
      <div className="cr-top">
        <div><p className="eyebrow">LOCAL REVIEW / CINEMATIC</p><h1>이야기 컷 검수</h1><p className="cr-sub">장면 연출 에이전트(05b)가 그린 후보 그림을 사람이 고르고, 고쳐 다시 그리고, 승인하거나 반려합니다. 결정은 바로 게임 화면(실내 방 · 나주 미리보기)에 반영됩니다.</p></div>
        <label className="field">시험<select value={id} onChange={e => setId(e.target.value)}>{trials.map(t => <option key={t.id} value={t.id}>{t.title} — 검수 전 {t.pending} · 승인 {t.approved} · 반려 {t.rejected}</option>)}</select></label>
      </div>
      {err && <div className="trial-error">{err}</div>}
      {d && <>
        <div className="cr-summary">
          <span>컷 {all.length}</span><span className="cr-pill cr-pending">검수 전 {cnt('pending')}</span><span className="cr-pill cr-approved">승인 {cnt('approved')}</span><span className="cr-pill cr-rejected">반려 {cnt('rejected')}</span>
          <select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">모두 보기</option><option value="pending">검수 전만</option><option value="approved">승인만</option><option value="rejected">반려만</option></select>
          <span className={`cr-gate ${d.next?.ready ? 'ok' : ''}`}>{d.next?.ready ? '✅ 모든 컷 확인 끝 — 다음 단계로 갈 수 있습니다' : `⏸ 검수 전 ${d.next?.pending}컷 — 모두 승인·반려해야 다음 단계(06 공간 구성)로 넘어갑니다`}</span>
          {d.next?.ready && !['done', 'running'].includes(d.next?.status) && <button disabled={busy} onClick={() => change(async () => { await api(`/trials/${d.trial.id}/steps/s06/run-fresh`, { method: 'POST', body: {} }); return api(`/cine/${d.trial.id}`); })}>다음 단계(06) 시작</button>}
          {d.next?.status && <small>06 상태: {d.next.status === 'done' ? '끝남' : d.next.status === 'running' ? '도는 중' : d.next.status === 'failed' ? '실패' : d.next.status}</small>}
          {d.trial.spaceKind === 'indoor' && <a href={`/__review/trials/${d.trial.id}/rooms/index.html`} target="_blank" rel="noreferrer">방 둘러보기에서 보기 ↗</a>}
        </div>
        {d.sections.map(s => s.panels.some(shown) && <div key={s.section} className="cr-section">
          <h2>{s.title}</h2>{s.goal && <p className="cr-goal">🧭 {s.goal}</p>}{s.reveal && <p className="cr-goal">새로 알게 된 것: {s.reveal}</p>}
          {s.panels.filter(shown).map(p => <Panel key={p.key} trialId={d.trial.id} p={p} busy={busy} onChange={change} />)}
        </div>)}
        {d.history?.length > 0 && <details className="trial-doc"><summary>검수 기록 {d.history.length}건</summary><ul className="cr-hist">{d.history.map((h, i) => <li key={i}>{date(h.at)} · {h.key} · {h.action}{h.note ? ` — ${h.note}` : ''}</li>)}</ul></details>}
      </>}
    </section>
  );
}
