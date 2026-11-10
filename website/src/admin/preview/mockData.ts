import type { Point, PreviewData } from "./types";

/*
 * 개발 미리보기 전용 가짜 데이터. 실제 회원 · 운영 숫자가 아니다.
 * 이 파일은 usePreview 의 개발 빌드 분기에서만 불러온다 — 운영 빌드 결과물에 이 글자가 있으면 안 된다.
 * 이메일은 example.com, IP 는 문서용 대역(203.0.113.0/24)만 쓴다. 퍼즐 정답 값은 넣지 않는다.
 */
export const PREVIEW_SIGNATURE = "admin-preview-mock-data";

const days = ["11-04", "11-05", "11-06", "11-07", "11-08", "11-09", "11-10"];
const months = ["6월", "7월", "8월", "9월", "10월", "11월"];

const series = (labels: string[], values: number[]): Point[] =>
  labels.map((label, index) => ({ label, value: values[index] ?? 0 }));

// 13:33 ~ 14:32, 1분 간격. 천천히 오르며 출렁이는 접속자 수.
const perMinute: Point[] = Array.from({ length: 60 }, (_, index) => {
  const minute = 33 + index;
  const label = `${13 + Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;
  return { label, value: Math.round(96 + index * 0.9 + Math.sin(index / 4) * 9) };
});

export const PREVIEW_DATA: PreviewData = {
  dashboard: {
    concurrent: 148,
    dau: 612,
    totalMembers: 3_480,
    signupsToday: 37,
    openInquiries: 5,
    visitors7d: series(days, [402, 455, 431, 520, 588, 571, 612]),
    stageCompletion: series(
      ["스테이지 1", "스테이지 2", "스테이지 3", "스테이지 4", "스테이지 5"],
      [82, 64, 47, 31, 22],
    ),
    adminActions: [
      { at: "2026-11-10 14:21", admin: "운영자 하늘", action: "회원 상세 열람", target: "회원 강가의여우" },
      { at: "2026-11-10 13:58", admin: "운영자 하늘", action: "회원 목록 열람", target: "—" },
      { at: "2026-11-10 11:12", admin: "운영자 바다", action: "회원 상세 열람", target: "회원 새벽조사관" },
      { at: "2026-11-10 09:40", admin: "운영자 바다", action: "회원 목록 열람", target: "—" },
    ],
  },
  traffic: {
    concurrent: 148,
    peakToday: 203,
    dau: 612,
    mau: 2_904,
    perMinute,
    sessions: [
      { startedAt: "2026-11-10 14:28", nickname: "강가의여우", stage: "naju", ip: "203.0.113.42" },
      { startedAt: "2026-11-10 14:19", nickname: "새벽조사관", stage: "train", ip: "203.0.113.19" },
      { startedAt: "2026-11-10 14:07", nickname: "물안개", stage: "headquarters", ip: "203.0.113.7" },
      { startedAt: "2026-11-10 13:55", nickname: "돌새", stage: "naju", ip: "203.0.113.31" },
      { startedAt: "2026-11-10 13:41", nickname: "첫걸음", stage: "character", ip: "203.0.113.88" },
    ],
  },
  memberStats: {
    total: 3_480,
    totalDelta: 2.4,
    monthlySignups: 412,
    signupDelta: 8.1,
    mau: 2_904,
    mauDelta: -1.2,
    churnRate: 3.6,
    churnDelta: 0.4,
    signups6m: series(months, [120, 168, 151, 240, 305, 412]),
    withdrawals6m: series(months, [8, 11, 9, 14, 12, 15]),
    regions: series(["서울", "경기", "전남", "광주", "부산", "그 밖"], [1_120, 860, 540, 330, 290, 340]),
    recent: [
      { nickname: "첫걸음", email: "firststep@example.com", joinedAt: "2026-11-10 13:40", stage: "character" },
      { nickname: "물안개", email: "mist.river@example.com", joinedAt: "2026-11-10 11:02", stage: "headquarters" },
      { nickname: "돌새", email: "stonebird@example.com", joinedAt: "2026-11-09 22:17", stage: "naju" },
      { nickname: "새벽조사관", email: "dawn.agent@example.com", joinedAt: "2026-11-09 19:45", stage: "train" },
    ],
  },
  gameData: {
    contentVersion: "naju-angam-01 · v1",
    avgCompletionMinutes: 74,
    stages: [
      { label: "스테이지 1", entered: 1_840, completed: 1_510 },
      { label: "스테이지 2", entered: 1_490, completed: 1_178 },
      { label: "스테이지 3", entered: 1_150, completed: 865 },
      { label: "스테이지 4", entered: 830, completed: 570 },
      { label: "스테이지 5", entered: 560, completed: 405 },
    ],
    puzzles: [
      { id: "P01", name: "조개 숨구멍 캐기", judge: "서버", attempts: 2_310, wrong: 690, hints: 412 },
      { id: "P02", name: "통발 고르기", judge: "화면", attempts: 1_920, wrong: 380, hints: 205 },
      { id: "P03", name: "소리로 항아리 맞추기", judge: "서버", attempts: 2_640, wrong: 1_180, hints: 731 },
      { id: "P07", name: "조개 진주 빛 잇기", judge: "서버", attempts: 1_310, wrong: 420, hints: 266 },
      { id: "P09", name: "물레 고리 숫자", judge: "서버", attempts: 1_480, wrong: 640, hints: 388 },
    ],
  },
  activity: {
    totals: { all: 1_284, warn: 18, error: 3, critical: 0 },
    logs: [
      {
        id: "L-1042",
        at: "2026-11-10 14:21",
        admin: "운영자 하늘",
        action: "회원 상세 열람",
        target: "회원",
        level: "INFO",
      },
      {
        id: "L-1041",
        at: "2026-11-10 13:58",
        admin: "운영자 하늘",
        action: "회원 목록 열람",
        target: "회원",
        level: "INFO",
      },
      {
        id: "L-1040",
        at: "2026-11-10 12:30",
        admin: "시스템",
        action: "DB 응답 지연",
        target: "인프라",
        level: "WARN",
      },
      {
        id: "L-1039",
        at: "2026-11-10 11:12",
        admin: "운영자 바다",
        action: "회원 상세 열람",
        target: "회원",
        level: "INFO",
      },
      {
        id: "L-1038",
        at: "2026-11-10 10:03",
        admin: "시스템",
        action: "로비 연결 끊김",
        target: "인프라",
        level: "ERROR",
      },
      {
        id: "L-1037",
        at: "2026-11-10 09:40",
        admin: "운영자 바다",
        action: "회원 목록 열람",
        target: "회원",
        level: "INFO",
      },
    ],
  },
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
