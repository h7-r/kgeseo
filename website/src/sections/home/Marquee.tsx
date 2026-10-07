import { useId, type CSSProperties } from "react";

import marqueeBackground from "@/assets/images/imgMarqueeBg.svg";
import { FONT } from "@/lib/style";
import { QUERY, ROUTES, SOCIAL_LINKS, useSiteNavigate, withQuery, type NavTarget } from "@/navigation/routes";
import { COLOR } from "@/styles/tokens";

/**
 * 호를 그리며 늘어선 글귀. 가로는 flex 로 차례대로 놓고(디자인 x 대로 두면 글자와 ✦ 가 겹친다),
 * 높낮이는 가운데가 가장 높은 좌우 대칭 포물선 cy = -2 + 30·(2u-1)², 기울기는 그 접선 각도다.
 */
const BAND_ITEMS = [
  { text: "ESCAPE THE LEGEND 2026", y: 28.0, rotate: -4.43 },
  { text: "✦", y: 20.97, rotate: -3.88 },
  { text: "REGIONAL ESCAPE ADVENTURE", y: 14.88, rotate: -3.32 },
  { text: "✦", y: 9.72, rotate: -2.77 },
  { text: "역사 · 설화 · 탐험", y: 5.5, rotate: -2.22 },
  { text: "✦", y: 2.22, rotate: -1.66 },
  { text: "퀘스트 · 보상 · 방문", y: -0.12, rotate: -1.11 },
  { text: "✦", y: -1.53, rotate: -0.55 },
  { text: "게임으로 되살리는 우리 지역", y: -2.0, rotate: 0.0 },
  { text: "✦", y: -1.53, rotate: 0.55 },
  { text: "전국 50+ 방탈출 맵", y: -0.12, rotate: 1.11 },
  { text: "✦", y: 2.22, rotate: 1.66 },
  { text: "지역 탐험을 시작하세요", y: 5.5, rotate: 2.22 },
  { text: "✦", y: 9.72, rotate: 2.77 },
  { text: "숨겨진 미션을 찾아라", y: 14.88, rotate: 3.32 },
  { text: "✦", y: 20.97, rotate: 3.88 },
  { text: "실제 방문 · 특별 보상", y: 28.0, rotate: 4.43 },
] as const;

/** 소셜 아이콘. 파일로 불러오면 깨진 그림으로 뜬 적이 있어 선 모양을 코드에 직접 둔다. */
const SOCIAL_ICONS = [
  {
    id: "x",
    label: "X",
    path: "M12.5002 7.4998L7.4998 12.5002M7.4998 7.4998L12.5002 12.5002M18.334 10C18.334 14.6027 14.6027 18.334 10 18.334C5.39726 18.334 1.666 14.6027 1.666 10C1.666 5.39726 5.39726 1.666 10 1.666C14.6027 1.666 18.334 5.39726 18.334 10Z",
  },
  {
    id: "youtube",
    label: "유튜브",
    path: "M2.0826 5.83379C1.50047 8.58073 1.50047 11.4192 2.0826 14.1661C2.15908 14.4451 2.30687 14.6993 2.51142 14.9038C2.71597 15.1084 2.97024 15.2561 3.24922 15.3326C7.7186 16.0731 12.2794 16.0731 16.7488 15.3326C17.0278 15.2561 17.282 15.1084 17.4866 14.9038C17.6911 14.6993 17.8389 14.4451 17.9154 14.1661C18.4975 11.4192 18.4975 8.58073 17.9154 5.83379C17.8389 5.55483 17.6911 5.30059 17.4866 5.09606C17.282 4.89152 17.0278 4.74375 16.7488 4.66727C12.2794 3.92691 7.71862 3.92691 3.24922 4.66727C2.97024 4.74375 2.71597 4.89152 2.51142 5.09606C2.30687 5.30059 2.15908 5.55483 2.0826 5.83379Z",
  },
  {
    id: "twitter",
    label: "트위터",
    path: "M16.6672 6.16599C17.7506 5.08261 18.334 3.33253 18.334 3.33253C18.334 3.33253 16.7505 4.33258 15.8338 4.33258C13.3336 1.99914 9.24994 3.99923 10 7.49939C7.16644 7.58272 4.33288 6.33267 2.4994 4.1659C0.4159 7.99941 2.4994 12.9163 6.6664 14.1664C5.33296 15.3331 3.49948 15.9164 1.666 15.8331C8.83324 20.5833 18.0006 14.4997 16.6672 6.16599Z",
  },
  {
    id: "instagram",
    label: "인스타그램",
    path: "M14.5837 5.4163H14.592M5.833 1.666H14.167C16.4684 1.666 18.334 3.53163 18.334 5.833V14.167C18.334 16.4684 16.4684 18.334 14.167 18.334H5.833C3.53163 18.334 1.666 16.4684 1.666 14.167V5.833C1.666 3.53163 3.53163 1.666 5.833 1.666ZM13.3334 9.47521C13.4362 10.1688 13.3177 10.8772 12.9948 11.4995C12.6719 12.1219 12.1609 12.6266 11.5346 12.9419C10.9082 13.2571 10.1985 13.3669 9.5062 13.2555C8.81393 13.1441 8.17441 12.8172 7.6786 12.3214C7.18279 11.8256 6.85595 11.1861 6.74455 10.4938C6.63316 9.80153 6.74288 9.09176 7.05813 8.46544C7.37337 7.83912 7.87807 7.32815 8.50046 7.00521C9.12284 6.68227 9.8312 6.5638 10.5248 6.66665C11.2323 6.77156 11.8873 7.10124 12.393 7.60698C12.8988 8.11272 13.2284 8.76772 13.3334 9.47521Z",
  },
] as const satisfies readonly { id: keyof typeof SOCIAL_LINKS; label: string; path: string }[];

