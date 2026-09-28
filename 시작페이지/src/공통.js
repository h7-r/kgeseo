/* ═══════════════════════════════════════════════════════
   구간들이 같이 쓰는 작은 도우미

   피그마 원본은 좌표로 놓인 프레임이 대부분이라, 옮겨 적을 때
   position:absolute + left/top/width/height 가 계속 나온다.
   그걸 매번 풀어 쓰면 값이 안 보이니 함수 하나로 줄인다.
   ═══════════════════════════════════════════════════════ */

/** 피그마 x/y/w/h 를 그대로 CSS 로 (값이 없으면 그 속성은 안 넣는다) */
export function 놓기(x, y, w, h) {
  const s = { position: "absolute", left: `${x}px`, top: `${y}px` };
  if (w != null) s.width = `${w}px`;
  if (h != null) s.height = `${h}px`;
  return s;
}

/** 글자에 그라디언트를 입힌다 (피그마의 bg-clip-text) */
export function 글자그라디언트(배경) {
  return {
    background: 배경,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
  };
}

/* 피그마 변수 font family/Font 1~3.
   ★ Bebas Neue 와 Syncopate 에는 **한글 글리프가 없다.**
     원본 피그마에서도 한글은 다른 글꼴로 대체돼 그려진다.
     그래서 뒤에 Pretendard 를 반드시 붙여 둔다 — 빼면 한글이 두부(□)가 된다. */
/* ═══════════════════════════════════════════════════════
   글꼴

   피그마 변수가 부르는 네 벌(Bebas Neue · IBM Plex Mono · Inter ·
   Syncopate)에 한글용 Pretendard 를 뒤에 받쳐 뒀다. 라틴 글꼴에는 한글
   글자가 없어서, 한글은 자동으로 Pretendard 로 떨어진다.

   [읽기 를 따로 둔 이유]
   모노는 **글자 폭이 다 같은** 글꼴이라 코드·숫자·짧은 이름표에 좋다.
   그런데 긴 한글 문장에까지 쓰면, 한글은 Pretendard 로 떨어지면서도
   모노에 맞춰 잡아 둔 넓은 자간을 그대로 물려받아 낱말이 흩어져 보인다.
   약관처럼 **여러 줄을 내리읽는 글**에는 읽기 를 쓴다.
   ═══════════════════════════════════════════════════════ */
export const 글꼴 = {
  제목: '"Bebas Neue", "Pretendard", sans-serif',
  모노: '"IBM Plex Mono", "Pretendard", monospace',
  본문: '"Inter", "Pretendard", sans-serif',
  넓게: '"Syncopate", "Pretendard", sans-serif',
  /* 긴 한글 문장 전용 — 한글이 먼저 오고 라틴은 Inter 가 받는다 */
  읽기: '"Pretendard", "Inter", system-ui, sans-serif',
};

/** 피그마의 inset-[...] — 음수면 그림이 칸 밖으로 넘쳐 커진다 (글로우가 이렇게 그려진다) */
export function 넘침(위, 좌, 아래 = 위, 우 = 좌) {
  return { position: "absolute", top: 위, right: 우, bottom: 아래, left: 좌 };
}

/** 회전한 그림 한 장 — 피그마가 flex+rotate 로 감싸 두는 모양을 그대로 옮긴다 */
export function 회전그림({ 칸, 각도, 폭, 높이, 그림, 넘침값, 기울기 }) {
  return {
    바깥: { ...칸, display: "flex", alignItems: "center", justifyContent: "center" },
    속: { transform: `rotate(${각도}deg)${기울기 ? ` skewX(${기울기}deg)` : ""}`, flex: "none" },
    상자: { width: `${폭}px`, height: `${높이}px`, position: "relative" },
    그림칸: { ...넘침값, position: "absolute" },
    그림,
  };
}

/* ═══════════════════════════════════════════════════════
   아직 갈 곳이 없는 것

   피그마에 **다음 화면이 없는** 단추·링크가 있다. 넘길 카드가 3장뿐인
   좌우 화살표, 2쪽 이후 자료가 없는 쪽번호, 대응 페이지가 없는 푸터 링크 등.

   이런 것에 손가락 커서를 달아 두면 "눌리는 줄 알았는데 안 눌린다" 가 된다.
   그래서 커서를 기본으로 되돌리고, 무엇을 기다리는지 title 로 알려 준다.
   나중에 화면이 생기면 이 자리에 onClick 을 달면 된다.
   ═══════════════════════════════════════════════════════ */
export const 막음 = { cursor: "default" };
export const 막음안내 = "아직 연결된 화면이 없습니다";

/* ═══════════════════════════════════════════════════════
   두 번째 화면에서 왼쪽 소개 덩이와 오른쪽 가입 폼의 **공통 중심선**

   원본 좌표는 소개 y=1629.45, 폼 y=1589.45 라 폼이 40px 높이 떠 있다.
   게다가 행간을 넓히면서 소개 덩이가 길어져 차이가 더 벌어졌다.
   높이를 숫자로 박으면 글꼴이 조금만 달라져도 또 어긋나므로,
   **둘 다 이 선에 중심을 맞춘다**(top + translateY(-50%)).
   그러면 각자 높이가 어떻든 가운데가 항상 같다.
   ═══════════════════════════════════════════════════════ */
export const 소개폼중심 = 1938;

/* ═══════════════════════════════════════════════════════
   소개 덩이 · 가입폼의 가로 자리

   원본은 왼쪽 245 / 오른쪽 185 로 여백이 달랐다. 폭(755·560)과
   사이 간격(175)은 그대로 두고 **양쪽 여백만 215 로 같게** 맞췄다.
   245 + 755 + 175 + 560 + 185 = 1920 → 215 + 755 + 175 + 560 + 215 = 1920
   ═══════════════════════════════════════════════════════ */
export const 소개왼쪽 = 215;
export const 소개폭 = 755;
export const 폼사이 = 175;
export const 가입폼왼쪽 = 소개왼쪽 + 소개폭 + 폼사이; // 1145
export const 가입폼폭 = 560;

/* 소개 덩이에서 **글이 실제로 끝나는** 자리(브라우저에서 잰 값).
   상자는 970 까지지만 가장 긴 줄이 883 에서 끝난다 — 가르는 호를 놓을 때
   상자가 아니라 이 값을 기준으로 해야 눈에 가운데로 보인다. */
export const 소개글끝 = 883;

/** 주어진 y 를 중심으로 놓기 */
export function 중심놓기(x, 중심y, w) {
  return {
    position: "absolute",
    left: `${x}px`,
    top: `${중심y}px`,
    width: `${w}px`,
    transform: "translateY(-50%)",
  };
}
