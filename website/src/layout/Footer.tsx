import type { CSSProperties } from "react";

import { FOOTER_ATTR } from "@/lib/layout";
import { FONT } from "@/lib/style";
import { FOOTER_LINKS, useSiteNavigate } from "@/navigation/routes";
import { COLOR } from "@/styles/tokens";

/** 홈 맨 아래 띠. */
export default function Footer() {
  const navigate = useSiteNavigate();

  return (
    <footer style={rootStyle} {...FOOTER_ATTR}>
      <div style={rowStyle}>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span style={brandStyle}>ESCAPE THE LEGEND</span>
          <span style={taglineStyle}>· 지역 탐험 방탈출 2026</span>
        </div>

        <div style={linksStyle}>
          {FOOTER_LINKS.map(({ label, target }) => (
            <button
              key={label}
              type="button"
              className="text-link"
              style={footerLinkStyle}
              onClick={() => navigate(target)}
            >
              {label}
            </button>
          ))}
        </div>

        <span style={copyrightStyle}>™ &amp; © 2026 ESCAPE THE LEGEND. All Rights Reserved.</span>
      </div>
    </footer>
  );
}

const rootStyle: CSSProperties = {
  position: "absolute",
  left: "-0.02px",
  bottom: 0,
  width: "1919.773px",
  // 글줄 한 줄만 있는 띠라 위아래 28px 씩만 둔다.
  height: "98px",
  background: COLOR.black,
  borderTop: "1px solid #40454d",
  padding: "32px 80px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
};

const rowStyle: CSSProperties = {
  display: "grid",
  // 가운데 칸을 화면 한가운데에 못 박는다. space-between 이면 좌우 글 길이 차이로 쏠린다.
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "center",
  overflow: "hidden",
  width: "1760px",
};

const brandStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "22px",
  color: COLOR.navyMuted,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const taglineStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 400,
  fontSize: "18px",
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
  fontSize: "18px",
  // 거의 검정인 바탕에서도 읽히는 밝은 남색.
  color: COLOR.navyMuted,
  whiteSpace: "nowrap",
};

const copyrightStyle: CSSProperties = {
  justifySelf: "end",
  fontFamily: FONT.mono,
  fontSize: "18px",
  color: COLOR.white,
  whiteSpace: "nowrap",
};
