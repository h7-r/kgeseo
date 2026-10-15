/* eslint-disable react-refresh/only-export-components -- 상수·훅을 컴포넌트와 한 파일에 둔다(옛 파일 구조 유지) */
/**
 * ReviewBridge.tsx — 로컬 검수 작업대(review/ · 5180)와 실제 나주 렌더를 잇는 선택형 연결 (옛 검수연결.jsx 이식)
 *   임의 클릭이나 개발용 씬 건너뛰기를 퍼즐 풀이로 기록하지 않는다.
 *   `?review=1` 이 없거나 배포 빌드면 리스너·통신·저장 변경이 전혀 없다(모든 export 가 조용히 null/false).
 *
 * [붙이는 자리]
 *   <ReviewBridge …/>      Canvas 안(useFrame · addAfterEffect). 걷기 훅 뒤(reportRef 를 읽는다).
 *   <ReviewHud />          Canvas 밖(DOM 패널, data-review-hud).
 *   <ReviewErrorBoundary>  main.tsx 에서 App 을 감싼다. IS_REVIEW_RUNNABLE 이 아니면 App 대신 <ReviewHud/> 만 띄운다.
 *   useReviewCameraHold()  씬이 걷기 훅의 paused 에 OR 로 섞는다(진단 시점 고정 중 걷기 정지).
 *
 * [옛 이름 → 새 이름]
 *   NJ검수프레임 → ReviewBridge(= ReviewFrame) · NJ검수판 → ReviewHud · NJ검수경계 → ReviewErrorBoundary
 *   검수요청있음 → IS_REVIEW_REQUESTED · 검수실행가능 → IS_REVIEW_RUNNABLE · useReviewCameraHold 그대로
 *   실행 → run · 공개프로필 → IS_PUBLIC_PROFILE · 삽입실행 → IS_EMBEDDED · 상태 → state · 알림 → notify
 *   대기 → queue · 전송 → flush · 묶음보내기 → sendBatch · 기록 → record · 모두전송 → flushAll · 예약 → schedule
 *   검수화면복귀 → returnToWorkbench · 전체화면전환 → toggleFullscreen · 카메라고정읽기 → readCameraHold
 *   시각환경 → frameEnv · 회전조작 → orbit · 선택상자 → selectionBox · 시각대기 → visualQueue · 시각작업 → visualJob
 *   시각요청 → onVisualRequest · 시각프레임 → visualFrame · 시각그림복사 → copyVisualFrame · 선택하기 → pickObject
 *   조작연결 → attachOrbit · 조작해제 → detachOrbit · 강조지우기 → clearHighlight · 선택비우기 → clearSelection
 *   공개에셋관측 → readPublicAssets · 방문키 → VISIT_KEY · 일련번호 → serial · 재시도수 → retries
 *   window.__NAJU.텔레포트/플레이어상태/지형.지면/치운차단물 → props teleport/playerState/terrain/clearedBlockers
 *     (안 넘기면 개발 훅 window.__game.naju 의 teleport/terrain/clearedBlockers 로 대신한다 — playerState 는 훅에 없다)
 *   window.__공개에셋상태 → publicAssetStatus(loaders/publicAssetManifest) import
 *   userData.무리이름/번호들/원본번호들 → userData.groupId/ids/publicAssetOriginal.ids · "AI허브:" 접두 → PUBLIC_ASSET_MESH_PREFIX
 *   보고.X/Z/EL/자리/거리/… → NajuSceneReport.x/z/elevation/placeName/distance/… (reviewPolicy 머리말)
 */
import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import * as THREE from "three";
import { addAfterEffect, useFrame } from "@react-three/fiber";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { PlayerMotionState } from "@/engine/movement/useMovement";

import { PUBLIC_ASSET_MESH_PREFIX } from "../loaders/publicAssetGeometry";
import { publicAssetStatus, type PublicAssetStatus } from "../loaders/publicAssetManifest";
import type { TerrainTeleport } from "../movement/useTerrainMovement";
import { METERS_PER_UNIT } from "../plan/sitePlan";
import type { NajuSceneReport } from "../scene/useSceneFrame";
import type { Terrain } from "../terrain/terrain";
import {
  identifyReviewObject,
  readReviewMetrics,
  readReviewUrl,
  readVisualRequest,
  reviewErrorText,
  reviewReturnMessage,
  shouldBlockKeyInReview,
  VISUAL_REQUEST_TYPES,
  type ReviewMetrics,
  type ReviewObjectIdentity,
  type ReviewView,
  type VisualRequest,
  type VisualRequestType,
} from "./reviewPolicy";
import reviewViewsJson from "./reviewViews.json";

const reviewViews = reviewViewsJson as ReviewView[];

const run = readReviewUrl(typeof location === "undefined" ? "" : location.href, import.meta.env.DEV);
const IS_PUBLIC_PROFILE = run?.runtimeProfile === "naju-public-sf-v1";
const IS_EMBEDDED = typeof window !== "undefined" && Boolean(window.parent && window.parent !== window);
/** 검수 주소로 열렸다(유효하지 않아도 true — HUD 가 오류를 보여 준다) */
export const IS_REVIEW_REQUESTED = Boolean(run);
/** 검수 주소가 유효해 게임을 띄워도 된다 */
export const IS_REVIEW_RUNNABLE = Boolean(run?.valid);

// ── 외부 저장소(useSyncExternalStore) ──────────────────────────────────────
interface PublicAssetSummary {
  source: "sf";
  phase: string;
  total: number;
  loaded: number;
  failed: number;
  appliedGroups: number;
}

interface SelectedObject extends ReviewObjectIdentity {
  position: number[];
  zoneId: string | null;
}

interface ReviewState {
  ready: boolean;
  saved: number;
  pending: number;
  error: string;
  blocked: string;
  metrics: ReviewMetrics | null;
  publicAssets: PublicAssetSummary | null;
  returning: boolean;
  flushing: boolean;
  quiescent: boolean;
  inspection: boolean;
  capturing: boolean;
  viewId: string | null;
  selected: SelectedObject | null;
}

