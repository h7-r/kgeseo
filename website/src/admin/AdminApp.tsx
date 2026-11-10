import { Link, Route, Routes } from "react-router-dom";

import AdminLoginPage from "./auth/AdminLoginPage";
import RequireAdmin from "./auth/RequireAdmin";
import { useAdminDocument } from "./lib/useAdminDocument";
import { ADMIN_PATHS } from "./paths";
import { adminScreenRoutes } from "./routes";
import AdminShell from "./shell/AdminShell";
import StatusScreen from "./ui/StatusScreen";

import "./admin.css";

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
        {adminScreenRoutes()}
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
