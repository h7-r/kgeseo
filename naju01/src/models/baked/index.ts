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
