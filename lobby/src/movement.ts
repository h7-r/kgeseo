// 이동·인사 검사 — 설계 v0.19 5절. 틀린 갱신은 버린다(연결은 끊지 않는다).
// 숫자는 본편 값을 옮겨 적은 것이다. 원본과 같은지는 test/movement.test.ts 가 본다.
//   본부실 벽: src/station/layout/dimensions.ts · 걷기·달리기 속도: src/engine/movement/constants.ts

/** 본부실 벽 안(유닛). y 는 카메라가 아니라 발바닥 높이(PlayerMotionState.footY) */
export const HQ_BOUNDS = { minX: -20, maxX: 16, minZ: -14, maxZ: 12, minY: -1, maxY: 12 } as const;
const WALK_SPEED = 3.0;
const RUN_SPEED_MULTIPLIER = 2.58;
/** 수평 최고 속도(유닛/초) */
export const MAX_SPEED = WALK_SPEED * RUN_SPEED_MULTIPLIER;
/** 수신 간격이 흔들려도 정상 이동을 버리지 않게 두는 여유(🟡 시작값) */
const SPEED_SLACK = 1.5;
const DISTANCE_SLACK = 0.5;
/**
 * 이동 거리 예산 — 초당 MAX_SPEED × 여유만큼 차고, 0.5초 치까지 모아 둔다(🟡).
 * 메시지마다 여유를 새로 주면 같은 순간 여러 개를 보내 멀리 갈 수 있다(03회차 Codex 재현: 12개로 17.6유닛).
 * 예산은 시간으로만 차므로 몇 개를 몰아 보내도 그 시간에 갈 수 있는 거리를 넘지 못한다.
 */
export const DISTANCE_RATE = MAX_SPEED * SPEED_SLACK;
export const DISTANCE_BUDGET_CAP = DISTANCE_RATE * 0.5 + DISTANCE_SLACK;
/**
 * 멀리 떨어진 자리가 이만큼 계속 오면 그 자리로 옮긴다(🟡). 본부실 안에서 연출이 사람을 옮기면
 * 다른 사람 화면에서 영영 멈춰 있지 않게 하는 복구 길이다. 대가로 3초에 한 번까지는 순간이동처럼 보일 수 있다.
 */
export const RESYNC_AFTER_MS = 3000;
/** 떨어지는 속도 상한 쪽 여유(중력 30, 천장 12 → 약 27 유닛/초) */
const MAX_VERTICAL_SPEED = 30;

export const MOVE_RATE_PER_SEC = 10;
/** 잠깐 몰려 와도 버리지 않을 묶음 크기(🟡) */
const MOVE_BURST = 12;

export const GAITS = ["idle", "walk", "run", "crouch"] as const;
export type Gait = (typeof GAITS)[number];

export interface Pose {
  x: number;
  y: number;
  z: number;
  ry: number;
  gait: Gait;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** 모양·범위만 본다(속도·빈도는 MoveGate) */
export function parsePose(raw: unknown): Pose | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { x, y, z, ry, gait } = raw as Record<string, unknown>;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z) || !isFiniteNumber(ry)) return null;
  if (typeof gait !== "string" || !(GAITS as readonly string[]).includes(gait)) return null;
  if (x < HQ_BOUNDS.minX || x > HQ_BOUNDS.maxX || z < HQ_BOUNDS.minZ || z > HQ_BOUNDS.maxZ) return null;
  if (y < HQ_BOUNDS.minY || y > HQ_BOUNDS.maxY) return null;
  // 방향은 −π~π 로 접는다
  const wrapped = Math.atan2(Math.sin(ry), Math.cos(ry));
  return { x, y, z, ry: wrapped, gait: gait as Gait };
}

/** 연결 하나의 이동 검사기. 시각은 서버 수신 시각(ms) */
export class MoveGate {
  #tokens = MOVE_BURST;
  #refilledAt: number | null = null;
  #last: { x: number; y: number; z: number; at: number } | null = null;
  #budget = DISTANCE_BUDGET_CAP;
  #budgetAt: number | null = null;
  #rejectedSince: number | null = null;

  /** 받으면 정규화한 자세, 버리면 null */
  accept(raw: unknown, nowMs: number): Pose | null {
    // 빈도 — 모양이 틀린 메시지도 센다
    if (this.#refilledAt !== null) {
      const elapsed = Math.max(0, nowMs - this.#refilledAt) / 1000;
      this.#tokens = Math.min(MOVE_BURST, this.#tokens + elapsed * MOVE_RATE_PER_SEC);
    }
    this.#refilledAt = nowMs;
    if (this.#tokens < 1) return null;
    this.#tokens -= 1;

    const pose = parsePose(raw);
    if (!pose) return null;
    const last = this.#last;
    // 첫 자리는 이동이 아니다 — 예산을 채운 채 시작해야 바로 이어 오는 걸음을 버리지 않는다
    if (!last) return this.#take(pose, nowMs, DISTANCE_BUDGET_CAP);

    if (this.#budgetAt !== null) {
      const elapsed = Math.max(0, nowMs - this.#budgetAt) / 1000;
      this.#budget = Math.min(DISTANCE_BUDGET_CAP, this.#budget + elapsed * DISTANCE_RATE);
    }
    this.#budgetAt = nowMs;
    const horizontal = Math.hypot(pose.x - last.x, pose.z - last.z);
    const sinceLast = Math.max(0, nowMs - last.at) / 1000;
    const verticalOk = Math.abs(pose.y - last.y) <= MAX_VERTICAL_SPEED * sinceLast + DISTANCE_SLACK;
    if (horizontal <= this.#budget && verticalOk) return this.#take(pose, nowMs, this.#budget - horizontal);

    this.#rejectedSince ??= nowMs;
    if (nowMs - this.#rejectedSince >= RESYNC_AFTER_MS) return this.#take(pose, nowMs, 0);
    return null;
  }

  #take(pose: Pose, nowMs: number, budget: number): Pose {
    this.#last = { x: pose.x, y: pose.y, z: pose.z, at: nowMs };
    this.#budget = budget;
    this.#budgetAt = nowMs;
    this.#rejectedSince = null;
    return pose;
  }
}

/** 인사 번호 — 2026-11-07 미르: 키패드 1~3 만(손 내밀기·들썩들썩·줍는 시늉) */
export const GREET_IDS = [1, 2, 3] as const;
/** 🟡 시작값 */
export const GREET_COOLDOWN_MS = 3000;

export class GreetGate {
  #lastAt: number | null = null;

  /** 받으면 문구 ID, 버리면 null */
  accept(raw: unknown, nowMs: number): number | null {
    if (typeof raw !== "object" || raw === null) return null;
    const id = (raw as Record<string, unknown>).id;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || id > GREET_IDS.length) return null;
    if (this.#lastAt !== null && nowMs - this.#lastAt < GREET_COOLDOWN_MS) return null;
    this.#lastAt = nowMs;
    return id;
  }
}
