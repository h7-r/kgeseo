import type { CSSProperties } from "react";

import { FOOTER_ATTR } from "@/lib/layout";
import { FONT } from "@/lib/style";
import { FOOTER_LINKS, useSiteNavigate } from "@/navigation/routes";
import { COLOR } from "@/styles/tokens";

/** 하위 페이지 공통 푸터. 홈 푸터와 달리 사업자 정보가 아래에 붙는다. */
export default function PageFooter() {
  const navigate = useSiteNavigate();

  return (
    <footer style={rootStyle} {...FOOTER_ATTR}>
      <div style={topRowStyle}>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span style={brandStyle}>ESCAPE THE LEGEND</span>
          <span style={taglineStyle}>· 지역 탐험 방탈출 2026</span>
        </div>
        <div style={linksStyle}>
          {FOOTER_LINKS.map(({ label, target }) => (
            <button key={label} type="button" className="link" style={footerLinkStyle} onClick={() => navigate(target)}>
              {label}
            </button>
          ))}
        </div>
        <span style={copyrightStyle}>™ &amp; © 2026 ESCAPE THE LEGEND. All Rights Reserved.</span>
      </div>

      <div style={bottomRowStyle}>
        <p style={lineStyle}>
          ESCAPE THE LEGEND 및 관련 로고, 캐릭터, 명칭 및 이와 관련된 모든 고유한 표현은 ESCAPE THE LEGEND의 독점
          자산입니다.
        </p>
        <p style={lineStyle}>대표자 : Team Legend | 대표전화 : 000-0000-0000 | 광주광역시 인공지능 사관학교</p>
        <p style={lineStyle}>사업자등록번호 : 000-00-00000 | 통신판매업신고 : 2026-광주남구-00000</p>
      </div>
    </footer>
  );
}

const rootStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  bottom: 0,
  width: "1920px",
  // 위 구분선~첫 줄과 마지막 줄~바닥 간격을 같게 맞춘 높이.
  height: "217px",
  background: COLOR.black,
  borderTop: "1px solid #40454d",
  boxSizing: "border-box",
};

const topRowStyle: CSSProperties = {
  position: "absolute",
  left: "80px",
  top: "35px",
  width: "1760px",
  display: "grid",
  // 가운데 칸을 화면 한가운데에 못 박는다(홈 푸터와 같은 이유).
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "center",
  overflow: "hidden",
};

const bottomRowStyle: CSSProperties = {
  position: "absolute",
  left: "80px",
  top: "72px",
  width: "1760px",
  paddingTop: "20px",
  fontFamily: FONT.reading,
  letterSpacing: "-0.1px",
  fontWeight: 400,
  fontSize: "16px",
  color: COLOR.textSubtle,
  textAlign: "center",
  boxSizing: "border-box",
};

const lineStyle: CSSProperties = { margin: 0, lineHeight: 1.8 };

const brandStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "18px",
  color: COLOR.navyMuted,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const taglineStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 400,
  fontSize: "16px",
  color: COLOR.white,
  whiteSpace: "nowrap",
};

// 단추는 브라우저가 word-spacing 을 normal 로 되돌려 모노 글꼴의 좁힌 띄어쓰기(「지역 맵」)가 풀린다.
const footerLinkStyle: CSSProperties = { cursor: "pointer", wordSpacing: "inherit" };

const linksStyle: CSSProperties = {
  display: "flex",
  gap: "32px",
  alignItems: "center",
  justifySelf: "center",
  fontFamily: FONT.mono,
  fontWeight: 400,
  fontSize: "16px",
  // 거의 검정인 바탕에서 읽히도록 #1e46c1 보다 밝은 파랑.
  color: COLOR.navyMuted,
  whiteSpace: "nowrap",
};

const copyrightStyle: CSSProperties = {
  justifySelf: "end",
  fontFamily: FONT.mono,
  fontSize: "16px",
  color: COLOR.white,
  whiteSpace: "nowrap",
};
