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
  const pick = v => { writeTrialKey(v); setId(v); setSelected(null); };
  // 03 공간·에셋 — 사람 판정(걸어 다니며 물건을 누르면 뷰어가 알려 준다)
  const [review, setReview] = useState(null); const [selected, setSelected] = useState(null); const frame = useRef(null);
  const buildAt = flow?.space?.buildAt || '';
  const loadReview = useCallback(async () => { if (!enabled || !id || id === '__new') { setReview(null); return; } try { setReview(await api(`/trial-flow/${id}/space/review`)); } catch (e) { setErr(e.message); } }, [enabled, id]);
  useEffect(() => { loadReview(); }, [loadReview, buildAt]);
  useEffect(() => { const f = e => { const d = e.data || {}; if (d.type === 'kgeseo-review-pick') setSelected({ item_id: d.item_id, node: d.node, roomName: d.roomName, room: d.room }); }; window.addEventListener('message', f); return () => window.removeEventListener('message', f); }, []);
  const focus = it => { setSelected({ item_id: it.item_id, node: it.node, roomName: it.roomName, room: it.roomIdx }); if (it.roomIdx != null) frame.current?.contentWindow?.postMessage({ type: 'kgeseo-review-focus', room: it.roomIdx, node: it.node }, '*'); };
  return { id, flow, detail, err, reload: loadFlow, pick, review, setReview, loadReview, selected, setSelected, frame, focus };
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
    {detail?.indoor?.build && <SpaceWalk tf={tf} build={detail.indoor.build} />}
    {detail && detail.spaceKind === 'indoor' && <details className="trial-doc"><summary>방 세트 자세히 — 방 구성 · 연결 검사 · 회귀 검사 · 07 선정 원본</summary><IndoorResult detail={detail} noHuman noView onOpenSpace={null} onRebuild={null} /></details>}
    {detail && detail.spaceKind !== 'indoor' && <p className="note">야외(나주) 시험의 공간 결과는 아직 이 화면에 연결하지 않았습니다 — 「에이전트 시험」에서 보세요.</p>}
  </section>;
}

const VB = { approve: ['좋음', 'ok'], swap: ['다른 에셋', 'swap'], adjust: ['위치·크기', 'swap'], remove: ['빼기', 'bad'], replan: ['수정 요청', 'bad'], regenerate: ['새로 만들기', 'bad'] };
const Badge = ({ v }) => v ? <span className={`sv-badge ${VB[v.verdict]?.[1] || ''}`}>{VB[v.verdict]?.[0] || v.verdict}</span> : <span className="sv-badge">판정 전</span>;

function SpaceWalk({ tf, build }) {
  const rv = tf.review; const items = (rv?.items || []).filter(x => x.placed || x.kind === 'asset');
  const rooms = [...new Set(items.map(x => x.roomName))];
  const [only, setOnly] = useState('all');
  const shown = items.filter(x => only === 'all' || (only === 'pending' ? !rv.review[x.item_id] : only === 'unapplied' ? rv.unapplied.includes(x.item_id) : true));
  return <>
    <h3 className="ts-h">걸어 다니며 검수</h3>
    <p className="muted">화면을 누르고 <b>T</b>로 시작 · WASD 이동 · 물건을 <b>클릭/E</b> 하면 오른쪽 칸에 그 물건이 뜹니다. 문은 잠김 없이 지나갑니다(퍼즐·이야기 컷은 04 에서). 아래 목록에서 골라도 됩니다.</p>
    <iframe ref={tf.frame} className="indoor-frame sv-frame" title="공간·에셋 검수" src={`${build.viewer}?review=1&v=${encodeURIComponent(build.at)}`} />
    {rv?.ready && <div className="sv-list">
      <div className="button-row"><b>물건 {items.length}개 · 판정 {Object.keys(rv.review).length} · 반영 대기 {rv.unapplied.length}</b>
        <select value={only} onChange={e => setOnly(e.target.value)}><option value="all">모두</option><option value="pending">판정 전만</option><option value="unapplied">반영 대기만</option></select></div>
      {rooms.map(r => <details key={r} open><summary>{r} — {shown.filter(x => x.roomName === r).length}</summary>
        <ul className="sv-rows">{shown.filter(x => x.roomName === r).map(x => <li key={x.item_id} className={tf.selected?.item_id === x.item_id ? 'on' : ''} onClick={() => tf.focus(x)}>
          {x.pick?.thumbnail ? <img src={x.pick.thumbnail} alt="" width="34" height="34" loading="lazy" /> : <span className="sv-noimg">{x.kind === 'marker' ? '표식' : '—'}</span>}
          <span><b>{x.name}</b>{x.host && <span className="sv-host">퍼즐</span>}<small className="muted">{x.pick ? x.pick.nameKo : x.placed ? '흔적·표식' : '못 놓음'}</small></span>
          <Badge v={rv.review[x.item_id]} />{rv.unapplied.includes(x.item_id) && <span className="sv-badge wait">반영 대기</span>}</li>)}</ul></details>)}
    </div>}
  </>;
}

