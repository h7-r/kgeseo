import { Suspense, lazy, useEffect, useState } from 'react';
import { date, placementStatusText } from './api.js';

// 라이브러리 화면은 별도 작업(LibraryPanel.jsx)이다. 파일이 아직 없어도 작업대가 빌드되도록 glob 으로 찾는다.
const libraryModules = import.meta.glob('./LibraryPanel.jsx');
const LibraryPanel = libraryModules['./LibraryPanel.jsx'] ? lazy(libraryModules['./LibraryPanel.jsx']) : null;
const SCENES = [0, 1, 2, 3, 4, 5];
const meters = value => Number.isFinite(value) ? value.toFixed(2) : '—';
const KEY_HINT = '게임 화면을 한 번 클릭한 뒤 — G 이동 손잡이 · R 회전 손잡이 · 화살표 앞뒤좌우 미세 이동 · [ ] 높이 · , . 회전 · Enter 확정 · Esc 취소';

export function SceneTabs({ sceneNo, sceneInfo, views = [], disabled, onSelect, onZone }) {
  const zones = sceneNo && sceneInfo?.zoneIds?.length ? sceneInfo.zoneIds : null;
  const wide = views.filter(view => view.id.endsWith('-wide') && (!zones || zones.includes(view.zoneId)));
  return <div className="scene-tabs-wrap">
    <div className="scene-tabs" role="tablist" aria-label="씬 선택">{SCENES.map(value => <button key={value} role="tab" aria-selected={sceneNo === value} className={sceneNo === value ? '' : 'secondary'} disabled={disabled} onClick={() => onSelect(value)}>{value ? `씬${value}` : '전체'}</button>)}</div>
    {sceneNo ? <p className="scene-bound">씬{sceneNo} 구역 <b>{zones?.join(' · ') || '확인 중'}</b> · 이 씬 구역 밖으로는 이동하지 않습니다.</p> : <p className="scene-bound muted">전체 공간을 둘러봅니다. 씬을 고르면 그 씬 구역 안에서만 둘러보고 검수합니다.</p>}
    {wide.length > 0 && <div className="zone-jumps" aria-label="구역 바로 이동">{wide.map(view => <button className="secondary" key={view.id} disabled={disabled} onClick={() => onZone(view.id)}>{view.zoneId} · {view.zoneName}</button>)}</div>}
  </div>;
}

export function PickedPointCard({ picked, disabled, blockedReasons = [], placing, reviewer, onReviewerChange, onPlace, onClear }) {
  if (!picked) return null;
  const { point, zoneId, surface } = picked;
  // 버튼이 왜 막혔는지 그 자리에서 보여 준다(10/15 미르: 「배치 버튼이 비활성화」 — 검수자 칸이 화면 아래에 있어 이유가 안 보였다)
  const reasons = [...(reviewer.trim() ? [] : ['검수자 이름을 적어 주세요.']), ...blockedReasons];
  return <section className="panel placement-card" aria-label="선택한 자리">
    <div className="panel-head"><h2>선택한 자리</h2><span className="pill">{zoneId || '구역 미확인'}</span></div>
    <dl className="coords"><dt>X</dt><dd>{meters(point.x)} m</dd><dt>Y</dt><dd>{meters(point.y)} m</dd><dt>Z</dt><dd>{meters(point.z)} m</dd><dt>표면</dt><dd>{surface || '—'}</dd></dl>
    {/* 늘 보인다 — 첫 글자에 칸이 사라지면 한글 조합이 끊긴다 */}
    {onReviewerChange && <label className="field"><span>검수자</span><input value={reviewer} onChange={event => onReviewerChange(event.target.value)} placeholder="이름 또는 담당자명" maxLength={200} /></label>}
    <button className="wide" disabled={disabled || placing || !reviewer.trim()} onClick={onPlace}>이 자리에 라이브러리 에셋 배치</button>
    <button className="secondary wide" disabled={placing} onClick={onClear}>자리 선택 해제</button>
    {!placing && reasons.length > 0 && <small className="warning-text">배치 버튼이 꺼진 이유 — {reasons.join(' · ')}</small>}
    {placing && <small>배치 조정 중에는 자리를 바꿀 수 없습니다. 먼저 확정하거나 취소해주세요.</small>}
  </section>;
}

