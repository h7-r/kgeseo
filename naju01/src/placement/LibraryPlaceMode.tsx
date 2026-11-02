// [E] 통합 편집 모드 — 라이브러리 배치 + 이미 놓인 에셋 고치기를 한 화면에서 (10/15 미르: 「E 를 누르면 바로 L 화면, 그 안에서 기존 에셋 편집까지」).
//   카메라·자리 고르기·손잡이·키는 검수 작업대 둘러보기와 같다(FreeCamera + PlacementLayer).
//   Editor 가 편집 모드 동안만 마운트한다 — 내리면 손잡이·서랍·리스너가 모두 치워지고 걷기로 돌아간다.
//
// 짧은 클릭(끌기 아님)
//   · 이미 놓인 에셋 → 고르기: 진짜 모양 유령 + 노란 테두리 + 이동 손잡이 + 서랍 숫자 칸. Enter = 그 에셋의 저장 경로로 확정
//       생성 무리(나무·바위·소품 …)         → assets/edits.json 「고침」(원래 편집기와 같은 파일·같은 꼴) — 바로 저장
//       공개 에셋 바꿔치기 교체본           → 그 밑의 생성 무리 자리를 고친다(교체본은 원래 자리를 따라 다시 선다)
//       공개 에셋 「놓기」(라이브러리로 놓은 것 포함) → manifest 「놓기」 그 자리(백업 남김)
//       그 밖(덮기 판·차단물·이야기 소품 …) → 「이 물체는 편집 경로가 없습니다」
//   · 땅·길·물 → 자리 고르기(노란 고리) → 서랍에서 에셋을 고르면 그 자리에 초안
//   · Alt+클릭 → 물체 위라도 그 겉면을 자리로 고른다
// 카메라: 왼쪽 끌기 고개 · 오른쪽 끌기 화면 평면 이동 · 휠 커서 쪽으로 날기 · WASD 앞뒤좌우 · Space/C 올리기·내리기
//   (초안이 없을 때) ←→ 옆으로 · ↑↓ 높이 · Shift ×3 · Tab 부감(내려다보기) 켜고 끄기
//   ※ Q/E 높이는 쓰지 않는다 — E 는 편집 모드 켜기·끄기다(검수 작업대와 달리 ↑↓·Space/C 로 높이).
// 고른 것/초안: 이동 손잡이 · 화살표 10 cm(Shift 1 m) · [ ] 크기 ×1.1/×0.9 · PageUp/Down 높이 5 cm(Shift 50 cm) · , . 5°(Shift 15°)
//   Enter 확정 · Esc 취소 · Delete/X 삭제(이미 놓인 에셋) · Ctrl+C/V(⌘C/V) 고른 자리 복사·붙여넣기(생성 무리·놓기)
// Ctrl+Z 이번 편집 되돌리기(최근 30개, 각자 저장 경로로) · Ctrl+S edits.json 다시 저장 · L 서랍 접기/펴기 · E 편집 끝내기
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { reloadPublicAssets } from "../loaders/publicAssets";
import type { PlaceEditInfo } from "../loaders/publicAssetPlacement";
import { BASELINE, METERS_PER_UNIT, UNITS_PER_METER } from "../plan/sitePlan";
import { FreeCamera } from "../review/freeCamera";
import { PlacementLayer, type DraftMode, type PlacementDraft, type ProxyBox } from "../review/placementLayer";
import { classifyReviewSurface, type ReviewPointM } from "../review/reviewPolicy";
import { InstanceHold, type HoldSpec } from "./editHold";
import reviewViewsJson from "../review/reviewViews.json";
import { activeIsolation, clampCameraXZ, isInsideActive, isolate, maintainIsolation } from "../review/sceneIsolation";
import { ISOLATION_MARGIN_M, isolationTargetFor, zoneForPoint, type IsolationKey } from "../review/sceneScope";
import { findAsset } from "./assetCatalog";
import { saveEdits } from "./editFile";
import { GROUND_MESHES, OVERVIEW_CAMERA, UNPICKABLE_REASONS } from "./editorConfig";
import {
  addInstance,
  applyEdits,
  modifyInstance,
  removeInstance,
  type Edits,
  type InstanceGroup,
  type Spot,
  type SpotPatch,
} from "./instanceGroups";
import LibraryDrawer, { type DraftAdjust, type EditTargetView, type LibraryDrawerProps } from "./LibraryDrawer";
import {
  LIBRARY_DRAWER_ATTR,
  fetchEditorEntries,
  postPlaceDuplicate,
  postPlaceRemove,
  postPlaceRestore,
  postPlaceUpdate,
  postPlacement,
  postUndo,
  type LibraryItem,
  type PlaceEntry,
  type PlaceRef,
} from "./libraryPlaceApi";

const U = UNITS_PER_METER;
const DEG = 180 / Math.PI;
/** 날기 키 — WASD · Space/C 높이 · 방향키(초안이 없을 때: ←→ 옆으로, ↑↓ 높이) · Shift ×3 */
const FLY_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "Space",
  "KeyC",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
]);
/** 게임으로 그대로 보내는 키 — E(편집 끝내기 · useSceneModes) · H(계기판) */
const PASS_CODES = new Set(["KeyE", "KeyH"]);
const FLY_SPEED_MPS = 9;
const UNDO_LIMIT = 30;
/** 공개 에셋 풀 교체본(땅.풀) — 편집 파일에 없는 합본 풀 자리라 뚫고 그 밑 땅을 고른다 */
const SEE_THROUGH_GROUPS = new Set(["땅.풀"]);
const _fly = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _matrix = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const round3 = (value: number) => Math.round(value * 1000) / 1000;
/** 초안이 처음 값에서 바뀌었는가(확정·Ctrl+Z 공용 기준) */
const draftChanged = (value: PlacementDraft, start: PlacementDraft) =>
  Math.abs(value.position.x - start.position.x) >= 5e-4 ||
  Math.abs(value.position.y - start.position.y) >= 5e-4 ||
  Math.abs(value.position.z - start.position.z) >= 5e-4 ||
  Math.abs(value.rotationY - start.rotationY) >= 0.05 ||
  Math.abs(value.scale - start.scale) >= 1e-4;
const reviewViews = reviewViewsJson as unknown as { id: string; position: [number, number, number]; target: [number, number, number] }[];
/** [E] 편집 모드에서 고른 씬·공간("S1"·"Z2" …, "" = 전체) — 편집 모드를 껐다 켜도 이어진다. 걷기(게임)로 돌아가면 고립은 풀린다 */
let editScene: IsolationKey = "";
const TEXT_ENTRY = "input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select";

