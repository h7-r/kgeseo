import { COLOR } from "@/styles/tokens";

/** 고객센터 공지사항·FAQ 목록. */
export const SUPPORT_TABS = [
  { id: "notices", label: "공지사항" },
  { id: "faq", label: "자주 묻는 질문 (FAQ)" },
  { id: "inquiry", label: "1:1 문의하기" },
] as const;

export type SupportTabId = (typeof SUPPORT_TABS)[number]["id"];

export type NoticeCategory = "점검" | "이벤트" | "업데이트" | "안내";
export type FaqCategory = "계정" | "게임플레이" | "결제" | "기술지원";

export interface Notice {
  category: NoticeCategory;
  title: string;
  date: string;
}

export interface FaqItem {
  category: FaqCategory;
  question: string;
  /** 아직 답을 쓰지 않은 질문은 null */
  answer: string | null;
}

export const NOTICES: readonly Notice[] = [
  {
    category: "점검",
    title: "정기 점검 안내 (9/5 04:00 ~ 06:00)",
    date: "2026.09.04",
  },
  {
    category: "이벤트",
    title: "시즌 1 이벤트: 앙암바위의 숨겨진 단서를 찾아라",
    date: "2026.09.01",
  },
  {
    category: "업데이트",
    title: "v0.2 업데이트 패치노트 - 1인칭 카메라 안정화",
    date: "2026.08.28",
  },
  {
    category: "안내",
    title: "개인정보처리방침 및 서비스 이용약관 개정 안내",
    date: "2026.08.25",
  },
  {
    category: "이벤트",
    title: "나주 Case 01 오픈 기념 모험가 특별 보상 지급 이벤트",
    date: "2026.08.20",
  },
  {
    category: "점검",
    title: "서버 긴급 점검 완료 및 임시 보상 안내",
    date: "2026.08.19",
  },
  {
    category: "안내",
    title: "커뮤니티 가이드라인 및 공정한 게임 이용 캠페인 안내",
    date: "2026.08.15",
  },
  {
    category: "업데이트",
    title: "v0.1.5 그래픽 최적화 및 로딩 속도 단축 업데이트",
    date: "2026.08.10",
  },
];

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    category: "계정",
    question: "계정을 잊어버렸어요. 어떻게 복구하나요?",
    answer:
      "로그인 페이지에서 비밀번호 찾기를 클릭하시면 가입 시 등록한 이메일로 인증코드가 발송됩니다. 인증 완료 후 새 비밀번호를 설정할 수 있습니다.",
  },
  {
    category: "게임플레이",
    question: "게임 진행이 저장되나요?",
    answer: null,
  },
  {
    category: "결제",
    question: "구독을 취소하면 데이터는 어떻게 되나요?",
    answer: null,
  },
  {
    category: "기술지원",
    question: "게임이 실행되지 않아요",
    answer: null,
  },
  {
    category: "게임플레이",
    question: "힌트는 어떻게 사용하나요?",
    answer: null,
  },
  {
    category: "계정",
    question: "닉네임을 변경할 수 있나요?",
    answer: null,
  },
  {
    category: "결제",
    question: "환불 정책이 어떻게 되나요?",
    answer: null,
  },
  {
    category: "기술지원",
    question: "권장 사양이 어떻게 되나요?",
    answer: null,
  },
];

/** 배지 바탕색. 키는 화면에 보이는 분류 이름 그대로다. */
export const BADGE_BACKGROUNDS: Record<NoticeCategory | FaqCategory, string> = {
  점검: "rgba(239,68,68,0.12)",
  이벤트: "rgba(16,185,129,0.12)",
  업데이트: "rgba(46,72,137,0.12)",
  안내: "rgba(100,116,139,0.12)",
  계정: "rgba(46,72,137,0.12)",
  게임플레이: "rgba(16,185,129,0.12)",
  결제: "rgba(245,158,11,0.12)",
  기술지원: "rgba(239,68,68,0.12)",
};

/** 배지 글자색. */
export const BADGE_TEXT_COLORS: Record<NoticeCategory | FaqCategory, string> = {
  // 흰 면 위라 의미색을 한 단계 진하게 쓴다.
  점검: "#dc2626",
  이벤트: "#047857",
  업데이트: COLOR.navy,
  // 배지 글자도 본문만큼 읽혀야 해서 3.9:1 회색 대신 이 값을 쓴다.
  안내: COLOR.lightTextMuted,
  계정: COLOR.navy,
  게임플레이: "#047857",
  결제: "#b45309",
  기술지원: "#dc2626",
};
