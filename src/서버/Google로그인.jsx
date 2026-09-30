import { useEffect, useRef, useState } from "react";

import { Google로그인 as Google로그인요청 } from "./api.js";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const CLIENT_ID설정됨 = CLIENT_ID && CLIENT_ID !== "YOUR_GOOGLE_CLIENT_ID";

export default function Google로그인() {
  const 버튼자리 = useRef(null);
  const [사용자, set사용자] = useState(null);
  const [상태, set상태] = useState(CLIENT_ID설정됨 ? "Google 준비 중" : "Client ID 필요");

  useEffect(() => {
    if (!CLIENT_ID설정됨) return undefined;

    let 취소됨 = false;
    let 시도 = 0;
    const 타이머 = window.setInterval(() => {
      시도 += 1;
      const accounts = window.google?.accounts?.id;
      if (!accounts) {
        if (시도 >= 100) {
          window.clearInterval(타이머);
          if (!취소됨) set상태("Google 스크립트 실패");
        }
        return;
      }

      window.clearInterval(타이머);
      if (취소됨 || !버튼자리.current) return;

      accounts.initialize({
        client_id: CLIENT_ID,
        callback: async (응답) => {
          if (!응답.credential) {
            set상태("Google credential 없음");
            return;
          }
          set상태("Backend 검증 중");
          try {
            set사용자(await Google로그인요청(응답.credential));
            set상태("로그인됨");
          } catch (오류) {
            set상태(`로그인 실패${오류.status ? ` (${오류.status})` : ""}`);
          }
        },
      });
      버튼자리.current.replaceChildren();
      accounts.renderButton(버튼자리.current, {
        type: "standard",
        theme: "outline",
        size: "medium",
        text: "signin_with",
        shape: "rectangular",
        width: 220,
      });
      set상태("로그인 대기");
    }, 100);

    return () => {
      취소됨 = true;
      window.clearInterval(타이머);
    };
  }, []);

  const 로그아웃 = () => {
    window.google?.accounts?.id?.disableAutoSelect();
    set사용자(null);
    set상태("로그인 대기");
  };

  return (
    <aside style={스타일.패널} aria-label="개발용 Google 로그인">
      <strong style={스타일.제목}>Google Login PoC</strong>
      {사용자 ? (
        <>
          <div style={스타일.프로필}>
            {사용자.picture && (
              <img src={사용자.picture} alt="" referrerPolicy="no-referrer" style={스타일.사진} />
            )}
            <div style={스타일.사용자글}>
              <span style={스타일.이름}>{사용자.name || "Google 사용자"}</span>
              <span style={스타일.이메일}>{사용자.email}</span>
            </div>
          </div>
          <button type="button" style={스타일.버튼} onClick={로그아웃}>
            로그아웃
          </button>
        </>
      ) : (
        <div ref={버튼자리} style={스타일.Google버튼} />
      )}
      <span style={스타일.상태}>{상태}</span>
    </aside>
  );
}

const 스타일 = {
  패널: {
    position: "fixed",
    top: 132,
    right: 12,
    zIndex: 90,
    width: 240,
    padding: "10px",
    border: "1px solid rgba(225,232,242,.28)",
    borderRadius: 6,
    background: "rgba(15,19,25,.9)",
    color: "#edf2f7",
    font: "12px/1.35 system-ui, sans-serif",
    boxShadow: "0 4px 16px rgba(0,0,0,.25)",
  },
  제목: { display: "block", marginBottom: 8, fontSize: 12 },
  Google버튼: { minHeight: 32 },
  프로필: { display: "flex", gap: 8, alignItems: "center", minWidth: 0 },
  사진: { width: 34, height: 34, borderRadius: "50%", objectFit: "cover" },
  사용자글: { display: "flex", flexDirection: "column", minWidth: 0 },
  이름: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  이메일: { color: "#aeb8c7", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  상태: { display: "block", marginTop: 7, color: "#aeb8c7" },
  버튼: {
    width: "100%",
    marginTop: 8,
    padding: "5px 7px",
    border: "1px solid rgba(225,232,242,.22)",
    borderRadius: 4,
    background: "#252c37",
    color: "#edf2f7",
    cursor: "pointer",
  },
};