type GroundAt = (x: number, z: number) => { y: number; zone?: string | null } | null | undefined;
type PointState = NonNullable<LibraryDrawerProps["point"]>;
type Message = LibraryDrawerProps["message"];

/** 지금 초안(손잡이)이 무엇인가 — 확정·삭제가 어느 저장 경로로 갈지 정한다 */
type EditTarget =
  | { kind: "library"; item: LibraryItem; label: string }
  | { kind: "instance"; groupId: string; id: number; base: Spot; label: string; replacement: boolean }
  | { kind: "place"; ref: PlaceRef; label: string };

/** 이번 편집 모드의 되돌리기 한 칸 — 각자 저장 경로로 되돌린다 */
type UndoStep =
  | { kind: "edits"; before: Edits; label: string }
  | { kind: "place"; index: number; expect: PlaceEntry | null; entry: PlaceEntry | null; label: string };

/** 클릭이 맞은 것 */
type Picked =
  | { kind: "instance"; groupId: string; id: number; mesh: THREE.InstancedMesh; instanceId: number }
  | { kind: "place"; info: PlaceEditInfo; spot: number; mesh: THREE.InstancedMesh; instanceId: number }
  | { kind: "surface"; hit: THREE.Intersection }
  | { kind: "other"; name: string };

interface LibraryPlaceModeProps {
  /** 게임 땅 높이(m) — 공개 에셋 「놓기」가 세울 때 쓰는 것과 같은 terrain.groundAt */
  groundAt: GroundAt;
  overview: boolean;
  setOverview?: Dispatch<SetStateAction<boolean>>;
  /** 편집 모드 끄기(E 와 같다) */
  onExit: () => void;
  /** 손 배치 편집(assets/edits.json) — 생성 무리 고치기 */
  edits: Edits;
  setEdits: Dispatch<SetStateAction<Edits>>;
  instanceGroups: readonly InstanceGroup[];
  /** 공개·국가유산 GLB 를 manifest 「놓기」로 놓을 수 있나(공개 에셋 화면 + 개발 서버) */
  libraryAvailable: boolean;
}

const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true;

/** 짧은 클릭이 맞을 수 있는 것들 — 손잡이·자리 표시·초안·보이지 않는 것은 뺀다(검수 pickObject 와 같은 거르기) */
function visibleHits(scene: THREE.Scene, layer: PlacementLayer) {
  return _ray.intersectObjects(scene.children, true).filter((item) => {
    if (!isMesh(item.object) || item.object.userData.reviewSelection) return false;
    for (let node: THREE.Object3D | null = item.object; node; node = node.parent) if (!node.visible) return false;
    if (layer.isDraftObject(item.object)) return false;
    // 씬 고립 중이면 경계 밖(잘려 안 보이는 것)은 못 집는다
    if (!isInsideActive(item.point)) return false;
    const materials = Array.isArray(item.object.material) ? item.object.material : [item.object.material];
    return materials.some((m) => m?.visible !== false && !(m?.transparent && m.opacity < 0.05));
  });
}

const isSurfaceName = (name: string) =>
  Boolean(classifyReviewSurface(name)) || GROUND_MESHES.includes(name) || name.startsWith("distant.");

/** 맞은 것 가리기. surfaceOnly(Alt) 면 맞은 첫 겉면을 자리로 본다. 하늘이면 null */
function classify(hits: THREE.Intersection[], surfaceOnly: boolean): Picked | null {
  for (const hit of hits) {
    const object = hit.object;
    if (object.name.startsWith("sky")) return null;
    if (surfaceOnly) return { kind: "surface", hit };
    const mesh = object as THREE.InstancedMesh;
    if (mesh.isInstancedMesh && hit.instanceId !== undefined) {
      const ids = mesh.userData.ids as ArrayLike<number> | undefined;
      const groupId = mesh.userData.groupId as string | undefined;
      if (groupId && SEE_THROUGH_GROUPS.has(groupId)) continue;
      const id = ids?.[hit.instanceId];
      if (groupId && id !== undefined) return { kind: "instance", groupId, id, mesh, instanceId: hit.instanceId };
      const info = mesh.userData.placeEdit as PlaceEditInfo | undefined;
      const spot = (mesh.userData.placeSpots as ArrayLike<number> | undefined)?.[hit.instanceId];
      if (info && spot !== undefined) return { kind: "place", info, spot, mesh, instanceId: hit.instanceId };
    }
    if (isSurfaceName(object.name)) return { kind: "surface", hit };
    return { kind: "other", name: object.name };
  }
  return null;
}

/** 인스턴스 하나의 국소 테두리(m, 뿌리 기준). 놓기처럼 재질마다 메시가 나뉜 것은 같이 넘겨 합친다 */
function instanceBox(meshes: THREE.InstancedMesh[], instanceId: number): ProxyBox {
  const box = new THREE.Box3();
  for (const mesh of meshes) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox);
  }
  meshes[0].getMatrixAt(instanceId, _matrix);
  _matrix.premultiply(meshes[0].matrixWorld).decompose(_pos, _quat, _scale);
  if (box.isEmpty()) return { size: [1, 1, 1], center: [0, 0.5, 0] };
  const s = [_scale.x / U, _scale.y / U, _scale.z / U];
  return {
    size: [(box.max.x - box.min.x) * s[0], (box.max.y - box.min.y) * s[1], (box.max.z - box.min.z) * s[2]],
    center: [
      ((box.max.x + box.min.x) / 2) * s[0],
      ((box.max.y + box.min.y) / 2) * s[1],
      ((box.max.z + box.min.z) / 2) * s[2],
    ],
  };
}
const cubeBox = (size: number): ProxyBox => ({ size: [size, size, size], center: [0, size / 2, 0] });

const describeOther = (name: string) => UNPICKABLE_REASONS[name] ?? (name ? `「${name}」` : "이름 없는 물체");

