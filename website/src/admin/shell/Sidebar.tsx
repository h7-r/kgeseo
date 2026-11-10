import { NavLink } from "react-router-dom";

import { ADMIN_MENU } from "./menu";

export default function Sidebar({ isOpen, onNavigate }: { isOpen: boolean; onNavigate: () => void }) {
  return (
    <nav id="adm-sidebar" className={isOpen ? "adm-sidebar is-open" : "adm-sidebar"} aria-label="관리자 메뉴">
      <p className="adm-sidebar__heading">메뉴</p>
      <ul className="adm-sidebar__list">
        {ADMIN_MENU.map(({ screen, href }) => (
          <li key={screen.id}>
            <NavLink
              to={href}
              end={screen.path === ""}
              className={({ isActive }) => (isActive ? "adm-nav is-active" : "adm-nav")}
              onClick={onNavigate}
            >
              <span>{screen.label}</span>
              {screen.status === "pending" && <span className="adm-nav__tag">준비 중</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
