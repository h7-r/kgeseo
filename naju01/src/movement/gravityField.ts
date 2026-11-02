// 자리마다 중력 배율 — 증언 능선 바람 장막 안에서는 바람이 몸을 떠받쳐 달 위처럼 높이 뛰고 둥둥 내려온다.
// 퍼즐이 scaleAt · speedScaleAt 을 갈아 끼운다(없으면 1). 가벼운 곳은 점프 힘이 조금 세고, 꼭대기에서 머물고,
// 떨어지는 빠르기에 끝이 있으며(둥둥), 공중에서 바람에 살짝 밀린다.

export const gravityField: {
  scaleAt: ((x: number, z: number) => number) | null;
  /** 걷기·공중 빠르기 배율 — 장막 안은 바람을 헤치느라, 등짐을 지면 무거워서 느리다 */
  speedScaleAt: ((x: number, z: number) => number) | null;
} = { scaleAt: null, speedScaleAt: null };

/** 점프 순간 앞으로 실리는 빠르기 배율 · 그 뒤 공중에서 나아가는 배율 — 「뛰면서 앞으로 간다」가 눈에 보이게 */
export const AIR_BOOST = { normal: 1.6, light: 1.5 };
/** 가벼운 곳(중력 배율 이 아래)에서 점프 힘 배율 */
export const LIGHT_JUMP = 1.1;
export const isLight = (scale: number) => scale < 0.5;
/** 가벼운 곳의 둥둥 — 떨어지는 최고 빠르기(m/s) · 꼭대기 근처(이 빠르기 아래)에서 중력을 더 줄이는 배율 · 바람에 밀리는 세기(m/s) */
export const FLOAT = { sinkLimit: 1.25, apexSpeed: 0.9, apexGravity: 0.45, drift: 0.35 };
