/**
 * 관리자 화면 목록 — 주소 · 메뉴 · 제목 · 「준비 중」 안내를 모두 여기서 만든다.
 * React 와 "@/" 별칭을 쓰지 않아 node 테스트가 바로 읽는다. 화면 코드는 routes.tsx 가 이어 붙인다.
 */
import { generatePath, matchPath } from "react-router-dom";

/** live = 서버와 연결됨 · partial = 일부만 연결 · pending = 서버 API 전 */
export type ScreenStatus = "live" | "partial" | "pending";

interface ScreenInput {
  id: string;
  /** 관리자 주소 아래 경로 조각. "" 은 관리자 첫 화면 */
  path: string;
  /** 메뉴 이름이자 화면 제목 */
  label: string;
  description: string;
  status: ScreenStatus;
  /** pending 화면을 라우트에서 막을 때 보일 안내. 없으면 화면이 스스로 빈 상태를 그린다(구독 · 설정). */
  pendingNote?: string;
  /** 메뉴에 따로 안 나오고 이 메뉴를 따른다 */
  parent?: string;
  /** 제목이 데이터(닉네임 등)라 화면이 머리를 직접 그린다 */
  ownHeader?: boolean;
}

const SCREEN_LIST = [
  {
    id: "dashboard",
    path: "",
    label: "대시보드",
    description: "서비스 상태를 한눈에 봅니다.",
    status: "partial",
  },
  {
    id: "betaLog",
    path: "beta-log",
    label: "베타 기록",
    description: "베타 참가자의 플레이 기록 — 진입 단계 · 퍼즐 · 그만둔 지점 · 오류 · 로딩 · 설문을 봅니다.",
    status: "live",
  },
  {
    id: "traffic",
    path: "traffic",
    label: "접속 통계",
    description: "동시접속과 지금 플레이 중인 조사관을 봅니다.",
    status: "pending",
    pendingNote: "접속 집계 API(동시접속 · DAU · MAU · 활성 세션)가 생기면 열립니다.",
  },
  {
    id: "users",
    path: "users",
    label: "회원 관리",
    description: "가입한 플레이어를 찾고, 가입 최신순으로 봅니다.",
    status: "live",
  },
  {
    id: "userDetail",
    path: "users/:userId",
    label: "회원 상세",
    description: "회원 상세",
    status: "live",
    parent: "users",
    ownHeader: true,
  },
  {
    id: "userStats",
    path: "user-stats",
    label: "회원 통계",
    description: "가입 · 이탈 흐름과 지역 분포를 봅니다.",
    status: "pending",
    pendingNote: "회원 통계 집계 API(가입 · 탈퇴 추이 · 지역 분포)가 생기면 열립니다.",
  },
  {
    id: "gameData",
    path: "game-data",
    label: "게임 데이터",
    description: "나주 사건 「앙암바위」 스테이지 1–5 와 퍼즐별 시도를 봅니다.",
    status: "pending",
    pendingNote: "플레이 집계 API(스테이지 진입 · 완료, 퍼즐 시도 · 오답 · 힌트)가 생기면 열립니다.",
  },
  {
    id: "activity",
    path: "activity",
    label: "활동 로그",
    description: "관리자가 언제 누구의 기록을 열람했는지 봅니다.",
    status: "live",
  },
  {
    id: "security",
    path: "security",
    label: "보안",
    description: "로그인 실패 · 잠김 · 요청 거절 · 관리자 접속 같은 이상 신호를 봅니다.",
    status: "pending",
    pendingNote:
      "보안 집계 API(/admin/security/summary · /admin/security/events)가 생기면 열립니다. 원문 · 비밀번호 · 전체 IP 는 보이지 않습니다.",
  },
  {
    id: "notices",
    path: "notices",
    label: "공지사항",
    description: "웹 고객센터에 실리는 공지를 관리합니다.",
    status: "pending",
    pendingNote: "공지 API 가 생기면 열립니다. 지금 웹 고객센터 공지는 코드에 고정된 글입니다.",
  },
  {
    id: "contents",
    path: "contents",
    label: "콘텐츠",
    description: "홈 영상 · 미디어와 게임 콘텐츠 판의 게시 상태를 봅니다.",
    status: "pending",
    pendingNote:
      "콘텐츠 게시 API 가 생기면 열립니다. 지금 웹 영상은 코드 데이터, 게임 콘텐츠 판은 서버 게시 기록에 있습니다.",
  },
  {
    id: "support",
    path: "support",
    label: "CS 관리",
    description: "1:1 문의에 답합니다.",
    status: "pending",
    pendingNote: "문의 API 가 생기면 열립니다. 지금 웹 1:1 문의는 서버로 보내지 않고 접수 표시만 합니다.",
  },
  {
    id: "subscriptions",
    path: "subscriptions",
    label: "구독 관리",
    description: "구독 현황 · 결제 내역 · 쿠폰을 봅니다.",
    status: "pending",
  },
  {
    id: "settings",
    path: "settings",
    label: "설정",
    description: "서비스 설정을 확인합니다. 값은 서버에서 정하고 이 화면에서는 바꾸지 않습니다.",
    status: "pending",
  },
] as const satisfies readonly ScreenInput[];

