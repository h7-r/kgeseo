import { appendUnique } from "../lib/memberSearch";
import { adminGet } from "./client";

/** 서버 schemas/account_data.py 의 AdminUserSummary. */
export interface AdminUserSummary {
  user_id: string;
  email: string;
  nickname: string;
  role: string;
  created_at: string;
  stage: string | null;
  save_updated_at: string | null;
}

/** 목록 한 줄 — 위 칸에 관리자 API v0.2 §3.1 칸을 더한다. 상세의 user 는 위 칸만 있다. */
export interface AdminUserListItem extends AdminUserSummary {
  region: string | null;
  /** local · google · naver. 연결이 없으면 [] */
  providers: string[];
  /** 실제 로그인 시각 — 서버에 칸이 아직 없어 늘 null(베타 이후) */
  last_login_at: string | null;
  /** 로그인 · 가입 때 만든 세션의 시각(추정값) */
  last_session_started_at: string | null;
}

interface AdminUserPage {
  users: AdminUserListItem[];
  next_offset: number | null;
}

export interface AdminGameSave {
  revision: number;
  schema_version: number;
  stage: string;
  state: { sections?: Record<string, unknown> } & Record<string, unknown>;
  updated_at: string;
}

export interface AdminCharacter {
  display_name: string;
  appearance: Record<string, unknown>;
  updated_at: string;
}

export interface AdminOwnedItem {
  item_id: string;
  kind: string;
  name: string;
  quantity: number;
  source: string;
  acquired_at: string;
}

export interface AdminUserDetail {
  user: AdminUserSummary;
  save: AdminGameSave | null;
  character: AdminCharacter | null;
  items: AdminOwnedItem[];
}

/** 서버가 한 번에 주는 회원 수(admin.py PAGE_SIZE). */
export const USER_PAGE_SIZE = 50;

/** q 는 readMemberSearch 를 거친 검색어 — 닉네임은 일부, 이메일은 전체가 같아야 찾는다. 검색어는 서버 기록에 남지 않는다. */
export function fetchUserPage(offset: number, q: string | undefined, signal?: AbortSignal) {
  const params = new URLSearchParams({ offset: String(offset) });
  if (q) params.set("q", q);
  return adminGet<AdminUserPage>(`/api/v1/admin/users?${params}`, signal);
}

export const fetchUserDetail = (userId: string, signal?: AbortSignal) =>
  adminGet<AdminUserDetail>(`/api/v1/admin/users/${encodeURIComponent(userId)}`, signal);

export interface LoadedUsers {
  users: AdminUserListItem[];
  nextOffset: number | null;
}

export const userIdOf = (user: AdminUserSummary) => user.user_id;

/** 첫 쪽부터 count 명을 채울 때까지 이어 받는다. 새로고침 · 뒤로 가기에서 보던 만큼 되살릴 때 쓴다. */
export async function fetchUsersUpTo(count: number, signal?: AbortSignal, q?: string): Promise<LoadedUsers> {
  let users: AdminUserListItem[] = [];
  let nextOffset: number | null = 0;
  while (nextOffset !== null && users.length < count) {
    const page = await fetchUserPage(nextOffset, q, signal);
    users = appendUnique(users, page.users, userIdOf);
    nextOffset = page.next_offset;
  }
  return { users, nextOffset };
}
