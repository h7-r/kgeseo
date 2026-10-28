import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AssetViewer from './AssetViewer.jsx';
import GameReviewFrame from './GameReviewFrame.jsx';
import SceneReviewBoard from './SceneReviewBoard.jsx';
import ObjectReviewPanel from './ObjectReviewPanel.jsx';
import BriefPanel from './BriefPanel.jsx';
import { IndoorSide } from './AgentTrialPage.jsx';
import AgentTrialPage from './AgentTrialPage.jsx';
import CineReviewPage from './CineReviewPage.jsx';
import StorySummaryPanel from './StorySummaryPanel.jsx';
import TrialStoryPanel from './TrialStoryPanel.jsx';
import TrialApprovePanel from './TrialApprovePanel.jsx';
// 10/28 미르: 「밑에 설화자료 입력은 왜 동문다리로 안 채워져 있나」 — 검수 기록(예전 방식) 새로 만들기 칸이었다. 에이전트 시험을 볼 때는 접어 두고, 시험의 설화 자료는 위 「에이전트 시험」 칸에 채워 보여 준다
const LegacyWrap = ({ on, children }) => on ? <details className="panel legacy-wrap"><summary>검수 기록(예전 방식)으로 새로 만들기 — 에이전트 시험과 별개</summary>{children}</details> : <>{children}</>;
import { LibraryDrawer, PickedPointCard, PlacementAdjustPanel, PlacementHistory, PlacementImportPanel, ProposalActionsCard, ProposalList, SceneTabs } from './PlacementPanels.jsx';
import { api, gates, statusText, date, shortHash, download, dispositionText } from './api.js';

const empty = { title: '새 설화 검수', caseId: '', runtimeId: null, runtimeUse: null, assetReviewMode: 'individual', sourceText: '', sourceName: '직접 입력', synopsis: '', sceneNotes: '', selectedAssetIds: [] };
const editable = project => Object.fromEntries(Object.keys(empty).map(key => [key, project[key] ?? empty[key]]));
const size = bytes => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const gateName = id => gates.find(gate => gate.id === id)?.label || id;
const finitePoint = value => value && ['x', 'y', 'z'].every(key => Number.isFinite(value[key]));
const eventName = { ready: '실제 공간 표시', frame: '프레임 수신', navigation: '이동 관측', metrics: '성능 관측', interaction: '상호작용', completed: '완료', error: '오류', diagnostic: '진단 조작', checkpoint: '사람 관찰' };

function Tag({ status = 'pending' }) { return <span className={`tag ${status}`}>{statusText[status] || status}</span>; }
function TextField({ label, value, onChange, rows = 8, hint, ...props }) {
  return <label className="field"><span>{label}</span>{hint && <small>{hint}</small>}<textarea rows={rows} value={value} onChange={event => onChange(event.target.value)} {...props} /></label>;
}

