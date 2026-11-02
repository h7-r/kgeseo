// 5174 통합 편집 모드(E) 서랍 — 검수 작업대의 LibraryPanel(review/src/LibraryPanel.jsx)과
// PlacementAdjustPanel(review/src/PlacementPanels.jsx)을 TSX 로 옮겼다(분류 칩·썸네일·한글 검색·숫자 조정·미세 이동 같음).
// 10/15 통합: 라이브러리 배치 초안과 이미 놓인 에셋 편집이 같은 조정 카드를 쓰고, 조작 안내판(옛 EditHelpPanel)도 여기로 모았다.
//   팔레트(코드 모형) 항목은 게임 편집기에서만 놓을 수 있어 여기서는 「배치」 단추가 살아 있다(edits.json 「더함」).
// <Canvas> 밖 DOM 이어야 해서 LibraryPlaceMode 가 따로 만든 React 뿌리(createRoot)에 그린다.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";

import { createCompressedGltfLoader } from "../loaders/compressedGlb";
import { findAsset } from "./assetCatalog";
import type { DraftMode, PlacementDraft } from "../review/placementLayer";
import { isolationSpaces, sceneZones, type IsolationKey } from "../review/sceneScope";
import {
  LIBRARY_DRAWER_ATTR,
  fetchLibrary,
  searchLibrary,
  type LibraryIndex,
  type LibraryItem,
  type LibrarySearch,
  type LibrarySearchRow,
} from "./libraryPlaceApi";
import "../../../review/src/LibraryPanel.css";
import "./libraryDrawer.css";

const SOURCE_LABEL: Record<string, string> = {
  public: "공개",
  khs: "국가유산청",
  palette: "팔레트",
  catalog: "생성 목록",
};
const PAGE = 120;
const meters = (value: number | undefined | null) => (Number.isFinite(value) ? (value as number).toFixed(2) : "—");
const KEY_HINT =
  "이동 손잡이 · 화살표 앞뒤좌우 미세 이동(Shift 1 m) · [ ] 크기(×1.1 / ×0.9) · PageUp/Down 높이 · , . 회전 5°(Shift 15°) · Enter 확정 · Esc 취소";

/** 팔레트(코드 모형) 항목이면 그 열쇠 — 게임 편집기에서 edits.json 「더함」으로 놓는다 */
const paletteKey = (item: LibraryItem) =>
  item.source === "palette" && findAsset(item.id.replace(/^palette:/u, "")) ? item.id.replace(/^palette:/u, "") : null;
/** 이 편집 모드에서 놓을 수 있는 항목(공개·국가유산 GLB 또는 팔레트 모형) */
const isUsable = (item: LibraryItem) => item.placeable || Boolean(paletteKey(item));

/** 지금 손잡이가 붙은 것 — 라이브러리 초안 / 생성 무리(edits.json) / 공개 에셋 놓기(manifest) */
export interface EditTargetView {
  kind: "library" | "instance" | "place";
  title: string;
  detail: string;
}

