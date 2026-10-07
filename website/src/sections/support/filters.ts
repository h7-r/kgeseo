import type { FaqCategory, NoticeCategory } from "@/data/support";

export const ALL = "전체";
export const NOTICE_FILTERS = [ALL, "점검", "이벤트", "업데이트", "안내"] as const satisfies readonly (
  NoticeCategory | typeof ALL
)[];
export const FAQ_FILTERS = [ALL, "계정", "게임플레이", "결제", "기술지원"] as const satisfies readonly (
  FaqCategory | typeof ALL
)[];