export default function App() {
  const [boot, setBoot] = useState(null);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [loadedRevision, setLoadedRevision] = useState(null);
  const [draft, setDraft] = useState({ ...empty });
  const [gate, setGate] = useState(() => (new URLSearchParams(location.search).get('trial') ? 'trial' : 'source'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [notes, setNotes] = useState({});
  const [checks, setChecks] = useState({});
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [assetId, setAssetId] = useState(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerRound, setViewerRound] = useState(0);
  const [docId, setDocId] = useState('fact-contract');
  // 핵심 검수 카드 판정 현황(없으면 null) — 설화 관문 승인 조건
  const [briefStatus, setBriefStatus] = useState(null);
  const [launch, setLaunch] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [inspections, setInspections] = useState({});
  const [observation, setObservation] = useState('');
  const [observationSession, setObservationSession] = useState('');
  const [spaceTab, setSpaceTab] = useState('live');
  const [selectedObject, setSelectedObject] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [captureProgress, setCaptureProgress] = useState('');
  const [captureRun, setCaptureRun] = useState(null);
  const [sceneNo, setSceneNo] = useState(0);
  const [sceneInfo, setSceneInfo] = useState(null);
  const [pickedPoint, setPickedPoint] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [placeDraft, setPlaceDraft] = useState(null);
  const [placeAsset, setPlaceAsset] = useState(null);
  const [placeMode, setPlaceMode] = useState('move');
  const [placeNote, setPlaceNote] = useState('');
  const [placeSaving, setPlaceSaving] = useState(false);
  // 고치는 중인 변경안(규약 §6-2) — 없으면 새 배치
  const [placeReplacing, setPlaceReplacing] = useState(null);
  // 배치 진행 맥락(에셋·세션·씬). 게임 알림 처리기가 최신 값을 읽도록 ref 로 둔다.
  const placeRef = useRef(null);
  const latest = useRef({});
  latest.current = { reviewer, placeNote, sceneNo, launch };
  const captureStarted = useRef(null);
  const activeRef = useRef(null);
  const decisionRef = useRef(null);
  const gameFrameRef = useRef(null);
  const stopGame = async () => { await gameFrameRef.current?.flush(); setLaunch(null); };
  const returnToDecision = useCallback(() => {
    decisionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    decisionRef.current?.focus({ preventScroll: true });
  }, []);
  const changeGate = id => perform(async () => { if (!['space', 'assets'].includes(id)) await stopGame(); setGate(id); setViewerOpen(false); });
  const conflicted = project && project.revision !== loadedRevision;
  const dirty = project ? JSON.stringify(editable(project)) !== JSON.stringify(draft) : Boolean(draft.sourceText.trim());
  useEffect(() => { activeRef.current = conflicted ? null : project; }, [project, conflicted]);
  useEffect(() => {
    placeRef.current = null;
    setSceneNo(0); setSceneInfo(null); setPickedPoint(null); setLibraryOpen(false); setPlaceDraft(null); setPlaceAsset(null); setPlaceReplacing(null); setPlaceSaving(false); setPlaceNote('');
  }, [launch?.session.id]);

  const fail = useCallback(err => {
    const details = err.details?.blockers?.map(item => item.message || item).join(' / ');
    setError(`${err.message}${details ? ` — ${details}` : ''}${err.status === 409 ? ' 최신 상태를 다시 읽은 후 진행해주세요.' : ''}`);
  }, []);
  const list = useCallback(async () => { setProjects(await api('/projects')); }, []);
  const loadProject = useCallback(async id => {
    const value = await api(`/projects/${encodeURIComponent(id)}`);
    setProject(value); setLoadedRevision(value.revision); setDraft(editable(value)); setChecks({}); setNotes({}); setInspections({}); setLaunch(null); setSelectedObject(null);
    history.replaceState({}, '', `/review/?project=${encodeURIComponent(id)}`);
    return value;
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [data, saved] = await Promise.all([api('/bootstrap'), api('/projects')]);
        if (!alive) return;
        setBoot(data); setProjects(saved);
        const id = new URLSearchParams(location.search).get('project');
        if (id) await loadProject(id);
      } catch (err) { if (alive) fail(err); }
    })();
    return () => { alive = false; };
  }, [loadProject, fail]);
  useEffect(() => {
    if (!dirty) return;
    const guard = event => { event.preventDefault(); event.returnValue = ''; };
    addEventListener('beforeunload', guard);
    return () => removeEventListener('beforeunload', guard);
  }, [dirty]);

  const update = (key, value) => { setDraft(old => ({ ...old, [key]: value })); setNotice(''); };
  const perform = async task => {
    setBusy(true); setError(''); setNotice('');
    try { return await task(); } catch (err) { fail(err); } finally { setBusy(false); }
  };
  const refresh = useCallback(async () => {
    if (!activeRef.current) return;
    setRefreshing(true);
    try {
      const id = activeRef.current.id;
      const value = await api(`/projects/${id}`);
      if (activeRef.current?.id === id) setProject(value);
    } catch (err) { fail(err); } finally { setRefreshing(false); }
  }, [fail]);
  useEffect(() => {
    if (!project?.id) return;
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    addEventListener('focus', onFocus);
    const interval = setInterval(() => { if (document.visibilityState === 'visible' && launch) refresh(); }, 6000);
    return () => { removeEventListener('focus', onFocus); clearInterval(interval); };
  }, [project?.id, launch, refresh]);

  const save = (reopen = false) => perform(async () => {
    if (conflicted) throw new Error('다른 창에서 바뀐 자료를 먼저 확인해주세요. 지금 입력은 초안으로 내려받을 수 있습니다.');
    if (!draft.sourceText.trim()) throw new Error('설화 자료를 입력해주세요.');
    await stopGame();
    const value = await api(project ? `/projects/${project.id}` : '/projects', {
      method: project ? 'PATCH' : 'POST',
      body: project ? { ...draft, expectedRevision: loadedRevision } : draft,
    });
    setProject(value); setLoadedRevision(value.revision); setDraft(editable(value)); setChecks({}); setInspections({}); setLaunch(null);
    history.replaceState({}, '', `/review/?project=${value.id}`);
    const latestBootstrap = await api('/bootstrap'); setBoot(latestBootstrap);
    await list();
    setNotice(reopen ? '재검수 회차를 열었습니다. 이전 판정은 이력에 남고 새 버전을 다시 검수합니다.' : `검수 자료 v${value.revision}을 파일로 저장했습니다.`);
  });
  const selectProject = id => perform(async () => {
    if (dirty && !confirm('저장하지 않은 입력을 두고 다른 검수로 이동할까요?')) return;
    await stopGame();
    if (id) await loadProject(id);
    else { setProject(null); setLoadedRevision(null); setDraft({ ...empty }); setChecks({}); setNotes({}); setLaunch(null); setInspections({}); history.replaceState({}, '', '/review/'); }
    setGate('source'); setViewerOpen(false);
  });
  const useNaju = () => {
    if (!boot?.source) return;
    if (draft.sourceText.trim() && !confirm('입력 칸을 저장소의 나주 사실 계약서와 기획 문서로 채울까요? 아직 저장되지는 않습니다.')) return;
    setDraft(old => ({ ...old, title: '나주 앙암바위 검수', caseId: 'NAJU-01', runtimeId: 'NAJU-01', runtimeUse: 'target', assetReviewMode: 'scene', sourceName: boot.source.name, sourceText: boot.source.text,
      synopsis: boot.documents.find(doc => doc.id === 'synopsis')?.text || '',
      sceneNotes: boot.documents.find(doc => doc.id === 'scenes')?.text || '' }));
    setNotice('실제 저장소 문서를 입력했습니다. 사실 계약서는 REVIEW 상태이며 원전 전문은 아닙니다. 내용을 확인하고 저장해주세요.');
  };
  const readFile = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try {
      if (!/\.(md|txt)$/i.test(file.name)) throw new Error('UTF-8 형식의 .md 또는 .txt 파일을 선택해주세요.');
      if (file.size > 400000) throw new Error('설화 파일은 UTF-8 기준 400 KB까지 입력할 수 있습니다.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (text.includes('\u0000')) throw new Error('텍스트가 아닌 데이터가 포함되어 있습니다.');
      setDraft(old => ({ ...old, sourceText: text.replace(/^\uFEFF/, ''), sourceName: file.name }));
      setNotice(`${file.name}을 읽었습니다. 저장 버튼을 누르면 검수 기록을 시작합니다.`); setError('');
    } catch (err) { fail(err); }
  };
  const openGame = async (mode, visual = false) => {
    if (!project || dirty || conflicted) throw new Error('입력 변경을 먼저 저장해주세요.');
    const runtime = boot.runtimes?.find(item => item.id === project.runtimeId);
    if (!runtime) throw new Error('설화와 기획에서 실행할 공간을 연결하고 저장해주세요.');
    if (runtime.available === false) throw new Error((runtime.reviewBlockers || []).join(' ') || '연결한 공간의 실행 자료를 확인해주세요.');
    await stopGame();
    const session = await api(`/projects/${project.id}/sessions`, { method: 'POST', body: { expectedRevision: project.revision, kind: 'space', mode } });
    const url = new URL(runtime.url, location.origin);
    url.searchParams.set('review', '1'); url.searchParams.set('reviewProject', project.id);
    url.searchParams.set('reviewSession', session.id); url.searchParams.set('reviewKind', session.kind);
    url.searchParams.set('reviewMode', session.mode); url.searchParams.set('gameRevision', session.gameRevision);
    url.hash = new URLSearchParams({ reviewToken: session.token }).toString();
    const next = { session, url: url.toString(), visual };
    setLaunch(next); setViewerOpen(false); setSelectedObject(null);
    await refresh();
    setNotice(visual ? '배치된 공간을 둘러보세요. 구역 이동 후 물체를 클릭하면 이름과 수정 요청이 표시됩니다.' : '이 페이지 안에서 게임을 실행했습니다. 화면을 클릭한 뒤 T로 탐색을 시작하세요.');
    return next;
  };
  const launchGame = (mode, visual = false) => perform(() => openGame(mode, visual));
  const assetResult = useCallback(async result => {
    const current = activeRef.current;
    if (!current || !current.selectedAssetIds.includes(result.assetId)) return;
    try {
      await api(`/projects/${current.id}/inspections`, { method: 'POST', body: { ...result, gameRevision: current.gameRevision, expectedRevision: current.revision } });
      if (activeRef.current?.id !== current.id || activeRef.current.revision !== current.revision) return;
      setInspections(old => ({ ...old, [result.assetId]: result }));
      await refresh();
    } catch (err) { fail(err); }
  }, [refresh, fail]);
  const decide = decision => perform(async () => {
    if (!project || dirty || conflicted) throw new Error('현재 입력을 먼저 저장해주세요.');
    const response = await api(`/projects/${project.id}/decisions`, { method: 'POST', body: {
      expectedRevision: project.revision, gate, decision, reviewer, note: notes[gate] || '', checks: (checks[gate] || []).filter(key => gateChecks.some(([id]) => id === key)),
    } });
    await refresh(); await list();
    const applied = response.decisions?.at(-1)?.placementApply === 'applied' ? response.decisions.at(-1).placementIds.length : 0;
    setNotice(applied ? `반영됨 — 배치 변경안 ${applied}건을 게임 데이터(manifest 「놓기」)에 반영했습니다. 다음 회차에서 실제 공간으로 확인하세요. (반영 전 manifest 는 .local/review/ 에 백업)` : `${gateName(gate)} · ${statusText[decision]} 판정을 서버 파일에 기록했습니다.`);
  });
  /** 카드의 「원문에서 보기」 — 그 문서 입력 칸으로 가서 인용 구간을 골라 둔다 */
  const jumpTo = useCallback((docKey, at, quote) => {
    const field = { A: 'sourceText', B: 'synopsis', C: 'sceneNotes' }[docKey];
    const element = document.getElementById(`field-${field}`);
    if (!element) return;
    const start = Math.max(0, at ?? element.value.indexOf(quote));
    const end = Math.min(element.value.length, start + (quote?.length || 0));
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.focus({ preventScroll: true });
    element.setSelectionRange(start, end);
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 22;
    const lines = element.value.slice(0, start).split('\n').length;
    element.scrollTop = Math.max(0, (lines - 3) * lineHeight);
  }, []);
  // 에이전트 시험 → 만든 「빈 지형」 시험 검수 기록을 공간·에셋 검수 화면으로 연다
  // 실내 시험(10/22) — 검수 기록 없이 원안 ↔ 사람 검수 반영본을 공간·에셋 검수 화면에서 나란히
  const [indoorDetail, setIndoorDetail] = useState(null);
  const openIndoor = d => { setIndoorDetail(d); setGate('space'); };
  const openTrialProject = id => perform(async () => { await stopGame(); await loadProject(id); await list(); setGate('space'); setViewerOpen(false); });
  const exportProject = () => perform(async () => {
    const latest = await api(`/projects/${project.id}`);
    download(`설화_검수_${project.id}_v${latest.revision}.json`, JSON.stringify(latest, null, 2));
    setNotice('저장된 입력·판정·관찰 기록을 JSON으로 내보냈습니다.');
  });

  const assets = boot?.assets || [];
  const draftRuntime = boot?.runtimes?.find(item => item.id === draft.runtimeId);
  const runtime = boot?.runtimes?.find(item => item.id === project?.runtimeId);
  const activeSession = project?.sessions?.find(session => session.id === launch?.session.id);
  const currentAsset = assets.find(asset => asset.id === assetId);
  const doc = boot?.documents.find(document => document.id === docId);
  const filtered = assets.filter(asset => (!selectedOnly || draft.selectedAssetIds.includes(asset.id)) &&
    (kind === 'all' || asset.kind === kind) && `${asset.name} ${asset.category || ''} ${asset.path}`.toLowerCase().includes(search.toLowerCase()));
  const selectedGate = gates.find(item => item.id === gate);
  const gateState = project?.gateStatus?.[gate];
  const currentChecks = checks[gate] || [];
  const prerequisites = gateState?.blockers || [];
  const gateChecks = selectedGate ? [...selectedGate.checks, ...(gate === 'assets' && project?.decisionChecks?.assets?.includes('placements') ? [['placements', `배치 변경안 ${project.currentPlacementIds.length}건을 실제 공간에서 확인했습니다. 공간(동선·충돌) 승인 때 게임 데이터에 반영됩니다.`]] : [])] : [];
  const allChecks = gateChecks.every(([key]) => currentChecks.includes(key));
  // 설화 관문: 지금 내용의 핵심 검수 카드가 있으면 모두 판정 · 「문제」 없음이어야 승인(서버도 다시 확인)
  const briefBlocked = gate === 'source' && briefStatus ? [
    ...(briefStatus.pending ? [{ code: 'brief_pending', message: `핵심 검수 카드 ${briefStatus.pending}장이 아직 판정 전입니다.` }] : []),
    ...(briefStatus.issue ? [{ code: 'brief_issue', message: `핵심 검수 카드 ${briefStatus.issue}장에 「문제」가 있습니다 — 문서를 고치거나 반려하세요.` }] : []),
  ] : [];
  const canApprove = project && !capturing && !dirty && !conflicted && gate !== 'play' && allChecks && reviewer.trim() && !prerequisites.length && !briefBlocked.length && !gateState?.decisionId;
  const staleGame = project && (project.currentValidity?.game === false || project.currentValidity?.source === false);
  const savedSessions = project?.sessions || [];
  const savedInspections = project?.inspections || [];
  const normalSessions = savedSessions.filter(session => project?.runtimeUse === 'target' && session.gameRevision === project?.gameRevision && session.mode === 'normal' && session.projectRevision === project?.revision && session.events.some(event => event.type === 'ready') && !session.events.some(event => event.type === 'error'));
  const observeAsset = () => perform(async () => {
    if (!currentAsset || !project || dirty || conflicted) throw new Error('검수 대상을 먼저 저장해주세요.');
    await api(`/projects/${project.id}/inspections`, { method: 'POST', body: { expectedRevision: loadedRevision, gameRevision: project.gameRevision, assetSha256: currentAsset.sha256, assetId: currentAsset.id, status: 'observed', sessionId: observationSession || normalSessions[0]?.id, note: observation } });
    setObservation(''); await refresh(); setNotice(`${currentAsset.name} 표본의 사람 관찰 기록을 저장했습니다.`);
  });

  const startCaptures = () => perform(async () => {
    if (!runtime?.visualViews?.length) throw new Error('연결된 공간의 촬영 시점이 아직 없습니다.');
    setSelectedObject(null);
    setCapturing(true); setCaptureProgress('실제 게임과 에셋을 준비하고 있습니다.');
    try {
      const next = launch?.visual && !staleGame ? launch : await openGame('diagnostic', true);
      captureStarted.current = null;
      setCaptureRun({ id: crypto.randomUUID(), sessionId: next.session.id, projectId: project.id, revision: project.revision, views: runtime.visualViews });
    } catch (err) { setCapturing(false); throw err; }
  });
  const captureReady = Boolean(activeSession?.events?.some(event => event.type === 'ready'));
  const captureError = Boolean(activeSession?.events?.some(event => event.type === 'error'));
  useEffect(() => {
    if (!captureRun) return;
    if ((!captureReady && !staleGame && !conflicted && !captureError) || launch?.session.id !== captureRun.sessionId || captureStarted.current === captureRun.id) return;
    captureStarted.current = captureRun.id;
    (async () => {
      try {
        if (staleGame || conflicted || captureError) throw new Error('실행 자료가 바뀌었거나 게임 오류가 발생했습니다. 새 검수 회차에서 다시 촬영해주세요.');
        for (const [index, view] of captureRun.views.entries()) {
          setCaptureProgress(`${index + 1}/${captureRun.views.length} · ${view.zoneName} / ${view.label} 촬영 중`);
          const shot = await gameFrameRef.current.capture(view.id);
          const value = await api(`/projects/${captureRun.projectId}/scene-captures`, { method: 'POST', body: { expectedRevision: captureRun.revision, sessionId: captureRun.sessionId, viewId: view.id, imageDataUrl: shot.imageDataUrl, gameRevision: shot.gameRevision, runtimeProfile: shot.runtimeProfile } });
          if (activeRef.current?.id !== captureRun.projectId || activeRef.current?.revision !== captureRun.revision) throw new Error('검수 회차가 바뀌어 촬영을 중단했습니다.');
          setProject(value);
        }
        setCaptureProgress(`${captureRun.views.length}장 저장 완료 · 사진을 비교하고 구역별로 판정하세요.`);
        await gameFrameRef.current.view(captureRun.views[0].id);
      } catch (err) { fail(err); setCaptureProgress('촬영을 완료하지 못했습니다. 저장된 사진은 남아 있습니다.'); }
      finally { setCapturing(false); setCaptureRun(null); }
    })();
  }, [captureRun, captureReady, captureError, launch?.session.id, staleGame, conflicted, fail]);
  useEffect(() => {
    if (!captureRun || captureReady) return;
    const timer = setTimeout(() => { setCapturing(false); setCaptureRun(null); setCaptureProgress('게임 준비를 기다리는 시간이 지났습니다. 실행 화면의 로딩 상태를 확인해주세요.'); }, 90000);
    return () => clearTimeout(timer);
  }, [captureRun, captureReady]);
  const reviewZone = input => perform(async () => {
    const value = await api(`/projects/${project.id}/scene-reviews`, { method: 'POST', body: { expectedRevision: loadedRevision, reviewer, ...input } });
    setProject(value); setNotice('구역의 배치 판정을 저장했습니다.'); return true;
  });
  const issueObject = input => perform(async () => {
    if (!launch?.visual || dirty || staleGame || conflicted) throw new Error('현재 회차의 배치 둘러보기에서 물체를 다시 선택해주세요.');
    const value = await api(`/projects/${project.id}/object-issues`, { method: 'POST', body: { expectedRevision: loadedRevision, sessionId: launch.session.id, gameRevision: project.gameRevision, reviewer, sceneNo, ...input } });
    setProject(value); setNotice(`물체 ${dispositionText[input.disposition] || '의견'}을 저장했습니다. ${input.disposition === 'regenerate' ? '생성 공정은 아직 연결 전이라 요청 기록만 남습니다. ' : ''}실제 모델·배치에는 아직 반영되지 않았습니다.`); return true;
  });
  const selectScene = value => perform(async () => {
    if (placeRef.current) throw new Error('배치 조정을 먼저 확정하거나 취소해주세요.');
    const result = await gameFrameRef.current.scene(value);
    setSceneNo(result.scene ?? value); setSceneInfo(result); setPickedPoint(null); setSelectedObject(null);
  });
  const jumpZone = viewId => perform(async () => { await gameFrameRef.current.view(viewId); setSelectedObject(null); });
  const commitPlacement = useCallback(async draft => {
    const context = placeRef.current; const current = activeRef.current;
    if (!context || context.saving || !current || latest.current.launch?.session.id !== context.sessionId) return;
    context.saving = true; setPlaceSaving(true); setError('');
    try {
      if (!draft || !finitePoint(draft.position)) throw new Error('게임에서 받은 배치 초안이 올바르지 않습니다. 다시 배치해주세요.');
      const value = await api(`/projects/${current.id}/placements`, { method: 'POST', body: {
        expectedRevision: current.revision, sessionId: context.sessionId, gameRevision: current.gameRevision, sceneNo: context.sceneNo, zoneId: draft.zoneId || context.zoneId || '',
        asset: context.asset, position: draft.position, rotationY: draft.rotationY ?? 0, scale: draft.scale ?? 1, ...(Number.isFinite(draft.groundY) ? { groundY: draft.groundY } : {}), ...(Number.isFinite(draft.heightM) ? { heightM: draft.heightM } : {}),
        reviewer: latest.current.reviewer, note: latest.current.placeNote, ...(context.replaces ? { replaces: context.replaces } : {}),
      } });
      if (activeRef.current?.id === current.id) setProject(value);
      setNotice(context.replaces ? `「${context.asset.nameKo}」 변경안을 고쳤습니다. 새 변경안으로 기록하고 원래 변경안은 철회(고침)로 남겼습니다.` : `「${context.asset.nameKo}」 배치 변경안을 기록했습니다. 게임 데이터에는 공간(동선·충돌) 승인 때 반영됩니다.`);
    } catch (err) { fail(err); gameFrameRef.current?.post('kgeseo-review-place-cancel'); }
    finally { placeRef.current = null; setPlaceDraft(null); setPlaceAsset(null); setPlaceReplacing(null); setPlaceSaving(false); setPickedPoint(null); setPlaceNote(''); }
  }, [fail]);
  const onGameMessage = useCallback(message => {
    if (message.type === 'kgeseo-review-point-selected') {
      if (placeRef.current || !finitePoint(message.point)) return;
      setPickedPoint({ point: message.point, zoneId: typeof message.zoneId === 'string' ? message.zoneId : '', surface: typeof message.surface === 'string' ? message.surface : '' }); setSelectedObject(null);
    } else if (message.type === 'kgeseo-review-scene-changed') {
      if (message.ok) { setSceneNo(message.scene || 0); setSceneInfo(message); }
    } else if (message.type === 'kgeseo-review-place-changed') {
      if (!placeRef.current) return;
      if (!message.ok) { setError(message.error || '게임에서 배치 초안을 만들지 못했습니다.'); if (!placeRef.current.started) { placeRef.current = null; setPlaceAsset(null); setPlaceReplacing(null); } return; }
      if (placeRef.current.saving) return;
      if (message.draft) { placeRef.current.started = true; setPlaceDraft(message.draft); }
      else { placeRef.current = null; setPlaceDraft(null); setPlaceAsset(null); setPlaceReplacing(null); }
    } else if (message.type === 'kgeseo-review-place-committed') {
      if (!message.ok) { setError(message.error || '게임에서 배치를 확정하지 못했습니다.'); setPlaceSaving(false); return; }
      commitPlacement(message.draft);
    }
  }, [commitPlacement]);
  const startPlacement = item => {
    const current = latest.current;
    if (!pickedPoint || !current.launch?.visual) { setError('먼저 공간에서 땅이나 길을 클릭해 자리를 골라주세요.'); return; }
    if (!item?.placeable || !item.url) { setError('이 항목은 아직 3D 파일이 없어 배치할 수 없습니다. 생성 요청을 남겨주세요.'); return; }
    const asset = { id: item.id, url: item.url, nameKo: item.nameKo || item.nameEn || item.id, source: item.source, ...(item.sha256 ? { sha256: item.sha256 } : {}) };
    placeRef.current = { asset, sessionId: current.launch.session.id, sceneNo: current.sceneNo, zoneId: pickedPoint.zoneId, started: false, saving: false };
    setPlaceAsset(asset); setPlaceDraft(null); setPlaceMode('move'); setLibraryOpen(false); setError('');
    gameFrameRef.current?.post('kgeseo-review-place-start', { asset, at: pickedPoint.point });
  };
  const adjustPlacement = patch => gameFrameRef.current?.post('kgeseo-review-place-adjust', patch);
  const changePlaceMode = mode => { setPlaceMode(mode); adjustPlacement({ mode }); };
  const cancelPlacement = () => { gameFrameRef.current?.post('kgeseo-review-place-cancel'); placeRef.current = null; setPlaceDraft(null); setPlaceAsset(null); setPlaceReplacing(null); setPlaceSaving(false); };
  const confirmPlacement = () => {
    if (!placeRef.current || !reviewer.trim()) { setError('검수자 이름을 적은 뒤 확정해주세요.'); return; }
    setPlaceSaving(true); gameFrameRef.current?.post('kgeseo-review-place-commit');
    const context = placeRef.current;
    setTimeout(() => { if (placeRef.current === context && !context.saving) { setPlaceSaving(false); setError('게임의 확정 응답을 받지 못했습니다. 게임 화면 상태를 확인한 뒤 다시 확정해주세요.'); } }, 15000);
  };
  const requestGenerate = item => {
    if (!pickedPoint) { setError('생성 요청을 남길 자리를 먼저 골라주세요.'); return; }
    const note = prompt('새로 생성할 에셋 요청 내용을 적어주세요.', `${item?.nameKo || '새 에셋'} — 이 자리에 놓을 3D 에셋 생성 요청`);
    if (!note?.trim()) return;
    const { point, zoneId } = pickedPoint;
    issueObject({ disposition: 'regenerate', note, object: { objectId: `library:${item?.id || 'unknown'}`.slice(0, 400), name: item?.nameKo || '라이브러리 항목', meshName: '', groupName: item?.categoryKo || '', zoneId: zoneId || '', identityQuality: 'library-generation-request', position: [point.x, point.y, point.z] } })
      .then(saved => { if (saved) setLibraryOpen(false); });
  };
  const withdrawPlacement = id => perform(async () => {
    if (!reviewer.trim()) throw new Error('철회하려면 검수자 이름을 적어주세요.');
    const value = await api(`/projects/${project.id}/placements/${id}/withdraw`, { method: 'POST', body: { expectedRevision: loadedRevision, reviewer } });
    setProject(value); setNotice('배치 변경안을 철회했습니다. 기록은 이력에 남습니다.');
    setSelectedObject(old => old?.objectId === `review-proposal:${id}` ? null : old);
  });
  // 변경안 고치기(규약 §6-2) — 게임이 그 변경안으로 초안을 만든다. 확정하면 replaces 로 새 변경안 + 옛 것 철회
  const editProposal = id => {
    const current = latest.current;
    const placement = project?.placements?.find(value => value.id === id);
    if (!placement || placement.status !== 'proposed' || !project.currentPlacementIds?.includes(id)) { setError('이번 회차의 제안 상태 변경안만 고칠 수 있습니다.'); return; }
    if (!current.launch?.visual) { setError('「배치된 공간 둘러보기」를 연 뒤 고칠 수 있습니다.'); return; }
    if (placeRef.current) { setError('진행 중인 배치 조정을 먼저 확정하거나 취소해주세요.'); return; }
    if (!reviewer.trim()) { setError('고치려면 검수자 이름을 먼저 적어주세요.'); return; }
    const asset = { id: placement.asset.id, url: placement.asset.url, nameKo: placement.asset.nameKo.slice(0, 120), source: placement.asset.source, ...(placement.asset.sha256 ? { sha256: placement.asset.sha256 } : {}) };
    placeRef.current = { asset, sessionId: current.launch.session.id, sceneNo: placement.sceneNo ?? current.sceneNo, zoneId: placement.zoneId, started: false, saving: false, replaces: id };
    setPlaceAsset(asset); setPlaceReplacing(placement); setPlaceDraft(null); setPlaceMode('move'); setPlaceNote(placement.note || ''); setSelectedObject(null); setPickedPoint(null); setLibraryOpen(false); setError('');
    gameFrameRef.current?.post('kgeseo-review-proposal-edit-start', { proposalId: id });
  };
  // AI 배치 초안 가져오기(개발용, 규약 §6-1)
  const importPlan = async body => {
    if (!project) throw new Error('검수 자료를 먼저 저장해주세요.');
    const value = await api(`/projects/${project.id}/placements/import`, { method: 'POST', body: { ...body, expectedRevision: loadedRevision, reviewer } });
    if (activeRef.current?.id === project.id) setProject(value.project);
    setNotice(`AI 배치 초안 ${value.accepted.length}건을 변경안으로 가져왔습니다.${value.rejected.length ? ` 거절 ${value.rejected.length}건은 가져오기 칸에서 이유를 확인하세요.` : ''}`);
    return { accepted: value.accepted, rejected: value.rejected };
  };
  const spatial = ['assets', 'space'].includes(gate);
  const closeLibrary = useCallback(() => setLibraryOpen(false), []);
  const canUseSceneReview = draft.runtimeUse === 'target' && Boolean(draftRuntime?.visualViews?.length);
  const currentObjectIssues = (project?.objectIssues || []).filter(issue => issue.projectRevision === project.revision && issue.gameRevision === project.gameRevision);
  const currentPlacementIds = useMemo(() => project?.currentPlacementIds || [], [project]);
  // groundSnap(AI 초안 · y 없음)은 y 를 빼고 보낸다 — 게임이 그 자리 땅 높이에 세운다(규약 §6-3)
  const proposalMessage = useMemo(() => JSON.stringify((project?.placements || []).filter(value => currentPlacementIds.includes(value.id)).map(value => {
    const snap = Boolean(value.groundSnap) || !Number.isFinite(value.position?.y);
    return { id: value.id, asset: { id: value.asset.id, url: value.asset.url, nameKo: value.asset.nameKo.slice(0, 120), source: value.asset.source, sha256: value.asset.sha256 }, position: snap ? { x: value.position.x, z: value.position.z } : value.position, rotationY: value.rotationY, scale: value.scale, status: value.status, zoneId: value.zoneId, sceneNo: value.sceneNo, groundSnap: snap, ...(value.origin ? { origin: value.origin } : {}) };
  })), [project, currentPlacementIds]);
  const selectedProposalId = selectedObject?.objectId?.startsWith('review-proposal:') ? selectedObject.objectId.slice('review-proposal:'.length) : null;
  const selectedProposal = selectedProposalId && currentPlacementIds.includes(selectedProposalId) ? project?.placements?.find(value => value.id === selectedProposalId) : null;
  useEffect(() => {
    if (!launch?.visual || !captureReady) return;
    gameFrameRef.current?.post('kgeseo-review-proposals', { proposals: JSON.parse(proposalMessage) });
  }, [launch?.visual, launch?.session.id, captureReady, proposalMessage]);
  const placementCount = currentPlacementIds.length;
  const lastApplied = project?.history?.at(-1)?.type === 'placements-applied' ? project.history.at(-1) : null;

  if (!boot) return <main className="fatal"><p className="eyebrow">왜곡 · 실제 자료 검수</p><h1>{error ? '검수 서버 연결이 필요합니다.' : '검수 자료와 에셋을 확인하고 있습니다.'}</h1><p role="alert">{error || '실제 파일의 버전과 목록을 읽습니다.'}</p>{error && <><p>프로젝트에서 <code>npm run review</code>를 실행한 뒤 <code>http://127.0.0.1:5180/review/</code>를 열어주세요.</p><button onClick={() => location.reload()}>다시 연결</button></>}</main>;

  return <div className="workbench">
    <header className="topbar"><div className="brand"><span className="brand-mark">왜</span><div><strong>왜곡 <span>검수실</span></strong><small>{project?.title || '설화 입력부터 공간 검수까지'}</small></div></div><div className="header-info"><span className="local-dot" /> 이 컴퓨터에 저장 <span className="divider">/</span> 실제 자료 연결</div><button className="quiet" onClick={() => selectProject('')} disabled={busy || capturing}>＋ 새 검수</button></header>
    <aside className="sidebar"><label className="field"><span>검수 기록</span><select value={project?.id || ''} onChange={event => selectProject(event.target.value)} disabled={busy || capturing}><option value="">새 입력</option>{projects.map(item => <option key={item.id} value={item.id}>{item.title} · v{item.revision}</option>)}</select></label>
      <nav aria-label="검수 단계">{gates.filter(item => item.id !== 'assets').flatMap(item => item.id === 'space' ? [{ id: 'cine' }, item] : [item]).map((item, index) => item.id === 'cine' ? <button key="cine" className={`step ${gate === 'cine' ? 'active' : ''}`} onClick={() => changeGate('cine')} disabled={busy || capturing}><span className="step-number">0{index + 1}</span><span><strong>이야기 컷 검수</strong><small>그림 고르기 · 승인 · 반려 — 승인해야 공간으로</small></span></button> : <button key={item.id} className={`step ${gate === item.id || (item.id === 'space' && gate === 'assets') ? 'active' : ''}`} onClick={() => changeGate(item.id)} disabled={busy || capturing} aria-current={gate === item.id ? 'step' : undefined}><span className="step-number">0{index + 1}</span><span><strong>{item.id === 'space' ? '공간·에셋 검수' : item.label}</strong><small>{item.id === 'play' ? '퍼즐 연결 전' : statusText[project?.gateStatus?.[item.id]?.status] || '검수 전'}</small></span></button>)}<button className={`step ${gate === 'history' ? 'active' : ''}`} onClick={() => changeGate('history')} disabled={busy || capturing}><span className="step-number">↗</span><span><strong>판정·관찰 이력</strong><small>{project?.decisions?.length || 0}건의 판정 기록</small></span></button><button className={`step ${gate === 'trial' ? 'active' : ''}`} onClick={() => changeGate('trial')} disabled={busy || capturing}><span className="step-number">AI</span><span><strong>에이전트 시험</strong><small>설화 → 문서 → 선정 → 배치</small></span></button></nav>
      <div className="sidebar-bottom"><b>현재 테스트 범위</b><p>설화 입력 → 연결한 공간에서 에셋·배치 확인 → 승인·반려 기록</p><p>설화 기반 에셋 자동 선정·새 공간 생성·퍼즐 자동 제작은 아직 연결 전입니다.</p><a href="/docs/검수설계/왜곡_에이전트_구조_v5.html" target="_blank" rel="noreferrer">시스템 설계 보기 ↗</a></div>
    </aside>
    <main className={`main ${gate === 'trial' || gate === 'cine' ? 'trial-mode' : ''}`}>
      {gate === 'trial' && <AgentTrialPage onOpenProject={openTrialProject} onOpenIndoor={openIndoor} />}
      {gate === 'cine' && <CineReviewPage onNext={tid => { history.replaceState({}, '', `/review/?trial=${encodeURIComponent(tid)}`); changeGate('trial'); }} />}
      <div className="page-head"><div><p className="eyebrow">LOCAL REVIEW / {gate === 'history' ? 'HISTORY' : gate.toUpperCase()}</p><h1>{spatial ? '공간·에셋 검수' : selectedGate?.label || '판정·관찰 이력'}</h1><p>{project ? `${project.title} · 검수 자료 v${project.revision}` : (gate === 'source' ? '가운데 요약 · 확인 카드 · 문서 원본을 검토하고 오른쪽에서 승인하면 이야기 컷 단계로 넘어갑니다.' : '설화 자료를 입력하고 검수할 공간을 연결하세요.')}</p></div>{project && <Tag status={gateState?.status} />}</div>
      {error && <div className="message error" role="alert">{error}<button className="quiet" onClick={() => setError('')} aria-label="오류 알림 닫기">×</button></div>}
      {notice && <div className="message success" role="status">{notice}</div>}
      {(dirty || staleGame) && <div className="message warning">{dirty ? '저장하지 않은 변경이 있습니다. 저장하면 검수 버전이 올라가고 이전 승인과 관찰 증거를 다시 확인해야 합니다.' : lastApplied ? `반영됨 — 배치 변경안 ${lastApplied.placementIds.length}건이 게임 데이터에 들어가 게임 버전이 바뀌었습니다. 다음 회차에서 실제 공간으로 확인하세요. 「현재 자료로 재검수 회차 열기」를 누르면 반영된 공간으로 새 회차를 시작합니다.` : '연결한 게임 또는 참조 자료가 바뀌었습니다. 현재 버전으로 재검수를 열어주세요.'}</div>}
      {conflicted && <div className="message error" role="alert"><div><b>다른 창에서 검수 자료가 바뀌었습니다.</b><p>기존 초안을 덮어쓰지 않도록 저장과 판정을 중단했습니다.</p><div className="button-row"><button className="secondary" onClick={() => download('설화_미저장_초안.json', JSON.stringify(draft, null, 2))}>내 초안 내려받기</button><button onClick={() => perform(() => loadProject(project.id))}>최신 저장본 다시 읽기</button></div></div></div>}
      <div className={`content-layout ${spatial ? 'spatial-layout' : ''}`}><section className="content">
      {gate === 'source' && <>
        {project ? <StorySummaryPanel project={project} /> : <TrialStoryPanel reviewer={reviewer} setReviewer={setReviewer} />}
        {project && <BriefPanel apiBase={`/trial-brief/p/${project.id}`} makePath={`/trial-brief/p/${project.id}/make`} project={project} dirty={dirty} reviewer={reviewer} setReviewer={setReviewer} onJump={jumpTo} onStatus={setBriefStatus} />}
        <LegacyWrap on={!project}>
        <section className="panel"><div className="panel-head"><div><h2>설화 자료 입력</h2><p>MD·TXT를 불러오거나 텍스트를 그대로 붙여넣으세요.</p></div><span className="pill">외부 전송 없음</span></div>
          <div className="button-row"><button onClick={useNaju} disabled={busy || !boot.source}>나주 기존 자료로 채우기</button><label className="button secondary file-button">MD·TXT 파일 가져오기<input type="file" accept=".md,.txt,text/plain,text/markdown" onChange={readFile} /></label></div>
          <div className="form-grid"><label className="field"><span>검수 제목</span><input value={draft.title} maxLength={160} onChange={event => update('title', event.target.value)} /></label><label className="field"><span>입력 자료 이름·출처</span><input value={draft.sourceName} maxLength={300} onChange={event => update('sourceName', event.target.value)} /></label></div>
          <TextField label="설화 원문 또는 사실 계약서" hint="원문은 입력 그대로 보존합니다. MD 안의 HTML이나 명령은 실행하지 않습니다." id="field-sourceText" value={draft.sourceText} onChange={value => update('sourceText', value)} rows={15} placeholder="설화 본문을 여기에 붙여넣으세요." />
          <div className="runtime-link">
            <div className="form-grid"><label className="field"><span>설화 관리 코드 (선택)</span><input value={draft.caseId} maxLength={100} onChange={event => update('caseId', event.target.value)} placeholder="예: NAJU-01, 새로운 설화 코드" /></label><label className="field"><span>연결할 구현 공간</span><select value={draft.runtimeId || ''} onChange={event => { const id = event.target.value || null; setDraft(old => ({ ...old, runtimeId: id, runtimeUse: id ? 'reference' : null })); }}><option value="">아직 연결하지 않음</option>{boot.runtimes?.map(item => <option key={item.id} value={item.id}>{item.title} · {item.id}</option>)}</select></label></div>
            {draftRuntime && <label className="field"><span>연결 용도</span><select value={draft.runtimeUse || 'reference'} onChange={event => update('runtimeUse', event.target.value)}><option value="reference">참고용 공간 — 이 설화의 공간 승인에는 사용 안 함</option><option value="target">이 설화의 검수 대상 공간</option></select><small>{draft.runtimeUse === 'target' ? '입력한 설화를 구현한 공간인지 확인해주세요. 설화와 실제 배치의 대응은 사람이 판정합니다.' : '다른 설화의 공간을 참고할 수 있습니다. 참고용 관찰은 이 설화의 공간 승인 근거가 되지 않습니다.'}</small></label>}
            <p className="note">현재는 설화를 입력해도 에셋이 자동 선정되거나 배치되지 않습니다. 연결한 기존 공간의 실제 배치를 불러와 검수합니다.</p><p className="muted">어떤 지역의 설화든 입력할 수 있습니다. 현재 실행 가능한 공간은 나주 앙암바위이며, 새 설화의 공간을 자동 생성하는 기능은 아직 연결 전입니다. 공간 없이도 설화와 GLB 에셋 검수를 시작할 수 있습니다.</p>
          </div>
        </section>
        <section className="panel"><h2>검수용 시놉시스와 씬 계획</h2><p className="muted">직접 작성하거나 기존 문서를 수정해 저장합니다. 자동 분석 결과로 표시하지 않습니다.</p><TextField label="시놉시스" id="field-synopsis" value={draft.synopsis} onChange={value => update('synopsis', value)} rows={9} placeholder="핵심 사건, 인물, 보존할 설화 내용과 각색 범위" /><TextField label="씬별 경험·상호작용·에셋 계획" id="field-sceneNotes" value={draft.sceneNotes} onChange={value => update('sceneNotes', value)} rows={10} placeholder="씬 구성 / 사용자 경험 / 확인할 에셋 / 상호작용 / 미구현 항목" /></section>
        <details className="panel evidence"><summary>나주 예제의 저장소 근거 문서 보기</summary><label className="field"><span>근거 자료</span><select value={docId} onChange={event => setDocId(event.target.value)}>{boot.documents.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><small className="path">{doc?.path}</small><pre>{doc?.text}</pre></details>
        <details className="panel evidence"><summary>자료 상태와 검수 범위</summary>{boot.warnings.map(warning => <p key={warning}>{warning}</p>)}</details>
        </LegacyWrap>
      </>}
      {spatial && indoorDetail && <section className="panel"><div className="panel-head"><div><h2>실내 시험 · {indoorDetail.title}</h2><p>에이전트 혼자 만든 결과(사람 검수 전 첫 실행)와 사람 수정본을 나란히 봅니다. 에이전트 혼자 일했을 때 어디까지 되는지 가늠하는 화면입니다.</p></div><div className="button-row"><button className="secondary" onClick={() => changeGate('trial')}>에이전트 시험으로</button><button className="quiet" onClick={() => setIndoorDetail(null)}>닫기 ✕</button></div></div><IndoorSide detail={indoorDetail} /></section>}
      {spatial && <>
        <section className="panel spatial-intro"><div className="panel-head"><div><h2>공간을 보고, 어색한 물체만 짚어주세요.</h2><p>기존에 구현된 배치를 불러옵니다. 설화 기반 자동 에셋 선정은 아직 연결 전입니다.</p></div><span className="pill">{runtime ? project.runtimeUse === 'target' ? '검수 대상' : '참고용 공간' : '공간 미연결'}</span></div>
          <label className="field"><span>에셋 확인 방식</span><select value={draft.assetReviewMode} disabled={Boolean(launch) || capturing} onChange={event => update('assetReviewMode', event.target.value)}><option value="individual">추가로 선택한 파일·표본 개별 확인</option><option value="scene" disabled={!canUseSceneReview}>공간에서 확인 · 구역별 배치 판정</option></select><small>{draft.assetReviewMode === 'scene' ? '구역별 배치 사진과 사람 판정으로 외형을 검수합니다. 아래 상세 도구에서 선택한 에셋만 추가 확인합니다.' : '기존 회차의 개별 검수 방식입니다. 대상 공간이 연결되어 있으면 구역별 방식으로 바꾸고 저장할 수 있습니다.'}</small></label>
          <div className="spatial-tabs" role="group" aria-label="공간 확인 방식"><button className={spaceTab === 'live' ? '' : 'secondary'} onClick={() => setSpaceTab('live')}>공간에서 물체 확인</button><button className={spaceTab === 'photos' ? '' : 'secondary'} onClick={() => setSpaceTab('photos')}>구역 사진 비교</button></div>
        </section>
        <section className={`panel game-panel ${spaceTab === 'photos' ? 'capture-preview' : ''}`}><div className="panel-head"><div><h2>{runtime ? `${runtime.title}` : '검수할 공간 연결'}</h2><p>{runtime?.presentation || '설화와 기획에서 해당 설화를 구현한 공간을 연결하세요.'}</p></div></div>
          {runtime?.available === false && <p className="warning-text" role="alert">{runtime.reviewBlockers?.join(' ') || '연결한 공간의 실행 자료를 확인해주세요.'}</p>}
          {!runtime ? <div className="game-empty"><h3>아직 구현 공간이 없습니다.</h3><p>새 설화의 자동 배치 결과가 준비되면 이곳에서 검수합니다.</p><button className="secondary" onClick={() => changeGate('source')}>설화와 공간 연결 설정</button></div> : <>
            <div className="button-row"><button disabled={busy || capturing || dirty || conflicted || staleGame || runtime.available === false} onClick={() => launchGame('diagnostic', true)}>배치된 공간 둘러보기</button><button className="secondary" disabled={busy || capturing || dirty || conflicted || staleGame || runtime.available === false} onClick={() => launchGame('normal')}>직접 걸으며 동선·충돌 검수</button></div>
            {launch?.visual && <SceneTabs sceneNo={sceneNo} sceneInfo={sceneInfo} views={runtime.visualViews} disabled={busy || capturing || !captureReady || staleGame || conflicted || Boolean(placeAsset)} onSelect={selectScene} onZone={jumpZone} />}
            {launch ? <GameReviewFrame launch={launch} runtime={runtime} projectId={project.id} events={activeSession?.events} stale={staleGame || conflicted} controlRef={gameFrameRef} visual={launch.visual} onObjectSelected={value => { if (!placeRef.current) { setSelectedObject(value); setPickedPoint(null); } }} onGameMessage={onGameMessage} onClose={() => perform(async () => { if (capturing) throw new Error('사진 촬영이 끝난 뒤 종료해주세요.'); await stopGame(); await refresh(); })} onForceClose={() => { setLaunch(null); refresh(); }} onReturn={returnToDecision} /> : <div className="game-empty"><span aria-hidden="true">▷</span><p>공간을 한 번 열고 구역별로 이동하며 배치된 물체를 확인하세요.<br />120개 목록을 하나씩 열 필요가 없습니다.</p></div>}
          </>}
        </section>

        {spaceTab === 'live' && runtime && <ProposalList placements={project?.placements} currentIds={currentPlacementIds} disabled={busy || capturing || dirty || conflicted || Boolean(placeAsset)} editDisabled={busy || capturing || dirty || conflicted || staleGame || !launch?.visual || !captureReady || Boolean(placeAsset)} onWithdraw={withdrawPlacement} onEdit={editProposal} />}
        {spaceTab === 'live' && runtime && project && import.meta.env.DEV && <PlacementImportPanel reviewer={reviewer} disabled={busy || dirty || conflicted || staleGame || project.runtimeUse !== 'target'} onImport={importPlan} />}
        {spaceTab === 'photos' && <SceneReviewBoard project={project} runtime={runtime} busy={busy} disabled={dirty || staleGame || conflicted || !project || runtime?.available === false} reviewer={reviewer} onReviewerChange={setReviewer} onCaptureAll={startCaptures} onReview={reviewZone} capturing={capturing} captureProgress={captureProgress} />}
        <details className="panel"><summary>실제 게임 관찰 기록</summary><button className="secondary" onClick={refresh} disabled={refreshing || !project}>{refreshing ? '확인 중…' : '기록 새로 읽기'}</button><SessionList sessions={savedSessions} /></details>
        <details className="panel"><summary>현재 검수에 저장한 씬 계획</summary><pre className="document-text">{project?.sceneNotes || '설화와 기획 단계에서 씬별 경험·배치 기준을 작성해주세요.'}</pre></details>
      </>}
      {spatial && <details className="asset-library-details panel"><summary>개별 에셋 상세 도구 · 추가 확인이 필요한 경우</summary>
        <section className="panel"><div className="panel-head"><div><h2>파일·표본 자료 {assets.length}개</h2><p>실제 GLB {assets.filter(asset => asset.kind === 'glb').length}개 · 게임 팔레트 {assets.filter(asset => asset.kind === 'procedural').length}개</p></div><span className="pill">선택 {draft.selectedAssetIds.length}</span></div><p className="note">이 수량은 라이브러리의 파일·코드 표본 수이며, 설화에 자동 선정되거나 현재 공간에 배치된 물체 수가 아닙니다. 체크한 항목만 추가 개별 검수가 필요합니다. 최신 공개 교체 모델 목록과도 별개입니다.</p>
          <div className="asset-tools"><label className="search"><span className="sr-only">에셋 검색</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="이름·분류로 찾기" /></label><select aria-label="에셋 종류" value={kind} onChange={event => setKind(event.target.value)}><option value="all">모든 종류</option><option value="glb">GLB 파일</option><option value="procedural">게임 팔레트</option></select><label className="check compact"><input type="checkbox" checked={selectedOnly} onChange={event => setSelectedOnly(event.target.checked)} />선택만</label></div>
          <div className="asset-list">{filtered.map(asset => <div className={`asset-row ${asset.id === assetId ? 'selected' : ''}`} key={asset.id}><input type="checkbox" aria-label={`${asset.name} ${asset.kind === 'glb' ? 'GLB' : '팔레트'} 검수 대상 선택`} checked={draft.selectedAssetIds.includes(asset.id)} onChange={event => update('selectedAssetIds', event.target.checked ? [...draft.selectedAssetIds, asset.id] : draft.selectedAssetIds.filter(id => id !== asset.id))} /><button className="asset-name" onClick={() => { setAssetId(asset.id); setViewerOpen(false); }}><strong>{asset.name}</strong><small>{asset.kind === 'glb' ? `GLB · ${size(asset.bytes)}` : `팔레트 · ${asset.category || '게임 표본'}`}</small></button><span className="asset-kind">{asset.kind === 'glb' ? '3D 파일' : '코드 표본'}</span></div>)}{!filtered.length && <p className="empty">검색 결과가 없습니다.</p>}</div>
        </section>
        {currentAsset ? <section className="panel"><div className="panel-head"><div><h2>{currentAsset.name}</h2><p>{currentAsset.usage}</p></div><span className="pill">형태 수동 검수</span></div><small className="path">{currentAsset.path}</small>
          {currentAsset.kind === 'glb' ? <>{viewerOpen ? <AssetViewer key={`${currentAsset.id}:${viewerRound}:${project?.revision || 0}`} asset={currentAsset} onResult={assetResult} /> : <div className="viewer-placeholder"><span>3D</span><p>실제 파일을 열어 앞·뒤·위·아래 형태를 확인하세요.</p><button onClick={() => setViewerOpen(true)}>3D 파일 보기</button></div>}<div className="button-row"><button className="secondary" onClick={() => { setViewerRound(old => old + 1); setViewerOpen(true); }}>다시 보기</button><a className="button quiet" href={currentAsset.url} download>GLB 파일 받기 ↓</a></div><p className="muted">{project?.selectedAssetIds.includes(currentAsset.id) ? '표시 성공·실패가 현재 검수 버전에 기록됩니다. 표시 성공이 형태 승인이나 이용 권한 확인을 의미하지는 않습니다.' : '대상으로 선택하고 저장한 뒤 다시 열어야 이 파일의 확인 기록이 남습니다.'}</p></> : <div className="source-link"><b>게임 안에서 확인하는 표본</b><p>팔레트 키: {currentAsset.paletteKey}</p><p>팔레트에 있는 표본이 현재 공간에도 배치되어 있다는 보장은 없습니다. 게임에서 해당 물체를 찾고 확인한 위치·형태를 직접 적어주세요. 찾지 못한 표본은 확인으로 처리하지 않습니다.</p><button onClick={() => changeGate('space')}>공간 검수로 이동</button><label className="field"><span>직접 확인한 정상 검수 세션</span><select value={observationSession || normalSessions[0]?.id || ''} onChange={event => setObservationSession(event.target.value)}><option value="">정상 게임 세션 필요</option>{normalSessions.map(session => <option key={session.id} value={session.id}>{shortHash(session.id)} · {date(session.at || session.createdAt)}</option>)}</select></label><TextField label="이 표본을 확인한 위치·형태" value={observation} onChange={setObservation} rows={3} placeholder="예: 나루터 오른쪽 통발의 형태와 배치 확인" /><button disabled={busy || dirty || conflicted || !project?.selectedAssetIds.includes(currentAsset.id) || !normalSessions.length || !observation.trim()} onClick={observeAsset}>이 표본의 사람 관찰 기록 저장</button><p className="muted">개별 표본에 대한 사람의 확인입니다. 검수 대상 공간이 연결되어야 기록할 수 있습니다. 공간을 열었다는 사실만으로 자동 승인하지 않습니다.</p></div>}
          {inspections[currentAsset.id] && <p className="note">{inspections[currentAsset.id].note}</p>}
        </section> : <div className="panel empty">목록에서 에셋 이름을 누르면 실제 파일과 확인 방법이 표시됩니다.</div>}
        <section className="panel"><h2>표시·사람 관찰 기록</h2>{savedInspections.length ? <ul className="records">{savedInspections.slice(-30).reverse().map((record, index) => <li key={record.id || index}><strong>{assets.find(asset => asset.id === record.assetId)?.name || record.assetId}</strong><span>{record.status === 'loaded' ? '표시 성공' : record.status === 'observed' ? '사람 확인' : '표시 실패'} · v{record.projectRevision ?? record.revision ?? project.revision}</span><small>{date(record.createdAt || record.at)} · {record.note}</small></li>)}</ul> : <p className="muted">선택한 GLB의 표시 결과와 표본별 사람 관찰이 쌓입니다.</p>}</section>
      </details>}
      {gate === 'play' && <section className="panel"><span className="pill amber">퍼즐 연결 전</span><h2>현재는 공간 검수까지 가능합니다.</h2><p>현재 연결 가능한 나주 공간에는 탐색과 연출이 구현되어 있습니다. 실제 퍼즐 풀이·단서 획득·씬 진행은 아직 연결되어 있지 않아 플레이 승인은 서버에서도 차단합니다.</p><div className="source-link"><b>지금 기록할 수 있는 것</b><p>스토리와 퍼즐 계획에 대한 의견, 필요한 연결 작업, 반려·보류 사유를 남길 수 있습니다. 공간에서 걷거나 개발용 연출을 실행한 것을 퍼즐 완주로 기록하지 않습니다.</p></div><p>실제 퍼즐이 연결되면 정상 세션에서 풀이 과정과 완료 상태를 관찰하는 검수를 추가합니다.</p></section>}
      {gate === 'history' && <>
        <section className="panel"><div className="panel-head"><div><h2>검수 기록 내보내기</h2><p>입력 원문·버전·판정자·의견·게임 관찰 기록을 함께 보관합니다.</p></div><button disabled={!project || busy} onClick={exportProject}>JSON 내보내기 ↓</button></div><p className="note">서버 저장 위치: <code>.local/review/</code> · 이 컴퓨터의 내부 검수 기록이며 공개 배포 승인이나 학습 데이터 등록은 아닙니다.</p></section>
        <section className="panel"><h2>판정 이력</h2>{project?.decisions?.length ? <ol className="timeline">{[...project.decisions].reverse().map((record, index) => <li key={record.id || index}><div className="panel-head"><strong>{gateName(record.gate)}</strong><Tag status={record.decision} /></div><p>{record.note || '추가 의견 없음'}</p><small>{record.reviewer} · {date(record.createdAt || record.at)} · 검수 v{record.projectRevision ?? record.revision}</small>{record.invalidatedAt && <p className="warning-text">입력 변경으로 과거 기록이 되었습니다.</p>}</li>)}</ol> : <p className="empty">아직 판정이 없습니다.</p>}</section>
        <section className="panel"><div className="panel-head"><div><h2>생성 대기 요청</h2><p>「반려 · 새로 생성 요청」과 라이브러리 생성 요청입니다. 생성 공정은 아직 연결 전이라 기록만 남습니다.</p></div><span className="pill">{project?.regenerationRequests?.length || 0}건</span></div>{project?.regenerationRequests?.length ? <ul className="records">{[...project.regenerationRequests].reverse().map(request => <li key={request.id}><strong>{request.object?.name || '이름 미등록 물체'}{request.sceneNo ? ` · 씬${request.sceneNo}` : ''}{request.object?.zoneId ? ` · ${request.object.zoneId}` : ''}</strong><span>검수 v{request.projectRevision}</span><small>{request.note}</small><small>{request.reviewer} · {date(request.at)}</small></li>)}</ul> : <p className="empty">생성 대기 요청이 없습니다.</p>}</section>
        <section className="panel"><h2>배치 변경안 기록</h2><PlacementHistory placements={project?.placements} currentIds={currentPlacementIds} /></section>
        <section className="panel"><h2>게임 관찰 이력</h2><SessionList sessions={savedSessions} /></section>
      </>}
      </section>
      <aside className="decision-rail">
        {spatial && spaceTab === 'live' && placeAsset && <PlacementAdjustPanel draft={placeDraft} asset={placeAsset} mode={placeMode} note={placeNote} saving={placeSaving} replacing={placeReplacing} disabled={busy || staleGame || conflicted} onNote={setPlaceNote} onMode={changePlaceMode} onAdjust={adjustPlacement} onCancel={cancelPlacement} onCommit={confirmPlacement} />}
        {spatial && spaceTab === 'live' && !placeAsset && <PickedPointCard picked={pickedPoint} reviewer={reviewer} onReviewerChange={setReviewer} placing={Boolean(placeAsset)} disabled={busy || capturing || dirty || staleGame || conflicted || !captureReady || project?.runtimeUse !== 'target'} blockedReasons={[
          ...(dirty ? ['입력 변경을 먼저 저장해 주세요.'] : []),
          ...(staleGame ? ['게임·참조 자료가 바뀌었습니다 — 「현재 자료로 재검수 회차 열기」.'] : []),
          ...(conflicted ? ['다른 창에서 자료가 바뀌었습니다 — 최신 저장본을 다시 읽어 주세요.'] : []),
          ...(!captureReady ? ['게임 화면이 아직 연결 중입니다(「실제 공간 표시」 뒤 가능).'] : []),
          ...(project?.runtimeUse !== 'target' ? ['참고용 공간에는 배치할 수 없습니다 — 설화와 기획에서 「검수 대상 공간」으로 연결.'] : []),
          ...(capturing ? ['사진 촬영 중입니다.'] : []),
        ]} onPlace={() => setLibraryOpen(true)} onClear={() => setPickedPoint(null)} />}
        {spatial && spaceTab === 'live' && selectedProposalId && !placeAsset && <ProposalActionsCard selected={selectedObject} placement={selectedProposal} disabled={busy || capturing || dirty || conflicted} editDisabled={busy || capturing || dirty || conflicted || staleGame || !captureReady} onEdit={editProposal} onWithdraw={withdrawPlacement} onClear={() => setSelectedObject(null)} />}
        {spatial && spaceTab === 'live' && !selectedProposalId && <ObjectReviewPanel key={selectedObject?.objectId || 'none'} object={selectedObject} sceneNo={sceneNo} issues={currentObjectIssues} reviewer={reviewer} onReviewerChange={setReviewer} onIssue={issueObject} disabled={busy || capturing || dirty || staleGame || conflicted || !captureReady || project?.runtimeUse !== 'target'} />}
        {gate === 'source' && !project && <TrialApprovePanel reviewer={reviewer} setReviewer={setReviewer} onGoCine={() => changeGate('cine')} />}
        {(project || gate !== 'source') && <section className="panel save-panel"><p className="eyebrow">REVIEW SNAPSHOT</p><h2>{project ? `검수 자료 v${project.revision}` : '새 검수 만들기'}</h2><dl><dt>설화 코드</dt><dd>{draft.caseId || '미지정'}</dd><dt>연결 공간</dt><dd>{draftRuntime?.title || '미연결'}{draftRuntime && <small>{draft.runtimeUse === 'target' ? '검수 대상' : '참고용'}</small>}</dd><dt>게임 버전</dt><dd><code>{shortHash(project?.gameRevision)}</code></dd><dt>추가 개별 확인</dt><dd>{draft.selectedAssetIds.length}개</dd></dl><button className="wide" onClick={() => save()} disabled={busy || capturing || conflicted || !draft.sourceText.trim() || (project && !dirty)}> {busy ? '처리 중…' : project ? '수정 내용 저장' : '검수 자료 저장·시작'}</button>{project && <button className="secondary wide" onClick={() => save(true)} disabled={busy || capturing || dirty || conflicted}>현재 자료로 재검수 회차 열기</button>}<small>수정·재검수 시 기존 판정은 지우지 않고 새 버전에서 다시 확인합니다.</small></section>}
        {selectedGate && !(gate === 'source' && !project) && <section className="panel decision" ref={decisionRef} tabIndex={-1} aria-label={`${selectedGate.short} 판정 입력`}><div className="panel-head"><h2>{gate === 'assets' ? '배치·에셋' : gate === 'space' ? '동선·충돌' : selectedGate.short} 판정</h2><Tag status={gateState?.status} /></div>{spatial && <div className="judgment-tabs"><button className={gate === 'assets' ? '' : 'secondary'} disabled={busy || capturing} onClick={() => changeGate('assets')}>배치·에셋 판정</button><button className={gate === 'space' ? '' : 'secondary'} disabled={busy || capturing} onClick={() => changeGate('space')}>동선·충돌 판정</button></div>}<label className="field"><span>검수자</span><input value={reviewer} onChange={event => setReviewer(event.target.value)} maxLength={100} placeholder="이름 또는 담당자명" /></label><div className="check-list">{gateChecks.map(([id, label]) => <label key={id} className="check"><input type="checkbox" checked={currentChecks.includes(id)} disabled={gate === 'play' || !project || dirty} onChange={event => setChecks(old => ({ ...old, [gate]: event.target.checked ? [...(old[gate] || []), id] : (old[gate] || []).filter(key => key !== id) }))} /><span>{gate === 'assets' && draft.assetReviewMode === 'scene' && id === 'shape' ? '구역 사진·실제 공간에서 배치와 외형을 확인하고 필요한 추가 물체 검수를 마쳤습니다.' : label}</span></label>)}</div><TextField label="판정 의견·수정 요청" value={notes[gate] || ''} onChange={value => setNotes(old => ({ ...old, [gate]: value }))} rows={5} placeholder="반려·보류 시에는 구체적인 이유를 적어주세요." />
          {[...prerequisites, ...briefBlocked].length > 0 && <div className="blockers"><b>승인 전 필요한 확인</b><ul>{[...prerequisites, ...briefBlocked].map((blocker, index) => <li key={`${blocker.code || "blocker"}:${index}`}>{blocker.message || String(blocker)}</li>)}</ul></div>}
          {gate === 'space' && placementCount > 0 && <p className="note">승인하면 이번 회차의 배치 변경안 {placementCount}건을 게임 데이터(manifest 「놓기」)에 반영합니다. 반영 뒤에는 게임 버전이 바뀌므로 다음 회차에서 실제 공간으로 다시 확인합니다.</p>}
          {gate === 'play' && <p className="warning-text">퍼즐 구현 연결 전에는 승인할 수 없습니다.</p>}{gateState?.decisionId && <p className="note">이 회차의 판정이 저장되어 있습니다. 변경하려면 재검수 회차를 열어주세요.</p>}
          <button className="wide" disabled={busy || !canApprove} onClick={() => decide('approved')}>현재 {selectedGate.short} 승인</button><div className="decision-actions"><button className="danger" disabled={busy || !project || dirty || conflicted || Boolean(gateState?.decisionId) || !reviewer.trim() || !notes[gate]?.trim()} onClick={() => decide('rejected')}>반려</button><button className="secondary" disabled={busy || !project || dirty || conflicted || Boolean(gateState?.decisionId) || !reviewer.trim() || !notes[gate]?.trim()} onClick={() => decide('held')}>보류</button></div><small>승인 조건은 서버가 다시 확인합니다. 실제 공개·배포는 실행하지 않습니다.</small>
        </section>}
      </aside></div>
    </main>
    <LibraryDrawer open={libraryOpen && spatial} pickedPoint={pickedPoint} disabled={busy || !pickedPoint || Boolean(placeAsset)} onClose={closeLibrary} onPick={startPlacement} onRequestGenerate={requestGenerate} />
  </div>;
}

function SessionList({ sessions }) {
  if (!sessions.length) return <p className="empty">게임 세션이 없습니다. 공간 검수에서 세션을 만들고 게임을 열어주세요.</p>;
  return <div className="sessions">{[...sessions].reverse().map(session => <details key={session.id} className="session"><summary><strong>{session.mode === 'normal' ? '정상 검수' : '진단 전용'} · v{session.projectRevision}</strong><span>{session.events?.some(event => event.type === 'ready') ? '공간 표시 관측' : '게임 연결 대기'}</span></summary><small>{date(session.at || session.createdAt)} · 세션 {shortHash(session.id)} · 게임 {shortHash(session.gameRevision)}</small><ul className="events">{session.events?.length ? session.events.slice(-30).map((event, index) => <li key={event.id || index}><b>{eventName[event.type] || event.type}</b><span>{date(event.receivedAt || event.at)}</span><small>{typeof event.detail === 'string' ? event.detail : event.detail ? JSON.stringify(event.detail) : ''}</small></li>) : <li>아직 게임에서 받은 관찰 기록이 없습니다.</li>}</ul></details>)}</div>;
}
