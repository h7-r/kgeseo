import { useState, type CSSProperties } from "react";

import googleIcon from "@/assets/images/imgComponent12.svg";
import { FONT } from "@/lib/style";
import { startSocialLogin } from "@/services/socialLogin";
import { COLOR } from "@/styles/tokens";

/** 키(.env)가 없으면 창을 띄우지 않고 그 자리에서 까닭을 알려 준다. */
export default function SocialLogin() {
  const [message, setMessage] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "center", width: "100%" }}>
      <div style={{ display: "flex", gap: "12px", alignItems: "center", justifyContent: "center" }}>
        <button
          type="button"
          className="btn"
          style={{ ...socialButtonStyle, background: COLOR.white }}
          onClick={() => setMessage(startSocialLogin("google"))}
          title="Google 로 로그인"
        >
          <img
            loading="lazy"
            decoding="async"
            src={googleIcon}
            alt="Google"
            style={{ width: "18px", height: "18px", display: "block" }}
          />
        </button>
        <button
          type="button"
          className="btn"
          style={{ ...socialButtonStyle, background: "#03c75a", borderColor: "#03c75a" }}
          onClick={() => setMessage(startSocialLogin("naver"))}
          title="네이버로 로그인"
        >
          <span style={naverMarkStyle}>N</span>
        </button>
      </div>
      {message && (
        <span style={{ fontFamily: FONT.mono, fontSize: "15px", color: COLOR.textMuted, textAlign: "center" }}>
          {message}
        </span>
      )}
    </div>
  );
}

const socialButtonStyle: CSSProperties = {
  width: "44px",
  height: "44px",
  borderRadius: "22px",
  border: "1px solid rgba(50,82,150,0.18)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  boxSizing: "border-box",
};
// 네이버 표식은 초록 바탕에 흰 굵은 N 이 공식 모양이다.
const naverMarkStyle: CSSProperties = {
  fontFamily: "'Inter', system-ui, sans-serif",
  fontWeight: 800,
  fontSize: "19px",
  lineHeight: 1,
  color: COLOR.white,
  letterSpacing: "-0.5px",
  transform: "translateY(-0.5px)",
};
