/**
 * 주소 스위치와 저장 열쇠 — 로드 때 한 번 읽는다.
 * 본편과 같은 개발용 스위치(?fx=off)와 나주 전용 스위치. 나주맵은 Leva 패널을 띄우지 않는다.
 * 저사양(?q=low)은 본편과 같은 `@/engine/quality` 의 IS_LOW_QUALITY 를 쓴다.
 */
import { IS_LOW_QUALITY } from "@/engine/quality";
import { PLAYER_MESHY_APPEARANCE_KEY, readStorage } from "@/engine/storage";

const QUERY = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();

/** ?fx=off — 후처리 끔(+ antialias 켬) */
export const IS_POSTFX_DISABLED = QUERY.get("fx") === "off";
// 후처리 효과를 하나씩 끄고 견주는 스위치
export const IS_BLOOM_DISABLED = QUERY.get("bloom") === "off";
export const IS_VIGNETTE_DISABLED = QUERY.get("vig") === "off";
export const IS_TONE_MAPPING_ENABLED = QUERY.get("tm") === "on";
/** ?fb=half — 후처리 버퍼를 HalfFloat 로 쓴다. 이 버퍼에서 3D 가 까맣게 나오는 증상을 재현할 때 */
export const USE_HALF_FLOAT_BUFFER = QUERY.get("fb") === "half";
/** ?stage=16x9 — 본편과 같은 레터박스(시야 검증용). 기본은 창을 꽉 채운다 */
export const IS_STAGE_16X9 = QUERY.get("stage") === "16x9";
/** ?from=hub — 허브의 진입 연출을 타고 왔다. 검은 화면에서 첫 프레임에 밝아진다. 주소를 직접 치거나 새로고침하면 페이드가 없다 */
export const IS_ARRIVING_FROM_HUB = QUERY.get("from") === "hub";

type PresentationMode = "default" | "light" | "minimal";
type PresentationMood = "evening" | "night";

const PRESENT_PARAM = QUERY.get("present");
const MOOD_PARAM = QUERY.get("mood");
/** ?present · ?present=light · ?present=minimal — 발표용 프리셋(app/presentation). 모르는 값은 기본 프리셋 */
export const PRESENTATION_MODE: PresentationMode | null =
  PRESENT_PARAM === null ? null : PRESENT_PARAM === "light" || PRESENT_PARAM === "minimal" ? PRESENT_PARAM : "default";
/** ?mood=evening · ?mood=night — 로비처럼 어두운 바탕에 낮은 해 하나 */
export const PRESENTATION_MOOD: PresentationMood | null =
  MOOD_PARAM === "evening" || MOOD_PARAM === "night" ? MOOD_PARAM : null;
// minimal 은 light 위에 더 끈다 — 해상도·MSAA 를 줄이는 쪽은 둘이 같다
export const IS_LIGHT_PRESENTATION = PRESENTATION_MODE === "light" || PRESENTATION_MODE === "minimal";
/** 후처리 MSAA — 가벼운 발표 프리셋에서 4 → 2 */
export const MSAA_SAMPLES = IS_LIGHT_PRESENTATION ? 2 : 4;

// 이 씬은 픽셀에 걸려 있다(땅이 픽셀마다 삼면 노이즈를 돈다). 1.75 는 레티나에서 글자·외곽선이 안 무너지는 가장 낮은 값.
// 가벼운 발표 프리셋은 느린 노트북용이라 1.5(픽셀 27 % 감소)까지 내린다.
// ?dpr=1.5 처럼 숫자를 주면 그 값에 못 박고 자동 조절을 끈다(A/B 비교용).
const DPR_PARAM = QUERY.get("dpr");
const DEFAULT_MAX_DPR = IS_LIGHT_PRESENTATION ? 1.5 : 1.75;
export const MAX_DPR = Math.min(3, Math.max(1, +(DPR_PARAM || DEFAULT_MAX_DPR) || DEFAULT_MAX_DPR));
/** 자동 조절 하한 — 이보다 내리면 너무 뿌예진다 */
export const MIN_DPR = 1;
export const IS_DPR_AUTO = !DPR_PARAM && !IS_LOW_QUALITY;

