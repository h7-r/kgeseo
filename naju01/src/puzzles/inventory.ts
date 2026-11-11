/**
 * 소지품 — 퍼즐에서 얻은 물건을 넣고 뺀다. [I] 로 연다.
 * 물건은 셋 중 한 곳에 있다: 소지품 칸, 손(꺼내 든 것), 땅 위(놓인 것 · 손에서 내려놓은 것).
 * 손에 드는 길은 숫자키와 소지품 창뿐이다 — 빈손 [E] 가 소지품에서 물건을 꺼내 들거나 떨어뜨리는 일은 없다(물속에서
 * E 를 더듬다 돌·진주를 잃는 일이 잦았다). 다만 겨눈 곳이 소지품 속 물건을 꼭 받는 자리면(뜬 돌 홈 · 자물통 등) 빈손
 * [E] 로 그 물건이 소지품에서 바로 쓰인다 — 맞는 자리, 맞는 물건일 때만이다(findUsable).
 * 손에 든 것은 [E] 로 내려놓는다 — 겨눈 곳이 받아 주면(제상 등) 거기, 아니면 발 앞 땅에. 땅 위 것은 [E] 로 줍는다.
 * 버린 물건은 어느 맵에서든 다시 주울 수 있어야 한다 — 놓는 자리는 플레이어가 선 바닥 기준이고(findDropSpot),
 * 돌아올 수 없는 곳을 떠날 때는 남은 물건이 따라온다(bringAlong).
 * 서버 계약에는 아직 아이템이 없어 앞단에서만 들고 있는 상태다.
 */
import { useSyncExternalStore } from "react";
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

import { solidQueries } from "../movement/solidField";
import { playerPose, walkTerrain } from "../movement/playerPose";
import { DEFAULT_TERRAIN } from "../terrain/terrain";
import { withCave } from "./cave/caveState";
import { showNotice } from "./interaction";
import { M, groundY } from "./units";
import type { ItemKind } from "./itemCatalog";

export { ITEMS, type ItemKind } from "./itemCatalog";

/** 뜬 돌 넷 + 톱니돌 셋을 한꺼번에 들 수 있어야 한다 */
export const SLOT_COUNT = 8;

export interface HeldItem {
  uid: number;
  kind: ItemKind;
}

export interface WorldItem extends HeldItem {
  /** 유닛 */
  position: THREE.Vector3;
  /** 플레이어가 버린 것 — 퍼즐이 내놓은 채 아직 안 주운 것과 달리, 떠날 때 따라온다 */
  isDropped?: boolean;
  /** 바닥이 아닌 데(열린 조개 속 등)에 얹어 둔 것 — 바닥 높이로 끌어내리지 않고 position.y 에 둔다 */
  isPerched?: boolean;
}

const signal = createChangeSignal();
let held: HeldItem[] = [];
let world: WorldItem[] = [];
let hand: HeldItem | null = null;
let nextUid = 1;

/** 꺼낸 물건을 놓을 방향 — 매 프레임 카메라에서 받아 둔다(창이 열려 있으면 Canvas 밖에서 카메라를 못 본다) */
const viewerForward = new THREE.Vector3(0, 0, -1);

export function trackViewer(camera: THREE.Camera) {
  camera.getWorldDirection(viewerForward);
}

const fallbackGround = withCave(DEFAULT_TERRAIN);
const walkableGround = () => walkTerrain.current ?? fallbackGround;
/** 발 앞 자리가 선 바닥과 이만큼(미터) 넘게 차이 나면 손이 안 닿을 수 있어 발밑에 놓는다 */
const DROP_STEP = 0.6;
/** 물건 몸통 반지름(미터) — 벽·바위에 박히는지 볼 때 */
const DROP_RADIUS = 0.1;

/** (x, z) 에서 발 높이 footY 로 디딜 수 있는 바닥 — 물굴 바닥 · 평상 같은 물건 위까지 본다 */
function standableY(x: number, z: number, footY: number) {
  const ground = walkableGround().groundAt(x, z).y;
  return Math.max(ground, solidQueries.current?.supportAt(x, z, footY + DROP_STEP) ?? -Infinity);
}

/** 물에 빠진 채 버리면 물건이 놓일 강가 z — 물속에 두면 다시 못 찾는다 */
const SHORE_Z = 44;

