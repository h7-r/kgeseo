import { Link } from "react-router-dom";

import { useAdminMe } from "../auth/adminSession";
import LogoutButton from "../auth/LogoutButton";
import { ADMIN_PATHS } from "../paths";
import { isPreviewActive } from "../preview/usePreview";

interface TopBarProps {
  isMenuOpen: boolean;
  onToggleMenu: () => void;
}

export default function TopBar({ isMenuOpen, onToggleMenu }: TopBarProps) {
  const me = useAdminMe();
  return (
    <header className="adm-topbar">
      <button
        type="button"
        className="adm-topbar__menu adm-button adm-button--ghost"
        aria-expanded={isMenuOpen}
        aria-controls="adm-sidebar"
        onClick={onToggleMenu}
      >
        메뉴
      </button>
      <Link to={ADMIN_PATHS.dashboard} className="adm-brand">
        <span className="adm-brand__mark" aria-hidden="true">
          E
        </span>
        <span className="adm-brand__name">ESCAPE THE LEGEND</span>
        <span className="adm-brand__tag">관리자</span>
      </Link>
      <div className="adm-topbar__end">
        {isPreviewActive() && <span className="adm-badge adm-badge--red">가짜 데이터 미리보기</span>}
        <span className="adm-topbar__who">
          <b>{me.nickname}</b>
          <span className="adm-topbar__role">관리자</span>
        </span>
        <LogoutButton />
      </div>
    </header>
  );
}
