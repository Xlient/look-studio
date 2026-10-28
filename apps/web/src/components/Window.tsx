import type { ReactNode } from "react";

export type WindowFlavor = "blueberry" | "tangerine" | "grape" | "lime";

interface WindowProps {
  id: string;
  title: string;
  icon: string;
  flavor: WindowFlavor;
  className?: string;
  status?: ReactNode;
  children: ReactNode;
}

export default function Window({ id, title, icon, flavor, className, status, children }: WindowProps) {
  const titleId = `${id}-title`;
  return (
    <section className={`win win--${flavor} ${className ?? ""}`} aria-labelledby={titleId}>
      <header className="win__bar">
        <span className="win__icon" aria-hidden="true">
          {icon}
        </span>
        <h2 className="win__title" id={titleId}>
          {title}
        </h2>
        <span className="win__controls" aria-hidden="true">
          <span className="win__ctl">_</span>
          <span className="win__ctl">□</span>
          <span className="win__ctl win__ctl--close">×</span>
        </span>
      </header>
      <div className="win__body">{children}</div>
      {status !== undefined && <footer className="win__status">{status}</footer>}
    </section>
  );
}
