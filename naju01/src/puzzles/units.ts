/** 퍼즐 좌표는 미터로 적고 그릴 때 유닛으로 바꾼다 — 도면·지형과 같은 단위 */
import { UNITS_PER_METER } from "../plan/sitePlan";
import { DEFAULT_TERRAIN } from "../terrain/terrain";

export const M = UNITS_PER_METER;

/** 지면 높이(미터) */
export const groundY = (x: number, z: number) => DEFAULT_TERRAIN.groundAt(x, z).y;
