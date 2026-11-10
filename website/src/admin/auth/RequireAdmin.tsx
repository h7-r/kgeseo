import type { ReactNode } from "react";

import { ADMIN_ROLE, fetchMe } from "../api/session";
import { useAdminResource } from "../api/useAdminResource";
import AdminTitle from "../ui/AdminTitle";
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

  // 틀(AdminShell) 밖이라 탭 제목을 여기서 정한다. 로그인으로 보낼 때는 로그인 화면이 정한다.
  const gateLabel =
    resource.status === "loading" || (resource.status === "error" && resource.error.kind === "unauthenticated")
      ? undefined
      : resource.status === "ready" || resource.error.kind === "forbidden"
        ? "권한 없음"
        : "연결 오류";

  return (
    <main className="adm-gate">
      <AdminTitle label={gateLabel} />
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
