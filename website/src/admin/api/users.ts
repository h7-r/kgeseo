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

interface AdminUserPage {
  users: AdminUserSummary[];
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

export const fetchUserPage = (offset: number, signal?: AbortSignal) =>
  adminGet<AdminUserPage>(`/api/v1/admin/users?offset=${offset}`, signal);

export const fetchUserDetail = (userId: string, signal?: AbortSignal) =>
  adminGet<AdminUserDetail>(`/api/v1/admin/users/${encodeURIComponent(userId)}`, signal);

export interface LoadedUsers {
  users: AdminUserSummary[];
  nextOffset: number | null;
}

/** 첫 쪽부터 count 명을 채울 때까지 이어 받는다. 새로고침 · 뒤로 가기에서 보던 만큼 되살릴 때 쓴다. */
export async function fetchUsersUpTo(count: number, signal?: AbortSignal): Promise<LoadedUsers> {
  const users: AdminUserSummary[] = [];
  let nextOffset: number | null = 0;
  while (nextOffset !== null && users.length < count) {
    const page = await fetchUserPage(nextOffset, signal);
    users.push(...page.users);
    nextOffset = page.next_offset;
  }
  return { users, nextOffset };
}
