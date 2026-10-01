import { useEffect } from "react";

/* ═══════════════════════════════════════════════════════
   화면 밖의 끝없는 장식 애니메이션은 쉰다

   .흐름글/.줄무늬글 의 유리광은 background-position 을 움직인다.
   이건 합성만으로 못 해서 **매 프레임 다시 칠한다.** 화면 밖에 있는 것까지
   8초마다 돌면 스크롤과 같은 프레임에서 주 스레드·GPU 를 나눠 쓴다.
   화면에 들어오면(여유 200px) 다시 돈다 — 보이는 모습은 그대로다.
   ═══════════════════════════════════════════════════════ */
/* ★ 호빛(호를 따라 흐르는 빛)·맥빛/맥번짐(심장박동 선)도 넣었다 — 셋 다 SVG 선의
   stroke-dashoffset 을 움직여서, 유리광과 똑같이 합성이 안 되고 매 프레임 다시 칠한다.
   화면 밖에 있을 때만 멈추니 보이는 모습은 그대로다. */
/* ★ 겹원 고리(.고리)와 사진 둘레 빛(.사진고리)도 넣었다. 페이지 한참 아래(앙암바위 등)에 있어
   첫 화면에선 안 보이는데 계속 돌았다. 특히 .사진고리는 conic-gradient 각도(@property)를 돌려서
   합성이 안 되고 매 프레임 다시 칠한다. */
const 고를것 = ".흐름글, .줄무늬글, .호빛, .맥빛, .맥번짐, .고리, .사진고리";

export function use화면밖쉼(뿌리ref, 열쇠) {
  useEffect(() => {
    const 뿌리 = 뿌리ref.current;
    if (!뿌리 || typeof IntersectionObserver === "undefined") return undefined;
    const 관찰 = new IntersectionObserver(
      (항목들) => { for (const 항 of 항목들) 항.target.classList.toggle("쉼", !항.isIntersecting); },
      { rootMargin: "200px 0px" },
    );
    const 본것 = new WeakSet();
    const 훑기 = () => {
      for (const el of 뿌리.querySelectorAll(고를것)) if (!본것.has(el)) { 본것.add(el); 관찰.observe(el); }
    };
    훑기();
    /* lazy 화면·늦게 뜨는 구간도 잡는다 — 붙을 때만 다시 훑는다 */
    const 변화 = new MutationObserver(() => 훑기());
    변화.observe(뿌리, { childList: true, subtree: true });
    return () => { 관찰.disconnect(); 변화.disconnect(); };
  }, [뿌리ref, 열쇠]);
}
