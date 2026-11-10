import type { ReactNode } from "react";

import { ADMIN_ROLE, fetchMe } from "../api/session";
import { useAdminResource } from "../api/useAdminResource";
import StatusScreen from "../ui/StatusScreen";
import { AdminSessionContext } from "./adminSession";
import LogoutButton from "./LogoutButton";
import ResourceView from "./ResourceView";

/**
 * 관리자 화면에 들어올 때마다 서버 /me 로 역할을 다시 묻는다.
 * 웹 세션(sessionStorage)은 화면용 표시일 뿐이라 여기서 보지 않는다. 진짜 막는 것은 서버 API 의 권한 검사다.
 */
export default function RequireAdmin({ children }: { children: ReactNode }) {
  const [resource, retry] = useAdminResource("me", fetchMe);

  if (resource.status === "ready" && resource.data.role === ADMIN_ROLE) {
    return <AdminSessionContext value={resource.data}>{children}</AdminSessionContext>;
  }

  return (
    <main className="adm-gate">
      <ResourceView resource={resource} retry={retry} loadingText="관리자 권한을 확인하고 있습니다">
        {(me) => (
          <StatusScreen
            kind="forbidden"
            title="관리자 권한이 없는 계정입니다"
            description={`${me.nickname} 계정으로 로그인돼 있습니다. 관리자 계정으로 다시 로그인해 주세요.`}
            action={<LogoutButton variant="primary" />}
          />
        )}
      </ResourceView>
    </main>
  );
}
