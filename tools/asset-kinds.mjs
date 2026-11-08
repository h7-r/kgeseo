/**
 * 공개 파일의 구분 — shared/env.ts 와 같은 나눔. assetUrl 로 읽는 폴더는 케이스, sharedAssetUrl 로 읽는 폴더는 공용.
 * 둘 다 CDN 으로 간다(VITE_ASSET_BASE). 그 밖은 배포본에 남는다. asset-list.mjs 와 build-play.mjs 가 같이 읽는다.
 */
export const CASE_DIRS = ["_sf_local", "vfx"];
export const SHARED_DIRS = ["models"];

/** public 기준 경로 → 케이스 · 공용 · 배포본 */
export const kindOf = (rel) => {
  const top = rel.split("/")[0];
  return CASE_DIRS.includes(top) ? "케이스" : SHARED_DIRS.includes(top) ? "공용" : "배포본";
};
