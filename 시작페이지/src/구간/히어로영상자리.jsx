/* 히어로 영상 칸의 겉모습 — three.js 없이도 그릴 수 있는 부분.
   ★ 성능: 히어로영상.jsx 는 three(≈600KB)를 부른다. 이걸 lazy 로 떼고, 받는 동안에는
   **똑같은 포스터 칸**을 먼저 보여 준다. 영상이 붙으면 같은 그림 위로 캔버스가 떠오른다. */
/* 바탕에 **영상 첫 장면**을 깔아 둔다 — 영상(10MB)이 받아지기 전 첫 화면에서
   파란 빈 칸이 보였다가 영상으로 바뀌던 걸 없앤다. 캔버스가 같은 장면 위로
   0.8s 동안 떠오르니 바뀌는 순간이 안 보인다. (셰이더도 cover 맞춤이라 자리가 같다) */
export const 칸스타일 = {
  position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden",
  background: "#43587f url(/hero-scrub-poster.webp) center / cover no-repeat",
};

/* 가장자리를 눌러 어둡게 → 빨려드는 느낌 강조 + 흰 글자 가독성 확보 */
export const 영상어둠 = {
  position: "absolute",
  inset: 0,
  zIndex: 0,
  pointerEvents: "none",
  background:
    "radial-gradient(120% 90% at 50% 42%, rgba(67,88,127,0) 34%, rgba(16,25,56,0.5) 78%, rgba(11,16,40,0.78) 100%)",
};

export function 히어로영상자리() {
  return (
    <>
      <div style={칸스타일} aria-hidden="true" />
      <div style={영상어둠} aria-hidden="true" />
    </>
  );
}
