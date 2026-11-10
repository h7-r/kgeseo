import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import type { Resource } from "../api/useAdminResource";
import { adminLoginPath } from "../paths";
import AdminTitle from "../ui/AdminTitle";
import StatusScreen from "../ui/StatusScreen";
import LogoutButton from "./LogoutButton";

interface ResourceViewProps<T> {
  resource: Resource<T>;
  retry: () => void;
  loadingText: string;
  notFoundText?: string;
  children: (data: T) => ReactNode;
}

/**
 * 서버 값 하나를 기다렸다 그린다. 실패하면 까닭에 맞는 화면을 고른다.
 * 세션이 끊겼으면(401) 보던 주소를 들고 로그인으로 보낸다.
 */
export default function ResourceView<T>({
  resource,
  retry,
  loadingText,
  notFoundText,
  children,
}: ResourceViewProps<T>) {
  const location = useLocation();

  if (resource.status === "loading") return <StatusScreen kind="loading" title={loadingText} compact />;
  if (resource.status === "ready") return children(resource.data);

  switch (resource.error.kind) {
    case "unauthenticated":
      return <Navigate to={adminLoginPath(location.pathname + location.search)} replace />;
    case "forbidden":
      return (
        <>
          <AdminTitle label="권한 없음" />
          <StatusScreen
            kind="forbidden"
            title="관리자 권한이 없습니다"
            description="관리자 권한이 해제됐을 수 있습니다. 다른 계정으로 로그인해 주세요."
            action={<LogoutButton variant="primary" />}
          />
        </>
      );
    case "notFound":
      return <StatusScreen kind="notFound" title={notFoundText ?? "찾는 항목이 없습니다"} />;
    default:
      return (
        <StatusScreen
          kind="error"
          title={resource.error.kind === "offline" ? "서버에 연결할 수 없습니다" : "서버 오류가 났습니다"}
          description={
            resource.error.status ? `오류 ${resource.error.status}` : "인터넷 연결이나 서버 상태를 확인해 주세요."
          }
          action={
            <button type="button" className="adm-button adm-button--primary" onClick={retry}>
              다시 시도
            </button>
          }
        />
      );
  }
}
