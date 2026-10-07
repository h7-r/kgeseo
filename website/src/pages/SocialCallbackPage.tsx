import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { FONT } from "@/lib/style";
import { ROUTES } from "@/navigation/routes";
import { signInWithNaverCallback } from "@/services/account/naverAuth";
import { signIn } from "@/services/session";

const CHECKING_MESSAGE = "Naver 로그인 확인 중…";

/** 네이버 인가 화면에서 돌아오는 자리. 백엔드 확인이 끝나면 로그인하고 홈으로 간다. */
export default function SocialCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState(CHECKING_MESSAGE);

  useEffect(() => {
    let alive = true;
    signInWithNaverCallback(searchParams)
      .then((user) => {
        if (!alive) return;
        signIn(user);
        navigate(ROUTES.home, { replace: true });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setMessage((error instanceof Error && error.message) || "Naver 로그인에 실패했습니다.");
      });
    return () => {
      alive = false;
    };
  }, [searchParams, navigate]);

  return (
    <main style={frameStyle}>
      <section style={boxStyle}>
        <h1 style={titleStyle}>로그인</h1>
        <p style={bodyStyle}>{message}</p>
        {message !== CHECKING_MESSAGE && (
          <button type="button" style={buttonStyle} onClick={() => navigate(ROUTES.login, { replace: true })}>
            로그인으로 돌아가기
          </button>
        )}
      </section>
    </main>
  );
}

const frameStyle: CSSProperties = {
  minHeight: "70vh",
  display: "grid",
  placeItems: "center",
  padding: "140px 24px 80px",
  boxSizing: "border-box",
};

const boxStyle: CSSProperties = {
  width: "min(460px, 100%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "18px",
  textAlign: "center",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.display,
  fontSize: "34px",
  color: "#f1f1fc",
};

const bodyStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.body,
  fontSize: "18px",
  lineHeight: 1.6,
  color: "#96a3b6",
};

const buttonStyle: CSSProperties = {
  border: "1px solid rgba(111,134,191,0.55)",
  borderRadius: "999px",
  padding: "12px 20px",
  background: "rgba(50,82,150,0.14)",
  color: "#f1f1fc",
  fontFamily: FONT.mono,
  fontSize: "15px",
  cursor: "pointer",
};
