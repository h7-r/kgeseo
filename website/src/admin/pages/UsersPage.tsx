import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";

import { toAdminError, type AdminApiError } from "../api/client";
import { fetchStatsSummary } from "../api/stats";
import { useAdminResource } from "../api/useAdminResource";
import {
  USER_PAGE_SIZE,
  fetchUserPage,
  fetchUsersUpTo,
  userIdOf,
  type AdminUserListItem,
  type LoadedUsers,
} from "../api/users";
import ResourceView from "../auth/ResourceView";
import { formatDate, formatDateTime, formatNumber, maskEmail } from "../lib/format";
import { stageLabel } from "../lib/gameStage";
import { SEARCH_MAX_LENGTH, providerLabel, readMemberSearch, recentLogin } from "../lib/memberSearch";
import { appendUnique } from "../lib/paging";
import { useQueryChoice } from "../lib/useQueryChoice";
import { ADMIN_PATHS, adminLoginPath } from "../paths";
import Badge from "../ui/Badge";
import DataTable, { type Column } from "../ui/DataTable";
import PillTabs from "../ui/PillTabs";
import StatCard from "../ui/StatCard";

const TABS = [
  { id: "all", label: "전체 회원" },
  { id: "withdrawn", label: "탈퇴 회원", pendingNote: "준비 중" },
  { id: "suspended", label: "정지 회원", pendingNote: "준비 중" },
] as const;

/** 서버 API 가 있는 탭만 고를 수 있다. 주소로 ?tab=withdrawn 이 와도 준비 중 탭은 열리지 않는다. */
const OPEN_TABS = TABS.filter((tab) => !("pendingNote" in tab));

/** 주소의 ?shown= — 「더 보기」로 펼친 만큼. 새로고침 · 뒤로 가기에서 그만큼 다시 받는다. */
const SHOWN_PARAM = "shown";
/** 주소의 ?q= — 검색어. 새로고침 · 상세에서 돌아와도 같은 결과가 나온다. */
const SEARCH_PARAM = "q";
const TOO_LONG = `검색어는 ${SEARCH_MAX_LENGTH}자까지 넣을 수 있습니다.`;
const MAX_RESTORE = USER_PAGE_SIZE * 20;

function readShown(params: URLSearchParams): number {
  const value = Number(params.get(SHOWN_PARAM));
  if (!Number.isInteger(value) || value <= USER_PAGE_SIZE) return USER_PAGE_SIZE;
  return Math.min(value, MAX_RESTORE);
}

export default function UsersPage() {
  const [tab, setTab] = useQueryChoice("tab", OPEN_TABS, "all");
  const [params, setParams] = useSearchParams();
  const raw = params.get(SEARCH_PARAM) ?? "";
  const search = readMemberSearch(raw);
  const q = search.kind === "nickname" || search.kind === "email" ? search.q : undefined;

  // 검색어가 바뀌면 펼친 만큼(shown)은 처음부터 다시 센다
  const applySearch = (next: string | undefined) =>
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        updated.delete(SHOWN_PARAM);
        if (next) updated.set(SEARCH_PARAM, next);
        else updated.delete(SEARCH_PARAM);
        return updated;
      },
      { replace: true },
    );

  return (
    <>
      <PillTabs label="회원 구분" items={TABS} activeId={tab} onSelect={setTab} />
      <SearchBar key={`search:${raw}`} initial={raw} hasSearch={q !== undefined} onSearch={applySearch} />
      <MemberStatCards />
      {/* 주소의 ?q= 가 너무 길면 검색이 안 된 것이다 — 그 자리에 전체 목록을 그려 열람 기록을 남기지 않는다 */}
      {tab === "all" && search.kind !== "tooLong" && <UserList key={`list:${q ?? ""}`} q={q} />}
    </>
  );
}

function SearchBar({
  initial,
  hasSearch,
  onSearch,
}: {
  initial: string;
  hasSearch: boolean;
  onSearch: (q: string | undefined) => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState(() => (readMemberSearch(initial).kind === "tooLong" ? TOO_LONG : ""));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const search = readMemberSearch(value);
    if (search.kind === "tooLong") {
      setError(TOO_LONG);
      return;
    }
    setError("");
    onSearch(search.kind === "none" ? undefined : search.q);
  };

  return (
    <div className="adm-filters">
      <form className="adm-search-form" role="search" onSubmit={submit}>
        <label className="adm-search">
          <span className="adm-sr-only">닉네임 · 이메일 검색</span>
          <input
            className="adm-input"
            type="search"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="닉네임 일부 또는 이메일 전체"
            aria-describedby="adm-user-search-help"
            aria-invalid={error ? true : undefined}
          />
        </label>
        <button type="submit" className="adm-button adm-button--primary">
          검색
        </button>
        {hasSearch && (
          <button type="button" className="adm-button adm-button--ghost" onClick={() => onSearch(undefined)}>
            검색 지우기
          </button>
        )}
      </form>
      <p
        id="adm-user-search-help"
        className={error ? "adm-field__error" : "adm-search-help"}
        role={error ? "alert" : undefined}
      >
        {error || "닉네임은 일부만 맞아도, 이메일은 주소 전체가 같아야 찾습니다. 검색어는 서버 기록에 남지 않습니다."}
      </p>
    </div>
  );
}

