// 좌표 단위 변환. NPC 로직은 전부 미터(지도 좌표)로 계산하고,
// 게임 쪽 값(유닛)과 주고받을 때만 여기서 바꾼다. 나주 맵 sitePlan.ts 의 값과 같다(1 유닛 ≈ 0.3 m).
export const METERS_PER_UNIT = 0.3
export const UNITS_PER_METER = 1 / METERS_PER_UNIT

export const unitsToMeters = (value: number): number => value * METERS_PER_UNIT
export const metersToUnits = (value: number): number => value * UNITS_PER_METER
