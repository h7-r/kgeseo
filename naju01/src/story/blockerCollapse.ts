// 씬이 끝나면 그 씬의 차단물이 무너지며 길목이 열린다.
// 차단물은 그 씬 동안 시야를 가리라는 규칙이지 영원히 막으라는 게 아니다.
// 판정과 그림을 한 곳이 쥔다 — 따로 놀면 「보이는데 못 지나감」이나 「없는데 막힘」이 생긴다.
// 시간은 초, 카메라 각도는 라디안, 자리는 도면 좌표(m).

import * as THREE from "three";

import { METERS_PER_UNIT } from "../plan/sitePlan";

interface CollapseDurations {
  turn: number;
  collapse: number;
  linger: number;
}

type CollapseStage = "turn" | "collapse" | "linger" | "done";

const DEFAULT_DURATION: CollapseDurations = { turn: 0.9, collapse: 1.4, linger: 0.6 };

// 시작과 끝에서 속도가 0 이어야 연출로 보인다. 선형이면 기계가 미는 것처럼 뚝 시작해 뚝 멈춘다.
const smooth = (t: number) => t * t * (3 - 2 * t);

// -π~π 로 접는다. 안 접으면 카메라가 먼 쪽으로 한 바퀴 돌아간다.
const angleDelta = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

interface CollapseTarget {
  code: string;
  name?: string;
  center: [number, number];
}

interface CollapseOptions {
  blocker: CollapseTarget;
  /** 카메라가 돌아볼 자리(열리는 길목). 없으면 차단물 중심 */
  lookAt?: [number, number] | null;
  /** 다 무너진 뒤 알릴 한 줄. 도면에서는 차단물의 치움 안에 있어 부르는 쪽이 꺼내 넘긴다 */
  message?: string | null;
  /** 볼곳 높이를 알아야 시선이 하늘로 뜨지 않는다 */
  groundHeight?: ((x: number, z: number) => number) | null;
  durations?: CollapseDurations;
  /** 판정을 연다. 무너지기가 끝나는 순간 한 번만 부른다 */
  onClear?: () => void;
  onNotify?: (text: string) => void;
}

export interface CollapseSequence {
  code: string;
  /** 0 = 멀쩡 · 1 = 다 무너짐 */
  progress: number;
  isDone: boolean;
  stage: () => CollapseStage;
  tick: (dt: number, camera: THREE.Camera) => void;
}

/** 매 프레임 tick 을 부르면 되고, 끝나면 isDone. progress 를 보고 그리는 쪽이 가라앉힌다. */
export function createCollapseSequence({
  blocker,
  lookAt,
  message,
  groundHeight,
  durations = DEFAULT_DURATION,
  onClear,
  onNotify,
}: CollapseOptions): CollapseSequence {
  const [vx, vz] = lookAt ?? blocker.center;
  const lookY = (groundHeight?.(vx, vz) ?? 0) + 1.2;

  let stage: CollapseStage = "turn";
  let t = 0;
  // 첫 tick 에 카메라에서 읽는다
  let startAngle: { y: number; x: number } | null = null;
  let targetAngle: { y: number; x: number } | null = null;
  let hasCleared = false;

  const sequence: CollapseSequence = {
    code: blocker.code,
    progress: 0,
    isDone: false,
    stage: () => stage,
    tick(dt, camera) {
      if (sequence.isDone) return;
      t += dt;

      if (stage === "turn") {
        if (startAngle === null || targetAngle === null) {
          camera.rotation.order = "YXZ";
          startAngle = { y: camera.rotation.y, x: camera.rotation.x };
          // three 의 +Z 가 화면 뒤라 atan2 부호가 이렇게 된다
          const dx = vx - camera.position.x * METERS_PER_UNIT;
          const dz = vz - camera.position.z * METERS_PER_UNIT;
          const horizontal = Math.hypot(dx, dz);
          targetAngle = {
            y: Math.atan2(-dx, -dz),
            x: Math.atan2(lookY - camera.position.y * METERS_PER_UNIT, Math.max(0.5, horizontal)),
          };
        }
        const k = smooth(Math.min(1, t / durations.turn));
        camera.rotation.order = "YXZ";
        camera.rotation.y = startAngle.y + angleDelta(startAngle.y, targetAngle.y) * k;
        camera.rotation.x = THREE.MathUtils.lerp(startAngle.x, targetAngle.x, k);
        camera.rotation.z = 0;
        if (t >= durations.turn) {
          t = 0;
          stage = "collapse";
        }
        return;
      }

      if (stage === "collapse") {
        sequence.progress = smooth(Math.min(1, t / durations.collapse));
        if (t >= durations.collapse) {
          sequence.progress = 1;
          // 판정은 그림이 다 가라앉은 뒤 여기서 한 번만 연다
          if (!hasCleared) {
            hasCleared = true;
            onClear?.();
            onNotify?.(message ?? `${blocker.name ?? blocker.code} 가 사라져 길이 열렸다`);
          }
          t = 0;
          stage = "linger";
        }
        return;
      }

      // 바로 조작을 돌려주면 무엇이 달라졌는지 읽을 새가 없다
      if (t >= durations.linger) {
        stage = "done";
        sequence.isDone = true;
      }
    },
  };
  return sequence;
}

interface CollapseTransform {
  /** 내려가는 양(유닛) */
  sink: number;
  /** 세로 눌림 배율 */
  squash: number;
  opacity: number;
  tilt: number;
}

// 가라앉히고 · 낮추고 · 살짝 기울인다. 그냥 투명하게 지우면 「없어졌다」가 아니라 「안 그려진다」로 보인다.
export function collapseTransform(progress: number, heightMeters = 4): CollapseTransform {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  return {
    // 제 키만큼 땅 밑으로
    sink: -(heightMeters / METERS_PER_UNIT) * p * 1.05,
    squash: 1 - 0.45 * p,
    // 처음부터 흐려지면 유령처럼 보인다 — 마지막에만 빠르게
    opacity: p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25,
    tilt: p * 0.1,
  };
}
