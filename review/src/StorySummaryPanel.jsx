// 설화 전문 요약 정리본(10/28 미르: 「설화와 기획 맨 위에 지금 이 설화가 어떤 스토리인지 전문 요약 정리본이 먼저 보여야」)
//   원문만 읽어 정리(각색 섞지 않음). 만들기는 단추를 누를 때 한 번 — Claude, 약 $0.03~0.10.
import { useEffect, useState } from 'react';
import { api, date } from './api.js';

export default function StorySummaryPanel({ project }) {
  const [s, setS] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { if (!project?.id) return; setS(null); api(`/story-summary/${project.id}`).then(setS).catch(e => setErr(e.message)); }, [project?.id, project?.revision]);
  const make = async () => { setBusy(true); setErr(''); try { setS(await api(`/story-summary/${project.id}`, { method: 'POST', body: {} })); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const v = s?.summary;
  return (
    <section className="panel story-summary">
      <div className="panel-head"><div><h2>이 설화는 어떤 이야기인가 — 전문 요약</h2><p>설화 원문만 읽고 정리했습니다(게임 각색은 섞지 않음). 원문에 없는 것은 쓰지 않고, 원문이 답하지 않는 것은 「아직 모르는 것」에 둡니다.</p></div>
        <div className="button-row">{s?.stale && <span className="pill">원문이 바뀜 — 다시 만들기 권장</span>}<button onClick={make} disabled={busy || !s?.hasSource}>{busy ? '정리하는 중… (30초 안팎)' : v ? '다시 만들기' : '요약 만들기'}</button></div></div>
      {err && <p className="error">{err}</p>}
      {s && !s.hasSource && <p className="muted">설화 원문이 아직 없습니다. 아래 「설화 자료 입력」에 원문을 넣고 저장하세요.</p>}
      {s?.hasSource && !v && !busy && <p className="muted">아직 요약이 없습니다. 「요약 만들기」를 누르면 원문({s.sourceChars.toLocaleString()}자)을 읽어 정리합니다(Claude, 약 $0.03~0.10).</p>}
      {v && <div className="ss-body">
        <h3>{v.title}</h3><p className="ss-one">{v.one_line}</p>
        {v.place_time && <p><b>무대·때</b> {v.place_time}</p>}
        {(v.people || []).length > 0 && <div><b>등장인물</b><ul>{v.people.map((x, i) => <li key={i}><b>{x.name}</b> — {x.who}</li>)}</ul></div>}
        <div><b>줄거리</b>{(v.story || []).map((t, i) => <p key={i}>{t}</p>)}</div>
        {v.ending && <p><b>결말</b> {v.ending}</p>}
        {(v.events || []).length > 0 && <details><summary>사건 차례 {v.events.length}</summary><ol>{v.events.map((t, i) => <li key={i}>{t}</li>)}</ol></details>}
        {(v.open || []).length > 0 && <div><b>아직 모르는 것(원문이 답하지 않음)</b><ul>{v.open.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
        <small className="muted">{v.source_note ? `${v.source_note} · ` : ''}정리 {date(s.at)}{s.costUsd != null ? ` · $${s.costUsd}` : ''}</small>
      </div>}
    </section>
  );
}
