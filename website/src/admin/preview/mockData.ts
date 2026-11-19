import type { PreviewData } from "./types";

/*
 * 개발 미리보기 전용 가짜 데이터. 실제 회원 · 운영 숫자가 아니다.
 * 이 파일은 usePreview 의 개발 빌드 분기에서만 불러온다 — 운영 빌드 결과물에 이 글자가 있으면 안 된다.
 * 이메일은 example.com, IP 는 문서용 대역(203.0.113.0/24)만 쓴다. 퍼즐 정답 값은 넣지 않는다.
 */
export const PREVIEW_SIGNATURE = "admin-preview-mock-data";

export const PREVIEW_DATA: PreviewData = {
  notices: [
    {
      id: "N-021",
      title: "11월 정기 점검 안내 (11/13 02:00–04:00)",
      category: "점검",
      status: "예약",
      createdAt: "2026-11-10",
      views: 0,
    },
    {
      id: "N-020",
      title: "나주 사건 스테이지 4·5 열림",
      category: "업데이트",
      status: "게시중",
      createdAt: "2026-11-08",
      views: 2_140,
    },
    {
      id: "N-019",
      title: "첫 사건 완주 기념 조사관 배지 이벤트",
      category: "이벤트",
      status: "게시중",
      createdAt: "2026-11-05",
      views: 3_402,
    },
    {
      id: "N-018",
      title: "모바일에서 게임 시작 전 확인할 것",
      category: "안내",
      status: "게시중",
      createdAt: "2026-11-02",
      views: 1_268,
    },
    {
      id: "N-017",
      title: "소셜 로그인 추가 안내",
      category: "안내",
      status: "임시저장",
      createdAt: "2026-10-30",
      views: 0,
    },
  ],
  inquiries: {
    stats: { total: 96, open: 5, today: 4, avgResponseHours: 3.2 },
    rows: [
      {
        id: "Q-096",
        title: "이어하기를 눌러도 처음부터 시작돼요",
        nickname: "강가의여우",
        category: "게임플레이",
        status: "미답변",
        priority: "긴급",
        receivedAt: "2026-11-10 13:12",
        assignee: "—",
      },
      {
        id: "Q-095",
        title: "닉네임을 바꾸고 싶어요",
        nickname: "물안개",
        category: "계정",
        status: "처리중",
        priority: "보통",
        receivedAt: "2026-11-10 10:47",
        assignee: "운영자 하늘",
      },
      {
        id: "Q-094",
        title: "기차 장면에서 화면이 멈춰요",
        nickname: "돌새",
        category: "기술지원",
        status: "미답변",
        priority: "보통",
        receivedAt: "2026-11-09 21:05",
        assignee: "—",
      },
      {
        id: "Q-093",
        title: "구독은 언제 열리나요",
        nickname: "새벽조사관",
        category: "결제",
        status: "답변 완료",
        priority: "낮음",
        receivedAt: "2026-11-09 16:30",
        assignee: "운영자 바다",
      },
      {
        id: "Q-092",
        title: "소리 퍼즐이 잘 안 들려요",
        nickname: "첫걸음",
        category: "게임플레이",
        status: "답변 완료",
        priority: "보통",
        receivedAt: "2026-11-08 18:22",
        assignee: "운영자 하늘",
      },
    ],
  },
  contents: [
    {
      id: "C-01",
      kind: "홈 영상",
      title: "홈 예고편",
      poster: "/hero-trailer-v12-poster.webp",
      status: "게시중",
      updatedAt: "2026-11-02",
    },
    {
      id: "C-02",
      kind: "미디어",
      title: "나주 사건 영상",
      poster: "/naju-film-v4-poster.webp",
      status: "게시중",
      updatedAt: "2026-11-01",
    },
    {
      id: "C-03",
      kind: "미디어",
      title: "목포 사건 예고",
      poster: "/mokpo-film-poster.webp",
      status: "임시저장",
      updatedAt: "2026-10-28",
    },
    {
      id: "C-04",
      kind: "미디어",
      title: "경주 사건 예고",
      poster: "/gyeongju-film-poster.webp",
      status: "임시저장",
      updatedAt: "2026-10-28",
    },
    {
      id: "C-05",
      kind: "미디어",
      title: "캐릭터 만들기 영상",
      poster: "/character-film-v2-poster.jpg",
      status: "게시중",
      updatedAt: "2026-10-20",
    },
    {
      id: "C-06",
      kind: "게임 콘텐츠",
      title: "naju-angam-01 · v1",
      poster: null,
      status: "게시중",
      updatedAt: "2026-11-08",
    },
  ],
};
