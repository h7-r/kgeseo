import { createStore, useStore } from "@/lib/createStore";

// 게임으로 넘어가기 전에 전환 영상을 트는 동안의 목적지 주소. null 이면 전환 중이 아니다.
const destinationStore = createStore<string | null>(null);

/** 전환 영상을 튼 뒤 이 주소로 페이지를 옮긴다. 이미 전환 중이면 무시한다(연타 방지). */
export function openGameTransition(url: string) {
  if (destinationStore.get()) return;
  destinationStore.set(url);
}

export function closeGameTransition() {
  destinationStore.set(null);
}

export const useGameTransitionDestination = () => useStore(destinationStore, null);