const subscribers = new Set<() => void>();
let state: ReviewState = {
  ready: false,
  saved: 0,
  pending: 0,
  error: "",
  blocked: "",
  metrics: null,
  publicAssets: null,
  returning: false,
  flushing: false,
  quiescent: false,
  inspection: false,
  capturing: false,
  viewId: null,
  selected: null,
};

interface ReviewEvent {
  id: string;
  type: string;
  at: string;
  detail: Record<string, unknown>;
}

const queue: ReviewEvent[] = [];
let isSending = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let retries = 0;
let serial = 0;
let flushPromise: Promise<void> | null = null;
let flushAllPromise: Promise<{ ok: boolean; error?: string }> | null = null;
let stopAfterFlush = false;
let isClosed = false;
const listeners: [string, EventListener, boolean][] = [];
const VISIT_KEY = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());

function notify(patch: Partial<ReviewState>) {
  state = { ...state, ...patch };
  subscribers.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
function snapshot() {
  return state;
}
const readCameraHold = () =>
  Boolean(run?.valid && run.mode === "diagnostic" && (state.inspection || state.capturing || state.viewId));
/** 진단 실행에서 시점 고정·둘러보기·촬영 중이면 true — 씬이 걷기 훅의 paused 에 섞는다 */
export function useReviewCameraHold(): boolean {
  return useSyncExternalStore(subscribe, readCameraHold, () => false);
}

// ── 시각 점검(진단 실행) ──────────────────────────────────────────────────
/** useFrame 이 넘기는 것 중 쓰는 것만 — 검사 하네스가 부분 객체를 넘긴다 */
interface FrameEnv {
  clock: { elapsedTime: number };
  camera: THREE.Camera;
  scene: THREE.Scene;
  gl: { domElement: HTMLCanvasElement };
}

interface VisualJob {
  request: VisualRequest;
  view: ReviewView;
  timeout: ReturnType<typeof setTimeout>;
  start?: number;
  frames?: number;
  afterRender?: boolean;
}

/** 씬이 넘기는 연결 — 안 넘기면 개발 훅(window.__game.naju)에서 찾는다 */
export interface ReviewBridgeProps {
  reportRef: RefObject<NajuSceneReport | null>;
  teleport?: RefObject<TerrainTeleport | null> | null;
  playerState?: RefObject<PlayerMotionState | null> | null;
  terrain?: Pick<Terrain, "groundAt"> | null;
  /** 개발용으로 치운 차단물 — Set 이나 목록을 돌려주는 함수 */
  clearedBlockers?: Set<string> | (() => string[]) | null;
}

interface NajuDevHook {
  teleport?: RefObject<TerrainTeleport | null>;
  terrain?: Pick<Terrain, "groundAt">;
  clearedBlockers?: () => string[];
}

type ResolvedLinks = Required<Pick<ReviewBridgeProps, "teleport" | "playerState" | "terrain">> & {
  clearedBlockers: (() => string[]) | null;
};

let links: ResolvedLinks = { teleport: null, playerState: null, terrain: null, clearedBlockers: null };
function resolveLinks(props: ReviewBridgeProps): ResolvedLinks {
  const hook = typeof window === "undefined" ? undefined : (window.__game?.naju as NajuDevHook | undefined);
  const cleared = props.clearedBlockers ?? hook?.clearedBlockers ?? null;
  return {
    teleport: props.teleport ?? hook?.teleport ?? null,
    playerState: props.playerState ?? null,
    terrain: props.terrain ?? hook?.terrain ?? null,
    clearedBlockers: cleared instanceof Set ? () => [...cleared] : cleared,
  };
}

let frameEnv: FrameEnv | null = null;
let orbit: OrbitControls | null = null;
let selectionBox: THREE.Box3Helper | null = null;
let detachPick: (() => void) | null = null;
let visualQueue: VisualJob[] = [];
let visualJob: (VisualJob & { start: number; frames: number }) | null = null;
const handledVisualRequests = new Set<string>();

function replyVisual(request: VisualRequest, result: Record<string, unknown>) {
  if (isClosed || !IS_EMBEDDED || !run) return;
  const type =
    request.type === "kgeseo-review-inspection"
      ? "kgeseo-review-inspection-changed"
      : request.type === "kgeseo-review-view"
        ? "kgeseo-review-view-changed"
        : "kgeseo-review-captured";
  window.parent.postMessage(
    {
      type,
      projectId: run.projectId,
      sessionId: run.sessionId,
      requestId: request.requestId,
      viewId: request.viewId,
      gameRevision: run.gameRevision,
      runtimeProfile: run.runtimeProfile,
      mode: run.mode,
      ...result,
    },
    location.origin,
  );
}
function finishVisualJob(result: Record<string, unknown>) {
  if (!visualJob) return;
  const job = visualJob;
  visualJob = null;
  clearTimeout(job.timeout);
  if (orbit) orbit.enabled = state.inspection;
  notify({ capturing: false });
  replyVisual(job.request, result);
}
function cancelVisual(message = "검수 실행이 종료되어 시각 점검을 취소했습니다.") {
  finishVisualJob({ ok: false, error: message });
  for (const job of visualQueue.splice(0)) {
    clearTimeout(job.timeout);
    replyVisual(job.request, { ok: false, error: message });
  }
}
function clearHighlight() {
  if (selectionBox) {
    selectionBox.removeFromParent();
    selectionBox.geometry.dispose();
    (selectionBox.material as THREE.Material).dispose();
    selectionBox = null;
  }
}
function postObjectSelected(object: SelectedObject | null) {
  if (!run) return;
  window.parent.postMessage(
    {
      type: "kgeseo-review-object-selected",
      projectId: run.projectId,
      sessionId: run.sessionId,
      gameRevision: run.gameRevision,
      runtimeProfile: run.runtimeProfile,
      mode: "diagnostic",
      object,
    },
    location.origin,
  );
}
function clearSelection(alwaysPost = false) {
  clearHighlight();
  if (alwaysPost || state.selected) postObjectSelected(null);
  notify({ selected: null });
}
function detachOrbit() {
  detachPick?.();
  detachPick = null;
  orbit?.dispose();
  orbit = null;
  clearHighlight();
}
const isMeshObject = (o: THREE.Object3D): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true;
function pickObject(event: { clientX: number; clientY: number }) {
  if (!state.inspection || visualJob || !frameEnv) return;
  const { scene, camera, gl } = frameEnv;
  const rect = gl.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(
    new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    ),
    camera,
  );
  const hit = ray.intersectObjects(scene.children, true).find((item) => {
    if (!isMeshObject(item.object) || item.object.userData.reviewSelection) return false;
    for (let node: THREE.Object3D | null = item.object; node; node = node.parent) if (!node.visible) return false;
    const materials = Array.isArray(item.object.material) ? item.object.material : [item.object.material];
    return materials.some(
      (material) => material?.visible !== false && !(material?.transparent && material.opacity < 0.05),
    );
  });
  clearHighlight();
  if (!hit) {
    clearSelection(true);
    return;
  }
  const mesh = hit.object as THREE.Mesh;
  const data = mesh.userData as {
    groupId?: string;
    ids?: ArrayLike<number>;
    publicAssetOriginal?: { ids?: ArrayLike<number> | null };
  };
  const original =
    hit.instanceId == null ? null : ((data.ids ?? data.publicAssetOriginal?.ids)?.[hit.instanceId] ?? null);
  const identity = identifyReviewObject({
    meshName: mesh.name,
    groupName: data.groupId || mesh.name?.replace(PUBLIC_ASSET_MESH_PREFIX, ""),
    instanceId: hit.instanceId ?? null,
    originalInstanceId: original,
  });
  const transform = mesh.matrixWorld.clone();
  if (hit.instanceId != null) {
    const instance = new THREE.Matrix4();
    (mesh as unknown as THREE.InstancedMesh).getMatrixAt(hit.instanceId, instance);
    transform.multiply(instance);
  }
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!.clone().applyMatrix4(transform);
  selectionBox = new THREE.Box3Helper(box, 0xffd166);
  selectionBox.userData.reviewSelection = true;
  (selectionBox.material as THREE.Material).depthTest = false;
  selectionBox.renderOrder = 999;
  scene.add(selectionBox);
  const position = box
    .getCenter(new THREE.Vector3())
    .toArray()
    .map((value) => Math.round(value * 1000) / 1000);
  const zoneId =
    links.terrain?.groundAt(position[0] * METERS_PER_UNIT, position[2] * METERS_PER_UNIT)?.zone ||
    reviewViews.find((view) => view.id === state.viewId)?.zoneId ||
    null;
  const object: SelectedObject = { ...identity, position, zoneId };
  notify({ selected: object });
  postObjectSelected(object);
}
function attachOrbit() {
  if (!frameEnv || orbit || !state.inspection) return;
  const { camera, gl } = frameEnv;
  orbit = new OrbitControls(camera, gl.domElement);
  orbit.enableDamping = false;
  orbit.minDistance = 2;
  orbit.maxDistance = 110;
  orbit.target.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(20));
  orbit.update();
  let down: { x: number; y: number } | null = null;
  const onDown = (event: PointerEvent) => {
    if (event.button === 0) down = { x: event.clientX, y: event.clientY };
  };
  const onUp = (event: PointerEvent) => {
    const start = down;
    down = null;
    if (event.button === 0 && start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5)
      pickObject(event);
  };
  const onCancel = () => {
    down = null;
  };
  gl.domElement.addEventListener("pointerdown", onDown);
  gl.domElement.addEventListener("pointerup", onUp);
  gl.domElement.addEventListener("pointercancel", onCancel);
  detachPick = () => {
    gl.domElement.removeEventListener("pointerdown", onDown);
    gl.domElement.removeEventListener("pointerup", onUp);
    gl.domElement.removeEventListener("pointercancel", onCancel);
  };
}
function onVisualRequest(event: MessageEvent) {
  const checked = readVisualRequest(event, run, window.parent, location.origin, reviewViews);
  if (!checked) return;
  const { request, view, error } = checked;
  if (error) {
    replyVisual(request, { ok: false, error });
    return;
  }
  if (!state.ready || !frameEnv || state.flushing || state.quiescent) {
    replyVisual(request, { ok: false, error: "게임 화면이 준비된 뒤 다시 시도해 주세요." });
    return;
  }
  if (request.type === "kgeseo-review-inspection") {
    document.exitPointerLock?.();
    if (!request.enabled) {
      cancelVisual("시각 점검을 종료했습니다.");
      clearSelection();
      detachOrbit();
    }
    notify({ inspection: Boolean(request.enabled), ...(!request.enabled ? { viewId: null, selected: null } : {}) });
    if (request.enabled) attachOrbit();
    replyVisual(request, { ok: true, enabled: request.enabled });
    return;
  }
  if (handledVisualRequests.has(request.requestId) || visualQueue.length >= 8) {
    replyVisual(request, { ok: false, error: "이미 처리한 요청이거나 대기 중인 시점이 많습니다." });
    return;
  }
  handledVisualRequests.add(request.requestId);
  if (handledVisualRequests.size > 64)
    handledVisualRequests.delete(handledVisualRequests.values().next().value as string);
  const job: VisualJob = {
    request,
    view: view!,
    timeout: setTimeout(
      () => {
        const message = "구역 화면이 안정되기를 기다리는 시간이 초과되었습니다.";
        if (visualJob?.request === request) finishVisualJob({ ok: false, error: message });
        else {
          visualQueue = visualQueue.filter((item) => item !== job);
          replyVisual(request, { ok: false, error: message });
        }
      },
      request.type === "kgeseo-review-view" ? 14000 : 19000,
    ),
  };
  visualQueue.push(job);
}
function visualFrame(frame: FrameEnv) {
  if (!run?.valid || run.mode !== "diagnostic") return;
  frameEnv = frame;
  if (state.inspection) {
    attachOrbit();
    orbit?.update();
  }
  if (!visualJob && visualQueue.length) {
    const job = visualQueue.shift()!;
    if (!links.teleport?.current || !links.playerState?.current) {
      clearTimeout(job.timeout);
      replyVisual(job.request, { ok: false, error: "구역 이동 연결을 아직 준비하지 못했습니다." });
      return;
    }
    document.exitPointerLock?.();
    clearSelection();
    links.teleport.current(job.view.position[0] * METERS_PER_UNIT, job.view.position[2] * METERS_PER_UNIT);
    visualJob = { ...job, start: frame.clock.elapsedTime, frames: 0 };
    if (orbit) orbit.enabled = false;
    notify({ capturing: true, viewId: job.view.id, selected: null });
  }
  if (visualJob) {
    const job = visualJob;
    const { camera } = frame;
    camera.position.fromArray(job.view.position);
    camera.lookAt(...job.view.target);
    camera.updateMatrixWorld(true);
    orbit?.target.fromArray(job.view.target);
    job.frames += 1;
    if (job.frames >= 45 && frame.clock.elapsedTime - job.start >= 1.5) job.afterRender = true;
  }
  if (readCameraHold()) {
    // 시점 고정 중엔 걷기 훅이 멈춰 있다(useReviewCameraHold → paused) — 아바타·안개 기준점이 카메라를 따르게 직접 적는다
    const player = links.playerState?.current;
    if (player) {
      player.position.copy(frame.camera.position);
      player.moving = false;
      player.speed = 0;
      const ground = links.terrain?.groundAt(
        frame.camera.position.x * METERS_PER_UNIT,
        frame.camera.position.z * METERS_PER_UNIT,
      );
      if (ground) player.groundY = player.footY = ground.y / METERS_PER_UNIT;
    }
  }
}
function copyVisualFrame() {
  const job = visualJob;
  if (!job?.afterRender || !frameEnv || isClosed || !run) return;
  try {
    let imageDataUrl: string | undefined;
    if (job.request.type === "kgeseo-review-capture") {
      const source = frameEnv.gl.domElement;
      const scale = Math.min(1, 960 / source.width, 540 / source.height);
      if (!Number.isFinite(scale) || source.width < 1 || source.height < 1)
        throw new Error("게임 캔버스 크기를 확인할 수 없습니다.");
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(source.width * scale));
      canvas.height = Math.max(1, Math.floor(source.height * scale));
      // R3F 와 후처리가 끝난 같은 RAF 의 실제 canvas 를 읽는다. HUD 와 선택 상자는 제외된다.
      const context = canvas.getContext("2d");
      if (!context) throw new Error("이미지 캔버스를 만들지 못했습니다.");
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      imageDataUrl = canvas.toDataURL("image/jpeg", 0.8);
      if (!imageDataUrl.startsWith("data:image/jpeg;base64,")) throw new Error("구역 이미지를 읽지 못했습니다.");
    }
    record("checkpoint", {
      source: "diagnostic-visual-review",
      label: job.request.type === "kgeseo-review-capture" ? "구역 화면 촬영" : "구역 시점 이동",
      viewId: job.view.id,
      countsAsPuzzleProgress: false,
    });
    finishVisualJob({ ok: true, ...(imageDataUrl ? { imageDataUrl } : {}) });
  } catch (error) {
    finishVisualJob({ ok: false, error: reviewErrorText(error, run.token) });
  }
}

