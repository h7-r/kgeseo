// 구운 모형 JSON 에 타입을 붙여 한곳에서 내보낸다. JSON 은 tools/bake-model.mjs·decimate-models.mjs 가 쓴다.
// 실행 중에 fetch 하지 않고 번들에 묶는다 — 표본 함수가 전부 동기라 첫 프레임에 바로 써야 한다.

import bush2 from "./bush2.json";
import bush3 from "./bush3.json";
import ferryBoat from "./ferryBoat.json";
import fishTrap from "./fishTrap.json";
import flower1 from "./flower1.json";
import flower2 from "./flower2.json";
import gravelPatch1 from "./gravelPatch1.json";
import pebble1 from "./pebble1.json";
import pebble2 from "./pebble2.json";
import pebble3 from "./pebble3.json";
import pebble4 from "./pebble4.json";
import pebble5 from "./pebble5.json";
import pebble6 from "./pebble6.json";
import pebble7 from "./pebble7.json";
import rock1 from "./rock1.json";
import rock2 from "./rock2.json";
import rock3 from "./rock3.json";
import rock4 from "./rock4.json";
import rock5 from "./rock5.json";
import rock6 from "./rock6.json";
import rock7 from "./rock7.json";
import serpent from "./serpent.json";
import tent from "./tent.json";
import thatchedHouse1 from "./thatchedHouse1.json";
import thatchedHouse2 from "./thatchedHouse2.json";
import thatchedHouse3 from "./thatchedHouse3.json";
import tree2 from "./tree2.json";
import tree4 from "./tree4.json";
import tree5 from "./tree5.json";
import tree6 from "./tree6.json";
import tree7 from "./tree7.json";
import weed1 from "./weed1.json";
import weed2 from "./weed2.json";
// 원경판(…Far) — 같은 모형을 약 1/4 삼각형으로 줄인 것. 멀리(22 m 밖) 있는 것만 이것으로 그린다(10/13 원근 LOD).
//   옛 가지의 `도구/모형감면.mjs <이름> <목표> --원경` 산출물(src/모형/*원.js)을 JSON 으로 옮겼다.
//   순서가 원본과 같아야 한다 — 원근 나눔이 「원본 k 번 ↔ 원경판 k 번」으로 짝짓는다.
import bush2Far from "./bush2Far.json";
import bush3Far from "./bush3Far.json";
import flower1Far from "./flower1Far.json";
import flower2Far from "./flower2Far.json";
import pebble1Far from "./pebble1Far.json";
import pebble2Far from "./pebble2Far.json";
import pebble3Far from "./pebble3Far.json";
import pebble4Far from "./pebble4Far.json";
import pebble5Far from "./pebble5Far.json";
import pebble6Far from "./pebble6Far.json";
import pebble7Far from "./pebble7Far.json";
import rock1Far from "./rock1Far.json";
import rock2Far from "./rock2Far.json";
import rock3Far from "./rock3Far.json";
import rock4Far from "./rock4Far.json";
import rock5Far from "./rock5Far.json";
import rock6Far from "./rock6Far.json";
import rock7Far from "./rock7Far.json";
import thatchedHouse1Far from "./thatchedHouse1Far.json";
import thatchedHouse3Far from "./thatchedHouse3Far.json";
import tree2Far from "./tree2Far.json";
import tree4Far from "./tree4Far.json";
import tree5Far from "./tree5Far.json";
import tree6Far from "./tree6Far.json";
import tree7Far from "./tree7Far.json";
import weed1Far from "./weed1Far.json";
import weed2Far from "./weed2Far.json";

export interface BakedModel {
  name: string;
  /** 구운 원본 GLB 이름(기록용) */
  source: string;
  /** 정규화 규약: "lying"(Z 폭 1 · 밑동 원점) · "height"(Y 폭 1 · 밑동 원점) · "center"(한복판 원점) */
  rule: string;
  bakeCommand?: string;
  /** 감면 전 삼각형 수. 감면하지 않은 모형에는 없다. */
  decimatedFrom?: number;
  /** 규약대로 맞춘 뒤의 세 폭 — 놓는 쪽이 키를 정할 때 본다 */
  size: { x: number; y: number; z: number };
  vertexCount: number;
  triangleCount: number;
  /** base64 Float32 xyz */
  positions: string;
  /** base64 Uint16 */
  indices: string;
}

