import { isValidElement, type ReactNode } from 'react';
import { formatValue, toPrettyJson } from './governanceUtils';

const DEFAULT_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-800',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  SUPERSEDED: 'bg-slate-100 text-slate-800',
  ARCHIVED: 'bg-gray-100 text-gray-700',
  PLANNED: 'bg-amber-100 text-amber-800',
  ENDED: 'bg-slate-100 text-slate-800',
  CANCELLED: 'bg-rose-100 text-rose-800',
  ASSIGNED: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  OVERDUE: 'bg-rose-100 text-rose-800',
  WAIVED: 'bg-slate-100 text-slate-800',
  OPEN: 'bg-rose-100 text-rose-800',
  UNDER_REVIEW: 'bg-amber-100 text-amber-800',
  MITIGATED: 'bg-blue-100 text-blue-800',
  CLOSED: 'bg-emerald-100 text-emerald-800',
  REQUIRED: 'bg-amber-100 text-amber-800',
  SUBMITTED: 'bg-blue-100 text-blue-800',
  ACCEPTED: 'bg-emerald-100 text-emerald-800',
  RETURNED: 'bg-amber-100 text-amber-800',
  REJECTED: 'bg-rose-100 text-rose-800',
  PENDING: 'bg-amber-100 text-amber-800',
  BOUND: 'bg-emerald-100 text-emerald-800',
  REPLACED: 'bg-blue-100 text-blue-800',
  BLOCKED: 'bg-rose-100 text-rose-800',
  READY: 'bg-amber-100 text-amber-800',
  EFFECTIVE: 'bg-emerald-100 text-emerald-800',
  REVOKED: 'bg-slate-100 text-slate-800',
  NOT_REQUIRED: 'bg-gray-100 text-gray-700',
  APPROVED: 'bg-emerald-100 text-emerald-800',
};

export const StatusBadge = ({
  value,
  colors,
}: {
  value?: string | null;
  colors?: Record<string, string>;
}) => {
  const normalized = String(value || '').trim().toUpperCase();
  const palette = colors || DEFAULT_STATUS_COLORS;
  const className = palette[normalized] || 'bg-gray-100 text-gray-700';
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${className}`}>
      {formatValue(value)}
    </span>
  );
};

export const DetailCard = ({
  title,
  icon,
  children,
  columns = 3,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) => {
  const gridClassName =
    columns === 1
      ? 'grid grid-cols-1 gap-4'
      : columns === 2
        ? 'grid grid-cols-1 gap-4 md:grid-cols-2'
        : 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3';

  return (
    <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        {icon ? <div className="text-brand-primary">{icon}</div> : null}
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      </div>
      <div className={gridClassName}>{children}</div>
    </div>
  );
};

export const InfoField = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) => (
  <div className="min-w-0">
    <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
    <div className={`mt-1 break-all text-sm text-gray-900 ${mono ? 'font-mono' : ''}`}>
      {isValidElement(value) ? value : formatValue(value)}
    </div>
  </div>
);

export const JsonBlock = ({ title, value }: { title: string; value: unknown }) => (
  <div className="min-w-0">
    <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">{title}</div>
    <pre className="max-h-96 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
      {toPrettyJson(value)}
    </pre>
  </div>
);

export const ActionCard = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) => (
  <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
    <div className="mb-4">
      <h2 className="text-base font-bold text-gray-900">{title}</h2>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
    </div>
    <div className="space-y-4">{children}</div>
  </div>
);
