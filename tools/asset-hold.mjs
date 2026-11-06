/**
 * CDN 업로드 보류 목록. 라이선스·출처 확인이 끝나기 전에는 공개 CDN 에 올리지 않는다.
 *   offDist: true 면 배포본(dist)에도 남기지 않는다 — build-play 가 지운다. 약관상 원본을 밖으로 공유하면 안 되는 것.
 * 확인이 끝나면 여기서 빼면 된다. asset-list.mjs(CSV 「CDN」 칸) · build-play.mjs · deploy-assets 워크플로가 같이 읽는다.
 *
 * 11/6 미르 님(PM) 확인 완료로 모두 해제:
 *   Meshy · Tripo 모형 · 낙숫물 — 유료 계정에서 상업 이용 가능 조건으로 생성
 *   운동화(shoes) · Synty 캐릭터 · 나주 도랑 · 돌확 · 물튀김 — 출처 · 이용 조건 확인 완료
 */
export const ASSET_HOLDS = [];

/** public 기준 경로 → 보류 항목(없으면 undefined) */
export const holdOf = (rel) => ASSET_HOLDS.find(({ pattern }) => pattern.test(rel));
