// 심장선.jsx — 웹사이트(시작페이지)의 심장박동 선을 캐릭터 생성 화면에서도 쓴다.
//
// [왜 시작페이지 것을 그대로 import 하지 않나]
//   시작페이지/src/심장선.jsx 는 빛의 움직임을 **그 앱의 index.css(.맥빛 · @keyframes 맥흐름)**
//   에 기대고 있다. 이 화면은 다른 앱(본편·naju01)에서 뜨므로 그 CSS 가 없다.
//   그래서 **길 데이터만** 같은 파일에서 가져오고(모양이 사이트와 똑같아야 한다),
//   움직임은 여기서 따로 건다. 선 모양을 고치면 두 화면이 같이 바뀐다.
import { useId } from "react";
import { 심장선길 } from "../../../시작페이지/src/데이터/심장선.js";

export const 심장선CSS = `
.캐생맥빛, .캐생맥번짐 {
  stroke-dasharray: 13 87;
  animation-name: 캐생맥흐름;
  animation-timing-function: cubic-bezier(0.45, 0, 0.3, 1);
  animation-iteration-count: infinite;
}
.캐생맥번짐 { opacity: 0.55; }
@keyframes 캐생맥흐름 {
  0%   { stroke-dashoffset: 100; opacity: 0; }
  6%   { opacity: 1; }
  88%  { opacity: 1; }
  100% { stroke-dashoffset: -13; opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .캐생맥빛, .캐생맥번짐 { animation: none; opacity: 0; }
}
`;

/**
 * @param 모양 심장선길 의 이름(큰맥 · 넓은맥 · 카드맥 · 위맥 …)
 * @param 색   바탕선 색 — 늘 흐리게 깔린다
 * @param 빛   훑고 지나가는 빛 색
 */
export default function CC심장선({
  모양 = "넓은맥",
  폭 = "100%",
  높이,
  색 = "#5FB0C8",
  빛 = "#BFF1FF",
  굵기 = 1.2,
  주기 = 3.6,
  늦춤 = 0,
  진하기 = 0.35,
  style,
}) {
  const ㄱ = 심장선길[모양] ?? 심장선길.넓은맥;
  const 번짐 = `캐생번짐${useId().replace(/:/g, "")}`;
  return (
    <svg
      viewBox={`${ㄱ.x} ${ㄱ.y} ${ㄱ.w} ${ㄱ.h}`}
      preserveAspectRatio="none"
      width={폭}
      height={높이 ?? ㄱ.h}
      style={{ display: "block", overflow: "visible", pointerEvents: "none", ...style }}
      aria-hidden="true"
    >
      <defs>
        <filter id={번짐} x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      <path d={ㄱ.d} fill="none" stroke={색} strokeWidth={굵기} strokeOpacity={진하기} pathLength="100"
            vectorEffect="non-scaling-stroke" />
      <path className="캐생맥번짐" d={ㄱ.d} fill="none" stroke={빛} strokeWidth={굵기 * 2.8} strokeLinecap="round"
            pathLength="100" filter={`url(#${번짐})`} vectorEffect="non-scaling-stroke"
            style={{ animationDuration: `${주기}s`, animationDelay: `${늦춤}s` }} />
      <path className="캐생맥빛" d={ㄱ.d} fill="none" stroke={빛} strokeWidth={굵기 * 1.4} strokeLinecap="round"
            pathLength="100" vectorEffect="non-scaling-stroke"
            style={{ animationDuration: `${주기}s`, animationDelay: `${늦춤}s` }} />
    </svg>
  );
}
