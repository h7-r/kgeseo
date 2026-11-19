import type { BetaEventRow } from "../lib/betaReport";
import { adminGet } from "./client";

/** 서버 schemas/beta_event.py 의 BetaEventExport. */
interface BetaEventPage {
  events: BetaEventRow[];
  next_after_id: number | null;
}

/** 한 번에 받는 기록 수(서버 상한 10000). 요청마다 서버 관리자 기록에 한 줄 남는다. */
export const BETA_PAGE_SIZE = 10000;

/** 베타 기록을 처음부터 끝까지 이어 받는다. onProgress 로 받은 건수를 알린다. */
export async function fetchAllBetaEvents(
  signal?: AbortSignal,
  onProgress?: (count: number) => void,
): Promise<BetaEventRow[]> {
  const events: BetaEventRow[] = [];
  let afterId = 0;
  for (;;) {
    const page = await adminGet<BetaEventPage>(
      `/api/v1/admin/beta-events?after_id=${afterId}&limit=${BETA_PAGE_SIZE}`,
      signal,
    );
    events.push(...page.events);
    onProgress?.(events.length);
    if (page.next_after_id === null) return events;
    afterId = page.next_after_id;
  }
}
