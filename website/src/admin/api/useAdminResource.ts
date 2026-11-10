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
    loadRef.current(controller.signal).then(
      (data) => setSettled({ token, resource: { status: "ready", data } }),
      (error: unknown) => {
        if (!controller.signal.aborted)
          setSettled({ token, resource: { status: "error", error: toAdminError(error) } });
      },
    );
    return () => controller.abort();
  }, [token]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return [settled?.token === token ? settled.resource : LOADING, retry];
}