function NumberField({ label, value, step, unit, disabled, onCommit }) {
  const shown = Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '';
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(shown); }, [shown, focused]);
  const commit = raw => { const number = Number(raw); if (raw !== '' && Number.isFinite(number)) onCommit(number); };
  return <label className="num-field"><span>{label}</span><input type="number" step={step} value={text} disabled={disabled} onFocus={() => setFocused(true)} onBlur={event => { setFocused(false); commit(event.target.value); }} onChange={event => { setText(event.target.value); commit(event.target.value); }} /><small>{unit}</small></label>;
}

export function PlacementAdjustPanel({ draft, asset, mode, note, saving, disabled, replacing, onNote, onMode, onAdjust, onCancel, onCommit }) {
  const [step, setStep] = useState(0.05);
  const position = draft?.position;
  const move = (axis, delta) => position && onAdjust({ position: { ...position, [axis]: Math.round((position[axis] + delta) * 1000) / 1000 } });
  const rotate = delta => draft && onAdjust({ rotationY: (((draft.rotationY ?? 0) + delta) % 360 + 360) % 360 });
  const resize = delta => draft && onAdjust({ scale: Math.max(0.05, Math.round(((draft.scale ?? 1) + delta) * 100) / 100) });
  const off = disabled || saving || !draft;
  return <section className="panel placement-card adjust" aria-label="배치 조정">
    <div className="panel-head"><div><h2>{replacing ? '변경안 위치·회전 조정' : '배치 조정'}</h2><p>{asset?.nameKo || draft?.nameKo || '에셋'} · {draft?.zoneId || '구역 확인 중'}</p></div><span className="pill">{saving ? '저장 중' : draft ? replacing ? '고치는 중' : '초안' : '불러오는 중'}</span></div>
    {replacing && <p className="note">{originText(replacing)}{replacing.reqId ? ` · ${replacing.reqId}` : ''} 변경안을 고칩니다. 확정하면 새 변경안으로 기록하고 원래 변경안은 「철회(고침)」로 남깁니다. 취소하면 원래대로 돌아갑니다.</p>}
    {!draft && <p className="muted">게임에서 모형을 불러오고 있습니다.</p>}
    <div className="mode-toggle" role="group" aria-label="손잡이 종류"><button className={mode === 'move' ? '' : 'secondary'} disabled={off} onClick={() => onMode('move')}>이동</button><button className={mode === 'rotate' ? '' : 'secondary'} disabled={off} onClick={() => onMode('rotate')}>회전</button></div>
    <div className="num-grid">
      <NumberField label="X" unit="m" step={0.05} value={position?.x} disabled={off} onCommit={value => onAdjust({ position: { ...position, x: value } })} />
      <NumberField label="Y 높이" unit="m" step={0.05} value={position?.y} disabled={off} onCommit={value => onAdjust({ position: { ...position, y: value } })} />
      <NumberField label="Z" unit="m" step={0.05} value={position?.z} disabled={off} onCommit={value => onAdjust({ position: { ...position, z: value } })} />
      <NumberField label="회전 Y" unit="°" step={5} value={draft?.rotationY} disabled={off} onCommit={value => onAdjust({ rotationY: value })} />
      <NumberField label="크기" unit="배" step={0.05} value={draft?.scale} disabled={off} onCommit={value => value >= 0.05 && onAdjust({ scale: value })} />
    </div>
    {Number.isFinite(draft?.groundY) && <small>땅 높이 {meters(draft.groundY)} m · 땅에서 {meters((position?.y ?? 0) - draft.groundY)} m</small>}
    <div className="nudge"><label>미세 이동 <select value={step} disabled={off} onChange={event => setStep(Number(event.target.value))}><option value={0.05}>0.05 m</option><option value={0.25}>0.25 m</option><option value={1}>1 m</option></select></label>
      <div className="nudge-grid"><button className="secondary" disabled={off} onClick={() => move('x', -step)}>X −</button><button className="secondary" disabled={off} onClick={() => move('x', step)}>X ＋</button><button className="secondary" disabled={off} onClick={() => move('z', -step)}>Z −</button><button className="secondary" disabled={off} onClick={() => move('z', step)}>Z ＋</button><button className="secondary" disabled={off} onClick={() => move('y', step)}>위로</button><button className="secondary" disabled={off} onClick={() => move('y', -step)}>아래로</button><button className="secondary" disabled={off} onClick={() => rotate(-5)}>↺ 5°</button><button className="secondary" disabled={off} onClick={() => rotate(5)}>↻ 5°</button><button className="secondary" disabled={off} onClick={() => resize(-0.05)}>작게</button><button className="secondary" disabled={off} onClick={() => resize(0.05)}>크게</button></div>
    </div>
    <p className="key-hint">{KEY_HINT}</p>
    <label className="field"><span>배치 메모 (선택)</span><textarea rows={2} maxLength={1000} value={note} disabled={saving} onChange={event => onNote(event.target.value)} placeholder="예: 나루터 길가에 항아리 두 개 정도" /></label>
    <div className="decision-actions"><button className="secondary" disabled={saving} onClick={onCancel}>취소</button><button disabled={off} onClick={onCommit}>확정</button></div>
    <small>확정하면 「배치 변경안」으로 기록됩니다. 게임 데이터에는 공간(동선·충돌) 승인 때 반영됩니다.</small>
  </section>;
}

