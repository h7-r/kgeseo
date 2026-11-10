import { Link, Route, Routes } from "react-router-dom";

import AdminLoginPage from "./auth/AdminLoginPage";
import RequireAdmin from "./auth/RequireAdmin";
import { useAdminDocument } from "./lib/useAdminDocument";
import ActivityLogPage from "./pages/ActivityLogPage";
import ContentsPage from "./pages/ContentsPage";
import DashboardPage from "./pages/DashboardPage";
import GameDataPage from "./pages/GameDataPage";
import NoticesPage from "./pages/NoticesPage";
import SettingsPage from "./pages/SettingsPage";
import SubscriptionsPage from "./pages/SubscriptionsPage";
import SupportPage from "./pages/SupportPage";
import TrafficPage from "./pages/TrafficPage";
import UserDetailPage from "./pages/UserDetailPage";
import UsersPage from "./pages/UsersPage";
import UserStatsPage from "./pages/UserStatsPage";
import { ADMIN_PATHS } from "./paths";
import AdminShell from "./shell/AdminShell";
import StatusScreen from "./ui/StatusScreen";

import "./admin.css";

/** /admin 아래 주소를 틀 안의 자식 경로로 바꾼다 — "/admin/traffic" → "traffic" */
const child = (path: string) => path.slice(ADMIN_PATHS.dashboard.length + 1);

/**
 * 관리자 앱. 웹사이트의 머리띠 · 3D 배경 없이 이것만 그린다(App.tsx 가 /admin 에서 갈라 준다).
 * 따로 떼어 늦게 불러오므로 일반 방문자는 이 코드를 받지 않는다.
 */
export default function AdminApp() {
  useAdminDocument();

  return (
    <Routes>
      <Route path={ADMIN_PATHS.login} element={<AdminLoginPage />} />
      <Route
        path={ADMIN_PATHS.dashboard}
        element={
          <RequireAdmin>
            <AdminShell />
          </RequireAdmin>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path={child(ADMIN_PATHS.traffic)} element={<TrafficPage />} />
        <Route path={child(ADMIN_PATHS.users)} element={<UsersPage />} />
        <Route path={`${child(ADMIN_PATHS.users)}/:userId`} element={<UserDetailPage />} />
        <Route path={child(ADMIN_PATHS.userStats)} element={<UserStatsPage />} />
        <Route path={child(ADMIN_PATHS.gameData)} element={<GameDataPage />} />
        <Route path={child(ADMIN_PATHS.activity)} element={<ActivityLogPage />} />
        <Route path={child(ADMIN_PATHS.notices)} element={<NoticesPage />} />
        <Route path={child(ADMIN_PATHS.contents)} element={<ContentsPage />} />
        <Route path={child(ADMIN_PATHS.support)} element={<SupportPage />} />
        <Route path={child(ADMIN_PATHS.subscriptions)} element={<SubscriptionsPage />} />
        <Route path={child(ADMIN_PATHS.settings)} element={<SettingsPage />} />
        <Route
          path="*"
          element={
            <StatusScreen
              kind="notFound"
              title="없는 관리자 화면입니다"
              action={
                <Link to={ADMIN_PATHS.dashboard} className="adm-button adm-button--primary">
                  대시보드로
                </Link>
              }
            />
          }
        />
      </Route>
    </Routes>
  );
}
