/**
 * 앱 안 브라우저(카카오톡 등) 안내 + 주소 복사 — 게임 시작 안내와 로그인 · 가입 화면이 함께 쓴다(코덱스 구현 06회차).
 * UA 판별은 보조 신호다: 잡히면 노란 경고로 펼쳐 두고, 못 잡아도 접힌 도움말로 늘 열 수 있게 둔다.
 * 복사는 실제 탭 안에서 clipboard 로, 성공했을 때만 「복사했습니다」. 실패하면 주소를 골라 복사할 수 있게 보여 준다.
 * 복사하는 주소는 로그인부터 다시 시작하는 주소다 — 소셜 로그인 증표(state · 온보딩)는 브라우저를 옮기면 이어지지 않는다.
 */
import { useState, type CSSProperties } from "react";

import { FONT } from "@/lib/style";
import { QUERY, ROUTES, withQuery } from "@/navigation/routes";
import { COLOR } from "@/styles/tokens";

import { looksLikeInAppBrowser } from "./gameStartStore";
import { cardStyle, secondaryButtonStyle } from "./mobileStyles";

export default function InAppNotice() {
  const isInApp = looksLikeInAppBrowser();
  const [isOpen, setIsOpen] = useState(isInApp);
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  const restartUrl = `${window.location.origin}${withQuery(ROUTES.login, { [QUERY.next]: ROUTES.play })}`;

  const copy = () => {
    if (!navigator.clipboard?.writeText) {
      setCopyState("failed");
      return;
    }
    navigator.clipboard.writeText(restartUrl).then(
      () => setCopyState("done"),
      () => setCopyState("failed"),
    );
  };

  if (!isOpen) {
    return (
      <button type="button" style={helpLinkStyle} onClick={() => setIsOpen(true)}>
        카카오톡 등 앱 안에서 열었나요?
      </button>
    );
  }
  return (
    <div style={{ ...cardStyle, padding: 14, borderColor: isInApp ? COLOR.warning : COLOR.border }}>
      <p style={{ ...noteStyle, color: isInApp ? COLOR.warning : COLOR.textMuted }}>
        {isInApp
          ? "앱 안 브라우저(카카오톡 등)에서는 전체 화면 · 소리 · 간편 로그인이 막힐 수 있습니다. 메뉴에서 「다른 브라우저로 열기」 또는 비슷한 항목을 골라 주세요."
          : "카카오톡 등 앱 안에서 열었다면, 메뉴의 「다른 브라우저로 열기」로 Safari · Chrome에서 열어 주세요."}
      </p>
      <button type="button" style={{ ...secondaryButtonStyle, minHeight: 44, marginTop: 10 }} onClick={copy}>
        {copyState === "done" ? "주소를 복사했습니다" : "다른 브라우저에 붙여 넣을 주소 복사"}
      </button>
      {copyState === "failed" && (
        <input readOnly value={restartUrl} style={addressStyle} onFocus={(event) => event.currentTarget.select()} />
      )}
    </div>
  );
}

const noteStyle: CSSProperties = { margin: 0, fontFamily: FONT.body, fontSize: "14px", lineHeight: 1.55 };

const helpLinkStyle: CSSProperties = {
  minHeight: 40,
  fontFamily: FONT.body,
  fontSize: "13px",
  color: COLOR.accent,
  textDecoration: "underline",
  cursor: "pointer",
};

const addressStyle: CSSProperties = {
  width: "100%",
  marginTop: 8,
  height: 44,
  padding: "0 12px",
  boxSizing: "border-box",
  borderRadius: 10,
  border: `1px solid ${COLOR.border}`,
  background: COLOR.bg,
  color: COLOR.textBright,
  fontSize: "16px",
};