// ── 관측 기록 전송 ────────────────────────────────────────────────────────
function schedule(ms = 300) {
  if (!isClosed && !state.flushing && !state.quiescent && !timer && !isSending && queue.length && retries < 3)
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, ms);
}
function flush(): Promise<void> {
  if (flushPromise) return flushPromise;
  if (!run?.valid || !queue.length) return Promise.resolve();
  flushPromise = sendBatch().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}
async function sendBatch() {
  if (!run) return;
  const batch = queue.slice(0, 20);
  isSending = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(
      `/__review/projects/${encodeURIComponent(run.projectId)}/sessions/${encodeURIComponent(run.sessionId)}/events`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: run.token, events: batch }),
        keepalive: true,
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: { message?: string }; message?: string };
      throw new Error(data?.error?.message || data?.message || `기록 저장 실패 (${response.status})`);
    }
    queue.splice(0, batch.length);
    retries = 0;
    notify({ saved: state.saved + batch.length, pending: queue.length, error: "" });
  } catch (error) {
    retries += 1;
    notify({ error: reviewErrorText(error, run.token), pending: queue.length });
  } finally {
    clearTimeout(timeout);
    isSending = false;
    schedule(1000 * 2 ** retries);
  }
}
function record(type: string, detail: Record<string, unknown> = {}): boolean {
  if (isClosed || !run?.valid || state.flushing || state.quiescent) return false;
  if (queue.length >= 100) {
    notify({ error: "미전송 기록이 많습니다. 저장 연결을 확인한 뒤 다시 시도하세요." });
    return false;
  }
  queue.push({
    id: `${VISIT_KEY}-${++serial}`,
    type,
    at: new Date().toISOString(),
    detail: { ...detail, gameRevision: run.gameRevision, mode: run.mode, runtimeProfile: run.runtimeProfile },
  });
  notify({ pending: queue.length });
  schedule();
  return true;
}

