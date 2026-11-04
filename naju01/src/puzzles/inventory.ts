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
import { playerPose } from "../movement/playerPose";
import { DEFAULT_TERRAIN } from "../terrain/terrain";
import { withCave } from "./cave/caveState";
import { M, groundY } from "./units";

export type ItemKind =
  | "lightFish"
  | "rice"
  | "makgeolli"
  | "floatStone"
  | "gearStone"
  | "pearl"
  | "bigPearl"
  | "scale"
  | "letterBox"
  | "bronzeKey"
  | "strawShoe";

export interface ItemDef {
  name: string;
  description: string;
}

export const ITEMS: Record<ItemKind, ItemDef> = {
  lightFish: {
    name: "빛 물고기",
    description: "통발 바닥에 남은 한 마리. 그날 밤 꺼진 화톳불의 불티라 아직 따뜻하다.",
  },
  rice: { name: "쌀", description: "장독대 큰 항아리에 들어 있던 쌀 한 자루. 제물로 올릴 수 있다." },
  floatStone: { name: "뜬 돌", description: "물이 차오르자 떠오른 돌. 구멍이 숭숭해 가볍다." },
  makgeolli: {
    name: "막걸리",
    description: "안쪽 배에 남아 있던 흰 술병. 입구가 꼭 막혀 막걸리가 그대로 들어 있다. 제물로 올릴 수 있다.",
  },
  gearStone: {
    name: "톱니돌",
    description: "테두리에 톱니가 난 납작한 돌. 강 밑 큰 방에서 찾았다. 고리문 옆 홈에 꼭 맞을 크기다.",
  },
  pearl: {
    name: "진주",
    description:
      "강 밑에서 물고기 떼를 돌 고리 안으로 몰아넣자 모래에서 떠오른 진주. 은은히 빛난다. 어디에 쓰는지는 아직 모른다.",
  },
  bigPearl: {
    name: "큰 진주",
    description:
      "큰 조개 속에서 빛을 받아 드러난 주먹만 한 진주. 손안에서도 은은히 빛난다. 어디에 쓰는지는 아직 모른다.",
  },
  scale: {
    name: "푸른 눈물",
    description:
      "강 밑 석실 제단에 놓여 있던 푸른 눈물 한 방울. 비늘처럼 생겼고 손바닥만 하며 얼음처럼 차다. 어디에 쓰는지는 아직 모른다.",
  },
  strawShoe: {
    name: "짚신 한 짝",
    description:
      "검은 줄 통발에 걸려 올라온 큰 짚신 한 짝. 물에 불어 무겁다. 신코 안쪽에 물고기 하나가 새겨져 있다 — 어부가 제 신에 새기던 표시. 주인은 끝내 신으러 오지 않았다.",
  },
  letterBox: {
    name: "아랑사의 함",
    description:
      "물살에 떠밀려 나올 때 손에 쥐여 있던 옻칠한 나무 함. 젖지 않았다. 청동 자물통이 채워져 있어 열쇠가 있어야 열린다. 흔들면 안에서 무언가 달그락거린다.",
  },
  bronzeKey: {
    name: "청동 열쇠",
    description:
      "증언 능선의 돌새가 물고 있던 청동 열쇠. 대가 길고 끝이 꺾였다 — 아랑사의 함에 채워진 자물통 구멍에 꼭 맞을 것 같다.",
  },
};

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

const walkableGround = withCave(DEFAULT_TERRAIN);
/** 발 앞 자리가 선 바닥과 이만큼(미터) 넘게 차이 나면 손이 안 닿을 수 있어 발밑에 놓는다 */
const DROP_STEP = 0.6;
/** 물건 몸통 반지름(미터) — 벽·바위에 박히는지 볼 때 */
const DROP_RADIUS = 0.1;

/** (x, z) 에서 발 높이 footY 로 디딜 수 있는 바닥 — 물굴 바닥 · 평상 같은 물건 위까지 본다 */
function standableY(x: number, z: number, footY: number) {
  const ground = walkableGround.groundAt(x, z).y;
  return Math.max(ground, solidQueries.current?.supportAt(x, z, footY + DROP_STEP) ?? -Infinity);
}

/** 바라보는 쪽 발 앞 1m. 물 · 벼랑 · 벽이거나 높이가 크게 다르면 플레이어가 선 발밑 */
function findDropSpot() {
  const { x: footX, z: footZ, footY, isGrounded } = playerPose;
  // 서 있으면 발 높이가 곧 바닥이다 — 나루터 데크 · 바위처럼 지형보다 높은 곳도 그대로 맞는다
  const standY = isGrounded ? footY : standableY(footX, footZ, footY);
  const flat = new THREE.Vector3(viewerForward.x, 0, viewerForward.z);
  if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
  flat.normalize();
  const x = footX + flat.x;
  const z = footZ + flat.z;
  const sample = walkableGround.groundAt(x, z);
  const y = standableY(x, z, standY);
  const isSafe =
    !sample.isWater &&
    !sample.isFall &&
    Math.abs(y - standY) <= DROP_STEP &&
    !walkableGround.blockedAt(x, z, y, DROP_RADIUS) &&
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

export const inventory = {
  held: () => held,
  world: () => world,
  hand: () => hand,
  subscribe: signal.subscribe,
  has: (kind: ItemKind) => held.some((item) => item.kind === kind),
  isFull: () => held.length >= SLOT_COUNT,

  /** 겨눈 곳(accepts = 대상의 handLabel)이 받는 소지품 속 물건 — 칸 순서로 먼저 맞는 하나. 없으면 null */
  findUsable(accepts: (kind: ItemKind) => string | null) {
    for (const item of held) {
      const label = accepts(item.kind);
      if (label) return { item, label };
    }
    return null;
  },

  /** 땅 위에 물건을 놓는다(퍼즐이 내놓는 물건) */
  spawn(kind: ItemKind, position: THREE.Vector3) {
    world = [...world, { uid: nextUid++, kind, position: position.clone() }];
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

  /** 돌아올 수 없는 곳을 떠날 때 — 버려 둔 물건을 챙긴다. 다 못 챙기면 도착지(x, z) 곁에 나란히 놓는다 */
  bringAlong(x: number, z: number) {
    leftBehindCollectors.forEach((collect) => collect());
    let spare = 0;
    world = world.flatMap((item) => {
      if (!item.isDropped) return [item];
      if (stash({ uid: item.uid, kind: item.kind })) return [];
      const spotX = x + 0.5 * (spare++ - 1);
      return [{ ...item, position: new THREE.Vector3(spotX * M, groundY(spotX, z + 1) * M, (z + 1) * M) }];
    });
    signal.notify();
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
    held = [...held, hand];
    hand = null;
    signal.notify();
  },

  /** 손에 든 것을 발 앞 땅에 내려놓는다 */
  dropHand() {
    if (!hand) return;
    world = [...world, { ...hand, position: findDropSpot(), isDropped: true }];
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
