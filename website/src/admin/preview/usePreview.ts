import { useEffect, useState } from "react";

import type { PreviewData } from "./types";

/*
 * 디자인 확인용 가짜 데이터. 개발 빌드에서 주소에 ?preview=1 을 붙였을 때만 켜진다.
 * 운영 빌드는 import.meta.env.DEV 가 false 로 접혀 mockData 청크가 아예 만들어지지 않는다.
 * 관리자 안에서 메뉴를 옮겨도(주소의 ?preview 가 빠져도) 새로고침 전까지 켜진 채로 둔다. ?preview=0 이면 끈다.
 */
let isRequested = false;
let cached: PreviewData | null = null;

export function isPreviewActive(): boolean {
  if (!import.meta.env.DEV) return false;
  const value = new URLSearchParams(window.location.search).get("preview");
  if (value === "1") isRequested = true;
  else if (value === "0") isRequested = false;
  return isRequested;
}

/** 미리보기가 꺼져 있으면 늘 null. 켜져 있으면 가짜 데이터를 받아 돌려준다. */
export function usePreviewData(): PreviewData | null {
  const [data, setData] = useState(cached);

  useEffect(() => {
    if (!import.meta.env.DEV || data || !isPreviewActive()) return;
    let isMounted = true;
    void import("./mockData").then((module) => {
      cached = module.PREVIEW_DATA;
      if (isMounted) setData(cached);
    });
    return () => {
      isMounted = false;
    };
  }, [data]);

  // ?preview=0 으로 끈 뒤에는 받아 둔 값이 있어도 내주지 않는다.
  return data && isPreviewActive() ? data : null;
}
