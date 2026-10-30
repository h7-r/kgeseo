/**
 * publicAssetManifest.ts — 공개 3D 에셋 교체 층의 스위치 · manifest 타입 · 등록부 (옛 AI허브전시.jsx 머리 부분 이식)
 *
 * [켜는 법]  주소 끝에 `?aihub&src=sf` (예: http://localhost:5174/?aihub&src=sf&dev)
 *   public/_sf_local/manifest.json 을 읽어 공개 3D(Sketchfab·KCISA·KHS) 경량본으로 바꿔 그린다.
 *   `&애니판` 을 더하면 「변환판(원신 방향)」 — 파일은 anime_bake/ → anime/ 를 먼저 찾고(아래 animePath),
 *   셰이더 쪽(2톤 명암 등)은 world/animeStyle.ts 가 같은 주소로 켜진다.
 *
 * [이식하지 않은 것 — AI허브 경로]
 *   옛 파일은 `src` 가 없으면 public/_aihub_local/ (AI허브 「한국적 일상 3D」, 이용 범위 답변 전 로컬 미리보기 전용)을
 *   읽었다. 그 가지는 **이식하지 않는다** — 공개 에셋 경로(src=sf)만 옮긴다(검수정책: AI허브 자료는 검수에 연결하지 않음).
 *   따라서 `?aihub` 만 있고 `src=sf` 가 없으면 이 층은 아무것도 하지 않는다.
 *
 * [manifest.json 열쇠는 한글 그대로(데이터)]
 *   「바꿔치기」 [{ target, files:[...], 원경files?, 최대?, 최소키?, 맞춤?, 흔들기?, 키상한m?, 긴풀?, 길피하기? }]
 *      target  지금 맵의 무리 이름(InstancedMesh.name = edits.json 열쇠, 한글). 편집이 반영된 최종 자리를 따른다.
 *      files   여러 개면 자리마다 번갈아(해시) 쓴다 — 같은 돌이 줄지어 반복되지 않게.
 *      최대    카메라에서 가까운 N개만 바꾼다(무거운 원본판 비교용). 나머지는 원래 모습.
 *      최소키  이 크기(m) 이상인 자리만 바꾼다(작은 자갈은 원래 저면수 표본 그대로 — 예산).
 *      ※ 「최대」·「최소키」가 있으면 고른 자리만 비우고(크기 0), 없으면 무리를 통째로 숨긴다.
 *   「덮기」 [{ 대상:["절벽면","땅"], files, X:[m,m], Y:[m,m], Z시작:m, 간격:m, 크기:[m,m], 묻힘, 가파름, ... }]
 *      대상 메시에 +Z 쪽에서 수평 광선을 쏴서 맞은 **가파른 면**(법선 y 가 가파름 미만)에 바위를 박는다.
 *   「놓기」 [{ file, 키m, 자리:[[X m, Z m, 돌림°, 키배]], 묻힘m?, 차단물?, 애니판? }] — 원본 무리 없이 새 자리에(장식 전용)
 *   「색맞춤」 { file: [r,g,b] } · 「툰질감」 bool · 「잘린면」 { file: [x,y,z] }
 *
 * [옛 이름 → 새 이름]
 *   출처 → SOURCE_PARAM · 폴더 → PUBLIC_ASSET_FOLDER · 애니판 → IS_ANIME_VARIANT · 애니경로 → animePath
 *   window.__AI허브교체 + "AI허브교체" 이벤트 → publicAssetRegistry (+ subscribe) · window.__공개에셋상태 → publicAssetStatus
 *   덮기뺌 → hiddenCovers · 검수실행 → IS_REVIEW_RUN / IS_REVIEW_NORMAL_MODE (검수정책.js 는 TS 에 없어 주소만 본다)
 */

const QUERY = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();

const SOURCE_PARAM = QUERY.get("src");
/** `?aihub` 가 있고 `src=sf` 일 때만 켜진다 — 공개 에셋 경로 전용(AI허브 경로는 이식하지 않음) */
export const IS_PUBLIC_ASSETS_ENABLED = QUERY.has("aihub") && SOURCE_PARAM === "sf";
/**
 * &base=empty — 「빈 지형」(10/19 에이전트 시험). 지형·강·절벽(덮기)·원경·차단물만 남기고 사람이 놓은 물체(생성 무리·바꿔치기·놓기)는 그리지 않는다.
 *   에이전트가 같은 나주 공간 위에 처음부터 고르고 놓은 결과를 사람본과 견주려고 쓴다. 게임 데이터는 바꾸지 않는다.
 */
