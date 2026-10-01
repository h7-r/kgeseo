import { useCallback, useEffect, useRef, useState } from "react";
import { 영상열기 as 열기요청 } from "./영상창상태.js";

export { use열린영상, 영상닫기 } from "./영상창상태.js";

/* ═══════════════════════════════════════════════════════
   use미리보기 — 작은 자리(경주 원 · 시나리오 카드)의 영상 한 편을 다룬다

   [하는 일 세 가지]
   ① 호버하면 재생, 떠나면 멈춤 (소리 없이 — 페이지를 둘러보는 중이니까)
   ② 누르면 큰 영상 모달(구간/영상모달.jsx)을 연다.
      이때 **지금 보던 장면(currentTime)** 과 **화면 속 자리(getBoundingClientRect)** 를 같이 넘긴다
      → 모달이 그 자리에서부터 커지고(유튜브 전체화면처럼), 같은 장면부터 이어서 튼다.
   ③ 모달을 축소(닫기)하면 모달이 보던 장면을 돌려받아, **그 자리에서 계속 흐른다**
      (그 뒤로는 마우스가 떠나도 안 멈춘다 = 「흐름」 상태)

   [쓰는 법]
     const 미리 = use미리보기(영상목록.경주, "240px");
     <div {...미리.판속성}> … <video {...미리.비디오속성} /> … </div>
   판속성 = 호버·클릭을 받는 칸(카드 전체 등),  비디오속성 = <video> 에 그대로 펼친다.
   모양 = 모달이 커지기 시작할 때의 둥근 모서리(원이면 크게, 카드면 16px).
   ═══════════════════════════════════════════════════════ */
export function use미리보기(영상, 모양 = "16px") {
  const 비디오 = useRef(null);
  const 흐름 = useRef(false); // 모달에서 돌아온 뒤 = 계속 재생
  const 호버 = useRef(false);
  const 보임 = useRef(true);
  const 동작줄임 = useRef(false);
  /* ★ 성능: 가까이 와야 영상·포스터 주소를 붙인다.
     [전엔] 페이지를 열자마자 저 아래 영상 4편의 앞부분(편당 ~190KB)과 포스터 6장을 한꺼번에 받았다.
            첫 화면(히어로 영상·글꼴·JS)과 회선을 나눠 쓰느라, 그 사이 다른 그림들이 늦게 떴다.
     [지금] 화면에서 1500px 안으로 들어오면 그때 붙인다 — 스크롤로 닿기 한참 전이라 기다림은 안 보인다. */
  const [가까움, set가까움] = useState(false);

  /* 지금 재생해야 하나? — 화면에 보이고, (호버 중이거나 흐름 상태) */
  const 맞추기 = useCallback(() => {
    const v = 비디오.current;
    if (!v) return;
    const 틀어야 = 보임.current && (호버.current || 흐름.current) && !동작줄임.current;
    if (틀어야) v.play().catch(() => {}); // 자동 재생이 막혀도 조용히 넘어간다(포스터가 보인다)
    else if (!v.paused) v.pause();
  }, []);

  /* 다른 영상으로 바뀌면(원에서 다른 갈래를 고르면) 흐름·호버를 처음으로 */
  useEffect(() => {
    흐름.current = false;
    호버.current = false;
  }, [영상]);

  useEffect(() => {
    const v = 비디오.current;
    if (가까움 || !v || !영상) return undefined;
    if (typeof IntersectionObserver === "undefined") { set가까움(true); return undefined; }
    const 관찰 = new IntersectionObserver(([항]) => {
      if (항.isIntersecting) { set가까움(true); 관찰.disconnect(); }
    }, { rootMargin: "1500px 0px" });
    관찰.observe(v);
    return () => 관찰.disconnect();
  }, [영상, 가까움]);

  /* 화면 밖으로 나가면 멈춘다 — 흐름 상태라도 안 보이는 영상을 풀 이유가 없다 */
  useEffect(() => {
    동작줄임.current = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    const v = 비디오.current;
    if (!v || !영상 || typeof IntersectionObserver === "undefined") return undefined;
    const 관찰 = new IntersectionObserver(([항]) => { 보임.current = 항.isIntersecting; 맞추기(); }, { rootMargin: "200px 0px" });
    관찰.observe(v);
    return () => 관찰.disconnect();
  }, [영상, 맞추기]);

  const 열기 = () => {
    const v = 비디오.current;
    if (!v || !영상) return;
    v.pause(); // 모달이 소리 있는 쪽을 튼다 — 작은 쪽은 쉰다
    열기요청({
      영상,
      출발요소: v, // 닫힐 때 다시 여기로 줄어든다(그때 자리를 다시 잰다)
      모양,
      시각: v.currentTime || 0,
      돌아오기: (시각) => {
        const 지금v = 비디오.current;
        if (!지금v) return;
        try { 지금v.currentTime = 시각; } catch { /* 아직 못 읽었으면 처음부터 */ }
        흐름.current = true;
        맞추기();
      },
    });
  };

  return {
    있음: Boolean(영상),
    비디오속성: 영상
      ? {
          ref: 비디오,
          src: 가까움 ? 영상.주소 : undefined,
          poster: 가까움 ? 영상.포스터 : undefined,
          muted: true, // 작은 자리는 늘 소리 없이 — 소리는 모달에서
          loop: true,
          playsInline: true,
          preload: "metadata", // 첫 장면·길이만 먼저 — 호버할 때 나머지를 받는다
          "aria-hidden": true,
        }
      : null,
    판속성: 영상
      ? {
          role: "button",
          tabIndex: 0,
          "aria-label": `${영상.제목} 영상 크게 보기`,
          onMouseEnter: () => { 호버.current = true; 맞추기(); },
          onMouseLeave: () => { 호버.current = false; 맞추기(); },
          onFocus: () => { 호버.current = true; 맞추기(); },
          onBlur: () => { 호버.current = false; 맞추기(); },
          onClick: 열기,
          onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); 열기(); } },
        }
      : {},
  };
}
