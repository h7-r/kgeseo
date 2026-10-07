// 편집기 팔레트에 뜨는 물건 목록. 한 줄을 더하면 팔레트에 뜨고, 놓고 옮기고 지우고 저장된다.
// 바닥톤·질감(표면)과 오르막길·언덕(지형)은 물건이 아니라 여기 없다 — 마우스로 주무르면
// 보이는 것과 걸을 수 있는 것이 어긋난다(이 프로젝트가 가장 오래 싸운 버그).
// 표본 규약: 높이 1 · 밑동 원점. 반쯤 파묻히는 돌만 중심이 원점이다.

import type * as THREE from "three";
import {
  bushModels,
  flowerModels,
  gravelPatchModels,
  pebblePrototypes,
  rockModels,
  singleItemAssets,
  treeModels,
  weedModels,
} from "../models/nature";
import {
  bonfirePrototypes,
  cairnPrototypes,
  fishTrapPrototypes,
  netFramePrototypes,
  serpentPrototypes,
  tentPrototypes,
} from "../story/scene1";
import {
  aFrameCarrierPrototypes,
  birdPolePrototypes,
  platformBedPrototypes,
  stoolPrototypes,
  waterJarPrototypes,
} from "../story/scene2";
import { brokenBranchPrototypes, dirtClodPrototypes, hairRibbonPrototypes, strawShoePrototypes } from "../story/scene3";
import { boatMarkPrototypes, footprintPrototypes, stakePrototypes } from "../story/scene4";
import { sacredRopePrototypes, smallTablePrototypes } from "../story/scene5";
import { distantHousePrototypes, distantTreePrototypes } from "../world/distantLandscape";
import { ferryBoatPrototype, landingPrototypes } from "../world/ferryLanding";
import { fenceSectionPrototypes } from "../world/fences";
import { LAND_PIECE_STYLE, moundPrototypes, pathPiecePrototypes } from "../world/landPieces";
import { personPrototypes } from "../world/people";
import {
  gravePrototypes,
  guardianPostPrototypes,
  stelePrototypes,
  torchPrototypes,
  villageSignPrototypes,
} from "../world/props";
import { STEPPING_STONE_STYLE, steppingStonePrototypes } from "../world/steppingStones";

export interface AssetDefinition {
  /** 편집 파일의 무리 열쇠 — 값은 저장 데이터다 */
  key: string;
  label: string;
  /** 팔레트 갈래(화면 글자) */
  category: string;
  /** 놓을 때의 키(m) */
  defaultSize: number;
  /** 반쯤 파묻히는 돌 — 놓을 때 키의 30 % 만큼 띄운다 */
  centerOrigin?: boolean;
  /**
   * 표본이 비율만 구운 것이면 색을 준다. 돌은 안 주면 흰 돌이 놓인다.
   * 표본에 진짜 색이 여럿 구워진 것(천막·씬 2·3)은 주지 않는다 — 모든 색에 곱해져 물든다.
   */
  defaultColor?: number | string;
  /** 안쪽이 보이는 물건. 단면이면 속이 뚫리고 광선이 지나가 클릭이 안 된다. */
  doubleSided?: boolean;
  /** 키에 대한 가로·세로 비. 안 주면 1(정육면체 꼴)이라 언덕이 봉우리가 되고 길이 정사각 널이 된다. */
  defaultWidthRatio?: number;
  defaultDepthRatio?: number;
  prototype: (seed: number) => THREE.BufferGeometry[];
}

