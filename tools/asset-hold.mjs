/**
 * CDN 업로드 보류 목록(11/6 미르 님). 라이선스·출처 확인이 끝나기 전에는 공개 CDN 에 올리지 않는다.
 *   offDist: true 면 배포본(dist)에도 남기지 않는다 — build-play 가 지운다. 약관상 원본을 밖으로 공유하면 안 되는 것.
 * 확인이 끝나면 여기서 빼면 된다. asset-list.mjs(CSV 「CDN」 칸)와 build-play.mjs 가 같이 읽는다.
 */
export const ASSET_HOLDS = [
  {
    pattern: /^models\/(sidekick-customizer|chibi-(male|female))\.glb$/,
    reason: "Synty Sidekick(뼈대 포함) — 미르 님이 Synty 에 문의 중. 기본 캐릭터(Meshy)는 안 읽는다",
    offDist: true,
  },
  { pattern: /^models\/(meshy-|tripo-)/, reason: "Meshy · Tripo 요금제 확인 중(미르 님)" },
  { pattern: /^vfx\/낙숫물\.glb$/, reason: "Meshy 요금제 확인 중(미르 님)" },
  { pattern: /^models\/shoes-/, reason: "운동화 원본 출처 확인 중 — 못 찾으면 교체" },
  {
    pattern: /^_sf_local\/prop\/(ditch_straight|dolhwak)\.glb$/,
    reason: "출처 기록 없음 — 국가유산청 CC-BY판으로 교체 예정",
  },
  { pattern: /^vfx\/물튀김_왕관\.glb$/, reason: "출처 기록 없음 — 못 찾으면 교체" },
];

/** public 기준 경로 → 보류 항목(없으면 undefined) */
export const holdOf = (rel) => ASSET_HOLDS.find(({ pattern }) => pattern.test(rel));