// ── 썸네일: 서랍 전체가 렌더러 하나를 같이 쓴다. 카드가 보일 때만 차례로 그린다(LibraryPanel 과 같은 방식). ──
type ThumbValue = string | "failed";
const thumbCache = new Map<string, ThumbValue>();
const thumbWaiters = new Map<string, Set<(value: ThumbValue | undefined) => void>>();
const thumbQueue: LibraryItem[] = [];
let thumbRenderer: {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  loader: ReturnType<typeof createCompressedGltfLoader>;
} | null = null;
let thumbBusy = false;
const storageKey = (item: LibraryItem) => `kgeseo-libthumb:${item.sha256 || item.url}`;
function readStored(item: LibraryItem) {
  try {
    return sessionStorage.getItem(storageKey(item));
  } catch {
    return null;
  }
}
function store(item: LibraryItem, url: string) {
  thumbCache.set(item.id, url);
  try {
    sessionStorage.setItem(storageKey(item), url);
  } catch {
    /* 용량 초과·비공개 창 — 메모리만 */
  }
}
function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = [mesh.material].flat().filter(Boolean) as THREE.Material[];
    for (const material of materials) {
      for (const value of Object.values(material))
        if ((value as THREE.Texture)?.isTexture) (value as THREE.Texture).dispose();
      material.dispose();
    }
  });
}
function renderer() {
  if (thumbRenderer) return thumbRenderer;
  const canvas = document.createElement("canvas");
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  gl.setPixelRatio(1);
  gl.setSize(192, 192, false);
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x656575, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(4, 6, 3);
  scene.add(light);
  const fill = new THREE.DirectionalLight(0xffffff, 1);
  fill.position.set(-3, 2, -4);
  scene.add(fill);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  thumbRenderer = { gl, scene, camera, loader: createCompressedGltfLoader() };
  return thumbRenderer;
}
async function pump() {
  if (thumbBusy) return;
  thumbBusy = true;
  while (thumbQueue.length) {
    const item = thumbQueue.shift()!;
    let url: string | null = null;
    try {
      const { gl, scene, camera, loader } = renderer();
      const gltf = await loader.loadAsync(item.url!);
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const extent = Math.max(size.x, size.y, size.z);
      if (Number.isFinite(extent) && extent > 0) {
        const wrapper = new THREE.Group();
        wrapper.add(model);
        wrapper.scale.setScalar(2 / extent);
        wrapper.position.copy(box.getCenter(new THREE.Vector3()).multiplyScalar(-2 / extent));
        scene.add(wrapper);
        camera.position.set(2.3, 1.6, 2.3);
        camera.lookAt(0, 0, 0);
        gl.render(scene, camera);
        url = gl.domElement.toDataURL("image/webp", 0.82);
        scene.remove(wrapper);
      }
      disposeObject(model);
    } catch {
      url = null;
    }
    if (url) store(item, url);
    else thumbCache.set(item.id, "failed");
    for (const done of thumbWaiters.get(item.id) ?? []) done(thumbCache.get(item.id));
    thumbWaiters.delete(item.id);
  }
  thumbBusy = false;
}
function requestThumb(item: LibraryItem, done: (value: ThumbValue | undefined) => void) {
  const known = thumbCache.get(item.id) || readStored(item);
  if (known) {
    thumbCache.set(item.id, known);
    done(known);
    return () => {};
  }
  if (!thumbWaiters.has(item.id)) {
    thumbWaiters.set(item.id, new Set());
    thumbQueue.push(item);
  }
  thumbWaiters.get(item.id)!.add(done);
  void pump();
  return () => {
    const set = thumbWaiters.get(item.id);
    set?.delete(done);
    if (set && !set.size) {
      thumbWaiters.delete(item.id);
      const at = thumbQueue.indexOf(item);
      if (at >= 0) thumbQueue.splice(at, 1);
    }
  };
}

function Thumb({ item, root }: { item: LibraryItem; root: RefObject<HTMLDivElement | null> }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState<ThumbValue | null>(() => (item.url ? (thumbCache.get(item.id) ?? null) : null));
  useEffect(() => {
    if (!item.url || src || !box.current) return undefined;
    let cancel = () => {};
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        cancel = requestThumb(item, (value) => setSrc(value ?? "failed"));
      },
      { root: root.current, rootMargin: "120px" },
    );
    observer.observe(box.current);
    return () => {
      observer.disconnect();
      cancel();
    };
  }, [item, src, root]);
  if (!item.url)
    return (
      <div className={`library-thumb placeholder ${item.source}`} ref={box}>
        <span>{item.nameKo}</span>
      </div>
    );
  if (src === "failed")
    return (
      <div className="library-thumb placeholder failed" ref={box}>
        <span>미리보기 실패</span>
      </div>
    );
  return (
    <div className="library-thumb" ref={box}>
      {src ? (
        <img src={src} alt={`${item.nameKo} 미리보기`} />
      ) : (
        <span className="library-thumb-loading">불러오는 중</span>
      )}
    </div>
  );
}

