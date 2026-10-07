/**
 * 모듈 바깥에 둔 상태 상자가 "바뀌었다"를 알리는 신호.
 * 화면은 숫자(version)만 구독하고 내용은 그때 꺼내 읽는다 — 객체를 스냅샷으로 주면
 * 매번 다른 값으로 보여 useSyncExternalStore 가 끝없이 다시 그린다.
 */
export interface ChangeSignal {
  version(): number;
  subscribe(listener: () => void): () => void;
  notify(): void;
  listenerCount(): number;
}

export function createChangeSignal(): ChangeSignal {
  let version = 0;
  const listeners = new Set<() => void>();

  return {
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify() {
      version += 1;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}
