/**
 * 마이페이지 다섯 탭. 내 진행 · 업적 · 아이템은 서버의 내 저장본에서 그린다(lib/myProgress).
 * keywords 는 사이트 검색이 이 탭을 찾게 하는 말이다 — 사람마다 다른 값은 색인에 넣지 않는다.
 */
export const MY_PAGE_TABS = [
  { id: "history", label: "내 진행", keywords: "진행 현황 사건 스테이지 나주 앙암바위 이어 하기 마지막 저장 튜토리얼" },
  {
    id: "account",
    label: "계정 설정",
    keywords: "비밀번호 변경 로그인 기록 이메일 수신 데이터 내보내기 로그아웃 회원 탈퇴",
  },
  { id: "subscription", label: "구독 현황", keywords: "구독 플랜 결제 베타 무료" },
  { id: "achievements", label: "업적 & 배지", keywords: "업적 배지 해결 달성" },
  { id: "items", label: "보유 아이템", keywords: "아이템 소지품 물건 보유" },
] as const;

export type MyPageTabId = (typeof MY_PAGE_TABS)[number]["id"];

type Pair = readonly [label: string, value: string];

/**
 * 계정 설정에서 실제로 동작하는 항목.
 * 나머지(2단계 인증·계정 연동 등)는 서버가 있어야 해서 action 없이 「준비 중」으로 둔다.
 */
export type AccountAction =
  "changePassword" | "loginHistory" | "emailNotifications" | "exportData" | "signOut" | "deleteAccount";

interface SettingsItem {
  label: string;
  /** 오른쪽 단추 글. */
  value: string;
  action?: AccountAction;
}

interface SettingsGroup {
  title: string;
  items: readonly SettingsItem[];
}

interface MyPageContent {
  account: { groups: readonly SettingsGroup[] };
  /** 지금은 결제 없는 무료 시험 서비스다(약관 제12조). 결제가 붙으면 서버 값으로 바뀐다. */
  subscription: { plan: readonly Pair[] };
}

export const MY_PAGE_CONTENT: MyPageContent = {
  account: {
    groups: [
      {
        title: "보안",
        items: [
          { label: "비밀번호 변경", value: "변경하기", action: "changePassword" },
          { label: "2단계 인증", value: "활성화" },
          { label: "로그인 기록", value: "확인하기", action: "loginHistory" },
        ],
      },
      {
        title: "알림",
        items: [
          { label: "알림 설정", value: "설정 보기" },
          { label: "이메일 수신", value: "ON", action: "emailNotifications" },
        ],
      },
      {
        title: "일반",
        items: [
          { label: "언어 설정", value: "한국어" },
          { label: "화면 설정", value: "다크 모드" },
          { label: "소리 설정", value: "설정 보기" },
        ],
      },
      {
        title: "계정",
        items: [
          { label: "계정 연동", value: "연동 관리" },
          { label: "데이터 관리", value: "내보내기", action: "exportData" },
          { label: "로그아웃", value: "로그아웃하기", action: "signOut" },
          { label: "개인정보 처리 정지", value: "요청하기" },
          { label: "회원 탈퇴", value: "탈퇴 진행", action: "deleteAccount" },
        ],
      },
    ],
  },
  subscription: {
    plan: [
      ["현재 플랜", "무료 시험 서비스(베타)"],
      ["이용 요금", "0원"],
      ["이용할 수 있는 사건", "CASE 01 · 나주 앙암바위"],
      ["결제 · 자동결제", "없음"],
      ["시험운영 종료 예정", "2026년 12월 31일"],
    ],
  },
};
