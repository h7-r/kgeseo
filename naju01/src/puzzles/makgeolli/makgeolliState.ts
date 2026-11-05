/** 안쪽 배의 막걸리 술병을 챙겼나 — 돌탑 퍼즐이 이것(과 항아리 퍼즐)을 먼저 보고 열린다 */
let taken = false;

export const makgeolliBottle = {
  isTaken: () => taken,
  /** 저장본을 넣는다 */
  restore: (saved: boolean) => {
    taken = saved;
  },
  take: () => {
    taken = true;
  },
};
