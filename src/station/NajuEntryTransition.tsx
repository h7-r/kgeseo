/**
 * 홀로그램 텔레포트 → 나주 맵 사이의 전환. `kgeseo:naju-enter` 를 받으면 나주 진입 영상으로 덮고
 * 0.9초 뒤 /naju01/ 로 페이지째 넘어간다. 넘기기 직전 지금 장면을 적어 두어 나주 페이지가 같은 장면부터 잇는다.
 * 오래 걸리는 건 넘어간 뒤(나주 맵 읽기)라 그 시간 전체를 영상이 가린다.
 */
import { useEffect, useRef } from "react";

import { continueLoadingVideoAt, showLoadingVideo } from "@/naju";
import { NAJU_ENTER_EVENT } from "@/station/najuEnter";

// 영상이 화면을 덮고(0.7초 페이드) 첫 장면이 흐른 뒤 넘어간다
const COVER_THEN_LEAVE_MS = 900;

export default function NajuEntryTransition() {
  const isStarted = useRef(false); // E 를 연타하거나 길게 눌러도 한 번만
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 리스너는 마운트 때 한 번만 건다. 상태에 의존하면 바뀌는 순간 cleanup 이 방금 건 타이머를 취소한다.
  useEffect(() => {
    const handleEnter = (event: WindowEventMap[typeof NAJU_ENTER_EVENT]) => {
      if (isStarted.current) return;
      isStarted.current = true;
      const query = event.detail?.query || "";
      // 문자열로 이으면 쿼리 유무에 따라 ??from=hub 가 되기 쉬워 URL 로 얹는다.
      const destination = new URL("/naju01/index.html" + query, window.location.origin);
      destination.searchParams.set("from", "hub");
      // 이 페이지에서는 걷지 않는다 — 준비를 기다릴 대상은 다음 페이지(나주 맵)다
      showLoadingVideo("naju", { keepOpen: true });
      timer.current = setTimeout(() => continueLoadingVideoAt(destination.toString()), COVER_THEN_LEAVE_MS);
    };
    window.addEventListener(NAJU_ENTER_EVENT, handleEnter);
    // 나주에서 「뒤로」 로 돌아오면(bfcache) 다시 탈 수 있게 잠금을 푼다
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) isStarted.current = false;
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener(NAJU_ENTER_EVENT, handleEnter);
      clearTimeout(timer.current);
    };
  }, []);

  // 화면에 그리는 건 main 의 로딩영상판이 한다 — 여기는 신호만 받아 넘긴다
  return null;
}
