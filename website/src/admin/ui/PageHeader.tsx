import type { ReactNode } from "react";

import { useCurrentScreen } from "../screenContext";

interface PageHeaderProps {
  /** 제목이 데이터일 때만(회원 상세의 닉네임). 보통은 화면 설정의 이름을 쓴다. */
  title?: string;
  actions?: ReactNode;
}

export default function PageHeader({ title, actions }: PageHeaderProps) {
  const screen = useCurrentScreen();
  return (
    <header className="adm-page-head">
      <div>
        <h1 className="adm-page-head__title">{title ?? screen.label}</h1>
        <p className="adm-page-head__desc">{screen.description}</p>
      </div>
      {actions && <div className="adm-page-head__actions">{actions}</div>}
    </header>
  );
}
