// 로비 미리보기 전용 — src/app/App.tsx 가 가져오는 `./playerState` 대역(vite.lobby-preview.config.ts 가 App 의 import 만 돌린다).
// 원래 모듈을 그대로 쓰고, usePunch 가 받는 실제 playerRef 를 미리보기에 등록·해제만 한다. App 은 고치지 않는다.
// (createPlayerState 를 감싸 「마지막에 만든 상자」를 잡으면 안 된다 — App 은 useRef(createPlayerState()) 라
//  다시 그릴 때마다 함수는 돌지만 실제로 쓰는 상자는 첫 것이다. Codex 09)
import { useEffect } from "react";

import { usePunch as originalUsePunch } from "@/app/playerState";

import { registerLocalPlayer, unregisterLocalPlayer } from "./localPlayer";

export * from "@/app/playerState";

export function usePunch(options: Parameters<typeof originalUsePunch>[0]) {
  originalUsePunch(options);
  const { playerRef } = options;
  useEffect(() => {
    registerLocalPlayer(playerRef);
    return () => unregisterLocalPlayer(playerRef);
  }, [playerRef]);
}
