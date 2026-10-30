/**
 * placementLayer.ts — 검수 둘러보기 안의 「배치 초안 · 변경안 미리보기 · 빈 자리 표시」 층 (10/15)
 *   검수_배치편집_프로토콜_1015 §1 의 place-start/adjust/cancel/commit · proposals 를 게임 화면에 그린다.
 *   ReviewBridge 가 둘러보기(진단 실행)에서만 만들고, 둘러보기를 끄거나 화면을 내리면 dispose 로 모두 치운다.
 *
 * [단위] 바깥(메시지)은 미터·도, 안(장면)은 유닛(1 m = UNITS_PER_METER). 초안 뿌리의 scale = U × 배율.
 * [크기] GLB 의 원래 크기(1 = 1 m)를 그대로 쓴다 — 라이브러리 기준 크기. 배율(scale)만 곱한다.
 *   게임 manifest 「놓기」는 키m 로 맞추므로, 공간 승인 때 서버가 「원래 키 × 배율」을 키m 로 적어야 같은 크기다.
 * [모양] 공개 에셋과 같은 납작하게(flattenGltf) + 툰 재질 — 게임 안에서 보일 모습 그대로.
 * [높이] 초안은 「땅 위 높이(offset)」를 들고 다닌다. X·Z 로 옮기면 그 자리 땅 높이 + offset 로 따라 앉고,
 *   Y 손잡이·높이 키·position.y 로 offset 을 바꾼다.
 * [변경안 고치기 · 규약 §6] startEdit(변경안) = 그 변경안의 에셋·자리·회전·크기로 초안을 만들고(draft.replaces = 그 id)
 *   미리보기 메시는 숨긴다. 취소하면 되살리고, 확정 뒤에는 새 목록에서 그 변경안이 철회로 빠질 때까지 숨겨 둔다.
 *   groundSnap(또는 y 없음) 변경안은 그 자리 땅 높이에 세운다.
 * [이미 놓인 에셋 고치기 · 5174 통합 편집 모드] startProxy = 에셋을 다시 읽지 않고 노란 테두리 상자(유령)를 초안으로 세운다.
 *   손잡이·키·숫자 조정은 보통 초안과 같고, 확정은 부르는 쪽(placement/LibraryPlaceMode)이 그 에셋의 저장 경로로 한다.
 */
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

import { TOON_GRADIENT } from "@/engine/toon";

import { createCompressedGltfLoader } from "../loaders/compressedGlb";
import { bundleBox, flattenGltf, type Bundle } from "../loaders/publicAssetGeometry";
import { METERS_PER_UNIT, UNITS_PER_METER } from "../plan/sitePlan";
import { PLACEMENT_SCALE_RANGE, type PlacementAsset, type PlacementProposal, type ReviewPointM } from "./reviewPolicy";
import { clampToBounds, type SceneScope } from "./sceneScope";

const U = UNITS_PER_METER;
const LOAD_TIMEOUT_MS = 20000;
/** place-changed 를 최대 10회/초 */
const POST_INTERVAL_MS = 100;
const DEG = Math.PI / 180;
const PROPOSAL_TINT = new THREE.Color("#3d7bff");
const APPLIED_TINT = new THREE.Color("#46c08a");
const PENDING_TINT = new THREE.Color("#ffb347");

/** 프로토콜의 draft — 미터·도 */
export interface PlacementDraft {
  /** 규약 §5-3 — 이 층의 초안은 모두 「추가」(변경안 고치기도 새 변경안 추가 + 옛 것 철회) */
  kind: "add";
  /** 변경안 고치기면 고치는 변경안 id, 새 배치면 null */
  replaces: string | null;
  assetId: string;
  url: string;
  nameKo: string;
  position: ReviewPointM;
  rotationY: number;
  scale: number;
  zoneId: string | null;
  groundY: number;
}
export type DraftMode = "move" | "rotate";
export type DraftKeyResult = "changed" | "commit" | "cancel" | null;

