import type { ComponentType } from "react";

import { isPreviewActive } from "../preview/usePreview";
import { ScreenContext } from "../screenContext";
import type { AdminScreen } from "../screens";
import PageHeader from "../ui/PageHeader";
import { PendingScreen } from "../ui/StatusScreen";

export interface ScreenView {
  Component: ComponentType;
  /** 제목 오른쪽 단추 · 탭. 준비 중일 때도 같은 자리에 그린다. */
  HeaderActions?: ComponentType;
}

/**
 * 화면 하나의 틀. 제목 · 설명은 화면 설정에서 가져오고,
 * 서버 API 전(pending)인 화면은 미리보기가 아니면 여기서 「준비 중」으로 막는다 — 화면 코드는 실제 · 미리보기 내용만 그린다.
 */
export default function ScreenRoute({ screen, view }: { screen: AdminScreen; view: ScreenView }) {
  const { Component, HeaderActions } = view;
  const isBlocked = screen.status === "pending" && screen.pendingNote !== undefined && !isPreviewActive();

  return (
    <ScreenContext value={screen}>
      {!screen.ownHeader && <PageHeader actions={HeaderActions && <HeaderActions />} />}
      {isBlocked ? <PendingScreen needs={screen.pendingNote ?? ""} /> : <Component />}
    </ScreenContext>
  );
}
