/**
 * 나주 상호작용 — 바라보는 물건을 고르고 [E] 로 쓴다. 퍼즐마다 대상을 등록만 하면 된다.
 * E 는 물건 전용이다. 장면 인물(isTalk)은 따로 겨누고 [F](터치 💬)로 말을 건다 — 계약 v0.4.16 §10-2 「말 거는 키는 F 하나,
 * E 는 물건 쓰기 전용」, 미르 11/11 「물건을 살피는데 NPC 가 E 를 가로챈다」.
 */
import { useSyncExternalStore } from "react";
import * as THREE from "three";

import { gameNow } from "@/engine/input/gameClock";
import { isGameFrozen } from "@/engine/input/gamePause";
import { isPointerActive } from "@/engine/input/virtualLock";
import { createChangeSignal } from "@/lib/changeSignal";

import { isCameraFocused } from "../scene/cameraFocus";
import {
  interruptTalk,
  isNpcSpeaking,
  isSpeechBoxShown,
  isTalkInterruptible,
  isTalkTaken,
  talkOwner,
} from "../scene/firstScene/npcSpeech";
import { isLetterOpenNow } from "./cliff/letters";
import { isFilmCaptionOn } from "./filmCaption";
import { isPaperOpenNow } from "./ridge/oldPaper";

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
  /** 다시 주울 수 있는 물건 — 겨냥에서 다른 대상보다 먼저 잡히고, 손에 다른 것을 들고 있어도 E 로 줍는다 */
  isPickup?: boolean;
  /** 겨냥 점수에 더하는 값 — 클수록 다른 대상에 양보한다(따라다니는 동행이 퍼즐 물건 앞을 지날 때 가로채지 않게) */
  aimPenalty?: number;
  /** 겨누면 살짝 커지고 밝아질 물체(본편 AimHighlight 와 같은 셈) — 테두리 동그라미 대신 이걸 쓴다 */
  highlight?: () => THREE.Object3D | null;
  /** 말 거는 대상(장면 인물) — E 로 겨누지 않고 [F] 로 겨눈다(pressAimedTalk). 안내는 「[F] …에게 말 걸기」 */
  isTalk?: boolean;
  /** 장면 인물의 말 차례 이름(npcSpeech) — 다른 인물이 말하는 중 이 인물을 겨누고 [F] 하면 이쪽으로 바꾼다(switchAimedTalk) */
  talkId?: string;
  /** 어느 퍼즐(장면)의 물건인가 — 이 물건을 쓰면 다른 퍼즐이 남긴 글은 내린다(noticeFor · interactableFor 가 붙인다) */
  owner?: string;
}

const targets = new Map<string, Interactable>();
const signal = createChangeSignal();
/** E 로 쓸 물건 */
let aimed: Interactable | null = null;
/** [F] 로 말을 걸 장면 인물 — 물건과 따로 고른다(인물 앞 물건을 가리지 않게) */
let aimedTalk: Interactable | null = null;

export function registerInteractable(target: Interactable) {
  targets.set(target.id, target);
  return () => {
    targets.delete(target.id);
    if (aimed?.id === target.id) setAimed(null, aimedTalk);
    if (aimedTalk?.id === target.id) setAimed(aimed, null);
  };
}

function setAimed(next: Interactable | null, nextTalk: Interactable | null) {
  if (aimed === next && aimedTalk === nextTalk) return;
  aimed = next;
  aimedTalk = nextTalk;
  signal.notify();
}

/** 일반 대상의 점수는 2 를 넘지 않으니 이만큼 빼면 주울 물건이 늘 앞선다 — 물레처럼 넓은 대상에 가려지지 않게 */
const PICKUP_PRIORITY = 2;
const toTarget = new THREE.Vector3();
const forward = new THREE.Vector3();

