// 설화 전문 요약 정리본(10/28 미르: 「설화와 기획 맨 위에 지금 이 설화가 어떤 스토리인지 전문 요약 정리본이 먼저 보여야」)
//   원문만 읽어 정리(각색 섞지 않음). 만들기는 단추를 누를 때 한 번 — Claude, 약 $0.03~0.10.
import { useEffect, useState } from 'react';
import { api, date } from './api.js';

export default function StorySummaryPanel({ project, trialId }) {
  const [s, setS] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const url = trialId ? `/story-summary/trial/${trialId}` : project?.id ? `/story-summary/${project.id}` : '';
  useEffect(() => { if (!url) return; setS(null); setErr(''); api(url).then(setS).catch(e => setErr(e.message)); }, [url, project?.revision]);
  // 10/28 미르: 버튼 없이 — 설화가 있으면 서버가 뒤에서 정리하고, 화면은 끝날 때까지 다시 읽는다
  useEffect(() => { if (!s?.making) return; const t = setTimeout(() => api(url).then(setS).catch(() => {}), 5000); return () => clearTimeout(t); }, [s, url]);
  const make = async () => { setBusy(true); setErr(''); try { setS(await api(url, { method: 'POST', body: {} })); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const v = s?.summary;
  return (
    <section className="panel story-summary">
      <div className="panel-head"><div><h2>이 설화는 어떤 이야기인가 — 전문 요약</h2><p>설화 원문만 읽고 정리했습니다(게임 각색은 섞지 않음). 원문에 없는 것은 쓰지 않고, 원문이 답하지 않는 것은 「아직 모르는 것」에 둡니다.</p></div>
        {s?.making && <span className="pill">{v ? '원문이 바뀌어 다시 정리하는 중…' : '정리하는 중… (30초 안팎)'}</span>}</div>
      {err && <p className="error">{err}</p>}
      {s && !s.hasSource && <p className="muted">설화 원문이 아직 없습니다.</p>}
      {s?.hasSource && !v && s.making && <p className="muted">원문({s.sourceChars.toLocaleString()}자)을 읽고 정리하고 있습니다. 끝나면 여기에 저절로 나옵니다.</p>}
      {s?.lastError && !s.making && <p className="error">정리하지 못했습니다: {s.lastError} <button className="quiet" onClick={make} disabled={busy}>다시 시도</button></p>}
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
