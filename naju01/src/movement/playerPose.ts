/**
 * 지금 플레이어의 발 자리(미터) — 걷기 훅이 매 프레임 적는다.
 * 퍼즐이 「딛고 섰나」를 볼 때 눈높이를 어림잡아 빼지 않고 이것을 읽는다 — 눈높이는 설정값이라 코드마다 다르게 적으면 어긋난다.
 */
import { exposeDevHook } from "@/debug/devHooks";

export const playerPose = { x: 0, footY: 0, z: 0, eyeHeight: 1.6, isGrounded: true };

exposeDevHook("najuPlayerPose", playerPose);
