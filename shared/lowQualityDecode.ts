/**
 * 저사양 모드의 그림 크기 상한(미르 11/12 「저사양은 가능한 최대한 가볍게」).
 * 모형 파일(GLB) 속 그림은 createImageBitmap 으로 풀린다 — 풀자마자 상한보다 크면 줄여서 넘기고 원본은 바로 놓는다.
 * 2048 그림 한 장은 풀면 16MB, 그래픽에 올리면 밉맵까지 21MB 다. 1024 로 줄이면 둘 다 1/4.
 * 나주 인물 · 구렁이 · 동행 · 플레이어 몸 · 로비 상주 인물이 모두 이 길로 들어온다(실측: 나주 저사양에서 2048 그림 16장 341MB).
 * 게임 모듈이 그림을 읽기 전에 엔트리가 한 번 건다. 기본 모드에서는 걸지 않는다.
 */
export function capDecodedImages(maxSize: number, view: Window & typeof globalThis = window) {
  const original = view.createImageBitmap;
  if (typeof original !== "function") return;
  const capped = async (...args: unknown[]): Promise<ImageBitmap> => {
    const bitmap = await (original as (...rest: unknown[]) => Promise<ImageBitmap>).apply(view, args);
    // 일부만 잘라 내는 꼴(sx, sy, sw, sh)이나 이미 크기를 정한 호출은 그대로 둔다
    const options = args.length <= 2 ? (args[1] as ImageBitmapOptions | undefined) : undefined;
    if (args.length > 2 || options?.resizeWidth || options?.resizeHeight) return bitmap;
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= maxSize) return bitmap;
    try {
      const scale = maxSize / longest;
      const small = await (original as (...rest: unknown[]) => Promise<ImageBitmap>).call(view, bitmap, {
        resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
        resizeHeight: Math.max(1, Math.round(bitmap.height * scale)),
        resizeQuality: "medium",
        // 처음 풀 때의 설정을 그대로 — 빠뜨리면 기본값(알파 미리 곱하기)이 걸려 반투명 가장자리가 어두워진다(Codex 리뷰 10).
        // 뒤집기는 처음 풀 때 이미 됐다(다시 뒤집지 않는다)
        premultiplyAlpha: options?.premultiplyAlpha,
        colorSpaceConversion: options?.colorSpaceConversion,
      });
      bitmap.close();
      return small;
    } catch {
      // 줄이지 못하면 원본 그대로 — 게임은 돈다
      return bitmap;
    }
  };
  view.createImageBitmap = capped as typeof view.createImageBitmap;
}

/** 저사양 모드의 그림 한 변 상한 */
export const LOW_QUALITY_TEXTURE_MAX = 1024;
