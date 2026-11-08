/**
 * 아랑사의 함 진행 — BoxOpening 이 지금 단계를 알려 두고, 쓸 일 끝난 열쇠 · 함 치우기(spentItems)가 읽는다.
 * 컴포넌트 파일에서 함수를 내보내면 빠른 새로 고침이 깨져서 따로 둔다.
 */
export type BoxPhase = "none" | "placed" | "unlocking" | "play" | "done";

let readPhase: (() => BoxPhase) | null = null;

/** BoxOpening 이 붙을 때 건다 — 떨어질 때 돌려받은 함수로 푼다 */
export function bindBoxPhase(read: () => BoxPhase) {
  readPhase = read;
  return () => {
    if (readPhase === read) readPhase = null;
  };
}

export const isBoxOpened = () => readPhase?.() === "done";
