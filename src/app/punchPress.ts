/**
 * 왼쪽 클릭 주먹 — 걷다가 눌러도 그 자리에 서서 낸다(11/12 미르).
 *
 * 11/11 플레이테스트에서 걸으며 낸 주먹은 몸만 빙판처럼 미끄러졌다. 그래서 걷는 중 클릭을 버렸더니(3f4ee19) 이번엔 로비에서
 * 돌아다니다 누른 클릭이 자주 안 먹었다. 이제는 걷던 중이어도 주먹을 내고, 그동안(PUNCH_HOLD_MS) 걷기 입력을 받지 않는다 —
 * useMovement 가 holdStillUntil 을 본다. 키를 누르고 있으면 멈춤이 끝나는 대로 다시 걷고, 남은 주먹 끝동작은 아바타가 끊는다
 * (useMotionPlayer 「주먹 도중 걸으면 끊는다」).
 * 공중에서는 멈춰 설 수 없으니 그대로 내지 않는다.
 * React · 별칭(@/) 을 쓰지 않는다(naju01/tests 의 node --test 가 바로 읽는다).
 */

export type PunchMotion = "Punch_Jab" | "Punch_Cross";

/** 주먹을 내는 동안 걷지 않는 시간 — 닿는 순간(로비 PUNCH_IMPACT_MS 200ms)과 뻗은 팔이 보이도록 */
export const PUNCH_HOLD_MS = 450;

export interface PunchBody {
  grounded: boolean;
  attackSerial: number;
  attackMotion: PunchMotion;
  /** 이 시각(performance.now(), ms)까지 걷기 입력을 받지 않는다 — useMovement 의 PlayerMotionState 와 같은 칸 */
  holdStillUntil?: number;
}

/** 주먹을 낸다. 냈으면 true — 공중이면 내지 않는다 */
export function pressPunch(player: PunchBody, motion: PunchMotion, now: number): boolean {
  if (!player.grounded) return false;
  player.attackMotion = motion;
  player.attackSerial += 1;
  player.holdStillUntil = Math.max(player.holdStillUntil ?? 0, now + PUNCH_HOLD_MS);
  return true;
}
