import { useSyncExternalStore } from "react";

import type { Video } from "@/data/videos";

/*
 * 컴포넌트 트리 밖에서 바꾸고 화면은 구독만 하는 작은 전역 상태들.
 * 여는 쪽과 그리는 쪽(App 에 한 번 놓인 층)이 멀리 떨어져 있어 모듈에 둔다.
 */

interface Store<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

/** 같은 값이면 알리지 않는다. */
function createStore<T>(initial: T): Store<T> {
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

function useStore<T>(store: Store<T>, serverValue: T): T {
  return useSyncExternalStore(store.subscribe, store.get, () => serverValue);
}

// 히어로가 창 전체를 덮는 동안에는 뒤의 3D 배경을 그리지 않는다.
const heroCoverStore = createStore(false);

export const setHeroCovering = (covering: boolean) => heroCoverStore.set(covering);

export const useHeroCovering = () => useStore(heroCoverStore, false);

// 게임으로 넘어가기 전에 전환 영상을 트는 동안의 목적지 주소. null 이면 전환 중이 아니다.
const gameDestinationStore = createStore<string | null>(null);

/** 전환 영상을 튼 뒤 이 주소로 페이지를 옮긴다. 이미 전환 중이면 무시한다(연타 방지). */
export function openGameTransition(url: string) {
  if (gameDestinationStore.get()) return;
  gameDestinationStore.set(url);
}

export function closeGameTransition() {
  gameDestinationStore.set(null);
}

export const useGameTransitionDestination = () => useStore(gameDestinationStore, null);

/** 작은 자리(원·카드)가 영상 모달을 열 때 넘기는 것. */
export interface VideoModalRequest {
  video: Video;
  /** 모달이 커지기 시작하고, 닫힐 때 다시 줄어드는 요소. 닫을 때 자리를 다시 잰다. */
  origin: HTMLElement;
  /** 커지기 시작할 때의 모서리 반경(원이면 "50%", 카드면 "12px" 등). */
  originRadius: string;
  /** 작은 자리에서 보던 장면(초). 모달이 여기서부터 잇는다. */
  startTime: number;
  /** 모달이 닫히면 모달이 보던 장면(초)을 돌려준다. */
  onReturn: (time: number) => void;
}

const videoModalStore = createStore<VideoModalRequest | null>(null);

export function openVideoModal(request: VideoModalRequest) {
  videoModalStore.set(request);
}

/** 모달이 줄어드는 연출을 끝낸 뒤 부른다. */
export function closeVideoModal() {
  videoModalStore.set(null);
}

export const useVideoModalRequest = () => useStore(videoModalStore, null);
