/**
 * 마우스 시점 입력 지킴이(베타 11/13 「마우스가 제멋대로 돈다」).
 *  · 튀는 값 거르기 — 윈도우 크롬의 포인터 잠금은 가끔 이동값 하나가 크게 튄다. 천천히 움직이던 중에 직전 값들의 20 배가 넘는
 *    값이 하나 들어오면 버린다. 빠른 뒤돌기는 여러 이벤트에 걸쳐 커지므로 지나간다(버린 값도 이력에 넣어, 진짜 휙 돌린 것이면
 *    다음 값부터는 통과한다 — 잃는 것은 첫 이벤트 하나).
 *  · 시선 막기 — 연출이 카메라를 쥔 동안(나주 화면 고정)은 마우스 회전을 받지 않는다. 안 막으면 마우스와 연출이 같은 카메라를
 *    번갈아 돌려 화면이 당겨지는 느낌이 난다.
 * React · 별칭을 쓰지 않는다(node --test).
 */

/** 이보다 작은 값은 튄 것으로 보지 않는다(px) — 기본 감도에서 약 34° */
const SPIKE_MIN_PX = 300;
/** 직전 값 평균의 이 배수를 넘으면 튄 것 */
const SPIKE_RATIO = 20;
/** 이 안(ms)에 들어온 직전 값만 견준다 — 한참 쉬다 움직인 첫 값은 견줄 것이 없어 지나간다 */
const HISTORY_MS = 150;
/** 견줄 직전 값이 이만큼은 있어야 한다 */
const HISTORY_MIN = 3;
const HISTORY_MAX = 6;

export interface LookGuard {
  /** 이 이동값을 버릴까 */
  shouldDrop(dx: number, dy: number, now: number): boolean;
  dropped(): number;
}

export function createLookGuard(): LookGuard {
  const history: { at: number; size: number }[] = [];
  let dropped = 0;
  return {
    shouldDrop(dx, dy, now) {
      const size = Math.hypot(dx, dy);
      // 숫자가 아닌 값은 카메라를 망가뜨린다
      if (!Number.isFinite(size)) {
        dropped += 1;
        return true;
      }
      while (history.length && now - history[0].at > HISTORY_MS) history.shift();
      let isSpike = false;
      if (size >= SPIKE_MIN_PX && history.length >= HISTORY_MIN) {
        let sum = 0;
        for (const entry of history) sum += entry.size;
        isSpike = size > (sum / history.length) * SPIKE_RATIO;
      }
      history.push({ at: now, size });
      if (history.length > HISTORY_MAX) history.shift();
      if (isSpike) dropped += 1;
      return isSpike;
    },
    dropped: () => dropped,
  };
}

const guard = createLookGuard();
let isLookBlocked: () => boolean = () => false;

/** 연출이 카메라를 쥔 동안 참을 돌려주는 함수를 건다(나주 화면 고정) */
export function setLookBlocker(blocker: () => boolean) {
  isLookBlocked = blocker;
}

/** 마우스 이동을 시점 회전에 써도 되나 */
export function acceptLook(dx: number, dy: number, now: number) {
  if (isLookBlocked()) return false;
  return !guard.shouldDrop(dx, dy, now);
}

/** 이번 접속에서 버린 튄 값의 수 — 베타 기록에 싣는다 */
export const droppedLookSpikes = () => guard.dropped();

type LockElement = { requestPointerLock?: (options?: { unadjustedMovement?: boolean }) => unknown };

/**
 * 포인터 잠금을 청한다 — 가속 없는 원본 입력(unadjustedMovement)으로 먼저. 윈도우 크롬에서 이동값이 튀는 경로(커서를 가운데로
 * 되돌리는 방식)를 피한다. 지원하지 않으면(NotSupportedError) 예전 방식으로 다시 청한다. 그 밖의 거절(ESC 직후 · 몸짓 없이 청함)은
 * 받아 두기만 한다 — 부르는 쪽의 기다림 흐름이 맡는다.
 */
export function requestGameLock(element: unknown) {
  const target = element as LockElement | null | undefined;
  if (typeof target?.requestPointerLock !== "function") return;
  try {
    const result = target.requestPointerLock({ unadjustedMovement: true });
    if (result instanceof Promise)
      result.catch((error: unknown) => {
        if ((error as { name?: string } | null)?.name !== "NotSupportedError") return;
        try {
          const retry = target.requestPointerLock?.();
          if (retry instanceof Promise) retry.catch(() => {});
        } catch {
          // 막는 브라우저 — 기다림(다음 클릭 · 키)으로 넘어간다
        }
      });
  } catch {
    // 막는 브라우저 — 기다림(다음 클릭 · 키)으로 넘어간다
  }
}
