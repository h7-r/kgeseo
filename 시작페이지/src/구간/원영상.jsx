import { useEffect, useRef } from "react";

/* ═══════════════════════════════════════════════════════
   원 안 영상 — 앙암바위 링 안에 들어가는 사건 콘셉트 필름

   · 기본은 1배로 반복 재생(부메랑으로 이어 붙여 이음매가 없다)
   · 스크롤하면 그 속도만큼 빨리 흐르고, 멈추면 1배로 돌아온다
   · 화면 밖에 있으면 재생을 멈춘다(보이지도 않는데 디코딩할 이유가 없다)
   · 동작 줄이기 사용자에겐 재생하지 않고 포스터(영상 첫 장면)만 보여 준다
   ═══════════════════════════════════════════════════════ */
const 최대배속 = 8; // 스크롤이 아주 빠를 때
const 게인 = 1.4; // 스크롤 속도(px/ms) → 배속 환산 (클수록 민감)

export default function 원영상({ src, poster, style }) {
  const 영상 = useRef(null);

  useEffect(() => {
    const v = 영상.current;
    if (!v) return undefined;
    /* ★ 성능: 주소(src)·포스터는 가까이 왔을 때 붙인다(아래 붙이기).
       [전엔] autoPlay + preload="auto" 라 페이지를 열자마자 이 영상(약 2~3MB)을 통째로 받기 시작해,
              첫 화면 히어로 영상·그림들과 회선을 나눠 썼다. */
    const 붙이기 = () => {
      if (v.getAttribute("src")) return;
      if (poster) v.poster = poster;
      v.src = src;
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      if (poster) v.poster = poster; // 동작 줄이기 — 재생 없이 첫 장면만
      return undefined;
    }

    let 보임 = false;
    let lastY = window.scrollY;
    let lastT = performance.now();
    let 배속 = 1;
    let raf = 0;

    /* 가까워지면(1500px 안) 주소를 붙이고 재생한다 — 화면에 닿을 땐 이미 흐르고 있다.
       아주 멀리 벗어나면 쉬고, 다시 가까워지면 미리 다시 튼다. */
    /* ★ 성능: 매 프레임 도는 루프는 **가까이 있을 때만** 돌린다.
       [전엔] 화면에서 한참 먼(다른 구간을 보는) 동안에도 루프가 매 프레임 돌며 scrollY 를
       읽었다(측정: 쪽 전환 중 강제 스타일 계산 28회). 보임 검사가 읽기 **뒤에** 있어서였다.
       [지금] 가까워지면 루프를 켜고, 멀어지면 끈다. 켤 때는 기준 자리를 새로 잡아
       「멀리서 한 번에 온 거리」를 스크롤 속도로 잘못 읽지 않게 한다. */
    const 켜기 = () => {
      if (raf) return;
      lastY = window.scrollY;
      lastT = performance.now();
      raf = requestAnimationFrame(돌기);
    };
    const 끄기 = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
    const 관찰 = new IntersectionObserver(([항목]) => {
      보임 = 항목.isIntersecting;
      if (보임) { 붙이기(); v.play().catch(() => {}); 켜기(); }
      else { v.pause(); 끄기(); }
    }, { rootMargin: "1500px 0px" });
    관찰.observe(v);

    function 돌기(now) {
      raf = requestAnimationFrame(돌기);
      const y = window.scrollY;
      const 속도 = Math.abs(y - lastY) / Math.max(1, now - lastT); // px per ms
      lastY = y;
      lastT = now;
      if (!보임) return;
      const 목표 = Math.min(최대배속, 1 + 속도 * 게인); // 안 움직이면 1
      배속 += (목표 - 배속) * 0.15; // 부드럽게 따라가고 멈추면 서서히 1배로
      if (v.readyState > 0) {
        try { if (Math.abs(v.playbackRate - 배속) > 0.02) v.playbackRate = Math.max(0.5, 배속); } catch (e) {}
      }
    }

    return () => {
      끄기();
      관찰.disconnect();
    };
  }, [src, poster]);

  return <video ref={영상} muted loop playsInline preload="auto" aria-hidden="true" style={style} />;
}
