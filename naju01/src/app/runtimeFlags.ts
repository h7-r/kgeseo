/**
 * 주소 스위치와 저장 열쇠 — 로드 때 한 번 읽는다.
 * 본편과 같은 개발용 스위치(?fx=off)와 나주 전용 스위치. 나주맵은 Leva 패널을 띄우지 않는다.
 * 저사양(?q=low)은 본편과 같은 `@/engine/quality` 의 IS_LOW_QUALITY 를 쓴다.
 */
import { IS_LOW_QUALITY, IS_MOBILE_QUALITY, MOBILE_MAX_DPR } from "@/engine/quality";
import { PLAYER_MESHY_APPEARANCE_KEY, readStorage } from "@/engine/storage";

const QUERY = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();

/** ?fx=off — 후처리 끔(+ antialias 켬) */
export const IS_POSTFX_DISABLED = QUERY.get("fx") === "off";
// 후처리 효과를 하나씩 끄고 견주는 스위치
// 모바일 품질은 블룸을 끈다(계획서 8.2 보수적 시작값)
// 저사양 모드도 블룸을 끈다 — 먹선 · 색 보정은 남긴다(미르 11/12)
export const IS_BLOOM_DISABLED =
  QUERY.get("bloom") === "off" || ((IS_MOBILE_QUALITY || IS_LOW_QUALITY) && QUERY.get("bloom") !== "on");
export const IS_VIGNETTE_DISABLED = QUERY.get("vig") === "off";
export const IS_TONE_MAPPING_ENABLED = QUERY.get("tm") === "on";
/** 거꾸로 깊이에 필요한 확장(EXT_clip_control)이 이 브라우저 · 그래픽 카드에 있나 — 버리는 캔버스로 한 번 물어본다 */
function hasClipControl(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const context = document.createElement("canvas").getContext("webgl2");
    const isSupported = !!context?.getExtension("EXT_clip_control");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return isSupported;
  } catch {
    return false;
  }
}

/**
 * 깊이 버퍼 방식(11/17). 900 m 밖 산줄기까지 그리려고 far 가 커서 보통 깊이로는 정밀도가 모자라다.
 *   log  로그 깊이 — 셰이더가 깊이를 직접 써서 GPU 가 가려진 면을 미리 못 버린다(전부 칠한다)
 *   rev  거꾸로 깊이(reversedDepthBuffer) — 정밀도는 로그 깊이만큼 나오고 가려진 면은 미리 버린다.
 *        11/17 실측(M5 Max, 수직 동기 끔): 같은 자리에서 낼 수 있는 fps 가 로그 깊이의 1.6 ~ 2.4배
 *   std  보통 깊이 — 견줄 때만
 * 기본은 rev, 확장이 없는 기기 · 후처리나 만화 효과를 끈 실행은 log. ?depth=log|rev|std 로 고른다
 */
const DEPTH_QUERY = QUERY.get("depth");
// 거꾸로 깊이는 실수형 깊이 버퍼라야 정밀도가 나온다. 후처리가 깊이를 읽을 때(만화 효과)만 실수형 깊이 텍스처가 잡히고,
// 후처리나 만화 효과를 끈 실행은 24비트 정수 깊이라 뒤집어도 먼 겹면이 떨린다(Codex 리뷰) — 그때는 로그 깊이 그대로
const CAN_REVERSE_DEPTH = !IS_POSTFX_DISABLED && QUERY.get("만화") !== "off";
export const DEPTH_MODE: "log" | "rev" | "std" =
  DEPTH_QUERY === "log" || DEPTH_QUERY === "std"
    ? DEPTH_QUERY
    : DEPTH_QUERY === "rev" || (CAN_REVERSE_DEPTH && hasClipControl())
      ? "rev"
      : "log";
/** 거꾸로 깊이로 도는가 — 그림자 보정값처럼 깊이 방향에 기대는 곳이 본다 */
export const IS_REVERSED_DEPTH = DEPTH_MODE === "rev";
/** ?fb=half — 후처리 버퍼를 HalfFloat 로 쓴다. 이 버퍼에서 3D 가 까맣게 나오는 증상을 재현할 때 */
export const USE_HALF_FLOAT_BUFFER = QUERY.get("fb") === "half";
/**
 * ?at=V1 · V2 · V3 — 실기기 측정용: 씬이 그려지면 그 관측 지점(plan/sitePlan VIEWPOINTS)으로 옮긴다.
 * 개발 빌드(npm run dev)에서만 듣는다. 운영 빌드는 ?dev 를 붙여도 무시한다 — 주소는 누구나 고칠 수 있어,
 * 열어 두면 박람회 랭킹 · 타임어택에서 스테이지 문을 건너뛸 수 있다(11/8 미르 · 해랑 검토).
 */
export const TEST_START_AT = import.meta.env.DEV ? QUERY.get("at") : null;
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
const MSAA_PARAM = QUERY.get("msaa");
export const MSAA_SAMPLES =
  MSAA_PARAM !== null && [0, 2, 4, 8].includes(+MSAA_PARAM)
    ? +MSAA_PARAM
    : IS_MOBILE_QUALITY || IS_LOW_QUALITY
      ? 0
      : IS_LIGHT_PRESENTATION
        ? 2
        : 4;
