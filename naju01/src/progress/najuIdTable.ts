/**
 * 나주 대응표 v1 — 로컬 ID → 런타임 ID(「나주_ID대응표_v1_1108.md」 5절, 미르 11/8 확정).
 * 서버 · NPC 콘텐츠는 런타임 ID만 쓴다. FE 는 서버로 보낼 때만 이 표로 바꾼다(progressSync.createProgressIdMap).
 * 표에 없는 로컬 ID 는 서버로 보내지 않는다. 정답 값은 여기에도, 코드 어디에도 없다.
 *
 * content_version 1 에서 서버에 연결된 것만 넣는다: 구역 여섯 · P01 · P03 · P07 · P09 대표 물건 · 비석(inspect).
 * 다음 판에서 퍼즐을 연결하면 대응표 2절의 런타임 ID 를 그대로 더한다. 4 · 5스테이지는 v1 에서 서버 연결이 없다.
 * React · 별칭을 쓰지 않는다(node --test).
 */
import type { ProgressIdTable } from "./progressSync.ts";

export const NAJU_ID_TABLE_V1: ProgressIdTable = {
  zones: {
    Z1: "ZONE_FERRY_TERRACE",
    Z2: "ZONE_GRAVEL_BEACH",
    Z3: "ZONE_CLIFF_TOP",
    Z4: "ZONE_JINBU_RIDGE",
    "cave-hall": "ZONE_RIVER_CAVE_HALL",
    "cave-inner": "ZONE_RIVER_CAVE_INNER",
  },
  objects: {
    "clam-holes": "OBJ_S1_CLAM_HOLES",
    "jar-slots": "OBJ_S1_JAR_SLOTS",
    "cave-big-clam": "OBJ_S1_CAVE_BIG_CLAM",
    "cave-door": "OBJ_S1_CAVE_RING_DOOR",
    "cave-tablet": "OBJ_S1_CAVE_TABLET",
  },
};
