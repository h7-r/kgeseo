import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import { QUERY } from "@/navigation/routes";

/**
 * 탭을 주소의 ?tab= 으로 들고 있는다. 하위 메뉴와 페이지 안 탭 단추가 늘 같은 탭을 가리킨다.
 * replace 로 바꿔서 탭을 누를 때마다 뒤로가기 기록이 쌓이지 않는다.
 */
export function useQueryTab<T extends string>(
  tabs: readonly { readonly id: T }[],
  fallback: T,
): [tab: T, setTab: (next: T) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(QUERY.tab);
  const tab = tabs.find((item) => item.id === value)?.id ?? fallback;
  const setTab = useCallback(
    (next: T) =>
      setParams(
        (previous) => {
          const updated = new URLSearchParams(previous);
          updated.set(QUERY.tab, next);
          return updated;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [tab, setTab];
}