/** 매 프레임 카메라로 겨눈 대상을 고른다. 시선과의 옆거리가 가장 작은 것 — 광선 판정보다 너그럽다. 물건(E)과 장면 인물(F)은 따로 */
export function updateAim(camera: THREE.Camera, isActive: boolean) {
  if (!isActive) return setAimed(null, null);
  camera.getWorldDirection(forward);
  let best: Interactable | null = null;
  let bestScore = Infinity;
  let bestTalk: Interactable | null = null;
  let bestTalkScore = Infinity;
  for (const target of targets.values()) {
    if (target.enabled && !target.enabled()) continue;
    toTarget.subVectors(target.position, camera.position);
    const along = toTarget.dot(forward);
    if (along <= 0 || toTarget.length() > target.reach) continue;
    const side = Math.sqrt(Math.max(0, toTarget.lengthSq() - along * along));
    if (side > target.radius) continue;
    const score =
      side / target.radius + along / target.reach - (target.isPickup ? PICKUP_PRIORITY : 0) + (target.aimPenalty ?? 0);
    if (target.isTalk) {
      if (score < bestTalkScore) {
        bestTalkScore = score;
        bestTalk = target;
      }
    } else if (score < bestScore) {
      bestScore = score;
      best = target;
    }
  }
  if (best) lastObjectAimAt = performance.now();
  setAimed(best, bestTalk);
}

export const useAimedLabel = () => useSyncExternalStore(signal.subscribe, () => aimed?.label ?? null);
/** 겨눈 장면 인물의 안내(「아비사에게 말 걸기」) — [F] 알약 */
export const useAimedTalkLabel = () => useSyncExternalStore(signal.subscribe, () => aimedTalk?.label ?? null);
/** 겨눈 장면 인물의 말 차례 이름 — 말하는 중 다른 인물을 겨눴는지 HUD 가 본다 */
export const useAimedTalkId = () => useSyncExternalStore(signal.subscribe, () => aimedTalk?.talkId ?? null);

// ── 상호작용 차례 — 마지막 상호작용이 이긴다 ──
/**
 * 플레이어가 [E] · [F] 로 무언가를 쓴 한 번 = 상호작용 하나. 그 처리 안에서 쏜 알림이 그 상호작용의 「반응」이다.
 * 새 상호작용이 성립하면 앞 상호작용의 반응(떠 있는 것 · 줄 선 것)은 내리고, 물건을 썼으면 말하던 장면 인물도 그친다
 * (미르 11/11 「5개를 연달아 누르면 하나도 빠짐없이 차례로 다 나온다 — 이전 대화는 찍어눌러야 한다」, 나주통발 01회차 Codex).
 * 시간차 해설 · 단서 · 이야기(반응이 아닌 알림)는 지금 규칙 그대로 — 줄을 서고 버리지 않는다.
 * 뒤늦게 나오는 결과(통발이 뭍에 닿음)는 currentInteraction() 을 받아 두었다가 { reactionTo } 로 쏜다 — 그사이 새 상호작용이 있었으면 버린다.
 */
let interactionSeq = 0;
/** 지금 처리 중인 상호작용 번호(처리 밖이면 0) — 아직 성립 전이면 interactionSeq + 1 */
let runningInteraction = 0;
let isRunningObject = false;
/**
 * 퍼즐(장면)별 글의 주인 — 새 상호작용이 다른 퍼즐의 것이면 앞 퍼즐이 남긴 글(줄 선 것 · 떠 있는 것 · 뒤늦게 쏘는 것)을 내린다
 * (미르 11/11 「이미 푼 퍼즐의 대사가 다른 퍼즐을 풀러 온 뒤에도 이어져 나온다」). 앞 규칙은 누른 순간의 「반응」끼리만 눌렀고,
 * 풀이 뒤 시간차로 이어지는 이야기 · 단서 글은 버리지 않고 끝까지 띄웠다.
 *   runningOwner  지금 처리 중인 상호작용의 주인(겨눈 물건의 owner, 없으면 처리 안에서 쏜 첫 글의 owner)
 *   activeOwner   마지막으로 성립한 상호작용의 주인(주인 없는 상호작용 — 줍기 · 소지품 — 은 바꾸지 않는다)
 *   ownerSeq      주인마다 마지막으로 상호작용한 번호 — 한 번도 손대지 않은 퍼즐의 글(다가가면 뜨는 첫 안내)은 지난 글이 아니다
 */
