import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { shortHash } from './api.js';

export default function GameReviewFrame({ launch, runtime, projectId, events = [], stale, onClose, onForceClose, onReturn, onObjectSelected, controlRef, visual = false }) {
  const frame = useRef(null);
  const container = useRef(null);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const [flushFailed, setFlushFailed] = useState(false);
  const pendingRequests = useRef(new Set());
  const ready = events.some(event => event.type === 'ready');
  const gameError = events.some(event => event.type === 'error');
  const request = (type, responseType, detail = {}) => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const finish = (message, failure) => {
      clearTimeout(timeout); removeEventListener('message', receive); pendingRequests.current.delete(cancel);
      if (failure) reject(new Error(failure)); else resolve(message);
    };
    const cancel = () => finish(null, '공간 화면이 닫혀 요청을 중단했습니다.');
    const receive = event => {
      const message = event.data;
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || message?.type !== responseType ||
          message.projectId !== projectId || message.sessionId !== launch.session.id || message.requestId !== requestId) return;
      finish(message, message.ok ? null : message.error || '공간 화면 요청을 처리하지 못했습니다.');
    };
    const timeout = setTimeout(() => finish(null, '공간 화면 응답을 기다리는 시간이 지났습니다. 준비 상태를 확인한 뒤 다시 시도해주세요.'), 25000);
    pendingRequests.current.add(cancel); addEventListener('message', receive);
    frame.current?.contentWindow?.postMessage({ type, projectId, sessionId: launch.session.id, requestId, ...detail }, location.origin);
  });
  useEffect(() => () => { for (const cancel of [...pendingRequests.current]) cancel(); }, []);
  useImperativeHandle(controlRef, () => ({
    capture: viewId => request('kgeseo-review-capture', 'kgeseo-review-captured', { viewId }),
    view: viewId => request('kgeseo-review-view', 'kgeseo-review-view-changed', { viewId }),
    inspect: enabled => request('kgeseo-review-inspection', 'kgeseo-review-inspection-changed', { enabled }),
    flush: () => new Promise((resolve, reject) => {
      setClosing(true); setFlushFailed(false);
      const requestId = crypto.randomUUID();
      const finish = failure => {
        clearTimeout(timeout); removeEventListener('message', receive);
        if (failure) { setError(failure); setClosing(false); setFlushFailed(true); reject(new Error(failure)); }
        else resolve();
      };
      const receive = event => {
        const message = event.data;
        if (event.origin !== location.origin || event.source !== frame.current?.contentWindow ||
            message?.type !== 'kgeseo-review-flushed' || message.projectId !== projectId ||
            message.sessionId !== launch.session.id || message.requestId !== requestId) return;
        finish(message.ok ? null : message.error || '관찰 기록을 저장하지 못했습니다. 실행 화면에서 저장을 재시도해주세요.');
      };
      const timeout = setTimeout(() => finish('게임의 저장 응답을 받지 못했습니다. 실행 화면을 유지했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.'), 15000);
      addEventListener('message', receive);
      frame.current?.contentWindow?.postMessage({ type: 'kgeseo-review-flush', projectId, sessionId: launch.session.id, requestId }, location.origin);
    }),
  }));
  useEffect(() => {
    if (!visual || !ready || stale || gameError) return;
    let alive = true;
    controlRef.current?.inspect(true).catch(err => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [visual, ready, stale, gameError, controlRef]);
  useEffect(() => {
    const receive = async event => {
      const message = event.data;
      if (visual && event.origin === location.origin && event.source === frame.current?.contentWindow &&
          message?.type === 'kgeseo-review-object-selected' && message.projectId === projectId && message.sessionId === launch.session.id) {
        onObjectSelected?.(message.object); return;
      }
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow ||
          message?.type !== 'kgeseo-review-return' || message.projectId !== projectId ||
          message.sessionId !== launch.session.id) return;
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      onReturn();
    };
    addEventListener('message', receive);
    return () => removeEventListener('message', receive);
  }, [projectId, launch.session.id, onReturn, onObjectSelected, visual]);

  const fullscreen = async () => {
    try {
      if (!container.current?.requestFullscreen) throw new Error('이 브라우저에서는 전체 화면을 지원하지 않습니다.');
      await container.current.requestFullscreen();
      setError('');
    } catch (err) { setError(err.message || '전체 화면을 열 수 없습니다. 아래 화면에서 계속 검수해주세요.'); }
  };
  const returnToReview = async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    onReturn();
  };
  return <div className="embedded-game" ref={container}>
    <div className="game-toolbar">
      <div><strong>{runtime.title}</strong><small>{visual ? '배치·에셋 둘러보기' : launch.session.mode === 'normal' ? '직접 이동 검수' : '진단 전용'} · v{launch.session.projectRevision} · {shortHash(launch.session.id)}{runtime.presentation ? ` · ${runtime.presentation}` : ''}</small></div>
      <div className="game-controls"><button className="secondary" onClick={fullscreen}>전체 화면</button><button className="secondary" onClick={returnToReview}>판정으로 이동</button><button className="quiet" disabled={closing} onClick={onClose}>{closing ? '기록 저장 중…' : '실행 종료'}</button></div>
    </div>
    <iframe key={launch.session.id} ref={frame} title={`${runtime.title} 실제 게임 공간 검수`} src={launch.url} allow="fullscreen" allowFullScreen referrerPolicy="no-referrer" />
    <div className={`game-connection ${gameError || stale ? 'failed' : ready ? 'ready' : ''}`} role="status"><span className="connection-dot" /><span>{stale ? '연결한 자료의 버전이 바뀌어 기록을 중단했습니다. 실행을 종료하고 재검수 회차를 열어주세요.' : gameError ? '게임 오류가 기록되었습니다. 아래 관찰 기록을 확인해주세요.' : ready ? '연결한 구성의 게임 표시가 확인되었습니다. 저장된 관찰은 아래에서 확인할 수 있습니다.' : '게임과 연결 에셋을 불러오는 중입니다. 준비 상태는 게임 안 검수 패널에서 확인할 수 있습니다.'}</span></div>
    <p className="game-help">{visual ? '드래그로 회전 · 오른쪽 드래그로 이동 · 휠로 확대 · 물체를 짧게 클릭해 이름과 수정 요청 확인. 둘러보기는 외형 검수용이며 동선·충돌 통과로 기록되지 않습니다.' : '게임 화면 클릭 → T 탐색·진입 카메라 연출 시작 · WASD 이동 · 마우스 시점 · Esc 마우스 해제. 검수 패널의 ‘검수 화면으로’로 판정을 이어갈 수 있습니다.'}</p>
    {error && <p className="warning-text" role="alert">{error}</p>}
    {flushFailed && <div className="button-row"><button className="secondary" onClick={onClose}>저장 후 종료 재시도</button><button className="danger" onClick={() => { if (confirm('서버에 도착하지 않은 게임 관찰은 유실될 수 있습니다. 이미 저장된 기록은 남습니다. 저장을 기다리지 않고 실행을 종료할까요?')) onForceClose(); }}>저장하지 못한 실행 강제 종료</button></div>}
  </div>;
}
