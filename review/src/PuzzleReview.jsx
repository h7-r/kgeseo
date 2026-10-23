// 퍼즐 검수(10/22 미르) — 퍼즐은 코드가 「풀린다」고 끝나는 게 아니라 사람이 눈으로 본다.
//   퍼즐마다: 이야기 근거 · 연결된 에셋과 상호작용 순서(몇 곳, 몇 방) · 장면 잠금 · 힌트, 그리고 「화면에서 보기」(그 퍼즐의 물건만 빛남).
//   판정은 기준별 좋음/문제 + 난이도 + 승인/수정 요청(메모) → puzzle_review.json. 수정 요청 메모는 다음 퍼즐 공정의 입력이 된다.
import { useState } from 'react';
import { api } from './api.js';

const KIND = { object: '에셋', fixture: '방 구조', 'trace:foot': '흔적', 'trace:light': '빛 흔적', 'trace:shadow': '그림자 흔적', 'trace:spot': '자리', 'trace:sound': '소리 나는 곳', 'trace:step': '디딤돌', 'trace:water': '물 흔적', 'trace:blood': '핏자국', missing: '연결 안 됨' };
const DIFF = { easy: '쉬움', fit: '적당', hard: '어려움' };
const ACT = { lift: '들추기', open: '열기', slide: '밀기', flip: '뒤집기', empty: '비우기', break: '깨기', look: '들여다보기' };
const CAR = { letter: '✉️ 서신', note: '📜 쪽지', key: '🗝️ 열쇠', piece: '🧶 조각', mark: '👁️ 자국(집지 않음)' };
const HOW = { inspect: '살피기', navigate: '그 자리로 가기', select: '고르기', input: '입력', combine_clues: '단서 짝짓기', observe: '관찰' };

