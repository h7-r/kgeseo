/**
 * 가상 마우스 잠금 — 터치 모드에서 「조작 중」을 마우스 잠금과 같은 뜻으로 쓴다.
 *
 * 왜: 본편·나주는 창을 열 때 controls.unlock(), 닫을 때 controls.lock() 을 불러 「조작 중」을 오간다(나주만 13곳).
 * 터치 모드에서도 이 흐름을 그대로 살리면 창·자물쇠·동행 입력 코드를 하나도 안 고친다.
 * 그래서 PointerLockControls 인스턴스의 lock/unlock 을 덮어써, 터치 모드에서는 진짜 잠금 대신
 * isLocked 만 바꾸고 lock/unlock 이벤트를 낸다(drei 가 이 이벤트로 onLock/onUnlock 을 부른다).
 *
 * 아이폰 Safari 에는 requestPointerLock 이 없어 원래 lock() 이 TypeError 를 낸다 — 덮어쓰기로 같이 막힌다.
 * document.pointerLockElement 를 읽던 곳은 isPointerActive() 로 바꾼다(진짜 잠금 || 가상 잠금).
 */
import type { PointerLockControls } from "three-stdlib";

import { isTouchMode, subscribeTouchMode } from "./touchMode";

/** 가상 잠금이 바뀌면 document 에 이 이벤트가 난다 — pointerlockchange 와 같이 들으면 된다 */
export const VIRTUAL_LOCK_EVENT = "virtualpointerlockchange";

let virtualLocked = false;
/** 가상 잠금을 심은 조작기들 — 터치 노트북이 마우스로 돌아오면 「풀림」으로 되돌린다 */
const patchedControls = new Set<PatchableControls>();

function setVirtualLocked(next: boolean) {
  if (virtualLocked === next) return;
  virtualLocked = next;
  if (typeof document !== "undefined") document.dispatchEvent(new Event(VIRTUAL_LOCK_EVENT));
}

/** 조작 중인가 — 진짜 마우스 잠금이거나 터치 모드의 가상 잠금 */
export function isPointerActive(): boolean {
  return virtualLocked || (typeof document !== "undefined" && !!document.pointerLockElement);
}

export function isVirtuallyLocked(): boolean {
  return virtualLocked;
}

/** pointerlockchange · 가상 잠금 변화를 함께 듣는다 */
export function addPointerActiveListener(listener: () => void): () => void {
  document.addEventListener("pointerlockchange", listener);
  document.addEventListener(VIRTUAL_LOCK_EVENT, listener);
  return () => {
    document.removeEventListener("pointerlockchange", listener);
    document.removeEventListener(VIRTUAL_LOCK_EVENT, listener);
  };
}

/** 덮어쓸 private 멤버까지 보이는 모양 */
interface PatchableControls {
  isLocked: boolean;
  domElement?: HTMLElement;
  onMouseMove: (event: MouseEvent) => void;
  onPointerlockChange: () => void;
  connect: (domElement: HTMLElement) => void;
  disconnect: () => void;
  lock: () => void;
  unlock: () => void;
  dispatchEvent: (event: { type: "lock" | "unlock" }) => void;
  __virtualLockPatched?: boolean;
}

/**
 * PointerLockControls 인스턴스에 가상 잠금을 심는다. 같은 인스턴스에 두 번 불러도 한 번만 한다.
 * drei 가 먼저 connect 해 둔 리스너는 원래 함수라, 끊고 → 지킴 함수로 바꾸고 → 다시 붙인다.
 */
export function installVirtualLock(target: PointerLockControls | null | undefined) {
  const controls = target as unknown as PatchableControls | null | undefined;
  if (!controls || controls.__virtualLockPatched) return;
  controls.__virtualLockPatched = true;
  patchedControls.add(controls);

  const realLock = controls.lock;
  const realUnlock = controls.unlock;
  const realMouseMove = controls.onMouseMove;
  const realLockChange = controls.onPointerlockChange;
  const domElement = controls.domElement;

  controls.disconnect();
  controls.lock = () => {
    if (isTouchMode()) {
      if (controls.isLocked) return;
      controls.isLocked = true;
      setVirtualLocked(true);
      controls.dispatchEvent({ type: "lock" });
      return;
    }
    // 잠금이 없는 브라우저에서 원래 lock() 은 TypeError 를 낸다
    if (typeof controls.domElement?.requestPointerLock !== "function") return;
    realLock();
  };
  controls.unlock = () => {
    if (virtualLocked || isTouchMode()) {
      if (!controls.isLocked) return;
      controls.isLocked = false;
      setVirtualLocked(false);
      controls.dispatchEvent({ type: "unlock" });
      return;
    }
    realUnlock();
  };
  // 터치 모드에서 아이패드 트랙패드의 mousemove 가 시점을 돌리지 않게
  controls.onMouseMove = (event) => {
    if (isTouchMode()) return;
    realMouseMove(event);
  };
  // 가상 잠금 중에 난 「잠금 풀림」 pointerlockchange 는 가상 잠금을 풀지 않게. 그 밖(진짜 잠금이 잡힘 · 진짜 잠금이 풀림)은 원래대로 —
  // 진짜 잠금이 잡히면 터치 모드가 먼저 꺼지고(touchMode 의 리스너가 먼저 붙어 있다) 여기서 isLocked 를 세운다.
  controls.onPointerlockChange = () => {
    if (virtualLocked && !document.pointerLockElement) return;
    realLockChange();
  };
  if (domElement) controls.connect(domElement);
  // 조작기가 새로 만들어졌다(카메라 교체 · 다시 붙음) — 가상 잠금 중이면 새 조작기도 잠긴 상태로 이어받는다.
  // 안 그러면 isLocked 가 false 라 손가락 시점이 안 돌고 unlock() 도 먹지 않는다(코덱스 구현 02회차)
  if (virtualLocked && isTouchMode()) controls.isLocked = true;
}

// 터치 모드가 꺼지면 가상 잠금을 내려놓는다.
//  · 진짜 잠금이 잡혀 꺼졌다 — 진짜 잠금 쪽 이벤트가 isLocked 를 다시 세운다.
//  · 마우스로 눌러 꺼졌다(터치 노트북, touchMode) — 아직 진짜 잠금이 없으니 조작기를 「풀림」으로 돌린다. 안 그러면 isLocked 가
//    참으로 남아 잠금 없이 마우스만 움직여도 시점이 돌고, 화면은 조작 중으로 안다. 그 뒤는 PC 흐름(T 로 잠그기)을 따른다.
subscribeTouchMode(() => {
  if (isTouchMode() || !virtualLocked) return;
  setVirtualLocked(false);
  if (typeof document !== "undefined" && document.pointerLockElement) return;
  for (const controls of patchedControls) {
    if (!controls.isLocked) continue;
    controls.isLocked = false;
    controls.dispatchEvent({ type: "unlock" });
  }
});
