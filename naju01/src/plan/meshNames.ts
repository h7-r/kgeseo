// 도구·아틀라스·편집기가 getObjectByName 으로 찾는 메시 이름. 저장되지 않는 개발용 문자열이라
// 한곳에 모아 두면 그리는 쪽과 찾는 쪽이 어긋나지 않는다.

export const MESH_NAMES = {
  ground: "ground",
  path: "path",
  slope: "slope",
  cliffFace: "cliffFace",
  cliffScree: "cliff.scree",
  cliffBoulders: "cliff.boulders",
  zoneSides: "zone.sides",
  blockerRock: "blocker.rock",
  groundPebbles: "ground.pebbles",
  blockerFootScree: "blocker.footScree",
  pathStones: "path.stones",
  pathCrevasseRocks: "path.crevasseRocks",
  pathSlopeRocks: "path.slopeRocks",
  pathEmbankment: "path.embankment",
  distantFields: "distant.fields",
  distantFarFields: "distant.farFields",
  distantMountains: "distant.mountains",
  distantForestVillages: "distant.forestVillages",
  skyDome: "sky.dome",
  skyClouds: "sky.clouds",
  riverFarBank: "river.farBank",
  riverSurface: "river.surface",
  riverStones: "river.stones",
  peopleNpc: "people.npc",
  peopleScaleFigure: "people.scaleFigure",
  connectorRamp: "connectorRamp",
  rockAsset: "rockAsset",
  grass: "grass",
  /** 내보낸 지형 GLB 의 노드 이름 */
  terrainExport: "NAJU01_terrain",
} as const;

export type MeshName = (typeof MESH_NAMES)[keyof typeof MESH_NAMES];

/** 왜곡 잔상 무리의 메시 이름 */
export const distortionMeshName = (groupId: string) => `distortion.${groupId}`;
