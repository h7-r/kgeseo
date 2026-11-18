/**
 * 계정 저장의 지금 상태 — 멈춤 메뉴 · 안내가 「로그인 안 함」 「세션 끊김」 「불러오기 실패」를 갈라 말하게(인증 점검 M14, 11/18).
 * 전에는 참 · 거짓 하나(isLoggedIn)라 세션이 끊겨도(401) 「로그인하지 않아…」로 보였다.
 *   guest            로그인 안 함(또는 개발 서버 ?fresh) — 저장 없이 돈다
 *   load_failed      저장을 불러오지 못했다 — 저장을 멈춘다(gameSaveLoad 가 안내)
 *   saving           저장 중
 *   signed_out       저장 중이었는데 세션이 끊겼다(401 — 다른 탭 로그아웃 · 탈퇴 · 14일 만료). 다시 로그인하면 이어진다
 *   account_changed  저장 중이었는데 쿠키가 다른 계정의 세션이 됐다 — 그 계정의 저장을 이 창 값으로 덮지 않게 멈춘다. 새로고침해야 한다
 * React · 별칭(@/) · import.meta.env 를 쓰지 않는다(naju01/tests 의 node --test 가 바로 읽는다).
 */

export type SaveStatus = "guest" | "load_failed" | "saving" | "signed_out" | "account_changed";

/** 서버 응답 한 벌 — 상태 코드와 JSON 본문(없으면 null) */
export interface JsonAnswer {
  status: number;
  body: unknown;
}

/** 상태 하나를 들고, 바뀌면 알린다(멈춤 메뉴 · 안내가 useSyncExternalStore 로 본다) */
export function createSaveStatusStore(initial: SaveStatus = "guest") {
  let status = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => status,
    set(next: SaveStatus) {
      if (status === next) return;
      status = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type SaveStatusStore = ReturnType<typeof createSaveStatusStore>;

/** GET /me 응답에서 계정 id 를 읽는다 — 200 이 아니거나 모양이 틀리면 null */
export function readAccountId(answer: JsonAnswer): string | null {
  if (answer.status !== 200 || !answer.body || typeof answer.body !== "object") return null;
  const { user_id } = answer.body as { user_id?: unknown };
  return typeof user_id === "string" && user_id ? user_id : null;
}

/** PUT /me/game-save 409 본문의 서버 revision(detail.revision) — 없으면 null */
export function readConflictRevision(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const { detail } = body as { detail?: { revision?: unknown } | string | null };
  if (!detail || typeof detail !== "object") return null;
  return typeof detail.revision === "number" ? detail.revision : null;
}

export type ConflictDecision = "retry" | "signed_out" | "account_changed";

/**
 * 409 뒤 최신 번호로 한 번 더 쓰기 전에 — 쿠키의 계정이 처음 불러온 계정과 같은지 /me 로 본다.
 * 다른 탭에서 로그아웃하고 다른 계정으로 들어오면 쿠키가 바뀌는데, 그대로 다시 쓰면 그 계정의 저장을 이 창 값으로 덮는다(M13).
 *   401            세션이 끊겼다 → signed_out
 *   다른 user_id   계정이 바뀌었다 → account_changed
 *   같다 · 못 봄    retry — 처음에 계정 id 를 못 읽었거나(accountId null) /me 가 잠깐 안 되면 비교할 수 없어 지금까지처럼 다시 쓴다
 */
export function decideConflictRetry(me: JsonAnswer, accountId: string | null): ConflictDecision {
  if (me.status === 401) return "signed_out";
  const current = readAccountId(me);
  if (accountId !== null && current !== null && current !== accountId) return "account_changed";
  return "retry";
}