export const SERPENT = serpent satisfies BakedModel;
export const FLOWER_1 = flower1 satisfies BakedModel;
export const FLOWER_2 = flower2 satisfies BakedModel;
export const FERRY_BOAT = ferryBoat satisfies BakedModel;
export const TREE_2 = tree2 satisfies BakedModel;
export const TREE_4 = tree4 satisfies BakedModel;
export const TREE_5 = tree5 satisfies BakedModel;
export const TREE_6 = tree6 satisfies BakedModel;
export const TREE_7 = tree7 satisfies BakedModel;
export const ROCK_1 = rock1 satisfies BakedModel;
export const ROCK_2 = rock2 satisfies BakedModel;
export const ROCK_3 = rock3 satisfies BakedModel;
export const ROCK_4 = rock4 satisfies BakedModel;
export const ROCK_5 = rock5 satisfies BakedModel;
export const ROCK_6 = rock6 satisfies BakedModel;
export const ROCK_7 = rock7 satisfies BakedModel;
export const BUSH_2 = bush2 satisfies BakedModel;
export const BUSH_3 = bush3 satisfies BakedModel;
export const PEBBLE_1 = pebble1 satisfies BakedModel;
export const PEBBLE_2 = pebble2 satisfies BakedModel;
export const PEBBLE_3 = pebble3 satisfies BakedModel;
export const PEBBLE_4 = pebble4 satisfies BakedModel;
export const PEBBLE_5 = pebble5 satisfies BakedModel;
export const PEBBLE_6 = pebble6 satisfies BakedModel;
export const PEBBLE_7 = pebble7 satisfies BakedModel;
export const GRAVEL_PATCH_1 = gravelPatch1 satisfies BakedModel;
export const WEED_1 = weed1 satisfies BakedModel;
export const WEED_2 = weed2 satisfies BakedModel;
export const TENT = tent satisfies BakedModel;
export const THATCHED_HOUSE_1 = thatchedHouse1 satisfies BakedModel;
export const THATCHED_HOUSE_2 = thatchedHouse2 satisfies BakedModel;
export const THATCHED_HOUSE_3 = thatchedHouse3 satisfies BakedModel;
export const FISH_TRAP = fishTrap satisfies BakedModel;

// 원경판
export const BUSH_2_FAR = bush2Far satisfies BakedModel;
export const BUSH_3_FAR = bush3Far satisfies BakedModel;
export const FLOWER_1_FAR = flower1Far satisfies BakedModel;
export const FLOWER_2_FAR = flower2Far satisfies BakedModel;
export const PEBBLE_1_FAR = pebble1Far satisfies BakedModel;
export const PEBBLE_2_FAR = pebble2Far satisfies BakedModel;
export const PEBBLE_3_FAR = pebble3Far satisfies BakedModel;
export const PEBBLE_4_FAR = pebble4Far satisfies BakedModel;
export const PEBBLE_5_FAR = pebble5Far satisfies BakedModel;
export const PEBBLE_6_FAR = pebble6Far satisfies BakedModel;
export const PEBBLE_7_FAR = pebble7Far satisfies BakedModel;
export const ROCK_1_FAR = rock1Far satisfies BakedModel;
export const ROCK_2_FAR = rock2Far satisfies BakedModel;
export const ROCK_3_FAR = rock3Far satisfies BakedModel;
export const ROCK_4_FAR = rock4Far satisfies BakedModel;
export const ROCK_5_FAR = rock5Far satisfies BakedModel;
export const ROCK_6_FAR = rock6Far satisfies BakedModel;
export const ROCK_7_FAR = rock7Far satisfies BakedModel;
export const THATCHED_HOUSE_1_FAR = thatchedHouse1Far satisfies BakedModel;
export const THATCHED_HOUSE_3_FAR = thatchedHouse3Far satisfies BakedModel;
export const TREE_2_FAR = tree2Far satisfies BakedModel;
export const TREE_4_FAR = tree4Far satisfies BakedModel;
export const TREE_5_FAR = tree5Far satisfies BakedModel;
export const TREE_6_FAR = tree6Far satisfies BakedModel;
export const TREE_7_FAR = tree7Far satisfies BakedModel;
export const WEED_1_FAR = weed1Far satisfies BakedModel;
export const WEED_2_FAR = weed2Far satisfies BakedModel;
