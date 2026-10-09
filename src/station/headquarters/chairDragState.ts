import { exposeDevHook } from "@/debug/devHooks";

/**
 * 끌고 있는 의자의 이번 프레임 자리와 손이 잡을 자리(등받이 윗머리, 사람 쪽 면).
 * 초당 60번 바뀌어 상태가 아니라 상자에 적는다 — 놓을 때 App 이, 팔 IK 목표로 손붙이기가 읽는다.
 */
export const chairDragState = {
  x: 0,
  z: 0,
  /** false 면 손목표가 없다 */
  isHeld: false,
  handX: 0,
  handY: 0,
  handZ: 0,
};

// 끌던 의자가 떨리는지 콘솔에서 숫자로 재려고 연다.
exposeDevHook("chairDrag", chairDragState);
