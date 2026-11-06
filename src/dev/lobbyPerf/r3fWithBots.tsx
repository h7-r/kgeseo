/* eslint-disable react-refresh/only-export-components -- R3F 를 통째로 다시 내보내는 대역 모듈이다 */
// 0단계 성능 측정 전용 대역. vite.lobby-perf.config.ts 가 src/app/App.tsx 의 `@react-three/fiber` import 만
// 이 파일로 돌린다. 나머지는 원래 R3F 그대로이고, Canvas 만 감싸 가짜 아바타와 측정 패널을 덧붙인다.
// 그래서 App.tsx 를 고치지 않고도 실제 게임과 같은 Canvas·씬·후처리 위에서 잴 수 있다.
import type { ComponentProps } from "react";
import { Canvas as BaseCanvas } from "@react-three/fiber";

import LobbyPerfRig from "./LobbyPerfRig";
import PerfPanel from "./PerfPanel";

export * from "@react-three/fiber";

export function Canvas({ children, ...props }: ComponentProps<typeof BaseCanvas>) {
  return (
    <>
      <BaseCanvas {...props}>
        {children}
        <LobbyPerfRig />
      </BaseCanvas>
      <PerfPanel />
    </>
  );
}
