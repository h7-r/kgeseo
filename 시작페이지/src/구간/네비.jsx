import { useEffect, useLayoutEffect, useRef, useState } from "react";
import 에셋 from "../에셋.js";
import { 글꼴, 글자그라디언트 } from "../공통.js";
import { 메뉴이동 } from "../이동표.js";

/* ═══════════════════════════════════════════════════════
   nav — 두 가지 크기

     큼(14:1220, 173px) : 메인 랜딩. 글자 18px
     작음(78:1015, 149px): 하위 페이지. 글자 16px

   [항목을 모든 화면에서 똑같이 두는 이유 — 원본과 다른 점]
   피그마 변형들은 항목 구성이 제각각이다. 하위 페이지 nav(78:1015)에는
   **홈이 아예 없고**, 고객센터 페이지(112:1260)에서는 브랜드 자리가
   고객센터로 바뀐다. 그대로 옮기니 홈에서 소개를 누르면 **홈이 사라졌다.**
   메뉴가 페이지마다 달라지면 밑줄도 옮겨 갈 자리가 없다.
   그래서 여섯 항목으로 통일했다 — 원본과 다른 부분이니 되돌리려면 여기만 고치면 된다.

   [밑줄이 미끄러지는 방식]
   항목마다 밑줄을 따로 그리면 **사라졌다 나타난다.** 밑줄은 하나만 두고
   활성 항목의 위치를 재서 left/width 를 옮긴다. 그래서 왼쪽 항목을 누르면
   왼쪽으로, 오른쪽을 누르면 오른쪽으로 미끄러진다.
   ═══════════════════════════════════════════════════════ */

const 치수 = {
  큼: { 높이: 173, 로고: 26, 메뉴: 18, 밑줄: 34, 알약: 18, 알약글: "로그인  ·  회원가입" },
  작음: { 높이: 149, 로고: 22, 메뉴: 16, 밑줄: 30, 알약: 16, 알약글: "로그인 · 회원가입" },
};

const 항목 = ["홈", "소개", "컬렉션", "드롭", "브랜드", "고객센터"];


export default function 네비({ 크기 = "큼", 활성 = "홈", 누르기, 메뉴누르기 }) {
  const ㅊ = 치수[크기];
  const 줄 = useRef(null);
  const 칸들 = useRef({});
  const [밑줄자리, set밑줄자리] = useState(null);

  /* 활성 항목의 자리를 재서 밑줄을 그 아래 가운데로 옮긴다 */
  const 재기 = (이름) => {
    const el = 칸들.current[이름];
    if (!el) return null;
    return { left: el.offsetLeft + (el.offsetWidth - ㅊ.밑줄) / 2, width: ㅊ.밑줄 };
  };

  useLayoutEffect(() => {
    const 맞추기 = () => {
      const 도착 = 재기(활성);
      set밑줄자리(도착); // 없는 이름이면 null — 밑줄을 숨긴다
    };
    맞추기();
    const 관찰 = new ResizeObserver(맞추기);
    if (줄.current) 관찰.observe(줄.current);
    document.fonts?.ready?.then(맞추기); // 글꼴이 늦게 오면 폭이 달라진다
    return () => 관찰.disconnect();
  }, [활성, ㅊ.밑줄, 크기]);

  const 가기 = (이름) => 메뉴누르기 && 메뉴누르기(메뉴이동[이름]);

  return (
    <nav style={{ ...바깥, height: `${ㅊ.높이}px` }} data-node-id={크기 === "큼" ? "14:1220" : "78:1015"}>
      <div style={{ ...로고, fontSize: `${ㅊ.로고}px` }}>latent-Space</div>

      <div ref={줄} style={{ position: "relative", display: "flex", gap: "48px", alignItems: "center" }}>
        {항목.map((이름) => (
          <div
            key={이름}
            ref={(el) => (칸들.current[이름] = el)}
            className="링크"
            style={{
              ...메뉴바탕,
              fontSize: `${ㅊ.메뉴}px`,
              color: 이름 === 활성 ? "#96c5ff" : "#47628a",
              textShadow: 이름 === 활성 ? "0px 0px 8px rgba(59, 130, 246, 0.7)" : undefined,
              cursor: "pointer",
            }}
            onClick={() => 가기(이름)}
          >
            {이름}
          </div>
        ))}

        {/* 밑줄 하나가 항목 사이를 미끄러진다 */}
        {밑줄자리 && <물결밑줄 폭={ㅊ.밑줄} left={밑줄자리.left} />}
      </div>

      <div style={오른쪽}>
        <img src={에셋.imgSearchIcon} alt="검색" style={{ width: "22px", height: "22px", display: "block" }} />
        <div
          className="단추"
          style={{ ...알약, fontSize: `${ㅊ.알약}px`, cursor: 누르기 ? "pointer" : undefined }}
          onClick={누르기}
        >
          {ㅊ.알약글}
        </div>
      </div>
    </nav>
  );
}

const 바깥 = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "1920px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 80px",
  background: "rgba(2, 4, 10, 0.8)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  /* 원본은 0.5px rgba(108,116,127,0.4) 인데 어두운 화면에서는 헤더와 본문이
     구분되지 않는다. 한 줄 더 또렷하게 하고 아래로 옅은 그림자를 깔았다. */
  borderBottom: "1px solid rgba(148, 163, 184, 0.45)",
  boxShadow: "0 1px 0 0 rgba(96,165,250,0.12), 0 6px 18px -8px rgba(0,0,0,0.9)",
  boxSizing: "border-box",
  zIndex: 10, // 밑줄이 아래 내용에 가리지 않게
};

const 로고 = {
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  lineHeight: "normal",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  ...글자그라디언트("linear-gradient(90deg, #96c5ff 0%, #1d4ed8 59.528%)"),
};

const 메뉴바탕 = {
  fontFamily: 글꼴.모노,
  fontWeight: 400,
  lineHeight: "normal",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  letterSpacing: "1px", // 요청대로 원본보다 1px 넓게
  transition: "color .18s ease",
};

/* 밑줄 — 단순한 한 줄. 글자와 8px 띄운다(붙으면 답답해 보인다). */
function 물결밑줄({ 폭, left }) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${left}px`,
        top: "calc(100% + 8px)",
        width: `${폭}px`,
        height: "2px",
        borderRadius: "1px",
        background: "linear-gradient(90deg, #3b82f6 0%, #96c5ff 100%)",
        /* 왼쪽을 누르면 왼쪽으로, 오른쪽이면 오른쪽으로 미끄러진다 */
        transition: "left .42s cubic-bezier(.33,.1,.25,1), width .42s cubic-bezier(.33,.1,.25,1)",
        pointerEvents: "none",
      }}
    />
  );
}

const 오른쪽 = {
  display: "flex",
  gap: "20px",
  alignItems: "center",
  border: "1px solid #000000", // 원본에 그대로 있는 테두리 (어두운 바탕이라 거의 안 보인다)
};

const 알약 = {
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  lineHeight: "normal",
  color: "#ffffff",
  textTransform: "uppercase",
  whiteSpace: "pre",
  padding: "9px 22px",
  borderRadius: "20px",
  border: "0.5px solid #0b6ee7",
  background: "linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%)",
  boxShadow: "0px 0px 32px 0px rgba(96,165,250,0.19), 0px 4px 16px 0px rgba(59,130,246,0.38)",
};
