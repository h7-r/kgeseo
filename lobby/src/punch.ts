// 때리기 — 2026-11-06 미르 지시(맞으면 둔탁한 소리 + 맞은 사람이 고개를 젖힘). 설계 v0.20 5절.
// 받는 메시지: `punch` { motion: "jab" | "cross", target?: 연결 ID }. 화면이 주먹이 닿는 순간(약 0.2초)에 상대를 골라 한 번 보낸다.
// 서버는 보낸 사람을 연결에서 정하고(요청 안의 sid 는 믿지 않는다), 상대가 맞았는지를 **서버가 아는 두 사람 자리**로 다시 잰다.
// 이동 검사가 벽 통과까지 막지는 않으므로 이것은 「서버에 등록된 자리 기준 근거리 검사」다(위치 조작을 완전히 막지는 못한다).

export const PUNCH_MOTIONS = ["jab", "cross"] as const;
export type PunchMotion = (typeof PUNCH_MOTIONS)[number];

/** 🟡 연결당 빈도 — 300ms 마다 한 번 차는 통(최대 2번 모아 둠), 요청마다(잘못된 것도) 한 번씩 쓴다. 초당 약 3번이 상한 */
export const PUNCH_COOLDOWN_MS = 300;
export const PUNCH_BURST = 2;
/** 🟡 두 사람 사이 수평 거리 상한(유닛) — 화면 판정 2.2 + 위치 지연 여유 */
export const PUNCH_RANGE = 2.8;
/** 🟡 때린 사람이 보는 방향에서 벗어나도 되는 각도 */
export const PUNCH_ARC = (75 * Math.PI) / 180;
/** 발 높이 차 상한(유닛) */
export const PUNCH_HEIGHT = 2;
/** 둘 다 이 시간 안에 정상 위치를 보냈어야 맞음으로 친다(ms) */
export const POSE_FRESH_MS = 1500;
const TARGET_MAX_LENGTH = 64;

export interface PunchRequest {
  motion: PunchMotion;
  target: string | null;
}

export class PunchGate {
  #tokens = PUNCH_BURST;
  #filledAt: number | null = null;

  /**
   * 받으면 요청, 버리면 null. 요청마다(내용이 틀려도) 통에서 하나를 쓰고, 비었으면 버린다.
   * 버린 요청이 통을 다시 비우지는 않으므로 꾸준히 누르는 사람은 초당 약 3번은 나간다(시각을 매번 새로 세면 계속 막힌다).
   */
  accept(raw: unknown, nowMs: number): PunchRequest | null {
    if (this.#filledAt === null) this.#filledAt = nowMs;
    if (this.#tokens < PUNCH_BURST) {
      const refill = Math.floor((nowMs - this.#filledAt) / PUNCH_COOLDOWN_MS);
      if (refill > 0) {
        this.#tokens = Math.min(PUNCH_BURST, this.#tokens + refill);
        this.#filledAt += refill * PUNCH_COOLDOWN_MS;
      }
    }
    // 꽉 차 있었으면 지금부터 센다(오래 쉬었다고 더 모이지 않게)
    if (this.#tokens >= PUNCH_BURST) this.#filledAt = nowMs;
    if (this.#tokens <= 0) return null;
    this.#tokens -= 1;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const { motion, target } = raw as Record<string, unknown>;
    if (typeof motion !== "string" || !(PUNCH_MOTIONS as readonly string[]).includes(motion)) return null;
    if (target !== undefined && target !== null) {
      if (typeof target !== "string" || target.length === 0 || target.length > TARGET_MAX_LENGTH) return null;
      return { motion: motion as PunchMotion, target };
    }
    return { motion: motion as PunchMotion, target: null };
  }
}

export interface BodyAt {
  placed: boolean;
  x: number;
  y: number;
  z: number;
  /** 몸 방향(라디안). 앞 = (sin ry, cos ry) — 본편 AvatarLink.facing 과 같은 규약 */
  ry: number;
  /** 마지막 정상 위치를 받은 서버 시각(ms) */
  poseAt: number;
}

/** 서버가 아는 자리로 「때린 사람이 상대를 칠 수 있었나」 */
export function canHit(attacker: BodyAt, target: BodyAt, nowMs: number): boolean {
  if (!attacker.placed || !target.placed) return false;
  if (nowMs - attacker.poseAt > POSE_FRESH_MS || nowMs - target.poseAt > POSE_FRESH_MS) return false;
  if (Math.abs(attacker.y - target.y) > PUNCH_HEIGHT) return false;
  const dx = target.x - attacker.x;
  const dz = target.z - attacker.z;
  const distance = Math.hypot(dx, dz);
  if (distance > PUNCH_RANGE) return false;
  // 아주 붙어 있으면 방향은 보지 않는다(몸이 겹친 자리)
  if (distance < 0.3) return true;
  const cos = (Math.sin(attacker.ry) * dx + Math.cos(attacker.ry) * dz) / distance;
  return cos >= Math.cos(PUNCH_ARC);
}
