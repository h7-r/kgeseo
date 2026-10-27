// NPC 동행 개발 테스트(?npc)에서 쓰는 고정 값. 본편 동작과 무관하다.

import { ZONES, type ZoneCode } from "../plan/sitePlan";

/**
 * 고정 임시 NPC 자리 (도면 미터). Z1(나루터 · x 8–28, z 30–44, 고도 0) 안,
 * 시작 시점 V1(11, 38.5, +X 를 봄) 앞 4 m · 조금 왼쪽이라 첫 화면에 보인다.
 * 아비사(22, 38.5)와 7 m 떨어져 있어 헷갈리지 않는다.
 */
export const NPC_TEST_SPOT = { x: 15, z: 37 } as const;

/** 임시 NPC 표시 색 — 아비사(사람 모형)와 구분되는 하늘색 구체 */
export const NPC_TEST_COLOR = "#8de5ff";

/**
 * 임시 NPC 구체의 보이는 반지름 (m). 플레이어 캐릭터에 견줘 0.35 m 는 너무 커 보여 줄였다.
 * 그리기 전용이다 — 충돌·경로 탐색·이동은 NPC 코어의 NPC_COLLISION_RADIUS(0.35 m)를 그대로 쓴다.
 */
export const NPC_TEST_VISUAL_RADIUS = 0.2;

/**
 * NPC 가 다닐 수 있는 구역. `?npc=z1` 처럼 구역 코드를 주면 그 구역 안에서만 움직이고(구역 밖 땅은
 * 못 걷는 땅으로 본다), 그냥 `?npc` 면 맵 전체다 — 그때도 강·절벽·코어 밖은 지형 판정이 막는다.
 * 1차 통합은 Z1(평탄 · 고도 0)에서 먼저 확인한다.
 */
export const NPC_TEST_AREA: ZoneCode | null = (() => {
  const value = typeof location !== "undefined" ? new URLSearchParams(location.search).get("npc") : null;
  const code = value?.toUpperCase();
  return ZONES.find((zone) => zone.code === code)?.code ?? null;
})();

const NPC_TEST_ZONE = ZONES.find((zone) => zone.code === NPC_TEST_AREA) ?? null;

/** NPC_TEST_AREA 의 구역 사각형 안인가 (도면 미터). 구역을 안 정했으면 늘 true. 지형 판정이 자주 부른다 */
export function isInsideNpcTestArea(x: number, z: number): boolean {
  if (!NPC_TEST_ZONE) return true;
  return x >= NPC_TEST_ZONE.x[0] && x <= NPC_TEST_ZONE.x[1] && z >= NPC_TEST_ZONE.z[0] && z <= NPC_TEST_ZONE.z[1];
}
