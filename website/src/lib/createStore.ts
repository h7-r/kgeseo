import { useSyncExternalStore } from "react";

export interface Store<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

/** 컴포넌트 트리 밖에서 값을 바꾸고 화면은 구독만 하는 작은 전역 상태. 같은 값이면 알리지 않는다. */
export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T>(store: Store<T>, serverValue: T = store.get()): T {
  return useSyncExternalStore(store.subscribe, store.get, () => serverValue);
}
