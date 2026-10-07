// Meshy 자연물 구운 모형을 표본으로 굽는다 — 나무 5 · 바위 7 · 자갈돌 7 · 수풀 2 · 잡초 2 · 꽃 2 · 자갈밭 · 초가집.
// 규약(밑동 원점 · 키 1 / 중심 원점)을 맞춰 구워서, 놓는 코드도 저장된 편집도 건드리지 않고 모양만 갈아 끼운다.
//
// 색을 어디에 두는지가 물건마다 다르다:
//   자리에 색이 붙는 것(바위·자갈) → 표본은 비율만 굽는다. 진짜 색을 넣으면 두 번 곱해져 시커메진다.
//   자리에 색이 없는 것(나무·풀·꽃) → 표본이 진짜 색을 가진다. 안 그러면 흰색만 남아 새하얗다.
//
// 받은 모형의 비례는 건드리지 않는다. 크거나 작으면 키로 맞춘다 — 눌러서 맞추면 덤불이 선인장이 된다.

import * as THREE from "three";
import type { AssetDefinition } from "../placement/assetCatalog";
import { DISTANT_STYLE } from "../world/distantLandscape";
import { VEGETATION_STYLE } from "../world/vegetation";
import {
  BUSH_2,
  BUSH_3,
  FLOWER_1,
  FLOWER_2,
  GRAVEL_PATCH_1,
  PEBBLE_1,
  PEBBLE_2,
  PEBBLE_3,
  PEBBLE_4,
  PEBBLE_5,
  PEBBLE_6,
  PEBBLE_7,
  ROCK_1,
  ROCK_2,
  ROCK_3,
  ROCK_4,
  ROCK_5,
  ROCK_6,
  ROCK_7,
  THATCHED_HOUSE_1,
  THATCHED_HOUSE_2,
  THATCHED_HOUSE_3,
  TREE_2,
  TREE_4,
  TREE_5,
  TREE_6,
  TREE_7,
  WEED_1,
  WEED_2,
} from "./baked";
import { bakedModelGeometry, findThinParts, findTrunk, type PaintVertices } from "./bakedGeometry";

type Geometries = THREE.BufferGeometry[];

// 씬과 팔레트 썸네일이 따로 부르므로 한 번만 굽고 돌려쓴다
const cache = new Map<string, Geometries>();
const once = (key: string, build: () => Geometries) => {
  let value = cache.get(key);
  if (!value) cache.set(key, (value = build()));
  return value;
};

const setColor = (colors: Float32Array, i: number, color: THREE.Color) => {
  colors[i * 3] = color.r;
  colors[i * 3 + 1] = color.g;
  colors[i * 3 + 2] = color.b;
};

// 위를 보는 면은 해를 받고 아래를 보는 면은 그늘
const facingUp = (normal: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number) =>
  THREE.MathUtils.clamp(normal.getY(i) * 0.5 + 0.5, 0, 1);

/** 나무 — 줄기는 나무색, 잎은 초록. 손으로 깎던 나무와 같은 팔레트여야 원경과 안 겉돈다. */
export function treeModels(): Geometries {
  return once("tree", () => {
    const trunk = new THREE.Color(VEGETATION_STYLE.trunk);
    const trunkDark = new THREE.Color(VEGETATION_STYLE.trunkDark);
    const leaf = new THREE.Color(VEGETATION_STYLE.leaf);
    const leafDark = new THREE.Color(VEGETATION_STYLE.leafDark);
    const leafLight = new THREE.Color(VEGETATION_STYLE.leafLight);
    const temp = new THREE.Color();
    // 나무1·나무3 은 팀 판정으로 뺐다
    return [TREE_2, TREE_4, TREE_5, TREE_6, TREE_7].map((model) =>
      bakedModelGeometry(model, {
        paint: (geometry, _model, colors) => {
          const p = geometry.attributes.position;
          const normal = geometry.attributes.normal;
          // findThinParts 는 줄기 굵기가 찾는 반경과 비슷해 포화된다 — 나무 전용 수를 쓴다
          const { trunk: trunkVertices } = findTrunk(geometry);
          for (let i = 0; i < p.count; i++) {
            const up = facingUp(normal, i);
            if (trunkVertices.has(i)) {
              const grain = 0.5 + 0.5 * Math.sin(p.getY(i) * 260 + p.getX(i) * 41);
              temp.copy(trunkDark).lerp(trunk, 0.25 + 0.68 * up);
              temp.multiplyScalar(0.93 + 0.12 * grain);
            } else {
              // 바닥을 잎어둠으로 잡는다 — 더 어두우면 잎덩이 밑면이 새까매진다
              temp.copy(leafDark).lerp(leaf, THREE.MathUtils.clamp(up * 1.5, 0, 1));
              if (up > 0.72) temp.lerp(leafLight, ((up - 0.72) / 0.28) * 0.55);
            }
            setColor(colors, i, temp);
          }
        },
      }),
    );
  });
}

