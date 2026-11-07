/** 모바일 바닥글 — 데스크톱 PageFooter 와 같은 내용을 한 단으로 */
import type { CSSProperties } from "react";

import { FONT } from "@/lib/style";
import { FOOTER_LINKS, useSiteNavigate } from "@/navigation/routes";
import { COLOR } from "@/styles/tokens";

import { GUTTER, safeBottom } from "./mobileStyles";

export default function MobileFooter() {
  const navigate = useSiteNavigate();
  return (
    <footer style={rootStyle}>
      <div style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: "15px", color: COLOR.textBright }}>
        ESCAPE THE LEGEND
        <span style={{ fontWeight: 400, color: COLOR.textSubtle }}> · 지역 탐험 방탈출 2026</span>
      </div>
      <div style={linksStyle}>
        {FOOTER_LINKS.map(({ label, target }) => (
          <button key={label} type="button" style={linkStyle} onClick={() => navigate(target)}>
            {label}
          </button>
        ))}
      </div>
      <p style={lineStyle}>
        ESCAPE THE LEGEND의 로고 · 캐릭터 · 명칭을 비롯해 이와 관련된 모든 고유한 표현은 LATENT SPACE의 독점 자산입니다.
      </p>
      <p style={lineStyle}>대표자 : Team · Legend | 대표전화 : 000-0000-0000 | 광주광역시 인공지능 사관학교</p>
      <p style={lineStyle}>사업자등록번호 : 000-00-00000 | 통신판매업신고 : 2026-광주남구-00000</p>
      <p style={{ ...lineStyle, marginTop: 12 }}>™ &amp; © 2026 ESCAPE THE LEGEND. All Rights Reserved.</p>
    </footer>
  );
}

const rootStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  marginTop: "56px",
  padding: `28px calc(env(safe-area-inset-right, 0px) + ${GUTTER}px) ${safeBottom(28)} calc(env(safe-area-inset-left, 0px) + ${GUTTER}px)`,
  background: COLOR.black,
  borderTop: "1px solid #40454d",
};

const linksStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "4px 18px", margin: "14px 0 16px" };

const linkStyle: CSSProperties = {
  minHeight: "40px",
  fontFamily: FONT.body,
  fontSize: "14px",
  color: COLOR.textMuted,
  cursor: "pointer",
};

const lineStyle: CSSProperties = {
  margin: "4px 0 0",
  fontFamily: FONT.body,
  fontSize: "12px",
  lineHeight: 1.6,
  color: COLOR.textDim,
};