function ObjectPanel({ tf, reviewer }) {
  const rv = tf.review; const sel = tf.selected;
  const it = sel?.item_id ? rv?.items?.find(x => x.item_id === sel.item_id) : null;
  const cur = it ? rv.review[it.item_id] : null;
  const [mode, setMode] = useState(''); const [note, setNote] = useState(''); const [adj, setAdj] = useState({ dx: 0, dz: 0, rot: 0, scale: 1 });
  const [q, setQ] = useState(''); const [found, setFound] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { setMode(''); setErr(''); setFound(null); setQ(it?.name || ''); setNote(cur?.note || ''); setAdj(cur?.adjust || { dx: 0, dz: 0, rot: 0, scale: 1 }); }, [it?.item_id]);
  if (!sel) return <section className="panel approve-panel"><p className="eyebrow">물건 판정</p><p className="muted">왼쪽 화면에서 물건을 클릭하거나 목록에서 고르세요.</p></section>;
  if (!it) return <section className="panel approve-panel"><p className="eyebrow">물건 판정</p><h2>{sel.node}</h2><p className="muted">{sel.roomName} — 방 구조(기둥·창·문)나 마당 풍광은 여기서 고치지 않습니다.</p></section>;
  const save = async body => { if (!reviewer.trim()) { setErr('오른쪽 아래 검수자 이름을 먼저 적어 주세요.'); return; } setBusy(true); setErr(''); try { tf.setReview(await api(`/trial-flow/${tf.id}/space/item`, { method: 'POST', body: { item_id: it.item_id, reviewer, ...body } })); setMode(''); tf.reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const search = async () => { if (!q.trim()) return; try { const v = await api(`/library/search?${new URLSearchParams({ q: q.trim(), placeableOnly: '1' })}`); setFound((v.results || []).slice(0, 16).map(r => r.item)); } catch (e) { setErr(e.message); } };
  const step = (k, d, lo, hi) => setAdj(a => ({ ...a, [k]: +Math.min(hi, Math.max(lo, (a[k] || 0) + d)).toFixed(2) }));
  const grid = list => <div className="sv-grid">{list.filter(a => a.id !== it.pick?.id).map(a => <button key={a.id} className="sv-cand" disabled={busy} onClick={() => save({ verdict: 'swap', assetId: a.id })} title={a.nameKo}>{a.thumbnail ? <img src={a.thumbnail} alt="" loading="lazy" /> : <span className="sv-noimg">—</span>}<small>{a.nameKo}</small></button>)}</div>;
  return <section className="panel approve-panel sv-obj">
    <p className="eyebrow">물건 판정</p>
    <h2>{it.name}{it.host && <span className="sv-host">퍼즐 단서</span>}</h2>
    <p className="muted">{it.roomName} · {it.item_id}{it.reason ? ` — ${it.reason.slice(0, 120)}` : ''}</p>
    {it.pick ? <div className="sv-cur">{it.pick.thumbnail && <img src={it.pick.thumbnail} alt="" />}<span><b>{it.pick.nameKo}</b>{it.pick.needsReplacement && <small className="warning-text"> 임시본</small>}</span></div> : <p className="warning-text">고른 에셋 없음{it.missing?.why ? ` — ${it.missing.why}` : ''}</p>}
    <p>지금 판정: <Badge v={cur} />{cur?.note ? <small className="muted"> {cur.note}</small> : null}{cur && <button className="quiet" disabled={busy} onClick={() => save({ verdict: null })}>판정 취소</button>}</p>
    <div className="sv-acts">
      <button disabled={busy || !it.pick} onClick={() => save({ verdict: 'approve' })}>좋음</button>
      <button className="secondary" onClick={() => setMode(m => m === 'swap' ? '' : 'swap')}>다른 에셋</button>
      <button className="secondary" disabled={!it.placed} onClick={() => setMode(m => m === 'adjust' ? '' : 'adjust')}>위치·크기</button>
      <button className="danger" disabled={busy || it.host} title={it.host ? '퍼즐 단서가 나오는 물건은 뺄 수 없음' : ''} onClick={() => save({ verdict: 'remove' })}>빼기</button>
      <button className="secondary" onClick={() => setMode(m => m === 'replan' ? '' : 'replan')}>수정 요청</button>
      <button className="secondary" onClick={() => setMode(m => m === 'regenerate' ? '' : 'regenerate')}>새로 만들기</button>
    </div>
    {mode === 'swap' && <div className="sv-mode"><b>후보에서 고르기</b>{grid(it.candidates)}<div className="button-row"><input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="라이브러리 검색" /><button className="secondary" onClick={search}>찾기</button></div>{found && grid(found)}</div>}
    {mode === 'adjust' && <div className="sv-mode"><b>위치·크기</b><small className="muted">방 기준 — 뒷벽 쪽 / 앞(문·마당) 쪽 · 왼벽 / 오른벽</small>
      <div className="sv-pad"><button onClick={() => step('dz', -0.25, -4, 4)}>↑ 뒷벽 쪽</button><div><button onClick={() => step('dx', -0.25, -4, 4)}>← 왼벽</button><button onClick={() => step('dx', 0.25, -4, 4)}>오른벽 →</button></div><button onClick={() => step('dz', 0.25, -4, 4)}>↓ 앞쪽</button></div>
      <div className="button-row"><button className="secondary" onClick={() => step('rot', -90, -180, 180)}>⟲ 90°</button><button className="secondary" onClick={() => step('rot', 90, -180, 180)}>⟳ 90°</button><button className="secondary" onClick={() => step('scale', -0.1, 0.5, 2)}>작게</button><button className="secondary" onClick={() => step('scale', 0.1, 0.5, 2)}>크게</button></div>
      <p className="muted">옮김 좌우 {adj.dx} m · 앞뒤 {adj.dz} m · 돌림 {adj.rot}° · 크기 ×{adj.scale}</p>
      <button disabled={busy} onClick={() => save({ verdict: 'adjust', adjust: adj })}>저장</button></div>}
    {(mode === 'replan' || mode === 'regenerate') && <div className="sv-mode"><b>{mode === 'replan' ? '수정 요청 — 에이전트가 의견대로 다시 고름' : '새로 만들기 요청 — 맞는 에셋이 라이브러리에 없을 때(생성 대기열에 기록)'}</b><textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder={mode === 'replan' ? '예: 양반집 사랑방에 어울리는 낮은 문갑으로' : '예: 짚으로 엮은 둥근 멍석, 지름 1.5 m'} /><button disabled={busy || !note.trim()} onClick={() => save({ verdict: mode, note })}>저장</button></div>}
    {err && <div className="blockers ap-err"><p>{err}</p></div>}
  </section>;
}

function ApplyPanel({ tf }) {
  const rv = tf.review; const fl = tf.flow; const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  if (!rv?.ready) return null;
  const vals = Object.values(rv.review); const n = k => vals.filter(v => v.verdict === k).length;
  const memo = rv.unapplied.filter(k => rv.review[k]?.verdict === 'replan').length;
  const running = fl?.space?.steps?.some(r => r.status === 'running');
  const apply = async () => { setBusy(true); setErr(''); try { const r = await api(`/trial-flow/${tf.id}/space/apply`, { method: 'POST', body: {} }); setMsg(`${r.started.map(x => x.slice(1)).join(' → ')} 시작 — 끝나면 화면이 새 방으로 바뀝니다`); tf.reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return <section className="panel approve-panel">
    <p className="eyebrow">판정 반영</p>
    <dl className="ap-dl"><dt>좋음</dt><dd>{n('approve')}</dd><dt>다른 에셋</dt><dd>{n('swap')}</dd><dt>위치·크기</dt><dd>{n('adjust')}</dd><dt>빼기</dt><dd>{n('remove')}</dd><dt>수정 요청</dt><dd>{n('replan')}</dd><dt>새로 만들기</dt><dd>{n('regenerate')}</dd></dl>
    <button className="wide" disabled={busy || running || !rv.unapplied.length} onClick={apply}>{running ? '다시 만드는 중…' : `반영해서 다시 만들기 (${rv.unapplied.length}건)`}</button>
    <small className="muted">{memo ? `수정 요청 ${memo}건은 07 이 그 물건만 다시 고릅니다(Claude 소액) → 08 방 다시 짓기.` : '08 방 다시 짓기만 — 코드, 비용 0.'} 1~3분 걸립니다. 새로 만들기 요청은 생성 대기열 기록만 합니다.</small>
    {msg && <p className="ap-ok">{msg}</p>}{err && <div className="blockers ap-err"><p>{err}</p></div>}
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
    ...(sp.unapplied ? [`반영하지 않은 판정 ${sp.unapplied}건 — 「반영해서 다시 만들기」를 먼저`] : []),
    ...(!reviewer.trim() ? ['검수자 이름을 적어 주세요.'] : []),
  ];
  const approve = async () => { setBusy(true); setErr(''); try { await api(`/trial-flow/${flow.id}/space/approve`, { method: 'POST', body: { reviewer, note } }); await tf.reload(); onNext?.(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return <><ObjectPanel tf={tf} reviewer={reviewer} /><ApplyPanel tf={tf} /><section className="panel approve-panel">
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
  </section></>;
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
