import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";

import { LAYERS, overlayLayer } from "./overlayLayer";

// 계약(v0.3.1)의 Clue 와 같은 모양이라 서버 응답을 그대로 꽂으면 된다.
// 소모 없음(GRD-01)이라 빼기가 없고, 슬롯 상한도 없다(S7-034).

/** 화면에 그대로 보이는 분류 이름이다. */
export type InventoryCategory = "열쇠" | "기록";

export interface InventoryItem {
  id: string;
  name: string;
  category: InventoryCategory;
  description?: string;
  /** data URL 또는 그림 주소 */
  image?: string;
}

export type InventoryItemInput = Omit<InventoryItem, "category"> & { category?: InventoryCategory };

export interface AddItemOptions {
  /** 첫 물건이어도 창을 열지 않는다. 재접속 때 acquired_clue_ids 를 통째로 복원할 때 쓴다. */
  silent?: boolean;
}

const items = new Map<string, InventoryItem>();
// 목록이 바뀔 때마다 올린다. 배열을 그대로 구독하면 매번 새 값이라 무한 렌더가 난다.
let version = 0;
let hasAutoOpened = false;

const listeners = new Set<() => void>();
const notify = () => {
  version++;
  for (const listener of listeners) listener();
};

export const inventory = {
  version: () => version,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  list: () => [...items.values()],
  find: (id: string) => items.get(id) ?? null,
  has: (id: string) => items.has(id),

  /** 이미 있으면 아무 일도 안 한다(중복 획득 방지 · S7-021). */
  add(item: InventoryItemInput | null | undefined, { silent = false }: AddItemOptions = {}) {
    if (!item?.id || items.has(item.id)) return false;
    items.set(item.id, { category: "기록", ...item });
    // 첫 물건일 때만 한 번 열어 준다(S7-030). 아이콘만 띄우면 못 보고 지나가는 사람이 생긴다.
    if (!hasAutoOpened && !silent) {
      hasAutoOpened = true;
      overlayLayer.open(LAYERS.inventory);
    }
    // 복원분은 이미 겪은 것으로 친다.
    if (silent) hasAutoOpened = true;
    notify();
    return true;
  },

  addMany(list: InventoryItemInput[], options?: AddItemOptions) {
    for (const item of list) inventory.add(item, options);
  },

  /** 개발·테스트용 초기화 */
  clear() {
    items.clear();
    hasAutoOpened = false;
    notify();
  },
};

export const useInventory = () => {
  useSyncExternalStore(inventory.subscribe, inventory.version);
  return inventory.list();
};

exposeDevHook("inventory", inventory);
