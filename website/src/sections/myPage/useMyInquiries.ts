import { useEffect, useState } from "react";

import { fetchMyInquiries, type MyInquiry } from "@/services/inquiries";

/** "loading" 은 받는 중, null 은 못 받음 */
export type MyInquiriesState = readonly MyInquiry[] | null | "loading";

/**
 * 서버의 내 문의(/me/inquiries). 데스크톱 · 모바일 마이페이지가 같은 값을 본다.
 * 탭을 열 때마다 새로 받고(답변이 달렸을 수 있다), 계정이 바뀌면 들고 있던 값을 버린다.
 * 받은 결과에 「누구 · 열렸는가」표식을 붙여 둔다 — 표식이 다르면 아직 받는 중으로 본다(효과 안에서 바로 setState 하지 않게).
 */
export function useMyInquiries(userId: string | undefined, isOpen: boolean): MyInquiriesState {
  const key = `${userId ?? ""}:${isOpen ? "open" : "closed"}`;
  const [loaded, setLoaded] = useState<{ key: string; items: MyInquiry[] | null } | null>(null);

  useEffect(() => {
    if (!userId || !isOpen) return;
    const controller = new AbortController();
    void fetchMyInquiries(controller.signal).then((items) => {
      if (!controller.signal.aborted) setLoaded({ key, items });
    });
    return () => controller.abort();
  }, [userId, isOpen, key]);

  return loaded?.key === key ? loaded.items : "loading";
}
