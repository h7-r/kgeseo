import { useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { MY_PAGE_CONTENT, type AccountAction } from "@/data/myPage";
import { FONT } from "@/lib/style";
import { QUERY, ROUTES, useSiteNavigate, withQuery } from "@/navigation/routes";
import PasswordModal from "@/sections/myPage/PasswordModal";
import WithdrawModal from "@/sections/myPage/WithdrawModal";
import { WITHDRAWN_STATE } from "@/sections/myPage/withdrawnState";
import { downloadJson, exportFileName, exportMyData } from "@/services/account/exportMyData";
import { hasPasswordSignIn } from "@/services/account/meProfile";
import { clearResetState } from "@/services/passwordReset";
import { endLocalSession, signOut, useSessionUser } from "@/services/session";
import { COLOR } from "@/styles/tokens";

import { cardStyle } from "./mobileStyles";

/**
 * 휴대폰 계정 설정 — 데스크톱과 같은 항목 · 같은 창(비밀번호 변경 · 회원 탈퇴)을 쓴다.
 * 전에는 로그아웃까지 모든 줄이 「준비 중」이었다(11/20 점검). 서버가 없는 항목(2단계 인증 등)만 「준비 중」으로 남는다.
 */
export default function MobileAccountSettings() {
  const navigate = useSiteNavigate();
  // 라우터 state(작별 안내 표시)를 함께 넘길 때만 쓴다
  const navigateWithState = useNavigate();
  const user = useSessionUser();
  const hasPassword = user ? hasPasswordSignIn(user) : undefined;
  const [openModal, setOpenModal] = useState<"password" | "withdraw" | null>(null);
  const [exportNote, setExportNote] = useState("");

  const handleExport = async () => {
    if (exportNote === "만드는 중…") return;
    setExportNote("만드는 중…");
    const result = await exportMyData();
    if (!result.ok) {
      setExportNote(result.reason);
      return;
    }
    downloadJson(result.data, exportFileName());
    setExportNote("");
  };

  const run = (action: AccountAction) => {
    if (action === "signOut") {
      void signOut();
      navigate(ROUTES.home);
    } else if (action === "changePassword") setOpenModal("password");
    else if (action === "withdraw") setOpenModal("withdraw");
    else if (action === "requestByInquiry") navigate(withQuery(ROUTES.support, { [QUERY.tab]: "inquiry" }));
    else if (action === "exportData") void handleExport();
  };

  return (
    <>
      {MY_PAGE_CONTENT.account.groups.map((group) => (
        <section key={group.title}>
          <h2 style={groupTitleStyle}>{group.title}</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {group.items.map((item) => {
              // 소셜 전용 계정에는 바꿀 비밀번호가 없다
              const isSocialOnlyPassword = item.action === "changePassword" && hasPassword === false;
              const action = isSocialOnlyPassword ? undefined : item.action;
              const value = action === "exportData" && exportNote ? exportNote : item.value;
              return action ? (
                <button key={item.label} type="button" style={rowStyle} onClick={() => run(action)}>
                  <span style={labelStyle}>{item.label}</span>
                  <span style={{ ...valueStyle, color: action === "withdraw" ? "#fca5a5" : "#9aabd8" }}>{value} →</span>
                </button>
              ) : (
                <div key={item.label} style={{ ...rowStyle, cursor: "default", opacity: 0.72 }}>
                  <span style={labelStyle}>{item.label}</span>
                  <span style={{ ...valueStyle, color: COLOR.textDim }}>
                    {isSocialOnlyPassword ? "소셜 로그인 · 비밀번호 없음" : "준비 중"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <PasswordModal open={openModal === "password"} onClose={() => setOpenModal(null)} user={user} />
      <WithdrawModal
        open={openModal === "withdraw"}
        hasPassword={hasPassword}
        user={user}
        onClose={() => setOpenModal(null)}
        onWithdrawn={() => {
          setOpenModal(null);
          navigateWithState(ROUTES.home, { state: WITHDRAWN_STATE });
          clearResetState();
          endLocalSession();
        }}
      />
    </>
  );
}

const groupTitleStyle: CSSProperties = {
  margin: "24px 0 10px",
  fontFamily: FONT.mono,
  fontSize: "13px",
  letterSpacing: "1px",
  color: COLOR.accent,
};

const rowStyle: CSSProperties = {
  ...cardStyle,
  width: "100%",
  minHeight: 52,
  padding: "12px 16px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  textAlign: "left",
  cursor: "pointer",
};

const labelStyle: CSSProperties = { fontFamily: FONT.body, fontSize: "15px", color: COLOR.textBright };
const valueStyle: CSSProperties = { fontFamily: FONT.mono, fontSize: "13px", flexShrink: 0 };