interface CardProps extends LibrarySearchRow {
  hasPoint: boolean;
  disabled: boolean;
  libraryAvailable: boolean;
  onPick: (item: LibraryItem) => void;
  root: RefObject<HTMLDivElement | null>;
}
function Card({ item, score, reasons = [], hasPoint, disabled, libraryAvailable, onPick, root }: CardProps) {
  const palette = Boolean(paletteKey(item));
  const usable = palette || (item.placeable && libraryAvailable);
  return (
    <li className={`library-card ${isUsable(item) ? "" : "unplaceable"}`}>
      <Thumb item={item} root={root} />
      <div className="library-card-body">
        <strong title={item.nameEn || item.nameKo}>{item.nameKo}</strong>
        <div className="library-card-meta">
          <span className={`library-source ${item.source}`}>{SOURCE_LABEL[item.source] || item.source}</span>
          <small>{item.categoryKo}</small>
        </div>
        {/* 맵의 이름(틈바위·발치너덜 …)은 생성 무리 이름이고, 라이브러리는 그 무리에 쓰인 모형 파일 단위(바위 21 …)다 — 어느 무리에 쓰였는지 보여 준다(10/20) */}
        {item.note?.startsWith("게임 무리:") && (
          <small className="library-groups" title={item.note} style={{ display: "block", opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.note.replace("게임 무리:", "맵에서:")}
          </small>
        )}
        {score != null && (
          <small className="library-reasons" title={reasons.join(" · ")}>
            {Math.round(score * 100)}점 · {reasons.slice(0, 2).join(" · ") || "유사"}
          </small>
        )}
        {isUsable(item) ? (
          <button
            type="button"
            disabled={disabled || !usable}
            onClick={() => onPick(item)}
            title={
              !usable
                ? "공개·국가유산 GLB 는 공개 에셋 화면(?aihub&src=sf, 개발 서버)에서만 놓을 수 있습니다."
                : palette
                  ? "코드 모형 — assets/edits.json 「더함」에 바로 놓고 고릅니다."
                  : hasPoint
                    ? "고른 자리에 이 에셋을 놓고 조정합니다."
                    : "화면 가운데 땅에 놓고 조정합니다."
            }
          >
            {hasPoint ? "이 자리에 배치" : "화면 가운데에 배치"}
          </button>
        ) : (
          <small className="library-unplaceable">배치 불가 · 3D 없음(작업대에서 생성 요청)</small>
        )}
      </div>
    </li>
  );
}

/** 에셋 목록 — LibraryPanel 과 같은 분류 칩·한글 검색·배치 가능만·더 보기 */
function LibraryList({
  hasPoint,
  disabled,
  libraryAvailable,
  onPick,
}: {
  hasPoint: boolean;
  disabled: boolean;
  libraryAvailable: boolean;
  onPick: (item: LibraryItem) => void;
}) {
  const [library, setLibrary] = useState<LibraryIndex | null>(null);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  const [placeableOnly, setPlaceableOnly] = useState(true);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<LibrarySearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const grid = useRef<HTMLDivElement | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    let alive = true;
    fetchLibrary().then(
      (value) => alive && setLibrary(value),
      (err: Error) => alive && setError(err.message),
    );
    return () => {
      alive = false;
    };
  }, []);

  // 「배치 가능만」은 화면에서 거른다 — 서버의 placeable 은 팔레트(게임 편집기 전용)를 모른다
  const runSearch = useCallback(async (text: string, cat: string) => {
    const id = ++sequence.current;
    if (!text.trim()) {
      setSearch(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const params = new URLSearchParams({ q: text.trim() });
      if (cat) params.set("category", cat);
      const value = await searchLibrary(params);
      if (id === sequence.current) {
        setSearch(value);
        setError("");
      }
    } catch (err) {
      if (id === sequence.current) setError((err as Error).message);
    } finally {
      if (id === sequence.current) setSearching(false);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query, category), 250);
    return () => clearTimeout(timer);
  }, [query, category, runSearch]);

  const browse = useMemo(
    () =>
      (library?.items ?? [])
        .filter((item) => (!category || item.category === category) && (!placeableOnly || isUsable(item)))
        .sort((a, b) => Number(isUsable(b)) - Number(isUsable(a)) || a.nameKo.localeCompare(b.nameKo, "ko")),
    [library, category, placeableOnly],
  );
  const searchMode = Boolean(query.trim());
  const rows: LibrarySearchRow[] = searchMode
    ? (search?.results ?? []).filter((row) => !placeableOnly || isUsable(row.item))
    : browse.map((item) => ({ item }));
  const total = (library?.items ?? []).filter((item) => !placeableOnly || isUsable(item)).length;
  const resetPage = () => setShown(PAGE);

  return (
    <section className="library-panel" aria-label="에셋 라이브러리">
      <small className="naju-lib-count">
        {library
          ? `${library.items.length}개 · 공개 ${library.sources.public} · 국가유산청 ${library.sources.khs} · 팔레트 ${library.sources.palette} · 생성 목록 ${library.sources.catalog}`
          : "목록을 읽는 중…"}
      </small>
      <div className="library-tools">
        <input
          type="search"
          className="library-search"
          placeholder="한글로 찾기 — 예: 항아리, 지게, 제사 지낼 상"
          value={query}
          maxLength={100}
          onChange={(event) => {
            setQuery(event.target.value);
            resetPage();
          }}
          aria-label="에셋 검색"
        />
        <label className="check library-only">
          <input
            type="checkbox"
            checked={placeableOnly}
            onChange={(event) => {
              setPlaceableOnly(event.target.checked);
              resetPage();
            }}
          />
          배치 가능만
        </label>
      </div>
      <div className="library-chips" role="group" aria-label="분류">
        <button
          type="button"
          className={!category ? "active" : ""}
          aria-pressed={!category}
          onClick={() => {
            setCategory("");
            resetPage();
          }}
        >
          전체 <span>{total}</span>
        </button>
        {(library?.categories ?? [])
          .filter((c) => c.count)
          .map((c) => (
            <button
              type="button"
              key={c.id}
              className={category === c.id ? "active" : ""}
              aria-pressed={category === c.id}
              onClick={() => {
                setCategory(category === c.id ? "" : c.id);
                resetPage();
              }}
            >
              {c.ko}{" "}
              <span>
                {placeableOnly
                  ? (library?.items ?? []).filter((item) => item.category === c.id && isUsable(item)).length
                  : c.count}
              </span>
            </button>
          ))}
      </div>
      {searchMode && search && !search.semantic && (
        <p className="library-hint">
          {search.semanticStatus === "loading" || search.semanticStatus === "indexing"
            ? "의미 검색 모델 준비 중 — 지금은 글자 유사도로만 찾음"
            : "의미 검색 모델 없음 — 글자 유사도로만 찾음"}
        </p>
      )}
      {error && (
        <p className="library-error" role="alert">
          {error}
        </p>
      )}
      <div className="library-grid-wrap" ref={grid}>
        {searchMode && searching && !search && <p className="empty">찾는 중…</p>}
        {(!searchMode || search) && !rows.length && (
          <p className="empty">
            {searchMode ? "맞는 에셋이 없습니다. 다른 말로 찾아보세요." : library ? "이 분류에 에셋이 없습니다." : ""}
          </p>
        )}
        <ul className="library-grid">
          {rows.slice(0, shown).map((row) => (
            <Card
              key={row.item.id}
              {...row}
              hasPoint={hasPoint}
              disabled={disabled}
              libraryAvailable={libraryAvailable}
              onPick={onPick}
              root={grid}
            />
          ))}
        </ul>
        {rows.length > shown && (
          <button type="button" className="secondary library-more" onClick={() => setShown((value) => value + PAGE)}>
            더 보기 ({rows.length - shown}개 남음)
          </button>
        )}
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  step,
  unit,
  disabled,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  step: number;
  unit: string;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const shown = Number.isFinite(value) ? String(Math.round((value as number) * 1000) / 1000) : "";
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  // 입력 중이 아닐 때만 바깥 값(손잡이·키로 바뀐 값)을 따라간다
  if (!focused && text !== shown) setText(shown);
  const commit = (raw: string) => {
    const number = Number(raw);
    if (raw !== "" && Number.isFinite(number)) onCommit(number);
  };
  return (
    <label className="num-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={text}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          setFocused(false);
          commit(event.target.value);
        }}
        onChange={(event) => {
          setText(event.target.value);
          commit(event.target.value);
        }}
      />
      <small>{unit}</small>
    </label>
  );
}

