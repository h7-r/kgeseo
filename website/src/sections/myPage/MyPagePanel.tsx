import { useEffect, useState, type CSSProperties } from "react";

import Modal from "@/components/Modal";
import { modalSecondaryStyle } from "@/components/modalButtonStyles";
import TabBar from "@/components/TabBar";
import { MY_PAGE_CONTENT, MY_PAGE_TABS, type AccountAction, type MyPageTabId } from "@/data/myPage";
import { FONT } from "@/lib/style";
import { ROUTES, launchGame, useSiteNavigate } from "@/navigation/routes";
import AccountTab from "@/sections/myPage/tabs/AccountTab";
import AchievementsTab from "@/sections/myPage/tabs/AchievementsTab";
import HistoryTab from "@/sections/myPage/tabs/HistoryTab";
import ItemsTab from "@/sections/myPage/tabs/ItemsTab";
import SubscriptionTab from "@/sections/myPage/tabs/SubscriptionTab";
import {
  deleteAccount,
  exportMyData,
  getAccountData,
  saveAccountData,
  type AccountData,
} from "@/services/accountStore";
import { signOut, useSessionUser } from "@/services/session";
import { COLOR } from "@/styles/tokens";

import { downloadJson } from "./downloadJson";
import LoginHistoryModal from "./LoginHistoryModal";
import PasswordModal from "./PasswordModal";
import ProfileCard, { type ProfileStats } from "./ProfileCard";
import { modalDangerStyle } from "./styles";

type OpenModal = "password" | "loginHistory" | "deleteAccount" | null;

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

  const records = MY_PAGE_CONTENT.history.records;
  const stats: ProfileStats = {
    solved: records.filter((record) => record.result === "성공").length,
    best: records.map((record) => record.clearTime).sort()[0] ?? "—",
  };

  const [openModal, setOpenModal] = useState<OpenModal>(null);
  const [deleteWarning, setDeleteWarning] = useState("");
  const closeModal = () => {
    setOpenModal(null);
    setDeleteWarning("");
  };

  const [accountData, setAccountData] = useState<AccountData | null>(null);
  useEffect(() => {
    if (!user?.email) return;
    let isActive = true;
    getAccountData(user.email).then((data) => {
      if (isActive) setAccountData(data);
    });
    return () => {
      isActive = false;
    };
  }, [user?.email]);
  const emailNotifications = accountData?.settings?.emailNotifications ?? true;

  const handleSignOut = () => {
    signOut();
    navigate(ROUTES.home);
  };

  const handleAccountAction = async (action: AccountAction) => {
    if (action === "signOut") handleSignOut();
    else if (action === "changePassword") setOpenModal("password");
    else if (action === "loginHistory") setOpenModal("loginHistory");
    else if (action === "deleteAccount") setOpenModal("deleteAccount");
    else if (!user) return;
    else if (action === "emailNotifications") {
      const saved = await saveAccountData(user.email, {
        settings: { ...(accountData?.settings ?? {}), emailNotifications: !emailNotifications },
      });
      setAccountData(saved);
    } else if (action === "exportData") {
      const data = await exportMyData(user.email);
      if (data) downloadJson(data, `escape-legend-내데이터-${new Date().toISOString().slice(0, 10)}.json`);
    }
  };

  // 계정과 그 데이터를 실제로 지운다. 동의 기록은 철회로 남는다. 못 지웠으면 로그인을 유지한 채 까닭을 보여 준다.
  const handleDeleteAccount = async () => {
    if (user?.email) {
      const result = await deleteAccount(user.email);
      if (!result.ok) {
        setDeleteWarning(result.reason);
        return;
      }
    }
    handleSignOut();
  };

  return (
    <section style={{ ...rootStyle, top: `${top}px` }}>
      {user && <ProfileCard user={user} stats={stats} onStart={startGame} onSignOut={handleSignOut} />}
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
        {tab === "history" && <HistoryTab onRetry={startGame} />}
        {tab === "account" && <AccountTab emailNotifications={emailNotifications} onAction={handleAccountAction} />}
        {tab === "subscription" && <SubscriptionTab />}
        {tab === "achievements" && <AchievementsTab />}
        {tab === "items" && <ItemsTab />}
      </div>

      <PasswordModal open={openModal === "password"} onClose={closeModal} user={user} />
      <LoginHistoryModal open={openModal === "loginHistory"} onClose={closeModal} logins={accountData?.logins ?? []} />
      <Modal
        open={openModal === "deleteAccount"}
        onClose={closeModal}
        danger
        title="정말 탈퇴할까요?"
        description="탈퇴하면 플레이 기록과 보유 재화가 모두 사라지며 되돌릴 수 없습니다. (관계 법령에 따라 보관 의무가 있는 기록은 정해진 기간 동안 분리 보관됩니다.)"
      >
        {deleteWarning && (
          <div role="alert" style={warningStyle}>
            {deleteWarning}
          </div>
        )}
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button type="button" className="btn" style={modalSecondaryStyle} onClick={closeModal}>
            <span className="btn__label">취소</span>
          </button>
          <button type="button" className="btn" style={modalDangerStyle} onClick={handleDeleteAccount}>
            <span className="btn__label">탈퇴하기</span>
          </button>
        </div>
      </Modal>
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
const warningStyle: CSSProperties = { fontFamily: FONT.body, fontSize: "15px", color: COLOR.danger };

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