export const IS_EMPTY_BASE = QUERY.get("base") === "empty";
/**
 * &trial=<시험 id> — 에이전트 시험 배치 화면(10/19). 검수 작업대(5180)의 /__review/trials/<id>/places 가 준
 * 「놓기」 항목을 manifest 놓기 뒤에 붙여 그린다(파일에는 쓰지 않는다). 빈 지형에서도 이 항목은 그린다(에이전트 표시).
 */
export const TRIAL_ID = /^[a-f0-9-]{36}$/.test(QUERY.get("trial") || "") ? QUERY.get("trial") : null;

/** 시험 배치 항목을 받아 m.놓기 뒤에 붙인다 — 실패하면 조용히 넘기고 콘솔에 남긴다 */
export async function appendTrialPlaces(m: PublicAssetManifest): Promise<void> {
  if (!TRIAL_ID) return;
  try {
    const r = await fetch(`/__review/trials/${TRIAL_ID}/places`, { cache: "no-store" });
    if (!r.ok) throw new Error(`에이전트 시험 배치 읽기 실패 (${r.status})`);
    const body = (await r.json()) as { places?: PlaceEntry[]; skipped?: unknown[] };
    m.놓기 = [...(m.놓기 || []), ...(body.places || []).map((entry) => ({ ...entry, 에이전트: true }))];
    console.info("[publicAssets] 에이전트 시험 배치", body.places?.length ?? 0, "건 · 못 놓음", body.skipped?.length ?? 0);
  } catch (error) {
    console.warn("[publicAssets] 에이전트 시험 배치를 읽지 못했습니다:", error);
  }
}
/** `&애니판` — 변환판(원신 방향). 에셋(anime_bake/anime)과 셰이더(animeStyle.ts)가 같이 켜진다 */
export const IS_ANIME_VARIANT = QUERY.has("애니판");
/** 공개 에셋 폴더(뿌리 public/_sf_local/) */
export const PUBLIC_ASSET_FOLDER = `${import.meta.env.BASE_URL}_sf_local/`;

// 검수 실행(?review=1) — 옛 검수정책.js 의 「정상 검수에선 Alt+클릭 빼기·로컬 저장을 안 한다」만 옮긴다
export const IS_REVIEW_RUN = QUERY.get("review") === "1";
export const IS_REVIEW_NORMAL_MODE = IS_REVIEW_RUN && (QUERY.get("reviewMode") || "normal") === "normal";

/** 바꿔치기 한 항목 */
export interface SwapEntry {
  target: string;
  files?: string[];
  file?: string;
  원경files?: string[];
  최대?: number;
  최소키?: number;
  /** "높이" = 표본 키에 맞춤 · "실제" = 파일 실치수 그대로(배율·묻기) · 없으면 바닥 크기에 맞춤 */
  맞춤?: "높이" | "실제";
  배율?: [number, number];
  묻기?: number;
  흔들기?: { 배율?: [number, number]; 기울기?: number };
  키상한m?: number;
  긴풀?: Record<string, number>;
  길피하기?: boolean | { 길곁?: number; 한가운데?: number };
  메모?: string;
}

/** 덮기 한 항목 */
export interface CoverEntry {
  대상?: string[];
  files?: string[];
  file?: string;
  X: [number, number];
  Y: [number, number];
  Z시작?: number;
  Z범위?: [number, number];
  간격?: number;
  세로간격?: number;
  크기?: [number, number];
  묻힘?: number;
  가파름?: number;
  비틀기?: number;
  씨?: number;
  정렬?: boolean;
  흔들림?: number;
  잘린면붙이기?: boolean;
}

/** 놓기 한 항목 */
export interface PlaceEntry {
  file?: string;
  files?: string[];
  키m?: number;
  묻힘m?: number;
  /** 이 차단물의 겉돌 — 치워지면 같이 가라앉아 사라진다 */
  차단물?: string | null;
  /** 변환판 화면에만 놓는다(메타버스데이터랩 소품 등) */
  애니판?: boolean;
  /** 에이전트 시험 배치(&trial=) — 빈 지형에서도 그린다 */
  에이전트?: boolean;
  /** 원경판 파일(10/20) — 카메라 22 m 밖은 이것으로 그린다(면수 줄이기) */
  원경file?: string;
  /** 에이전트 시험 — 무리 이름(10/20). 「에이전트.나무」처럼 식물 이름이 들어가면 바람 흔들림(windShader.findPlants)이 붙는다 */
  무리?: string;
  /** 에이전트 시험 — 보이는 씬 번호들(10/20). 없으면 늘 보임. 지금 씬 = window.__agentTrialScene(검수 작업대 「씬 보기」) 또는 끝낸 씬 수 + 1 */
  씬?: number[];
  /** 에이전트 시험 — 자리마다 「항목id|에셋id|이름」(검수에서 물체를 누르면 이 항목으로 기록) */
  항목?: string[];
  /** [X m, Z m, 돌림°, 키배, 높이 보정 m(지면 위 +/아래 −, 에이전트 배치가 물 위·비탈에 맞춤)] */
  자리?: [number, number, number?, number?, number?][];
  메모?: string;
}

