// 소품이 떠다니는 NPC 를 막는지 소품마다 한 번 정한다 (높이로 가르는 필터). 모두 도면 미터.
//
// [왜 미리 정하나] NPC 는 지면 + baseHeight 에 떠 있어 몸(구체)이 지면 + (baseHeight ± 반경) 높이를 지난다.
//   그 높이를 NPC 의 「지금 높이」로 매 프레임 가르면, 경사진 땅에서 소품 꼭대기 언저리를 지날 때 막힘이
//   프레임마다 켜졌다 꺼져 0.1 m 씩 들어갔다 밀려나는 떨림이 생긴다(틈바위, 10/20 하네스).
//   그래서 「NPC 가 이 소품과 겹칠 수 있는 자리 중 가장 낮은 땅」에 떴을 때의 몸 높이로 미리 정한다.
// [어디를 보나] NPC 중심이 소품 중심에서 (소품 반경 + NPC 반경) 안에 들어와야 몸이 겹친다. 그 원판 안을
//   격자(gridStep)와 둘레 방향(ringDirections)으로 짚는다. 다섯 점(중심 + 네 방향)만 보면 축 사이의 넓은
//   구덩이·내리막을 놓친다(checks 의 합성 지형 사례). 10/20 실제 소품 비교(checks/npcChecks.ts B):
//   NPC 가 실제로 뜨는 높이 규칙 기준으로는 다섯 점·이 방식 모두 놓친 소품 0개였고, 생 지면 0.05 m 격자 기준
//   으로는 다섯 점 3개 · 이 방식 2개를 덜 막았다(발밑 탐침이 메우는 얇은 가장자리라 실제로는 닿지 않음).
// [물·벼랑] NPC 는 강·벼랑에 서지 않으므로 「가장 낮은 땅」에서 뺀다(강바닥 높이로 강가 소품을 과하게 막지 않게).
//   원판 안에 설 수 있는 땅이 하나도 없으면 전부로 잰다(보수적으로 막는 쪽).
// [한계] 표본 사이의 더 좁은 구덩이는 여전히 못 볼 수 있다. 또 NPC 높이는 코어의 발밑 탐침(둘레 0.2 m 중
//   가장 높은 땅)으로 정해져 실제로는 이 값보다 같거나 높게 뜬다 — 그만큼은 막는 쪽으로 기운다.
// 도면 차단물(B1~B4 등)은 여기서 다루지 않는다 — 지형의 blockers 로 따로 오고, 치움(clearedBlockers)이 바뀐다.

import { NPC_COLLISION_RADIUS } from "./collision";
import { HOVER_CONFIG } from "./hover";

/** 지면 표본 하나 — terrain.groundAt 결과 중 필요한 것만 */
export interface PropGroundSample {
  y: number;
  isWater: boolean;
  isFall: boolean;
}

export type GroundAt = (x: number, z: number) => PropGroundSample;

/** 높이 필터가 보는 소품 (propColliders 의 원기둥) */
export interface PropShape {
  x: number;
  z: number;
  radius: number;
  bottom: number;
  top: number;
}

export const PROP_SAMPLE_CONFIG = {
  gridStep: 0.25, // 원판 안 격자 간격 (m)
  ringDirections: 8, // 원판 둘레를 짚는 방향 수
} as const;

export interface GroundRange {
  /** 설 수 있는 땅(물·벼랑 아님) 중 가장 낮은 곳. 설 수 있는 표본이 없으면 전체 중 가장 낮은 곳 */
  lowest: number;
  /** 전체 표본 중 가장 높은 곳 */
  highest: number;
  /** groundAt 호출 수 */
  samples: number;
}

/** (x, z) 를 중심으로 반지름 reach 원판 안의 지면 높이 범위 */
export function groundRangeAround(
  groundAt: GroundAt,
  x: number,
  z: number,
  reach: number,
  step: number = PROP_SAMPLE_CONFIG.gridStep,
  ringDirections: number = PROP_SAMPLE_CONFIG.ringDirections,
): GroundRange {
  let lowestWalkable = Infinity;
  let lowestAny = Infinity;
  let highest = -Infinity;
  let samples = 0;
  const visit = (px: number, pz: number) => {
    const g = groundAt(px, pz);
    samples++;
    if (g.y > highest) highest = g.y;
    if (g.y < lowestAny) lowestAny = g.y;
    if (!g.isWater && !g.isFall && g.y < lowestWalkable) lowestWalkable = g.y;
  };
  visit(x, z);
  for (let k = 0; k < ringDirections; k++) {
    const angle = (k / ringDirections) * Math.PI * 2;
    visit(x + Math.cos(angle) * reach, z + Math.sin(angle) * reach);
  }
  // 격자는 중심을 지나는 칸으로 깐다. 중심 칸(0, 0)은 위에서 이미 봤다.
  const cells = Math.floor(reach / step);
  for (let i = -cells; i <= cells; i++) {
    for (let j = -cells; j <= cells; j++) {
      if (i === 0 && j === 0) continue;
      const ox = i * step;
      const oz = j * step;
      if (ox * ox + oz * oz > reach * reach) continue;
      visit(x + ox, z + oz);
    }
  }
  return { lowest: Number.isFinite(lowestWalkable) ? lowestWalkable : lowestAny, highest, samples };
}

/** 몸(구체)이 지나는 높이 범위와 소품 높이 범위가 겹치는가 */
export function propOverlapsBody(prop: PropShape, range: GroundRange): boolean {
  const bodyBottom = range.lowest + HOVER_CONFIG.baseHeight - NPC_COLLISION_RADIUS;
  const bodyTop = range.highest + HOVER_CONFIG.baseHeight + NPC_COLLISION_RADIUS;
  return prop.top > bodyBottom && prop.bottom < bodyTop;
}

export interface PropFilterResult {
  /** 소품 순번 → 1 이면 NPC 를 막는다 */
  blocks: Uint8Array;
  blocking: number;
  /** groundAt 호출 수 (초기화 비용 지표) */
  samples: number;
}

/** 소품 목록 전체를 한 번 가른다. 어댑터가 월드를 만들 때(소품·지형이 바뀔 때)만 부른다 */
export function classifyProps(groundAt: GroundAt, props: readonly PropShape[]): PropFilterResult {
  const blocks = new Uint8Array(props.length);
  let blocking = 0;
  let samples = 0;
  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    const range = groundRangeAround(groundAt, prop.x, prop.z, prop.radius + NPC_COLLISION_RADIUS);
    samples += range.samples;
    if (propOverlapsBody(prop, range)) {
      blocks[i] = 1;
      blocking++;
    }
  }
  return { blocks, blocking, samples };
}
