import { useEffect, useState, type CSSProperties } from "react";

import TabBar from "@/components/TabBar";
import { MY_PAGE_TABS, type AccountAction, type MyPageTabId } from "@/data/myPage";
import { FONT } from "@/lib/style";
import { QUERY, ROUTES, launchGame, useSiteNavigate, withQuery } from "@/navigation/routes";
import type { AccountData } from "@/services/account/db";
import { exportMyData, readAccountData, writeAccountData } from "@/services/account/manageAccount";
import { fetchMyInquiries, type MyInquiry } from "@/services/inquiries";
import { signOut, useSessionUser } from "@/services/session";
import { COLOR } from "@/styles/tokens";

import { InquiriesTab } from "./InquiriesTab";
import { AccountTab, SubscriptionTab } from "./MyPageTabs";
import PasswordModal from "./PasswordModal";
import ProfileCard, { type ProfileStat } from "./ProfileCard";
import { AchievementsTab, ItemsTab, ProgressGate, ProgressTab } from "./ProgressTabs";
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

  const [accountData, setAccountData] = useState<AccountData | null>(null);
  useEffect(() => {
    if (!user?.email) return;
    let isActive = true;
    readAccountData(user.email).then((data) => {
      if (isActive) setAccountData(data);
    });
    return () => {
      isActive = false;
    };
  }, [user?.email]);
  const emailNotifications = accountData?.settings?.emailNotifications ?? true;
  // 서버의 내 문의 — 탭을 열 때 받는다(문의 서버, 11/13). 로그아웃하면 비운다
  // 받은 결과에 「누구 · 몇 번째 열기」표식을 붙여 둔다 — 표식이 다르면 아직 받는 중으로 본다(효과 안에서 바로 setState 하지 않게)
  const inquiriesKey = `${user?.id ?? ""}:${tab === "inquiries" ? "open" : "closed"}`;
  const [loadedInquiries, setLoadedInquiries] = useState<{ key: string; items: MyInquiry[] | null } | null>(null);
  useEffect(() => {
    if (!user?.id || tab !== "inquiries") return;
    const controller = new AbortController();
    fetchMyInquiries(controller.signal).then((items) => {
      if (!controller.signal.aborted) setLoadedInquiries({ key: inquiriesKey, items });
    });
    return () => controller.abort();
  }, [user?.id, tab, inquiriesKey]);
  const myInquiries: MyInquiry[] | null | "loading" =
    loadedInquiries?.key === inquiriesKey ? loadedInquiries.items : "loading";

  const handleSignOut = () => {
    signOut();
    navigate(ROUTES.home);
  };

  const handleAccountAction = async (action: AccountAction) => {
    if (action === "signOut") handleSignOut();
    else if (action === "changePassword") setOpenModal("password");
    else if (!user) return;
    else if (action === "emailNotifications") {
      const saved = await writeAccountData(user.email, {
        settings: { ...(accountData?.settings ?? {}), emailNotifications: !emailNotifications },
      });
      setAccountData(saved);
    } else if (action === "exportData") {
      const data = await exportMyData(user.email);
      if (data) downloadJson(data, `escape-legend-내데이터-${new Date().toISOString().slice(0, 10)}.json`);
    }
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
            legacy={accountData?.inquiries ?? []}
            onWrite={() => navigate(withQuery(ROUTES.support, { [QUERY.tab]: "inquiry" }))}
          />
        )}
        {tab === "account" && <AccountTab emailNotifications={emailNotifications} onAction={handleAccountAction} />}
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

// 비밀번호 변경 창의 경고와 같은 모양

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

/** 비밀번호 해시를 뺀 내 데이터를 JSON 파일로 내려받는다. */
function downloadJson(data: unknown, fileName: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
  // 문서에 붙였다 떼야 download 파일 이름이 먹는 브라우저가 있다.
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
