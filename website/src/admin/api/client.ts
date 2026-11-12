import { apiUrl } from "@/config/env";

/** 관리자 요청이 실패한 까닭. 화면은 이것만 보고 무엇을 보여 줄지 고른다. */
/** invalidQuery = 서버가 질의 값(검색어 · 날짜 등)을 받지 않음(422 invalid_query). */
export type AdminErrorKind = "unauthenticated" | "forbidden" | "notFound" | "invalidQuery" | "server" | "offline";

export class AdminApiError extends Error {
  readonly kind: AdminErrorKind;
  readonly status: number;

  constructor(kind: AdminErrorKind, status: number) {
    super(`관리자 요청 실패: ${kind} (${status})`);
    this.kind = kind;
    this.status = status;
  }
}

// 502~504 는 프록시 · 호스팅이 서버를 못 찾은 경우라 연결 실패로 본다.
function kindOf(status: number): AdminErrorKind {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 422) return "invalidQuery";
  if (status >= 502 && status <= 504) return "offline";
  return "server";
}

/** 쿠키 세션으로 GET 한다. 실패는 AdminApiError 하나로 모아 던진다. */
export async function adminGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), { credentials: "include", headers: { Accept: "application/json" }, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AdminApiError("offline", 0);
  }
  if (!response.ok) throw new AdminApiError(kindOf(response.status), response.status);
  try {
    return (await response.json()) as T;
  } catch {
    throw new AdminApiError("server", response.status);
  }
}

export function toAdminError(error: unknown): AdminApiError {
  return error instanceof AdminApiError ? error : new AdminApiError("server", 0);
}