/** 맨 아래 줄 링크. 개인정보처리방침만 밝기 차로 강조한다. */
const FOOTER_LINKS: readonly { label: string; color: string; target: NavTarget }[] = [
  { label: "이용약관", color: COLOR.textSubtle, target: withQuery(ROUTES.terms, { [QUERY.tab]: "terms" }) },
  { label: "개인정보처리방침", color: "#b9bfca", target: withQuery(ROUTES.terms, { [QUERY.tab]: "privacy" }) },
  { label: "고객센터", color: COLOR.textSubtle, target: ROUTES.support },
];

/** 페이지 맨 아래, 기울어진 글귀가 호를 그리는 띠와 사업자 정보. */
export default function Marquee() {
  const navigate = useSiteNavigate();

  return (
    <>
      <BandArc />

      <div style={outerStyle}>
        <div style={innerStyle}>
          <img
            loading="lazy"
            decoding="async"
            src={marqueeBackground}
            alt=""
            // 띠 바탕은 검정 — 타원 모양만 쓴다.
            style={{
              position: "absolute",
              left: "-2px",
              top: "-40.93px",
              width: "1917px",
              height: "200px",
              display: "block",
              maxWidth: "none",
              filter: "brightness(0)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "-7px",
              top: "65.07px",
              width: "1921px",
              height: "220px",
              background: COLOR.black,
            }}
          />

          {/* 높이 0 인 줄 위에 가운데 맞춤으로 얹고, 각자 제 높낮이만큼 내린다. */}
          <div style={bandRowStyle}>
            {BAND_ITEMS.map(({ text, y, rotate }, index) => (
              <span
                key={index}
                style={{
                  ...(text === "✦" ? starStyle : phraseStyle),
                  flex: "none",
                  transform: `translateY(${y}px) rotate(${rotate}deg)`,
                }}
              >
                {text}
              </span>
            ))}
          </div>

          <div style={legalStyle}>
            <p style={{ margin: 0, lineHeight: 1.55 }}>
              ESCAPE THE LEGEND 및 관련 로고, 캐릭터, 명칭 및 이와 관련된 모든 고유한 표현은 ESCAPE THE LEGEND의 독점
              자산입니다.
            </p>
            <p style={{ margin: 0, lineHeight: 1.55 }}>
              광주광역시 인공지능 사관학교 광주광역시 남구 송암로 60 | 대표자 : Team · Legend | 대표전화 : 000-0000-0000
              | FAX : 000-0000-0000
            </p>
            <p style={{ margin: 0, lineHeight: 1.55 }}>
              사업자등록번호 : 000-00-00000 | 통신판매업신고 : 2026-광주남구-00000
            </p>
          </div>

          <div
            style={{
              position: "absolute",
              left: "851px",
              top: "43.07px",
              display: "flex",
              gap: "12px",
              alignItems: "center",
            }}
          >
            {SOCIAL_ICONS.map(({ id, label, path }) => {
              const href: string = SOCIAL_LINKS[id];
              const icon = (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                  style={{ display: "block" }}
                >
                  <path d={path} stroke={COLOR.accent} strokeWidth="2" strokeLinecap="round" />
                </svg>
              );
              // 주소가 없으면 눌러도 갈 데 없는 링크 대신 표식으로만 둔다.
              return href ? (
                <a
                  key={id}
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`${label} (새 창)`}
                  style={{ ...socialBoxStyle, cursor: "pointer" }}
                >
                  {icon}
                </a>
              ) : (
                <div key={id} style={socialBoxStyle} role="img" aria-label={label}>
                  {icon}
                </div>
              );
            })}
          </div>
        </div>

        <div style={bottomRowStyle}>
          <span style={{ color: COLOR.textSubtle }}>© 2026 ESCAPE THE LEGEND. All Rights Reserved.</span>
          <div style={{ display: "flex", gap: "24px" }}>
            {FOOTER_LINKS.map(({ label, color, target }) => (
              <button key={label} type="button" style={{ ...linkButtonStyle, color }} onClick={() => navigate(target)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

const ARC_WIDTH = 1917;
const ARC_HEIGHT = 100;
const BAND_ARC_HIGHLIGHT = "#f4f4f5";

/**
 * 띠 타원(1917×200)의 윗가장자리 반쪽을 따라가는 은빛 호. DividerArc 와 같은 결로,
 * 번지는 넓은 획 위에 또렷한 가는 획을 얹고 좌우 끝을 어둠 속으로 흐린다.
 */
function BandArc() {
  const id = useId().replace(/:/g, "");
  const gradientId = `band-arc-gradient${id}`;
  const blurId = `band-arc-blur${id}`;
  const d = `M 0 ${ARC_HEIGHT} A ${ARC_WIDTH / 2} ${ARC_HEIGHT} 0 0 1 ${ARC_WIDTH} ${ARC_HEIGHT}`;

  return (
    <svg
      aria-hidden="true"
      width={ARC_WIDTH}
      height={ARC_HEIGHT}
      viewBox={`0 0 ${ARC_WIDTH} ${ARC_HEIGHT}`}
      style={{ position: "absolute", left: "4px", top: "8614px", overflow: "visible", pointerEvents: "none" }}
    >
      <defs>
        {/* userSpaceOnUse — 호의 실제 가로 자리 기준으로 끝을 흐린다. */}
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={ARC_WIDTH} y2="0">
          <stop offset="0%" stopColor={COLOR.arc} stopOpacity="0" />
          <stop offset="13%" stopColor={COLOR.arc} stopOpacity="0.75" />
          <stop offset="50%" stopColor={BAND_ARC_HIGHLIGHT} stopOpacity="1" />
          <stop offset="87%" stopColor={COLOR.arc} stopOpacity="0.75" />
          <stop offset="100%" stopColor={COLOR.arc} stopOpacity="0" />
        </linearGradient>
        <filter id={blurId} x="-5%" y="-40%" width="110%" height="180%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <path
        d={d}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="4.4"
        strokeLinecap="round"
        opacity="0.8"
        filter={`url(#${blurId})`}
      />
      <path d={d} fill="none" stroke={`url(#${gradientId})`} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const outerStyle: CSSProperties = {
  position: "absolute",
  left: "4px",
  top: "8655.93px",
  width: "1908.987px",
  // 사업자 정보 3줄과 아랫줄이 겹치지 않는 높이.
  height: "281px",
  borderTop: "1px solid rgba(26,48,95,0.2)",
  borderBottom: "1px solid rgba(26,48,95,0.2)",
  boxSizing: "border-box",
};

const innerStyle: CSSProperties = {
  position: "absolute",
  left: "2px",
  top: "-1px",
  width: "1915px",
  height: "220px",
  boxSizing: "border-box",
};

// 사이 간격 13px 이 ✦ 와 글자가 붙는 걸 막는다.
const bandRowStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "13px",
};

const phraseStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontWeight: 400,
  fontSize: "16px",
  color: COLOR.navyMuted,
  whiteSpace: "nowrap",
};
const starStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "16px",
  color: COLOR.navyMuted,
  whiteSpace: "nowrap",
};

const legalStyle: CSSProperties = {
  position: "absolute",
  left: "955.49px",
  top: "115.07px",
  transform: "translateX(-50%)",
  width: "1914.999px",
  fontFamily: FONT.reading,
  letterSpacing: "-0.1px",
  fontWeight: 400,
  fontSize: "20px",
  color: COLOR.textSubtle,
  textAlign: "center",
};

const socialBoxStyle: CSSProperties = {
  width: "44px",
  height: "44px",
  borderRadius: "22px",
  background: COLOR.glass,
  border: `1px solid ${COLOR.border}`,
  boxShadow: "0px 0px 8px 0px rgba(46,72,137,0.13)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
};

const bottomRowStyle: CSSProperties = {
  position: "absolute",
  // 띠가 left 4 에서 시작하므로 페이지 기준 좌우가 같아지는 값.
  left: "162px",
  // 띠 아래 테두리에서 24px 띄운다.
  top: "234px",
  width: "1588px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  fontFamily: FONT.mono,
  fontSize: "18px",
  letterSpacing: "1px",
  whiteSpace: "nowrap",
};

// 둘레 글자 모양을 그대로 물려받는다.
const linkButtonStyle: CSSProperties = {
  wordSpacing: "inherit",
  textTransform: "inherit",
  whiteSpace: "inherit",
  cursor: "pointer",
};
