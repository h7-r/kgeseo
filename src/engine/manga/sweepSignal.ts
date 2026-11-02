/**
 * 만화 재질 훑기를 당겨 부르는 신호. 씬에 물건이 붙으면 훑기가 알아서 돌지만, 붙은 물건의 재질만 갈아 끼우면
 * (스탠드 켬/끔) 느린 안전망까지 기다리게 된다 — 그런 쪽이 이 신호를 울린다. 만화가 꺼져 있으면 아무 일도 없다.
 */
const listeners = new Set<() => void>();

export function requestMangaSweep() {
  listeners.forEach((listener) => listener());
}

export function onMangaSweepRequest(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
