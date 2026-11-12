import { useCallback, useEffect, useRef, useState } from "react";

import { toAdminError, type AdminApiError } from "./client";

export type Resource<T> =
  { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: AdminApiError };

const LOADING = { status: "loading" } as const;

/**
 * 서버 값을 한 번 받아 상태로 들고 있는다. key 가 바뀌거나 retry 를 부르면 다시 받는다.
 * 결과에 받을 때의 표식을 붙여, 늦게 도착한 이전 응답이 새 화면을 덮지 않게 한다.
 */
export function useAdminResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
): [resource: Resource<T>, retry: () => void] {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const [attempt, setAttempt] = useState(0);
  const token = `${key}#${attempt}`;
  const [settled, setSettled] = useState<{ token: string; resource: Resource<T> } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // 한 박자 미뤄 보낸다. 개발 모드(StrictMode)는 효과를 켰다 끄고 다시 켜는데, 바로 보내면 첫 요청이 서버에 닿아
    // 관리자 기록(열람 · 조회)이 두 줄 남는다. 미루면 첫 요청은 나가기 전에 지워진다.
    const timer = setTimeout(() => {
      loadRef.current(controller.signal).then(
        (data) => {
          // 취소를 모르는 로더(캐시 · 시험용)가 늦게 답해도 떠난 화면을 덮지 않는다
          if (!controller.signal.aborted) setSettled({ token, resource: { status: "ready", data } });
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            setSettled({ token, resource: { status: "error", error: toAdminError(error) } });
        },
      );
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [token]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return [settled?.token === token ? settled.resource : LOADING, retry];
}
