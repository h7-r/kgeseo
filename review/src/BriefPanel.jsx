// 설화와 기획 — 핵심 검수 카드 (tools/review/brief.mjs · tools/llm/story-brief.mjs)
// 사람은 문서 전체 대신 요약 몇 줄 + 「사람이 꼭 볼 곳」 카드만 판정한다. 카드는 원문 그대로 인용이라 「원문에서 보기」로 바로 대조한다.
// 이 화면은 API 를 부르지 않는다(카드 만들기는 터미널 `npm run story:brief` — 제작 단계).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, date } from './api.js';
import './BriefPanel.css';

const KIND = { invented: '원천에 없는 내용', conflict: '서로 어긋남', uncertain: '미확인을 확정함', sensitive: '민감·금지 왜곡 의심', gap: '핵심 사실 빠짐' };
const SEVERITY = { high: '높음', mid: '보통', low: '낮음' };
const DOC = { A: '설화 원천', B: '시놉시스', C: '씬 계획' };
const FILTERS = [['pending', '판정 전'], ['issue', '문제'], ['ok', '확인'], ['all', '전체']];

// 10/28: 에이전트 시험에서도 같은 카드(apiBase = /trial-brief/<시험 id>, 04 가 끝나면 자동으로 만들어진다)
export default function BriefPanel({ project, dirty, reviewer, setReviewer, onJump = () => {}, onStatus, apiBase, makePath }) {
  const base = apiBase || (project?.id ? `/projects/${project.id}/brief` : '');
  const [making, setMaking] = useState(false);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('pending');
  const [notes, setNotes] = useState({});
  const [busyId, setBusyId] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!base) return;
    try { setState(await api(base)); setError(''); }
    catch (err) { setError(err.message); }
  }, [base]);
  useEffect(() => { setState(null); load(); }, [load, project?.revision]);

  const brief = state?.brief;
  const counts = useMemo(() => {
    const items = brief?.items || [];
    return { total: items.length, pending: items.filter(i => !i.decision).length, issue: items.filter(i => i.decision === 'issue').length, ok: items.filter(i => i.decision === 'ok').length };
  }, [brief]);
  useEffect(() => { onStatus?.(brief ? counts : null); }, [brief, counts, onStatus]);

  const decide = async (item, decision) => {
    setBusyId(item.id); setError('');
    try {
      setState(await api(`${base}/items/${item.id}`, { method: 'POST', body: { contentHash: state.contentHash, decision, note: notes[item.id] ?? item.note ?? '', reviewer } }));
    } catch (err) { setError(err.message); }
    finally { setBusyId(''); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(state.command); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* 복사 막힘 — 글자는 화면에 있다 */ }
  };

  if (!base) return null;
  const make = async () => { setMaking(true); setError(''); try { setState(await api(makePath, { method: 'POST', body: {} })); } catch (err) { setError(err.message); } finally { setMaking(false); } };
  const shown = (brief?.items || []).filter(item => filter === 'all' || (filter === 'pending' ? !item.decision : item.decision === filter));

  return (
    <section className="panel brief">
      <div className="panel-head">
        <div>
          <h2>핵심 검수 카드</h2>
          <p>문서 전체 대신 요약과 「사람이 꼭 볼 곳」만 판정합니다. 카드 인용은 원문과 글자 그대로 맞춰 본 것만 남겼습니다.</p>
        </div>
        {brief && <span className={`pill ${counts.issue ? 'brief-pill-issue' : counts.pending ? '' : 'brief-pill-done'}`}>판정 {counts.ok + counts.issue}/{counts.total}{counts.issue ? ` · 문제 ${counts.issue}` : ''}</span>}
      </div>
      {error && <div className="message error" role="alert">{error}</div>}
      {dirty && <div className="message warning">입력이 저장되지 않았습니다. 카드는 저장된 내용 기준이라, 저장한 뒤 카드를 다시 만들어야 합니다.</div>}

      {state && !brief && (
        <div className="brief-empty">
          <b>{state.stale ? '문서 내용이 바뀌어 예전 카드는 쓰지 않습니다.' : '아직 카드가 없습니다.'}</b>
          {state.auto ? <>
            <p>{state.ready ? '04 Scene 구성표가 끝나면 자동으로 만들어집니다. 만들어지지 않았거나 문서가 바뀌었으면 아래 단추로 만드세요(Claude, 약 $0.2~0.4).' : '01·02·04 문서가 모두 생기면(04 가 끝나면) 자동으로 만들어집니다.'}</p>
            <div className="brief-command">{state.ready && makePath && <button onClick={make} disabled={making}>{making ? '만드는 중… (1분 안팎)' : '카드 만들기'}</button>}<button className="secondary" onClick={load}>다시 읽기</button></div>
          </> : <>
          <p>카드 만들기는 제작 단계라 이 화면에서 API 를 부르지 않습니다. 저장소 폴더의 터미널에서 아래 명령을 실행한 뒤 「다시 읽기」를 누르세요. (한 번에 약 $0.2~0.4, 상한 $1)</p>
          <div className="brief-command"><code>{state.command}</code><button className="secondary" onClick={copy}>{copied ? '복사됨' : '복사'}</button><button onClick={load}>다시 읽기</button></div>
          </>}
        </div>
      )}

      {brief && <>
        <div className="brief-meta">
          <small>{date(brief.createdAt)} · {brief.model} · ${brief.usage?.cost_usd?.toFixed?.(3) ?? '—'}{brief.truncated ? ' · ⚠️ 출력 한도에서 잘림 — 카드가 덜 나왔을 수 있습니다' : ''}{state.stale ? ` · 예전 내용 카드 ${state.stale}묶음은 쓰지 않음` : ''}</small>
          <button className="quiet" onClick={load}>다시 읽기</button>
        </div>
        <div className="brief-summaries">
          {brief.docs.map(doc => (
            <div key={doc.doc}>
              <b>{DOC[doc.doc]} <small>{doc.chars.toLocaleString()}자</small></b>
              {doc.summary.length ? <ul>{doc.summary.map((line, index) => <li key={index}>{line}</li>)}</ul> : <p className="muted">요약 없음</p>}
            </div>
          ))}
        </div>

        <div className="brief-filters" role="group" aria-label="카드 거르기">
          {FILTERS.map(([key, label]) => (
            <button key={key} className={filter === key ? '' : 'secondary'} onClick={() => setFilter(key)}>
              {label} {key === 'all' ? counts.total : counts[key]}
            </button>
          ))}
          {/* 늘 보인다 — 첫 글자에 칸이 사라지면 한글 조합이 끊긴다(10/15) */}
          <label className="brief-reviewer"><span>검수자</span><input value={reviewer} onChange={event => setReviewer(event.target.value)} placeholder="이름" maxLength={100} /></label>
        </div>

        {shown.length === 0 && <p className="empty">{filter === 'pending' ? '판정 전 카드가 없습니다.' : '해당 카드가 없습니다.'}</p>}
        <ol className="brief-cards">
          {shown.map(item => (
            <li key={item.id} className={`brief-card sev-${item.severity} ${item.decision ? `decided-${item.decision}` : ''}`}>
              <div className="brief-card-head">
                <span className={`brief-sev sev-${item.severity}`}>{SEVERITY[item.severity]}</span>
                <b>{KIND[item.kind]}</b>
                <small>{DOC[item.doc]}</small>
                {item.decision && <span className={`tag ${item.decision === 'ok' ? 'approved' : 'rejected'}`}>{item.decision === 'ok' ? '확인' : '문제'}{item.reviewer ? ` · ${item.reviewer}` : ''}</span>}
              </div>
              <p className="brief-why">{item.why}</p>
              <blockquote><span>{DOC[item.doc]}</span>{item.quote}<button className="quiet" onClick={() => onJump(item.doc, item.at, item.quote)}>원문에서 보기 ↗</button></blockquote>
              {item.against && (
                <blockquote className="against"><span>대조 · {DOC[item.against.doc]}</span>{item.against.quote}
                  {item.against.verified ? <button className="quiet" onClick={() => onJump(item.against.doc, item.against.at, item.against.quote)}>원문에서 보기 ↗</button> : <em>원문에서 이 문장을 찾지 못함 — 직접 확인</em>}
                </blockquote>
              )}
              <div className="brief-actions">
                <input value={notes[item.id] ?? item.note ?? ''} onChange={event => setNotes(old => ({ ...old, [item.id]: event.target.value }))} placeholder="문제면 무엇이 문제인지 한 줄 (확인은 비워도 됨)" maxLength={500} />
                <button disabled={busyId === item.id || dirty || !reviewer.trim()} onClick={() => decide(item, 'ok')}>확인</button>
                <button className="danger" disabled={busyId === item.id || dirty || !reviewer.trim() || !(notes[item.id] ?? item.note ?? '').trim()} onClick={() => decide(item, 'issue')}>문제</button>
                {item.decision && <button className="quiet" disabled={busyId === item.id || dirty} onClick={() => decide(item, null)}>되돌리기</button>}
              </div>
            </li>
          ))}
        </ol>
        {brief.rejected?.length > 0 && (
          <details className="brief-rejected">
            <summary>인용 검사에서 뺀 카드 {brief.rejected.length}장 — 모델이 원문을 바꿔 썼거나 형식이 불완전</summary>
            <ul>{brief.rejected.map(item => <li key={item.id}><b>{KIND[item.kind] || '종류 없음'} · {DOC[item.doc] || '문서 없음'}</b> {item.why}<br /><small>「{item.quote}」 — {item.reason}</small></li>)}</ul>
          </details>
        )}
        <p className="note">{state.auto ? '카드를 모두 「확인」해야 05 퍼즐 단계부터 진행됩니다. 「문제」가 있으면 문서를 고쳐(01~04 다시) 카드를 다시 만듭니다.' : '설화 관문은 카드를 모두 판정해야 승인할 수 있고, 「문제」가 하나라도 있으면 승인되지 않습니다(문서를 고쳐 저장하면 카드를 다시 만듭니다).'}</p>
      </>}
    </section>
  );
}
