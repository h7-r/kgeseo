/**
 * 줄 당기기 게이지의 순수 계산 — 막대 자리 · 판이 바뀔 때 이어 움직이기 · 새 칸 고르기. 노드 시험에서 따로 본다(tests/pullGauge.test.ts).
 *
 * 막대는 왼쪽 끝(0)에서 출발해 sweep 초 만에 오른쪽 끝(1)에 닿고 되돌아온다(위상 0~2: 0~1 은 오른쪽으로, 1~2 는 왼쪽으로).
 * 판이 바뀌어도 막대를 왼쪽 끝으로 옮기거나 세우지 않는다(미르 11/12 「멈칫하는 거 없이 바로」) — 맞힌 자리 · 방향 그대로 새 판 빠르기로 잇는다.
 * 그러면 새 칸이 막대 코앞일 수 있어, 칸에 닿기까지 MIN_REACH 초 넘게 남는 자리를 고른다(나주통발 02회차 Codex).
 */

export type GaugeDirection = 1 | -1;

export interface GaugeCursor {
  /** 0(왼쪽 끝) ~ 1(오른쪽 끝) */
  position: number;
  direction: GaugeDirection;
}

/** 출발한 지 elapsedMs 지난 막대 — 출발 전(음수)이면 왼쪽 끝 */
export function cursorAt(elapsedMs: number, sweepSeconds: number): GaugeCursor {
  const phase = (Math.max(0, elapsedMs) / 1000 / sweepSeconds) % 2;
  return phase < 1 ? { position: phase, direction: 1 } : { position: 2 - phase, direction: -1 };
}

/** 이 자리 · 방향에서 sweepSeconds 박자로 이어 가려면 출발 시각을 언제로 잡나(ms) */
export function continuedStart(nowMs: number, cursor: GaugeCursor, sweepSeconds: number) {
  const phase = cursor.direction > 0 ? cursor.position : 2 - cursor.position;
  return nowMs - phase * sweepSeconds * 1000;
}

/** 막대가 칸(low~high)에 처음 닿기까지 걸리는 초 — 이미 칸 안이면 0. 끝에서 되돌아오는 길까지 센다 */
export function reachSeconds(cursor: GaugeCursor, low: number, high: number, sweepSeconds: number) {
  const { position, direction } = cursor;
  if (position >= low && position <= high) return 0;
  const distance =
    direction > 0
      ? position < low
        ? low - position
        : 1 - position + (1 - high)
      : position > high
        ? position - high
        : position + low;
  return distance * sweepSeconds;
}

export interface ZoneChoice {
  /** 칸 가운데(0~1) */
  center: number;
  isRight: boolean;
}

/**
 * 후보 중 막대가 칸에 닿기까지 minReach 초 이상 남는 것을 무작위로. 하나도 없으면 가장 오래 걸리는 것
 * (셋째는 둘째의 반대편으로 묶여 있어 0.25 초 남짓인 때가 있다 — 그 정도는 받는다, 02회차 Codex)
 */
export function pickZone(
  candidates: readonly ZoneChoice[],
  zone: number,
  cursor: GaugeCursor,
  sweepSeconds: number,
  minReach: number,
  random: () => number = Math.random,
): ZoneChoice {
  const timed = candidates.map((choice) => ({
    choice,
    seconds: reachSeconds(cursor, choice.center - zone / 2, choice.center + zone / 2, sweepSeconds),
  }));
  const roomy = timed.filter((entry) => entry.seconds >= minReach);
  if (roomy.length > 0) return roomy[Math.floor(random() * roomy.length)].choice;
  return timed.reduce((best, entry) => (entry.seconds > best.seconds ? entry : best)).choice;
}
