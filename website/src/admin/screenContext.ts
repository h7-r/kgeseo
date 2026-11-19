import { createContext, useContext } from "react";

import type { AdminScreen } from "./screens";

/** 지금 그리는 관리자 화면의 설정. ScreenRoute 가 넣고 PageHeader 가 제목 · 설명을 꺼낸다. */
export const ScreenContext = createContext<AdminScreen | null>(null);

export function useCurrentScreen(): AdminScreen {
  const screen = useContext(ScreenContext);
  if (!screen) throw new Error("useCurrentScreen 은 ScreenRoute 안에서만 쓴다.");
  return screen;
}
