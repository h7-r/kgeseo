import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createCompressedGltfLoader } from '../../naju01/src/loaders/compressedGlb.ts';
import { api } from './api.js';
import './LibraryPanel.css';

const SOURCE_LABEL = { public: '공개', khs: '국가유산청', palette: '팔레트', catalog: '생성 목록' };
const PAGE = 120;
const fmt = value => (Math.round(value * 100) / 100).toFixed(2);

// ── 썸네일: 화면 전체가 렌더러 하나를 같이 쓴다. 카드가 보일 때만 차례로 그린다. ──
const thumbCache = new Map();
const thumbWaiters = new Map();
const thumbQueue = [];
let thumbRenderer = null, thumbBusy = false;
const storageKey = item => `kgeseo-libthumb:${item.sha256 || item.url}`;
function readStored(item) {
  try { return sessionStorage.getItem(storageKey(item)); } catch { return null; }
}
function store(item, url) {
  thumbCache.set(item.id, url);
  try { sessionStorage.setItem(storageKey(item), url); } catch { /* 용량 초과·비공개 창 — 메모리만 */ }
}
function disposeObject(object) {
  object?.traverse(child => {
    child.geometry?.dispose();
    for (const material of [child.material].flat().filter(Boolean)) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
}
function renderer() {
  if (thumbRenderer) return thumbRenderer;
  const canvas = document.createElement('canvas');
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  gl.setPixelRatio(1); gl.setSize(192, 192, false);
  gl.outputColorSpace = THREE.SRGBColorSpace; gl.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x656575, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(4, 6, 3); scene.add(light);
  const fill = new THREE.DirectionalLight(0xffffff, 1); fill.position.set(-3, 2, -4); scene.add(fill);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  thumbRenderer = { gl, scene, camera, loader: createCompressedGltfLoader() };
  return thumbRenderer;
}
async function pump() {
  if (thumbBusy) return;
  thumbBusy = true;
  while (thumbQueue.length) {
    const item = thumbQueue.shift();
    let url = null;
    try {
      const { gl, scene, camera, loader } = renderer();
      const gltf = await loader.loadAsync(item.url);
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const extent = Math.max(size.x, size.y, size.z);
      if (Number.isFinite(extent) && extent > 0) {
        const wrapper = new THREE.Group(); wrapper.add(model);
        wrapper.scale.setScalar(2 / extent);
        wrapper.position.copy(box.getCenter(new THREE.Vector3()).multiplyScalar(-2 / extent));
        scene.add(wrapper);
        camera.position.set(2.3, 1.6, 2.3); camera.lookAt(0, 0, 0);
        gl.render(scene, camera);
        url = gl.domElement.toDataURL('image/webp', 0.82);
        scene.remove(wrapper);
      }
      disposeObject(model);
    } catch { url = null; }
    if (url) store(item, url); else thumbCache.set(item.id, 'failed');
    for (const done of thumbWaiters.get(item.id) || []) done(thumbCache.get(item.id));
    thumbWaiters.delete(item.id);
  }
  thumbBusy = false;
}
function requestThumb(item, done) {
  const known = thumbCache.get(item.id) || readStored(item);
  if (known) { thumbCache.set(item.id, known); done(known); return () => {}; }
  if (!thumbWaiters.has(item.id)) { thumbWaiters.set(item.id, new Set()); thumbQueue.push(item); }
  thumbWaiters.get(item.id).add(done);
  pump();
  return () => {
    const set = thumbWaiters.get(item.id); set?.delete(done);
    if (set && !set.size) { thumbWaiters.delete(item.id); const at = thumbQueue.indexOf(item); if (at >= 0) thumbQueue.splice(at, 1); }
  };
}

export function Thumb({ item, root }) {
  const box = useRef(null);
  const [src, setSrc] = useState(() => (item.url ? thumbCache.get(item.id) || null : null));
  useEffect(() => {
    if (!item.url || src) return undefined;
    let cancel = () => {};
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      cancel = requestThumb(item, value => setSrc(value));
    }, { root: root?.current || null, rootMargin: '120px' });
    observer.observe(box.current);
    return () => { observer.disconnect(); cancel(); };
  }, [item, src, root]);
  if (!item.url) return <div className={`library-thumb placeholder ${item.source}`} ref={box}><span>{item.nameKo}</span></div>;
  if (src === 'failed') return <div className="library-thumb placeholder failed" ref={box}><span>미리보기 실패</span></div>;
  return <div className="library-thumb" ref={box}>{src ? <img src={src} alt={`${item.nameKo} 미리보기`} /> : <span className="library-thumb-loading">불러오는 중</span>}</div>;
}

function Card({ item, score, reasons, pickedPoint, disabled, onPick, onRequestGenerate, root }) {
  return <li className={`library-card ${item.placeable ? '' : 'unplaceable'}`}>
    <Thumb item={item} root={root} />
    <div className="library-card-body">
      <strong title={item.nameEn || item.nameKo}>{item.nameKo}</strong>
      <div className="library-card-meta"><span className={`library-source ${item.source}`}>{SOURCE_LABEL[item.source] || item.source}</span><small>{item.categoryKo}</small></div>
      {score != null && <small className="library-reasons" title={reasons.join(' · ')}>{Math.round(score * 100)}점 · {reasons.slice(0, 2).join(' · ') || '유사'}</small>}
      {item.placeable
        ? <button type="button" disabled={disabled || !pickedPoint} onClick={() => onPick?.(item)} title={pickedPoint ? '고른 자리에 이 에셋을 놓고 조정합니다.' : '게임 화면에서 빈 자리를 먼저 클릭하세요.'}>이 자리에 배치</button>
        : <>
          <small className="library-unplaceable">{item.source === 'space' ? '게임 공간 — 에셋을 놓는 바탕(에이전트 시험에서 고름)' : item.source === 'palette' ? '게임 코드 모형 — 3D 파일 아님' : '배치 불가 · 생성 요청만'}</small>
          {item.source === 'catalog' && <button type="button" className="secondary" disabled={disabled || !onRequestGenerate} onClick={() => onRequestGenerate?.(item)}>생성 요청</button>}
        </>}
    </div>
  </li>;
}

