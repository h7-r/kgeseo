import type { CSSProperties, ReactNode } from "react";

import { SUPPORT_EMAIL } from "@/data/contact";
import CREDITS from "@/data/credits.generated.json";
import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

/** 국가유산청 소품의 원본 라이선스(CC BY 4.0) 한국어 요약 */
const CC_BY_URL = "https://creativecommons.org/licenses/by/4.0/deed.ko";
const HERITAGE_AUTHOR = "KOREA HERITAGE SERVICE [KHS]";

interface CreditsCardProps {
  top?: number;
  /** 모바일 — 무대 좌표 대신 문서 흐름에 놓는다(폭 100%, 한 줄에 하나) */
  isFlow?: boolean;
}

/**
 * 크레딧 및 오픈소스 고지(/credits). 약관 카드와 같은 모양으로 그린다.
 * 내용은 credits.generated.json(tools/website/build-credits.mjs 가 소품 대장 · package.json 에서 만든다)만 읽는다.
 */
export default function CreditsCard({ top = 0, isFlow = false }: CreditsCardProps) {
  return (
    <section
      style={
        isFlow ? { ...rootStyle, position: "relative", left: 0, width: "100%" } : { ...rootStyle, top: `${top}px` }
      }
    >
      <div style={isFlow ? { ...bodyStyle, padding: "24px 16px 32px" } : bodyStyle}>
        <p style={titleStyle}>크레딧 및 오픈소스 고지</p>
        <p style={leadStyle}>
          ESCAPE THE LEGEND는 아래 공개 저작물과 오픈소스를 써서 만들었습니다. 각 저작물의 권리는 원저작자에게 있습니다.
        </p>

        <Heading count={CREDITS.heritage.length}>국가유산청 3D 소품</Heading>
        <p style={paragraphStyle}>
          아래 3D 모델은 국가유산청({HERITAGE_AUTHOR})이 Sketchfab에{" "}
          <ExternalLink href={CC_BY_URL}>CC BY 4.0</ExternalLink>으로 공개한 저작물입니다. 게임에 맞게 가볍게 줄이고
          화풍에 맞춰 바꿔 사용했습니다(변경함). 목록의 이름은 게임 안에서 부르는 이름이고, 괄호 안은 원래 제목입니다.
        </p>
        <ul style={isFlow ? { ...gridStyle, gridTemplateColumns: "1fr" } : gridStyle}>
          {CREDITS.heritage.map((item) => (
            <li key={item.url} style={itemStyle}>
              <span style={itemNameStyle}>
                {item.name} <span style={itemTitleStyle}>({item.title})</span>
              </span>
              <span style={itemMetaStyle}>
                by {HERITAGE_AUTHOR} · CC BY 4.0 · 변경함 · <ExternalLink href={item.url}>원본</ExternalLink>
              </span>
            </li>
          ))}
        </ul>

        <Heading count={CREDITS.openSource.length}>오픈소스 소프트웨어</Heading>
        <p style={paragraphStyle}>게임과 웹사이트가 브라우저에서 쓰는 주요 오픈소스입니다.</p>
        <ul style={isFlow ? { ...gridStyle, gridTemplateColumns: "1fr" } : gridStyle}>
          {CREDITS.openSource.map((item) => (
            <li key={item.name} style={itemStyle}>
              <span style={itemNameStyle}>
                {item.name} <span style={itemTitleStyle}>{item.version}</span>
              </span>
              <span style={itemMetaStyle}>
                {item.license} · <ExternalLink href={item.url}>npm</ExternalLink>
              </span>
            </li>
          ))}
        </ul>

        <Heading count={CREDITS.fonts.length}>글꼴</Heading>
        <p style={paragraphStyle}>Google Fonts에서 SIL Open Font License 1.1로 배포되는 글꼴을 씁니다.</p>
        <ul style={isFlow ? { ...gridStyle, gridTemplateColumns: "1fr" } : gridStyle}>
          {CREDITS.fonts.map((item) => (
            <li key={item.name} style={itemStyle}>
              <span style={itemNameStyle}>{item.name}</span>
              <span style={itemMetaStyle}>
                {item.license} · <ExternalLink href={item.url}>Google Fonts</ExternalLink>
              </span>
            </li>
          ))}
        </ul>

        <p style={{ ...paragraphStyle, marginTop: "16px" }}>
          출처 표기가 빠졌거나 잘못된 곳이 있으면 {SUPPORT_EMAIL}으로 알려 주세요. 확인하는 대로 고치겠습니다.
        </p>
      </div>
    </section>
  );
}

function Heading({ children, count }: { children: ReactNode; count: number }) {
  return (
    <p style={articleStyle}>
      {children} <span style={countStyle}>{count}</span>
    </p>
  );
}

/** 바깥 주소는 새 탭으로, 이 사이트가 아니라는 표시(↗)를 붙인다 */
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={linkStyle}>
      {children}
      <span aria-label="(새 창)"> ↗</span>
    </a>
  );
}

const rootStyle: CSSProperties = {
  position: "absolute",
  left: "80px",
  width: "1760px",
  background: "rgba(5,11,26,0.3)",
  border: "1px solid rgba(26,48,95,0.6)",
  borderRadius: "16px",
  overflow: "hidden",
  boxSizing: "border-box",
};

const bodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "18px",
  padding: "40px 48px 44px",
  boxSizing: "border-box",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "22px",
  lineHeight: 1.4,
  color: COLOR.textBright,
};

// 약관 카드와 같은 읽기 글꼴 · 밝기(TermsTabs)
const paragraphStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.reading,
  letterSpacing: "-0.1px",
  fontSize: "16px",
  lineHeight: 1.7,
  color: "#a9b4c5",
  wordBreak: "keep-all",
};

const leadStyle: CSSProperties = { ...paragraphStyle, color: COLOR.textBright };

const articleStyle: CSSProperties = {
  margin: "18px 0 0",
  fontFamily: FONT.reading,
  fontWeight: 700,
  fontSize: "17px",
  lineHeight: 1.6,
  color: COLOR.accent,
  letterSpacing: "0.3px",
};

const countStyle: CSSProperties = { fontFamily: FONT.mono, fontWeight: 500, fontSize: "14px", color: COLOR.textSubtle };

const gridStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "10px",
};

const itemStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  padding: "12px 16px",
  border: `1px solid ${COLOR.border}`,
  borderRadius: "10px",
  background: "rgba(9,15,32,0.6)",
  minWidth: 0,
};

const itemNameStyle: CSSProperties = {
  fontFamily: FONT.reading,
  fontWeight: 600,
  fontSize: "15px",
  lineHeight: 1.5,
  color: COLOR.textBright,
  overflowWrap: "anywhere",
};

const itemTitleStyle: CSSProperties = { fontWeight: 400, color: COLOR.textSubtle };

const itemMetaStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "12.5px",
  lineHeight: 1.5,
  color: COLOR.textMuted,
  overflowWrap: "anywhere",
};

const linkStyle: CSSProperties = { color: COLOR.accent, textDecoration: "underline", textUnderlineOffset: "3px" };