// 부모가 iframe 을 지우기 전에 진행 중 요청을 기다리고 나머지 묶음까지 저장한다.
// stop=true 면 성공 후 새 관측을 막아 ack→unmount 사이에 기록이 생기지 않게 한다.
function flushAll(stop = false): Promise<{ ok: boolean; error?: string }> {
  if (stop) cancelVisual();
  stopAfterFlush = stopAfterFlush || stop;
  if (flushAllPromise) return flushAllPromise;
  notify({ flushing: true });
  if (timer) clearTimeout(timer);
  timer = null;
  flushAllPromise = (async () => {
    let limitTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      limitTimer = setTimeout(
        () => reject(new Error("기록 전송 제한 시간을 넘겼습니다. 기록을 보존한 채 다시 시도해 주세요.")),
        12000,
      );
    });
    try {
      for (let i = 0; i < 5 && (queue.length || isSending); i += 1) {
        await Promise.race([flush(), timeout]);
        if (queue.length && state.error) throw new Error(state.error);
      }
      if (queue.length) throw new Error("아직 저장되지 않은 관찰 기록이 있습니다. 저장 연결을 확인해 주세요.");
      notify({ quiescent: stopAfterFlush, blocked: "" });
      return { ok: true };
    } catch (error) {
      const message = reviewErrorText(error, run?.token);
      notify({ quiescent: false, blocked: `관찰 기록을 먼저 저장해야 합니다. ${message}` });
      return { ok: false, error: message };
    } finally {
      clearTimeout(limitTimer);
      stopAfterFlush = false;
      notify({ flushing: false });
      schedule();
    }
  })().finally(() => {
    flushAllPromise = null;
  });
  return flushAllPromise;
}

