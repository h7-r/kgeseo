import { useId } from "react";
import { 심장선길 } from "./데이터/심장선.js";

/* ═══════════════════════════════════════════════════════
   심장박동 선 — 원본의 ECG 모양 그대로, 빛이 한 번씩 훑고 지나간다

   [왜 <img> 를 버렸나]
   에셋은 SVG 파일이지만 <img> 로 넣으면 바깥에서 stroke 를 못 건드린다.
   선을 따라 빛이 흐르게 하려면 dash 를 움직여야 해서, 길(path d)만
   꺼내 인라인으로 다시 그린다. 모양은 원본과 같다.

   [어떻게 움직이나]
   ① 바탕선 — 늘 흐리게 깔려 있다(원본 모습).
   ② 달리는 빛 — 짧은 dash 하나가 왼쪽에서 오른쪽으로 지나간다.
      stroke-dashoffset 만 바꾸므로 레이아웃을 건드리지 않는다.
   ③ 번짐 — SVG filter 로 같은 선을 흐리게 깔아 빛이 퍼져 보인다.

   [왜 filter 를 안쪽에 두나]
   CSS drop-shadow 를 쓰면 요소 전체가 합성 대상이 돼서 스크롤할 때
   버벅인다. 필요한 획에만 거는 편이 훨씬 싸다.
   ═══════════════════════════════════════════════════════ */

export default function 심장선({
  모양 = "큰맥",
  폭 = "100%",
  높이,
  색 = "#3b82f6",
  빛 = "#93c5fd",
  굵기 = 1.2,
  주기 = 3.4,
  늦춤 = 0,
  진하기 = 0.55,
  style,
}) {
  const ㄱ = 심장선길[모양];
  const 아이디 = useId().replace(/:/g, "");
  const 번짐 = `번짐${아이디}`;
  /* 길이를 모를 때 dash 를 맞추기 어려우니 pathLength 로 100 에 맞춘다.
     그러면 어떤 모양이든 「12 만큼이 빛나고 88 은 비어 있다」로 똑같이 쓴다. */
  return (
    <svg
      /* 길이 실제로 그려진 범위만 담는다 — 남는 여백이 있으면 그림이 한쪽으로 쏠린다 */
      viewBox={`${ㄱ.x} ${ㄱ.y} ${ㄱ.w} ${ㄱ.h}`}
      preserveAspectRatio="none"
      width={폭}
      height={높이 ?? ㄱ.h}
      style={{ display: "block", overflow: "visible", pointerEvents: "none", ...style }}
      aria-hidden="true"
    >
      <defs>
        <filter id={번짐} x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>

      {/* ① 바탕선 */}
      <path d={ㄱ.d} fill="none" stroke={색} strokeWidth={굵기} strokeOpacity={진하기} pathLength="100" />

      {/* ③ 번진 빛 — 달리는 빛과 같은 dash 를 흐리게 깔아 둔다 */}
      <path
        className="맥번짐"
        d={ㄱ.d}
        fill="none"
        stroke={빛}
        strokeWidth={굵기 * 2.6}
        strokeLinecap="round"
        pathLength="100"
        filter={`url(#${번짐})`}
        style={{ animationDuration: `${주기}s`, animationDelay: `${늦춤}s` }}
      />

      {/* ② 달리는 빛 */}
      <path
        className="맥빛"
        d={ㄱ.d}
        fill="none"
        stroke={빛}
        strokeWidth={굵기 * 1.35}
        strokeLinecap="round"
        pathLength="100"
        style={{ animationDuration: `${주기}s`, animationDelay: `${늦춤}s` }}
      />
    </svg>
  );
}
