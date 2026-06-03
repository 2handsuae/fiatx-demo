// src/components/ui/PageTitleBar.tsx
import type { ReactNode } from 'react';

interface PageTitleBarProps {
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  children?: ReactNode;
}

export const PageTitleBar = ({ title, subtitle, meta, children }: PageTitleBarProps) => (
  <div className="flex shrink-0 items-start justify-between border-b border-adm-border bg-adm-panel px-5 py-3.5">
    <div className="flex flex-col gap-1">
      <h1 className="text-[15px] font-semibold leading-none tracking-tight text-adm-t1">
        {title}
      </h1>
      {subtitle ? (
        <p className="text-[11px] text-adm-t3">{subtitle}</p>
      ) : null}
      {meta ? (
        <p className="font-mono text-[10px] text-adm-t3">{meta}</p>
      ) : null}
    </div>
    {children ? (
      <div className="flex items-center gap-2">{children}</div>
    ) : null}
  </div>
);