// ── AI 배치 초안 · 변경안 고치기 (규약 §6) ───────────────────────────────────
const originText = value => value?.origin === 'ai-draft' ? 'AI 초안' : value?.replaces ? '사람 · 고침' : '사람';
const yText = value => value.groundSnap || !Number.isFinite(value.position?.y) ? '땅 높이' : `${meters(value.position.y)} m`;
function ProposalMeta({ value }) {
  return <>
    <small>X {meters(value.position.x)} · Y {yText(value)} · Z {meters(value.position.z)} m · 회전 {value.rotationY}° · 크기 {value.scale}배 · 높이 {meters(value.heightM)} m{value.note ? ` · ${value.note}` : ''}</small>
    {(value.reqId || value.reason) && <small className="proposal-reason">{value.reqId && <b>{value.reqId}</b>}{value.reqId && value.reason ? ' · ' : ''}{value.reason}</small>}
    <small>{value.reviewer} · {date(value.at)}{value.trialId ? ` · 시행 ${value.trialId}` : ''}{value.editedFrom ? ` · ${value.editedFrom === 'ai-draft' ? 'AI 초안' : '변경안'}을 고침` : ''}</small>
  </>;
}


export function ProposalList({ placements = [], currentIds = [], disabled, editDisabled, onWithdraw, onEdit }) {
  const [aiOnly, setAiOnly] = useState(false);
  const current = placements.filter(value => currentIds.includes(value.id));
  const aiCount = current.filter(value => value.origin === 'ai-draft').length;
  const shown = aiOnly ? current.filter(value => value.origin === 'ai-draft') : current;
  const others = placements.length - current.length;
  return <section className="panel proposals" aria-label="배치 변경안">
    <div className="panel-head"><div><h2>배치 변경안 {current.length}건</h2><p>이번 회차에 확정했거나 가져온 배치입니다. 배치·에셋 판정에서 확인하고, 공간 승인 때 게임 데이터에 반영됩니다.</p></div><span className="pill">{others ? `지난 기록 ${others}건` : '이번 회차'}</span></div>
    {current.length > 0 && <label className="check compact proposal-filter"><input type="checkbox" checked={aiOnly} onChange={event => setAiOnly(event.target.checked)} />AI 초안만 ({aiCount}건)</label>}
    {shown.length ? <ul className="records">{[...shown].reverse().map(value => <li key={value.id}><strong><span className={`pill origin ${value.origin === 'ai-draft' ? 'amber' : ''}`}>{originText(value)}</span> {value.asset.nameKo}{value.sceneNo ? ` · 씬${value.sceneNo}` : ''}{value.zoneId ? ` · ${value.zoneId}` : ''}</strong><span className="proposal-actions"><button className="secondary" disabled={editDisabled} onClick={() => onEdit(value.id)}>위치·회전 조정</button><button className="secondary" disabled={disabled} onClick={() => onWithdraw(value.id)}>철회</button></span><ProposalMeta value={value} /></li>)}</ul> : <p className="muted">{aiOnly ? '이번 회차에 가져온 AI 초안이 없습니다.' : '공간에서 땅·길을 클릭해 자리를 고르고 라이브러리 에셋을 놓거나, AI 배치 초안을 가져오면 여기에 쌓입니다.'}</p>}
  </section>;
}

