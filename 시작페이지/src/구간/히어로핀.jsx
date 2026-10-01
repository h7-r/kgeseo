import { useEffect, useRef } from "react";
import { use화면배율 } from "../무대.jsx";
import { 소개폼중심 } from "../공통.js";
import 히어로 from "./히어로.jsx";
import { 히어로덮음알림 } from "../가림.js";

/* ═══════════════════════════════════════════════════════
   히어로 핀 — 힉스필드(waegok ScrollInvestigation)와 같은 구조

   [어떻게 붙어 있나]
   높은 트랙(data-핀트랙) 안에 position: sticky 칸(data-핀스티키)을 둔다.
   트랙을 지나는 동안 sticky 칸이 화면 맨 위에 붙어 있고, 그동안 영상은
   **스크롤한 만큼만** 흘러간다(히어로영상.jsx 가 트랙을 찾아 진행도를 읽는다).
   트랙 끝까지 내려가야 sticky 가 풀리고 아래 구간으로 넘어간다.

   [풀릴 때]
   · 풀리기 직전부터 히어로가 살짝 어두워지고, 올라가는 동안 바탕으로 스며든다.
   · 멈춘 자리로 저절로 끌어가는(붙이기) 동작은 없다 — 스크롤이 끊기는 느낌을 줘서 뺐다.

   [왜 무대 밖인가]
   무대 안 요소는 전부 position: absolute(1920 고정 좌표)라 sticky 를 걸 수가
   없고, 무대는 transform: scale 이 걸린 칸이다. 그래서 트랙은 무대 **앞**에
   일반 흐름으로 두고, 히어로는 무대와 **같은 배율**로 줄여 똑같이 보이게 한다.
   (시작화면.jsx 가 무대를 히어로끝 만큼 끌어올려 소개가 바로 이어지게 한다.)
   ═══════════════════════════════════════════════════════ */

/* 설계 좌표에서 히어로 아래 끝 — 헤더 149 + 히어로 1149 */
export const 히어로끝 = 149 + 1149;
const 헤더 = 149;

/* sticky 가 붙어 있는 스크롤 거리. 힉스필드는 트랙 350svh − 화면 100svh = 250svh */
const 스크럽길이 = "250svh";

const clamp = (n) => Math.max(0, Math.min(1, n));
const 부드럽게 = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export default function 히어로핀({ 누름 }) {
  const 배율 = use화면배율();
  const 높이 = Math.round(히어로끝 * 배율);
  const 트랙ref = useRef(null);
  const 칸ref = useRef(null);
  const 안ref = useRef(null);
  /* 동작 줄이기 사용자는 붙잡지 않는다 — 트랙 = 히어로 높이 그대로 */
  const 정지 = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const 트랙 = 트랙ref.current, 칸 = 칸ref.current, 안 = 안ref.current;
    if (!트랙 || !칸 || !안 || 정지) return undefined;

    /* 지금 창 크기에서 「풀리는 자리」와 「두 번째 화면이 가운데 오는 자리」(scrollY) */
    const 재기 = () => {
      const b = window.innerWidth / 1920;
      const 트랙위 = 트랙.getBoundingClientRect().top + window.scrollY;
      const 거리 = Math.max(1, 트랙.offsetHeight - 칸.offsetHeight);
      const 풀림 = 트랙위 + 거리 + Math.round(헤더 * b);
      /* 무대는 히어로끝 만큼 끌어올려져 트랙위+거리 에서 시작한다 */
      const 소개 = Math.max(풀림, 트랙위 + 거리 + 소개폼중심 * b - window.innerHeight / 2);
      return { 트랙위, 거리, 풀림, 소개 };
    };

    let 예약 = 0;
    /* ★ 예전엔 멈춘 자리가 「풀림 ~ 두 번째 화면」 사이면 저절로 붙여(scrollTo) 줬다.
       그런데 손을 멈출 때마다 화면이 제멋대로 움직여 「스크롤이 끊긴다」는 느낌을 줬다 → 뺐다.
       이제 스크롤은 **사람이 굴린 만큼만** 움직인다. */

    /* 풀림 연출 — 끝 장면에서 살짝 어두워지고, 올라가며 바탕으로 스며든다 */
    const 그리기 = () => {
      예약 = 0;
      const { 트랙위, 거리, 풀림, 소개 } = 재기();
      const y = window.scrollY;
      const p = clamp((y - 트랙위) / 거리);
      const r = clamp((y - 풀림) / Math.max(1, 소개 - 풀림));
      const 불투명 = (1 - 0.2 * 부드럽게(0.93, 1, p)) * (1 - 부드럽게(0, 0.8, r));
      안.style.opacity = 불투명.toFixed(3);
      /* 불투명한 히어로가 창을 빈틈없이 덮고 있으면 뒤의 입체 배경을 재운다 */
      const 칸상자 = 칸.getBoundingClientRect();
      히어로덮음알림(불투명 >= 0.999 && 칸상자.top <= 0.5 && 칸상자.bottom >= window.innerHeight - 0.5);
    };

    /* 스크롤·창 크기가 바뀌면 다음 프레임에 한 번만 다시 그린다(rAF 로 묶어 매 이벤트마다 그리지 않는다) */
    const 스크롤 = () => {
      if (!예약) 예약 = requestAnimationFrame(그리기);
    };

    그리기();
    window.addEventListener("scroll", 스크롤, { passive: true });
    window.addEventListener("resize", 스크롤);
    return () => {
      히어로덮음알림(false);
      if (예약) cancelAnimationFrame(예약);
      window.removeEventListener("scroll", 스크롤);
      window.removeEventListener("resize", 스크롤);
    };
  }, [정지]);

  return (
    <div
      ref={트랙ref}
      data-핀트랙=""
      style={{
        position: "relative",
        zIndex: 2, // 끌어올린 무대보다 위, 헤더(20)보다 아래
        height: 정지 ? `${높이}px` : `calc(${높이}px + ${스크럽길이})`,
      }}
    >
      <div
        ref={칸ref}
        data-핀스티키=""
        /* top 을 헤더(149)만큼 음수로 — 처음 149 만큼은 히어로가 위로 올라가고(헤더도 숨는다),
           그다음 히어로가 화면 맨 위에 딱 붙은 채 고정된다. 위에 빈 띠가 안 남는다. */
        style={{ position: "sticky", top: `-${Math.round(헤더 * 배율)}px`, height: `${높이}px`, overflow: "clip" }}
      >
        {/* 1920 설계 좌표 그대로 두고 무대와 같은 배율로 줄인다 */}
        <div
          ref={안ref}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "1920px",
            height: `${히어로끝}px`,
            transformOrigin: "top left",
            transform: `scale(${배율})`,
            willChange: "opacity",
          }}
        >
          <히어로 누름={누름} 위={헤더} />
        </div>
      </div>
    </div>
  );
}
