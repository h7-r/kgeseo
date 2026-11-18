import { appendUnique } from "../lib/paging";
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

/** 목록 한 줄 — 위 칸에 관리자 API v0.2 §3.1 칸을 더한다(서버 schemas/admin.py 의 AdminUserListItem). 상세의 user 도 같은 칸을 준다(#167, 계약 admin_last_login.md §4). */
export interface AdminUserListItem extends AdminUserSummary {
  region: string | null;
  /** local · google · naver. 연결이 없으면 [] */
  providers: string[];
  /** 마지막으로 새 로그인 세션을 발급한 시각(가입 · 로그인 · 소셜 가입 완료). 쿠키로 계속 쓰는 동안은 바뀌지 않는다 */
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

/** 상세의 user — 목록 칸에 탈퇴 시각을 더한다(서버 schemas/account_data.py 의 AdminUserDetailUser, 탈퇴 1단계 #177). */
export interface AdminUserDetailUser extends AdminUserListItem {
  /**
   * 회원 탈퇴 시각. 회원이면 null. 탈퇴 회원은 목록에 안 나오지만 활동 로그의 id 로 열면 이 값으로 알 수 있다 —
   * 그때 이메일 · 닉네임은 비식별화된 값이고 region · last_login_at 은 null, providers 는 [] 이다(계약 account_withdrawal_v0.2.md §11)
   */
  deleted_at: string | null;
}

export interface AdminUserDetail {
  user: AdminUserDetailUser;
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
export async function fetchUsersUpTo(count: number, q: string | undefined, signal?: AbortSignal): Promise<LoadedUsers> {
  let users: AdminUserListItem[] = [];
  let nextOffset: number | null = 0;
  while (nextOffset !== null && users.length < count) {
    const page = await fetchUserPage(nextOffset, q, signal);
    users = appendUnique(users, page.users, userIdOf);
    nextOffset = page.next_offset;
  }
  return { users, nextOffset };
}
