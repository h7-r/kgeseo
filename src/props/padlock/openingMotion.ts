/**
 * 자물쇠가 풀릴 때의 몸짓을 순수 계산으로 둔다 — 화면으로는 한 프레임이 길어지면 연출이 통째로 뛰어
 * 중간 자세를 볼 수 없어서, 시험이 t 를 0~1 로 돌려 "쇠막대가 구멍에 박힌 채인가"를 수로 확인한다.
 *
 * ① 본체가 살짝 내려가 짧은 다리가 빠진다 ② 걸쇠 구멍을 꿴 쇠막대(x 축)를 축으로 앞으로 눕는다
 * ③ 다 누운 뒤에야 구멍 축(+x)으로 밀려 나간다 ④ 빠진 뒤 떨어진다.
 * z 축으로 돌리면 도는 동안 구멍 선을 벗어나 본체가 걸쇠를 때린다 — 쇠막대 자체가 회전축이어야 한다.
 */

type Phase = readonly [number, number];

interface OpeningMotion {
  /** 초 — 처음부터 끝까지 */
  duration: number;
  /** 매달린 본체가 화면 쪽으로 반듯이 눕는 각 */
  tiltAngle: number;
  /** 구멍 축(+x)으로 밀려 나가는 거리(로컬, 크기 배수 이전) */
  slideDistance: number;
  /**
   * 빠져나온 뒤 비스듬히 흘리는 양. 축으로만 나가면 기계가 밀어낸 것처럼 보인다.
   * 쇠막대가 구멍에 남은 동안 대각으로 가면 구멍 벽을 뚫으므로 다 빠진 뒤부터 들어간다.
   */
  driftUp: number;
  driftForward: number;
  dropDistance: number;
  /** 짧은 다리가 몸통에서 빠져나오는 정도 */
  releaseDistance: number;
  /**
   * 쇠막대가 구멍에서 완전히 벗어나는 거리(로컬). 고리 반지름 0.04 · 두 구멍 ±0.015 → 0.055 에 여유를 더했다.
   * 시험이 이 값으로 대각 시작을 따진다.
   */
  clearDistance: number;
  /** 구간을 겹쳐 흐르게 두면 중간에 끊기는 느낌이 안 난다 */
  phases: {
    release: Phase;
    tilt: Phase;
    /** 여기서만 쇠막대가 구멍을 지난다 */
    slide: Phase;
    drift: Phase;
    drop: Phase;
  };
}

export const OPENING_MOTION: OpeningMotion = {
  duration: 2.5,
  tiltAngle: Math.PI / 2,
  slideDistance: 0.55,
  driftUp: 0.22,
  driftForward: 0.12,
  dropDistance: 1.5,
  releaseDistance: 0.05,
  clearDistance: 0.08,
  phases: {
    release: [0, 0.18],
    tilt: [0, 0.45],
    slide: [0.45, 0.85],
    drift: [0.62, 1],
    drop: [0.8, 1],
  },
};

interface OpeningPose {
  /** 본체가 아래로 내려가는 정도 */
  release: number;
  /** x 축 회전(음수 = 화면 쪽으로 눕는다) */
  angle: number;
  /** 구멍 축(+x)으로 */
  slide: number;
  up: number;
  forward: number;
  drop: number;
  visible: boolean;
}

export function computeOpeningPose(t: number, motion: OpeningMotion = OPENING_MOTION): OpeningPose {
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const progress = ([a, b]: Phase) => clamp01((t - a) / (b - a));
  const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
  const release = easeOut(progress(motion.phases.release));
  const tilt = easeOut(progress(motion.phases.tilt));
  const slide = easeOut(progress(motion.phases.slide));
  const drift = easeOut(progress(motion.phases.drift));
  const drop = progress(motion.phases.drop) ** 2; // 제곱 = 가속(중력감)
  return {
    release: release * motion.releaseDistance,
    angle: -tilt * motion.tiltAngle,
    slide: slide * motion.slideDistance,
    up: drift * motion.driftUp,
    forward: drift * motion.driftForward,
    drop: drop * motion.dropDistance,
    visible: t < 0.999,
  };
}

/**
 * 쇠막대(피벗)를 제자리에 못 박은 채 몸만 돌리는 자리.
 * 피벗은 로컬 (0, pv, 0) 을 지나는 x 축 → 그룹 원점 = 피벗월드 − Rx(각)·피벗로컬, Rx·(0,pv,0) = (0, pv·cos, pv·sin).
 */
export function computeOpeningPosition(
  pose: Pick<OpeningPose, "angle" | "slide" | "drop"> & Partial<Pick<OpeningPose, "up" | "forward">>,
  { x, y, z }: { x: number; y: number; z: number },
): [number, number, number] {
  const pivot = -y; // 원점 → 걸쇠 구멍 높이(로컬 y)
  const c = Math.cos(pose.angle),
    s = Math.sin(pose.angle);
  return [x + pose.slide, y + pivot - pivot * c + (pose.up ?? 0) - pose.drop, z - pivot * s + (pose.forward ?? 0)];
}