function Card({ p, idx, scenes, check, review, criteria, reviewer, onSaved, onFocus, trialId }) {
  const [crit, setCrit] = useState(review?.criteria || {});
  const [diff, setDiff] = useState(review?.difficulty || null);
  const [note, setNote] = useState(review?.note || '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const sc = scenes.find(s => s.id === p.scene_id);
  const rooms = [...new Set(p.hosts.flatMap(h => h.assets.map(a => a.roomName)))];
  const clueOf = need => p.clues.filter(c => c.from === need && !['combine_clues', 'select', 'input', 'solve'].includes(c.get_by));
  const save = async verdict => {
    setBusy(true); setErr('');
    try { onSaved(await api(`/trials/${trialId}/puzzle-review`, { method: 'POST', body: { puzzle_id: p.id, criteria: crit, difficulty: diff, verdict, note, reviewer } })); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return <li className={`pr-card ${review?.verdict ? `pr-${review.verdict}` : ''}`}>
    <div className="pr-head"><div><span className="pr-no">{idx + 1}</span> <b>{p.id} {p.title}</b> <small className="muted">{sc?.title || p.scene_id} · {HOW[p.solve.interaction] || p.solve.interaction} · 에이전트 난이도 {p.review?.difficulty || '—'}</small></div>
      <div className="button-row"><span className={`pill ${check?.solvable ? '' : 'amber'}`}>{check?.solvable ? '코드상 풀림' : `코드상 막힘 — ${check?.why || ''}`}</span><button className="secondary" onClick={() => onFocus(p.id)}>화면에서 보기</button></div></div>
    <div className="pr-grid">
      <div><h4>이야기</h4>
        <p><small className="muted">풀기 전 믿음</small><br />{p.review?.belief_before}</p>
        <p><small className="muted">풀고 나서 알게 되는 것</small><br />{p.learns}</p>
        <details><summary>원문 근거 {p.review?.basis?.length || 0} · 필수 발견 {p.review?.discoveries?.length || 0} · 게임 창작 {p.review?.invented?.length || 0}</summary>
          <ul>{(p.review?.basis || []).map(b => <li key={b.id}><b>{b.id}</b> {b.text}</li>)}{(p.review?.discoveries || []).map(d => <li key={d.id}><b>{d.id}</b> {d.text}</li>)}{(p.review?.invented || []).map((t, i) => <li key={i}><b>창작</b> {t}</li>)}</ul></details>
      </div>
      <div><h4>상호작용 {p.hosts.length}곳 · 방 {rooms.length}개 ({rooms.join(', ')})</h4>
        <ol className="pr-steps">{p.hosts.map(h => { const a = h.assets[0]; const solveHere = h.need_id === p.solve.at; return <li key={h.need_id} className={solveHere ? 'pr-solve' : ''}>
          {a?.asset?.thumbnail ? <img src={a.asset.thumbnail} alt="" width="34" height="34" loading="lazy" /> : <span className="pr-noimg">{a?.pending ? '임시' : a?.kind === 'fixture' ? '구조' : '흔적'}</span>}
          <div><b>{a ? `${a.roomName} · ${a.name}` : '연결 안 됨'}</b> <small className="muted">{a ? (a.pending ? '에셋 없음 — 임시 자리' : KIND[a.kind] || a.kind) : ''}{a?.asset ? ` · ${a.asset.nameKo}` : ''}</small>
            <div><small>{solveHere ? `풀이 — ${HOW[p.solve.interaction] || p.solve.interaction}: ${p.solve.prompt || ''}` : h.what}</small></div>
            {clueOf(h.need_id).map(c => <div key={c.id} className="pr-clue">{c.carrier?.kind ? <small><b>{ACT[c.reveal?.action] || c.reveal?.action || '연출 없음'}</b> → {c.reveal?.reaction || ''} → <b>{CAR[c.carrier.kind] || c.carrier.kind} 「{c.carrier.name}」</b><br />읽히는 것: 「{c.content}」<br /><span className="muted">수첩: {c.text}</span></small> : <small>단서 {c.id}: {c.text} <span className="warning-text">(발견 연출 없음 — 글만 뜸)</span></small>}</div>)}</div></li>; })}</ol>
        {p.solve.options && <div><small className="muted">선택지: {p.solve.options.join(' / ')}</small></div>}
        {p.solve.device && <p className="pr-gate"><small>🔐 풀이 장치: <b>{({ yundo: '윤도 방위 자물쇠', sangaji: '산가지 셈판 자물쇠', bimil: '비밀자물쇠', munsal: '문살 무늬판', maedeup: '오방색 매듭', pae: '패 끼우기', buk: '북 장단', geulja: '글자 바퀴 자물쇠(게임 장치)', key: '열쇠 자물쇠' })[p.solve.device.kind] || p.solve.device.kind}</b> 「{p.solve.device.name}」 · {p.solve.device.on === 'exit_door' ? '출구 문에 걸림' : '물건에 걸림'} · {JSON.stringify(p.solve.device.spec || {})}<br />답 구하는 법: {p.solve.answer_from}</small></p>}
        <details><summary>정답·힌트</summary><p><small>정답: {Array.isArray(p.solve.answer) ? p.solve.answer.join(', ') : String(p.solve.answer)}</small></p><p><small>힌트 1: {p.hint_1}</small></p><p><small>힌트 2: {p.hint_2}</small></p></details>
        {p.exit?.key && <p className="pr-gate"><small>🗝️ 풀면: {p.exit.key.found} → 「{p.exit.key.name}」 → 🔒 {p.exit.lock}</small></p>}
        {sc && <p className="pr-gate"><small>🔒 장면 잠금 — 「{sc.title}」의 퍼즐을 다 풀어야 다음 장면 방으로 가는 문이 열림. 04 나가는 조건: {sc.exit || '—'}</small></p>}
      </div>
      <div><h4>사람 검수</h4>
        <ul className="pr-crit">{Object.entries(criteria).map(([k, label]) => <li key={k}><span>{label}</span>
          <button className={crit[k] === 'ok' ? '' : 'secondary'} onClick={() => setCrit({ ...crit, [k]: crit[k] === 'ok' ? null : 'ok' })}>좋음</button>
          <button className={crit[k] === 'issue' ? 'danger' : 'secondary'} onClick={() => setCrit({ ...crit, [k]: crit[k] === 'issue' ? null : 'issue' })}>문제</button></li>)}</ul>
        <div className="pr-diff"><span>난이도</span>{Object.entries(DIFF).map(([k, v]) => <button key={k} className={diff === k ? '' : 'secondary'} onClick={() => setDiff(diff === k ? null : k)}>{v}</button>)}</div>
        <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="무엇이 어색한지, 어떻게 고칠지(수정 요청이면 꼭)" />
        <div className="button-row"><button disabled={busy || !reviewer.trim()} onClick={() => save('approve')}>승인</button><button className="secondary" disabled={busy || !reviewer.trim()} onClick={() => save('revise')}>수정 요청</button><button className="quiet" disabled={busy || !reviewer.trim()} onClick={() => save(null)}>판정 없이 저장</button></div>
        {!reviewer.trim() && <small className="warning-text">위 「검수자」 이름이 필요합니다.</small>}
        {err && <small className="warning-text">{err}</small>}
        {review && <small className="muted">마지막 저장 {new Date(review.at).toLocaleString()} · {review.reviewer}{review.verdict ? ` · ${review.verdict === 'approve' ? '승인' : '수정 요청'}` : ''}</small>}
      </div>
    </div>
  </li>;
}

export default function PuzzleReview({ detail, reviewer }) {
  const b = detail.indoor?.build; const list = b?.puzzle?.list;
  const [reviews, setReviews] = useState(detail.indoor?.puzzleReview?.reviews || {});
  const [focus, setFocus] = useState(null);
  if (!list?.length) return null;
  const scenes = b.puzzle.scenes || [];
  const done = list.filter(p => reviews[p.id]?.verdict === 'approve').length;
  const order = [...list].sort((x, y) => (scenes.find(s => s.id === x.scene_id)?.order || 0) - (scenes.find(s => s.id === y.scene_id)?.order || 0));
  return <section className="panel puzzle-review">
    <div className="panel-head"><div><h2>퍼즐 검수 (G3)</h2><p>퍼즐마다 이야기 근거 · 연결된 에셋 · 상호작용 순서 · 장면 잠금을 보고, 「화면에서 보기」로 그 퍼즐의 물건만 빛나게 띄워 직접 조사·풀이·문 이동을 해 봅니다. 판정은 기준별로 남기고, 수정 요청 메모는 퍼즐 공정의 다음 입력이 됩니다.</p></div>
      <span className="pill">승인 {done}/{list.length}</span></div>
    {focus && <div className="pr-viewer"><div className="button-row"><b>화면에서 보기 — {focus}</b><small className="muted">빛나는 것이 이 퍼즐의 물건 · 문은 장면 퍼즐을 다 풀어야 열림 · 플레이(T)로 직접 조사</small><button className="quiet" onClick={() => setFocus(null)}>닫기 ✕</button></div>
      <iframe className="indoor-frame" title="퍼즐 화면" src={`${b.viewer}?focus=${encodeURIComponent(focus)}&v=${encodeURIComponent(b.at)}`} /></div>}
    <ol className="pr-list">{order.map((p, i) => <Card key={p.id} p={p} idx={i} scenes={scenes} check={b.puzzle.checks.find(c => c.id === p.id)} review={reviews[p.id]} criteria={detail.indoor.puzzleCriteria || {}} reviewer={reviewer} trialId={detail.id}
      onSaved={r => setReviews(r.reviews)} onFocus={id => { setFocus(id); setTimeout(() => document.querySelector('.pr-viewer')?.scrollIntoView({ behavior: 'smooth' }), 50); }} />)}</ol>
  </section>;
}