/**
 * 에셋 라이브러리 패널.
 * @param {{ onPick:(item)=>void, pickedPoint:{x:number,y:number,z:number,zoneId?:string}|null, disabled?:boolean, onRequestGenerate?:(item)=>void }} props
 */
export default function LibraryPanel({ onPick, pickedPoint = null, disabled = false, onRequestGenerate }) {
  const [library, setLibrary] = useState(null);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('');
  const [placeableOnly, setPlaceableOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState(null);
  const [searching, setSearching] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const grid = useRef(null);
  const sequence = useRef(0);

  useEffect(() => {
    let alive = true;
    api('/library').then(value => { if (alive) setLibrary(value); }, err => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, []);

  const runSearch = useCallback(async (text, cat, onlyPlaceable) => {
    const id = ++sequence.current;
    if (!text.trim()) { setSearch(null); setSearching(false); return; }
    setSearching(true);
    try {
      const params = new URLSearchParams({ q: text.trim() });
      if (cat) params.set('category', cat);
      if (onlyPlaceable) params.set('placeableOnly', '1');
      const value = await api(`/library/search?${params}`);
      if (id === sequence.current) { setSearch(value); setError(''); }
    } catch (err) { if (id === sequence.current) setError(err.message); }
    finally { if (id === sequence.current) setSearching(false); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => runSearch(query, category, placeableOnly), 250);
    return () => clearTimeout(timer);
  }, [query, category, placeableOnly, runSearch]);
  useEffect(() => { setShown(PAGE); }, [category, placeableOnly, query]);

  const browse = useMemo(() => (library?.items || []).filter(item => (!category || item.category === category) && (!placeableOnly || item.placeable))
    .sort((a, b) => Number(b.placeable) - Number(a.placeable) || a.nameKo.localeCompare(b.nameKo, 'ko')), [library, category, placeableOnly]);
  const searchMode = Boolean(query.trim());
  const rows = searchMode ? (search?.results || []) : browse.map(item => ({ item }));
  const total = (library?.items || []).filter(item => !placeableOnly || item.placeable).length;

  return <section className="library-panel" aria-label="에셋 라이브러리">
    <div className="library-head">
      <div><strong>에셋 라이브러리</strong><small>{library ? `${library.items.length}개 · 공개 ${library.sources.public} · 국가유산청 ${library.sources.khs} · 팔레트 ${library.sources.palette} · 생성 목록 ${library.sources.catalog}` : '목록을 읽는 중…'}</small></div>
      <div className={`library-point ${pickedPoint ? 'ready' : ''}`} role="status">
        {pickedPoint ? <>고른 자리 <b>x {fmt(pickedPoint.x)} · y {fmt(pickedPoint.y)} · z {fmt(pickedPoint.z)}</b> m{pickedPoint.zoneId ? ` · ${pickedPoint.zoneId}` : ''}</> : '게임 화면에서 빈 자리를 클릭하면 배치할 수 있습니다.'}
      </div>
    </div>
    <div className="library-tools">
      <input type="search" className="library-search" placeholder="한글로 찾기 — 예: 항아리, 지게, 제사 지낼 상" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} aria-label="에셋 검색" />
      <label className="check library-only"><input type="checkbox" checked={placeableOnly} onChange={event => setPlaceableOnly(event.target.checked)} />배치 가능만</label>
    </div>
    <div className="library-chips" role="group" aria-label="분류">
      <button type="button" className={!category ? 'active' : ''} aria-pressed={!category} onClick={() => setCategory('')}>전체 <span>{total}</span></button>
      {(library?.categories || []).filter(c => c.count).map(c => <button type="button" key={c.id} className={category === c.id ? 'active' : ''} aria-pressed={category === c.id} onClick={() => setCategory(category === c.id ? '' : c.id)}>
        {c.ko} <span>{placeableOnly ? c.placeableCount : c.count}</span>
      </button>)}
    </div>
    {searchMode && search && !search.semantic && <p className="library-hint">{search.semanticStatus === 'loading' || search.semanticStatus === 'indexing' ? '의미 검색 모델 준비 중 — 지금은 글자 유사도로만 찾음' : '의미 검색 모델 없음 — 글자 유사도로만 찾음'}</p>}
    {error && <p className="library-error" role="alert">{error}</p>}
    <div className="library-grid-wrap" ref={grid}>
      {searchMode && searching && !search && <p className="empty">찾는 중…</p>}
      {(!searchMode || search) && !rows.length && <p className="empty">{searchMode ? '맞는 에셋이 없습니다. 다른 말로 찾아보세요.' : library ? '이 분류에 에셋이 없습니다.' : ''}</p>}
      <ul className="library-grid">
        {rows.slice(0, shown).map(row => <Card key={row.item.id} {...row} reasons={row.reasons || []} pickedPoint={pickedPoint} disabled={disabled} onPick={onPick} onRequestGenerate={onRequestGenerate} root={grid} />)}
      </ul>
      {rows.length > shown && <button type="button" className="secondary library-more" onClick={() => setShown(value => value + PAGE)}>더 보기 ({rows.length - shown}개 남음)</button>}
    </div>
  </section>;
}
