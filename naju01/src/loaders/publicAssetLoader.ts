/**
 * publicAssetLoader.ts — manifest.json 을 읽고 항목별 GLB 를 묶음(Bundle)으로 받아 둔다
 * (옛 AI허브전시.jsx AI허브바꿔치기 의 useEffect 안 비동기 부분 이식)
 *
 * [옛 이름 → 새 이름]
 *   읽기 → readBundle · 모으기 → readEntryBundles · 캐시 → cache · 읽은파일들 → loadedFiles
 *   표 { 바꿔치기, 덮기, 놓기 } → PublicAssetTable { swaps, covers, places }
 */
import * as THREE from "three";

import { TOON_GRADIENT } from "@/engine/toon";

import { createCompressedGltfLoader } from "./compressedGlb";
import { flattenGltf, type Bundle } from "./publicAssetGeometry";
import {
  animeCoverPath,
  animePath,
  appendTrialPlaces,
  entryFiles,
  IS_ANIME_VARIANT,
  IS_PUBLIC_ASSETS_ENABLED,
  isAnimeFile,
  loadAnimeLookup,
  PUBLIC_ASSET_FOLDER,
  publicAssetRegistry,
  publicAssetStatus,
  reportAssetFailure,
  type CoverEntry,
  type PlaceEntry,
  type PublicAssetManifest,
  type SwapEntry,
} from "./publicAssetManifest";

export interface SwapItem extends SwapEntry {
  bundles: Bundle[];
  /** 원경판(같은 순서) — 있으면 22 m 밖은 그것으로 그린다 */
  farBundles: (Bundle | null)[] | null;
  /** 같은 무리의 크기 구간 위끝 — 최소키 3 과 0.45 가 있으면 0.45 쪽은 [0.45, 3) 만 맡는다 */
  sizeUpper?: number;
}
export interface CoverItem extends CoverEntry {
  bundles: Bundle[];
}
export interface PlaceItem extends PlaceEntry {
  bundles: Bundle[];
  /** 원경판(10/20) — 있으면 22 m 밖은 이것으로(에이전트 시험 나무 등) */
  farBundle?: Bundle | null;
  /** 씬별 불러오기(10/20) — 에이전트 시험 놓기 중 「씬」이 적힌 것은 그 씬(과 다음 씬)이 될 때 받는다. publicAssets.tsx ③-0 */
  lazy?: boolean;
  loading?: boolean;
  /** manifest 「놓기」 안 원래 위치(애니판 거르기 전) — 편집 모드가 이 항목을 고칠 때 서버에 넘긴다 */
  manifestIndex: number;
}
export interface PublicAssetTable {
  swaps: SwapItem[];
  covers: CoverItem[];
  places: PlaceItem[];
  /** manifest 「잘린면」 — 파일별 흰 잘린 면 방향(납작하게 뒤 좌표) */
  cutFaces: Record<string, [number, number, number]> | null;
}

type MaterialWithMaps = THREE.Material & {
  map?: THREE.Texture | null;
  color?: THREE.Color;
  alphaTest: number;
  transparent: boolean;
  vertexColors: boolean;
};

/** 첫 읽기(loadPublicAssetTable)가 만든 GLB 읽기 함수 — 이미 읽은 파일은 다시 받지 않는다 */
let placeReader: ((file: string) => Promise<Bundle | null>) | null = null;

/** 씬별 불러오기(10/20) — 늦게 받는 놓기 항목의 GLB(근경·원경)를 지금 받는다. 첫 읽기 전이면 null */
export async function readPlaceBundles(item: PlaceItem): Promise<{ bundles: Bundle[]; farBundle: Bundle | null } | null> {
  const read = placeReader;
  if (!read) return null;
  const bundles = (await Promise.all(entryFiles(item).map((f) => read(f)))).filter((b): b is Bundle => !!b);
  return { bundles, farBundle: item.원경file ? await read(item.원경file) : null };
}

/**
 * 「놓기」만 다시 읽는다 (10/15 — 5174 편집 모드 「라이브러리 배치」가 manifest 에 저장한 뒤).
 *   manifest 를 캐시 없이 다시 받고, 놓기 항목의 GLB 는 첫 읽기의 캐시를 그대로 쓴다(새 파일만 받는다).
 *   첫 읽기가 아직이면 null(그때는 첫 읽기가 새 manifest 를 읽는다).
 */