// 근경 바위와 자갈돌이 같은 돌로 보이게 칠을 하나로 묶는다. 비율만 굽는다.
const paintStone: PaintVertices = (geometry, _model, colors) => {
  const normal = geometry.attributes.normal;
  const p = geometry.attributes.position;
  for (let i = 0; i < normal.count; i++) {
    const up = facingUp(normal, i);
    // 잔 얼룩 — 없으면 매끈한 고무 덩이로 보인다
    const speckle = Math.sin(p.getX(i) * 47 + p.getZ(i) * 31) * Math.sin(p.getY(i) * 53);
    const v = (0.66 + 0.52 * Math.pow(up, 0.8)) * (1 + 0.06 * speckle);
    colors[i * 3] = v;
    colors[i * 3 + 1] = v;
    colors[i * 3 + 2] = v;
  }
};

/** 바위 — 강돌은 원래 납작하다. 세워 맞추지 않는다. */
export function rockModels(): Geometries {
  return once("rock", () =>
    [ROCK_1, ROCK_2, ROCK_3, ROCK_4, ROCK_5, ROCK_6, ROCK_7].map((model) =>
      bakedModelGeometry(model, { paint: paintStone }),
    ),
  );
}

// 같은 바위를 아주 낮게(90 삼각형) 구운 것. 1,699 개가 깔려서 근경 바위를 쓰면 맵 전체보다 무겁다.
function pebbleModels(): Geometries {
  return once("pebble", () =>
    [PEBBLE_1, PEBBLE_2, PEBBLE_3, PEBBLE_4, PEBBLE_5, PEBBLE_6, PEBBLE_7].map((model) =>
      bakedModelGeometry(model, { paint: paintStone }),
    ),
  );
}

/**
 * 자갈 무리 표본 — 앞 일곱이 근경 바위, 뒤 일곱이 자갈돌. 순서가 중요하다:
 * 손으로 놓은 큰 돌은 모양 0~6 으로 저장돼 있어 앞에 바위가 있어야 제대로 된 바위가 된다.
 */
export function pebblePrototypes(): Geometries {
  return once("pebbleSet", () => [...rockModels(), ...pebbleModels()]);
}
/** 이 앞이 바위 · 이 뒤가 자갈돌 */
export const PEBBLE_START_INDEX = 7;

// 밑동은 그늘지고 끝은 볕을 받는다 — 위아래 명암이 없으면 초록 덩어리 하나로 뭉개진다
const paintPlant =
  (bottomColor: THREE.Color, topColor: THREE.Color, tipColor: THREE.Color): PaintVertices =>
  (geometry, model, colors) => {
    const p = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const height = model.size.y || 1;
    const temp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const rise = THREE.MathUtils.clamp(p.getY(i) / height, 0, 1);
      const up = facingUp(normal, i);
      temp.copy(bottomColor).lerp(topColor, Math.pow(rise, 0.7));
      temp.lerp(tipColor, up * 0.45 * rise);
      setColor(colors, i, temp);
    }
  };

/** 수풀 — 가로가 키의 1.8 배인 덩이 그대로. 수풀1 은 지피식물이라 팀 판정으로 뺐다. */
export function bushModels(): Geometries {
  return once("bush", () => {
    const paint = paintPlant(
      new THREE.Color(VEGETATION_STYLE.leafDark),
      new THREE.Color(VEGETATION_STYLE.leaf),
      new THREE.Color(VEGETATION_STYLE.leafLight),
    );
    return [BUSH_2, BUSH_3].map((model) => bakedModelGeometry(model, { paint }));
  });
}

