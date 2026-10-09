/**
 * 화이트보드·핀보드·포스트잇 손글씨 글꼴. @font-face 는 src/fonts.css 가 등록한다(public/fonts/eonggeongkwi.woff2).
 * 엉겅퀴체에는 「」 · … — 글리프가 없다. 글꼴 폴백은 글자 단위라 뒤에 시스템 글꼴을 붙여야 두부(□)를 피한다.
 */
export const BOARD_FONT_FAMILY = '"Eonggeongkwi","Apple SD Gothic Neo","Malgun Gothic",sans-serif';

let boardFontReady: Promise<unknown> | null = null;

/** canvas 의 fillText 는 이미 내려받은 글꼴만 쓴다. @font-face 선언만으로는 안 받으므로 여기서 받게 한다. */
export function loadBoardFont(): Promise<unknown> {
  if (!boardFontReady) {
    boardFontReady = document.fonts
      .load('400 60px "Eonggeongkwi"')
      .then(() => document.fonts.ready)
      .catch(() => false); // 실패해도 폴백 글꼴로 그려지게 둔다
  }
  return boardFontReady;
}

/** 손으로 쓴 느낌용 흔들림(-0.5 ~ 0.5). 고정 시드라 새로고침해도 같은 모양이 나온다. */
export function createHandwritingRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}
