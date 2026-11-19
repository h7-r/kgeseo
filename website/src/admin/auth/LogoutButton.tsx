import { useNavigate } from "react-router-dom";

import { logout } from "../api/session";
import { ADMIN_PATHS } from "../paths";

export default function LogoutButton({ variant = "ghost" }: { variant?: "ghost" | "primary" }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className={`adm-button adm-button--${variant}`}
      onClick={() => {
        logout();
        navigate(ADMIN_PATHS.login, { replace: true });
      }}
    >
      로그아웃
    </button>
  );
}
