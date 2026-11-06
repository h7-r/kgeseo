/* eslint-disable react-refresh/only-export-components -- R3F 를 통째로 다시 내보내는 대역 모듈이다 */
// 로비 실제 화면 미리보기 전용 대역. vite.lobby-preview.config.ts 가 src/app/App.tsx 의 `@react-three/fiber` import 만
// 이 파일로 돌린다. 나머지는 원래 R3F 그대로이고, Canvas 만 감싸 로비 연결·다른 사람 그리기·인사창을 덧붙인다.
// App.tsx 를 고치지 않고 실제 본부실에서 로비를 눈으로 본다(3단계 정식 연결 전).
import type { ComponentProps } from "react";
import { Canvas as BaseCanvas } from "@react-three/fiber";

import LobbyPreviewHud from "./LobbyPreviewHud";
import LobbyPreviewRig from "./LobbyPreviewRig";

export * from "@react-three/fiber";

export function Canvas({ children, ...props }: ComponentProps<typeof BaseCanvas>) {
  return (
    <>
      <BaseCanvas {...props}>
        {children}
        <LobbyPreviewRig />
      </BaseCanvas>
      <LobbyPreviewHud />
    </>
  );
}
