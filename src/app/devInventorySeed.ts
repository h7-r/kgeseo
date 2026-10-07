/**
 * 개발용 소지품 표본 — 서버가 붙으면 이 파일과 App 의 useDevInventorySeed() 한 줄을 지운다.
 * 지금은 소지품 창을 눈으로 확인할 방법이 이것뿐이다. 실제로는 계약(v0.3.1)의 clue_acquired 가 오면 inventory.add() 를 부른다.
 */
import { useEffect } from "react";

import { inventory, type InventoryItemInput } from "@/game/inventory";

// 계약의 Clue 와 같은 모양이라 서버 응답을 그대로 꽂을 수 있다.
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
