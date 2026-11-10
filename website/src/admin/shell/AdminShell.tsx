import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { menuItemFor } from "./menu";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

/** 상단바 + 사이드바 + 본문. 좁은 화면(1280px 아래)에서는 사이드바를 접어 「메뉴」 단추로 연다. */
export default function AdminShell() {
  const { pathname } = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const label = menuItemFor(pathname)?.label ?? "관리자";
    document.title = `${label} · 관리자 · ESCAPE THE LEGEND`;
  }, [pathname]);

  return (
    <div className="adm-shell">
      <a href="#adm-main" className="adm-skip">
        본문으로 건너뛰기
      </a>
      <TopBar isMenuOpen={isMenuOpen} onToggleMenu={() => setIsMenuOpen((value) => !value)} />
      <Sidebar isOpen={isMenuOpen} onNavigate={() => setIsMenuOpen(false)} />
      <main id="adm-main" className="adm-main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
