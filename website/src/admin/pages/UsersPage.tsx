import { useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";

import { toAdminError, type AdminApiError } from "../api/client";
import { useAdminResource } from "../api/useAdminResource";
import { USER_PAGE_SIZE, fetchUserPage, fetchUsersUpTo, type AdminUserSummary, type LoadedUsers } from "../api/users";
import ResourceView from "../auth/ResourceView";
import { formatDate, formatDateTime, formatNumber, maskEmail } from "../lib/format";
import { stageLabel } from "../lib/gameStage";
import { useQueryChoice } from "../lib/useQueryChoice";
import { ADMIN_PATHS, adminLoginPath } from "../paths";
import Badge from "../ui/Badge";
import DataTable, { type Column } from "../ui/DataTable";
import PillTabs from "../ui/PillTabs";
import StatCard from "../ui/StatCard";
import { PendingScreen } from "../ui/StatusScreen";

const TABS = [
  { id: "all", label: "전체 회원" },
  { id: "withdrawn", label: "탈퇴 회원" },
  { id: "suspended", label: "정지 회원" },
] as const;

/** 주소의 ?shown= — 「더 보기」로 펼친 만큼. 새로고침 · 뒤로 가기에서 그만큼 다시 받는다. */
const SHOWN_PARAM = "shown";
const MAX_RESTORE = USER_PAGE_SIZE * 20;

function readShown(params: URLSearchParams): number {
  const value = Number(params.get(SHOWN_PARAM));
  if (!Number.isInteger(value) || value <= USER_PAGE_SIZE) return USER_PAGE_SIZE;
  return Math.min(value, MAX_RESTORE);
}

export default function UsersPage() {
  const [tab, setTab] = useQueryChoice("tab", TABS, "all");

  return (
    <>
      <PillTabs label="회원 구분" items={TABS} activeId={tab} onSelect={setTab} />
      <div className="adm-toolbar">
        <label className="adm-search">
          <span className="adm-sr-only">닉네임 · 이메일 검색</span>
          <input className="adm-input" placeholder="닉네임 · 이메일 검색 — 서버 연결 전 준비 중" disabled />
        </label>
      </div>
      <div className="adm-grid adm-grid--four">
        <StatCard label="전체" value={null} caption="누적" />
        <StatCard label="활성" value={null} caption="최근 30일 접속" />
        <StatCard label="정지" value={null} caption="이용 제한" />
        <StatCard label="탈퇴" value={null} caption="누적" />
      </div>
      {tab === "all" ? <UserList /> : <PendingScreen needs="회원 정지 · 탈퇴 조회 API 가 생기면 열립니다." />}
    </>
  );
}

function UserList() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [initialCount] = useState(() => readShown(params));
  const [resource, retry] = useAdminResource(`users:${initialCount}`, (signal) => fetchUsersUpTo(initialCount, signal));
  const [extra, setExtra] = useState<LoadedUsers | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<AdminApiError | null>(null);

  if (moreError?.kind === "unauthenticated") {
    return <Navigate to={adminLoginPath(location.pathname + location.search)} replace />;
  }

  return (
    <ResourceView resource={resource} retry={retry} loadingText="회원 목록을 불러오고 있습니다">
      {(loaded) => {
        const users = extra ? [...loaded.users, ...extra.users] : loaded.users;
        const nextOffset = extra ? extra.nextOffset : loaded.nextOffset;

        const loadMore = async () => {
          if (nextOffset === null) return;
          setIsLoadingMore(true);
          setMoreError(null);
          try {
            const page = await fetchUserPage(nextOffset);
            const appended = [...(extra?.users ?? []), ...page.users];
            setExtra({ users: appended, nextOffset: page.next_offset });
            setParams(
              (previous) => {
                const updated = new URLSearchParams(previous);
                updated.set(SHOWN_PARAM, String(loaded.users.length + appended.length));
                return updated;
              },
              { replace: true },
            );
          } catch (error) {
            setMoreError(toAdminError(error));
          } finally {
            setIsLoadingMore(false);
          }
        };

        return (
          <section className="adm-panel adm-panel--flush" aria-label="회원 목록">
            <p className="adm-audit-note">
              목록을 열 때마다 서버 관리자 기록에 남습니다. 이메일은 상세에서만 전체가 보입니다.
            </p>
            <DataTable
              caption="회원 목록"
              rows={users}
              rowKey={(user) => user.user_id}
              emptyText="가입한 회원이 없습니다."
              columns={userColumns(location.pathname + location.search)}
            />
            <footer className="adm-table-foot">
              <span className="adm-table-foot__count">
                {formatNumber(users.length)}명 표시{nextOffset === null ? " · 마지막까지 모두" : ""}
              </span>
              {moreError && (
                <span className="adm-field__error" role="alert">
                  더 불러오지 못했습니다. 다시 눌러 주세요.
                </span>
              )}
              {nextOffset !== null && (
                <button
                  type="button"
                  className="adm-button adm-button--ghost"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? "불러오는 중…" : `${USER_PAGE_SIZE}명 더 보기`}
                </button>
              )}
            </footer>
          </section>
        );
      }}
    </ResourceView>
  );
}

function userColumns(listPath: string): Column<AdminUserSummary>[] {
  return [
    {
      key: "nickname",
      header: "닉네임",
      width: "18%",
      truncate: (user) => user.nickname,
      render: (user) => <b>{user.nickname}</b>,
    },
    {
      key: "email",
      header: "이메일",
      width: "22%",
      mono: true,
      truncate: (user) => maskEmail(user.email),
      render: (user) => maskEmail(user.email),
    },
    {
      key: "role",
      header: "역할",
      width: "88px",
      render: (user) => (user.role === "admin" ? <Badge tone="blue">관리자</Badge> : <Badge tone="gray">회원</Badge>),
    },
    { key: "created", header: "가입일", mono: true, width: "120px", render: (user) => formatDate(user.created_at) },
    {
      key: "stage",
      header: "진행 단계",
      width: "120px",
      render: (user) => <span className={user.stage ? undefined : "adm-muted"}>{stageLabel(user.stage)}</span>,
    },
    {
      key: "saved",
      header: "마지막 저장",
      mono: true,
      width: "176px",
      render: (user) => formatDateTime(user.save_updated_at),
    },
    {
      key: "manage",
      header: "관리",
      align: "end",
      width: "88px",
      render: (user) => (
        <Link
          to={ADMIN_PATHS.userDetail(user.user_id)}
          state={{ from: listPath }}
          className="adm-button adm-button--ghost adm-button--small"
          aria-label={`${user.nickname} 상세 보기`}
        >
          상세
        </Link>
      ),
    },
  ];
}
