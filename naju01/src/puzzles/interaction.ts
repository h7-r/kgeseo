/**
 * 나주 상호작용 — 바라보는 물건을 고르고 [E] 로 쓴다. 퍼즐마다 대상을 등록만 하면 된다.
 * 본편처럼 E 는 상호작용 전용이다(편집 모드는 Q).
 */
import { useSyncExternalStore } from "react";
import * as THREE from "three";

import { createChangeSignal } from "@/lib/changeSignal";

export interface Interactable {
  id: string;
  /** 월드 좌표(유닛). 매 프레임 읽으니 움직이는 물건이면 같은 벡터를 고쳐 쓴다 */
  position: THREE.Vector3;
  /** 화면에 뜨는 말 — 「통발 입구 돌리기」 */
  label: string;
  /** 시선이 이만큼(유닛) 옆을 지나가도 겨눈 것으로 본다 */
  radius: number;
  /** 손이 닿는 거리(유닛) */
  reach: number;
  use: () => void;
  enabled?: () => boolean;
  /**
   * 물건을 받는 곳이면(제상 등) 그 물건에 맞는 안내(「제상에 올리기」), 못 받으면 null.
   * 손에 든 물건이면 못 받을 때 발 앞 땅에 놓이고, 빈손이면 소지품에서 받는 물건을 찾아 바로 쓴다
   */
  handLabel?: (kind: string) => string | null;
  /** handLabel 이 받는다고 한 물건을 넘겨받는다. false 를 돌려주면 받지 않은 것 — 물건은 있던 자리(손 · 소지품)에 남는다 */
  receive?: (kind: string) => void | boolean;
  /** true 면 손에 든 물건을 넘기지 않고 든 채로 쓴다(receive 만 부른다) — 들고 비추는 진주처럼 */
  keepHand?: boolean;
  /** 겨누면 살짝 커지고 밝아질 물체(본편 AimHighlight 와 같은 셈) — 테두리 동그라미 대신 이걸 쓴다 */
  highlight?: () => THREE.Object3D | null;
}

const targets = new Map<string, Interactable>();
const signal = createChangeSignal();
let aimed: Interactable | null = null;

export function registerInteractable(target: Interactable) {
  targets.set(target.id, target);
  return () => {
    targets.delete(target.id);
    if (aimed?.id === target.id) setAimed(null);
  };
}

function setAimed(next: Interactable | null) {
  if (aimed === next) return;
  aimed = next;
  signal.notify();
}

const toTarget = new THREE.Vector3();
const forward = new THREE.Vector3();

/** 매 프레임 카메라로 겨눈 대상을 고른다. 시선과의 옆거리가 가장 작은 것 — 광선 판정보다 너그럽다 */
export function updateAim(camera: THREE.Camera, isActive: boolean) {
  if (!isActive) return setAimed(null);
  camera.getWorldDirection(forward);
  let best: Interactable | null = null;
  let bestScore = Infinity;
  for (const target of targets.values()) {
    if (target.enabled && !target.enabled()) continue;
    toTarget.subVectors(target.position, camera.position);
    const along = toTarget.dot(forward);
    if (along <= 0 || toTarget.length() > target.reach) continue;
    const side = Math.sqrt(Math.max(0, toTarget.lengthSq() - along * along));
    if (side > target.radius) continue;
    const score = side / target.radius + along / target.reach;
    if (score < bestScore) {
      bestScore = score;
      best = target;
    }
  }
  setAimed(best);
}

export const useAimedLabel = () => useSyncExternalStore(signal.subscribe, () => aimed?.label ?? null);

/** 지금 겨눈 대상의 id — 매 프레임 읽는 강조(빛남)가 쓴다 */
export const aimedId = () => aimed?.id ?? null;

// ── 겨냥 강조 — 본편 AimHighlight 와 같은 셈: 원래 발광에 따뜻한 흰빛을 더하고 살짝 키운다 ──
const AIM_GLOW = { color: new THREE.Color("#fffed7"), strength: 0.45, grow: 0.08 };
type Emissive = THREE.Material & { emissive?: THREE.Color };
interface Glowing {
  object: THREE.Object3D;
  level: number;
  scale: THREE.Vector3;
}
const glowing = new Map<THREE.Object3D, Glowing>();
const originalEmissive = new WeakMap<THREE.Material, THREE.Color>();
const glowColor = new THREE.Color();

function applyGlow(entry: Glowing) {
  entry.object.scale.copy(entry.scale).multiplyScalar(1 + AIM_GLOW.grow * entry.level);
  glowColor.copy(AIM_GLOW.color).multiplyScalar(entry.level * AIM_GLOW.strength);
  entry.object.traverse((node) => {
    const material = (node as THREE.Mesh).material as Emissive | Emissive[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      if (!m.emissive) continue;
      let original = originalEmissive.get(m);
      if (!original) {
        original = m.emissive.clone();
        originalEmissive.set(m, original);
      }
      m.emissive.copy(original).add(glowColor);
    }
  });
}

/** 매 프레임 — 겨눈 물체는 빛이 오르고, 놓친 물체는 가라앉아 원래대로 */
export function updateAimGlow(delta: number) {
  const object = aimed?.highlight?.() ?? null;
  if (object && !glowing.has(object)) glowing.set(object, { object, level: 0, scale: object.scale.clone() });
  for (const entry of glowing.values()) {
    const goal = entry.object === object ? 1 : 0;
    entry.level += (goal - entry.level) * (1 - Math.exp(-delta * 14));
    if (goal === 0 && entry.level < 0.002) {
      entry.level = 0;
      applyGlow(entry);
      glowing.delete(entry.object);
      continue;
    }
    applyGlow(entry);
  }
}

/** 물건을 쓰는 E — 손에 든 것을 내려놓거나, 겨눈 곳이 받는 물건을 소지품에서 바로 쓴다. 소지품이 등록한다(처리하면 true) */
let handHandler: ((target: Interactable | null) => boolean) | null = null;

export function setHandHandler(handler: ((target: Interactable | null) => boolean) | null) {
  handHandler = handler;
}

/** 지금 겨눈 대상 — 손에 든 물건을 받을 곳인지 HUD 가 본다 */
export const aimedTarget = () => aimed;

/** 미니게임처럼 E 를 따로 받는 동안 먼저 가로챈다. true 를 돌려주면 그 E 는 여기서 끝난다 */
let keyInterceptor: ((event: KeyboardEvent) => boolean) | null = null;

export function setKeyInterceptor(interceptor: ((event: KeyboardEvent) => boolean) | null) {
  keyInterceptor = interceptor;
}

// 캡처 단계 — 쓴 E 가 다른 단축키로 새지 않게
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.code !== "KeyE" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (keyInterceptor?.(event)) {
        event.stopImmediatePropagation();
        return;
      }
      if (!document.pointerLockElement) return;
      if (handHandler?.(aimed)) {
        event.stopImmediatePropagation();
        return;
      }
      if (!aimed) return;
      event.stopImmediatePropagation();
      aimed.use();
    },
    { capture: true },
  );
}

// ── 짧은 알림 — 「옆구리가 찢어져 있다」 ──
let notice: { text: string; key: number } | null = null;
const noticeSignal = createChangeSignal();
let noticeTimer = 0;

export function showNotice(text: string, seconds = 3.2) {
  notice = { text, key: (notice?.key ?? 0) + 1 };
  noticeSignal.notify();
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice = null;
    noticeSignal.notify();
  }, seconds * 1000);
}

export const useNotice = () => useSyncExternalStore(noticeSignal.subscribe, () => notice);