/** 잡초 — 잎보다 마른 빛. 숲과 같은 초록이면 어린 나무로 보인다. */
export function weedModels(): Geometries {
  return once("weed", () => {
    const paint = paintPlant(new THREE.Color("#3E4A31"), new THREE.Color("#77864F"), new THREE.Color("#A3AC66"));
    return [WEED_1, WEED_2].map((model) => bakedModelGeometry(model, { paint }));
  });
}

/** 꽃 — 한 송이가 아니라 무더기다. 팔레트에서 「꽃밭 한 뙈기」로 쓴다. */
export function flowerModels(): Geometries {
  return once("flower", () => {
    const paint = paintPlant(
      new THREE.Color("#42502F"),
      new THREE.Color("#7C8C55"),
      new THREE.Color("#D9D2B4"), // 흰빛이 도는 들꽃
    );
    return [FLOWER_1, FLOWER_2].map((model) => bakedModelGeometry(model, { paint }));
  });
}

/** 자갈밭 한 무더기 — 흩뿌린 낱개 자갈을 대신하지 않는다. 손으로 한 장 놓을 때 쓴다. 비율만 굽는다. */
export function gravelPatchModels(): Geometries {
  return once("gravelPatch", () => [bakedModelGeometry(GRAVEL_PATCH_1, { bottom: 1.12, top: 0.72 })]);
}

// 지붕은 원경 초가색보다 밝게 — 원경 색을 고치면 모형자연을 껐을 때 옛 집 그림까지 바뀐다
const STRAW = "#CBB87C";
const STRAW_SHADE = "#8C7C4E";

/**
 * 초가집 — 기단(돌) · 기둥과 문틀(나무) · 지붕(짚) · 흙벽 넷으로 칠한다. 둘만 가르면 멀리서 누런 덩어리다.
 * 면 수 4,000 은 눈으로 재서 정했다(1,596 은 뭉개지고 3,966 부터 기둥·창이 다 읽힌다).
 * 초가집2 는 집 한 채가 아니라 마을 한 덩이라 여기 넣지 않는다.
 */
export function thatchedHouseModels(): Geometries {
  return once("thatchedHouse", () => {
    const straw = new THREE.Color(STRAW);
    const strawShade = new THREE.Color(STRAW_SHADE);
    const wall = new THREE.Color(DISTANT_STYLE.earthWall);
    const wallShade = new THREE.Color(DISTANT_STYLE.earthWall).multiplyScalar(0.68);
    const wood = new THREE.Color("#6A5540");
    const woodShade = new THREE.Color("#3A2E22");
    const plinth = new THREE.Color("#8B867C");
    const plinthShade = new THREE.Color("#4E4A44");
    const temp = new THREE.Color();
    const roofFrom = 0.45;
    const plinthTo = 0.08;
    return [THATCHED_HOUSE_1, THATCHED_HOUSE_3].map((model) => {
      const geometry = bakedModelGeometry(model, {
        paint: (g, m, colors) => {
          const p = g.attributes.position;
          const normal = g.attributes.normal;
          const height = m.size.y || 1;
          const timber = findThinParts(g, { radius: 0.1, spreadThreshold: 0.05, minorAxisThreshold: 0.03 });
          for (let i = 0; i < p.count; i++) {
            const rise = THREE.MathUtils.clamp(p.getY(i) / height, 0, 1);
            const up = facingUp(normal, i);
            if (rise < plinthTo) {
              temp.copy(plinthShade).lerp(plinth, 0.4 + 0.58 * up);
            } else if (rise > roofFrom) {
              // 이엉 결이 있어야 초가로 보인다. 그늘 쪽 바닥도 올려 덩어리째 가라앉지 않게.
              const grain = 0.5 + 0.5 * Math.sin(rise * 190 + p.getX(i) * 23);
              temp.copy(strawShade).lerp(straw, 0.55 + 0.45 * up);
              temp.multiplyScalar(0.96 + 0.1 * grain);
            } else if (timber.has(i)) {
              const grain = 0.5 + 0.5 * Math.sin(p.getY(i) * 240);
              temp.copy(woodShade).lerp(wood, 0.3 + 0.66 * up);
              temp.multiplyScalar(0.93 + 0.13 * grain);
            } else {
              temp.copy(wallShade).lerp(wall, 0.4 + 0.58 * up);
            }
            setColor(colors, i, temp);
          }
        },
      });
      // 가로가 키의 2.4~3.2 배라 그대로면 키 4.2 짜리 집이 폭 13.5 m 다. 옛 원경집 비(1.72)로 균등하게 줄인다.
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) || 1;
      const scale = 1.72 / width;
      geometry.scale(scale, scale, scale);
      geometry.computeBoundingBox();
      return geometry;
    });
  });
}

