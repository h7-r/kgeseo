import { useEffect, useId, useRef, useState } from 'react';
import './SceneReviewBoard.css';

const decisions = { approved: '배치 적합', rejected: '수정 필요', held: '보류' };
const date = value => {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? '촬영 시각 미확인' : time.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const sameIds = (left, right) => Array.isArray(left) && left.length === right.length && new Set(left).size === right.length && right.every(id => left.includes(id));
const imageSource = value => typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,/i.test(value) ? value : null;

function zoneEvidence(project, zone, captureIds, review) {
  const state = project?.sceneReviewStatus?.[zone.id];
  const referencesCurrent = project?.currentValidity?.source === true && project?.currentValidity?.game === true;
  // The server also checks the capture session. Matching hashes alone cannot
  // preserve an approval after that session reports a rendering error.
  const known = referencesCurrent && state && Array.isArray(state.blockers) &&
    sameIds(state.requiredViewIds, zone.views.map(view => view.id)) && sameIds(state.latestCaptureIds, captureIds);
  const ready = Boolean(known && state.blockers.every(problem => problem?.code === 'scene_recaptured'));
  const valid = Boolean(ready && review && state.reviewId === review.id && state.status === review.decision && state.blockers.length === 0 && sameIds(review.captureIds, captureIds));
  return { state, ready, valid, referencesCurrent };
}

function PhotoModal({ photo, onClose }) {
  const dialog = useRef(null);
  const close = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const panel = dialog.current;
    panel.showModal();
    close.current?.focus();
    return () => {
      panel.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={dialog} className="scene-photo-modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="scene-photo-modal-inner">
      <div className="scene-photo-modal-head"><div><h2 id={titleId}>{photo.zoneName} · {photo.label}</h2><p>{date(photo.capture.at)} 촬영 · 현재 배치의 실제 게임 화면</p></div><button type="button" ref={close} onClick={onClose} aria-label="사진 확대 닫기">닫기 <span aria-hidden="true">×</span></button></div>
      <img src={imageSource(photo.capture.imageDataUrl)} alt={`${photo.zoneName}, ${photo.label}에서 촬영한 실제 배치`} />
      <p className="scene-photo-modal-hint">사진은 배치 확인 자료입니다. 이동 가능 여부와 퍼즐 동작은 게임에서 확인합니다.</p>
    </div>
  </dialog>;
}

/** Current implementation's area photographs, not AI story-to-asset selection. */
export default function SceneReviewBoard({ project, runtime, busy = false, disabled = false, reviewer = '', onReviewerChange, onCaptureAll, onReview, captureProgress = '', capturing = false }) {
  const [notes, setNotes] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [pendingZone, setPendingZone] = useState(null);
  const [localError, setLocalError] = useState(null);
  const headingId = useId();
  const views = runtime?.visualViews || [];
  const zones = [];
  for (const view of views) {
    let zone = zones.find(item => item.id === view.zoneId);
    if (!zone) { zone = { id: view.zoneId, name: view.zoneName || view.zoneId, views: [] }; zones.push(zone); }
    zone.views.push(view);
  }
  const current = capture => Boolean(project && runtime && capture.projectRevision === project.revision && capture.gameRevision === project.gameRevision && (!runtime.revision || runtime.revision === project.gameRevision) && capture.runtimeProfile === runtime.profile);
  const captures = [...(project?.sceneCaptures || [])].reverse();
  const photoFor = view => captures.find(capture => capture.viewId === view.id && capture.zoneId === view.zoneId && current(capture) && imageSource(capture.imageDataUrl));
  const capturedCount = views.filter(photoFor).length;
  const target = project?.runtimeUse === 'target' && project?.runtimeId === runtime?.id;
  const unavailable = !project || !runtime || !views.length || runtime.available === false;
  const locked = busy || disabled || capturing || pendingZone !== null || unavailable;
  const scopeKey = `${project?.id}:${project?.revision}:${project?.gameRevision}:${runtime?.profile}`;
  const expandedPhoto = expanded?.scopeKey === scopeKey ? expanded : null;
  const currentReviews = [...(project?.sceneReviews || [])].reverse().filter(review => review.projectRevision === project?.revision && review.gameRevision === project?.gameRevision);
  const reviewFor = zone => currentReviews.find(review => review.zoneId === zone.id);
  const reviewedCount = zones.filter(zone => {
    const photos = zone.views.map(photoFor);
    const review = reviewFor(zone);
    return target && photos.every(Boolean) && zoneEvidence(project, zone, photos.map(photo => photo.id), review).valid;
  }).length;

  const submit = async (zone, decision, note, captureIds) => {
    if (locked || !target || !reviewer.trim() || captureIds.length !== zone.views.length || !zoneEvidence(project, zone, captureIds, reviewFor(zone)).ready || (decision !== 'approved' && !note.trim())) return;
    setPendingZone(zone.id); setLocalError(null);
    try { await onReview?.({ zoneId: zone.id, decision, note: note.trim(), captureIds }); }
    catch (error) { setLocalError({ key: scopeKey, zoneId: zone.id, message: error?.message || '판정을 저장하지 못했습니다. 다시 시도해주세요.' }); }
    finally { setPendingZone(null); }
  };

  return <section className="scene-review-board" aria-labelledby={headingId}>
    <header className="scene-board-intro">
      <div className="scene-board-title"><div><p className="scene-board-kicker">실제 배치의 대표 시점</p><h2 id={headingId}>구역 사진 비교</h2><p>게임 화면에서 확인한 배치를 사진으로 비교하고 구역마다 의견을 남깁니다. 설화에 맞춘 자동 에셋 선정 결과는 아닙니다.</p></div><span className="scene-board-count">{capturedCount}<span> / {views.length}장</span></span></div>
      <div className="scene-board-stats"><span><b>{zones.length}</b>개 공간 구역</span><span><b>{Number.isInteger(runtime?.publicAssetCount) ? runtime.publicAssetCount : '—'}</b>개 공개 GLB 파일</span><span><b>{reviewedCount}</b>개 구역 판정</span></div>
      <p className="scene-board-scope">GLB 수는 근경·원경을 포함한 파일 수이며, 배치된 물체 수가 아닙니다. 대표 사진에 가려진 물체까지 모두 확인한 것으로 처리하지 않습니다. 서사 5씬이 공유하는 현재 공간이며, 씬 진행에 따른 상태 변화는 아직 검증하지 않습니다.</p>
      <div className="scene-board-capture"><button type="button" disabled={locked || !onCaptureAll} onClick={onCaptureAll}>{capturing ? '구역 사진 촬영 중…' : capturedCount ? '현재 배치 전체 다시 촬영' : '전체 구역 사진 촬영'}</button><p>구역당 대표 시점 {zones.length ? Math.round(views.length / zones.length) : 2}장 · 사진을 누르면 크게 볼 수 있습니다.</p></div>
      {(capturing || captureProgress) && <div className={`scene-capture-progress${capturing ? ' active' : ''}`} role="status" aria-live="polite"><span aria-hidden="true" />{captureProgress || '실제 게임 화면을 준비하고 있습니다.'}</div>}
      {!target && <p className="scene-board-reference">{project?.runtimeUse === 'reference' ? '참고용으로 연결된 공간입니다. 사진은 확인할 수 있지만 이 설화의 배치 승인 근거로 사용하지 않습니다.' : '검수 자료를 저장하고 실제 검수 대상 공간을 연결하면 구역별 판정을 기록할 수 있습니다.'}</p>}
      {disabled && <p className="scene-board-reference">입력 변경 사항이나 현재 자료 상태를 먼저 확인해주세요. 촬영과 판정은 저장된 자료에 기록됩니다.</p>}
      <label className="scene-reviewer"><span>검수자 <small>구역 판정에 공통으로 기록</small></span><input value={reviewer} maxLength={100} onChange={event => onReviewerChange?.(event.target.value)} placeholder="이름 또는 담당자명" autoComplete="name" disabled={busy || capturing} /></label>
    </header>

    {!views.length && <div className="scene-board-empty"><b>이 공간의 촬영 지점이 아직 없습니다.</b><p>설화 입력만으로 배치 사진이 생성되지는 않습니다. 구현된 공간과 검수 시점을 연결하면 이곳에 표시됩니다.</p></div>}
    <div className="scene-zone-list">{zones.map((zone, index) => {
      const photos = zone.views.map(photoFor);
      const allCaptured = photos.every(Boolean);
      const captureIds = photos.filter(Boolean).map(photo => photo.id);
      const review = reviewFor(zone);
      const evidence = zoneEvidence(project, zone, captureIds, review);
      const validReview = target && allCaptured && evidence.valid ? review : null;
      const noteKey = `${scopeKey}:${zone.id}`;
      const note = notes[noteKey] ?? validReview?.note ?? '';
      const canReview = !locked && target && allCaptured && evidence.ready && reviewer.trim() && Boolean(onReview);
      const alreadyReviewed = Boolean(validReview);
      const status = validReview ? decisions[validReview.decision] || '판정 기록' : allCaptured && !evidence.ready ? '검수 근거 확인 필요' : review ? '새 사진 재검수' : allCaptured ? '사진 확인 후 판정' : '촬영 대기';
      const serverProblem = Array.isArray(evidence.state?.blockers) ? evidence.state.blockers.find(problem => problem?.code !== 'scene_recaptured')?.message : null;
      const evidenceProblem = !evidence.ready && allCaptured ? (!evidence.referencesCurrent ? '서버에서 현재 자료의 버전이 확인되지 않았습니다. 자료 상태를 새로 확인해주세요.' : serverProblem || '사진과 검수 세션의 유효 상태가 확인되지 않았습니다. 기록을 새로 읽거나 다시 촬영해주세요.') : null;
      const hasOldPhotos = !allCaptured && (project?.sceneCaptures || []).some(capture => capture.zoneId === zone.id);
      const error = localError?.key === scopeKey && localError.zoneId === zone.id ? localError.message : null;
      return <article className="scene-zone-card" key={zone.id} aria-labelledby={`${headingId}-${zone.id}`}>
        <div className="scene-zone-heading"><div className="scene-zone-name"><span className="scene-zone-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><span className="scene-zone-code">{zone.id}</span><h3 id={`${headingId}-${zone.id}`}>{zone.name}</h3></div></div><span className={`scene-zone-status ${validReview?.decision || 'pending'}`}>{status}</span></div>
        <div className="scene-zone-photos">{zone.views.map((view, photoIndex) => {
          const capture = photos[photoIndex];
          return <figure className="scene-area-photo" key={view.id}>
            {capture ? <button type="button" className="scene-photo-open" onClick={() => setExpanded({ scopeKey, zoneName: zone.name, label: view.label, capture })} aria-label={`${zone.name}, ${view.label} 사진 확대`}><img src={capture.imageDataUrl} alt={`${zone.name} · ${view.label} 실제 배치`} loading="lazy" /><span className="scene-photo-enlarge" aria-hidden="true">확대 ↗</span></button> : <div className="scene-photo-empty"><svg viewBox="0 0 48 38" width="42" height="34" fill="none" aria-hidden="true"><rect x="2" y="2" width="44" height="34" rx="5" stroke="currentColor" strokeWidth="1.5" /><circle cx="15" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" /><path d="m5 31 12-12 8 8 7-7 11 11" stroke="currentColor" strokeWidth="1.5" /></svg><b>{capturing ? '현재 배치 촬영 중' : '아직 촬영하지 않은 시점'}</b><span>{hasOldPhotos ? '게임 또는 검수 회차가 바뀌어 새 사진이 필요합니다.' : '위의 전체 구역 사진 촬영을 눌러주세요.'}</span></div>}
            <figcaption><strong>{view.label}</strong><span>{capture ? date(capture.at) : `${photoIndex + 1}번 시점`}</span></figcaption>
          </figure>;
        })}</div>
        <div className="scene-zone-review"><label><span>이 구역의 확인 내용·수정 요청</span><textarea value={note} onChange={event => setNotes(old => ({ ...old, [noteKey]: event.target.value }))} rows={3} maxLength={3000} placeholder="예: 나루터 입구가 잘 보입니다. 오른쪽 통발은 길을 막지 않도록 조금 옮겨주세요." disabled={locked || !target || alreadyReviewed} /></label>
          {validReview ? <div className={`scene-zone-saved ${validReview.decision}`}><strong>{decisions[validReview.decision]} 기록됨</strong><span>{validReview.reviewer} · {date(validReview.at)}</span><small>현재 사진에 대한 판정입니다. 배치가 바뀌면 다시 촬영하고 재검수합니다.</small></div> : <><div className="scene-zone-actions"><button type="button" disabled={!canReview} onClick={() => submit(zone, 'approved', note, captureIds)}>배치 적합</button><button type="button" className="scene-review-reject" disabled={!canReview || !note.trim()} onClick={() => submit(zone, 'rejected', note, captureIds)}>수정 필요</button><button type="button" className="scene-review-hold" disabled={!canReview || !note.trim()} onClick={() => submit(zone, 'held', note, captureIds)}>보류</button></div><p className="scene-zone-guidance">{!allCaptured ? '이 구역의 모든 대표 사진을 촬영해야 판정할 수 있습니다.' : !reviewer.trim() ? '위에 검수자 이름을 입력하고 사진을 확인해주세요.' : '수정 필요·보류에는 이유를 적어주세요. 사진 표시만으로 자동 승인되지 않습니다.'}</p></>}
          {error && <p className="scene-zone-error" role="alert">{error}</p>}
          {evidenceProblem && <p className="scene-zone-error" role="status">{evidenceProblem}</p>}
        </div>
      </article>;
    })}</div>
    <p className="scene-board-footnote">사진 판정은 배치·형태·분위기에 대한 사람의 검수 기록입니다. 플레이어의 이동과 퍼즐 해결 여부는 실제 게임 검수에서 따로 확인합니다.</p>
    {expandedPhoto && <PhotoModal photo={expandedPhoto} onClose={() => setExpanded(null)} />}
  </section>;
}