// 작업 화면(꾸미기 패널·계기판·구역 이름표)은 기본으로 띄우고, 발표 프리셋(?present)에서만 숨긴다
const IS_PRESENTING = PRESENTATION_MODE !== null;
/** ?review=1 — 검수 작업대(review/)가 삽입해 연 실행. 검수 시야를 가리는 패널·계기판·안내를 숨긴다 */
export const IS_REVIEW_RUN = QUERY.get("review") === "1";
/** 나주 본편은 1인칭 고정(10/15 미르) — 3인칭·캐릭터 꾸미기는 로비에서만. V 전환 없음 */
export const IS_FIRST_PERSON_ONLY = true;
/** ?npc — NPC 동행 개발 테스트(Sandbox 전용). 검수 실행(?review=1)에서는 켜지지 않는다 */
export const IS_NPC_TEST = QUERY.has("npc") && !IS_REVIEW_RUN;
/** 개발용 V 1·3인칭 전환 — NPC 테스트에서만 허용한다. 본편은 IS_FIRST_PERSON_ONLY 로 1인칭 고정 */
export const ALLOW_VIEW_TOGGLE = IS_NPC_TEST;
/** 캐릭터 꾸미기 패널(왼쪽) */
export const SHOW_CUSTOMIZE_PANEL = !IS_PRESENTING && !IS_REVIEW_RUN && !IS_FIRST_PERSON_ONLY;
/** 도면 계기판 — 처음엔 접어 두고(?dev 는 펼쳐서) H 로 연다 */
export const HAS_DASHBOARD = !IS_PRESENTING && !IS_REVIEW_RUN;
/** 계기판과 그 안내의 왼쪽 위치. 꾸미기 패널(왼쪽 14px · 폭 320px)이 떠 있으면 그 오른쪽에 둔다 */
export const DASHBOARD_LEFT_PX = SHOW_CUSTOMIZE_PANEL ? 348 : 12;
/** 구역·통로·씬 요소 이름표 */
export const SHOW_PLAN_LABELS = !IS_PRESENTING;
/** ?dev — 조작 안내 문구·시점 V1~V3 표식(시작 자리가 V1 이라 캐릭터를 관통한다) */
export const SHOW_DEV_TOOLS = QUERY.has("dev");
/** ?avatar=sidekick — 3인칭을 Sidekick 몸으로(기본 Meshy). 본편 홀로그램이 붙여 넘긴다 */
export const USE_SIDEKICK_AVATAR = QUERY.get("avatar") === "sidekick";
/** ?toon=off · ?outline=off — 모형 본래 PBR 재질과 비교 */
export const IS_TOON_DISABLED = QUERY.get("toon") === "off";
export const IS_OUTLINE_DISABLED = QUERY.get("outline") === "off";
/** ?worldtoon=off — 캐릭터는 툰으로 두고 세계만 본래 질감으로 */
export const IS_WORLD_TOON_DISABLED = QUERY.get("worldtoon") === "off";
/** ?terrain=legacy — 블렌더 지형 대신 코드로 만든 해석 지형으로 뜬다. 두 창을 나란히 띄워 fps 를 견줄 때 */
export const FORCE_ANALYTIC_TERRAIN = QUERY.get("terrain") === "legacy";
/** ?motion=<클립> — Sidekick 모션을 강제(검증용) */
export const FORCED_MOTION = QUERY.get("motion");

// 캐릭터 생성에서 만든 사람이 있으면 그 사람으로 선다(본편 안 /naju01/ 은 같은 출처라 같은 저장소를 본다).
// 만든 적이 없거나 나주 단독 서버(5174)일 때만 나주 전용 값을 쓴다. 꾸미기 패널도 읽은 쪽에 저장한다.
export const MESH_APPEARANCE_KEY =
  readStorage(PLAYER_MESHY_APPEARANCE_KEY) !== null ? PLAYER_MESHY_APPEARANCE_KEY : "naju01.meshy.appearance.v1";
export const SIDEKICK_APPEARANCE_KEY = "naju01.sidekick.appearance.v2";
/** 성별·새 의상 번호가 없던 저장값. v2 가 없으면 이걸 읽어 보정한다 */
export const LEGACY_SIDEKICK_APPEARANCE_KEY = "naju01.sidekick.appearance.v1";
