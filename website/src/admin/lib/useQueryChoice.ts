import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * 탭 · 필터를 주소 질의(?name=)에 둔다. 새로고침 · 뒤로 가기에서도 같은 화면이 나온다.
 * 기본값이면 질의에서 빼 주소를 짧게 둔다. replace 로 바꿔 누를 때마다 기록이 쌓이지 않게 한다.
 */
export function useQueryChoice<T extends string>(
  name: string,
  options: readonly { id: T }[],
  fallback: T,
): [value: T, setValue: (next: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(name);
  const value = options.find((option) => option.id === raw)?.id ?? fallback;

  const setValue = useCallback(
    (next: T) =>
      setParams(
        (previous) => {
          const updated = new URLSearchParams(previous);
          if (next === fallback) updated.delete(name);
          else updated.set(name, next);
          return updated;
        },
        { replace: true },
      ),
    [fallback, name, setParams],
  );

  return [value, setValue];
}
