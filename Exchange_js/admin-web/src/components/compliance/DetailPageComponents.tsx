import type { ReactNode } from 'react';
import { ArrowLeft, Check, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { adminButtonClass } from '../common/adminButtonStyles';

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  const text = String(value).trim();
  return text === '' ? '-' : text;
};

export const DetailPageHeader = ({
  title,
  subtitle,
  onBack,
  onRefresh,
  refreshing = false,
  backLabel = 'Back',
  children,
}: {
  title: string;
  subtitle?: string | null;
  onBack: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
  backLabel?: string;
  children?: ReactNode;
}) => (
  <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className={adminButtonClass('detailUtility')}
          >
            <ArrowLeft size={16} />
            {backLabel}
          </button>
          <button
            onClick={onRefresh}
            className={adminButtonClass('detailUtility')}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {subtitle ? <p className="mt-1 font-mono text-sm text-gray-500">{subtitle}</p> : null}
        </div>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  </div>
);

export const DetailCard = ({
  title,
  icon,
  description,
  children,
  columns = 3,
}: {
  title: string;
  icon?: ReactNode;
  description?: string;
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
      {description ? <p className="mb-4 text-sm text-gray-500">{description}</p> : null}
      <div className={gridClassName}>{children}</div>
    </div>
  );
};

export const InfoField = ({
  label,
  value,
  mono = false,
  accent = false,
  highlight = false,
  emptyLabel = '-',
  copyable = false,
  copied = false,
  isCopied = false,
  onCopy,
  link,
  source: _source,
  icon,
}: {
  label: string;
  value: unknown;
  mono?: boolean;
  accent?: boolean;
  highlight?: boolean;
  emptyLabel?: string;
  copyable?: boolean;
  copied?: boolean;
  isCopied?: boolean;
  onCopy?: (value: string) => void;
  link?: string;
  source?: 'main' | 'kyc' | 'edd';
  icon?: ReactNode;
}) => {
  const normalized = formatValue(value);
  const hasValue = normalized !== '-';
  const displayValue = hasValue ? normalized : emptyLabel;
  const showCopied = copied || isCopied;

  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div
        className={`mt-1 flex items-center gap-2 break-all text-sm ${
          accent || highlight ? 'font-semibold text-brand-primary' : 'text-gray-900'
        } ${mono ? 'font-mono' : ''}`}
      >
        {icon ? <span className="text-gray-400">{icon}</span> : null}
        {link && hasValue ? (
          <a
            href={link}
            target={link.startsWith('/') ? undefined : '_blank'}
            rel={link.startsWith('/') ? undefined : 'noopener noreferrer'}
            className="inline-flex items-center gap-1 hover:text-blue-600"
          >
            {displayValue}
            <ExternalLink size={12} />
          </a>
        ) : (
          <span>{displayValue}</span>
        )}
        {copyable && hasValue && onCopy ? (
          <button
            onClick={() => onCopy(normalized)}
            className="shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-brand-primary"
            title="Copy to clipboard"
          >
            {showCopied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
          </button>
        ) : null}
      </div>
    </div>
  );
};

export const JsonBlock = ({
  title,
  value,
  compact = false,
}: {
  title: string;
  value: unknown;
  compact?: boolean;
}) => (
  <div className="min-w-0">
    <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">{title}</div>
    <pre
      className={`overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100 ${
        compact ? 'max-h-56' : 'max-h-96'
      }`}
    >
      {typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)}
    </pre>
  </div>
);

export const ActionSection = ({
  title,
  description,
  emptyText,
  children,
}: {
  title: string;
  description?: string;
  emptyText?: string;
  children?: ReactNode;
}) => (
  <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
    <div className="mb-4">
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      {description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}
    </div>
    {children ? children : <div className="text-sm text-gray-500">{emptyText || '-'}</div>}
  </div>
);
