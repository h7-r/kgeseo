// 좌표 단위 변환. NPC 로직은 전부 미터(도면 좌표)로 계산하고, 나주 월드(유닛)와 주고받을 때만 여기서 바꾼다.
// 상수는 나주 맵의 것을 그대로 쓴다 (plan/sitePlan.ts — 1 유닛 ≈ 0.3 m).
import { METERS_PER_UNIT, UNITS_PER_METER } from "../plan/sitePlan";

export { METERS_PER_UNIT, UNITS_PER_METER };

export const unitsToMeters = (value: number): number => value * METERS_PER_UNIT;
export const metersToUnits = (value: number): number => value * UNITS_PER_METER;
