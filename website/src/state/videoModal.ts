import type { Video } from "@/data/videos";
import { createStore, useStore } from "@/lib/createStore";

/** 작은 자리(원·카드)가 모달을 열 때 넘기는 것. */
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

// 여는 쪽(원·카드)과 그리는 쪽(App 에 한 번 놓인 모달)이 멀리 떨어져 있어 모듈 저장소에 둔다.
const requestStore = createStore<VideoModalRequest | null>(null);

export function openVideoModal(request: VideoModalRequest) {
  requestStore.set(request);
}

/** 모달이 줄어드는 연출을 끝낸 뒤 부른다. */
export function closeVideoModal() {
  requestStore.set(null);
}

export const useVideoModalRequest = () => useStore(requestStore, null);