/** ReviewBridge 가 넘기는 연결 */
export interface PlacementHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  dom: HTMLElement;
  /** 미터 → 땅 높이(m)·구역 */
  groundAt(x: number, z: number): { y: number; zone?: string | null } | null | undefined;
  zoneAt(x: number, z: number, groundZone: string | null | undefined): string | null;
  /** 씬 탭으로 묶였으면 그 경계(m) */
  bounds(): SceneScope["bounds"] | null;
  /** 손잡이를 끄는 동안 true — 둘러보기 카메라를 멈춘다 */
  onDragging(active: boolean): void;
}

interface DraftState {
  asset: PlacementAsset;
  root: THREE.Group;
  /** 땅 위 높이(m) */
  offset: number;
  scale: number;
  /** 마지막으로 읽은 땅 높이(m) — 땅 판정이 비는 자리에서 쓴다 */
  ground: number;
  /** 변경안 고치기면 그 변경안 id */
  replaces: string | null;
  /** startProxy 로 세운 테두리 유령 — 치울 때 기하·재질을 같이 버린다 */
  proxy?: boolean;
}

/** startProxy 의 테두리 상자 — 뿌리 기준 국소 상자(m, 배율 1 일 때) */
export interface ProxyBox {
  size: [number, number, number];
  center: [number, number, number];
}
const PROXY_COLOR = "#FFD166";

export interface ProposalHit {
  id: string;
  nameKo: string;
  root: THREE.Object3D;
}

const round = (value: number, step = 1000) => Math.round(value * step) / step;
const normalizeDeg = (deg: number) => ((deg % 360) + 360) % 360;
const clampScale = (scale: number) => Math.min(PLACEMENT_SCALE_RANGE[1], Math.max(PLACEMENT_SCALE_RANGE[0], scale));

/** 라이브러리 url → 같은 출처 주소. 상대 경로는 게임 BASE_URL 기준(공개 에셋 `_sf_local/` 과 같은 뿌리) */
export function resolveAssetUrl(url: string): string {
  const path = url.startsWith("/") ? url : `${import.meta.env.BASE_URL}${url}`;
  const resolved = new URL(path, location.href);
  if (resolved.origin !== location.origin) throw new Error("같은 출처의 에셋만 불러올 수 있습니다.");
  return resolved.href;
}

type MapMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  color?: THREE.Color;
  vertexColors?: boolean;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
};

/** 툰이 아닌 재질(텍스처판)은 공개 에셋 「툰질감」처럼 텍스처는 살리고 빛만 툰 계단으로 */
function toonize(bundle: Bundle) {
  for (const part of bundle) {
    const source = part.material as MapMaterial;
    if ((source as THREE.MeshToonMaterial).isMeshToonMaterial) continue;
    part.material = new THREE.MeshToonMaterial({
      name: source.name,
      map: source.map ?? null,
      color: source.color,
      gradientMap: TOON_GRADIENT,
      side: THREE.DoubleSide,
      alphaTest: source.alphaTest || (source.transparent ? 0.5 : 0),
      vertexColors: source.vertexColors,
    });
    source.dispose();
  }
}

function disposeBundle(bundle: Bundle) {
  for (const { geometry, material } of bundle) {
    geometry.dispose();
    const map = (material as MapMaterial).map;
    // 툰 계단 텍스처는 게임 전체가 같이 쓴다 — 지우지 않는다
    if (map && map !== TOON_GRADIENT) map.dispose();
    material.dispose();
  }
}

/** 노드와 조상 중 userData[key] 가 있는 첫 노드 */
function findTagged(object: THREE.Object3D | null, key: string): THREE.Object3D | null {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node.userData[key]) return node;
  return null;
}

