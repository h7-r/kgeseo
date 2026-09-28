import { useId } from "react";

/* ═══════════════════════════════════════════════════════
   가르는 호 — 왼쪽 덩이와 오른쪽 덩이 사이에 놓는 긴 곡선

   [왜 직선이 아닌가]
   처음엔 1px 직선으로 넣었는데, 이 화면의 다른 장식(앙암바위의 겹친 링,
   혜택 안내의 초승달)이 전부 곡선이라 직선 하나만 튀었다.
   위에서 아래로 내려오며 **왼쪽으로 배가 나온 호**로 바꿨다.

   [왜 좌우 대칭이어야 하나]
   처음 그린 길은 위 끝 x=92, 아래 끝 x=52 라 시작과 끝 높이가 달랐다.
   그러면 호가 통째로 **오른쪽으로 기울어 보인다.** 위아래 끝을 같은 x 에
   두고 가운데만 왼쪽으로 부풀려야 「기울지 않은 활」이 된다.

   [가운데 맞추기]
   호가 실제로 차지하는 가로 범위는 끝(끝x)과 배부른 곳(배x) 사이다.
   그 한가운데를 불러 준 「가운데」에 맞춰야 두 덩이 사이 정중앙에 놓인다.
   왼쪽 끝을 기준으로 놓으면 한쪽으로 치우친다.

   [밝기·굵기]
   양 끝은 투명하고 6할쯤 내려온 자리가 가장 밝다. 굵기를 바꿀 수는 없으니
   **같은 길을 두 번** 그린다 — 넓게 번지는 획 위에 가는 획을 얹는다.

   장식이라 클릭을 가로채지 않는다.
   ═══════════════════════════════════════════════════════ */

const 끝x = 104; // 위·아래 끝이 놓이는 자리
const 배x = 18; // 가장 배부른 곳(가운데)
/* 3차 베지에의 t=0.5 지점 x = (끝x + 3·배x + 3·배x + 끝x) / 8 */
const 실제배x = (끝x + 배x * 6) / 8;
const 호중심 = (끝x + 실제배x) / 2;

export default function 세로선({ 가운데, 위, 높이, 색 = "#3b82f6", 빛 = "#eaf2ff" }) {
  const 아이디 = useId().replace(/:/g, "");
  const 결 = `호결${아이디}`;
  const 번짐 = `호번짐${아이디}`;
  const H = 높이;

  /* 위아래 끝이 같은 x(=끝x) 라 기울지 않는다. 조절점을 위아래 대칭으로
     두어 배가 정확히 한가운데에서 가장 많이 나온다. */
  const 길 = `M ${끝x} 0 C ${배x} ${H * 0.26} ${배x} ${H * 0.74} ${끝x} ${H}`;

  return (
    <svg
      aria-hidden="true"
      width={끝x + 6}
      height={H}
      viewBox={`0 0 ${끝x + 6} ${H}`}
      style={{
        position: "absolute",
        left: `${가운데 - 호중심}px`,
        top: `${위}px`,
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      <defs>
        <linearGradient id={결} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={색} stopOpacity="0" />
          <stop offset="14%" stopColor={색} stopOpacity="0.8" />
          <stop offset="55%" stopColor={빛} stopOpacity="1" />
          <stop offset="86%" stopColor={색} stopOpacity="0.9" />
          <stop offset="100%" stopColor={색} stopOpacity="0" />
        </linearGradient>
        <filter id={번짐} x="-200%" y="-10%" width="500%" height="120%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      {/* 번지는 획 — 뒤에 깔려 빛처럼 보인다 */}
      <path d={길} fill="none" stroke={`url(#${결})`} strokeWidth="4.4" strokeLinecap="round" opacity="0.8" filter={`url(#${번짐})`} />
      {/* 또렷한 획 */}
      <path d={길} fill="none" stroke={`url(#${결})`} strokeWidth="1.8" strokeLinecap="round" />

      {/* ── 호를 따라 내려가는 빛 ──
          심장박동 선과 같은 방법으로 두 겹을 겹친다 — 넓게 번지는 것 위에
          또렷한 가는 것. 한 겹만 쓰면 흐릿해서 잘 안 보이고, 굵게만 하면
          바탕선과 색이 따로 논다. */}
      <path
        className="호빛"
        d={길}
        fill="none"
        stroke="#9ecbff"
        strokeWidth="5"
        strokeLinecap="round"
        pathLength="100"
        filter={`url(#${번짐})`}
        style={{ opacity: 0.85 }}
      />
      <path
        className="호빛"
        d={길}
        fill="none"
        stroke="#f2f8ff"
        strokeWidth="1.6"
        strokeLinecap="round"
        pathLength="100"
      />
    </svg>
  );
}