let runningOwner: string | undefined;
let activeOwner: string | undefined;
const ownerSeq = new Map<string, number>();
/** 검사용 — 주인 기록을 비운다 */
export function resetNoticeOwners() {
  activeOwner = undefined;
  ownerSeq.clear();
}
/** 지금 처리 중인 상호작용 — 뒤늦게 나올 결과가 받아 둔다(처리 밖이면 0) */
export const currentInteraction = () => runningInteraction;

/** 처리 중인 상호작용을 성립시킨다 — 앞 반응을 내리고, 물건이면 말하던 인물을 그친다. 처리 안 첫 알림 · 처리 끝 중 먼저 오는 때 한 번 */
function commitInteraction() {
  if (!runningInteraction || runningInteraction <= interactionSeq) return;
  interactionSeq = runningInteraction;
  dropOlderReactions();
  if (runningOwner !== undefined) {
    // 인물에게 말을 건 것은 「다른 퍼즐로 넘어간 것」이 아니다 — 떠 있는 남의 글만 내리고 주인 기록은 그대로 둔다.
    // 안 그러면 이야기를 들은 뒤 풀던 퍼즐이 새로 쏘는 다음 할 일(연기 길잡이 등)까지 지난 글로 버려진다(Codex 리뷰 2)
    if (isRunningObject) {
      activeOwner = runningOwner;
      ownerSeq.set(runningOwner, interactionSeq);
    }
    dropOtherOwners(runningOwner);
  }
  if (isRunningObject) interruptTalk();
}

/** fn 이 실제로 무언가 했으면(true) 상호작용으로 친다. 아무것도 안 했으면 앞 반응 · 말은 그대로 */
function withInteraction(isObject: boolean, fn: () => boolean, owner?: string): boolean {
  if (runningInteraction) return fn();
  runningInteraction = interactionSeq + 1;
  isRunningObject = isObject;
  runningOwner = owner;
  try {
    const isDone = fn();
    if (isDone) commitInteraction();
    return isDone;
  } finally {
    runningInteraction = 0;
    isRunningObject = false;
    runningOwner = undefined;
  }
}

/** [F] — 겨눈 장면 인물에게 말을 건다(조작 중일 때만). 걸었으면 true */
export function pressAimedTalk(): boolean {
  if (!aimedTalk || !isPointerActive() || isCameraFocused()) return false;
  const target = aimedTalk;
  return withInteraction(
    false,
    () => {
      target.use();
      return true;
    },
    target.owner,
  );
}

/**
 * [F] — 장면 인물이 말하는 중 다른 인물을 겨눴으면 그쪽으로 바꾼다. 말하던 인물은 들은 줄까지만 남기고 그친다.
 * 같은 인물을 겨눴거나 아무도 안 겨눴으면 false — 지금처럼 [F] 는 줄 넘기기(나주통발 01회차 Codex)
 */
export function switchAimedTalk(): boolean {
  const owner = talkOwner();
  if (!aimedTalk?.talkId || owner === null || owner === aimedTalk.talkId || !isTalkInterruptible()) return false;
  if (!isPointerActive() || isCameraFocused()) return false;
  const target = aimedTalk;
  return withInteraction(false, () => {
    interruptTalk();
    target.use();
    return true;
  });
}

/** 마지막으로 물건을 겨눈 때 · E 로 물건을 쓴 때(performance.now) */
let lastObjectAimAt = -Infinity;
let lastObjectUseAt = -Infinity;
/**
 * 물건을 살피는 중인가 — 최근 seconds 초 안에 물건을 겨눴거나 E 로 썼다(시선을 잠깐 돌려도 살피는 중이다, Codex 리뷰).
 * 먼저 거는 말(동행 한마디 · 서버 넛지)은 이때 꺼내지 않는다(미르 11/11 「단서를 찾는 중 원하지 않는 NPC 가 말을 건다」)
 */
