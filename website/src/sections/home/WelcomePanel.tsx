import { useEffect, useState, type CSSProperties } from "react";

import { glossStyle } from "@/components/form/styles";
import { FONT } from "@/lib/style";
import { ROUTES, START_GAME, useSiteNavigate } from "@/navigation/routes";
import { signOut, type SessionUser } from "@/services/session";
import { COLOR } from "@/styles/tokens";

import { signupPanelStyle, primaryButtonStyle, primaryLabelStyle } from "./quickSignupStyles";

interface WelcomePanelProps {
  user: SessionUser;
}

/** 1729 같은 밀리초를 2026.09.30 로. */
function formatJoinDate(joinedAt: number | undefined): string {
  if (!joinedAt) return "—";
  return new Date(joinedAt)
    .toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })
    .replace(/\s/g, "")
    .replace(/\.$/, "");
}

/**
 * 로그인한 뒤 가입폼 자리에 뜨는 판. 항목이 0.16초 간격으로 차례로 떠오른다.
 * is-active 를 한 프레임 뒤에 붙여야 처음(투명) 상태가 한 번 그려지고 전환이 일어난다.
 */
export default function WelcomePanel({ user }: WelcomePanelProps) {
  const navigate = useSiteNavigate();
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsActive(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const infoItems = [
    ["나의 지역", user.region || "미정"],
    ["첫 번째 사건", "나주 · 앙암바위"],
    ["합류한 날", formatJoinDate(user.joinedAt)],
  ];

  return (
    <div
      style={{ ...signupPanelStyle, display: "flex", flexDirection: "column", justifyContent: "center", gap: "24px" }}
      className={`stagger${isActive ? " is-active" : ""}`}
    >
      {/* 모노의 넓은 자간이 한글에 걸리면 글자가 흩어져 보여 영문만 모노로 쓴다. */}
      <div className="stagger-item" style={welcomeHeaderStyle}>
        <span style={onlineDotStyle} aria-hidden="true" />
        <span style={{ fontFamily: FONT.mono, letterSpacing: "2px" }}>WELCOME BACK</span>
        <span style={headerDividerStyle} aria-hidden="true" />
        <span style={{ fontFamily: FONT.body, letterSpacing: 0, color: "#8fa0c4" }}>접속 중</span>
        {user.isTest && <span style={testBadgeStyle}>테스트 계정</span>}
      </div>

      <div className="stagger-item stagger-1" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={greetingStyle}>환영합니다,</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px", minWidth: 0 }}>
          <span style={nameStyle} title={user.name}>
            {user.name}
          </span>
          <span style={honorificStyle}>님</span>
        </div>
      </div>

      {/* 판 폭에서 어중간하게 꺾이지 않게 뜻 단위로 직접 줄을 나눈다. */}
      <p className="stagger-item stagger-1" style={{ ...welcomeTextStyle, whiteSpace: "nowrap" }}>
        전설 속에 봉인된 첫 번째 사건이 조사관님을
        <br />
        기다리고 있습니다. 지역의 단서를 모아 봉인을 풀고,
        <br />
        잊혀진 이야기를 되찾아 주세요.
      </p>

      <div className="stagger-item stagger-2" style={infoCardStyle}>
        {infoItems.map(([label, value], i) => (
          <div key={label} style={{ ...infoCellStyle, ...(i ? { borderLeft: "1px solid rgba(50,82,150,0.22)" } : {}) }}>
            <span style={infoLabelStyle}>{label}</span>
            <span style={infoValueStyle}>{value}</span>
          </div>
        ))}
      </div>

      <div className="stagger-item stagger-3">
        <button
          type="button"
          className="btn btn-sweep"
          style={{ ...primaryButtonStyle, cursor: "pointer", wordSpacing: "inherit" }}
          onClick={() => navigate(START_GAME)}
        >
          <div style={glossStyle} />
          <span className="btn__label" style={{ position: "relative", ...primaryLabelStyle }}>
            모험 시작하기
          </span>
        </button>

        {/* 모노는 한글 띄어쓰기가 넓어 본문 글꼴을 쓴다. */}
        <div style={welcomeLinksStyle}>
          <button type="button" className="link" style={textLinkStyle} onClick={() => navigate(ROUTES.myPage)}>
            마이페이지에서 기록 보기 →
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className="link"
            style={{ ...textLinkStyle, color: COLOR.textSubtle }}
            onClick={signOut}
          >
            로그아웃
          </button>
        </div>
      </div>
    </div>
  );
}

const welcomeHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  fontSize: "14px",
  color: COLOR.accent,
};
// 모노 가운뎃점은 한 칸을 크게 먹어 가는 세로선으로 나눈다.
const headerDividerStyle: CSSProperties = { width: "1px", height: "12px", background: "rgba(111,134,191,0.45)" };
const onlineDotStyle: CSSProperties = {
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  background: "#34d399",
  boxShadow: "0 0 10px rgba(52,211,153,0.7)",
};
const testBadgeStyle: CSSProperties = {
  marginLeft: "4px",
  padding: "3px 8px",
  borderRadius: "6px",
  border: "1px solid rgba(251,191,36,0.45)",
  color: COLOR.warning,
  fontSize: "12px",
  letterSpacing: "0.4px",
};
const greetingStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 500,
  fontSize: "30px",
  lineHeight: 1.3,
  color: "#c9d2ee",
  letterSpacing: "-0.3px",
};
// 닉네임과 「님」은 본문 글꼴 하나로 — 표제 글꼴은 영문 전용이라 한글이 대체 글꼴로 떨어진다.
const nameStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 700,
  fontSize: "64px",
  lineHeight: 1.05,
  letterSpacing: "-0.5px",
  backgroundImage: "linear-gradient(115deg, #f1f1fc 0%, #c9d2ee 35%, #7f95cf 70%, #4f6cb0 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
};
// 한글은 같은 px 에서도 영문보다 글자 몸이 커서 작게 두어야 윗선이 맞는다.
const honorificStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 600,
  fontSize: "44px",
  lineHeight: 1.05,
  color: "#8fa0c4",
  flexShrink: 0,
};
const welcomeTextStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.body,
  fontWeight: 400,
  fontSize: "19px",
  lineHeight: 1.75,
  color: "#aab4c6",
  letterSpacing: "-0.2px",
};
const infoCardStyle: CSSProperties = {
  display: "flex",
  borderRadius: "14px",
  border: `1px solid ${COLOR.border}`,
  background: "rgba(5,11,26,0.72)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
};
const infoCellStyle: CSSProperties = {
  flex: "1 0 0",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  padding: "16px 20px",
  minWidth: 0,
};
const infoLabelStyle: CSSProperties = { fontFamily: FONT.body, fontWeight: 500, fontSize: "13px", color: "#7b879b" };
const infoValueStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 700,
  fontSize: "19px",
  lineHeight: 1.3,
  color: COLOR.textBright,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const welcomeLinksStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: "14px",
  marginTop: "20px",
  fontFamily: FONT.body,
  fontSize: "15px",
  color: COLOR.textDim,
};
const textLinkStyle: CSSProperties = {
  color: "#9fb2ea",
  cursor: "pointer",
};
