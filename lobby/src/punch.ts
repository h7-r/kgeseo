// 때리기 — 2026-11-06 미르 지시(맞으면 둔탁한 소리 + 맞은 사람이 고개를 젖힘). 설계 v0.20 5절.
// 받는 메시지: `punch` { motion: "jab" | "cross", target?: 연결 ID }. 화면이 주먹이 닿는 순간(약 0.2초)에 상대를 골라 한 번 보낸다.
// 서버는 보낸 사람을 연결에서 정하고(요청 안의 sid 는 믿지 않는다), 상대가 맞았는지를 **서버가 아는 두 사람 자리**로 다시 잰다.
// 이동 검사가 벽 통과까지 막지는 않으므로 이것은 「서버에 등록된 자리 기준 근거리 검사」다(위치 조작을 완전히 막지는 못한다).

export const PUNCH_MOTIONS = ["jab", "cross"] as const;
export type PunchMotion = (typeof PUNCH_MOTIONS)[number];

/** 🟡 연결당 최소 간격(초당 약 3번이 상한). 잘못된 요청도 센다 */
export const PUNCH_COOLDOWN_MS = 300;
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
  #lastAt: number | null = null;

  /** 받으면 요청, 버리면 null. 간격 안에 온 요청은 내용과 상관없이 버리고 그 시각부터 다시 센다 */
  accept(raw: unknown, nowMs: number): PunchRequest | null {
    const tooSoon = this.#lastAt !== null && nowMs - this.#lastAt < PUNCH_COOLDOWN_MS;
    this.#lastAt = nowMs;
    if (tooSoon || typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
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