/** 게임에서 변경안 미리보기를 클릭했을 때(object-selected · review-proposal:<id>) 선택 카드 */
export function ProposalActionsCard({ selected, placement, disabled, editDisabled, onEdit, onWithdraw, onClear }) {
  const pending = !placement;
  return <section className="panel placement-card" aria-label="선택한 배치 변경안">
    <div className="panel-head"><div><h2>선택한 배치 변경안</h2><p>{placement?.asset.nameKo || selected?.name || '변경안'}{placement?.zoneId ? ` · ${placement.zoneId}` : ''}</p></div><span className={`pill ${placement?.origin === 'ai-draft' ? 'amber' : ''}`}>{pending ? '확정 대기' : originText(placement)}</span></div>
    {pending ? <p className="muted">방금 확정한 배치입니다. 저장이 끝나면 목록에 나타나고 다시 고칠 수 있습니다. 지난 회차·반영된 변경안은 고칠 수 없습니다.</p> : <>
      <ul className="records"><li><ProposalMeta value={placement} /></li></ul>
      <button className="wide" disabled={editDisabled} onClick={() => onEdit(placement.id)}>위치·회전 조정</button>
      <button className="secondary wide" disabled={disabled} onClick={() => onWithdraw(placement.id)}>철회</button>
    </>}
    <button className="quiet wide" onClick={onClear}>선택 해제</button>
  </section>;
}