export const ASSET_CATALOG: AssetDefinition[] = [
  // ── 돌 ──
  {
    key: "소품.바위",
    label: "바위",
    category: "돌",
    defaultSize: 1.2,
    centerOrigin: true,
    defaultColor: 0x8a8375,
    prototype: () => rockModels(),
  },
  {
    key: "소품.자갈",
    label: "자갈",
    category: "돌",
    defaultSize: 0.28,
    centerOrigin: true,
    defaultColor: 0x94908a,
    prototype: () => pebblePrototypes(),
  },
  // 「여기 자갈이 깔렸다」를 한 장으로 놓을 때. 국소 +Z 로 누움 · 키 = 무더기 길이.
  {
    key: "소품.자갈밭",
    label: "자갈밭",
    category: "돌",
    defaultSize: 2.2,
    defaultColor: 0x94908a,
    prototype: () => gravelPatchModels(),
  },
  // ── 풀·나무 ──
  { key: "소품.나무", label: "나무", category: "풀·나무", defaultSize: 5.0, prototype: () => treeModels() },
  { key: "소품.덤불", label: "덤불", category: "풀·나무", defaultSize: 0.7, prototype: () => bushModels() },
  { key: "소품.수풀", label: "수풀", category: "풀·나무", defaultSize: 0.7, prototype: () => bushModels() },
  {
    key: "소품.풀",
    label: "풀포기",
    category: "풀·나무",
    defaultSize: 0.45,
    doubleSided: true,
    prototype: () => weedModels(),
  },
  {
    key: "소품.꽃",
    label: "꽃밭",
    category: "풀·나무",
    defaultSize: 0.75,
    doubleSided: true,
    prototype: () => flowerModels(),
  },
  // ── 사람이 세운 것 ──
  {
    key: "소품.횃불",
    label: "횃불",
    category: "사람이 세운 것",
    defaultSize: 2.1,
    prototype: (s) => torchPrototypes(3, s),
  },
  {
    key: "소품.장승",
    label: "장승",
    category: "사람이 세운 것",
    defaultSize: 2.4,
    prototype: (s) => guardianPostPrototypes(3, s),
  },
  {
    key: "소품.비석",
    label: "비석",
    category: "사람이 세운 것",
    defaultSize: 1.6,
    prototype: (s) => stelePrototypes(3, s),
  },
  {
    key: "소품.무덤",
    label: "무덤",
    category: "사람이 세운 것",
    defaultSize: 1.6,
    prototype: (s) => gravePrototypes(3, s),
  },
  {
    key: "소품.명패",
    label: "마을 명패",
    category: "사람이 세운 것",
    defaultSize: 2.2,
    prototype: (s) => villageSignPrototypes(2, s),
  },
  // 낭떠러지 울타리는 fences 가 알아서 세운다. 이건 손으로 더 이을 때.
  {
    key: "소품.울타리",
    label: "울타리 한 칸",
    category: "사람이 세운 것",
    defaultSize: 0.95,
    defaultColor: 0x6d5a3c,
    prototype: (s) => fenceSectionPrototypes(3, s),
  },
  {
    key: "소품.나룻배",
    label: "나룻배",
    category: "사람이 세운 것",
    defaultSize: 4.4,
    doubleSided: true,
    prototype: () => [ferryBoatPrototype()],
  },
  // 국소 +Z 로 뻗는다(건너편이면 R 로 반 바퀴). 키 = 나루 길이 — Z1 나루터 실측 4.1 m.
  {
    key: "소품.나루터",
    label: "나루터",
    category: "사람이 세운 것",
    defaultSize: 4.1,
    prototype: (s) => landingPrototypes(3, s),
  },
  // 줄은 steppingStones 가 깐다. 한 칸 더 잇거나 쓸려 간 빈칸을 만들려면 낱개로 집혀야 한다.
  {
    key: "돌다리.디딤돌",
    label: "징검돌",
    category: "사람이 세운 것",
    defaultSize: 1.0,
    defaultColor: STEPPING_STONE_STYLE.stone,
    prototype: (s) => steppingStonePrototypes(6, s),
  },
  // ── 사람 ──
  { key: "소품.인물", label: "인물", category: "사람", defaultSize: 1.7, prototype: (s) => personPrototypes(4, s) },

  // ── 씬 1 「돌아오지 않은 약속」 — 자동 배치는 scene1 ──
  {
    key: "씬1.그물틀",
    label: "그물틀",
    category: "씬 1",
    defaultSize: 1.5,
    defaultWidthRatio: 1.3 / 1.5,
    doubleSided: true,
    prototype: (s) => netFramePrototypes(3, s),
  },
  {
    key: "씬1.통발",
    label: "통발",
    category: "씬 1",
    defaultSize: 0.92,
    defaultColor: "#9A8757",
    prototype: () => fishTrapPrototypes(),
  },
  // 천(회색)과 기둥(나무색)이 구워져 있어 색을 주지 않는다
  {
    key: "씬1.천막",
    label: "천막",
    category: "씬 1",
    defaultSize: 2.6,
    doubleSided: true,
    prototype: () => tentPrototypes(),
  },
  {
    key: "씬1.돌탑",
    label: "돌탑",
    category: "씬 1",
    defaultSize: 0.9,
    defaultWidthRatio: 0.6,
    defaultDepthRatio: 0.6,
    prototype: (s) => cairnPrototypes(3, s),
  },
  {
    key: "씬1.화톳불",
    label: "화톳불 자리",
    category: "씬 1",
    defaultSize: 0.27,
    doubleSided: true,
    prototype: (s) => bonfirePrototypes(3, s),
  },
  {
    key: "씬1.구렁이",
    label: "구렁이",
    category: "씬 1",
    defaultSize: 2.0,
    defaultColor: "#4A4632",
    prototype: () => serpentPrototypes(),
  },

  // ── 씬 2 「엇갈리는 증언」 — 한 덩이에 색이 여럿이라(나무·옹기·짚·새) 색을 주지 않는다 ──
  {
    key: "씬2.평상",
    label: "평상",
    category: "씬 2",
    defaultSize: 0.62,
    defaultWidthRatio: 3.3,
    defaultDepthRatio: 2.5,
    prototype: (s) => platformBedPrototypes(3, s),
  },
  {
    key: "씬2.걸상",
    label: "통나무 걸상",
    category: "씬 2",
    defaultSize: 0.44,
    prototype: (s) => stoolPrototypes(4, s),
  },
  {
    key: "씬2.지게",
    label: "지게·나뭇짐",
    category: "씬 2",
    defaultSize: 1.35,
    prototype: (s) => aFrameCarrierPrototypes(3, s),
  },
  {
    key: "씬2.물동이",
    label: "물동이",
    category: "씬 2",
    defaultSize: 0.52,
    prototype: (s) => waterJarPrototypes(3, s),
  },
  { key: "씬2.솟대", label: "솟대", category: "씬 2", defaultSize: 3.1, prototype: (s) => birdPolePrototypes(3, s) },

  // ── 씬 3 「앙암바위의 죽음」 — 짚신은 왼짝·오른짝이 따로라, 모양을 안 고르면 번호가 짝을 정한다 ──
  { key: "씬3.짚신", label: "짚신", category: "씬 3", defaultSize: 0.06, prototype: (s) => strawShoePrototypes(2, s) },
  { key: "씬3.댕기", label: "댕기", category: "씬 3", defaultSize: 0.05, prototype: (s) => hairRibbonPrototypes(3, s) },
  {
    key: "씬3.흙덩이",
    label: "무너진 마루 흙",
    category: "씬 3",
    defaultSize: 0.45,
    prototype: (s) => dirtClodPrototypes(4, s),
  },
  {
    key: "씬3.부러진가지",
    label: "부러진 가지",
    category: "씬 3",
    defaultSize: 0.25,
    doubleSided: true,
    prototype: (s) => brokenBranchPrototypes(3, s),
  },

  // ── 씬 4 「지워진 기억」 — 셋 다 무엇이 있었던 흔적이지 그 무엇이 아니다 ──
  {
    key: "씬4.배자국",
    label: "배 끌린 자국",
    category: "씬 4",
    defaultSize: 0.085,
    defaultWidthRatio: 2.4,
    defaultDepthRatio: 1.5,
    prototype: (s) => boatMarkPrototypes(3, s),
  },
  {
    key: "씬4.말뚝",
    label: "말뚝 · 끊긴 밧줄",
    category: "씬 4",
    defaultSize: 0.95,
    prototype: (s) => stakePrototypes(3, s),
  },
  {
    key: "씬4.발자국",
    label: "발자국 한 줄",
    category: "씬 4",
    defaultSize: 0.05,
    prototype: (s) => footprintPrototypes(3, s),
  },

  // ── 씬 5 「돌아온 이야기」 — 돌무지는 씬 1 돌탑을 놓고 키만 줄이면 돼서 따로 안 올린다 ──
  {
    key: "씬5.금줄",
    label: "금줄",
    category: "씬 5",
    defaultSize: 1.5,
    doubleSided: true,
    prototype: (s) => sacredRopePrototypes(2, s),
  },
  {
    key: "씬5.소반",
    label: "소반 · 제물",
    category: "씬 5",
    defaultSize: 0.38,
    prototype: (s) => smallTablePrototypes(3, s),
  },

  // ── 무대 밖 — 멀리 있을 때만 그럴싸하다. 거리 색 섞기를 안 거치니 중간쯤 흐린 색을 기본으로 준다 ──
  {
    key: "원경.나무",
    label: "원경 나무",
    category: "무대 밖",
    defaultSize: 7,
    defaultColor: 0x8f9c84,
    prototype: (s) => distantTreePrototypes(6, s),
  },
  {
    key: "원경.집",
    label: "원경 집",
    category: "무대 밖",
    defaultSize: 4.2,
    defaultColor: 0xa9a291,
    prototype: () => distantHousePrototypes(6203),
  },
  // 언덕·길은 그림일 뿐 걷는 높이는 안 바뀐다 — 코어 안에 놓으면 뚫고 지나간다.
  // 언덕은 밑이 뚫린 반구라 양면이어야 아래·안에서 속이 안 들여다보인다.
  {
    key: "땅.언덕",
    label: "언덕",
    category: "무대 밖",
    defaultSize: 3.5,
    doubleSided: true,
    defaultWidthRatio: 4,
    defaultDepthRatio: 3.2,
    defaultColor: LAND_PIECE_STYLE.mound,
    prototype: (s) => moundPrototypes(4, s),
  },
  {
    key: "땅.길",
    label: "길 한 조각",
    category: "무대 밖",
    defaultSize: 6,
    defaultWidthRatio: 2.5 / 6,
    defaultDepthRatio: 1,
    doubleSided: true,
    defaultColor: LAND_PIECE_STYLE.path,
    prototype: (s) => pathPiecePrototypes(3, s),
  },
  // ── 자연물 낱개 — 「저 자리에 저 바위」를 놓을 때 한 종씩 ──
  ...singleItemAssets(),
];

export const ASSET_CATEGORIES = [...new Set(ASSET_CATALOG.map((asset) => asset.category))];

export const findAsset = (key: string) => ASSET_CATALOG.find((asset) => asset.key === key) ?? null;

// 같은 물건을 두 번 만들 이유가 없다
const prototypeCache = new Map<string, THREE.BufferGeometry[]>();

export function assetPrototype(key: string, seed = 5501): THREE.BufferGeometry[] | null {
  if (prototypeCache.has(key)) return prototypeCache.get(key)!;
  const asset = findAsset(key);
  if (!asset) return null;
  const prototype = asset.prototype(seed);
  prototypeCache.set(key, prototype);
  return prototype;
}
