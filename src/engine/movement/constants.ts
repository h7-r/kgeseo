// 1 유닛 ≈ 0.30 m. 부작용 없는 파일이다 — naju01 이 이동 상수만 가져다 쓴다.

/**
 * 서 있을 때 눈높이(≈1.25 m). 손으로 정하지 않고 화면의 캐릭터를 재서 넣었다:
 * meshy 남자 eye_l 뼈 1.2462 m ÷ 0.3 = 4.15. 캐릭터 키를 바꾸면 이 값도 같이 가야 맞는다.
 */
export const EYE_HEIGHT = 4.15;
/** 앉았을 때 눈높이(≈0.68 m). Crouch_Idle 의 머리–발 거리가 선 자세의 0.545 배다. */
export const CROUCH_EYE_HEIGHT = 2.26;

/**
 * 걷기 속도(유닛/초). 제자리 루프 모션의 보폭 속도에 맞춘 값이라 올리면 3인칭에서 발이 미끄러진다.
 * 체감 속도는 firstPersonSpeed / thirdPersonSpeed 배속으로 맞춘다.
 */
export const WALK_SPEED = 3.0;
export const RUN_SPEED_MULTIPLIER = 2.58;
export const CROUCH_SPEED_MULTIPLIER = 0.55;

export const GRAVITY = -30;
export const JUMP_VELOCITY = 10.5;
export const AIR_CONTROL = 0.18;

/** 플레이어 반지름. 키우면 자물쇠·번호판(조작거리 0.8)에 손이 안 닿는다. */
export const PLAYER_RADIUS = 0.6;
/** 상호작용 거리 */
export const INTERACT_DISTANCE = 5;

/**
 * 게임이 처리하는 키(브라우저 기본 동작을 막는다). 앉기는 C 토글 하나다 —
 * 윈도우에서 Ctrl+W 는 예약 단축키라 preventDefault 로도 못 막아, 앉은 채 걸으면 탭이 닫혔다.
 */
export const HANDLED_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
  "KeyC",
  "Space",
]);
