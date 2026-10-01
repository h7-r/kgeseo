import { memo } from "react";
import { 글꼴 } from "../공통.js";
import { 하위높이 } from "../하위메뉴.js";

/* ═══════════════════════════════════════════════════════
   하위 내비 — 머리띠 아래 한 줄. 지금 페이지의 구간·탭으로 바로 간다.
   (보일지·무엇을 누를지는 내비층.jsx 가 정한다. 여기는 그리기만 한다)

   모양은 머리띠 메뉴와 같은 결 — 모노 글꼴 · 대문자 · 켜진 것은 남색 + 빛.
   글자를 머리 메뉴(19px)보다 작게(15px) 두어 「한 단계 아래」로 읽히게 한다.
   ═══════════════════════════════════════════════════════ */
function 하위내비({ 항목, 켜진것, 누르기 }) {
  return (
    <nav aria-label="이 페이지 바로가기" style={바깥}>
      {항목.map(({ 이름 }) => {
        const 켜짐 = 이름 === 켜진것;
        return (
          <button
            key={이름}
            type="button"
            className="하위내비단추"
            aria-current={켜짐 ? "true" : undefined}
            onClick={() => 누르기(이름)}
            style={{
              ...단추,
              color: 켜짐 ? "#7d97d6" : "rgba(241,241,252,0.78)",
              textShadow: 켜짐 ? "0 0 8px rgba(46,72,137,0.7)" : undefined,
              borderBottomColor: 켜짐 ? "#395ca7" : "transparent",
            }}
          >
            {이름}
          </button>
        );
      })}
    </nav>
  );
}

export default memo(하위내비);

const 바깥 = {
  /* 머리띠 nav(네비.jsx)가 absolute 로 맨 위 149 를 덮고 있다 — 그 바로 아래에 놓는다 */
  position: "absolute",
  left: 0,
  top: "149px",
  width: "1920px",
  height: `${하위높이}px`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "40px",
  background: "rgba(1, 4, 10, 0.78)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  borderTop: "1px solid rgba(111, 134, 191, 0.18)",
  borderBottom: "1px solid rgba(111, 134, 191, 0.18)",
};
const 단추 = {
  height: "100%",
  padding: "0 4px",
  background: "none",
  border: "none",
  borderBottom: "2px solid transparent",
  fontFamily: 글꼴.모노,
  fontSize: "15px",
  letterSpacing: "1px",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  cursor: "pointer",
  transition: "color .18s ease, border-color .18s ease",
};
