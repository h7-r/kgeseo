/** 저사양 모드(?q=low). 텍스처 해상도를 절반으로 떨어뜨려 내장 GPU 의 메모리를 아낀다. */
export const IS_LOW_QUALITY = (() => {
  try {
    return new URLSearchParams(location.search).get("q") === "low";
  } catch {
    // 브라우저가 아닌 환경(빌드 중 등)에서는 일반 모드
    return false;
  }
})();

export const TEXTURE_SCALE = IS_LOW_QUALITY ? 0.5 : 1;