export const isHandlingObjects = (seconds = 8) =>
  aimed !== null || performance.now() - Math.max(lastObjectAimAt, lastObjectUseAt) < seconds * 1000;

/** 지금 등록된 대상 id(정렬) — 개발 도구가 FE 로컬 ID 보고에 쓴다. 등록부를 바꾸지 않는다 */
export const listInteractableIds = () => [...targets.keys()].sort();

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

/** 손에 물건을 든 채로도 겨눈 대상을 그대로 쓰나 — 물건을 받는 자리가 아니면 손과 상관없이 쓴다. 겨눈 것이 없으면 내려놓는다 */
export const usesWithHand = (target: Interactable | null) => !!target && (!!target.isPickup || !target.handLabel);

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
      // 가로챈 조작(물레 돌리기 등)도 상호작용이다 — 겨눈 물건의 주인으로 친다(Codex 리뷰 2)
      const interceptor = keyInterceptor;
      if (interceptor && withInteraction(true, () => interceptor(event), aimed?.owner)) {
        event.stopImmediatePropagation();
        return;
      }
      if (!isPointerActive() || isCameraFocused()) return;
      const target = aimed;
      const isUsed = withInteraction(
        true,
        () => {
          if (handHandler?.(target)) return true;
          if (!target) return false;
          target.use();
          return true;
        },
        target?.owner,
      );
      if (!isUsed) return;
      lastObjectUseAt = performance.now();
      event.stopImmediatePropagation();
    },
    { capture: true },
  );
}

// ── 짧은 알림 — 「옆구리가 찢어져 있다」 ──
/**
 * 가운데 글은 한 번에 하나 — 이야기(인물 대사 · 동행 말 · 종이)가 화면에 있는 동안 알림은 줄을 서고, 이야기가 끝나 잠깐 비면 하나씩 뜬다
 * (미르 11/10 「NPC 와 대화할 때 다른 알림을 중복으로 띄우지 않게 — 위아래로 막 띄우는 설계는 바람직하지 않다」 · 박람회 출품판 27회차 · Codex 27~27d).
 *  - 기본(단서 · 이야기): 버리지 않고 온 차례대로(덮어쓰지 않는다 — 단서가 든 알림이 많다). 같은 글은 하나로,
 *    진척만 다른 글(「(2/4)」 「(지금 2/4)」)은 최신 것 하나로 합친다. 이야기에 밀려 내려간 알림은 줄 맨 앞에서 다시 처음부터
 *    — 읽을 만큼 보였으면 다시 안 띄운다(4초마다 오는 거절 알림이 앞 알림을 계속 처음으로 돌려 알림이 끝나지 않았다).
 *    뒤에 줄이 있으면 떠 있는 알림은 읽을 만큼(글자 수)만 보이고 넘긴다.
 *  - urgent(지금 한 조작의 반응 · 피해 · 거절): 줄 맨 앞(urgent 끼리 차례)에 서서 떠 있던 기본 알림을 밀어내고 바로 뜬다.
 *    이야기 때문에 못 뜨면 5초 안에만, 이야기에 밀리면 버린다.
 *  - fleeting(지금만 맞는 말): 바로 못 뜨거나 밀리면 버린다.
 *  - isValid: 띄우기 직전 · 떠 있는 동안 다시 본다(이미 주운 열쇠 「주우라」 같은 지난 말을 버린다).
 */
