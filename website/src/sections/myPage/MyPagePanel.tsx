import { useState, type CSSProperties } from "react";

import TabBar from "@/components/TabBar";
import { MY_PAGE_TABS, type AccountAction, type MyPageTabId } from "@/data/myPage";
import { FONT } from "@/lib/style";
import { QUERY, ROUTES, launchGame, useSiteNavigate, withQuery } from "@/navigation/routes";
import { downloadJson, exportFileName, exportMyData } from "@/services/account/exportMyData";
import { hasPasswordSignIn } from "@/services/account/meProfile";
import { signOut, useSessionUser } from "@/services/session";
import { COLOR } from "@/styles/tokens";

import { InquiriesTab } from "./InquiriesTab";
import { AccountTab, SubscriptionTab, type ExportState } from "./MyPageTabs";
import PasswordModal from "./PasswordModal";
import ProfileCard, { type ProfileStat } from "./ProfileCard";
import { AchievementsTab, ItemsTab, ProgressGate, ProgressTab } from "./ProgressTabs";
import { useMyInquiries } from "./useMyInquiries";
import { useMyProgress } from "./useMyProgress";

type OpenModal = "password" | null;

interface MyPagePanelProps {
  tab: MyPageTabId;
  top: number;
  onTabChange: (tab: MyPageTabId) => void;
}

/** 마이페이지. 다섯 탭이 같은 껍데기를 쓰고 내용만 바뀐다. 이 구간만 바탕이 #11121a 계열이다. */
export default function MyPagePanel({ tab, top, onTabChange }: MyPagePanelProps) {
  const navigate = useSiteNavigate();
  // 로그인한 사람만 들어오는 화면이다(App 의 문지기).
  const user = useSessionUser();
  const startGame = () => launchGame(navigate);

  // 내 진행 · 업적 · 아이템은 서버의 내 저장본에서 — 계정이 바뀌면 새로 읽는다.
  const { state: progressState, reload: reloadProgress } = useMyProgress(user?.id);
  const progress = progressState.status === "ready" ? progressState.progress : null;
  // 읽는 중에는 숫자 자리에 「—」만(단위 없이)
  const stat = (label: string, value: number | undefined, unit: string): ProfileStat =>
    value === undefined ? [label, "—", ""] : [label, String(value), unit];
  const stats: readonly ProfileStat[] = [
    stat("사건 진행률", progress ? (progress.naju?.percent ?? 0) : undefined, "%"),
    stat("해결한 사건", progress ? (progress.naju?.isCleared ? 1 : 0) : undefined, "건"),
    stat("획득한 배지", progress?.badges.filter((badge) => badge.isEarned).length, "개"),
  ];

  const [openModal, setOpenModal] = useState<OpenModal>(null);
  const closeModal = () => setOpenModal(null);

  // 서버의 내 문의 — 탭을 열 때 받는다(문의 서버, 11/13). 모바일판과 같은 훅
  const myInquiries = useMyInquiries(user?.id, tab === "inquiries");

  // 「내보내기」 — 서버의 내 데이터를 JSON 파일로. 만드는 동안 줄 글이 바뀌고, 실패하면 그 자리에 이유가 남는다
  const [exportState, setExportState] = useState<ExportState>("idle");
  const handleExport = async () => {
    if (exportState === "busy") return;
    setExportState("busy");
    const result = await exportMyData();
    if (!result.ok) {
      setExportState(result.reason);
      return;
    }
    downloadJson(result.data, exportFileName());
    setExportState("idle");
  };

  const handleSignOut = () => {
    signOut();
    navigate(ROUTES.home);
  };

  const handleAccountAction = (action: AccountAction) => {
    if (action === "signOut") handleSignOut();
    else if (action === "changePassword") setOpenModal("password");
    else if (action === "exportData") void handleExport();
  };

  return (
    <section style={{ ...rootStyle, top: `${top}px` }}>
      {user && (
        <ProfileCard
          user={user}
          stats={stats}
          hasProgress={progress ? !progress.isEmpty : false}
          onStart={startGame}
          onSignOut={handleSignOut}
        />
      )}
      <TabBar
        items={MY_PAGE_TABS}
        activeId={tab}
        onSelect={onTabChange}
        style={tabRowStyle}
        activeTabStyle={activeTabStyle}
        inactiveTabStyle={inactiveTabStyle}
      />
      <div style={{ height: "1px", width: "100%", background: "#262933" }} />

      <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}>
        {tab === "inquiries" && (
          <InquiriesTab
            inquiries={myInquiries}
            onWrite={() => navigate(withQuery(ROUTES.support, { [QUERY.tab]: "inquiry" }))}
          />
        )}
        {tab === "account" && (
          <AccountTab
            hasPassword={user ? hasPasswordSignIn(user) : undefined}
            exportState={exportState}
            onAction={handleAccountAction}
          />
        )}
        {tab === "subscription" && <SubscriptionTab />}
        {(tab === "history" || tab === "achievements" || tab === "items") && (
          <ProgressGate state={progressState} onRetry={reloadProgress}>
            {(mine) =>
              tab === "history" ? (
                <ProgressTab progress={mine} onStart={startGame} />
              ) : tab === "achievements" ? (
                <AchievementsTab progress={mine} />
              ) : (
                <ItemsTab progress={mine} />
              )
            }
          </ProgressGate>
        )}
      </div>

      <PasswordModal open={openModal === "password"} onClose={closeModal} user={user} />
    </section>
  );
}

const rootStyle: CSSProperties = {
  position: "absolute",
  left: "172px",
  width: "1577px",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  boxSizing: "border-box",
};

const tabRowStyle: CSSProperties = { display: "flex", gap: "20px", alignItems: "center" };

const tabBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "12px 20px",
  borderRadius: "999px",
  fontFamily: FONT.mono,
  fontSize: "16px",
  whiteSpace: "nowrap",
  cursor: "pointer",
  boxSizing: "border-box",
};
const activeTabStyle: CSSProperties = { ...tabBaseStyle, background: COLOR.navy, color: COLOR.white, fontWeight: 700 };
const inactiveTabStyle: CSSProperties = { ...tabBaseStyle, background: "#1a1c26", color: COLOR.textMuted };
