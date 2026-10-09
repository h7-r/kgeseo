import { useEffect, useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

import { OVERLAY_LAYERS, overlayLayer } from "./overlayLayer";

// 계약(v0.3.1)의 Clue 와 같은 모양이라 서버 응답을 그대로 꽂으면 된다.
// 소모 없음(GRD-01)이라 빼기가 없고, 슬롯 상한도 없다(S7-034).

/** 화면에 그대로 보이는 분류 이름이다. */
type InventoryCategory = "열쇠" | "기록";

export interface InventoryItem {
  id: string;
  name: string;
  category: InventoryCategory;
  description?: string;
  /** data URL 또는 그림 주소 */
  image?: string;
}

type InventoryItemInput = Omit<InventoryItem, "category"> & { category?: InventoryCategory };

interface AddItemOptions {
  /** 첫 물건이어도 창을 열지 않는다. 재접속 때 acquired_clue_ids 를 통째로 복원할 때 쓴다. */
  silent?: boolean;
}

const items = new Map<string, InventoryItem>();
// 목록 배열을 그대로 구독하면 매번 새 값이라 무한 렌더가 난다. 판 번호만 구독한다.
const signal = createChangeSignal();
let hasAutoOpened = false;

export const inventory = {
  version: signal.version,
  subscribe: signal.subscribe,
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
      overlayLayer.open(OVERLAY_LAYERS.inventory);
    }
    // 복원분은 이미 겪은 것으로 친다.
    if (silent) hasAutoOpened = true;
    signal.notify();
    return true;
  },

  addMany(list: InventoryItemInput[], options?: AddItemOptions) {
    for (const item of list) inventory.add(item, options);
  },

  /** 개발·테스트용 초기화 */
  clear() {
    items.clear();
    hasAutoOpened = false;
    signal.notify();
  },
};

export const useInventory = () => {
  useSyncExternalStore(inventory.subscribe, inventory.version);
  return inventory.list();
};

exposeDevHook("inventory", inventory);

// 개발용 표본 — 지금은 소지품 창을 눈으로 확인할 방법이 이것뿐이다.
// 서버가 붙으면 계약의 clue_acquired 가 inventory.add() 를 부르고, 이 표본과 useDevInventorySeed() 는 지운다.
const DEV_INVENTORY_SEED: InventoryItemInput[] = [
  {
    id: "DEV_KEY_01",
    name: "낡은 열쇠",
    category: "열쇠",
    description: "손잡이에 긁힌 자국이 많다. 어디 것인지는 아직 모른다.",
  },
  {
    id: "DEV_NOTE_01",
    name: "구겨진 쪽지",
    category: "기록",
    description: "날짜만 남고 이름 자리는 뜯겨 나갔다.",
  },
  {
    id: "DEV_NOTE_02",
    name: "압수 목록",
    category: "기록",
    description: "품목 다섯 줄 중 세 번째만 줄이 그어져 있다.",
  },
];

export function useDevInventorySeed() {
  useEffect(() => {
    // silent — 접속하자마자 소지품 창이 튀어나오지 않게. 서버 복원분도 이 길로 들어온다.
    inventory.addMany(DEV_INVENTORY_SEED, { silent: true });
  }, []);
}
