/**
 * 지금 플레이어의 발 자리(미터) — 걷기 훅이 매 프레임 적는다.
 * 퍼즐이 「딛고 섰나」를 볼 때 눈높이를 어림잡아 빼지 않고 이것을 읽는다 — 눈높이는 설정값이라 코드마다 다르게 적으면 어긋난다.
 */
import { exposeDevHook } from "@/debug/devHooks";

import type { Terrain } from "../terrain/terrain";

export const playerPose = { x: 0, footY: 0, z: 0, eyeHeight: 1.6, isGrounded: true };

/**
 * 플레이어가 실제로 걷는 지형(높이표 · 물굴 포함) — 걷기 훅이 적는다.
 * 물건을 놓거나 물 위인지 볼 때 이걸 읽는다. 해석식 지형과는 물가에서 1 m 넘게 어긋나 물건이 모래에 묻힌다.
 */
export const walkTerrain: { current: Pick<Terrain, "groundAt" | "blockedAt"> | null } = { current: null };

exposeDevHook("najuPlayerPose", playerPose);
