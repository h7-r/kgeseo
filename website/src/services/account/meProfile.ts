/**
 * GET /me 응답을 세션 사용자로. 로그인·가입 응답(authApi.toSessionUserFromBackend)과 달리
 * /me 는 role 을 주고, created_at · providers 는 BE-3(11/18) 뒤부터 준다 — 옛 서버면 둘이 없어 그 칸은 비워 둔다.
 */
import { parseBackendTimestamp } from "@/lib/serverTime";
import type { SessionUser } from "@/services/session";

/** /me 본문. created_at(ISO 8601, UTC Z) · providers(auth_identities.provider, 알파벳순) 는 아직 없을 수 있다. */
export interface MeBody {
  user_id: string;
  email: string;
  nickname: string;
  region: string | null;
  created_at?: string;
  providers?: string[];
}

/** 가입 방식 이름(서버 provider 값) */
export const PROVIDER_LABEL: Record<string, string> = {
  local: "이메일 가입",
  google: "Google 가입",
  naver: "네이버 가입",
};

type MeSessionFields = Pick<SessionUser, "id" | "email" | "name" | "region"> &
  Partial<Pick<SessionUser, "joinedAt" | "provider" | "providers">>;

/**
 * /me 본문 → 세션 칸. 서버가 안 준 칸은 키 자체를 넣지 않는다 —
 * 호출부가 `{ ...이 탭의 세션, ...이 결과 }` 로 펼칠 때 있던 값을 undefined 로 덮지 않게.
 */
export function toSessionUserFromMe(me: MeBody): MeSessionFields {
  const fields: MeSessionFields = { id: me.user_id, email: me.email, name: me.nickname, region: me.region ?? "" };
  if (typeof me.created_at === "string") fields.joinedAt = parseBackendTimestamp(me.created_at);
  if (Array.isArray(me.providers)) {
    fields.providers = me.providers.filter((provider) => typeof provider === "string");
    // 칩 한 개짜리 옛 칸 — 연결이 여럿이면 첫 것(알파벳순). 빈 목록이면 로그인 때 받은 값을 undefined 로 덮지 않게 둔다
    if (fields.providers.length > 0) fields.provider = fields.providers[0];
  }
  return fields;
}

/** 이 사람의 가입 방식 전부. /me 가 providers 를 주면 그것, 아니면 로그인 때 받은 provider 하나. */
export function providersOf(user: Pick<SessionUser, "provider" | "providers">): string[] {
  if (user.providers) return user.providers;
  return user.provider ? [user.provider] : [];
}

/**
 * 이메일 비밀번호로 로그인하는 계정인가. 소셜 전용이면 false — 비밀번호 변경 · 탈퇴 비밀번호 칸을 보이지 않는다.
 * 연결 전부(/me providers)를 알 때만 판정한다 — 로그인 응답의 provider 하나는 「이번에 Google 로 들어왔다」일 뿐,
 * 이메일 비밀번호도 걸어 둔 사람일 수 있다(보고서 M11 주의). 모르면 undefined — 화면은 지금처럼 그린다.
 */
export function hasPasswordSignIn(user: Pick<SessionUser, "provider" | "providers">): boolean | undefined {
  if (!user.providers || user.providers.length === 0) return undefined;
  return user.providers.includes("local");
}
