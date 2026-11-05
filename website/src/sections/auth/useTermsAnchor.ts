import { useState } from "react";

import type { TermsTabId } from "@/data/terms";

export const TERMS_ANCHOR_ID = "auth-terms-anchor";

/** 인증 화면 아래 약관 탭의 상태. 약관 링크는 페이지를 옮기지 않고 내려가 적던 내용이 남는다. */
export function useTermsAnchor() {
  const [tab, setTab] = useState<TermsTabId>("terms");

  const showTerms = (nextTab: TermsTabId) => {
    setTab(nextTab);
    document.getElementById(TERMS_ANCHOR_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return { tab, setTab, showTerms };
}

export type TermsAnchor = ReturnType<typeof useTermsAnchor>;