export class PlacementLayer {
  private readonly cache = new Map<string, Promise<Bundle>>();
  private readonly loader = createCompressedGltfLoader();
  private readonly proposals = new THREE.Group();
  private readonly ownedMaterials = new Set<THREE.Material>();
  private gizmo: TransformControls | null = null;
  private draft: DraftState | null = null;
  private mode: DraftMode = "move";
  private generation = 0;
  private proposalGeneration = 0;
  private pendingSerial = 0;
  private marker: THREE.Mesh | null = null;
  /** 마지막 변경안 목록 · 그려 둔 미리보기(id → 뿌리·테두리) */
  private proposalList: readonly PlacementProposal[] = [];
  private readonly proposalViews = new Map<string, THREE.Object3D[]>();
  /** 고치는 중(또는 확정 뒤 새 목록을 기다리는) 변경안 — 미리보기를 숨긴다 */
  private hiddenProposalId: string | null = null;
  private dirty = false;
  private lastPostAt = 0;
  private disposed = false;
  /** 이번 누름이 손잡이를 잡았다 — 짧은 클릭 선택을 건너뛴다 */
  gizmoPressed = false;
  loading = false;

  constructor(private readonly host: PlacementHost) {
    this.proposals.name = "review.proposals";
    host.scene.add(this.proposals);
  }

