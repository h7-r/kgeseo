/** 모바일 페이지 틀 — 머리띠 아래에서 시작하고 바닥글을 붙인다 */
import type { CSSProperties, ReactNode } from "react";

import MobileFooter from "./MobileFooter";
import { MOBILE_HEADER_HEIGHT } from "./mobileStyles";

export default function MobilePage({ children, hasFooter = true }: { children: ReactNode; hasFooter?: boolean }) {
  return (
    <>
      <main style={mainStyle}>{children}</main>
      {hasFooter && <MobileFooter />}
    </>
  );
}

// 배경(MobileBackdrop · fixed z 0)보다 위 층 — 위치 지정이 없는 글은 fixed 층 아래에 깔린다
const mainStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  paddingTop: `calc(env(safe-area-inset-top, 0px) + ${MOBILE_HEADER_HEIGHT}px)`,
  minHeight: "60dvh",
};