export interface PublicAssetManifest {
  설명?: string;
  바꿔치기?: SwapEntry[];
  덮기?: CoverEntry[];
  놓기?: PlaceEntry[];
  색맞춤?: Record<string, [number, number, number]>;
  툰질감?: boolean;
  잘린면?: Record<string, [number, number, number]>;
  검수?: unknown;
  반려?: unknown;
  /** 장면 팩 id 목록(10/21 에셋보호) — 여기 든 파일은 팩에서 읽는다(packSource.ts). 유니티 KHS 에셋은 팩으로만 */
  팩?: string[];
}

/** 항목이 읽는 파일 목록(files 또는 file) */
export const entryFiles = (entry: { files?: string[]; file?: string }): string[] =>
  entry.files ?? (entry.file ? [entry.file] : []);

// ── 변환판 파일 찾기 ──────────────────────────────────────────
//   바위는 블렌더 텍스처 굽기판(_sf_local/anime_bake/), 나무·덤불은 덩어리 변환판(_sf_local/anime/)을
//   원래 파일 대신 읽는다(앞 폴더 우선). 목록에 없는 파일은 원래 것.
const ANIME_FOLDERS = ["anime_bake", "anime"] as const;
type AnimeFolder = (typeof ANIME_FOLDERS)[number] | "대체";
/** anime/대체.json — 원래 파일 → 다른 출처 변환본(메타버스데이터랩 느티나무 등). { 일반, 덮기? } */
export interface AnimeSubstitute {
  일반?: string;
  덮기?: string;
  출처?: string;
}
export const animeLookup: { list: Map<string, AnimeFolder> | null; substitutes: Record<string, AnimeSubstitute> } = {
  list: null,
  substitutes: {},
};

/** 변환판 목록(목록.json)·대체표(대체.json)를 읽는다 — 폴더가 없으면 조용히 비운다 */
export async function loadAnimeLookup() {
  const list = new Map<string, AnimeFolder>();
  for (const folder of ANIME_FOLDERS) {
    try {
      const files = (await (await fetch(`${PUBLIC_ASSET_FOLDER}${folder}/목록.json`)).json()) as string[];
      for (const f of files) if (!list.has(f)) list.set(f, folder);
    } catch {
      /* 폴더 없음 */
    }
  }
  let substitutes: Record<string, AnimeSubstitute>;
  try {
    substitutes = (await (await fetch(`${PUBLIC_ASSET_FOLDER}anime/대체.json`)).json()) as Record<
      string,
      AnimeSubstitute
    >;
    for (const f of Object.keys(substitutes)) list.set(f, "대체");
  } catch {
    substitutes = {};
  }
  animeLookup.list = list;
  animeLookup.substitutes = substitutes;
  console.info("[publicAssets] 변환판", list.size, "대체", Object.keys(substitutes).length);
}

/** 변환판이면 대체본/변환 폴더 경로, 아니면 원래 경로 */
export const animePath = (file: string): string => {
  const sub = animeLookup.substitutes[file];
  if (sub?.일반) return `anime/${sub.일반}`;
  const folder = animeLookup.list?.get(file);
  return folder && folder !== "대체" ? `${folder}/${file}` : file;
};
/** 덮기용 — 「위쪽 빛·이끼」를 구운 판이면 옆면에 이끼가 붙는다 → 방향 없는 판(anime_bake/덮기/)을 쓴다(10/14) */
export const animeCoverPath = (file: string): string => {
  const sub = animeLookup.substitutes[file];
  if (sub?.덮기) return `anime/${sub.덮기}`;
  if (animeLookup.list?.get(file) === "anime_bake") return `anime_bake/덮기/${file}`;
  return animePath(file);
};
/** 애니화본은 톤을 블렌더에서 이미 맞췄다 — 색맞춤을 건너뛴다 */
export const isAnimeFile = (file: string) => !!animeLookup.list?.has(file);

