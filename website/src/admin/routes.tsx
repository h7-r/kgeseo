import { Route } from "react-router-dom";

import ActivityLogPage from "./pages/ActivityLogPage";
import BetaLogPage from "./pages/BetaLogPage";
import ContentsPage from "./pages/ContentsPage";
import DashboardPage, { StatsScopeTabs } from "./pages/DashboardPage";
import GameDataPage, { GameDataRangeTabs } from "./pages/GameDataPage";
import NoticesPage, { NoticeWriteButton } from "./pages/NoticesPage";
import SecurityPage from "./pages/SecurityPage";
import SettingsPage from "./pages/SettingsPage";
import SupportPage from "./pages/SupportPage";
import TrafficPage, { TrafficRangeTabs } from "./pages/TrafficPage";
import UserDetailPage from "./pages/UserDetailPage";
import UsersPage from "./pages/UsersPage";
import UserStatsPage, { MemberStatsRangeTabs } from "./pages/UserStatsPage";
import ScreenRoute, { type ScreenView } from "./screen/ScreenRoute";
import { ADMIN_SCREENS, type ScreenId } from "./screens";

/** 화면 설정(screens.ts)의 각 화면에 그릴 코드를 붙인다. 화면을 늘리면 두 곳(설정 · 여기)만 고친다. */
const SCREEN_VIEWS: Record<ScreenId, ScreenView> = {
  dashboard: { Component: DashboardPage, HeaderActions: StatsScopeTabs },
  betaLog: { Component: BetaLogPage },
  traffic: { Component: TrafficPage, HeaderActions: TrafficRangeTabs },
  users: { Component: UsersPage },
  userDetail: { Component: UserDetailPage },
  userStats: { Component: UserStatsPage, HeaderActions: MemberStatsRangeTabs },
  gameData: { Component: GameDataPage, HeaderActions: GameDataRangeTabs },
  activity: { Component: ActivityLogPage },
  security: { Component: SecurityPage },
  notices: { Component: NoticesPage, HeaderActions: NoticeWriteButton },
  contents: { Component: ContentsPage },
  support: { Component: SupportPage },
  settings: { Component: SettingsPage },
};

/** 틀(RequireAdmin + AdminShell) 아래에 둘 화면 라우트. 경로는 관리자 첫 주소에 대한 상대 경로다. */
export function adminScreenRoutes() {
  return ADMIN_SCREENS.map((screen) => {
    const element = <ScreenRoute screen={screen} view={SCREEN_VIEWS[screen.id]} />;
    return screen.path === "" ? (
      <Route key={screen.id} index element={element} />
    ) : (
      <Route key={screen.id} path={screen.path} element={element} />
    );
  });
}
