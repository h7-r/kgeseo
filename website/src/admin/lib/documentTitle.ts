/** 관리자 화면의 브라우저 탭 제목. 화면 이름이 없으면 「관리자」만 둔다. */
export const adminTitle = (label?: string) =>
  label ? `${label} · 관리자 · ESCAPE THE LEGEND` : "관리자 · ESCAPE THE LEGEND";