export default function LibraryPlaceMode({
  groundAt,
  overview,
  setOverview,
  onExit,
  edits,
  setEdits,
  instanceGroups,
  libraryAvailable,
}: LibraryPlaceModeProps) {
  const { scene, camera, gl } = useThree();
  const [point, setPoint] = useState<PointState | null>(null);
  const [draft, setDraft] = useState<PlacementDraft | null>(null);
  const [targetView, setTargetView] = useState<EditTargetView | null>(null);
  const [mode, setMode] = useState<DraftMode>("move");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [editorCount, setEditorCount] = useState<number | null>(null);
  const [undoCount, setUndoCount] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [sceneNo, setSceneNo] = useState(editScene);

  const layerRef = useRef<PlacementLayer | null>(null);
  const flyKeys = useRef(new Set<string>());
  const targetRef = useRef<EditTarget | null>(null);
  /** 이미 놓인 에셋을 고를 때의 처음 값 — 안 바뀌었으면 저장하지 않는다 */
  const startRef = useRef<PlacementDraft | null>(null);
  /** 고른 에셋의 원래 자리 숨김 + 진짜 모양 유령(editHold) */
  const holdRef = useRef<InstanceHold | null>(null);
  const editsRef = useRef(edits);
  const undoStack = useRef<UndoStep[]>([]);
  // 복사한 것 — 생성 무리(edits.json) 한 자리 또는 놓기(manifest) 한 자리(10/20 미르: 「복사 붙여넣기가 안 먹힌다」)
  const clipboard = useRef<
    { kind: "instance"; groupId: string; spot: Spot } | { kind: "place"; ref: PlaceRef; label: string } | null
  >(null);
  const savedView = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>(null);
  const latest = useRef({ groundAt, overview, setOverview, onExit, instanceGroups, point, note, saving });
  useLayoutEffect(() => {
    latest.current = { groundAt, overview, setOverview, onExit, instanceGroups, point, note, saving };
    editsRef.current = edits;
  });

  const refreshCount = useCallback(() => {
    fetchEditorEntries().then(
      (value) => setEditorCount(value.entries.length),
      () => setEditorCount(null),
    );
  }, []);

  const pushUndo = useCallback((step: UndoStep) => {
    undoStack.current.push(step);
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    setUndoCount(undoStack.current.length);
  }, []);

  /** 초안 상태를 서랍에 — 손잡이·키·숫자 입력 뒤 */
  const syncDraft = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.markPosted(performance.now());
    setDraft(layer.read());
    setMode(layer.draftSummary()?.mode ?? "move");
  }, []);

  const clearPoint = useCallback(() => {
    layerRef.current?.clearMarker();
    setPoint(null);
  }, []);

  const setTarget = useCallback((target: EditTarget | null) => {
    targetRef.current = target;
    if (!target) setTargetView(null);
    else if (target.kind === "library")
      setTargetView({ kind: "library", title: target.label, detail: "라이브러리 → manifest 「놓기」에 새로 놓기" });
    else if (target.kind === "instance")
      setTargetView({
        kind: "instance",
        title: target.label,
        detail: target.replacement
          ? `공개 에셋 교체본 — 밑의 생성 무리 ${target.groupId} #${target.id} 를 고칩니다(edits.json)`
          : `생성 무리 ${target.groupId} #${target.id} → assets/edits.json`,
      });
    else
      setTargetView({
        kind: "place",
        title: target.label,
        detail: `manifest 「놓기」 #${target.ref.index} · 자리 ${target.ref.spot + 1} → public/_sf_local/manifest.json`,
      });
  }, []);

  /** 숨김을 넘겨받는다 — 저장이 끝나 화면이 새 자리로 다시 설 때까지 원래 자리를 계속 가리려고 */
  const takeHold = useCallback(() => {
    const hold = holdRef.current;
    holdRef.current = null;
    return hold;
  }, []);

  /** 이미 놓인 에셋 고르기 — 원래 자리를 숨기고, 초안 뿌리에 진짜 모양 유령을 붙이는 함수 */
  const beginHold = useCallback(
    (spec: HoldSpec) => {
      holdRef.current?.release();
      const hold = new InstanceHold(scene, spec);
      holdRef.current = hold;
      return (root: THREE.Group) => void hold.buildGhosts(root);
    },
    [scene],
  );

  const cancelDraft = useCallback(() => {
    takeHold()?.release();
    layerRef.current?.cancel();
    setTarget(null);
    setDraft(null);
    setLoading(false);
  }, [setTarget, takeHold]);

  /** 화면 가운데에서 땅으로 쏜 지점(못 맞히면 카메라 앞 6 m 땅) */
  const centerGround = useCallback((): ReviewPointM => {
    const layer = layerRef.current!;
    _ray.setFromCamera(_ndc.set(0, 0), camera);
    const hit = visibleHits(scene, layer)[0];
    if (hit)
      return { x: hit.point.x * METERS_PER_UNIT, y: hit.point.y * METERS_PER_UNIT, z: hit.point.z * METERS_PER_UNIT };
    const forward = camera.getWorldDirection(_fly).setY(0);
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    const x = camera.position.x * METERS_PER_UNIT + forward.x * 6;
    const z = camera.position.z * METERS_PER_UNIT + forward.z * 6;
    return { x, y: latest.current.groundAt(x, z)?.y ?? 0, z };
  }, [camera, scene]);

  // ── 생성 무리(edits.json) 쓰기 — 화면에 곧바로 반영하고 파일에도 바로 저장한다 ──
  const writeEdits = useCallback(
    async (next: Edits, label: string) => {
      pushUndo({ kind: "edits", before: editsRef.current, label });
      editsRef.current = next;
      setEdits(next);
      try {
        await saveEdits(next);
        setMessage({ kind: "success", text: `${label} → assets/edits.json 저장` });
      } catch (error) {
        setMessage({
          kind: "error",
          text: `화면에는 반영했지만 저장하지 못했습니다 — ${(error as Error).message} (Ctrl+S 로 다시 저장)`,
        });
      }
    },
    [pushUndo, setEdits],
  );

  /** 생성 무리 한 자리를 고르기 — 지금 편집(edits)을 얹은 자리를 손잡이로 */
  const editInstance = useCallback(
    (groupId: string, id: number, picked?: { mesh: THREE.InstancedMesh; instanceId: number }) => {
      const layer = layerRef.current;
      if (!layer) return;
      // 팔레트로 막 처음 놓은 무리는 아직 무리 목록에 없다 — 생성 자리 없이 「더함」만으로 찾는다
      const group = latest.current.instanceGroups.find((g) => g.groupId === groupId);
      const spot = applyEdits(groupId, group?.generatedSpots ?? [], editsRef.current).find((s) => s.id === id);
      if (!spot) {
        cancelDraft();
        setMessage({
          kind: "error",
          text: `이 물체는 편집 경로가 없습니다 — ${groupId} #${id} 는 edits.json 으로 고치는 무리가 아닙니다.`,
        });
        return;
      }
      const replacement = Boolean(picked?.mesh.userData.publicAssetReplacement);
      const label = `${groupId} #${id}`;
      const box = picked ? instanceBox([picked.mesh], picked.instanceId) : cubeBox(spot.size);
      layer.cancel();
      const decorate = beginHold({ kind: "instance", groupId, id });
      startRef.current = layer.startProxy(
        { id: label, nameKo: label },
        { x: spot.x, y: spot.y, z: spot.z },
        (spot.rotation ?? 0) * DEG,
        box,
        decorate,
      );
      setTarget({ kind: "instance", groupId, id, base: spot, label, replacement });
      setLoading(false);
      syncDraft();
      setMessage({
        kind: "info",
        text: `${label} 고름 · 키 ${spot.size.toFixed(2)} m — 손잡이·화살표로 맞추고 Enter(저장) · Delete 삭제 · Esc 취소`,
      });
    },
    [beginHold, cancelDraft, setTarget, syncDraft],
  );

  /** 공개 에셋 「놓기」 한 자리를 고르기 */
  const editPlace = useCallback(
    (info: PlaceEditInfo, spotIndex: number, mesh: THREE.InstancedMesh, instanceId: number) => {
      const layer = layerRef.current;
      const row = info.spots[spotIndex];
      if (!layer) return;
      if (!row || info.manifestIndex < 0 || !info.file) {
        cancelDraft();
        setMessage({
          kind: "error",
          text: "이 물체는 편집 경로가 없습니다 — manifest 「놓기」 위치를 알 수 없습니다.",
        });
        return;
      }
      const siblings = (mesh.parent?.children ?? [mesh]).filter(
        (child): child is THREE.InstancedMesh =>
          (child as THREE.InstancedMesh).isInstancedMesh && child.userData.placeEdit === info,
      );
      const box = instanceBox(siblings.length ? siblings : [mesh], instanceId);
      mesh.getMatrixAt(instanceId, _matrix);
      _pos.setFromMatrixPosition(_matrix.premultiply(mesh.matrixWorld));
      const label =
        info.file
          .split("/")
          .at(-1)
          ?.replace(/\.glb$/u, "") ?? info.file;
      layer.cancel();
      const decorate = beginHold({ kind: "place", manifestIndex: info.manifestIndex, spot: spotIndex });
      startRef.current = layer.startProxy(
        { id: `place:${info.manifestIndex}:${spotIndex}`, nameKo: label },
        { x: row[0], y: _pos.y * METERS_PER_UNIT, z: row[1] },
        row[2] ?? 0,
        box,
        decorate,
      );
      setTarget({
        kind: "place",
        ref: { index: info.manifestIndex, file: info.file, spot: spotIndex, at: [row[0], row[1]] },
        label,
      });
      setLoading(false);
      syncDraft();
      setMessage({
        kind: "info",
        text: `놓기 「${label}」 고름${info.spots.length > 1 ? ` (자리 ${info.spots.length}개 중 ${spotIndex + 1})` : ""} — Enter 저장 · Delete 삭제 · Esc 취소`,
      });
    },
    [beginHold, cancelDraft, setTarget, syncDraft],
  );

  /** 서랍에서 고른 에셋 — 공개·국가유산 GLB 는 초안(손잡이), 팔레트 코드 모형은 edits.json 「더함」에 바로 놓고 고른다 */
  const startDraft = useCallback(
    (item: LibraryItem) => {
      const layer = layerRef.current;
      if (!layer) return;
      const at = latest.current.point ?? centerGround();
      if (item.source === "palette") {
        const key = item.id.replace(/^palette:/u, "");
        const asset = findAsset(key);
        if (!asset) {
          setMessage({ kind: "error", text: `팔레트에서 「${key}」 모형을 찾지 못했습니다.` });
          return;
        }
        const size = asset.defaultSize ?? 1;
        const { edits: next, id } = addInstance(editsRef.current, key, {
          x: round3(at.x),
          y: round3(at.y - (asset.centerOrigin ? -size * 0.3 : 0)),
          z: round3(at.z),
          size,
          rotation: Math.random() * Math.PI * 2,
          ...(asset.defaultWidthRatio !== undefined ? { widthRatio: asset.defaultWidthRatio } : null),
          ...(asset.defaultDepthRatio !== undefined ? { depthRatio: asset.defaultDepthRatio } : null),
          ...(asset.defaultColor !== undefined ? { color: asset.defaultColor } : null),
        });
        cancelDraft();
        void writeEdits(next, `${asset.label} 놓음 #${id}`).then(() => editInstance(key, id));
        return;
      }
      if (!item.url || !item.placeable) return;
      if (!libraryAvailable) {
        setMessage({
          kind: "error",
          text: import.meta.env.DEV
            ? "공개·국가유산 GLB 배치는 공개 에셋 화면(?aihub&src=sf)에서만 됩니다 — 팔레트 모형과 기존 에셋 편집은 됩니다."
            : "공개·국가유산 GLB 배치는 개발 서버(npx vite naju01)에서만 됩니다.",
        });
        return;
      }
      setTarget({ kind: "library", item, label: item.nameKo });
      setDraft(null);
      setLoading(true);
      setMessage(null);
      layer
        .startDraft({ id: item.id, url: item.url, nameKo: item.nameKo, source: item.source, sha256: item.sha256 }, at)
        .then(() => syncDraft())
        .catch((error: Error) => {
          // 다른 초안으로 바뀐 경우는 조용히
          const target = targetRef.current;
          if (target?.kind === "library" && target.item === item) {
            setTarget(null);
            setMessage({ kind: "error", text: `불러오지 못했습니다 — ${error.message}` });
          }
        })
        .finally(() => {
          const target = targetRef.current;
          if ((target?.kind === "library" && target.item === item) || !target) setLoading(Boolean(layer.loading));
        });
    },
    [cancelDraft, centerGround, editInstance, libraryAvailable, setTarget, syncDraft, writeEdits],
  );

  const adjust = useCallback(
    (change: DraftAdjust) => {
      layerRef.current?.adjust(change);
      syncDraft();
    },
    [syncDraft],
  );

  /** 서버에 놓기를 쓴 뒤 — 화면 다시 세우기 + 편집기 항목 수 */
  const afterPlaceWrite = useCallback(
    async (text: string) => {
      const shown = await reloadPublicAssets().catch(() => false);
      setMessage({ kind: "success", text: text + (shown ? "" : " · 화면 반영은 새로고침 뒤") });
      refreshCount();
    },
    [refreshCount],
  );

  /** 확정(Enter) — 초안의 종류마다 그 저장 경로로 */
  const commit = useCallback(async () => {
    const layer = layerRef.current;
    const target = targetRef.current;
    const value = layer?.read();
    if (!layer || !target || !value || latest.current.saving || layer.loading) return;
    const start = startRef.current;
    if (target.kind !== "library" && start && !draftChanged(value, start)) {
      cancelDraft();
      setMessage({ kind: "info", text: "바뀐 것이 없어 저장하지 않았습니다." });
      return;
    }
    if (target.kind === "instance") {
      const { base, groupId, id } = target;
      const patch: SpotPatch = { x: value.position.x, y: value.position.y, z: value.position.z };
      const before = ((((base.rotation ?? 0) * DEG) % 360) + 360) % 360;
      if (Math.abs(value.rotationY - before) > 0.05) patch.rotation = value.rotationY / DEG;
      if (Math.abs(value.scale - 1) > 1e-4) patch.size = round3(base.size * value.scale);
      // 숨김은 저장 뒤 화면이 새 자리로 다시 설 때까지 쥐고 있다 — 원래 자리가 잠깐 비치지 않게
      const hold = takeHold();
      cancelDraft();
      try {
        await writeEdits(modifyInstance(editsRef.current, groupId, id, patch), `${groupId} #${id} 고침`);
      } finally {
        hold?.release();
      }
      return;
    }
    setSaving(true);
    setMessage({ kind: "info", text: "저장 중…" });
    try {
      if (target.kind === "place") {
        const result = await postPlaceUpdate({
          ref: target.ref,
          position: value.position,
          rotationY: value.rotationY,
          scale: value.scale,
          groundY: value.groundY,
        });
        pushUndo({
          kind: "place",
          index: result.index,
          expect: result.entry,
          entry: result.previous,
          label: target.label,
        });
        const hold = takeHold();
        cancelDraft();
        try {
          await afterPlaceWrite(
            `고쳤습니다 → manifest 「놓기」 #${result.index} ${target.label}` +
              (result.heightIgnored ? " · 자리가 여럿인 항목이라 높이는 그대로 두었습니다(묻힘m 공용)" : ""),
          );
        } finally {
          hold?.release();
        }
        return;
      }
      const item = target.item;
      if (!item.url) return;
      const result = await postPlacement({
        asset: { source: item.source, url: item.url, sha256: item.sha256, id: item.id, nameKo: item.nameKo },
        position: value.position,
        rotationY: value.rotationY,
        scale: value.scale,
        groundY: value.groundY,
        zoneId: value.zoneId,
        note: latest.current.note.trim() || undefined,
      });
      pushUndo({ kind: "place", index: result.index, expect: result.entry, entry: null, label: item.nameKo });
      cancelDraft();
      clearPoint();
      setNote("");
      await afterPlaceWrite(
        `놓았습니다 → manifest 「놓기」 #${result.index} · ${result.entry.file} · 키 ${result.entry.키m} m`,
      );
    } catch (error) {
      setMessage({ kind: "error", text: `저장하지 못했습니다 — ${(error as Error).message}` });
    } finally {
      setSaving(false);
    }
  }, [afterPlaceWrite, cancelDraft, clearPoint, pushUndo, takeHold, writeEdits]);

  /** 삭제(Delete/X · 단추) — 이미 놓인 에셋만 */
  const remove = useCallback(async () => {
    const target = targetRef.current;
    if (!target || target.kind === "library" || latest.current.saving) return;
    if (target.kind === "instance") {
      const hold = takeHold();
      cancelDraft();
      try {
        await writeEdits(
          removeInstance(editsRef.current, target.groupId, target.id),
          `${target.groupId} #${target.id} 지움`,
        );
      } finally {
        hold?.release();
      }
      return;
    }
    setSaving(true);
    try {
      const result = await postPlaceRemove(target.ref);
      pushUndo(
        result.entry
          ? { kind: "place", index: result.index, expect: result.entry, entry: result.previous, label: target.label }
          : { kind: "place", index: result.index, expect: null, entry: result.previous, label: target.label },
      );
      const hold = takeHold();
      cancelDraft();
      try {
        await afterPlaceWrite(
          result.entry
            ? `지웠습니다 — 「놓기」 #${result.index} 의 자리 하나(남은 자리 ${result.entry.자리.length}개)`
            : `지웠습니다 — 「놓기」 #${result.index} ${target.label} 항목을 뺐습니다`,
        );
      } finally {
        hold?.release();
      }
    } catch (error) {
      setMessage({ kind: "error", text: `지우지 못했습니다 — ${(error as Error).message}` });
    } finally {
      setSaving(false);
    }
  }, [afterPlaceWrite, cancelDraft, pushUndo, takeHold, writeEdits]);

  /** Ctrl+Z — 이번 편집 모드에서 한 일 하나를 그 저장 경로로 되돌린다 */
  const sessionUndo = useCallback(async () => {
    if (latest.current.saving) return;
    // 10/15 미르: 저장 전(Enter 전) 움직이던 것이 있으면 Ctrl+Z 는 그 변경만 취소한다.
    //   전에는 초안을 버리면서 이미 저장된 바로 앞 편집까지 함께 되돌렸다.
    const layer = layerRef.current;
    if (layer && (layer.loading || layer.hasDraft())) {
      const target = targetRef.current;
      const start = startRef.current;
      const value = layer.read();
      const pending = layer.loading || !target || target.kind === "library" || !start || !value || draftChanged(value, start);
      cancelDraft();
      if (pending) {
        setMessage({
          kind: "info",
          text: `저장 전 변경을 취소했습니다${target ? ` — ${target.label}` : ""} · 저장된 편집은 그대로입니다(한 번 더 Ctrl+Z = 마지막 저장 되돌리기)`,
        });
        return;
      }
    }
    const step = undoStack.current.pop();
    setUndoCount(undoStack.current.length);
    if (!step) {
      setMessage({ kind: "info", text: "이번 편집에서 되돌릴 것이 없습니다." });
      return;
    }
    cancelDraft();
    if (step.kind === "edits") {
      editsRef.current = step.before;
      setEdits(step.before);
      try {
        await saveEdits(step.before);
        setMessage({ kind: "success", text: `되돌림 — ${step.label} (edits.json 저장)` });
      } catch (error) {
        setMessage({ kind: "error", text: `되돌렸지만 저장하지 못했습니다 — ${(error as Error).message}` });
      }
      return;
    }
    setSaving(true);
    try {
      await postPlaceRestore({ index: step.index, expect: step.expect, entry: step.entry });
      await afterPlaceWrite(`되돌림 — ${step.label} (manifest 「놓기」 #${step.index})`);
    } catch (error) {
      undoStack.current.push(step);
      setUndoCount(undoStack.current.length);
      setMessage({ kind: "error", text: `되돌리지 못했습니다 — ${(error as Error).message}` });
    } finally {
      setSaving(false);
    }
  }, [afterPlaceWrite, cancelDraft, setEdits]);

  /** 서랍 「되돌리기(마지막 1개)」 — 편집기(editor:)로 놓은 마지막 놓기 항목 */
  const undoLastEditorPlace = useCallback(async () => {
    if (latest.current.saving) return;
    setSaving(true);
    try {
      const result = await postUndo();
      await afterPlaceWrite(
        `되돌렸습니다 — ${result.removed.file} (${result.removed.출처 ?? ""}) 를 뺐습니다 · 남은 편집기 배치 ${result.remaining}개`,
      );
    } catch (error) {
      setMessage({ kind: "error", text: `되돌리지 못했습니다 — ${(error as Error).message}` });
    } finally {
      setSaving(false);
    }
  }, [afterPlaceWrite]);

  const saveNow = useCallback(async () => {
    try {
      await saveEdits(editsRef.current);
      setMessage({ kind: "success", text: "저장했습니다 → assets/edits.json" });
    } catch (error) {
      setMessage({ kind: "error", text: `저장하지 못했습니다 — ${(error as Error).message}` });
    }
  }, []);

  /** Ctrl+C / Ctrl+V — 고른 한 자리 복사(생성 무리 · 놓기 둘 다). 붙이기는 마지막으로 짧게 클릭한 땅, 없으면 화면 가운데 */
  const copy = useCallback(() => {
    const target = targetRef.current;
    if (target?.kind === "instance") {
      clipboard.current = { kind: "instance", groupId: target.groupId, spot: target.base };
    } else if (target?.kind === "place") {
      clipboard.current = { kind: "place", ref: target.ref, label: target.label };
    } else {
      setMessage({ kind: "info", text: "복사할 것을 먼저 고르세요 — 이미 놓인 에셋을 클릭한 뒤 Ctrl+C(⌘C)" });
      return;
    }
    setMessage({ kind: "info", text: `복사함 — ${target.label} · 붙일 자리를 짧게 클릭하고 Ctrl+V(⌘V)` });
  }, []);
  const paste = useCallback(() => {
    const copied = clipboard.current;
    if (!copied) {
      setMessage({ kind: "info", text: "복사한 것이 없습니다 — 먼저 놓인 에셋을 고르고 Ctrl+C(⌘C)" });
      return;
    }
    if (copied.kind === "place") {
      if (latest.current.saving) return;
      const { ref, label } = copied;
      // 자리를 안 찍었으면 화면 가운데(보고 있는 곳)에 — 원본 옆 1 m 에 붙이면 큰 바위·덤불에 겹쳐 안 붙은 것처럼 보였다(10/20)
      const at = latest.current.point ?? centerGround();
      setSaving(true);
      setMessage({ kind: "info", text: "붙이는 중…" });
      cancelDraft();
      void postPlaceDuplicate({ ref, x: round3(at.x), z: round3(at.z) })
        .then(async (result) => {
          pushUndo({ kind: "place", index: result.index, expect: result.entry, entry: result.previous, label });
          clearPoint();
          await afterPlaceWrite(`붙여넣음 → manifest 「놓기」 #${result.index} ${label} (자리 ${result.entry.자리.length}개)`);
        })
        .catch((error: Error) => setMessage({ kind: "error", text: `붙이지 못했습니다 — ${error.message}` }))
        .finally(() => setSaving(false));
      return;
    }
    const { spot, groupId } = copied;
    const ground = (x: number, z: number) => latest.current.groundAt(x, z)?.y ?? 0;
    const lift = spot.y - ground(spot.x, spot.z);
    const at = latest.current.point ?? centerGround();
    const rest: Spot = { ...spot };
    delete rest.id;
    const x = round3(at.x);
    const z = round3(at.z);
    const { edits: next, id } = addInstance(editsRef.current, groupId, {
      ...rest,
      x,
      y: round3(ground(x, z) + lift),
      z,
    });
    cancelDraft();
    void writeEdits(next, `붙여넣음 — ${groupId} #${id}`).then(() => {
      editInstance(groupId, id);
      clearPoint();
      setMessage({ kind: "success", text: `붙여넣음 — ${groupId} #${id} · 손잡이로 옮기고 Enter(저장) · Ctrl+Z 되돌리기` });
    });
  }, [afterPlaceWrite, cancelDraft, centerGround, clearPoint, editInstance, pushUndo, writeEdits]);

  /** Tab — 내려다보기(부감). 켤 때 지금 시점을 기억했다가 끌 때 돌려놓는다 */
  const toggleOverview = useCallback(() => {
    const { overview: on, setOverview: set, groundAt: ground } = latest.current;
    if (!on) {
      savedView.current = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
      const x = camera.position.x * METERS_PER_UNIT;
      const z = camera.position.z * METERS_PER_UNIT;
      const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ").y;
      camera.position.y = ((ground(x, z)?.y ?? 0) + OVERVIEW_CAMERA.height) * U;
      camera.quaternion.setFromEuler(new THREE.Euler(OVERVIEW_CAMERA.pitch, yaw, 0, "YXZ"));
    } else if (savedView.current) {
      camera.position.copy(savedView.current.position);
      camera.quaternion.copy(savedView.current.quaternion);
      savedView.current = null;
    }
    camera.updateMatrixWorld();
    set?.(!on);
  }, [camera]);

  const latestActions = useRef({
    commit,
    cancelDraft,
    clearPoint,
    syncDraft,
    remove,
    sessionUndo,
    saveNow,
    copy,
    paste,
    toggleOverview,
    editInstance,
    editPlace,
  });
  useLayoutEffect(() => {
    latestActions.current = {
      commit,
      cancelDraft,
      clearPoint,
      syncDraft,
      remove,
      sessionUndo,
      saveNow,
      copy,
      paste,
      toggleOverview,
      editInstance,
      editPlace,
    };
  });

  // ── 켜기/끄기: 배치 층·카메라·마우스·키 ─────────────────────────────────
  useEffect(() => {
    const dom = gl.domElement;
    const freeCamera = new FreeCamera(camera, dom);
    const layer = new PlacementLayer({
      scene,
      camera,
      dom,
      groundAt: (x, z) => latest.current.groundAt(x, z),
      zoneAt: (x, z, groundZone) => zoneForPoint(x, z, groundZone, null),
      bounds: () => activeIsolation(),
      // 손잡이를 끄는 동안 카메라·고르기가 반응하지 않게
      onDragging: (active) => {
        freeCamera.enabled = !active;
      },
    });
    layerRef.current = layer;
    const keys = flyKeys.current;

    const aim = (event: { clientX: number; clientY: number }) => {
      const rect = dom.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      _ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
      _ray.setFromCamera(_ndc, camera);
      return true;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!aim(event)) return;
      // 검수 둘러보기와 같은 값 — 한 칸(deltaY≈100)에 2.5 m, Shift 3배, 한 번에 15 m 까지
      const meters = Math.max(-15, Math.min(15, -event.deltaY * 0.025 * (event.shiftKey ? 3 : 1)));
      camera.position.addScaledVector(_ray.ray.direction, meters * U);
      camera.updateMatrixWorld();
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      down = { x: event.clientX, y: event.clientY };
      // 손잡이(TransformControls)는 이 뒤에 등록돼 같은 누름에서 dragging-changed 로 다시 켠다
      layer.gizmoPressed = false;
    };
    const onUp = (event: PointerEvent) => {
      const start = down;
      down = null;
      if (layer.isGizmoBusy() || event.button !== 0 || !start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5) return;
      if (!aim(event)) return;
      const picked = classify(visibleHits(scene, layer), event.altKey);
      const actions = latestActions.current;
      if (!picked) {
        actions.clearPoint();
        return;
      }
      if (picked.kind === "instance") {
        actions.editInstance(picked.groupId, picked.id, picked);
        return;
      }
      if (picked.kind === "place") {
        actions.editPlace(picked.info, picked.spot, picked.mesh, picked.instanceId);
        return;
      }
      if (picked.kind === "other") {
        setMessage({
          kind: "error",
          text: `이 물체는 편집 경로가 없습니다 — ${describeOther(picked.name)}. (Alt+클릭 = 그 위를 자리로 고르기)`,
        });
        return;
      }
      const { hit } = picked;
      const x = round3(hit.point.x * METERS_PER_UNIT);
      const y = round3(hit.point.y * METERS_PER_UNIT);
      const z = round3(hit.point.z * METERS_PER_UNIT);
      const zoneId = zoneForPoint(x, z, latest.current.groundAt(x, z)?.zone, null);
      layer.showMarker({ x, y, z });
      setPoint({ x, y, z, zoneId, surface: classifyReviewSurface(hit.object.name) || hit.object.name || "object" });
    };
    const onCancelPointer = () => {
      down = null;
    };

    const stop = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    // capture 단계 — 게임 단축키(V·T·숫자 순간이동 등)와 걷기보다 먼저 받는다. E·H 만 게임으로 보낸다.
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      const actions = latestActions.current;
      // 서랍의 글 입력칸(검색·숫자·메모): 글자는 그대로 들어가고 게임에는 안 샌다. Esc 는 입력칸에서 나오기.
      //   단추·체크 상자에 초점이 있을 때는 아래 편집 키가 그대로 먹는다(단추를 누른 뒤 곧바로 G·R·Enter).
      if (target?.closest?.(`[${LIBRARY_DRAWER_ATTR}]`) && target.closest(TEXT_ENTRY)) {
        if (event.code === "Escape") (target as HTMLElement).blur?.();
        event.stopImmediatePropagation();
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        const handled: Record<string, () => void> = {
          KeyZ: () => void actions.sessionUndo(),
          KeyS: () => void actions.saveNow(),
          KeyC: actions.copy,
          KeyV: actions.paste,
        };
        // event.code 가 비는 경우(일부 입력기·원격 조작)와 한글 자판 글자(ㅊ·ㅍ·ㅋ·ㄴ)도 같은 키로 본다(10/20)
        const byKey: Record<string, string> = { c: "KeyC", v: "KeyV", z: "KeyZ", s: "KeyS", ㅊ: "KeyC", ㅍ: "KeyV", ㅋ: "KeyZ", ㄴ: "KeyS" };
        const code = event.code || byKey[(event.key || "").toLowerCase()] || "";
        const run = event.shiftKey ? undefined : handled[code];
        if (run) {
          stop(event);
          if (!event.repeat) run();
        }
        return;
      }
      if (event.altKey) return;
      if (PASS_CODES.has(event.code)) return;
      if (event.code === "Tab") {
        stop(event);
        if (!event.repeat) actions.toggleOverview();
        return;
      }
      if (event.code === "KeyL") {
        stop(event);
        if (!event.repeat) setCollapsed((value) => !value);
        return;
      }
      if (layer.hasDraft() && !latest.current.saving) {
        if (["Delete", "Backspace", "KeyX"].includes(event.code)) {
          stop(event);
          if (!event.repeat) void actions.remove();
          return;
        }
        // 회전은 , . 와 서랍 숫자 칸으로만(10/15 미르: R 손잡이 불필요) — R 은 먹고 버린다
        if (event.code === "KeyR") {
          stop(event);
          return;
        }
        const result = layer.handleKey(event.code, event.shiftKey);
        if (result) {
          stop(event);
          if (result === "commit") void actions.commit();
          else if (result === "cancel") actions.cancelDraft();
          else actions.syncDraft();
          return;
        }
      }
      if (event.code === "Escape") {
        stop(event);
        if (layer.loading || layer.hasDraft()) actions.cancelDraft();
        else if (latest.current.point) actions.clearPoint();
        else setMessage({ kind: "info", text: "편집을 끝내려면 E" });
        return;
      }
      if (FLY_CODES.has(event.code)) {
        keys.add(event.code);
        stop(event);
        return;
      }
      // 나머지 키도 편집 모드 동안은 게임으로 보내지 않는다
      stop(event);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.code);
    };
    const onBlur = () => keys.clear();

    dom.addEventListener("wheel", onWheel, { passive: false });
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("pointercancel", onCancelPointer);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointercancel", onCancelPointer);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      keys.clear();
      holdRef.current?.release();
      holdRef.current = null;
      layer.dispose();
      freeCamera.dispose();
      layerRef.current = null;
      targetRef.current = null;
      // 걷기로 돌아갈 때: 고개는 수평으로, 눈높이는 그 자리 땅 위로 — 높이 떠 있던 채로 넘기면 낙하복귀가 사람을 옮긴다
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
      camera.rotation.set(0, euler.y, 0, "YXZ");
      const x = camera.position.x * METERS_PER_UNIT;
      const z = camera.position.z * METERS_PER_UNIT;
      const ground = latest.current.groundAt(x, z);
      if (ground && Number.isFinite(ground.y)) camera.position.y = (ground.y + BASELINE.eyeHeight) * U;
      camera.updateMatrixWorld();
    };
  }, [scene, camera, gl]);

  // 편집기로 놓은 항목 수(되돌리기 단추) — 켤 때 한 번
  useEffect(() => {
    let alive = true;
    fetchEditorEntries().then(
      (value) => alive && setEditorCount(value.entries.length),
      () => alive && setEditorCount(null),
    );
    return () => {
      alive = false;
    };
  }, []);

  // 날기(WASD · Space/C · 방향키) + 손잡이로 바뀐 초안을 서랍에(최대 10회/초)
  useFrame((_, rawDelta) => {
    const keys = flyKeys.current;
    if (keys.size) {
      const dt = Math.min(rawDelta, 0.1);
      const speed = FLY_SPEED_MPS * U * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 3 : 1) * dt;
      const forward = camera.getWorldDirection(_fly).setY(0);
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
      forward.normalize();
      _right.crossVectors(forward, camera.up).normalize();
      _move.set(0, 0, 0);
      if (keys.has("KeyW")) _move.add(forward);
      if (keys.has("KeyS")) _move.sub(forward);
      if (keys.has("KeyD") || keys.has("ArrowRight")) _move.add(_right);
      if (keys.has("KeyA") || keys.has("ArrowLeft")) _move.sub(_right);
      if (keys.has("Space") || keys.has("ArrowUp")) _move.y += 1;
      if (keys.has("KeyC") || keys.has("ArrowDown")) _move.y -= 1;
      if (_move.lengthSq() > 0) {
        camera.position.addScaledVector(_move.normalize(), speed);
        camera.updateMatrixWorld();
      }
    }
    clampCameraXZ(camera); // 씬 고립 중이면 경계 밖으로 못 나간다
    maintainIsolation(scene);
    const changed = layerRef.current?.takeChanged(performance.now());
    if (changed) setDraft(changed);
  });

  // ── 씬(공간) 고립 — 고른 씬 경계 밖은 안 그리고·못 가고·못 집는다(review/sceneIsolation) ──
  const chooseScene = useCallback(
    (key: IsolationKey, moveCamera = true) => {
      const target = isolationTargetFor(key);
      editScene = target ? key : "";
      setSceneNo(editScene);
      isolate(gl, target?.bounds ?? null);
      if (!target) {
        setMessage({ kind: "info", text: "전체 보기 — 고립을 풀었습니다." });
        return;
      }
      // 경계 밖에 걸린 초안·자리는 치운다
      const draftNow = layerRef.current?.read();
      if (draftNow && !isInsideActive(_pos.set(draftNow.position.x * U, 0, draftNow.position.z * U))) cancelDraft();
      const pointNow = latest.current.point;
      if (pointNow && !isInsideActive(_pos.set(pointNow.x * U, 0, pointNow.z * U))) clearPoint();
      const view = reviewViews.find((item) => item.id === `${target.startZone}-wide`);
      if (moveCamera && view) {
        if (latest.current.overview) latest.current.setOverview?.(false);
        camera.position.fromArray(view.position);
        camera.lookAt(...view.target);
        camera.updateMatrixWorld(true);
      }
      clampCameraXZ(camera);
      setMessage({
        kind: "info",
        text: `${target.label}만 보입니다 — 경계(+${ISOLATION_MARGIN_M} m) 밖은 그리지 않고 넘어가지 않습니다.`,
      });
    },
    [camera, cancelDraft, clearPoint, gl],
  );
  const chooseSceneRef = useRef(chooseScene);
  useLayoutEffect(() => {
    chooseSceneRef.current = chooseScene;
  });
  // 편집 모드에 들어올 때 지난번 씬을 다시 걸고(카메라는 그대로), 나갈 때 고립을 푼다
  useEffect(() => {
    if (editScene) chooseSceneRef.current(editScene, false);
    return () => isolate(gl, null);
  }, [gl]);

  // ── 서랍(DOM) — <Canvas> 안이라 따로 만든 React 뿌리에 그린다 ─────────────
  const rootRef = useRef<Root | null>(null);
  useEffect(() => {
    const host = document.createElement("div");
    host.className = "naju-lib-host";
    document.body.appendChild(host);
    const root = createRoot(host);
    rootRef.current = root;
    return () => {
      rootRef.current = null;
      // 그리는 도중 내리면 React 가 경고한다 — 한 박자 뒤에
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
    };
  }, []);
  useEffect(() => {
    rootRef.current?.render(
      <LibraryDrawer
        point={point}
        draft={draft}
        target={targetView}
        mode={mode}
        loading={loading}
        saving={saving}
        message={message}
        editorCount={editorCount}
        undoCount={undoCount}
        overview={overview}
        collapsed={collapsed}
        libraryAvailable={libraryAvailable}
        sceneNo={sceneNo}
        onScene={chooseScene}
        note={note}
        onNote={setNote}
        onPick={startDraft}
        onAdjust={adjust}
        onCancel={cancelDraft}
        onCommit={() => void commit()}
        onRemove={() => void remove()}
        onUndo={() => void undoLastEditorPlace()}
        onSessionUndo={() => void sessionUndo()}
        onClearPoint={clearPoint}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        onExit={onExit}
      />,
    );
  }, [
    point,
    draft,
    targetView,
    mode,
    loading,
    saving,
    message,
    editorCount,
    undoCount,
    overview,
    collapsed,
    libraryAvailable,
    note,
    startDraft,
    adjust,
    cancelDraft,
    commit,
    remove,
    undoLastEditorPlace,
    sessionUndo,
    clearPoint,
    onExit,
    sceneNo,
    chooseScene,
  ]);

  return null;
}