export interface DraftAdjust {
  position?: { x: number; y: number; z: number };
  rotationY?: number;
  scale?: number;
  mode?: DraftMode;
}

function AdjustCard({
  draft,
  target,
  loading,
  saving,
  note,
  onNote,
  onAdjust,
  onCancel,
  onCommit,
  onRemove,
}: {
  note: string;
  onNote: (note: string) => void;
  draft: PlacementDraft | null;
  target: EditTargetView | null;
  mode: DraftMode;
  loading: boolean;
  saving: boolean;
  onAdjust: (change: DraftAdjust) => void;
  onCancel: () => void;
  onCommit: () => void;
  onRemove: () => void;
}) {
  const isNew = !target || target.kind === "library";
  const [step, setStep] = useState(0.05);
  const position = draft?.position;
  const off = saving || !draft;
  const move = (axis: "x" | "y" | "z", delta: number) =>
    position && onAdjust({ position: { ...position, [axis]: Math.round((position[axis] + delta) * 1000) / 1000 } });
  const rotate = (delta: number) =>
    draft && onAdjust({ rotationY: ((((draft.rotationY ?? 0) + delta) % 360) + 360) % 360 });
  const resize = (delta: number) =>
    draft && onAdjust({ scale: Math.max(0.05, Math.round(((draft.scale ?? 1) + delta) * 100) / 100) });
  return (
    <section className="naju-lib-card" aria-label={isNew ? "배치 조정" : "에셋 편집"}>
      <div className="naju-lib-card-head">
        <div>
          <strong>{isNew ? "배치 조정" : "에셋 편집"}</strong>
          <small>
            {target?.title || draft?.nameKo} · {draft?.zoneId || "구역 확인 중"}
          </small>
        </div>
        <span className="naju-lib-pill">
          {saving ? "저장 중" : loading ? "불러오는 중" : isNew ? "초안" : "편집 중"}
        </span>
      </div>
      {target?.detail && <small className="naju-lib-target">{target.detail}</small>}
      <div className="num-grid">
        <NumberField
          label="X"
          unit="m"
          step={0.05}
          value={position?.x}
          disabled={off}
          onCommit={(value) => position && onAdjust({ position: { ...position, x: value } })}
        />
        <NumberField
          label="Y 높이"
          unit="m"
          step={0.05}
          value={position?.y}
          disabled={off}
          onCommit={(value) => position && onAdjust({ position: { ...position, y: value } })}
        />
        <NumberField
          label="Z"
          unit="m"
          step={0.05}
          value={position?.z}
          disabled={off}
          onCommit={(value) => position && onAdjust({ position: { ...position, z: value } })}
        />
        <NumberField
          label="회전 Y"
          unit="°"
          step={5}
          value={draft?.rotationY}
          disabled={off}
          onCommit={(value) => onAdjust({ rotationY: value })}
        />
        <NumberField
          label={isNew ? "크기" : "크기(지금 기준)"}
          unit="배"
          step={0.05}
          value={draft?.scale}
          disabled={off}
          onCommit={(value) => value >= 0.05 && onAdjust({ scale: value })}
        />
      </div>
      {draft && Number.isFinite(draft.groundY) && (
        <small>
          땅 높이 {meters(draft.groundY)} m · 땅에서 {meters((position?.y ?? 0) - draft.groundY)} m
        </small>
      )}
      <div className="nudge">
        <label>
          미세 이동{" "}
          <select value={step} disabled={off} onChange={(event) => setStep(Number(event.target.value))}>
            <option value={0.05}>0.05 m</option>
            <option value={0.25}>0.25 m</option>
            <option value={1}>1 m</option>
          </select>
        </label>
        <div className="nudge-grid">
          <button className="secondary" disabled={off} onClick={() => move("x", -step)}>
            X −
          </button>
          <button className="secondary" disabled={off} onClick={() => move("x", step)}>
            X ＋
          </button>
          <button className="secondary" disabled={off} onClick={() => move("z", -step)}>
            Z −
          </button>
          <button className="secondary" disabled={off} onClick={() => move("z", step)}>
            Z ＋
          </button>
          <button className="secondary" disabled={off} onClick={() => move("y", step)}>
            위로
          </button>
          <button className="secondary" disabled={off} onClick={() => move("y", -step)}>
            아래로
          </button>
          <button className="secondary" disabled={off} onClick={() => rotate(-5)}>
            ↺ 5°
          </button>
          <button className="secondary" disabled={off} onClick={() => rotate(5)}>
            ↻ 5°
          </button>
          <button className="secondary" disabled={off} onClick={() => resize(-0.05)}>
            작게
          </button>
          <button className="secondary" disabled={off} onClick={() => resize(0.05)}>
            크게
          </button>
        </div>
      </div>
      <p className="key-hint">
        게임 화면을 한 번 클릭한 뒤 — {KEY_HINT}
        {isNew ? "" : " · Delete/X 삭제"}
      </p>
      {isNew && (
        <label className="field">
          <span>배치 메모 (선택 · manifest 「메모」에 붙음)</span>
          <textarea
            rows={2}
            maxLength={1000}
            value={note}
            disabled={saving}
            onChange={(event) => onNote(event.target.value)}
            placeholder="예: 나루터 길가 항아리"
          />
        </label>
      )}
      <div className="decision-actions">
        {!isNew && (
          <button className="secondary naju-lib-danger" disabled={off} onClick={onRemove}>
            삭제 (Delete)
          </button>
        )}
        <button className="secondary" disabled={saving} onClick={onCancel}>
          취소 (Esc)
        </button>
        <button disabled={off} onClick={onCommit}>
          {isNew ? "확정 (Enter)" : "저장 (Enter)"}
        </button>
      </div>
      <small>
        {target?.kind === "instance"
          ? "저장하면 assets/edits.json 「고침」에 곧바로 적힙니다(원래 편집기와 같은 파일). Ctrl+Z 로 되돌립니다."
          : target?.kind === "place"
            ? "저장하면 public/_sf_local/manifest.json 「놓기」 그 자리를 고칩니다(쓰기마다 .local/review 에 백업). Ctrl+Z 로 되돌립니다."
            : "확정하면 곧바로 게임 데이터(public/_sf_local/manifest.json 「놓기」)에 저장되고 화면에 보통 놓기 에셋으로 나타납니다."}
      </small>
    </section>
  );
}