async function returnToWorkbench(): Promise<boolean> {
  if (!run || state.returning) return false;
  notify({ returning: true });
  try {
    document.exitPointerLock?.();
    if (document.fullscreenElement) await document.exitFullscreen?.();
    // 부모가 게임 화면을 닫더라도 이미 남긴 관찰이 사라지지 않게 먼저 보낸다. 실패하면 화면을 유지하고 저장 재시도를 제공한다.
    if (!(await flushAll()).ok) return false;
    if (IS_EMBEDDED) {
      const message = reviewReturnMessage(run);
      if (!message) {
        notify({ blocked: "검수 대상 정보가 없어 부모 화면으로 돌아갈 수 없습니다." });
        return false;
      }
      window.parent.postMessage(message, location.origin);
    } else window.location.assign(`/review/?project=${encodeURIComponent(run.projectId)}`);
    return true;
  } catch (error) {
    notify({ blocked: reviewErrorText(error, run.token) });
    return false;
  } finally {
    notify({ returning: false });
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else notify({ blocked: "이 브라우저에서는 전체 화면을 지원하지 않습니다. 검수 화면의 확대 기능을 사용해 주세요." });
  } catch {
    notify({ blocked: "전체 화면을 열지 못했습니다. 검수 화면에서 게임 영역을 확대해 주세요." });
  }
}

// import 시점 등록: 씬의 개발 단축키보다 먼저 capture 단계에서 차단한다.
// review 가 없거나 배포 빌드인 경우 리스너/통신/저장 변경이 전혀 없다.
if (run) {
  const on = <K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
    capture = false,
  ) => {
    window.addEventListener(type, handler, capture);
    listeners.push([type, handler as EventListener, capture]);
  };
  on(
    "keydown",
    (event) => {
      const target = event.target as { closest?: (s: string) => unknown } | null;
      if (
        readCameraHold() &&
        !target?.closest?.("[data-review-hud]") &&
        !event.metaKey &&
        !event.ctrlKey &&
        event.code !== "Escape"
      ) {
        event.stopImmediatePropagation();
        event.preventDefault();
        return;
      }
      if (!shouldBlockKeyInReview(event as unknown as Parameters<typeof shouldBlockKeyInReview>[0], run.mode)) return;
      const isTyping = Boolean(target?.closest?.("[data-review-hud]"));
      event.stopImmediatePropagation();
      if (!isTyping) {
        event.preventDefault();
        notify({ blocked: "정상 검수에서는 편집·순간이동·강제 씬 완료 키를 사용하지 않습니다." });
      }
    },
    true,
  );
  on("error", (event) =>
    record("error", { message: reviewErrorText(event.error || event.message || "리소스 읽기 오류", run.token) }),
  );
  on("unhandledrejection", (event) => record("error", { message: reviewErrorText(event.reason, run.token) }));
  on("pagehide", () => {
    if (timer) clearTimeout(timer);
    timer = null;
    void flush();
  });
  if (IS_EMBEDDED && run.valid)
    on("message", async (event) => {
      const request = event.data as {
        type?: string;
        projectId?: string;
        sessionId?: string;
        requestId?: unknown;
      } | null;
      if (VISUAL_REQUEST_TYPES.includes(request?.type as VisualRequestType)) {
        onVisualRequest(event);
        return;
      }
      if (
        event.origin !== location.origin ||
        event.source !== window.parent ||
        request?.type !== "kgeseo-review-flush" ||
        request.projectId !== run.projectId ||
        request.sessionId !== run.sessionId ||
        typeof request.requestId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(request.requestId)
      )
        return;
      const result = await flushAll(true);
      window.parent.postMessage(
        {
          type: "kgeseo-review-flushed",
          projectId: run.projectId,
          sessionId: run.sessionId,
          requestId: request.requestId,
          ...result,
        },
        location.origin,
      );
    });
}
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    cancelVisual();
    detachOrbit();
    frameEnv = null;
    isClosed = true;
    if (timer) clearTimeout(timer);
    for (const [type, handler, capture] of listeners) window.removeEventListener(type, handler, capture);
    subscribers.clear();
  });

function readPublicAssets(value: PublicAssetStatus | null | undefined): PublicAssetSummary | null {
  if (!value || value.source !== "sf") return null;
  const count = (n: unknown) => (Number.isInteger(n) && (n as number) >= 0 ? (n as number) : 0);
  return {
    source: "sf",
    phase: String(value.phase || "manifest").slice(0, 24),
    total: count(value.total),
    loaded: count(value.loaded),
    failed: count(value.failed),
    appliedGroups: count(value.appliedGroups),
  };
}
/** 상태 객체는 자리에서 바뀐다(publicAssetManifest) — 값이 바뀌었는지 직렬화로 가린다 */
const publicAssetsStamp = (value: PublicAssetSummary | null) => (value ? JSON.stringify(value) : "");

// ── Canvas 안 ────────────────────────────────────────────────────────────
/**
 * 기본 구성은 기존 첫 프레임 관측을 유지한다. 공개 교체 구성은 모든 파일과 실제 교체 배치가 준비된 뒤
 * 후속 프레임 두 장까지 기다린다. 형태 승인은 별도다.
 * 반드시 걷기 훅(usePlayerMovement) 뒤에 붙인다 — reportRef.current 를 그 훅이 갈아 끼운다.
 */
