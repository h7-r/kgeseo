import { useCallback, useEffect, useState } from "react";

import type { MyProgress } from "@/lib/myProgress";
import { fetchMyProgress } from "@/services/account/myProgress";

export type MyProgressState =
  { status: "loading" } | { status: "ready"; progress: MyProgress } | { status: "signedOut" } | { status: "error" };

/**
 * 내 진행을 서버에서 읽는다. 계정이 바뀌면(로그아웃 → 다른 계정) 들고 있던 값을 버리고 새로 읽는다.
 * userId 가 없으면(로그인 전) 읽지 않는다.
 */
export function useMyProgress(userId: string | undefined) {
  const [state, setState] = useState<{ userId: string | undefined; value: MyProgressState }>({
    userId,
    value: { status: "loading" },
  });
  const [attempt, setAttempt] = useState(0);
  // 계정이 바뀐 첫 그림에서 앞 계정 값을 한 번도 보이지 않게 그 자리에서 비운다.
  const current: MyProgressState = state.userId === userId ? state.value : { status: "loading" };

  useEffect(() => {
    if (!userId) return;
    let isActive = true;
    void fetchMyProgress().then((result) => {
      if (isActive) setState({ userId, value: result });
    });
    return () => {
      isActive = false;
    };
  }, [userId, attempt]);

  const reload = useCallback(() => {
    setState({ userId, value: { status: "loading" } });
    setAttempt((count) => count + 1);
  }, [userId]);

  return { state: current, reload };
}