const IMPORT_EXAMPLE = `{
  "origin": "ai-draft",
  "trialId": "trial-0001",
  "items": [
    { "assetId": "public:prop/jar.glb", "source": "public", "position": { "x": 45, "z": 35 }, "rotationY": 0, "scale": 1, "sceneNo": 5, "zoneId": "Z2", "reqId": "S5-R03", "reason": "추락 흔적 근처 깨진 항아리" }
  ]
}`;
/** AI 배치 초안 가져오기(개발 전용) — JSON 붙여넣기·파일 → POST placements/import, 거절 항목 표시 */
export function PlacementImportPanel({ disabled, reviewer, onImport }) {
  const [textValue, setTextValue] = useState('');
  const [trialId, setTrialId] = useState('');
  const [result, setResult] = useState(null);
  const [parseError, setParseError] = useState('');
  const [running, setRunning] = useState(false);
  const readFileText = async file => { if (file) { setTextValue(await file.text()); setResult(null); setParseError(''); } };
  const submit = async () => {
    setParseError(''); setResult(null);
    let plan;
    try { plan = JSON.parse(textValue); } catch { setParseError('JSON 형식을 확인하세요.'); return; }
    const items = Array.isArray(plan) ? plan : plan?.items;
    if (!Array.isArray(items) || !items.length) { setParseError('items 배열(또는 항목 배열 자체)이 필요합니다.'); return; }
    const trial = trialId.trim() || (typeof plan?.trialId === 'string' ? plan.trialId : '');
    if (!trial) { setParseError('시행 ID(trialId)를 적어 주세요.'); return; }
    setRunning(true);
    try { setResult(await onImport({ origin: 'ai-draft', trialId: trial, items })); }
    catch (error) { setResult({ error: error.message, accepted: error.details?.accepted || [], rejected: error.details?.rejected || [] }); }
    finally { setRunning(false); }
  };
  return <details className="panel import-panel">
    <summary>AI 배치 초안 가져오기 <span className="pill">개발용</span></summary>
    <p className="muted">생성 공정이 만든 공간 배치 계획(JSON)을 변경안으로 가져옵니다. 항목마다 에셋 파일·구역 경계를 확인하고, 통과한 것만 「AI 초안」 변경안으로 쌓입니다. Y 가 없으면 게임이 그 자리 땅 높이에 세웁니다.</p>
    <label className="field"><span>시행 ID (비우면 JSON 의 trialId)</span><input value={trialId} maxLength={200} onChange={event => setTrialId(event.target.value)} placeholder="예: trial-0001" /></label>
    <label className="field"><span>배치 계획 JSON</span><textarea rows={8} value={textValue} onChange={event => { setTextValue(event.target.value); setParseError(''); }} placeholder={IMPORT_EXAMPLE} /></label>
    <div className="button-row"><label className="button secondary file-button">JSON 파일 열기<input type="file" accept="application/json,.json" onChange={event => { readFileText(event.target.files?.[0]); event.target.value = ''; }} /></label><button disabled={disabled || running || !textValue.trim() || !reviewer.trim()} onClick={submit}>{running ? '가져오는 중…' : '변경안으로 가져오기'}</button></div>
    {!reviewer.trim() && <small>가져오려면 검수자 이름을 먼저 적어주세요.</small>}
    {parseError && <p className="warning-text" role="alert">{parseError}</p>}
    {result && <div className={`message ${result.error ? 'error' : 'success'}`} role="status"><div><b>{result.error ? result.error : `${result.accepted.length}건 가져옴`}{result.rejected.length ? ` · 거절 ${result.rejected.length}건` : ''}</b>
      {result.rejected.length > 0 && <ul className="rejected-list">{result.rejected.map(item => <li key={item.index}><b>#{item.index + 1}{item.reqId ? ` ${item.reqId}` : ''}</b> {item.assetId || item.url || ''} — {item.reason} <code>{item.code}</code></li>)}</ul>}</div></div>}
  </details>;
}

export function PlacementHistory({ placements = [], currentIds = [] }) {
  if (!placements.length) return <p className="empty">아직 배치 변경안이 없습니다.</p>;
  return <ul className="records">{[...placements].reverse().map(value => <li key={value.id}><strong>{value.asset.nameKo} · {originText(value)} · {value.status === 'proposed' && !currentIds.includes(value.id) ? '지난 회차 · 미반영' : value.replacedBy ? '철회(고침)' : placementStatusText[value.status] || value.status}</strong><span>검수 v{value.projectRevision}</span><small>{value.asset.file} · X {meters(value.position.x)} · Y {yText(value)} · Z {meters(value.position.z)} m · 회전 {value.rotationY}° · 크기 {value.scale}배{value.reqId ? ` · ${value.reqId}` : ''}{value.manifestEntryId ? ` · manifest 출처 ${value.manifestEntryId}` : ''}</small><small>{value.reviewer} · {date(value.at)}{value.appliedAt ? ` · 반영 ${date(value.appliedAt)}` : ''}{value.withdrawnAt ? ` · 철회 ${date(value.withdrawnAt)}` : ''}</small></li>)}</ul>;
}

export function LibraryDrawer({ open, pickedPoint, disabled, onClose, onPick, onRequestGenerate }) {
  useEffect(() => {
    if (!open) return;
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="library-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="library-drawer" role="dialog" aria-modal="true" aria-label="에셋 라이브러리">
      <div className="panel-head"><div><h2>에셋 라이브러리</h2><p>{pickedPoint ? `선택한 자리 X ${meters(pickedPoint.point.x)} · Z ${meters(pickedPoint.point.z)} m 에 놓을 에셋을 고르세요.` : '공간에서 먼저 자리를 고르세요.'}</p></div><button className="quiet" onClick={onClose} aria-label="라이브러리 닫기">×</button></div>
      {LibraryPanel ? <Suspense fallback={<p className="muted">라이브러리를 불러오는 중입니다.</p>}><LibraryPanel pickedPoint={pickedPoint?.point ?? null} disabled={disabled} onPick={onPick} onRequestGenerate={onRequestGenerate} /></Suspense> : <div className="object-empty">라이브러리 화면이 아직 준비되지 않았습니다. (review/src/LibraryPanel.jsx 작업 중)</div>}
    </aside>
  </div>;
}
