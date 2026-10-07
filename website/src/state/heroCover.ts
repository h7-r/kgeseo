import { createStore, useStore } from "@/lib/createStore";

// 히어로가 창 전체를 덮는 동안에는 뒤의 3D 배경을 그리지 않는다.
const heroCoverStore = createStore(false);

export const setHeroCovering = (covering: boolean) => heroCoverStore.set(covering);

export const useHeroCovering = () => useStore(heroCoverStore, false);