export interface NoticeOptions {
  urgent?: boolean;
  fleeting?: boolean;
  isValid?: () => boolean;
  /** 이야기 위에도 바로 뜬다 — 게임이 멈췄다는 상태 안내(「클릭하면 계속」)만. 다음 알림이 와도 밀리지 않는다 */
  always?: boolean;
  /** 뒤늦게 나온 상호작용 결과 — 그 상호작용(currentInteraction)의 반응으로 친다. 그사이 새 상호작용이 있었으면 버린다 */
  reactionTo?: number;
  /** 어느 퍼즐(장면)의 글인가(noticeFor 가 붙인다) — 다른 퍼즐로 넘어가면 내린다. 없으면(줍기 · 길 막힘 · 소지품) 지금 규칙 그대로 */
  owner?: string;
}
interface NoticeItem extends NoticeOptions {
  text: string;
  seconds: number;
  /** 진척 표시를 뺀 글 — 같은 줄기면 최신 것 하나로 */
  stem: string;
  /** urgent 가 이 게임 시각(ms, gameNow — 멈춘 시간은 빠진다)까지 못 뜨면 버린다 */
  expiresAt: number;
  /** 지금까지 보인 시간(초) — 밀렸다 다시 떠도 쌓는다 */
  shown: number;
  /** 어느 상호작용의 반응인가 — 반응이 아니면 없음 */
  action?: number;
}
/** 떠 있는 알림 — always 는 대화창이 떠 있어도 보인다(멈춤 상태 안내) */
let notice: { text: string; key: number; always: boolean } | null = null;
let noticeKey = 0;
const noticeSignal = createChangeSignal();
/** 떠 있는 알림과 남은 시간(초) */
let showing: { item: NoticeItem; left: number } | null = null;
const noticeLine: NoticeItem[] = [];
/**
 * 이야기가 끝나고 이만큼 비어야 줄 선 알림을 띄운다 — 대사 사이 · 다음 줄로 넘어가는 틈에 끼지 않게.
 * 0.6초면 대화가 끝나자마자 글이 또 튀어나와 「사람 사이에 상자가 또 뜬다」로 보였다(미르 11/11) — 급한 알림은 기다리지 않는다
 */
const NOTICE_RELEASE_SECONDS = 1.5;
const URGENT_WAIT_MS = 5000;
let freeSeconds = NOTICE_RELEASE_SECONDS;
let noticeTicker = 0;
let lastNoticeTick = 0;

const noticeStem = (text: string) => text.replace(/\s*\((?:지금\s*)?\d+\s*\/\s*\d+\)/g, "").trim();
/** 뒤에 줄이 있을 때 이만큼만 보인다 — 글자 수로 읽는 시간(2 ~ 제 시간) */
const readSeconds = (item: NoticeItem) => Math.min(item.seconds, Math.max(2, 1.2 + item.text.length * 0.045));

/**
 * 이야기가 화면에 있다 — 펼친 종이 · 주머니 편지 · 대화창(장면 인물 말이든 동행 말이든 · 고르는 물음 포함, DialogueLayer 가 알린다) ·
 * 인물 대사 · 말할 차례를 잡은 사람(첫 줄 전 틈 — 조작 중일 때만: ESC · 창으로 잠금이 풀리면 대사는 멈춰 내려가는데 차례는 쥔 채다).
 * 「클릭하면 계속」 같은 멈춤 상태 안내는 always 로 이야기 위에도 뜬다
 */
export const isStoryOnScreen = () =>
  isFilmCaptionOn() ||
  isPaperOpenNow() ||
  isLetterOpenNow() ||
  isSpeechBoxShown() ||
  isNpcSpeaking() ||
  (isTalkTaken() && isPointerActive());

const isStillValid = (item: NoticeItem) =>
  (!item.urgent || gameNow() <= item.expiresAt) &&
  (!item.isValid || item.isValid()) &&
  (item.action === undefined || item.action >= interactionSeq);

/**
 * 다른 퍼즐로 넘어갔다 — 앞 퍼즐이 남긴 글(주인이 다른 것)은 떠 있든 줄 서 있든 내린다. 주인 없는 글 · 멈춤 안내(always)는 둔다.
 * 급한 글(피해 · 거절)도 주인이 다르면 내린다 — 지금 누른 것의 반응이 먼저다
 */
function dropOtherOwners(owner: string) {
  const isOther = (item: NoticeItem) => !item.always && item.owner !== undefined && item.owner !== owner;
  for (let i = noticeLine.length - 1; i >= 0; i -= 1) if (isOther(noticeLine[i])) noticeLine.splice(i, 1);
  if (showing && isOther(showing.item)) hideNotice();
}

