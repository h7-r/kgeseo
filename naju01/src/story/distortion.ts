// 「이 공간이 어딘가 어긋나 있다」를 화면에 심는 곳.
// 왜곡은 세기 하나가 아니라 (세기, 결) 두 축이다. 씬 1 → 2 에서 바뀌는 것은 세기가 아니라 결이다
// — 흐림(안 보인다 = 정보가 없다) → 겹침(여럿 보이는데 뭐가 진짜인지 모른다 = 정보가 모순이다).
// 방아쇠는 씬 번호가 아니라 퍼즐 완료다(④ §0.7). 씬 2 를 도는 동안 공간은 아직 「초기」다.
// 같은 무리를 조금씩 어긋나게 여러 벌 겹쳐 그린다 — 오프셋이 작고 여럿이면 흐림, 크고 둘이면 겹침.
// 택촌에만 거는 이유: 거리 따라 뿌옇게 하면 안개로 읽힌다. 그 마을만 이상해야 왜곡이다.

import * as THREE from "three";

export type DistortionKind = "blur" | "overlap" | "none";

export interface DistortionStage {
  strength: number;
  kind: DistortionKind;
  /** 물결 어긋남 정도(0~1) */
  waterShift: number;
  description: string;
}

/** Leva 「왜곡단계」 옵션 값(저장 데이터라 글자 그대로) */
export type DistortionStageOption = "초기" | "P01" | "P02" | "P03" | "P04";
export type DistortionStageId = "initial" | "p01" | "p02" | "p03" | "p04";

export const DISTORTION_STAGE_IDS: Record<DistortionStageOption, DistortionStageId> = {
  초기: "initial",
  P01: "p01",
  P02: "p02",
  P03: "p03",
  P04: "p04",
};

// 각 단계는 직전에 푼 퍼즐이다. initial = 아무것도 안 푼 상태.
export const DISTORTION_STAGES: Record<DistortionStageId, DistortionStage> = {
  initial: { strength: 0.42, kind: "blur", waterShift: 0.55, description: "Scene 01~02 — 미묘한 위화감" },
  p01: { strength: 0.5, kind: "overlap", waterShift: 0.65, description: "Scene 03 — 증언이 겹친다" },
  p02: { strength: 0.62, kind: "overlap", waterShift: 0.8, description: "Scene 04 — 어긋남이 커진다" },
  p03: { strength: 0.75, kind: "overlap", waterShift: 1.0, description: "Scene 05 직전 — 절정" },
  // 걷히는 것은 여기 한 번뿐이다. 씬 3 은 「진실이 드러나도 왜곡이 걷히지 않는다」를 동력으로 쓴다.
  p04: { strength: 0, kind: "none", waterShift: 0, description: "왜곡 해소 · 동적 연출 정상화" },
};

export const DISTORTION_STAGE_ORDER: DistortionStageOption[] = ["초기", "P01", "P02", "P03", "P04"];

export interface Afterimage {
  /** 미는 거리 [x, y, z] (m) */
  offset: [number, number, number];
  opacity: number;
  /** 시간에 따라 떠도는 정도. 0 이면 붙박이 */
  sway: number;
}

// 옆으로만 밀면 「그림자가 둘」로 보인다. 위로도 조금 띄워야 아지랑이로 읽힌다.
export function afterimageOffsets(kind: DistortionKind, strength: number): Afterimage[] {
  if (!strength || kind === "none") return [];
  // 택촌은 63 m 밖이라 가로 1 m 가 화면 18.4 px 다. 크기보다 대비가 모자랐다(afterimageColor 참고).
  if (kind === "blur")
    // 작게 · 여럿 — 윤곽만 뭉갠다(「크게 드러내지 않는다」)
    return [
      { offset: [0.85, 0.12, 0.5], opacity: 0.5 * strength, sway: 0.55 },
      { offset: [-0.72, 0.28, -0.4], opacity: 0.5 * strength, sway: 0.45 },
      { offset: [0.12, 0.55, 0.82], opacity: 0.4 * strength, sway: 0.62 },
    ];
  // 겹침 — 한 채 폭(4.2 m)의 절반쯤 어긋나야 둘로 세어진다
  return [
    { offset: [2.4, 0.15, 1.3], opacity: 0.62 * strength + 0.3, sway: 1.4 },
    { offset: [-2.1, 0.35, -1.1], opacity: 0.55 * strength + 0.26, sway: 1.2 },
  ];
}

// 주기를 서로 나누어떨어지지 않게 둬야 숨쉬듯 되돌아오는 느낌이 안 난다
export function swayAfterimage(afterimage: Afterimage, time: number, target = new THREE.Vector3()): THREE.Vector3 {
  const [x, y, z] = afterimage.offset;
  const s = afterimage.sway;
  return target.set(
    x + Math.sin(time * 0.23 + x * 3.1) * s,
    y + Math.sin(time * 0.17 + y * 5.7) * s * 0.35,
    z + Math.cos(time * 0.19 + z * 2.7) * s,
  );
}

// 원래 색으로 겹치면 진해져 오히려 또렷해진다. 그렇다고 지평선 색으로 많이 당기면
// 모래빛 들판과 같아져 통째로 사라진다 — 조금만 당기고 원래 어둠을 남긴다.
export function afterimageColor(
  baseColor: THREE.ColorRepresentation,
  horizonColor: THREE.ColorRepresentation,
  strength: number,
): THREE.Color {
  return new THREE.Color(baseColor).lerp(new THREE.Color(horizonColor), 0.12 + 0.16 * strength);
}

export interface WaterDistortion {
  /** 너울 진행 방향을 뒤집는 정도. 0 = 정상 · 1 = 완전히 거꾸로 */
  swellReversal: number;
  /** 잔물결을 옆으로 미끄러뜨리는 양 */
  sideDrag: number;
}

// 사람은 물의 방향을 너울로, 속도를 잔물결로 읽는다. 둘이 다투면 어느 쪽으로 흐르는지 판단이 안 선다.
// 너울 속도 = -0.28 × (1 − 2×정도) 라 0.5 에서 선다: 초기(0.55) 는 「멎은 물」, 역류는 P03 절정에서 온다.
// 강면의 update 와 물잔결에 같은 값을 넘긴다.
export function waterDistortion(amount: number): WaterDistortion {
  return {
    swellReversal: THREE.MathUtils.clamp(amount, 0, 1),
    sideDrag: 0.6 * amount,
  };
}
