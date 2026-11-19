/**
 * 아랑사의 함 진행 — BoxOpening 이 지금 단계를 알려 두고, 쓸 일 끝난 열쇠 · 함 치우기(spentItems)가 읽는다.
 * 컴포넌트 파일에서 함수를 내보내면 빠른 새로 고침이 깨져서 따로 둔다.
 */
export type BoxPhase = "none" | "placed" | "unlocking" | "play" | "done";

/** 자물통 열쇠 구멍 자리(유닛) — 함 놓을 자리 안내(BoxPlaceGuide)가 놓인 함의 자물통에 빛을 옮긴다 */
type Point = { x: number; y: number; z: number };

let readPhase: (() => BoxPhase) | null = null;
let readLock: (() => Point) | null = null;

/** BoxOpening 이 붙을 때 건다 — 떨어질 때 돌려받은 함수로 푼다 */
export function bindBoxPhase(read: () => BoxPhase, lock?: () => Point) {
  readPhase = read;
  readLock = lock ?? null;
  return () => {
    if (readPhase === read) {
      readPhase = null;
      readLock = null;
    }
  };
}

/** 놓인 함의 자물통 자리(유닛) — 함이 안 붙었으면 null */
export const getBoxLock = (): Point | null => readLock?.() ?? null;

export const isBoxOpened = () => readPhase?.() === "done";

/** 지금 단계 — 함이 아직 안 붙었으면 "none" */
export const getBoxPhase = (): BoxPhase => readPhase?.() ?? "none";