export interface LibraryDrawerProps {
  point: { x: number; y: number; z: number; zoneId: string | null; surface: string } | null;
  draft: PlacementDraft | null;
  target: EditTargetView | null;
  mode: DraftMode;
  loading: boolean;
  saving: boolean;
  message: { kind: "info" | "error" | "success"; text: string } | null;
  editorCount: number | null;
  /** 이번 편집 모드의 되돌리기(Ctrl+Z) 칸 수 */
  undoCount: number;
  overview: boolean;
  collapsed: boolean;
  libraryAvailable: boolean;
  /** 고립 중인 씬(0 = 전체) */
  sceneNo: IsolationKey;
  onScene: (key: IsolationKey) => void;
  onPick: (item: LibraryItem) => void;
  onAdjust: (change: DraftAdjust) => void;
  onCancel: () => void;
  onCommit: () => void;
  onRemove: () => void;
  note: string;
  onNote: (note: string) => void;
  onUndo: () => void;
  onSessionUndo: () => void;
  onClearPoint: () => void;
  onToggleCollapsed: () => void;
  onExit: () => void;
}

/** 조작 안내 — 옛 편집 안내판(EditHelpPanel)을 대신하는 한 장 */
function ControlsHelp({ overview }: { overview: boolean }) {
  return (
    <details className="naju-lib-help">
      <summary>조작 안내{overview ? " · 부감 켜짐(Tab)" : ""}</summary>
      <dl>
        <dt>카메라</dt>
        <dd>
          왼쪽 끌기 고개 · 오른쪽 끌기 이동 · 휠 커서 쪽으로 · WASD · Space/C 올리기·내리기 · ←→ 옆 · ↑↓ 높이 · Shift ×3
          · Tab 부감
        </dd>
        <dt>클릭</dt>
        <dd>물체 = 고르기(손잡이) · 땅·길·물 = 자리 · Alt+클릭 = 물체 위 자리 · 하늘 = 자리 해제</dd>
        <dt>고른 것</dt>
        <dd>
          화살표 10 cm(Shift 1 m) · [ ] 크기 · PageUp/Down 높이 · , . 회전 5°(Shift 15°) · Enter 저장 · Esc 취소 · Delete/X 삭제 ·
          Ctrl+C/V 복사(생성 무리)
        </dd>
        <dt>저장</dt>
        <dd>
          생성 무리·교체본 → assets/edits.json · 공개 에셋 놓기 → manifest 「놓기」(백업) · 라이브러리 → 「놓기」 새
          항목 · 팔레트 → edits.json 「더함」
        </dd>
        <dt>그 밖</dt>
        <dd>Ctrl+C·V(⌘C·V) 고른 자리 복사·붙여넣기 · Ctrl+Z 이번 편집 되돌리기 · Ctrl+S edits.json 다시 저장 · L 서랍 접기 · E 편집 끝내기</dd>
      </dl>
    </details>
  );
}