/**
 * 그림자 — 기본은 2048, 저사양 · 모바일은 끈다(그림자는 장면을 한 번 더 그린다). ?shadow=off · half · full 로 견준다.
 */
const SHADOW_PARAM = QUERY.get("shadow");
export const SHADOW_QUALITY: "off" | "half" | "full" =
  SHADOW_PARAM === "off" || SHADOW_PARAM === "half" || SHADOW_PARAM === "full"
    ? SHADOW_PARAM
    : IS_MOBILE_QUALITY
      ? "off"
      : IS_LOW_QUALITY
        ? "off"
        : "full";
export const SHADOW_MAP_SIZE = SHADOW_QUALITY === "half" ? 1024 : 2048;

// 이 씬은 픽셀에 걸려 있다(땅이 픽셀마다 삼면 노이즈를 돈다). 1.75 는 레티나에서 글자·외곽선이 안 무너지는 가장 낮은 값.
// 가벼운 발표 프리셋은 느린 노트북용이라 1.5(픽셀 27 % 감소)까지 내린다.
// ?dpr=1.5 처럼 숫자를 주면 그 값에 못 박고 자동 조절을 끈다(A/B 비교용).
const DPR_PARAM = QUERY.get("dpr");
// 모바일은 기기 배율 3 이라 상한을 따로 둔다 — 픽셀은 배율의 제곱으로 는다
// 저사양 모드는 1 을 넘기지 않고, 느리면 0.65 까지 내린다 — 글 · 단추는 DOM 이라 흐려지지 않는다(미르 11/12)
const DEFAULT_MAX_DPR = IS_LOW_QUALITY ? 1 : IS_MOBILE_QUALITY ? MOBILE_MAX_DPR : IS_LIGHT_PRESENTATION ? 1.5 : 1.75;
export const MAX_DPR = Math.min(3, Math.max(1, +(DPR_PARAM || DEFAULT_MAX_DPR) || DEFAULT_MAX_DPR));
/**
 * 자동 조절의 상한 — 기기 픽셀비보다 높게 그리지 않는다. 픽셀비 1 인 모니터(윈도우 데스크톱)에서 1.75 까지 올리면
 * 화면의 3배 픽셀을 MSAA 로 그린다 — 빠른 그래픽 카드일수록 끝까지 올라가 GPU 를 다 썼다(베타 11/16, 4K 에서 6720×3780).
 * 창을 다른 모니터로 옮기면 값이 바뀌므로 그릴 때마다 읽는다. ?dpr= 로 못 박은 값(A/B)은 자르지 않는다
 */
export const autoMaxDpr = () =>
  Math.min(MAX_DPR, Math.max(1, (typeof window !== "undefined" && window.devicePixelRatio) || 1));
/** 자동 조절 하한 — 이보다 내리면 너무 뿌예진다 */
export const MIN_DPR = IS_LOW_QUALITY ? 0.65 : 1;
export const IS_DPR_AUTO = !DPR_PARAM;
/** 자동 조절이 시작하는 값 */
export const START_DPR = IS_LOW_QUALITY ? 0.85 : 1.25;

// 발표 프리셋(?present)이면 작업 화면 UI 를 숨긴다
const IS_PRESENTING = PRESENTATION_MODE !== null;
/** ?review=1 — 검수 작업대(review/)가 삽입해 연 실행. 검수 시야를 가리는 패널·안내를 숨긴다 */
export const IS_REVIEW_RUN = QUERY.get("review") === "1";
/** 나주 본편은 1인칭 고정(10/15 미르) — 3인칭·캐릭터 꾸미기는 로비에서만. V 전환 없음 */
const IS_FIRST_PERSON_ONLY = true;
/**
 * ?npc — NPC 동행 개발 테스트(샌드박스 구체, npc/). 검수 실행(?review=1)에서는 켜지지 않는다.
 * ?npc=off 는 동행 NPC(companion/)를 끄는 스위치라 여기서도 끈다 — 두 NPC 가 함께 뜨지 않게 companionRuntime 과 짝을 맞춘다.
 */
export const IS_NPC_TEST = QUERY.has("npc") && QUERY.get("npc") !== "off" && !IS_REVIEW_RUN;
/** 개발용 V 1·3인칭 전환 — NPC 테스트에서만 허용한다. 본편은 IS_FIRST_PERSON_ONLY 로 1인칭 고정 */
export const ALLOW_VIEW_TOGGLE = IS_NPC_TEST;
/** 캐릭터 꾸미기 패널(왼쪽) */
export const SHOW_CUSTOMIZE_PANEL = !IS_PRESENTING && !IS_REVIEW_RUN && !IS_FIRST_PERSON_ONLY;
/** 오른쪽 위 ⚙ 단추. 발표·검수 화면엔 안 띄우고 [P] 로만 연다 */
export const SHOW_SETTINGS_BUTTON = !IS_PRESENTING && !IS_REVIEW_RUN;
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