  // ── 불러오기 ────────────────────────────────────────────────────────
  private load(url: string): Promise<Bundle> {
    const cached = this.cache.get(url);
    if (cached) return cached;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("에셋을 불러오는 시간이 초과되었습니다.")), LOAD_TIMEOUT_MS);
    });
    const promise = Promise.race([
      this.loader.loadAsync(resolveAssetUrl(url)).then((gltf) => {
        const bundle = flattenGltf(gltf);
        if (!bundle.length) throw new Error("표시할 메시가 없는 에셋입니다.");
        toonize(bundle);
        // 밑면 가운데를 원점에 — 뿌리 위치가 곧 「땅에 닿는 자리」
        const box = bundleBox(bundle);
        const center = box.getCenter(new THREE.Vector3());
        for (const { geometry } of bundle) {
          geometry.translate(-center.x, -box.min.y, -center.z);
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();
        }
        return bundle;
      }),
      timeout,
    ]).finally(() => clearTimeout(timer));
    // 실패는 캐시에 남기지 않는다(다시 시도할 수 있게)
    promise.catch(() => {
      if (this.cache.get(url) === promise) this.cache.delete(url);
    });
    this.cache.set(url, promise);
    return promise;
  }

  private buildRoot(
    bundle: Bundle,
    name: string,
    tag: string,
    data: unknown,
    material?: (m: THREE.Material) => THREE.Material,
  ) {
    const root = new THREE.Group();
    root.name = name;
    root.userData[tag] = data;
    for (const part of bundle) {
      const mesh = new THREE.Mesh(part.geometry, material ? material(part.material) : part.material);
      mesh.name = name;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData[tag] = data;
      root.add(mesh);
    }
    return root;
  }

  // ── 초안 ────────────────────────────────────────────────────────────
  hasDraft() {
    return Boolean(this.draft);
  }
  draftSummary(): { nameKo: string; mode: DraftMode } | null {
    return this.draft ? { nameKo: this.draft.asset.nameKo, mode: this.mode } : null;
  }

  /**
   * 새 초안. options.replaces = 고치는 변경안 id(그 미리보기를 숨긴다) · options.keepY = at.y 높이 그대로(아니면 땅에 세움)
   */
  async startDraft(
    asset: PlacementAsset,
    at: ReviewPointM,
    rotationY = 0,
    scale = 1,
    options: { replaces?: string | null; keepY?: boolean } = {},
  ): Promise<PlacementDraft> {
    this.cancel();
    const generation = ++this.generation;
    this.loading = true;
    const replaces = options.replaces ?? null;
    if (replaces) this.hideProposal(replaces);
    try {
      const bundle = await this.load(asset.url);
      if (generation !== this.generation || this.disposed) throw new Error("다른 배치 초안으로 바뀌었습니다.");
      const root = this.buildRoot(bundle, `review-draft:${asset.id}`, "reviewDraft", true);
      const s = clampScale(scale);
      root.rotation.y = normalizeDeg(rotationY) * DEG;
      root.scale.setScalar(U * s);
      this.host.scene.add(root);
      this.draft = { asset, root, offset: 0, scale: s, ground: at.y, replaces };
      // 땅 높이에 세운다(offset 0) — 땅 판정이 비는 자리면 at.y 를 땅으로 본다. 고치기는 저장된 높이 그대로
      this.place(at.x, options.keepY ? at.y : null, at.z);
      this.attachGizmo();
      this.setMode("move");
      return this.read()!;
    } catch (error) {
      if (generation === this.generation && replaces) this.showHiddenProposal();
      throw error;
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  /**
   * 이미 놓인 에셋 고치기 — 노란 테두리 상자 + 앞쪽 코(돌린 방향이 보이게)를 초안으로. 높이는 at.y 그대로(땅 위 높이 유지).
   */
  startProxy(
    meta: { id: string; nameKo: string },
    at: ReviewPointM,
    rotationY: number,
    box: ProxyBox,
    /** 뿌리를 자리에 세운 뒤 — 진짜 모양 유령 붙이기(editHold). 붙인 것은 기하·재질을 빌려 쓰면 userData.borrowedResources */
    decorate?: (root: THREE.Group) => void,
  ): PlacementDraft {
    this.cancel();
    this.generation += 1;
    const root = new THREE.Group();
    root.name = `review-draft:${meta.id}`;
    root.userData.reviewDraft = true;
    const [sx, sy, sz] = box.size.map((v) => Math.max(v, 0.05) * 1.06);
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sy, sz)),
      new THREE.LineBasicMaterial({ color: PROXY_COLOR, depthTest: false, toneMapped: false }),
    );
    frame.position.set(...box.center);
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.7, 4),
      new THREE.MeshBasicMaterial({ color: PROXY_COLOR, depthTest: false, toneMapped: false }),
    );
    nose.position.set(box.center[0], box.center[1], box.center[2] - (sz * 0.5 + 0.35));
    nose.rotation.x = Math.PI / 2;
    for (const part of [frame, nose]) {
      part.renderOrder = 999;
      part.userData.reviewDraft = true;
      root.add(part);
    }
    root.rotation.y = normalizeDeg(rotationY) * DEG;
    root.scale.setScalar(U);
    this.host.scene.add(root);
    this.draft = {
      asset: { id: meta.id, url: "", nameKo: meta.nameKo },
      root,
      offset: 0,
      scale: 1,
      ground: at.y,
      replaces: null,
      proxy: true,
    };
    this.place(at.x, at.y, at.z);
    root.updateMatrixWorld(true);
    decorate?.(root);
    this.attachGizmo();
    this.setMode("move");
    return this.read()!;
  }

  /** 마지막 목록에서 변경안 하나 */
  findProposal(id: string): PlacementProposal | null {
    return this.proposalList.find((proposal) => proposal.id === id) ?? null;
  }

  /** 변경안의 실제 자리(m) — groundSnap(또는 y 없음)이면 그 자리 땅 높이 */
  proposalPoint(proposal: PlacementProposal): ReviewPointM {
    const { x, z } = proposal.position;
    const y = proposal.position.y;
    if (!proposal.groundSnap && typeof y === "number" && Number.isFinite(y)) return { x, y, z };
    const sample = this.host.groundAt(x, z);
    return { x, y: sample && Number.isFinite(sample.y) ? sample.y : 0, z };
  }

  /** 변경안 고치기 — 그 변경안의 에셋·자리·회전·크기로 초안을 만들고 미리보기는 숨긴다(규약 §6-2) */
  startEdit(proposal: PlacementProposal): Promise<PlacementDraft> {
    return this.startDraft(proposal.asset, this.proposalPoint(proposal), proposal.rotationY, proposal.scale, {
      replaces: proposal.id,
      keepY: true,
    });
  }

  private hideProposal(id: string) {
    if (this.hiddenProposalId && this.hiddenProposalId !== id) this.showHiddenProposal();
    this.hiddenProposalId = id;
    for (const node of this.proposalViews.get(id) ?? []) node.visible = false;
  }
  private showHiddenProposal() {
    const id = this.hiddenProposalId;
    this.hiddenProposalId = null;
    if (id) for (const node of this.proposalViews.get(id) ?? []) node.visible = true;
  }

  private groundY(x: number, z: number): { y: number; zone: string | null } {
    const sample = this.host.groundAt(x, z);
    const y = sample && Number.isFinite(sample.y) ? sample.y : (this.draft?.ground ?? 0);
    return { y, zone: sample?.zone ?? null };
  }

  /** 미터로 옮긴다. y 를 주면 땅 위 높이를 그만큼으로, 안 주면 지금 땅 위 높이를 지킨다 */
  private place(x: number, y: number | null, z: number) {
    const d = this.draft;
    if (!d) return;
    const bounds = this.host.bounds();
    const [cx, cz] = bounds ? clampToBounds(bounds, x, z) : [x, z];
    const ground = this.groundY(cx, cz).y;
    d.ground = ground;
    if (y != null) d.offset = y - ground;
    d.root.position.set(cx * U, (ground + d.offset) * U, cz * U);
    d.root.updateMatrixWorld(true);
    this.dirty = true;
  }

  read(): PlacementDraft | null {
    const d = this.draft;
    if (!d) return null;
    const x = d.root.position.x * METERS_PER_UNIT;
    const y = d.root.position.y * METERS_PER_UNIT;
    const z = d.root.position.z * METERS_PER_UNIT;
    const ground = this.groundY(x, z);
    return {
      kind: "add",
      replaces: d.replaces,
      assetId: d.asset.id,
      url: d.asset.url,
      nameKo: d.asset.nameKo,
      position: { x: round(x), y: round(y), z: round(z) },
      rotationY: round(normalizeDeg(d.root.rotation.y / DEG), 10),
      scale: round(d.scale),
      zoneId: this.host.zoneAt(x, z, ground.zone),
      groundY: round(ground.y),
    };
  }

  private attachGizmo() {
    if (!this.draft) return;
    if (!this.gizmo) {
      const gizmo = new TransformControls(this.host.camera, this.host.dom);
      gizmo.setSpace("world");
      gizmo.setSize(0.9);
      gizmo.addEventListener("dragging-changed", (event) => {
        const active = Boolean(event.value);
        if (active) this.gizmoPressed = true;
        this.host.onDragging(active);
        if (!active) this.dirty = true;
      });
      gizmo.addEventListener("objectChange", this.onGizmoChange);
      const helper = gizmo.getHelper();
      helper.name = "review.gizmo";
      // 짧은 클릭 선택(pickObject)이 손잡이를 물체로 집지 않게
      helper.traverse((node) => {
        node.userData.reviewSelection = true;
      });
      this.host.scene.add(helper);
      this.gizmo = gizmo;
    }
    this.gizmo.attach(this.draft.root);
  }

  private readonly onGizmoChange = () => {
    const d = this.draft;
    const gizmo = this.gizmo;
    if (!d || !gizmo) return;
    if (gizmo.mode === "rotate") {
      // Y 축만 — 혹시 다른 축 값이 섞이면 지운다
      d.root.rotation.x = 0;
      d.root.rotation.z = 0;
      d.root.updateMatrixWorld(true);
      this.dirty = true;
      return;
    }
    const x = d.root.position.x * METERS_PER_UNIT;
    const y = d.root.position.y * METERS_PER_UNIT;
    const z = d.root.position.z * METERS_PER_UNIT;
    // Y 가 든 손잡이(Y · XY · YZ · XYZ)면 높이를 바꾼 것, 아니면 땅을 따라 앉힌다
    this.place(x, gizmo.axis?.includes("Y") ? y : null, z);
  };

  setMode(mode: DraftMode) {
    this.mode = mode;
    const gizmo = this.gizmo;
    if (!gizmo) return;
    gizmo.setMode(mode === "rotate" ? "rotate" : "translate");
    gizmo.showX = mode !== "rotate";
    gizmo.showZ = mode !== "rotate";
    gizmo.showY = true;
  }

  adjust(change: { position?: ReviewPointM; rotationY?: number; scale?: number; mode?: DraftMode }) {
    const d = this.draft;
    if (!d) return;
    if (change.position) this.place(change.position.x, change.position.y, change.position.z);
    if (change.rotationY !== undefined) {
      d.root.rotation.set(0, normalizeDeg(change.rotationY) * DEG, 0);
      this.dirty = true;
    }
    if (change.scale !== undefined) {
      d.scale = clampScale(change.scale);
      d.root.scale.setScalar(U * d.scale);
      this.dirty = true;
    }
    if (change.mode) this.setMode(change.mode);
    d.root.updateMatrixWorld(true);
  }

  /** 초안이 있을 때 키 하나 — 쓴 키면 결과, 아니면 null */
  handleKey(code: string, shift: boolean): DraftKeyResult {
    const d = this.draft;
    if (!d || this.loading) return null;
    const x = d.root.position.x * METERS_PER_UNIT;
    const z = d.root.position.z * METERS_PER_UNIT;
    switch (code) {
      case "KeyG":
        this.setMode("move");
        return "changed";
      case "KeyR":
        this.setMode("rotate");
        return "changed";
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight": {
        // 화면 기준 앞·뒤·좌·우를 가장 가까운 세계 축(X·Z)으로 맞춰 10 cm(Shift 1 m)
        const forward = this.host.camera.getWorldDirection(new THREE.Vector3());
        let vx = forward.x;
        let vz = forward.z;
        if (code === "ArrowDown") [vx, vz] = [-vx, -vz];
        else if (code === "ArrowRight") [vx, vz] = [-forward.z, forward.x];
        else if (code === "ArrowLeft") [vx, vz] = [forward.z, -forward.x];
        const step = shift ? 1 : 0.1;
        if (Math.abs(vx) >= Math.abs(vz)) this.place(x + Math.sign(vx || 1) * step, null, z);
        else this.place(x, null, z + Math.sign(vz) * step);
        return "changed";
      }
      // [ ] = 크기(10/20 미르: 「높낮이는 따로 할 필요 없다 — 예전처럼 크기 업다운」) — 한 번에 ×1.1 / ×0.9
      case "BracketRight":
      case "BracketLeft":
        this.adjust({ scale: d.scale * (code === "BracketRight" ? 1.1 : 0.9) });
        return "changed";
      // 높이는 PageUp / PageDown 으로만
      case "PageUp":
      case "PageDown": {
        const up = code === "PageUp";
        const step = (shift ? 0.5 : 0.05) * (up ? 1 : -1);
        this.place(x, d.ground + d.offset + step, z);
        return "changed";
      }
      case "Comma":
      case "Period":
        this.adjust({
          rotationY: d.root.rotation.y / DEG + (shift ? 15 : 5) * (code === "Period" ? 1 : -1),
        });
        return "changed";
      case "Enter":
      case "NumpadEnter":
        return "commit";
      case "Escape":
        return "cancel";
      default:
        return null;
    }
  }

  /** 손잡이·키로 바뀐 초안 — 0.1 초에 한 번까지만 */
  takeChanged(now: number): PlacementDraft | null {
    if (!this.dirty || !this.draft || this.loading || now - this.lastPostAt < POST_INTERVAL_MS) return null;
    this.markPosted(now);
    return this.read();
  }
  markPosted(now: number) {
    this.dirty = false;
    this.lastPostAt = now;
  }

  isGizmoBusy() {
    return Boolean(this.gizmoPressed || this.gizmo?.dragging || (this.draft && this.gizmo?.axis));
  }

  /** 초안 취소 — 고치던 변경안이면(또는 확정 뒤 저장이 실패해 취소하면) 그 미리보기를 되살린다 */
  cancel() {
    this.generation += 1;
    this.loading = false;
    this.gizmo?.detach();
    if (this.draft) {
      this.draft.root.removeFromParent();
      if (this.draft.proxy)
        this.draft.root.traverse((node) => {
          // 게임 것을 빌린 기하·재질 — 버리지 않는다(유령 InstancedMesh 제 행렬 버퍼만 놓는다)
          if (node.userData.borrowedResources) return void (node as THREE.InstancedMesh).dispose?.();
          const part = node as THREE.Mesh;
          part.geometry?.dispose();
          (part.material as THREE.Material | undefined)?.dispose?.();
        });
      this.draft = null;
    }
    this.showHiddenProposal();
    this.dirty = false;
  }

  /** 초안을 굳혀 「확정 대기」 미리보기로(손잡이 제거). 다음 proposals 목록이 오면 그 목록으로 바뀐다 */
  commit(): PlacementDraft | null {
    const d = this.draft;
    const result = this.read();
    if (!d || !result) return null;
    this.gizmo?.detach();
    d.root.removeFromParent();
    this.draft = null;
    this.dirty = false;
    const id = `pending-${++this.pendingSerial}`;
    const data = { id, nameKo: d.asset.nameKo, status: "pending" };
    const frozen = new THREE.Group();
    frozen.name = `review-proposal:${id}`;
    frozen.userData.reviewProposal = data;
    for (const child of [...d.root.children]) {
      const mesh = child as THREE.Mesh;
      mesh.material = this.tinted(mesh.material as THREE.Material, PENDING_TINT);
      mesh.name = frozen.name;
      delete mesh.userData.reviewDraft;
      mesh.userData.reviewProposal = data;
      frozen.add(mesh);
    }
    frozen.position.copy(d.root.position);
    frozen.rotation.copy(d.root.rotation);
    frozen.scale.copy(d.root.scale);
    this.addFrame(frozen, PENDING_TINT);
    return result;
  }

  // ── 변경안 미리보기 ───────────────────────────────────────────────────
  private tinted(material: THREE.Material, tint: THREE.Color): THREE.Material {
    const clone = material.clone() as MapMaterial;
    if (clone.emissive instanceof THREE.Color) {
      clone.emissive.copy(tint);
      clone.emissiveIntensity = 0.32;
    } else clone.color?.lerp(tint, 0.3);
    this.ownedMaterials.add(clone);
    return clone;
  }

  /** 미리보기 하나를 층에 넣고 테두리 상자를 두른다(셰이더 없이 「변경안」 표시) */
  private addFrame(root: THREE.Object3D, tint: THREE.Color, id?: string) {
    this.proposals.add(root);
    root.updateMatrixWorld(true);
    const frame = new THREE.Box3Helper(new THREE.Box3().setFromObject(root), tint);
    frame.userData.reviewSelection = true;
    frame.userData.reviewFrameOf = root.uuid;
    this.proposals.add(frame);
    if (id) {
      this.proposalViews.set(id, [root, frame]);
      if (id === this.hiddenProposalId) root.visible = frame.visible = false;
    }
  }

  private clearProposals() {
    for (const child of [...this.proposals.children]) {
      child.removeFromParent();
      if ((child as THREE.Box3Helper).isLineSegments) {
        (child as THREE.Box3Helper).geometry.dispose();
        ((child as THREE.Box3Helper).material as THREE.Material).dispose();
      }
    }
    for (const material of this.ownedMaterials) material.dispose();
    this.ownedMaterials.clear();
    this.proposalViews.clear();
  }

  /** 목록 전체 교체 — withdrawn 은 숨긴다. 확정 대기(pending) 미리보기도 이 목록으로 바뀐다 */
  setProposals(list: readonly PlacementProposal[]) {
    const generation = ++this.proposalGeneration;
    this.clearProposals();
    this.proposalList = list;
    // 확정해 둔 고치기(초안 없음)는 새 목록에서 그 변경안이 제안 상태로 남아 있지 않으면 숨김을 푼다
    const hidden = this.hiddenProposalId;
    if (
      hidden &&
      !this.draft &&
      !this.loading &&
      !list.some((proposal) => proposal.id === hidden && proposal.status === "proposed")
    )
      this.hiddenProposalId = null;
    for (const proposal of list) {
      if (proposal.status === "withdrawn") continue;
      this.load(proposal.asset.url)
        .then((bundle) => {
          if (generation !== this.proposalGeneration || this.disposed) return;
          const tint = proposal.status === "applied" ? APPLIED_TINT : PROPOSAL_TINT;
          const data = { id: proposal.id, nameKo: proposal.asset.nameKo, status: proposal.status };
          const root = this.buildRoot(bundle, `review-proposal:${proposal.id}`, "reviewProposal", data, (m) =>
            this.tinted(m, tint),
          );
          // groundSnap(AI 초안 · y 없음)은 그 자리 땅 높이에 세운다
          const { x, y, z } = this.proposalPoint(proposal);
          root.position.set(x * U, y * U, z * U);
          root.rotation.y = normalizeDeg(proposal.rotationY) * DEG;
          root.scale.setScalar(U * clampScale(proposal.scale));
          this.addFrame(root, tint, proposal.id);
        })
        .catch((error: unknown) => console.warn("[review] 변경안 에셋을 못 읽음:", proposal.asset.url, error));
    }
  }

  /** 맞은 메시가 변경안이면 그 뿌리 */
  proposalOf(object: THREE.Object3D): ProposalHit | null {
    const node = findTagged(object, "reviewProposal");
    if (!node) return null;
    const data = node.userData.reviewProposal as { id: string; nameKo: string };
    let root: THREE.Object3D = node;
    while (root.parent && root.parent !== this.proposals) root = root.parent;
    return { id: data.id, nameKo: data.nameKo, root };
  }
  isDraftObject(object: THREE.Object3D) {
    return Boolean(findTagged(object, "reviewDraft"));
  }

  // ── 빈 자리 표시 ──────────────────────────────────────────────────────
  showMarker(point: ReviewPointM) {
    this.clearMarker();
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.32 * U, 0.48 * U, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: "#ffd166", transparent: true, opacity: 0.95, depthTest: false }),
    );
    marker.name = "review.pointMarker";
    marker.userData.reviewSelection = true;
    marker.renderOrder = 999;
    marker.position.set(point.x * U, (point.y + 0.05) * U, point.z * U);
    this.host.scene.add(marker);
    this.marker = marker;
  }
  clearMarker() {
    if (!this.marker) return;
    this.marker.removeFromParent();
    this.marker.geometry.dispose();
    (this.marker.material as THREE.Material).dispose();
    this.marker = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    if (this.gizmo) {
      this.gizmo.removeEventListener("objectChange", this.onGizmoChange);
      this.gizmo.getHelper().removeFromParent();
      this.gizmo.dispose();
      this.gizmo = null;
    }
    this.clearProposals();
    this.proposals.removeFromParent();
    this.clearMarker();
    for (const promise of this.cache.values()) promise.then(disposeBundle).catch(() => undefined);
    this.cache.clear();
  }
}