/**
 * 뒤늦게 쏘는 글(예약 · 매 프레임 · 판정을 기다린 뒤)이 지난 퍼즐의 것인가 — 그 퍼즐을 만진 뒤에 다른 퍼즐을 만졌으면 그렇다.
 * 한 번도 만지지 않은 퍼즐의 글(다가가면 뜨는 첫 안내 · 앞 퍼즐이 풀려 열린 다음 장치의 안내)은 지난 글이 아니다
 */
function isFromLeftPuzzle(owner: string | undefined) {
  if (owner === undefined || activeOwner === undefined || owner === activeOwner) return false;
  const mine = ownerSeq.get(owner);
  const theirs = ownerSeq.get(activeOwner);
  return mine !== undefined && theirs !== undefined && mine < theirs;
}

/** 새 상호작용이 성립했다 — 앞 상호작용의 반응은 떠 있든 줄 서 있든 내린다 */
function dropOlderReactions() {
  const isOlder = (item: NoticeItem) => item.action !== undefined && item.action < interactionSeq;
  for (let i = noticeLine.length - 1; i >= 0; i -= 1) if (isOlder(noticeLine[i])) noticeLine.splice(i, 1);
  if (showing && isOlder(showing.item)) hideNotice();
}

function displayNotice(item: NoticeItem) {
  showing = { item, left: item.seconds };
  noticeKey += 1;
  notice = { text: item.text, key: noticeKey, always: item.always === true };
  noticeSignal.notify();
}

function hideNotice() {
  showing = null;
  if (!notice) return;
  notice = null;
  noticeSignal.notify();
}

/**
 * 줄에 넣는다 — 같은 글 · 같은 줄기(진척만 다름)는 하나로. urgent 는 urgent 끼리 온 차례대로 맨 앞쪽에, 기본은 그 뒤.
 * isPushedBack = 이야기에 밀려 돌아온 것 — 기본 알림의 맨 앞(urgent 뒤)으로. 줄에 같은 줄기의 더 새 것이 있으면 그것을 남긴다
 */
function lineUp(item: NoticeItem, isPushedBack = false) {
  const same = noticeLine.findIndex((each) => each.text === item.text || each.stem === item.stem);
  if (same >= 0) {
    if (!isPushedBack) noticeLine[same] = item;
    return;
  }
  const urgentCount = noticeLine.filter((each) => each.urgent).length;
  // 반응은 기본 알림보다 앞에(지금 한 일의 답이 먼저) — 같은 상호작용의 반응끼리는 온 차례대로
  const reactionCount = noticeLine.filter((each) => !each.urgent && each.action !== undefined).length;
  if (item.urgent || isPushedBack) noticeLine.splice(urgentCount, 0, item);
  else if (item.action !== undefined) noticeLine.splice(urgentCount + reactionCount, 0, item);
  else noticeLine.push(item);
}

/** 떠 있던 알림을 내린다 — 밀려도 남길 알림은 줄 맨 앞으로(다시 처음부터), 읽을 만큼 보였으면 다시 안 띄운다 */
function pushBackShowing() {
  if (!showing) return;
  const { item, left } = showing;
  hideNotice();
  item.shown += item.seconds - left;
  if (!item.fleeting && !item.urgent && item.shown < readSeconds(item)) lineUp(item, true);
}