export type ScreenId = (typeof SCREEN_LIST)[number]["id"];
/** 주소에 :변수 가 없는 화면 — 바로 링크를 걸 수 있다 */
export type StaticScreenId = Exclude<(typeof SCREEN_LIST)[number], { path: `${string}:${string}` }>["id"];

export interface AdminScreen extends ScreenInput {
  id: ScreenId;
  parent?: ScreenId;
}

/** 메뉴 순서 그대로. */
export const ADMIN_SCREENS: readonly AdminScreen[] = SCREEN_LIST;

/** 로그인 화면은 틀(사이드바) 밖이라 목록에 넣지 않는다. */
export const LOGIN_SEGMENT = "login";

const join = (base: string, segment: string) => (segment ? `${base}/${segment}` : base);

export function screenById(id: ScreenId): AdminScreen {
  const screen = ADMIN_SCREENS.find((item) => item.id === id);
  if (!screen) throw new Error(`없는 관리자 화면: ${id}`);
  return screen;
}

export type AdminPaths = Record<StaticScreenId | "login", string> & { userDetail: (userId: string) => string };

/** 링크용 주소. base 는 관리자 첫 주소(ROUTES.admin)다. */
export function buildAdminPaths(base: string): AdminPaths {
  const fixed = Object.fromEntries(
    ADMIN_SCREENS.filter((screen) => !screen.path.includes(":")).map((screen) => [screen.id, join(base, screen.path)]),
  ) as Record<StaticScreenId, string>;
  const userDetailPattern = join(base, screenById("userDetail").path);
  return {
    ...fixed,
    login: join(base, LOGIN_SEGMENT),
    userDetail: (userId) => generatePath(userDetailPattern, { userId }),
  };
}

/** 지금 주소에 맞는 화면. 모르는 주소면 undefined. */
export function findScreen(pathname: string, base: string): AdminScreen | undefined {
  return ADMIN_SCREENS.find((screen) => matchPath({ path: join(base, screen.path), end: true }, pathname));
}

/** 사이드바에 보일 화면(따로 메뉴가 없는 상세 화면은 뺀다). */
export const MENU_SCREENS: readonly AdminScreen[] = ADMIN_SCREENS.filter((screen) => !screen.parent);

/** 이 화면이 메뉴에서 어느 칸에 해당하는지 — 회원 상세는 「회원 관리」. */
export const menuScreenOf = (screen: AdminScreen): AdminScreen => (screen.parent ? screenById(screen.parent) : screen);

export const screenHref = (base: string, screen: AdminScreen) => join(base, screen.path);
