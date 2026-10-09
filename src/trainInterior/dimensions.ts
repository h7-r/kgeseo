// 좌표: x = 객차 길이(앞↔뒤), z = 폭(창가↔창가), y = 높이(바닥 0). 1 유닛 ≈ 0.30 m — 역과 같은 축척.

/** 객차 길이(x) ≈ 15.6 m */
export const CAR_LENGTH = 52;
/** 객차 폭(z) ≈ 3.0 m */
export const CAR_WIDTH = 10;
/** 객차 높이(y) ≈ 3.0 m */
export const CAR_HEIGHT = 10;

// 허리 아래부터 머리 위까지 트여야 통유리로 읽힌다. 낮으면 눈 위에 걸친 띠처럼 보인다.
export const WINDOW_BOTTOM = 2.6;
export const WINDOW_TOP = 8.0;
export const WINDOW_WIDTH = 6.6;

/**
 * 이 객차의 눈높이(≈1.95 m). 역의 EYE(4.15)는 역 캐릭터를 재서 맞춘 값이고, 객차에는 그 캐릭터가 없다.
 * 창·선반이 이 높이 기준으로 놓여 있어 4.15 로 들어오면 칸이 통째로 커 보인다. 칸 치수를 고치면 같이 본다.
 */
export const CAR_EYE = 6.5;
/** ≈ 0.90 m */
export const CAR_CROUCH_EYE = 3.0;

/** 창유리 — 자판기 투명문과 같은 유리 */
export const WINDOW_GLASS_COLOR = "#e2edf2";

// 출입문은 밖에서 들어온 기차 옆구리 문과 같은 옆벽(-z)에 둔다. 들어온 자리로 다시 나가야 방향 감각이 맞는다.
export const DOOR_X = -CAR_LENGTH / 2 + 13;
export const DOOR_WIDTH = 5.2;
export const DOOR_HEIGHT = 7.6;
/** 방을 향한 쪽 벽 */
export const DOOR_Z = -CAR_WIDTH / 2;