function tickNotice() {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastNoticeTick) / 1000);
  lastNoticeTick = now;
  // 휴대폰 「전부 멈춤」(창 · 멈춤 표시) 동안은 줄도 멈춘다 — 창 뒤에서 줄 선 단서가 안 보인 채 넘어가지 않게(Codex 리뷰).
  // 급한 알림의 만료는 게임 시계(gameNow — 멈춘 시간이 빠진다)로 재서 멈춘 사이에 만료되지 않는다
  if (isGameFrozen()) return;
  // 지난 말은 버린다
  for (let i = noticeLine.length - 1; i >= 0; i -= 1) if (!isStillValid(noticeLine[i])) noticeLine.splice(i, 1);
  if (isStoryOnScreen()) {
    freeSeconds = 0;
    if (!showing?.item.always) pushBackShowing();
    return;
  }
  freeSeconds += dt;
  if (showing) {
    // 급한 것이 줄 맨 앞에 오면 떠 있던 기본 알림을 밀어낸다(멈춤 상태 안내 always 는 밀지 않는다)
    if (noticeLine[0]?.urgent && !showing.item.urgent && !showing.item.always) pushBackShowing();
    else {
      showing.left -= dt;
      const shownFor = showing.item.shown + showing.item.seconds - showing.left;
      const isRead = noticeLine.length > 0 && shownFor >= readSeconds(showing.item);
      if (showing.left > 0 && !isRead && (!showing.item.isValid || showing.item.isValid())) return;
      hideNotice();
    }
  }
  const next = noticeLine[0];
  // 지금 한 일의 반응은 틈을 기다리지 않는다(말을 그치고 띄우는 물건 글이 1.5 초 늦게 뜨지 않게)
  if (next && (next.urgent || next.action !== undefined || freeSeconds >= NOTICE_RELEASE_SECONDS)) {
    noticeLine.shift();
    displayNotice(next);
  }
}

/** 틱은 늘 돈다(0.1초마다 몇 가지 비교뿐) — 이야기가 끝난 지 얼마나 됐는지를 알림이 없을 때도 세어야 틈(NOTICE_RELEASE_SECONDS)을 지킨다 */
function startNoticeTicker() {
  if (noticeTicker || typeof window === "undefined") return;
  lastNoticeTick = performance.now();
  noticeTicker = window.setInterval(tickNotice, 100);
}
startNoticeTicker();

/**
 * 떠 있는 알림 · 줄 선 알림을 모두 거둔다(멈춤 안내 always 는 둔다) — 영상이 시작될 때 부른다.
 * 영상 앞의 글이 자막 동안 줄을 섰다가 영상이 끝난 뒤 뒤늦게 이어 나오지 않게(미르 11/11)
 */
export function clearPendingNotices() {
  noticeLine.length = 0;
  if (showing && !showing.item.always) hideNotice();
}

/** 이 글의 알림이 떠 있거나 줄 서 있으면 바로 거둔다 — 기다리던 일이 끝났는데 안내가 남지 않게 */
export function clearNotice(text: string) {
  for (let i = noticeLine.length - 1; i >= 0; i -= 1) if (noticeLine[i].text === text) noticeLine.splice(i, 1);
  if (showing?.item.text === text) hideNotice();
}

/** 게임이 알림을 쏜 순간을 듣는 곳 — 줄 · 밀림 · 버림과 상관없이 쏠 때마다 한 번 */
const noticePostListeners = new Set<(text: string) => void>();
/**
 * 게임이 알림을 쏜 순간(화면에 뜬 때가 아니다) — 대화창의 상황 판정(틀림 · 풀림 · 되돌려짐 신호)이 듣는다.
 * 알림이 대화 중엔 줄을 서고 · 밀렸다 다시 뜨고 · 버려지기도 해서, 화면에 뜬 알림으로 세면 늦거나 두 번 세거나 빠졌다
 */
export function subscribeNoticePosted(listener: (text: string) => void) {
  noticePostListeners.add(listener);
  return () => {
    noticePostListeners.delete(listener);
  };
}

