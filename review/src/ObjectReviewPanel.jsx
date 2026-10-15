import { useState } from 'react';
import { date } from './api.js';

export default function ObjectReviewPanel({ object, issues = [], reviewer, onReviewerChange, onIssue, disabled }) {
  const [note, setNote] = useState('');
  const submit = async disposition => {
    if (await onIssue({ object, disposition, note })) setNote('');
  };
  return <section className="panel object-inspector" aria-label="클릭한 물체 검수">
    <div className="panel-head"><div><h2>클릭한 물체</h2><p>문제가 보이는 물체만 선택해 요청을 남기세요.</p></div><span className="pill">현장 검수</span></div>
    {object ? <>
      <h3>{object.name || '이름 미등록 물체'}</h3>
      <p className="muted">{object.zoneId || '구역 미확인'} · 위치 {object.position?.map(value => Number(value).toFixed(1)).join(', ') || '미확인'}{object.instanceId != null ? ` · 묶음 안 ${object.instanceId + 1}번` : ''}</p>
      <p className="note">{object.identityQuality === 'exact' ? '화면에서 선택한 배치 식별자를 함께 저장합니다.' : '이 물체는 정확한 에셋 이름이 등록되지 않았거나 묶음 단위로 식별됩니다. 화면의 위치와 요청을 함께 기록합니다.'}</p>
      <label className="field"><span>물체 검수자</span><input value={reviewer} maxLength={100} onChange={event => onReviewerChange(event.target.value)} placeholder="이름 또는 담당자명" /></label>
      <label className="field"><span>어디가 어색한가요? 어떻게 바꿀까요?</span><textarea value={note} maxLength={3000} rows={3} onChange={event => setNote(event.target.value)} placeholder="예: 나루터 옆 항아리가 너무 큼. 절반 크기로 줄이고 길 바깥으로 이동." /></label>
      <div className="button-row"><button disabled={disabled || !reviewer.trim() || !note.trim()} onClick={() => submit('change_requested')}>수정 요청 저장</button><button className="danger" disabled={disabled || !reviewer.trim() || !note.trim()} onClick={() => submit('rejected')}>물체 반려</button></div>
      <small>요청은 검수 기록에 저장됩니다. 실제 모델·배치 변경은 별도 작업이며, 수정 후 새 회차에서 다시 확인합니다.</small>
    </> : <div className="object-empty">공간 화면에서 물체를 클릭하면 이름과 위치가 여기에 표시됩니다.</div>}
    {issues.length > 0 && <details className="object-issues" open><summary>이번 회차의 수정·반려 요청 {issues.length}건</summary><ul className="records">{[...issues].reverse().map(issue => <li key={issue.id}><strong>{issue.object?.name || '이름 미등록 물체'} · {issue.disposition === 'rejected' ? '반려' : '수정 요청'}</strong><span>{issue.note}</span><small>{issue.reviewer} · {date(issue.at)}</small></li>)}</ul></details>}
  </section>;
}
