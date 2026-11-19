import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { adminTitle } from "../lib/documentTitle";
import { menuLabelFor } from "../paths";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

/** 상단바 + 사이드바 + 본문. 좁은 화면(1280px 아래)에서는 사이드바를 접어 「메뉴」 단추로 연다. */
export default function AdminShell() {
  const { pathname } = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    // 모르는 주소면 화면 이름 없이 「관리자」만 둔다.
    document.title = adminTitle(menuLabelFor(pathname));
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