export function showNotice(text: string, seconds = 3.2, options: NoticeOptions = {}) {
  for (const listener of noticePostListeners) listener(text);
  // 상호작용 처리 안에서 쏜 알림 · 뒤늦은 결과는 그 상호작용의 반응(멈춤 상태 안내는 빼고)
  const action = options.always ? undefined : (options.reactionTo ?? (runningInteraction || undefined));
  if (action !== undefined && action === runningInteraction) {
    // 겨눈 물건에 주인이 없으면 처리 안에서 쏜 첫 글의 주인이 이 상호작용의 주인이다
    runningOwner ??= options.owner;
    commitInteraction();
  } else if (!options.always && isFromLeftPuzzle(options.owner)) {
    // 이미 다른 퍼즐로 넘어갔다 — 앞 퍼즐이 예약해 둔 글 · 뒤늦은 글은 띄우지 않는다
    return;
  }
  const item: NoticeItem = {
    ...options,
    text,
    seconds,
    stem: noticeStem(text),
    expiresAt: gameNow() + URGENT_WAIT_MS,
    shown: 0,
    action,
  };
  if (!isStillValid(item)) return;
  // 멈춤 상태 안내는 이야기 위에도 곧바로(PC ESC 중에도 동행 자막은 남아 있다 — 그 밑에 「클릭하면 계속」이 묻히지 않게 · Codex 리뷰)
  if (item.always) {
    pushBackShowing();
    displayNotice(item);
    return;
  }
  if (isStoryOnScreen()) {
    if (!item.fleeting) lineUp(item);
    return;
  }
  // 떠 있는 것과 같은 글이면 그대로(되풀이로 시간을 늘리지 않는다 — 1초마다 오는 같은 거절이 뒤 단서를 끝없이 밀었다, Codex 리뷰).
  // 같은 줄기(진척만 다름)면 글만 바꾸고 남은 시간은 짧게라도 지킨다
  if (showing && showing.item.text === text) return;
  if (showing && showing.item.stem === item.stem) {
    const left = showing.left;
    displayNotice(item);
    if (showing) showing.left = Math.max(left, 1.5);
    return;
  }
  if (item.action !== undefined) {
    // 지금 한 일의 반응 — 앞 반응은 이미 내렸다. 같은 상호작용의 앞 글 · 급한 글 · 멈춤 안내는 자르지 않고 그 뒤에, 아니면 바로 뜬다
    if (showing && (showing.item.action === item.action || showing.item.urgent || showing.item.always)) {
      if (!item.fleeting) lineUp(item);
      return;
    }
    pushBackShowing();
    displayNotice(item);
    return;
  }
  if (item.urgent) {
    // 떠 있는 것도 급한 것이면 그 뒤에 선다(앞 안내가 잘리지 않게). 바로 못 뜨면 버리는 것은 버린다
    if (showing?.item.urgent || showing?.item.always || noticeLine[0]?.urgent) {
      if (!item.fleeting) lineUp(item);
      return;
    }
    // 떠 있던 기본 알림은 줄 맨 앞으로 물러나고 바로 뜬다
    pushBackShowing();
    displayNotice(item);
    return;
  }
  // 앞 알림이 있거나 이야기가 막 끝났으면(틈 NOTICE_RELEASE_SECONDS — 다음 줄 · 다음 사람이 이어 말할 수 있다) 줄 뒤로
  if (showing || noticeLine.length || freeSeconds < NOTICE_RELEASE_SECONDS) {
    if (!item.fleeting) lineUp(item);
    return;
  }
  displayNotice(item);
}

/** 이 퍼즐(장면)의 글로 쏘는 showNotice — 퍼즐 파일마다 한 번 만들어 쓴다 */
export const noticeFor =
  (owner: string) =>
  (text: string, seconds?: number, options: NoticeOptions = {}) =>
    showNotice(text, seconds, { owner, ...options });

/**
 * [E] 가 아닌 퍼즐 조작(밟기 [C] 등)을 이 퍼즐의 상호작용으로 친다 — 안 그러면 주인이 앞 퍼즐로 남아
 * 이 조작의 실패 · 완료 글이 지난 글로 버려진다(Codex 리뷰 2). fn 이 실제로 무언가 했으면 true
 */
export const actFor = (owner: string) => (fn: () => boolean) => withInteraction(true, fn, owner);

/** 이 퍼즐(장면)의 물건으로 등록하는 registerInteractable */
export const interactableFor = (owner: string) => (target: Interactable) => registerInteractable({ owner, ...target });

/** 알림이 떠 있거나 줄 서 있다 */
export const isNoticePending = () => showing !== null || noticeLine.length > 0;

export const useNotice = () => useSyncExternalStore(noticeSignal.subscribe, () => notice);
