/**
 * 소지품 — 퍼즐에서 얻은 물건을 넣고 뺀다. [I] 로 연다.
 * 물건은 셋 중 한 곳에 있다: 소지품 칸, 손(꺼내 든 것), 땅 위(놓인 것 · 손에서 내려놓은 것).
 * 손에 드는 길은 숫자키와 소지품 창뿐이다 — 빈손 [E] 가 소지품에서 물건을 꺼내 들거나 떨어뜨리는 일은 없다(물속에서
 * E 를 더듬다 돌·진주를 잃는 일이 잦았다). 다만 겨눈 곳이 소지품 속 물건을 꼭 받는 자리면(뜬 돌 홈 · 자물통 등) 빈손
 * [E] 로 그 물건이 소지품에서 바로 쓰인다 — 맞는 자리, 맞는 물건일 때만이다(findUsable).
 * 손에 든 것은 [E] 로 내려놓는다 — 겨눈 곳이 받아 주면(제상 등) 거기, 아니면 발 앞 땅에. 땅 위 것은 [E] 로 줍는다.
 * 서버 계약에는 아직 아이템이 없어 앞단에서만 들고 있는 상태다.
 */
import { useSyncExternalStore } from "react";
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

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
}

const signal = createChangeSignal();
let held: HeldItem[] = [];
let world: WorldItem[] = [];
let hand: HeldItem | null = null;
let nextUid = 1;

/** 꺼낸 물건을 놓을 자리 — 매 프레임 카메라에서 받아 둔다(창이 열려 있으면 Canvas 밖에서 카메라를 못 본다) */
const viewerPosition = new THREE.Vector3();
const viewerForward = new THREE.Vector3(0, 0, -1);

export function trackViewer(camera: THREE.Camera) {
  viewerPosition.copy(camera.position);
  camera.getWorldDirection(viewerForward);
}

/** 바라보는 쪽 발 앞 1m 땅 위 */
function spotInFront() {
  const flat = new THREE.Vector3(viewerForward.x, 0, viewerForward.z);
  if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
  flat.normalize();
  const x = viewerPosition.x / M + flat.x;
  const z = viewerPosition.z / M + flat.z;
  return new THREE.Vector3(x * M, groundY(x, z) * M, z * M);
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

  /** 퍼즐에서 바로 소지품으로 넣는다(땅에 놓이지 않는 물건). 칸이 차면 false */
  add(kind: ItemKind) {
    if (held.length >= SLOT_COUNT) return false;
    held = [...held, { uid: nextUid++, kind }];
    signal.notify();
    return true;
  },

  /** 땅 위 물건을 소지품으로. 칸이 차면 false */
  pickUp(uid: number) {
    const item = world.find((entry) => entry.uid === uid);
    if (!item || held.length >= SLOT_COUNT) return false;
    world = world.filter((entry) => entry.uid !== uid);
    held = [...held, { uid: item.uid, kind: item.kind }];
    signal.notify();
    return true;
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
    world = [...world, { ...hand, position: spotInFront() }];
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
