import { useEffect, useLayoutEffect, useRef, useState } from "react";

/* ═══════════════════════════════════════════════════════
   무대 — 1920 로 짜고 창 폭에 맞춰 통째로 줄이는 칸

   [왜 이렇게 하나]
   피그마 원본이 오토레이아웃이 아니라 **1920 고정 좌표** 디자인이다.
   반응형으로 다시 짜면 "그대로 동일하게" 가 깨진다. 그래서 1920 으로
   정확히 짜고 화면 폭에 맞춰 축소한다. 어떤 창 크기에서도 비율이 안 틀어진다.
   → 이 페이지들은 **창 폭 기준**이지 기기별 반응형이 아니다.

   [높이를 왜 재서 쓰나]
   처음엔 페이지마다 높이를 숫자로 적었는데, 그러면 푸터 아래로 빈 공간이
   남는다. 실제로 메인은 198px, 인증은 87px 이 비어 있었다.
   (피그마 메인 프레임이 9020 인데 푸터는 8822 에서 끝난다 — 원본에 남아 있는
   여백이다.) 그래서 **맨 아래 요소까지의 높이를 재서** 그만큼만 쓴다.
   탭을 바꿔 내용 길이가 달라져도 ResizeObserver 가 다시 잰다.

   [word-break 를 여기서 한 번에 거는 이유]
   피그마 텍스트 노드는 거의 전부 word-break: break-word 를 달고 나온다.
   글자가 칸을 넘칠 때만 작동해서 넘치지 않는 글자엔 영향이 없다.
   이게 없으면 "50+" 같은 글자가 칸(97px)을 넘겨도 안 쪼개져서
   원본과 줄 수가 달라진다.
   ═══════════════════════════════════════════════════════ */

export const 설계폭 = 1920;

export default function 무대({ 높이, children }) {
  const 배율 = use화면배율();
  const 칸 = useRef(null);
  const [잰높이, set잰높이] = useState(높이);

  useLayoutEffect(() => {
    const el = 칸.current;
    if (!el) return;
    const 재기 = () => {
      /* 푸터는 `bottom: 0` 으로 바닥에 붙어 있어서 offsetTop 으로 재면
         지금 높이를 되돌려 줄 뿐이다(순환). 그래서 **푸터만 빼고** 재고
         푸터 높이를 더한다. */
      let 맨아래 = 0;
      let 푸터높이 = 0;
      for (const c of el.children) {
        if (c.dataset.바닥) {
          푸터높이 = Math.max(푸터높이, c.offsetHeight);
          continue;
        }
        맨아래 = Math.max(맨아래, c.offsetTop + c.offsetHeight);
      }
      const 필요 = 맨아래 + 푸터높이;
      /* 내용이 한 화면보다 짧으면 화면 높이만큼 늘려, 푸터가 창 맨 아래에
         붙게 한다. 안 그러면 푸터 뒤로 바탕만 남은 빈 공간이 보인다. */
      const 한화면 = typeof window === "undefined" ? 0 : window.innerHeight / (window.innerWidth / 설계폭);
      const 값 = Math.ceil(Math.max(필요, 한화면));
      if (값 > 0) set잰높이(값);
    };
    재기();
    const 관찰 = new ResizeObserver(재기);
    관찰.observe(el);
    for (const c of el.children) 관찰.observe(c);
    return () => 관찰.disconnect();
  }, [children]);

  const 실제높이 = Math.round(잰높이 * 배율);

  return (
    /* 바깥 칸의 높이를 **줄어든 만큼** 으로 직접 정한다.
       transform 은 배치 높이를 바꾸지 않아서(1920 기준 높이를 그대로 차지한다)
       이렇게 겉칸을 잡아 주지 않으면 아래로 그만큼 빈 공간이 생긴다. */
    <div
      style={{
        position: "relative",
        width: "100%",
        height: `${실제높이}px`,
        /* 1920 밖으로 흘러넘치는 장식(배경 타원 등)을 잘라 낸다.
           ★ overflowX 만 hidden 으로 주면 안 된다 — CSS 규칙상 한 축이
             hidden 이면 다른 축의 visible 이 **auto 로 바뀌어** 여기에
             스크롤 영역이 하나 더 생긴다. 실제로 그래서 푸터 아래로
             빈 공간과 두 번째 스크롤바가 생겼다. 두 축 다 hidden 으로 둔다. */
        overflow: "hidden",
        background: "var(--색-바탕)",
      }}
    >
      <div
        ref={칸}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          wordBreak: "break-word",
          width: `${설계폭}px`,
          height: `${잰높이}px`,
          transformOrigin: "top left",
          transform: `scale(${배율})`,
        }}
      >
        {children}
      </div>
      <배율표시 배율={배율} 높이={잰높이} />
    </div>
  );
}

export function use화면배율() {
  const [배율, set배율] = useState(() =>
    typeof window === "undefined" ? 1 : window.innerWidth / 설계폭,
  );
  useEffect(() => {
    const 갱신 = () => set배율(window.innerWidth / 설계폭);
    갱신();
    window.addEventListener("resize", 갱신);
    return () => window.removeEventListener("resize", 갱신);
  }, []);
  return 배율;
}

/* ═══════════════════════════════════════════════════════
   배율 표시 — 이 화면이 「창 폭 기준」 이라는 걸 눈에 보이게

   1920 으로 짜 놓고 창 폭에 맞춰 통째로 줄이기 때문에, 창을 좁히면
   글자도 같이 작아진다. 그걸 모르면 "왜 폰트가 작아지지?" 하게 된다.
   그래서 지금 배율과 창 폭을 구석에 적어 둔다.

   **개발 중에만 보인다** (import.meta.env.DEV). 빌드 결과물엔 안 들어간다.
   눌러서 숨길 수 있다.
   ═══════════════════════════════════════════════════════ */
function 배율표시({ 배율, 높이 }) {
  const [보임, set보임] = useState(true);
  if (!import.meta.env.DEV) return null;
  if (!보임)
    return (
      <button onClick={() => set보임(true)} style={{ ...쪽지, width: "28px", padding: "6px 0", textAlign: "center" }} title="배율 표시 켜기">
        ⤢
      </button>
    );
  return (
    <button onClick={() => set보임(false)} style={쪽지} title="눌러서 숨기기">
      설계 1920 기준 · 창 폭에 맞춰 <b style={{ color: "#93c5fd" }}>{Math.round(배율 * 100)}%</b> 로 축소
      <span style={{ opacity: 0.55 }}>
        {" "}
        · 창 {typeof window === "undefined" ? "?" : window.innerWidth}px · 페이지 {높이}px
      </span>
    </button>
  );
}

const 쪽지 = {
  position: "fixed",
  right: "12px",
  bottom: "12px",
  zIndex: 9999,
  padding: "6px 10px",
  borderRadius: "8px",
  border: "1px solid rgba(96,165,250,0.35)",
  background: "rgba(6,13,26,0.88)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  color: "#94a3b8",
  font: '400 12px/1.4 "IBM Plex Mono", monospace',
  cursor: "pointer",
};
