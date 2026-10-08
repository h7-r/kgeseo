/** 마이페이지 다섯 탭. 서버가 붙기 전까지 쓰는 화면용 값이다. */
export const MY_PAGE_TABS = [
  { id: "history", label: "최근 플레이 기록" },
  { id: "account", label: "계정 설정" },
  { id: "subscription", label: "구독 현황" },
  { id: "achievements", label: "업적 & 배지" },
  { id: "items", label: "보유 아이템" },
] as const;

export type MyPageTabId = (typeof MY_PAGE_TABS)[number]["id"];

type Pair = readonly [label: string, value: string];

interface PlayRecord {
  region: string;
  regionNo: string;
  title: string;
  result: "성공" | "실패";
  playedAgo: string;
  difficulty: string;
  /** "18:42" 처럼 같은 꼴이라 글자 정렬이 곧 시간 정렬이다. */
  clearTime: string;
  date: string;
  image: string;
}

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

interface OwnedItem {
  name: string;
  rarity: "COMMON" | "RARE" | "EPIC" | "LEGEND";
  color: string;
}

interface MyPageContent {
  history: { records: readonly PlayRecord[] };
  account: { groups: readonly SettingsGroup[] };
  subscription: {
    plan: readonly Pair[];
    /** [날짜, 플랜, 금액] */
    payments: readonly (readonly [date: string, plan: string, amount: string])[];
  };
  achievements: {
    stats: readonly Pair[];
    /** [이름, 조건, 진행] */
    badges: readonly (readonly [name: string, condition: string, progress: string])[];
  };
  items: { stats: readonly Pair[]; items: readonly OwnedItem[] };
}

export const MY_PAGE_CONTENT: MyPageContent = {
  // 실제로 만들어진 사건이 나주 앙암바위 하나뿐이라 기록도 그것만 둔다. 서버가 붙으면 play_session 기록으로 바뀐다.
  history: {
    records: [
      {
        region: "나주",
        regionNo: "REGION NO. 04",
        title: "앙암바위의 비밀",
        result: "성공",
        playedAgo: "1시간 전",
        difficulty: "상급",
        clearTime: "18:42",
        date: "2026.09.03",
        image: "/case-film-poster.webp",
      },
    ],
  },
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
          { label: "로그아웃", value: "즉시 종료", action: "signOut" },
          { label: "개인정보 처리 정지", value: "요청하기" },
          { label: "회원 탈퇴", value: "탈퇴 진행", action: "deleteAccount" },
        ],
      },
    ],
  },
  subscription: {
    plan: [
      ["현재 플랜", "PREMIUM"],
      ["다음 결제일", "2026.10.12"],
      ["월 결제 금액", "₩14,900"],
      ["상태", "활성"],
    ],
    payments: [
      ["2026.09.12", "PREMIUM", "₩14,900"],
      ["2026.08.12", "PREMIUM", "₩14,900"],
      ["2026.07.12", "PREMIUM", "₩14,900"],
      ["2026.06.12", "BASIC", "₩9,900"],
    ],
  },
  achievements: {
    stats: [
      ["획득한 배지", "12 / 30"],
      ["달성률", "40%"],
      ["최근 획득", "스피드러너"],
      ["희귀 배지", "3개"],
    ],
    badges: [
      ["첫 번째 탈출", "첫 방탈출 성공", "완료"],
      ["퍼즐 마스터", "퍼즐 50개 해결", "완료"],
      ["스피드러너", "10분 이내 클리어", "70%"],
      ["전설의 탐험가", "모든 맵 방문", "완료"],
      ["속도의 왕", "5분 이내 클리어", "15%"],
      ["협동 전문가", "멀티플레이 100회", "42%"],
      ["수집가", "아이템 50개 수집", "60%"],
      ["불굴의 의지", "실패 후 재도전 성공", "완료"],
    ],
  },
  items: {
    stats: [
      ["총 아이템", "8개"],
      ["LEGEND", "1개"],
      ["EPIC", "2개"],
      ["RARE", "3개"],
      ["COMMON", "2개"],
    ],
    items: [
      { name: "황금 열쇠", rarity: "COMMON", color: "rgba(115,122,140,0.15)" },
      { name: "고대 지도", rarity: "RARE", color: "rgba(46,72,137,0.15)" },
      { name: "암호 해독기", rarity: "EPIC", color: "rgba(153,77,229,0.15)" },
      { name: "수정 랜턴", rarity: "RARE", color: "rgba(46,72,137,0.15)" },
      { name: "시간의 모래시계", rarity: "EPIC", color: "rgba(153,77,229,0.15)" },
      { name: "비밀 일지", rarity: "COMMON", color: "rgba(115,122,140,0.15)" },
      { name: "유령 탐지기", rarity: "RARE", color: "rgba(46,72,137,0.15)" },
      { name: "마스터 키", rarity: "LEGEND", color: "rgba(242,199,51,0.15)" },
    ],
  },
};
