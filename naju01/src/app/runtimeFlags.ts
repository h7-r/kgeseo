/**
 * 주소 스위치와 저장 열쇠 — 로드 때 한 번 읽는다.
 * 본편과 같은 개발용 스위치(?q=low · ?leva · ?fx=off)에 나주 전용 스위치를 더했다.
 */
import { PLAYER_MESHY_APPEARANCE_KEY } from "@/engine/appearanceKeys";
import { readStorage } from "@/engine/storage";

const QUERY = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();

/** ?q=low — 그림자 끔 · dpr 1 · 후처리 끔 */
export const IS_LOW_QUALITY = QUERY.get("q") === "low";
/** ?leva — 개발 서버에서도 기본은 숨긴다 */
export const SHOW_LEVA = QUERY.has("leva");
/** ?fx=off — 후처리 끔(+ antialias 켬) */
export const IS_POSTFX_DISABLED = QUERY.get("fx") === "off";
// 후처리 효과를 하나씩 끄고 견주는 스위치. 화면이 어두운 원인(Bloom 으로 보였던 것)을 이걸로 가렸다.
export const IS_BLOOM_DISABLED = QUERY.get("bloom") === "off";
export const IS_VIGNETTE_DISABLED = QUERY.get("vig") === "off";
export const IS_TONE_MAPPING_ENABLED = QUERY.get("tm") === "on";
/** ?fb=half — 후처리 버퍼를 HalfFloat 로 되돌려 3D 가 까맣게 나오던 증상을 재현한다 */
export const USE_HALF_FLOAT_BUFFER = QUERY.get("fb") === "half";
/** ?stage=16x9 — 본편과 같은 레터박스(시야 검증용). 기본은 창을 꽉 채운다 */
export const IS_STAGE_16X9 = QUERY.get("stage") === "16x9";

// 이 씬은 픽셀에 걸려 있다(땅이 픽셀마다 삼면 노이즈를 돈다). 1.75 는 레티나에서 글자·외곽선이 안 무너지는 가장 낮은 값.
// ?dpr=1.5 처럼 숫자를 주면 그 값에 못 박고 자동 조절을 끈다(A/B 비교용).
const DPR_PARAM = QUERY.get("dpr");
export const MAX_DPR = Math.min(3, Math.max(1, +(DPR_PARAM || 1.75) || 1.75));
/** 자동 조절 하한 — 이보다 내리면 너무 뿌예진다 */
export const MIN_DPR = 1;
export const IS_DPR_AUTO = !DPR_PARAM && !IS_LOW_QUALITY;

/** ?customize — 꾸미기 패널(개발용) */
export const SHOW_CUSTOMIZE_PANEL = QUERY.has("customize");
/** ?dev — 계기판·조작 안내·H 키 */
export const SHOW_DEV_TOOLS = QUERY.has("dev");
/** ?dev — 구역·풀이 이름표는 도면 점검용이다. Leva 「라벨」 저장값이 켜져 있어도 여기서 막는다 */
export const SHOW_DEV_LABELS = SHOW_DEV_TOOLS;
/** ?avatar=sidekick — 3인칭을 예전 Sidekick 으로(기본 Meshy). 본편 홀로그램이 붙여 넘긴다 */
export const USE_SIDEKICK_AVATAR = QUERY.get("avatar") === "sidekick";
/** ?toon=off · ?outline=off — 원본 PBR 과 비교 */
export const IS_TOON_DISABLED = QUERY.get("toon") === "off";
export const IS_OUTLINE_DISABLED = QUERY.get("outline") === "off";
/** ?worldtoon=off — 캐릭터는 툰으로 두고 세계만 원본 질감으로 */
export const IS_WORLD_TOON_DISABLED = QUERY.get("worldtoon") === "off";
/** ?terrain=legacy — 옛(코드) 지형으로 뜬다. 두 창을 나란히 띄워 fps 를 견줄 때 */
export const FORCE_LEGACY_TERRAIN = QUERY.get("terrain") === "legacy";
/** ?motion=<클립> — Sidekick 모션을 강제(검증용) */
export const FORCED_MOTION = QUERY.get("motion");

// 캐릭터 생성에서 만든 사람이 있으면 그 사람으로 선다(본편 안 /naju01/ 은 같은 출처라 같은 저장소를 본다).
// 만든 적이 없거나 나주 단독 서버(5174)일 때만 나주 전용 값을 쓴다. 꾸미기 패널도 읽은 쪽에 저장한다.
export const MESH_APPEARANCE_KEY =
  readStorage(PLAYER_MESHY_APPEARANCE_KEY) !== null ? PLAYER_MESHY_APPEARANCE_KEY : "naju01.meshy.appearance.v1";
export const SIDEKICK_APPEARANCE_KEY = "naju01.sidekick.appearance.v2";
/** 성별·새 의상 번호가 없던 저장값. v2 가 없으면 이걸 읽어 보정한다 */
export const LEGACY_SIDEKICK_APPEARANCE_KEY = "naju01.sidekick.appearance.v1";
