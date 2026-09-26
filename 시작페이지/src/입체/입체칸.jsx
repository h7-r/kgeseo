import { Component, Suspense, lazy, useEffect, useRef, useState } from "react";

/* ═══════════════════════════════════════════════════════
   입체 장면을 안전하게 얹는 칸

   [왜 바로 안 그리나]
   three.js 는 무겁다(gzip 기준 수백 KB). 첫 화면이 그 때문에 늦어지면
   3D 가 아무리 좋아도 손해다. 그래서

   · 코드를 따로 떼어 **필요할 때** 받아 온다(lazy).
   · 히어로가 **화면에 들어올 때만** 붙인다.
   · 화면 밖으로 나가면 렌더 루프를 세운다(보임=false).
   · WebGL 이 없거나 동작 줄이기를 켠 사람에겐 아예 안 붙인다 —
     그래도 뒤에 깔린 피그마 배경이 그대로 보여서 화면이 비지 않는다.

   [왜 오류를 삼키나]
   낡은 기기나 드라이버에서 WebGL 이 도중에 죽을 수 있다. 장식 하나 때문에
   페이지 전체가 하얘지면 안 되므로, 이 칸 안에서만 조용히 꺼진다.
   ═══════════════════════════════════════════════════════ */

const 장면들 = {
  유물: lazy(() => import("./유물.jsx")),
  궤도: lazy(() => import("./궤도.jsx")),
};

/* WebGL 을 만들 수 있나 — 한 번만 확인하고 답을 기억한다 */
let 웹지엘가능 = null;
function 웹지엘되나() {
  if (웹지엘가능 !== null) return 웹지엘가능;
  try {
    const 캔 = document.createElement("canvas");
    웹지엘가능 = Boolean(캔.getContext("webgl2") || 캔.getContext("webgl"));
  } catch {
    웹지엘가능 = false;
  }
  return 웹지엘가능;
}

export default function 입체칸({ 장면 = "유물", style }) {
  const 칸 = useRef(null);
  const [붙일까, set붙일까] = useState(false);
  const [보임, set보임] = useState(false);
  const [줄임, set줄임] = useState(false);
  const [죽음, set죽음] = useState(false);

  useEffect(() => {
    if (!웹지엘되나()) {
      set죽음(true);
      return;
    }
    const 질의 = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    set줄임(Boolean(질의?.matches));
    const 바뀜 = (e) => set줄임(e.matches);
    질의?.addEventListener?.("change", 바뀜);

    const el = 칸.current;
    if (!el) return () => 질의?.removeEventListener?.("change", 바뀜);

    const 관찰 = new IntersectionObserver(
      ([항목]) => {
        set보임(항목.isIntersecting);
        /* 한 번 들어오면 계속 붙여 둔다 — 오갈 때마다 다시 만들면
           WebGL 문맥을 반복해서 만들고 버리게 돼 훨씬 비싸다 */
        if (항목.isIntersecting) set붙일까(true);
      },
      { rootMargin: "240px" },
    );
    관찰.observe(el);

    return () => {
      관찰.disconnect();
      질의?.removeEventListener?.("change", 바뀜);
    };
  }, []);

  return (
    <div ref={칸} aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", ...style }}>
      {붙일까 && !죽음 && (
        <오류막이 알림={() => set죽음(true)}>
          <Suspense fallback={null}>
            {(() => {
              const 그릴것 = 장면들[장면];
              return 그릴것 ? <그릴것 보임={보임} 줄임={줄임} /> : null;
            })()}
          </Suspense>
        </오류막이>
      )}
    </div>
  );
}

/* 장면이 터져도 페이지는 살아 있게 — 이 안에서만 끈다.
   리액트에서 자식의 렌더 오류를 잡으려면 클래스 컴포넌트여야 한다
   (훅으로는 만들 수 없는 몇 안 되는 것 중 하나다). */
class 오류막이 extends Component {
  constructor(props) {
    super(props);
    this.state = { 터짐: false };
  }

  static getDerivedStateFromError() {
    return { 터짐: true };
  }

  componentDidCatch(오류) {
    /* 장식 하나가 죽었을 뿐이니 조용히 알리고 넘어간다 */
    console.warn("[입체칸] 장면을 끕니다:", 오류?.message ?? 오류);
    this.props.알림?.();
  }

  render() {
    return this.state.터짐 ? null : this.props.children;
  }
}