// 초가집2 — 집 여러 채 + 나무 + 바닥판이 얹힌 마을 한 덩이. 손으로 놓는 에셋으로만 쓴다.
function thatchedVillageClusters(): Geometries {
  return once("thatchedVillage", () => {
    const straw = new THREE.Color(STRAW);
    const strawShade = new THREE.Color(STRAW_SHADE);
    const wall = new THREE.Color(DISTANT_STYLE.earthWall);
    const wallShade = new THREE.Color(DISTANT_STYLE.earthWall).multiplyScalar(0.68);
    const temp = new THREE.Color();
    return [
      bakedModelGeometry(THATCHED_HOUSE_2, {
        paint: (g, m, colors) => {
          const p = g.attributes.position;
          const normal = g.attributes.normal;
          const height = m.size.y || 1;
          for (let i = 0; i < p.count; i++) {
            const rise = THREE.MathUtils.clamp(p.getY(i) / height, 0, 1);
            const up = facingUp(normal, i);
            if (rise > 0.5) temp.copy(strawShade).lerp(straw, 0.45 + 0.55 * up);
            else temp.copy(wallShade).lerp(wall, 0.4 + 0.58 * up);
            setColor(colors, i, temp);
          }
        },
      }),
    ];
  });
}

interface SingleItem {
  key: string;
  label: string;
  count: number;
  pick: (i: number) => THREE.BufferGeometry;
  defaultSize: number;
  centerOrigin?: boolean;
  defaultColor?: number;
  doubleSided?: boolean;
}

// 팔레트의 「바위」「나무」는 여러 종을 무작위로 놓는다. 「저 자리에 저 바위」를 놓으려면 낱개로도 집혀야 한다.
// 같은 지오를 돌려쓰므로 새로 굽지 않는다.
const SINGLE_ITEMS: SingleItem[] = [
  {
    key: "자연.바위",
    label: "바위",
    count: 7,
    pick: (i) => rockModels()[i],
    defaultSize: 1.2,
    centerOrigin: true,
    defaultColor: 0x8a8375,
  },
  {
    key: "자연.자갈돌",
    label: "자갈돌",
    count: 7,
    pick: (i) => pebbleModels()[i],
    defaultSize: 0.28,
    centerOrigin: true,
    defaultColor: 0x94908a,
  },
  { key: "자연.나무", label: "나무", count: 5, pick: (i) => treeModels()[i], defaultSize: 5.0 },
  { key: "자연.수풀", label: "수풀", count: 2, pick: (i) => bushModels()[i], defaultSize: 0.7 },
  { key: "자연.잡초", label: "잡초", count: 2, pick: (i) => weedModels()[i], defaultSize: 0.5, doubleSided: true },
  { key: "자연.꽃밭", label: "꽃밭", count: 2, pick: (i) => flowerModels()[i], defaultSize: 0.75, doubleSided: true },
  { key: "자연.초가집", label: "초가집", count: 2, pick: (i) => thatchedHouseModels()[i], defaultSize: 4.2 },
  { key: "자연.초가마을", label: "초가 마을 덩이", count: 1, pick: () => thatchedVillageClusters()[0], defaultSize: 9 },
  {
    key: "자연.자갈밭",
    label: "자갈밭",
    count: 1,
    pick: (i) => gravelPatchModels()[i],
    defaultSize: 2.2,
    defaultColor: 0x94908a,
  },
];

/** 팔레트에 그대로 펼칠 낱개 자연물. 키는 `자연.바위1` 꼴(편집 파일 무리 열쇠). */
export function singleItemAssets(): AssetDefinition[] {
  const assets: AssetDefinition[] = [];
  for (const item of SINGLE_ITEMS)
    for (let i = 0; i < item.count; i++)
      assets.push({
        key: `${item.key}${i + 1}`,
        label: item.count > 1 ? `${item.label} ${i + 1}` : item.label,
        category: "자연물 낱개",
        defaultSize: item.defaultSize,
        centerOrigin: item.centerOrigin,
        defaultColor: item.defaultColor,
        doubleSided: item.doubleSided,
        prototype: () => [item.pick(i)],
      });
  return assets;
}
