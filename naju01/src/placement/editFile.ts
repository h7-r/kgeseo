// 손 편집 파일(assets/edits.json) 읽기·쓰기. 개발 서버의 /__naju-edit 가 그 파일을 내주고 받아 쓴다.
// 빌드본에는 그 엔드포인트가 없어 빌드 때 같이 내보낸 naju-edit.json 을 읽는다(vite/editFilePlugin).
// 파일은 다시 만들 수 없는 손 작업이라 열쇠를 한글 그대로 둔다 — 코드 안에서만 영어로 바꿔 쓰고,
// 저장할 때 한글 열쇠·원래 순서로 되돌려 같은 편집이면 바이트까지 같은 파일이 나오게 한다.

import type { Edits, Spot, SpotPatch } from "./instanceGroups";

const EDIT_ENDPOINT = "/__naju-edit";
const editFileUrl = () =>
  import.meta.env.PROD
    ? `${import.meta.env.BASE_URL}naju-edit.json?t=${Date.now()}`
    : `${EDIT_ENDPOINT}?t=${Date.now()}`;

const EDIT_KEYS = { removed: "지움", modified: "고침", added: "더함" } as const;

const SPOT_FIELD_KEYS = {
  size: "키",
  rotation: "회전",
  tilt: "기울기",
  tilt2: "기울기2",
  widthRatio: "폭비",
  heightRatio: "높이비",
  depthRatio: "깊이비",
  shapeIndex: "모양",
  color: "색",
} as const;

/** 무리 id = 편집 파일의 무리 열쇠. 값은 저장 데이터라 한 글자도 바꾸지 않는다. */
export const GROUP_IDS = {
  treeBeltTrees: "수목대.나무",
  hillTrees: "언덕수풀.나무",
  hillShrubs: "언덕수풀.덤불",
  hillWeeds: "언덕수풀.잡초",
  hillFlowers: "언덕수풀.꽃",
  roadsideTrees: "길가수풀.나무",
  roadsideShrubs: "길가수풀.덤불",
  roadsideWeeds: "길가수풀.잡초",
  roadsideLeafPiles: "길가수풀.잎더미",
  roadsideStones: "길가돌",
  slopeRocks: "비탈바위",
  crevasseRocks: "틈바위",
  slopeShrubs: "비탈덤불",
  footScree: "발치너덜",
  fencePosts: "울타리.기둥",
  fenceRails: "울타리.가로대",
  distantTrees: "원경.나무",
  distantHouses: "원경.집",
  taekchonHouses: "원경.택촌",
  // 마을 울은 뒤에 `.기둥` · `.가로대` 를 붙여 두 무리로 담는다
  villageFence: "원경.집울",
  taekchonFence: "원경.택촌울",
  distantLanding: "원경.나루터",
  steppingStones: "돌다리.디딤돌",
  scene1NetFrames: "씬1.그물틀",
  scene1FishTraps: "씬1.통발",
  scene1Tents: "씬1.천막",
  scene1Cairns: "씬1.돌탑",
  scene1Bonfires: "씬1.화톳불",
  scene1Serpent: "씬1.구렁이",
  scene1Abisa: "씬1.아비사",
  fisher: "인물.어부",
  fisher2: "인물.어부2",
  fisher3: "인물.어부3",
  scene2PlatformBeds: "씬2.평상",
  scene2Stools: "씬2.걸상",
  scene2AFrameCarriers: "씬2.지게",
  scene2WaterJars: "씬2.물동이",
  scene2BirdPoles: "씬2.솟대",
  scene3StrawShoes: "씬3.짚신",
  scene3HairRibbons: "씬3.댕기",
  scene3DirtClods: "씬3.흙덩이",
  scene3BrokenBranches: "씬3.부러진가지",
  scene4BoatMarks: "씬4.배자국",
  scene4Stakes: "씬4.말뚝",
  scene4Footprints: "씬4.발자국",
  scene5StonePiles: "씬5.돌무지",
  scene5SacredRopes: "씬5.금줄",
  scene5SmallTables: "씬5.소반",
  pebbles: "자갈",
  boulders: "바위덩어리",
  cliffCrevasseShrubs: "절벽틈덤불",
  cliffTopShrubs: "절벽머리",
  ferryBoat: "나룻배",
} as const;

