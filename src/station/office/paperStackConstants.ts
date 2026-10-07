// A4(210×297mm)를 씬 축척으로 — 책상 윗면 2.44 = 실제 0.73m 라 1m ≈ 3.34 유닛.
export const PAPER_W = 0.21 * 3.34;
export const PAPER_D = 0.297 * 3.34;

/** 글씨 종류. Leva 선택지 값이자 저장 데이터라 글자를 바꾸지 않는다. 0 = 섞기(시드로 하나를 뽑는다). */
export const PAPER_STYLES = ["섞기", "보고서", "표·서식", "손글씨메모", "체크리스트"];

/** 서류 더미가 책상 윗면 아래로 파묻히는 깊이. 0 이면 두 면이 같은 높이라 z-fighting 이 난다. */
export const PAPER_SINK_DEPTH = 0.01;
