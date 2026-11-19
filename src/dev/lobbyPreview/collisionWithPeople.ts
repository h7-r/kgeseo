// 로비 미리보기 전용 — src/station/layout/usePlayer.ts 가 가져오는 `./collision` 대역(vite.lobby-preview.config.ts).
// 원래 모듈을 그대로 쓰고, 내 걷기 판정(높이를 주지 않는 호출)에만 다른 사람 몸통을 더한다. 높이를 주는 3인칭 붐은 그대로.
// 3단계에서는 usePlayer 의 isBlocked 를 이렇게 합쳐 정식으로 넣는다(해랑 님 파일).
import { isBlockedForPlayer as isBlockedByStation } from "@/station/layout/collision";

import { isBlockedByPerson } from "./personColliders";

export * from "@/station/layout/collision";

export const isBlockedForPlayer = (x: number, z: number, y?: number): boolean =>
  isBlockedByStation(x, z, y) || (y === undefined && isBlockedByPerson(x, z));