/** 씬·공간 고르기 — 고르면 그 범위만 그리고 그 안에서만 움직인다(sceneIsolation) */
const SCENE_NUMBERS = [1, 2, 3, 4, 5];
function SceneRow({ sceneNo, onScene }: { sceneNo: IsolationKey; onScene: (key: IsolationKey) => void }) {
  const cls = (key: IsolationKey) => (sceneNo === key ? "" : "secondary");
  return (
    <div className="naju-lib-scenes" role="group" aria-label="씬·공간 고르기">
      <div>
        <span>씬</span>
        <button type="button" className={cls("")} onClick={() => onScene("")}>
          전체
        </button>
        {SCENE_NUMBERS.map((no) => (
          <button
            key={no}
            type="button"
            className={cls(`S${no}`)}
            title={`씬 ${no} — ${sceneZones(no).join(" · ")}만 보기`}
            onClick={() => onScene(`S${no}`)}
          >
            씬{no}
          </button>
        ))}
      </div>
      <div>
        <span>공간</span>
        {isolationSpaces().map((space) => (
          <button
            key={space.code}
            type="button"
            className={cls(space.code)}
            title={`${space.code} ${space.name} — 쓰는 씬 ${space.scenes}`}
            onClick={() => onScene(space.code)}
          >
            {space.code} {space.name.split(" · ")[0]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 오른쪽 서랍 — 접으면 머리줄만 남는다(놓을 자리를 가리지 않게) */
export default function LibraryDrawer(props: LibraryDrawerProps) {
  const { point, draft, target, mode, loading, saving, message, editorCount, undoCount, collapsed } = props;
  const hasDraft = Boolean(draft) || loading;
  return (
    <aside
      className={`naju-lib-drawer${collapsed ? " collapsed" : ""}`}
      {...{ [LIBRARY_DRAWER_ATTR]: "" }}
      aria-label="편집 모드"
    >
      <div className="naju-lib-head">
        <div>
          <strong>편집 모드</strong>
          <small>물체 클릭 = 편집 · 땅 클릭 = 자리 · L 서랍 접기 · E 끝내기</small>
        </div>
        <button type="button" className="secondary" onClick={props.onToggleCollapsed}>
          {collapsed ? "펼치기" : "접기"}
        </button>
        <button type="button" className="secondary" onClick={props.onExit} title="편집 모드 끝내기 — 걷기로 (E)">
          끝내기 (E)
        </button>
      </div>
      <SceneRow sceneNo={props.sceneNo} onScene={props.onScene} />
      {collapsed && message && (
        <p className={`naju-lib-message ${message.kind} naju-lib-collapsed-message`} role="status">
          {message.text}
        </p>
      )}
      {!collapsed && (
        <div className="naju-lib-body">
          <div className={`library-point ${point ? "ready" : ""}`} role="status">
            {point ? (
              <>
                고른 자리{" "}
                <b>
                  x {meters(point.x)} · y {meters(point.y)} · z {meters(point.z)}
                </b>{" "}
                m{point.zoneId ? ` · ${point.zoneId}` : ""}{" "}
                <button type="button" className="quiet naju-lib-inline" onClick={props.onClearPoint}>
                  해제
                </button>
              </>
            ) : (
              "물체를 클릭하면 그 물체를 고칩니다. 땅·길을 클릭하면 놓을 자리(Alt+클릭 = 물체 위). 자리가 없으면 화면 가운데에 놓습니다."
            )}
          </div>
          <ControlsHelp overview={props.overview} />
          {message && (
            <p className={`naju-lib-message ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
              {message.text}
            </p>
          )}
          {hasDraft && (
            <AdjustCard
              draft={draft}
              target={target}
              mode={mode}
              loading={loading}
              saving={saving}
              note={props.note}
              onNote={props.onNote}
              onAdjust={props.onAdjust}
              onCancel={props.onCancel}
              onCommit={props.onCommit}
              onRemove={props.onRemove}
            />
          )}
          <div className="naju-lib-undo">
            <span>
              이번 편집 되돌리기 <b>{undoCount}</b>개
            </span>
            <button
              type="button"
              className="secondary"
              disabled={saving || !undoCount}
              onClick={props.onSessionUndo}
              title="이번 편집 모드에서 한 일(고침·지움·놓기)을 하나씩 각자 저장 경로로 되돌립니다."
            >
              되돌리기 (Ctrl+Z)
            </button>
          </div>
          <div className="naju-lib-undo">
            <span>
              편집기로 놓은 항목 <b>{editorCount ?? "—"}</b>개
            </span>
            <button
              type="button"
              className="secondary"
              disabled={saving || !editorCount}
              onClick={props.onUndo}
              title="manifest 「놓기」에서 편집기(editor:)가 놓은 마지막 항목 하나를 뺍니다. 백업이 남습니다."
            >
              되돌리기 (마지막 1개)
            </button>
          </div>
          <LibraryList
            hasPoint={Boolean(point)}
            disabled={saving || loading}
            libraryAvailable={props.libraryAvailable}
            onPick={props.onPick}
          />
        </div>
      )}
    </aside>
  );
}
