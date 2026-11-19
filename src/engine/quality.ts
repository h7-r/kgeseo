/**
 * 그래픽 품질 — 기본 · 저사양(미르 11/12 「품질 저하를 감수하며 다 낮출 바에 저사양 모드를 따로」).
 * 기본 모드의 화질은 건드리지 않고, 화질을 낮추는 것은 저사양 모드에만 넣는다.
 * 정하는 순서: 주소(?q=low · ?q=standard) → 설정 창에서 고른 값(저장) → 기기를 보고 자동.
 * 자동은 저장하지 않는다 — 열 때마다 다시 본다. 페이지를 열 때 한 번 정한다(그림자 · 후처리는 도중에 못 바꾼다).
 * 로비 ↔ 나주는 같은 출처라 같은 저장값 · 같은 판정을 쓴다 — 넘어가도 유지된다.
 */
import { resolveQuality } from "../../shared/qualityChoice";

export {
  readQualityChoice,
  saveQualityChoice,
  type QualityChoice,
  type QualityMode,
} from "../../shared/qualityChoice";

/** 이 페이지에 적용된 품질과 그렇게 정한 까닭 */
export const QUALITY = resolveQuality();

/** 저사양 모드. 텍스처 해상도를 절반으로 떨어뜨려 내장 GPU 의 메모리를 아낀다. */
export const IS_LOW_QUALITY = QUALITY.mode === "low";

export const TEXTURE_SCALE = IS_LOW_QUALITY ? 0.5 : 1;

/**
 * 모바일 품질(?q=mobile, 또는 ?q 없이 터치 기기로 열었을 때). 페이지를 열 때 한 번 정한다 —
 * 그림자 · 후처리는 중간에 바꾸면 재질을 다시 컴파일하므로 도중에 터치가 들어와도 바꾸지 않는다.
 * 보수적 시작값(계획서 8.2 · 코덱스 01회차): 해상도 배율 1.0~1.25, MSAA 0, 블룸 끔, 그림자 끔. ?q=pc 로 끈다.
 */
export const IS_MOBILE_QUALITY = (() => {
  try {
    const q = new URLSearchParams(location.search).get("q");
    if (q === "mobile") return true;
    // ?q=pc 처럼 다른 값이면 끈다. ?q=low 는 저사양 위에 모바일 판정을 그대로 얹는다(모바일 저사양 비교가 섞이지 않게)
    if (q !== null && q !== "low") return false;
    const touch = new URLSearchParams(location.search).get("touch");
    if (touch === "1") return true;
    if (touch === "0") return false;
    const isCoarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    return isCoarse || !("requestPointerLock" in Element.prototype);
  } catch {
    return false;
  }
})();

/**
 * 모바일 품질의 해상도 배율 상한. 휴대폰은 기기 배율이 3 이라 1.25 면 화면 해상도의 42 % 로 그려 늘린다 —
 * 미르 11/9(갤럭시 S24) 「너무 흐릿해 이질감이 크다」로 PC 나주와 같은 1.75 로 올렸다.
 * 나주는 1.25 에서 시작해 프레임이 넉넉하면 여기까지 올린다(PerformanceMonitor). 본편은 PC 상한 1.5 를 넘지 않는다.
 */
export const MOBILE_MAX_DPR = 1.75;
