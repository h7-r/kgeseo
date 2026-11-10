import { NavLink } from "react-router-dom";

import { ADMIN_PATHS } from "../paths";
import { ADMIN_MENU } from "./menu";

export default function Sidebar({ isOpen, onNavigate }: { isOpen: boolean; onNavigate: () => void }) {
  return (
    <nav id="adm-sidebar" className={isOpen ? "adm-sidebar is-open" : "adm-sidebar"} aria-label="관리자 메뉴">
      <p className="adm-sidebar__heading">메뉴</p>
      <ul className="adm-sidebar__list">
        {ADMIN_MENU.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              end={item.path === ADMIN_PATHS.dashboard}
              className={({ isActive }) => (isActive ? "adm-nav is-active" : "adm-nav")}
              onClick={onNavigate}
            >
              <span>{item.label}</span>
              {item.status === "pending" && <span className="adm-nav__tag">준비 중</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