export async function loadPublicPlaces(): Promise<PlaceItem[] | null> {
  const read = placeReader;
  if (!IS_PUBLIC_ASSETS_ENABLED || !read) return null;
  const r = await fetch(`${PUBLIC_ASSET_FOLDER}manifest.json`, { cache: "no-store" });
  if (!r.ok) throw new Error(`공개 에셋 목록 읽기 실패 (${r.status})`);
  const m = (await r.json()) as PublicAssetManifest;
  await appendTrialPlaces(m);
  const entries = (m.놓기 || [])
    .map((entry, manifestIndex) => ({ entry, manifestIndex }))
    .filter(({ entry }) => IS_ANIME_VARIANT || !entry.애니판);
  return Promise.all(
    entries.map(async ({ entry, manifestIndex }) => ({
      ...entry,
      manifestIndex: entry.에이전트 ? -1 : manifestIndex,
      bundles: (await Promise.all(entryFiles(entry).map((f) => read(f)))).filter((b): b is Bundle => !!b),
    })),
  );
}

/**
 * manifest 와 모든 GLB 를 읽는다. 켜져 있지 않거나 manifest 가 없으면 null.
 * 진행은 publicAssetStatus 에, 「어느 무리를 / 몇 m 이상을」 교체본이 그리는지는 publicAssetRegistry 에 알린다.
 */
