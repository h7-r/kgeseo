// 밖에서 몸을 미는 힘 — 로비에서 맞으면 뒤로 조금 밀린다(미르 11/7, 검토 19회차).
//   · 걷기 속도(useMovement 의 velocity)와 따로 둔 속도 충격이다. 켜진 씬의 useMovement 가 substep 마다 꺼내
//     걷기와 같은 막힘 · 경계 검사를 거쳐 몸 자리(오프셋을 걷어낸 p)에 더한다. 요청이 없으면 이동은 예전 그대로다.
//   · 지수 감쇠: 충격 속도 v0 = 거리 × PUSH_DECAY 면 다 밀린 거리가 그 거리다. 한 걸음(dt)의 밀림은 정확히 적분한다
//     (v · (1 − e^(−k·dt)) / k) — 프레임이 느려도 같은 거리를 간다.
//   · 누가 미나는 부르는 쪽이 정한다(로비 미리보기 previewState — 막힘 조건일 때는 안 부른다). 조작이 꺼지거나
//     순간이동 · 연출 이동 · 씬 들어서기 때는 useMovement 가 남은 밀림을 버린다.
import { RUN_SPEED_MULTIPLIER, WALK_SPEED } from "./constants";

/** 감쇠 빠르기(1/초) — 0.43초에 95% 를 밀린다 🟡 */
export const PUSH_DECAY = 7;
/** 이보다 느려지면 멈춘 것으로 본다(유닛/초) */
const PUSH_STOP_SPEED = 0.05;
/**
 * 걷기 + 밀림을 합친 수평 속도 상한(유닛/초). 로비 서버 이동 검사(lobby/src/movement.ts)는 달리기 최고 속도 × 1.5 를
 * 시간 예산으로 준다 — 여럿이 연달아 때려 밀림이 쌓여도 그 안에 들게 달리기 × 1.2 로 묶는다(Codex 19).
 * 밀림이 있을 때만 쓰고, 걷기 자체가 이보다 빠르면 걷기 속도를 상한으로 둔다(걷기를 늦추지 않는다).
 */
export const PUSH_COMBINED_SPEED_LIMIT = WALK_SPEED * RUN_SPEED_MULTIPLIER * 1.2;

const velocity = { x: 0, z: 0 };
const step = { x: 0, z: 0 };

/** 그 방향으로 distance 유닛만큼 민다. 이미 밀리는 중이면 더해진다(속도는 위 상한에서 다시 묶인다) */
export function requestPush(dirX: number, dirZ: number, distance: number) {
  const length = Math.hypot(dirX, dirZ);
  if (!(length > 1e-6) || !(distance > 0)) return;
  velocity.x += (dirX / length) * distance * PUSH_DECAY;
  velocity.z += (dirZ / length) * distance * PUSH_DECAY;
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed > PUSH_COMBINED_SPEED_LIMIT) {
    velocity.x *= PUSH_COMBINED_SPEED_LIMIT / speed;
    velocity.z *= PUSH_COMBINED_SPEED_LIMIT / speed;
  }
}

export function clearPush() {
  velocity.x = 0;
  velocity.z = 0;
}

export const isPushing = () => velocity.x !== 0 || velocity.z !== 0;

/** 막혀서 그 축으로는 더 못 밀린다 */
export function stopPushAxis(axis: "x" | "z") {
  velocity[axis] = 0;
}

/** dt 초 동안 밀릴 거리를 꺼내고 그만큼 감쇠한다. 돌려준 그릇은 다음 호출에 다시 쓴다 */
export function takePushStep(dt: number): Readonly<{ x: number; z: number }> {
  if (!isPushing() || !(dt > 0)) {
    step.x = 0;
    step.z = 0;
    return step;
  }
  const decay = Math.exp(-PUSH_DECAY * dt);
  const share = (1 - decay) / PUSH_DECAY;
  step.x = velocity.x * share;
  step.z = velocity.z * share;
  velocity.x *= decay;
  velocity.z *= decay;
  if (Math.hypot(velocity.x, velocity.z) < PUSH_STOP_SPEED) clearPush();
  return step;
}
