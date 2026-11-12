/** 개발 미리보기 데이터의 모양. 값은 개발 빌드에서만 불러오는 mockData.ts 에 있다. */

export interface Point {
  label: string;
  value: number;
}

export interface PreviewData {
  notices: {
    id: string;
    title: string;
    category: "점검" | "이벤트" | "업데이트" | "안내";
    status: "게시중" | "예약" | "임시저장";
    createdAt: string;
    views: number;
  }[];
  inquiries: {
    stats: { total: number; open: number; today: number; avgResponseHours: number };
    rows: {
      id: string;
      title: string;
      nickname: string;
      category: "계정" | "게임플레이" | "결제" | "기술지원";
      status: "미답변" | "처리중" | "답변 완료";
      priority: "긴급" | "보통" | "낮음";
      receivedAt: string;
      assignee: string;
    }[];
  };
  contents: {
    id: string;
    kind: "홈 영상" | "미디어" | "게임 콘텐츠";
    title: string;
    poster: string | null;
    status: "게시중" | "임시저장";
    updatedAt: string;
  }[];
}
