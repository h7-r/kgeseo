/** 그 자리의 물 높이 — 물에 뜨는 물건이 읽는다. 좌표는 미터 */
import { walkTerrain } from "../../movement/playerPose";
import { DEFAULT_TERRAIN } from "../../terrain/terrain";
import { CORRIDOR, cave } from "../cave/caveState";
import { FLOOD_RECTS } from "./floodRects";
import { getWaterLevel } from "./ritualState";

const isInRect = (rect: { x: number[]; z: number[] }, x: number, z: number) =>
  x >= rect.x[0] && x <= rect.x[1] && z >= rect.z[0] && z <= rect.z[1];

/** 물 위가 아니면 -Infinity. 갈라진 물길과 물굴 안은 바닥에 서는 곳이라 물이 없는 셈이다 */
export function floodSurfaceAt(x: number, z: number) {
  const isCaveFloor =
    cave.isOpen() && cave.contains(x, z) && (z >= CORRIDOR.zEnd || Math.abs(x - CORRIDOR.x) <= CORRIDOR.halfWidth);
  if (isCaveFloor) return -Infinity;
  const level = getWaterLevel();
  if (level >= 0 && (isInRect(FLOOD_RECTS.gravel, x, z) || isInRect(FLOOD_RECTS.river, x, z))) return level;
  return (walkTerrain.current ?? DEFAULT_TERRAIN).groundAt(x, z).isWater ? 0 : -Infinity;
}
