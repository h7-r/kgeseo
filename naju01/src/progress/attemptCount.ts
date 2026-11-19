/**
 * 처음부터 다시 한 횟수 — 베타 이벤트(1회차 완주자 추첨, 미르 11/12)에서 「첫 플레이」를 계정 기준으로 가르는 값.
 * 베타 기록의 회차 번호(run_index)는 브라우저에 있어 다른 브라우저 · 시크릿 창에서는 다시 0 이 된다. 이 값은 계정 저장에
 * 있어 어디서 열어도 따라온다. 칸 이름이 `naju.` 로 시작하지 않아 처음부터 다시(naju.* 지우기)에도 남는다.
 * 저장을 고치면 속일 수 있다 — 서버가 받은 시각과 대조하는 것은 집계 쪽 몫이다.
 */
export const ATTEMPT_SECTION = "najuMeta.attempt";

export interface SavedAttempt {
  /** 처음부터 다시 한 횟수(0 = 첫 플레이) */
  restarts: number;
}

const toCount = (value: unknown) => {
  const count = Number((value as SavedAttempt | null | undefined)?.restarts);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

/** 저장값에서 횟수만 읽는다(깨진 값은 0) */
export const readRestarts = toCount;

let restarts = 0;

export const attemptCount = {
  read: (): SavedAttempt => ({ restarts }),
  restore(value: unknown) {
    restarts = toCount(value);
  },
  restarts: () => restarts,
  /** 처음부터 다시 — 하나 올린다. 저장에 실패하면 undo 로 되돌린다 */
  bump() {
    restarts += 1;
  },
  undo() {
    restarts = Math.max(0, restarts - 1);
  },
};
