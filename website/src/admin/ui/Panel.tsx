import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  /** 제목 오른쪽의 단위 · 기간(예: "1분 단위") */
  meta?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** 제목이 붙은 흰 카드. 그래프 · 표를 담는다. */
export default function Panel({ title, meta, actions, children }: PanelProps) {
  return (
    <section className="adm-panel" aria-label={title}>
      <header className="adm-panel__head">
        <h2 className="adm-panel__title">{title}</h2>
        {meta && <span className="adm-panel__meta">{meta}</span>}
        {actions && <div className="adm-panel__actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