export async function loadPublicAssetTable(isAlive: () => boolean): Promise<PublicAssetTable | null> {
  if (!IS_PUBLIC_ASSETS_ENABLED) return null;
  let m: PublicAssetManifest;
  try {
    const r = await fetch(`${PUBLIC_ASSET_FOLDER}manifest.json`);
    if (!r.ok) throw new Error(`공개 에셋 목록 읽기 실패 (${r.status})`);
    m = (await r.json()) as PublicAssetManifest;
  } catch (error) {
    reportAssetFailure("manifest.json", error);
    return null;
  }
  await appendTrialPlaces(m); // &trial= — 에이전트 시험 배치(manifest 파일은 그대로)
  // 「애니판」 표시가 붙은 놓기(메타버스데이터랩 소품 등)는 변환판 화면에만 — 거르기 전 위치를 기억해 둔다(편집 모드)
  const placeIndex = new Map((m.놓기 || []).filter((entry) => !entry.에이전트).map((entry, index) => [entry, index])); // 시험 배치는 manifest 밖(-1)
  if (!IS_ANIME_VARIANT) m.놓기 = (m.놓기 || []).filter((e) => !e.애니판);
  const files = new Set<string>();
  for (const entry of [...(m.바꿔치기 || []), ...(m.덮기 || []), ...(m.놓기 || []).filter((e) => !(e.에이전트 && e.씬?.length))]) {
    for (const file of [...entryFiles(entry), ...((entry as SwapEntry).원경files || []), ...((entry as PlaceEntry).원경file ? [(entry as PlaceEntry).원경file as string] : [])]) if (file) files.add(file);
  }
  publicAssetStatus.phase = "loading";
  publicAssetStatus.total = files.size;
  if (!files.size) {
    reportAssetFailure("manifest.json", new Error("표시할 공개 에셋이 없습니다."));
    return null;
  }
  if (IS_ANIME_VARIANT) await loadAnimeLookup();

  const loader = createCompressedGltfLoader();
  const cache = new Map<string, Promise<Bundle | null>>();
  const loadedFiles = new Set<string>(); // 같은 원본을 바꿔치기·덮기용으로 각각 읽어도 진행 수는 한 파일이다.
  const readBundle = (file: string, forCover = false): Promise<Bundle | null> => {
    const key = forCover ? `덮기:${file}` : file;
    const path = forCover ? animeCoverPath(file) : animePath(file);
    if (!cache.has(key))
      cache.set(
        key,
        loader
          .loadAsync(PUBLIC_ASSET_FOLDER + path)
          .then(flattenGltf)
          .then((bundle) => {
            if (!bundle.length) throw new Error("표시할 메시가 없습니다.");
            // 톤 맞추기 — 파일마다 텍스처 평균색이 달라(밝기 48~183) 섞이면 얼룩진다.
            //   manifest 「색맞춤」의 배수를 재질 색에 곱해 한 톤으로 모은다(재질은 파일마다 따로 복제).
            const factor = isAnimeFile(file) ? null : m.색맞춤?.[file]; // 애니화본은 톤을 블렌더에서 이미 맞췄다
            if (factor)
              for (const part of bundle) {
                const cloned = part.material.clone() as MaterialWithMaps;
                cloned.color?.multiply(new THREE.Color(factor[0], factor[1], factor[2]));
                part.material = cloned;
              }
            // 툰 질감(10/13) — 텍스처가 있는 판은 텍스처(디테일)는 살리고 빛만 게임과 같은 툰 계단으로
            if (m.툰질감)
              for (const part of bundle) {
                const source = part.material as MaterialWithMaps;
                if ((source as THREE.MeshToonMaterial).isMeshToonMaterial) continue;
                part.material = new THREE.MeshToonMaterial({
                  map: source.map ?? null,
                  color: source.color,
                  gradientMap: TOON_GRADIENT,
                  side: THREE.DoubleSide,
                  alphaTest: source.alphaTest || (source.transparent ? 0.5 : 0),
                  vertexColors: source.vertexColors,
                });
              }
            loadedFiles.add(file);
            publicAssetStatus.loaded = loadedFiles.size;
            // 씬별로 늦게 받은 파일(10/20)은 처음 목록에 없다 — 전체 수도 같이 늘려 「읽음 = 전체」(검수 준비 판정)를 깨지 않게
            if (publicAssetStatus.loaded > publicAssetStatus.total) publicAssetStatus.total = publicAssetStatus.loaded;
            return bundle;
          })
          .catch((e: unknown) => {
            reportAssetFailure(file, e);
            console.warn("[publicAssets] 못 읽음:", file, e);
            return null;
          }),
      );
    return cache.get(key)!;
  };
  // 다시 읽기(loadPublicPlaces)가 같은 캐시·색맞춤·툰질감을 쓰게 남겨 둔다
  placeReader = (file) => readBundle(file);
  const readEntryBundles = async (entry: { files?: string[]; file?: string }, forCover = false): Promise<Bundle[]> =>
    (await Promise.all(entryFiles(entry).map((f) => readBundle(f, forCover)))).filter((b): b is Bundle => !!b);

  const swaps: SwapItem[] = [];
  for (const entry of m.바꿔치기 || []) {
    const bundles = await readEntryBundles(entry);
    const farBundles = entry.원경files ? await Promise.all(entry.원경files.map((f) => readBundle(f))) : null;
    swaps.push({ ...entry, bundles, farBundles });
  }
  const covers: CoverItem[] = [];
  for (const entry of m.덮기 || []) covers.push({ ...entry, bundles: await readEntryBundles(entry, true) });
  // 「놓기」(10/14) — 원본 무리 없이 새 자리에 소품을 놓는다(장식 전용). [{ file, 키m, 자리:[[X m, Z m, 돌림°, 키배]] }]
  const places: PlaceItem[] = [];
  for (const entry of m.놓기 || []) {
    if (entry.에이전트 && entry.씬?.length) { places.push({ ...entry, manifestIndex: -1, bundles: [], farBundle: null, lazy: true }); continue; }
    places.push({ ...entry, manifestIndex: placeIndex.get(entry) ?? -1, bundles: await readEntryBundles(entry), farBundle: entry.원경file ? await readBundle(entry.원경file) : null });
  }

  // 게임 쪽에 「어느 무리를 / 몇 m 이상을」 교체본이 그린다고 알린다 → 원본은 그 자리를 아예 안 그린다(면수·집기에서 빠짐)
  const hidden = new Set<string>();
  const minSize = new Map<string, number>();
  for (const e of swaps) {
    if (e.최대) continue;
    if (e.최소키 == null) hidden.add(e.target);
    else minSize.set(e.target, Math.min(minSize.get(e.target) ?? Infinity, e.최소키));
  }
  // 같은 무리의 크기 구간 — 최소키 3 과 0.45 가 있으면 0.45 쪽은 [0.45, 3) 만 맡는다
  for (const e of swaps)
    if (e.최소키 != null)
      e.sizeUpper = Math.min(
        Infinity,
        ...swaps.filter((f) => f.target === e.target && f.최소키 != null && f.최소키 > e.최소키!).map((f) => f.최소키!),
      );
  if (!isAlive()) return null;
  publicAssetRegistry.publish(hidden, minSize);
  publicAssetStatus.phase = publicAssetStatus.failed ? "failed" : "loaded";
  return { swaps, covers, places, cutFaces: m.잘린면 || null };
}