/**
 * 바라보는 쪽 발 앞 1m. 물 · 벼랑 · 벽이거나 높이가 크게 다르면 플레이어가 선 발밑.
 * 뜬 돌만은 앞이 물이어도 그 자리에 놓는다 — 수면에 떠오른다(WorldItems).
 */
function findDropSpot(kind: ItemKind) {
  const { x: footX, z: footZ, footY, isGrounded } = playerPose;
  // 서 있으면 발 높이가 곧 바닥이다 — 나루터 데크 · 바위처럼 지형보다 높은 곳도 그대로 맞는다
  const standY = isGrounded ? footY : standableY(footX, footZ, footY);
  const flat = new THREE.Vector3(viewerForward.x, 0, viewerForward.z);
  if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
  flat.normalize();
  const x = footX + flat.x;
  const z = footZ + flat.z;
  const sample = walkableGround().groundAt(x, z);
  if (kind === "floatStone" && sample.isWater) return new THREE.Vector3(x * M, standY * M, z * M);
  if (walkableGround().groundAt(footX, footZ).isWater) {
    return new THREE.Vector3(footX * M, walkableGround().groundAt(footX, SHORE_Z).y * M, SHORE_Z * M);
  }
  const y = standableY(x, z, standY);
  const isSafe =
    !sample.isWater &&
    !sample.isFall &&
    Math.abs(y - standY) <= DROP_STEP &&
    !walkableGround().blockedAt(x, z, y, DROP_RADIUS) &&
    !solidQueries.current?.blockedAt(x, z, y, DROP_RADIUS);
  return isSafe ? new THREE.Vector3(x * M, y * M, z * M) : new THREE.Vector3(footX * M, standY * M, footZ * M);
}

/** 소지품에 넣는다. 칸이 다 차 있으면 빈손에 든다. 둘 다 안 되면 false */
function stash(item: HeldItem) {
  if (held.length < SLOT_COUNT) held = [...held, item];
  else if (!hand) hand = item;
  else return false;
  return true;
}

/** 돌아올 수 없는 곳을 떠날 때 물건이 아닌 모습으로 놓인 것(내려놓은 함)도 챙기게 */
const leftBehindCollectors = new Set<() => void>();
export function registerLeftBehind(collect: () => void) {
  leftBehindCollectors.add(collect);
  return () => {
    leftBehindCollectors.delete(collect);
  };
}

/** 저장용 모양 — 자리는 평범한 수로 옮긴다 */
export interface SavedInventory {
  held: HeldItem[];
  hand: HeldItem | null;
  world: (HeldItem & { position: [number, number, number]; isDropped?: boolean; isPerched?: boolean })[];
  nextUid: number;
}