export function ReviewBridge(props: ReviewBridgeProps) {
  const { reportRef } = props;
  // 모듈 변수는 렌더 중에 못 바꾼다(react-hooks) — 효과에서 넣는다. 아래 작업들은 효과·메시지 처리 뒤에만 읽는다.
  useEffect(() => {
    links = resolveLinks(props);
  }, [props]);
  const frameCount = useRef(0);
  const lastMeasuredAt = useRef(0);
  const lastArea = useRef("");
  const lastCleared = useRef("[]");
  const lastPublicStamp = useRef("");
  const appliedFrame = useRef<number | null>(null);
  const hasRecordedPublicFailure = useRef(false);
  useEffect(() => {
    if (!run?.valid || run.mode !== "diagnostic") return undefined;
    const release = addAfterEffect(copyVisualFrame);
    return () => {
      release();
      cancelVisual();
      detachOrbit();
      frameEnv = null;
    };
  }, []);
  useFrame((frame) => {
    const { clock, gl } = frame;
    if (!run?.valid || state.flushing || state.quiescent) return;
    visualFrame(frame as unknown as FrameEnv);
    frameCount.current += 1;
    let isPublicReady = false;
    if (IS_PUBLIC_PROFILE) {
      const raw = publicAssetStatus;
      const assets = readPublicAssets(raw);
      const stamp = publicAssetsStamp(assets);
      if (stamp !== lastPublicStamp.current) {
        lastPublicStamp.current = stamp;
        notify({ publicAssets: assets });
      }
      if (assets && (assets.phase === "failed" || assets.failed > 0)) {
        appliedFrame.current = null;
        if (!hasRecordedPublicFailure.current) {
          hasRecordedPublicFailure.current = true;
          notify({
            ready: false,
            blocked: "공개 에셋을 불러오지 못했습니다. 실패 목록을 확인한 뒤 새 실행에서 다시 검수해 주세요.",
          });
          record("error", {
            source: "public-assets",
            message: "공개 에셋 로딩 실패",
            publicAssets: assets,
            failures: (raw.failures || []).slice(0, 8).map((entry) => ({
              file: String(entry.file || "").slice(0, 180),
              message: reviewErrorText(entry.message, run.token),
            })),
          });
        }
      } else if (
        assets?.phase === "applied" &&
        assets.total > 0 &&
        assets.loaded === assets.total &&
        assets.failed === 0 &&
        assets.appliedGroups > 0
      ) {
        if (appliedFrame.current == null) appliedFrame.current = frameCount.current;
        isPublicReady = frameCount.current - appliedFrame.current >= 2 && !hasRecordedPublicFailure.current;
      } else appliedFrame.current = null;
    }
    if (!state.ready && (IS_PUBLIC_PROFILE ? isPublicReady : frameCount.current === 2)) {
      notify({ ready: true, blocked: "" });
      record("ready", {
        renderedFrames: 2,
        kind: run.kind,
        settingsProfile: "source-defaults-and-current-layout",
        assetLoadState: IS_PUBLIC_PROFILE ? "public-assets-loaded-and-applied" : "first-frame-not-all-assets-certified",
        ...(IS_PUBLIC_PROFILE ? { publicAssets: state.publicAssets } : {}),
        capabilities: { spaceReview: true, puzzlePlay: false },
      });
    }
    if (clock.elapsedTime - lastMeasuredAt.current < 5) return;
    lastMeasuredAt.current = clock.elapsedTime;
    const report = reportRef.current;
    // 텍스처·형상 수와 JS 힙은 NajuSceneReport 에 없다(옛 보고의 텍스처수·형상수·힙MB) — 여기서 덧붙인다
    const memory = (gl as THREE.WebGLRenderer | undefined)?.info?.memory;
    const heap =
      typeof performance === "undefined"
        ? undefined
        : (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const metric = readReviewMetrics(
      report
        ? {
            ...report,
            textures: memory?.textures,
            geometryCount: memory?.geometries,
            jsHeapMB: heap ? heap.usedJSHeapSize / 1048576 : null,
          }
        : null,
    );
    if (!metric) return;
    notify({ metrics: metric });
    record("metrics", { ...metric, ...(IS_PUBLIC_PROFILE ? { publicAssets: state.publicAssets } : {}) });
    if (metric.area && metric.area !== lastArea.current) {
      lastArea.current = metric.area;
      record("navigation", {
        area: metric.area,
        position: metric.position,
        distance: metric.distance,
        countsAsPuzzleProgress: false,
      });
    }
    if (run.mode === "diagnostic" && links.clearedBlockers) {
      const removed = links.clearedBlockers();
      const next = JSON.stringify(removed);
      if (next !== lastCleared.current) {
        lastCleared.current = next;
        record("checkpoint", {
          source: "diagnostic-scene-state",
          label: "개발용 차단물 제거 상태 변경",
          removed,
          countsAsPuzzleProgress: false,
        });
      }
    }
  });
  return null;
}
/** 옛 NJ검수프레임 이름의 별칭 — 검사 하네스·이식 중 문서가 가리킨다 */
export const ReviewFrame = ReviewBridge;

// ── Canvas 밖 ────────────────────────────────────────────────────────────
const OBSERVATION_LABELS = ["공간 배치", "동선·충돌", "에셋 형태·화풍", "시야·가독성", "성능·로딩", "문제 발견"];

/** 검수 기록 패널(DOM). `data-review-hud` 안의 키 입력은 게임 단축키로 전파되지 않는다 */
export function ReviewHud() {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [isOpen, setIsOpen] = useState(!IS_EMBEDDED || !run?.valid);
  const [note, setNote] = useState("");
  const [label, setLabel] = useState(OBSERVATION_LABELS[0]);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  useEffect(() => {
    if (!run?.valid) return undefined;
    const watchdog = setTimeout(() => {
      if (!state.ready && !state.publicAssets?.failed)
        notify({
          blocked: IS_PUBLIC_PROFILE
            ? "공개 에셋 다운로드·배치 적용을 기다리는 중입니다. 준비 상태를 확인해 주세요."
            : "아직 실제 게임 프레임이 관측되지 않았습니다. 로딩 상태를 확인하세요.",
        });
    }, 30000);
    return () => clearTimeout(watchdog);
  }, []);
  if (!run) return null;
  if (s.inspection)
    return (
      <aside
        data-review-hud="true"
        aria-label="배치 둘러보기 정보"
        style={{
          ...panelStyle,
          top: "auto",
          bottom: 12,
          left: 12,
          width: 276,
          maxWidth: "calc(100vw - 24px)",
          padding: "8px 10px",
        }}
      >
        <div style={{ ...rowStyle, gap: 8 }}>
          <strong style={{ fontSize: 12 }}>배치 둘러보기</strong>
          <span style={{ ...smallStyle, marginLeft: "auto" }}>
            {s.publicAssets ? `${s.publicAssets.loaded}/${s.publicAssets.total}` : "기본 구성"}
          </span>
          <button
            type="button"
            style={{ ...buttonStyle, padding: "3px 6px", fontSize: 11 }}
            aria-expanded={isInfoOpen}
            onClick={() => setIsInfoOpen(!isInfoOpen)}
          >
            검수정보{isInfoOpen ? " 접기" : ""}
          </button>
        </div>
        <p
          style={{
            ...smallStyle,
            margin: "4px 0 0",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
          title={s.selected?.name || ""}
        >
          {s.capturing
            ? "구역 화면 준비 중…"
            : s.selected
              ? `선택 · ${s.selected.name}${s.selected.identityQuality === "group" ? " (무리)" : ""}`
              : "물체를 클릭하면 이름이 표시됩니다."}
          {(s.error || s.blocked) && " · 확인 필요"}
        </p>
        {isInfoOpen && (
          <div style={{ marginTop: 8, borderTop: "1px solid #ffffff24", paddingTop: 6 }}>
            <p style={smallStyle}>
              진단용 시각 점검 · 정상 플레이 근거에 포함되지 않습니다.
              <br />
              관찰 저장 {s.saved}건 · 미전송 {s.pending}건
            </p>
            {s.metrics && (
              <p style={smallStyle}>
                {s.metrics.terrain || "지형 미확인"} · {s.metrics.fps == null ? "FPS 측정 중" : `${s.metrics.fps} FPS`}
                <br />
                삼각형 {s.metrics.triangles?.toLocaleString() ?? "미측정"}
              </p>
            )}
            {(s.error || s.blocked) && (
              <p role="status" style={warnStyle}>
                {s.error || s.blocked}
              </p>
            )}
          </div>
        )}
      </aside>
    );
  return (
    <aside data-review-hud="true" aria-label="실제 게임 검수 기록" style={panelStyle}>
      <div style={rowStyle}>
        <strong>{run.mode === "diagnostic" ? "공간 검수 · 진단 실행" : "공간 검수"}</strong>
        <button type="button" style={buttonStyle} onClick={() => setIsOpen(!isOpen)} aria-expanded={isOpen}>
          {isOpen ? "기록 접기" : "기록 열기"}
        </button>
      </div>
      <p style={{ ...smallStyle, margin: "6px 0" }}>연결 화면: 나주 앙암바위 · NAJU-01</p>
      {IS_PUBLIC_PROFILE && (
        <p style={{ ...smallStyle, margin: "6px 0" }}>
          공개 교체 구성 ·{" "}
          {s.publicAssets
            ? `${s.publicAssets.loaded}/${s.publicAssets.total}개 읽음 · 실패 ${s.publicAssets.failed}개 · ${
                s.publicAssets.phase === "applied"
                  ? "배치 적용됨"
                  : s.publicAssets.phase === "loaded"
                    ? "배치 적용 중"
                    : s.publicAssets.phase === "failed"
                      ? "읽기 실패"
                      : "읽는 중"
              }`
            : "에셋 목록을 기다리는 중"}
        </p>
      )}
      {!isOpen && (
        <p style={{ ...smallStyle, margin: "6px 0" }}>
          {s.ready ? (IS_PUBLIC_PROFILE ? "공개 에셋 적용 후 화면 관측됨" : "첫 프레임 관측됨") : "게임 화면 준비 중"} ·
          저장 {s.saved}건{s.pending ? ` · 미전송 ${s.pending}건` : ""}
          {!s.inspection && (
            <>
              <br />
              게임 화면을 클릭한 뒤 T · 조작 해제 Esc
            </>
          )}
        </p>
      )}
      {s.metrics?.terrain && <p style={{ ...smallStyle, margin: "6px 0" }}>지형: {s.metrics.terrain}</p>}
      {s.inspection && (
        <p style={smallStyle}>
          시각 점검 · 드래그 회전 · 오른쪽 드래그 이동 · 휠 확대 · 물체 클릭 선택
          <br />
          {s.capturing
            ? "구역 화면 준비 중…"
            : s.selected
              ? `${s.selected.name}${s.selected.identityQuality === "group" ? " · 무리 단위 식별" : ""}`
              : "확인할 물체를 눌러 주세요."}
        </p>
      )}
      <div style={{ ...rowStyle, justifyContent: "flex-start", flexWrap: "wrap" }}>
        <button
          type="button"
          style={buttonStyle}
          disabled={s.returning || s.flushing || s.quiescent}
          onClick={() => {
            void returnToWorkbench();
          }}
        >
          {s.returning || s.flushing ? "기록 저장 중…" : "검수 화면으로"}
        </button>
        {IS_EMBEDDED && (
          <button
            type="button"
            style={buttonStyle}
            onClick={() => {
              void toggleFullscreen();
            }}
          >
            전체 화면
          </button>
        )}
      </div>
      {s.quiescent && (
        <p role="status" style={smallStyle}>
          기록 전송 완료 · 실행 종료를 기다리는 중
        </p>
      )}
      {!isOpen && (s.error || s.blocked) && (
        <p role="status" style={warnStyle}>
          {s.error || s.blocked}{" "}
          <button type="button" style={buttonStyle} onClick={() => setIsOpen(true)}>
            기록 확인
          </button>
        </p>
      )}
      {isOpen && (
        <>
          {!run.valid ? (
            <p role="alert" style={warnStyle}>
              {run.errors.join(" ")}
            </p>
          ) : (
            <>
              <p style={bodyStyle}>
                {s.ready
                  ? IS_PUBLIC_PROFILE
                    ? "공개 에셋 로딩·배치 적용 후 실제 화면 관측됨"
                    : "실제 게임 첫 프레임 관측됨"
                  : "실제 게임 화면 준비를 기다리는 중"}
                <br />
                저장 {s.saved}건 · 미전송 {s.pending}건
              </p>
              <p style={bodyStyle}>
                {s.inspection
                  ? "지금은 구역 시각 점검입니다. 이동·촬영·선택 결과는 정상 플레이 근거로 쓰지 않습니다."
                  : "T로 시점 조작 시작 · Esc로 기록창 복귀."}{" "}
                현 나주 버전은 공간·동선 확인용이며 퍼즐 진행은 연결되어 있지 않습니다.
              </p>
              <p style={smallStyle}>
                코드 기본 설정과 현재 배치 파일을 사용합니다.{" "}
                {IS_PUBLIC_PROFILE
                  ? "공개 교체 파일을 모두 읽고 배치한 뒤 화면을 관측합니다. 형태·고증·성능 승인은 사람이 따로 판단합니다."
                  : "첫 프레임 관측은 에셋 전체 로딩·형태 검수 완료를 뜻하지 않습니다."}
              </p>
              {s.metrics && (
                <p style={smallStyle}>
                  {s.metrics.area || "구역 미확인"} · {s.metrics.fps == null ? "FPS 측정 중" : `${s.metrics.fps} FPS`} ·
                  삼각형 {s.metrics.triangles?.toLocaleString() ?? "미측정"}
                  <br />
                  현재 기기 관측치이며 최소 사양 통과 판정이 아닙니다.
                </p>
              )}
              <label style={labelStyle}>
                관찰 항목
                <select style={inputStyle} value={label} onChange={(event) => setLabel(event.target.value)}>
                  {OBSERVATION_LABELS.map((text) => (
                    <option key={text}>{text}</option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                관찰 내용
                <textarea
                  style={{ ...inputStyle, minHeight: 65, resize: "vertical" }}
                  value={note}
                  maxLength={800}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="어느 구역에서 무엇을 확인했는지 적어 주세요."
                />
              </label>
              <button
                type="button"
                style={{ ...buttonStyle, background: "#5c4ce0" }}
                disabled={!s.ready || !note.trim() || s.pending >= 100 || s.flushing || s.quiescent}
                onClick={() => {
                  if (
                    record("checkpoint", {
                      label,
                      note: note.trim(),
                      source: "human-observation",
                      countsAsPuzzleProgress: false,
                      position: s.metrics?.position ?? null,
                    })
                  )
                    setNote("");
                }}
              >
                관찰 기록 남기기
              </button>
              {s.blocked && (
                <p role="status" style={warnStyle}>
                  {s.blocked}
                </p>
              )}
              {s.error && (
                <div role="alert" style={warnStyle}>
                  {s.error}{" "}
                  <button
                    type="button"
                    style={buttonStyle}
                    onClick={() => {
                      retries = 0;
                      void flush();
                    }}
                  >
                    저장 재시도
                  </button>
                </div>
              )}
            </>
          )}
          <p style={smallStyle}>
            승인·반려는 검수 작업대에서 근거와 함께 기록합니다. 이 화면의 관찰 기록은 자동 승인이 아닙니다.
          </p>
        </>
      )}
    </aside>
  );
}

/** 렌더 오류를 검수 기록(error · react-boundary)으로 남기고 HUD 만 남긴다 — main.tsx 에서 App 을 감싼다 */
export class ReviewErrorBoundary extends React.Component<{ children?: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override componentDidCatch(error: unknown) {
    record("error", { message: reviewErrorText(error, run?.token), source: "react-boundary" });
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <main
        style={{ padding: 30, background: "#172035", color: "white", minHeight: "100vh", fontFamily: "sans-serif" }}
      >
        <h1>게임 화면을 불러오지 못했습니다</h1>
        <p>{reviewErrorText(this.state.error, run?.token)}</p>
        <ReviewHud />
      </main>
    );
  }
}

const panelStyle: CSSProperties = {
  position: "absolute",
  zIndex: 80,
  left: 12,
  top: 12,
  width: "min(330px, calc(100vw - 24px))",
  maxHeight: "calc(100vh - 24px)",
  overflowY: "auto",
  boxSizing: "border-box",
  padding: 14,
  border: "1px solid #657087",
  borderRadius: 12,
  background: "rgba(19,27,44,.96)",
  color: "#f0f3fa",
  font: "13px/1.55 system-ui,sans-serif",
  boxShadow: "0 6px 30px #0005",
};
const rowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 };
const bodyStyle: CSSProperties = { margin: "10px 0" };
const smallStyle: CSSProperties = { ...bodyStyle, fontSize: 11, color: "#c3cede" };
const warnStyle: CSSProperties = { ...bodyStyle, color: "#ffca93" };
const buttonStyle: CSSProperties = {
  padding: "7px 10px",
  border: "1px solid #818aa0",
  background: "#28364e",
  color: "white",
  borderRadius: 6,
  cursor: "pointer",
  font: "inherit",
};
const labelStyle: CSSProperties = { display: "block", margin: "9px 0" };
const inputStyle: CSSProperties = {
  display: "block",
  boxSizing: "border-box",
  width: "100%",
  marginTop: 4,
  padding: 7,
  borderRadius: 5,
  border: "1px solid #6e7990",
  color: "#172035",
  background: "#f8fafc",
  font: "inherit",
};