/** 전체 · 활성은 통계 요약 API(관리자 제외). 정지 · 탈퇴는 서버에 기능이 없어 준비 중이다. */
function MemberStatCards() {
  const [resource] = useAdminResource("stats:members", (signal) => fetchStatsSummary(false, signal));
  const stats = resource.status === "ready" ? resource.data : null;
  const waiting = resource.status === "loading" ? "불러오는 중" : "불러오지 못했습니다";
  return (
    <div className="adm-grid adm-grid--four">
      <StatCard
        label="전체"
        value={stats && formatNumber(stats.members.total)}
        pendingText={waiting}
        unit="명"
        caption="누적 · 관리자 제외"
      />
      <StatCard
        label="활성"
        value={stats && formatNumber(stats.activity.members_mau)}
        pendingText={waiting}
        unit="명"
        caption="최근 30일 로그인 · 플레이 시작"
      />
      <StatCard label="정지" value={null} pendingText="준비 중 — 정지 기능 전" caption="이용 제한" />
      <StatCard label="탈퇴" value={null} pendingText="준비 중 — 탈퇴 기능 전" caption="누적" />
    </div>
  );
}

function UserList({ q }: { q: string | undefined }) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [initialCount] = useState(() => readShown(params));
  const [resource, retry] = useAdminResource(`users:${q ?? ""}:${initialCount}`, (signal) =>
    fetchUsersUpTo(initialCount, q, signal),
  );
  const [extra, setExtra] = useState<LoadedUsers | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<AdminApiError | null>(null);

  if (moreError?.kind === "unauthenticated") {
    return <Navigate to={adminLoginPath(location.pathname + location.search)} replace />;
  }

  return (
    <ResourceView resource={resource} retry={retry} loadingText="회원 목록을 불러오고 있습니다">
      {(loaded) => {
        const users = extra ? appendUnique(loaded.users, extra.users, userIdOf) : loaded.users;
        const nextOffset = extra ? extra.nextOffset : loaded.nextOffset;

        const loadMore = async () => {
          if (nextOffset === null) return;
          setIsLoadingMore(true);
          setMoreError(null);
          try {
            const page = await fetchUserPage(nextOffset, q);
            const appended = appendUnique(extra?.users ?? [], page.users, userIdOf);
            setExtra({ users: appended, nextOffset: page.next_offset });
            // 화면에 보이는 인원을 적는다 — 중복을 뺀 수라야 되살릴 때 쪽을 더 받지 않는다
            const shown = appendUnique(loaded.users, appended, userIdOf).length;
            setParams(
              (previous) => {
                const updated = new URLSearchParams(previous);
                updated.set(SHOWN_PARAM, String(shown));
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
              caption={q ? `「${q}」 검색 결과` : "회원 목록"}
              rows={users}
              rowKey={userIdOf}
              emptyText={q ? "찾는 회원이 없습니다. 이메일은 주소 전체를 넣어야 찾습니다." : "가입한 회원이 없습니다."}
              columns={userColumns(location.pathname + location.search)}
              minWidth={1040}
            />
            <footer className="adm-table-foot">
              <span className="adm-table-foot__count">
                {q ? `「${q}」 검색 결과 ` : ""}
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

const ESTIMATE_NOTE = "로그인 · 가입 때 만든 세션의 시각입니다. 자동 로그인으로 계속 쓰면 바뀌지 않습니다.";

function userColumns(listPath: string): Column<AdminUserListItem>[] {
  return [
    {
      key: "nickname",
      header: "닉네임",
      width: "16%",
      truncate: (user) => user.nickname,
      render: (user) => <b>{user.nickname}</b>,
    },
    {
      key: "email",
      header: "이메일",
      width: "20%",
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
    {
      key: "providers",
      header: "로그인 수단",
      width: "112px",
      render: (user) =>
        user.providers.length ? user.providers.map(providerLabel).join(" · ") : <span className="adm-muted">—</span>,
    },
    { key: "created", header: "가입일", mono: true, width: "112px", render: (user) => formatDate(user.created_at) },
    {
      key: "stage",
      header: "진행 단계",
      width: "120px",
      render: (user) => <span className={user.stage ? undefined : "adm-muted"}>{stageLabel(user.stage)}</span>,
    },
    {
      key: "login",
      header: "최근 로그인",
      mono: true,
      width: "196px",
      render: (user) => {
        const login = recentLogin(user);
        if (!login) return <span className="adm-muted">기록 없음</span>;
        return (
          <span title={login.isEstimate ? ESTIMATE_NOTE : undefined}>
            {formatDateTime(login.at)}
            {login.isEstimate && (
              <span className="adm-stamp">
                <Badge tone="gray">추정</Badge>
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "saved",
      header: "마지막 저장",
      mono: true,
      width: "160px",
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
