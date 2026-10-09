/** (?dev) Google 로그인 PoC. env `VITE_GOOGLE_CLIENT_ID` 가 있어야 버튼이 뜬다. */
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { BackendError, signInWithGoogle, type GoogleUser } from "./api";

/** Google Identity Services 중 여기서 쓰는 것만 */
interface GoogleAccountsId {
  initialize(config: { client_id: string; callback: (response: { credential?: string }) => void }): void;
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

const CLIENT_ID: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const IS_CLIENT_ID_SET = !!CLIENT_ID && CLIENT_ID !== "YOUR_GOOGLE_CLIENT_ID";

export default function GoogleSignIn() {
  const buttonSlotRef = useRef<HTMLDivElement>(null);
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [status, setStatus] = useState(IS_CLIENT_ID_SET ? "Google 준비 중" : "Client ID 필요");

  useEffect(() => {
    if (!IS_CLIENT_ID_SET || !CLIENT_ID) return undefined;

    let isCancelled = false;
    let attempts = 0;
    // Google 스크립트가 비동기로 붙으므로 100ms 마다 최대 10초 기다린다.
    const timer = window.setInterval(() => {
      attempts += 1;
      const accounts = window.google?.accounts?.id;
      if (!accounts) {
        if (attempts >= 100) {
          window.clearInterval(timer);
          if (!isCancelled) setStatus("Google 스크립트 실패");
        }
        return;
      }

      window.clearInterval(timer);
      if (isCancelled || !buttonSlotRef.current) return;

      accounts.initialize({
        client_id: CLIENT_ID,
        callback: async (response) => {
          if (!response.credential) {
            setStatus("Google credential 없음");
            return;
          }
          setStatus("Backend 검증 중");
          try {
            setUser(await signInWithGoogle(response.credential));
            setStatus("로그인됨");
          } catch (error) {
            const code = error instanceof BackendError ? error.status : null;
            setStatus(`로그인 실패${code ? ` (${code})` : ""}`);
          }
        },
      });
      buttonSlotRef.current.replaceChildren();
      accounts.renderButton(buttonSlotRef.current, {
        type: "standard",
        theme: "outline",
        size: "medium",
        text: "signin_with",
        shape: "rectangular",
        width: 220,
      });
      setStatus("로그인 대기");
    }, 100);

    return () => {
      isCancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const handleSignOut = () => {
    window.google?.accounts?.id?.disableAutoSelect();
    setUser(null);
    setStatus("로그인 대기");
  };

  return (
    <aside style={panelStyle} aria-label="개발용 Google 로그인">
      <strong style={titleStyle}>Google Login PoC</strong>
      {user ? (
        <>
          <div style={profileStyle}>
            {user.picture && <img src={user.picture} alt="" referrerPolicy="no-referrer" style={avatarStyle} />}
            <div style={userTextStyle}>
              <span style={nameStyle}>{user.name || "Google 사용자"}</span>
              <span style={emailStyle}>{user.email}</span>
            </div>
          </div>
          <button type="button" style={buttonStyle} onClick={handleSignOut}>
            로그아웃
          </button>
        </>
      ) : (
        <div ref={buttonSlotRef} style={googleButtonStyle} />
      )}
      <span style={statusStyle}>{status}</span>
    </aside>
  );
}

const panelStyle: CSSProperties = {
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
};
const titleStyle: CSSProperties = { display: "block", marginBottom: 8, fontSize: 12 };
const googleButtonStyle: CSSProperties = { minHeight: 32 };
const profileStyle: CSSProperties = { display: "flex", gap: 8, alignItems: "center", minWidth: 0 };
const avatarStyle: CSSProperties = { width: 34, height: 34, borderRadius: "50%", objectFit: "cover" };
const userTextStyle: CSSProperties = { display: "flex", flexDirection: "column", minWidth: 0 };
const nameStyle: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const emailStyle: CSSProperties = {
  color: "#aeb8c7",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const statusStyle: CSSProperties = { display: "block", marginTop: 7, color: "#aeb8c7" };
const buttonStyle: CSSProperties = {
  width: "100%",
  marginTop: 8,
  padding: "5px 7px",
  border: "1px solid rgba(225,232,242,.22)",
  borderRadius: 4,
  background: "#252c37",
  color: "#edf2f7",
  cursor: "pointer",
};
