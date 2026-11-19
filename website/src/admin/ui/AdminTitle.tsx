import { useEffect } from "react";

import { adminTitle } from "../lib/documentTitle";

/** 그려지는 동안 탭 제목을 관리자 제목으로 둔다. 틀(사이드바) 밖 화면 — 권한 확인 · 권한 없음 · 연결 오류 — 에서 쓴다. */
export default function AdminTitle({ label }: { label?: string }) {
  useEffect(() => {
    document.title = adminTitle(label);
  }, [label]);
  return null;
}
