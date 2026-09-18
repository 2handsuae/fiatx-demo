import type { ReactNode } from 'react';

/* ── Sidebar shared primitives ──────────────────────────────────
   Used across detail pages for the right-hand sidebar.
   Import from here — do NOT duplicate page-locally.
   ─────────────────────────────────────────────────────────────── */

export const SidebarGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-b border-adm-border py-4 last:border-b-0">
    <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
      {title}
    </p>
    <div className="mt-2.5 flex flex-col gap-1.5">{children}</div>
  </div>
);

export const SidebarKV = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) => {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">{label}</span>
      <span
        className={[
          'min-w-0 break-all text-right text-adm-t2',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
};
