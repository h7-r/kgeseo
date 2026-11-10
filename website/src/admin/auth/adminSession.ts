import { createContext, useContext } from "react";

import type { AdminMe } from "../api/session";

/** 권한 검사를 통과한 관리자. RequireAdmin 안에서만 값이 있다. */
export const AdminSessionContext = createContext<AdminMe | null>(null);

export function useAdminMe(): AdminMe {
  const me = useContext(AdminSessionContext);
  if (!me) throw new Error("useAdminMe 는 RequireAdmin 안에서만 쓴다.");
  return me;
}