type FileSpot = Record<string, unknown>;

interface EditFile {
  [EDIT_KEYS.removed]: Record<string, number[]>;
  [EDIT_KEYS.modified]: Record<string, Record<string, FileSpot>>;
  [EDIT_KEYS.added]: Record<string, FileSpot[]>;
}

const FILE_TO_SPOT: Record<string, string> = Object.fromEntries(
  Object.entries(SPOT_FIELD_KEYS).map(([field, fileKey]) => [fileKey, field]),
);
const SPOT_TO_FILE: Record<string, string> = SPOT_FIELD_KEYS;

// 열쇠 이름만 바꾸고 순서는 그대로 — 저장한 JSON 의 필드 순서가 읽은 파일과 같아야 한다.
// 표에 없는 열쇠(x·y·z, 모르는 것)는 그대로 지나간다. 파일 꼴은 따로 검사하지 않는다.
function renameKeys<T extends object = Record<string, unknown>>(source: object, table: Record<string, string>): T {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [table[key] ?? key, value])) as T;
}

function mapValues<T, U>(record: Record<string, T>, map: (value: T) => U): Record<string, U> {
  const out: Record<string, U> = {};
  for (const [key, value] of Object.entries(record)) out[key] = map(value);
  return out;
}

export const emptyEdits = (): Edits => ({ removed: {}, modified: {}, added: {} });

function fromFile(file: Partial<EditFile>): Edits {
  return {
    removed: file[EDIT_KEYS.removed] ?? {},
    modified: mapValues(file[EDIT_KEYS.modified] ?? {}, (group) =>
      mapValues(group, (patch) => renameKeys<SpotPatch>(patch, FILE_TO_SPOT)),
    ),
    added: mapValues(file[EDIT_KEYS.added] ?? {}, (spots) => spots.map((spot) => renameKeys<Spot>(spot, FILE_TO_SPOT))),
  };
}

function toFile(edits: Edits): EditFile {
  return {
    [EDIT_KEYS.removed]: edits.removed,
    [EDIT_KEYS.modified]: mapValues(edits.modified, (group) =>
      mapValues(group, (patch) => renameKeys(patch, SPOT_TO_FILE)),
    ),
    [EDIT_KEYS.added]: mapValues(edits.added, (spots) => spots.map((spot) => renameKeys(spot, SPOT_TO_FILE))),
  };
}

/** 못 읽으면 빈 편집으로 간다 */
export async function loadEdits(): Promise<Edits> {
  try {
    const response = await fetch(editFileUrl());
    if (!response.ok) return emptyEdits();
    return fromFile((await response.json()) as Partial<EditFile>);
  } catch {
    return emptyEdits();
  }
}

let prefetchPromise: Promise<Edits> | null = null;
let prefetched: Edits | null = null;

/** 씬을 붙이기 전에 받아 둔다(app/prefetch). 편집기가 저장한 뒤의 최신값은 씬 state 가 든다 — 이건 첫 렌더용이다. */
export function prefetchEdits(): Promise<Edits> {
  prefetchPromise ??= loadEdits().then((edits) => (prefetched = edits));
  return prefetchPromise;
}

/** 미리 읽어 둔 편집. 아직 없으면 null — 그때 씬은 붙은 뒤에 읽는다. */
export const getPrefetchedEdits = (): Edits | null => prefetched;

export async function saveEdits(edits: Edits): Promise<true> {
  const response = await fetch(EDIT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toFile(edits), null, 2),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`저장 실패 (${response.status})`);
  // 저장 플러그인이 없으면 Vite 가 index.html 을 200 으로 준다 — r.ok 만 보면 저장된 줄 안다
  if (body.trim() !== "ok") throw new Error("개발 서버에 저장 기능이 없다 — `npx vite naju01` 을 다시 띄워라");
  return true;
}

/** 저장 기능이 붙어 있는지 — 편집 모드에 들어갈 때 미리 알려 주려고 */
export async function canSaveEdits(): Promise<boolean> {
  try {
    const response = await fetch(`${EDIT_ENDPOINT}?t=${Date.now()}`);
    JSON.parse(await response.text());
    return true;
  } catch {
    return false;
  }
}