// ── 교체 등록부 (옛 window.__AI허브교체 + "AI허브교체" 이벤트) ──────────────
//   「이 무리는 통째로 / 이 크기 이상은」 교체본이 그린다고 게임 쪽에 알린다 → 원본은 그 자리를 아예 안 그린다.
//   옛 공간그레이박스의 무리 컴포넌트는 이 등록부를 보고 자리를 스스로 뺐다. TS 에서는 PublicAssetLayer 가
//   원본 InstancedMesh 를 직접 압축해 빼고(publicAssets.tsx compactOriginal), 풀(땅.풀) 같은 합본 메시는
//   usePublicAssetRegistry() 로 구독해 숨긴다.
type Listener = () => void;
const listeners = new Set<Listener>();

export const publicAssetRegistry = {
  /** 통째로 숨길 무리 이름(최소키·최대 없는 바꿔치기) — 옛 「숨김」 */
  hiddenGroups: new Set<string>(),
  /** 무리별 「이 크기(m) 이상은 교체본이 그린다」 문턱 — 옛 「최소키」 */
  minSizeByGroup: new Map<string, number>(),
  /** 등록부가 갱신될 때마다 1 씩 — React 가 다시 그릴 근거 */
  version: 0,
  /** 무리의 어떤 자리가 교체본 쪽으로 빠지나(크기 m) */
  isReplaced(groupId: string, sizeM: number): boolean {
    if (this.hiddenGroups.has(groupId)) return true;
    const threshold = this.minSizeByGroup.get(groupId);
    return threshold != null && sizeM >= threshold;
  },
  /** 이 무리에 등록된 것이 있나(통째 숨김이든 문턱이든) */
  touches(groupId: string): boolean {
    return this.hiddenGroups.has(groupId) || this.minSizeByGroup.has(groupId);
  },
  /** 등록부를 통째로 갈아 끼우고 알린다 */
  publish(hidden: Set<string>, minSize: Map<string, number>) {
    this.hiddenGroups = hidden;
    this.minSizeByGroup = minSize;
    this.version++;
    for (const fn of listeners) fn();
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

// ── 진행 상태 (옛 window.__공개에셋상태) — 검수 연결이 「파일 다 받음」과 「실제 배치 적용」을 구분해 읽는다 ──
export type PublicAssetPhase = "off" | "manifest" | "loading" | "loaded" | "applied" | "failed";
export interface PublicAssetStatus {
  source: "sf";
  phase: PublicAssetPhase;
  total: number;
  loaded: number;
  failed: number;
  failures: { file: string; message: string }[];
  appliedGroups: number;
}
export const publicAssetStatus: PublicAssetStatus = {
  source: "sf",
  phase: IS_PUBLIC_ASSETS_ENABLED ? "manifest" : "off",
  total: 0,
  loaded: 0,
  failed: 0,
  failures: [],
  appliedGroups: 0,
};
export function reportAssetFailure(file: string, error: unknown) {
  publicAssetStatus.failed += 1;
  publicAssetStatus.failures.push({
    file: String(file).slice(0, 180),
    message: String((error as { message?: string })?.message || error).slice(0, 300),
  });
  publicAssetStatus.phase = "failed";
}

// ── 덮기 판 빼기 (Alt+클릭) ── 절벽 덮기 판은 원본 무리가 없어 편집기로 못 옮긴다. 대신 Alt+클릭하면 그 판을 빼고
//   이 브라우저에 기억한다(localStorage). 되살리려면 콘솔에서 __game.publicAssets.restoreCovers() — 미리보기 전용 장치다.
const HIDDEN_COVERS_KEY = "AI허브덮기뺌"; // 옛 열쇠 그대로 — 이미 저장된 빼기 목록을 잇는다
export const hiddenCovers = new Set<string>(
  (() => {
    if (IS_REVIEW_RUN) return [];
    try {
      return JSON.parse(localStorage.getItem(HIDDEN_COVERS_KEY) || "[]") as string[];
    } catch {
      return [];
    }
  })(),
);
export const saveHiddenCovers = () => {
  if (IS_REVIEW_RUN) return;
  try {
    localStorage.setItem(HIDDEN_COVERS_KEY, JSON.stringify([...hiddenCovers]));
  } catch {
    /* 저장 못 함 */
  }
};
