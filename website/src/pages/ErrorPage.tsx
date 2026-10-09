import { useEffect, useState, type CSSProperties } from "react";

import Stage from "@/components/Stage";
import PageFooter from "@/layout/PageFooter";
import { FONT, gradientText } from "@/lib/style";
import { QUERY, ROUTES, useSiteNavigate, withQuery, type RoutePath } from "@/navigation/routes";
import { COLOR, GRADIENT, SHADOW } from "@/styles/tokens";

type ErrorKind = "404" | "403" | "500" | "503" | "offline";

/** path 가 없으면 새로고침한다. */
interface ErrorAction {
  label: string;
  path?: RoutePath;
}

interface ErrorScreen {
  code: string;
  title: string;
  description: string;
  primary: ErrorAction;
  secondary?: Required<ErrorAction>;
}

/*
 * 막히는 상황을 모두 한 틀로 그린다. 상황마다 화면을 따로 만들면 말투와 돌아갈 길이 제각각이 된다.
 * 무슨 일인지 · 왜인지 · 다음에 뭘 하면 되는지를 담고, 조사관 말투를 쓰되 상황은 분명히 말한다.
 */
const ERROR_SCREENS: Record<ErrorKind, ErrorScreen> = {
  "404": {
    code: "404",
    title: "미션 경로를 찾을 수 없습니다",
    description: "이 구역은 잠겨 있거나 존재하지 않는 경로입니다. 주소를 다시 확인해 주세요.",
    primary: { label: "본부로 복귀하기", path: ROUTES.home },
  },
  "403": {
    code: "403",
    title: "조사관 인증이 필요합니다",
    description: "이 구역은 등록된 조사관만 들어갈 수 있습니다. 로그인한 뒤 다시 시도해 주세요.",
    primary: { label: "로그인하러 가기", path: ROUTES.login },
    secondary: { label: "아직 계정이 없다면 회원가입", path: ROUTES.signup },
  },
  "500": {
    code: "500",
    title: "본부와 연결이 끊겼습니다",
    description: "서버에서 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요. 계속된다면 고객센터로 알려 주세요.",
    primary: { label: "다시 시도하기" },
    secondary: { label: "고객센터에 알리기", path: ROUTES.support },
  },
  "503": {
    code: "503",
    title: "점검 중입니다",
    description: "더 나은 탐험을 위해 잠시 문을 닫았습니다. 점검이 끝나면 바로 열립니다.",
    primary: { label: "공지 확인하기", path: ROUTES.support },
  },
  offline: {
    code: "﹖",
    title: "인터넷에 연결되어 있지 않습니다",
    description: "네트워크 연결을 확인한 뒤 다시 시도해 주세요. 연결되면 이 화면이 저절로 사라집니다.",
    primary: { label: "다시 시도하기" },
  },
};

interface ErrorPageProps {
  kind?: ErrorKind;
}

export default function ErrorPage({ kind = "404" }: ErrorPageProps) {
  const navigate = useSiteNavigate();
  const screen = ERROR_SCREENS[kind];
  const { secondary } = screen;

  // 인터넷이 돌아오면 새로고침을 떠올리지 않아도 되게 알려 준다.
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    if (kind !== "offline") return;
    const handleOnline = () => setIsOnline(true);
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [kind]);

  const handlePrimary = () => {
    const { path } = screen.primary;
    if (!path) window.location.reload();
    // 로그인한 뒤 지금 이 화면으로 돌아오게 한다.
    else if (kind === "403") navigate(withQuery(path, { [QUERY.next]: decodeURIComponent(window.location.pathname) }));
    else navigate(path);
  };

  return (
    <Stage height={900}>
      <div style={centerStyle}>
        <div style={codeStyle}>{screen.code}</div>
        <div style={{ fontFamily: FONT.display, fontSize: "48px", color: COLOR.textBright, whiteSpace: "nowrap" }}>
          {screen.title}
        </div>
        <div style={descriptionStyle}>{screen.description}</div>

        {kind === "offline" && isOnline && (
          <div style={{ fontFamily: FONT.mono, fontSize: "16px", color: COLOR.success }}>
            연결이 돌아왔습니다. 다시 시도해 주세요.
          </div>
        )}

        <div>
          <button type="button" className="button" style={primaryButtonStyle} onClick={handlePrimary}>
            <span className="button__label">{screen.primary.label}</span>
          </button>
        </div>

        <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
          <button type="button" className="text-link" style={linkButtonStyle} onClick={() => window.history.back()}>
            이전 구역으로 돌아가기
          </button>
          {secondary && (
            <>
              <span style={{ color: COLOR.accent }}>·</span>
              <button
                type="button"
                className="text-link"
                style={linkButtonStyle}
                onClick={() => navigate(secondary.path)}
              >
                {secondary.label}
              </button>
            </>
          )}
        </div>
      </div>
      <PageFooter />
    </Stage>
  );
}

// top: 50% 는 내용 높이에 맞춰 줄어드는 무대 높이와 서로 물려 위로 말려 올라간다. 좌표로 못 박는다.
const centerStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "240px",
  transform: "translateX(-50%)",
  width: "760px",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
  alignItems: "center",
};

const codeStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontSize: "160px",
  lineHeight: 1,
  letterSpacing: "4px",
  ...gradientText(GRADIENT.titleNavy),
};

const descriptionStyle: CSSProperties = {
  fontFamily: FONT.reading,
  fontWeight: 400,
  fontSize: "18px",
  lineHeight: 1.75,
  color: COLOR.textMuted,
  textAlign: "center",
  maxWidth: "620px",
};

const primaryButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "14px 36px",
  borderRadius: "100px",
  backgroundImage: GRADIENT.pillButton("140deg"),
  boxShadow: SHADOW.pillGlow,
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "18px",
  color: COLOR.white,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const linkButtonStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "16px",
  color: COLOR.textSubtle,
  cursor: "pointer",
};
