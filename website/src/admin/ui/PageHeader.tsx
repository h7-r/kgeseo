import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export default function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="adm-page-head">
      <div>
        <h1 className="adm-page-head__title">{title}</h1>
        {description && <p className="adm-page-head__desc">{description}</p>}
      </div>
      {actions && <div className="adm-page-head__actions">{actions}</div>}
    </header>
  );
}