export const inventory = {
  /** 저장할 값 */
  snapshot: (): SavedInventory => ({
    held,
    hand,
    world: world.map((item) => ({ ...item, position: [item.position.x, item.position.y, item.position.z] })),
    nextUid,
  }),
  /** 저장본을 넣는다 */
  restore(saved: SavedInventory) {
    held = saved.held;
    hand = saved.hand;
    world = saved.world.map((item) => ({ ...item, position: new THREE.Vector3(...item.position) }));
    nextUid = saved.nextUid;
    signal.notify();
  },
  held: () => held,
  world: () => world,
  hand: () => hand,
  subscribe: signal.subscribe,
  has: (kind: ItemKind) => held.some((item) => item.kind === kind),

  /** 겨눈 곳(accepts = 대상의 handLabel)이 받는 소지품 속 물건 — 칸 순서로 먼저 맞는 하나. 없으면 null */
  findUsable(accepts: (kind: ItemKind) => string | null) {
    for (const item of held) {
      const label = accepts(item.kind);
      if (label) return { item, label };
    }
    return null;
  },

  /** 땅 위에 물건을 놓는다(퍼즐이 내놓는 물건) */
  spawn(
    kind: ItemKind,
    position: THREE.Vector3,
    { followsPlayer = false, isPerched = false }: { followsPlayer?: boolean; isPerched?: boolean } = {},
  ) {
    world = [
      ...world,
      { uid: nextUid++, kind, position: position.clone(), isDropped: followsPlayer, ...(isPerched && { isPerched }) },
    ];
    signal.notify();
  },

  /** 퍼즐에서 바로 소지품으로 넣는다(땅에 놓이지 않는 물건). 칸이 차면 빈손에, 그것도 안 되면 false */
  add(kind: ItemKind) {
    if (!stash({ uid: nextUid, kind })) return false;
    nextUid++;
    signal.notify();
    return true;
  },

  /** 땅 위 물건을 소지품으로. 칸이 차면 빈손에, 그것도 안 되면 false */
  pickUp(uid: number) {
    const item = world.find((entry) => entry.uid === uid);
    if (!item || !stash({ uid: item.uid, kind: item.kind })) return false;
    world = world.filter((entry) => entry.uid !== uid);
    signal.notify();
    return true;
  },

  /**
   * 돌아올 수 없는 곳을 떠날 때 — 버려 둔 물건을 챙긴다. 다 못 챙기면 도착지(x, z) 곁에 나란히 놓는다. 챙긴 것의 종류를 돌려준다.
   * only 를 주면 그 물건만(물건이 아닌 모습으로 놓인 것은 챙기지 않는다) — 닫힌 나루터 땅에 두고 온 것만 가져올 때(leftBehind)
   */
  bringAlong(x: number, z: number, only?: (item: WorldItem) => boolean): ItemKind[] {
    if (!only) leftBehindCollectors.forEach((collect) => collect());
    let spare = 0;
    const brought: ItemKind[] = [];
    world = world.flatMap((item) => {
      if (!item.isDropped || (only && !only(item))) return [item];
      brought.push(item.kind);
      if (stash({ uid: item.uid, kind: item.kind })) return [];
      const spotX = x + 0.5 * (spare++ - 1);
      return [{ ...item, position: new THREE.Vector3(spotX * M, groundY(spotX, z + 1) * M, (z + 1) * M) }];
    });
    signal.notify();
    return brought;
  },

  /** 소지품에서 꺼내 손에 든다. 이미 든 것이 있으면 그것은 소지품으로 돌아간다 */
  takeOut(uid: number) {
    const item = held.find((entry) => entry.uid === uid);
    if (!item) return;
    held = held.filter((entry) => entry.uid !== uid);
    if (hand) held = [...held, hand];
    hand = item;
    signal.notify();
  },

  /** 손에 든 것을 소지품으로 도로 넣는다(숫자키를 한 번 더 누를 때) */
  stow() {
    if (!hand) return;
    if (held.length >= SLOT_COUNT) {
      showNotice("소지품이 가득 찼다. [E] 로 내려놓자.", 3.2, { urgent: true, fleeting: true });
      return;
    }
    held = [...held, hand];
    hand = null;
    signal.notify();
  },

  /** 손에 든 것을 발 앞 땅에 내려놓는다 */
  dropHand() {
    if (!hand) return;
    world = [...world, { ...hand, position: findDropSpot(hand.kind), isDropped: true }];
    hand = null;
    signal.notify();
  },

  /** 땅에 놓인 것을 다른 모양으로 바꿔 그릴 때 — 소지품을 거치지 않고 없앤다 */
  removeFromWorld(uid: number) {
    world = world.filter((item) => item.uid !== uid);
    signal.notify();
  },

  /** 손에 든 것을 어딘가에 올려 없앤다(제상에 올린 제물 등) */
  releaseHand() {
    const item = hand;
    hand = null;
    signal.notify();
    return item;
  },

  /** 제물로 올리는 등 써서 없앤다. 그 종류가 없으면 false */
  consume(kind: ItemKind) {
    const item = held.find((entry) => entry.kind === kind);
    if (!item) return false;
    held = held.filter((entry) => entry !== item);
    signal.notify();
    return true;
  },

  reset() {
    held = [];
    world = [];
    hand = null;
    signal.notify();
  },
};

export const useHeldItems = () => useSyncExternalStore(signal.subscribe, inventory.held);
export const useWorldItems = () => useSyncExternalStore(signal.subscribe, inventory.world);
export const useHandItem = () => useSyncExternalStore(signal.subscribe, inventory.hand);

/** 받침 있는 이름에 「을」, 없으면 「를」 */
export function withObjectParticle(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const hasBatchim = code >= 0 && code <= 11171 && code % 28 !== 0;
  return `${word}${hasBatchim ? "을" : "를"}`;
}

exposeDevHook("najuInventory", inventory);
