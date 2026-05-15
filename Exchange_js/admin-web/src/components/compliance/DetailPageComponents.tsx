import type { ReactNode } from 'react';
import { ArrowLeft, Check, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { adminButtonClass } from '../common/adminButtonStyles';

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  const text = String(value).trim();
  return text === '' ? '-' : text;
};

/* ── Detail Page Header ──────────────────────────────────────── */
export const DetailPageHeader = ({
  title,
  subtitle,
  onBack,
  onRefresh,
  refreshing = false,
  backLabel = 'Back',
  children,
}: {
  title?: string;
  subtitle?: string | null;
  onBack: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
  backLabel?: string;
  children?: ReactNode;
}) => (
  <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className={adminButtonClass('detailUtility')}>
            <ArrowLeft size={14} />
            {backLabel}
          </button>
          <button onClick={onRefresh} className={adminButtonClass('detailUtility')}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        {(title || subtitle) ? (
          <div>
            {title ? (
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-adm-t3">
                {title}
              </div>
            ) : null}
            {subtitle ? (
              <div className="mt-1 font-mono text-lg font-semibold text-adm-amber">
                {subtitle}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  </div>
);

/* ── Detail Card ──────────────────────────────────────────────── */
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
  const gridCls =
    columns === 1
      ? 'grid grid-cols-1 gap-4'
      : columns === 2
        ? 'grid grid-cols-1 gap-4 md:grid-cols-2'
        : 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3';

  return (
    <div className="overflow-hidden rounded-lg border border-adm-border bg-adm-panel shadow-sm">
      {/* Card header bar */}
      <div className="flex items-center gap-2 border-b border-adm-border bg-adm-card px-4 py-2.5">
        {icon ? <span className="text-adm-t3">{icon}</span> : null}
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
          {title}
        </span>
      </div>
      {/* Card body */}
      <div className="p-4">
        {description ? (
          <p className="mb-4 font-mono text-[11px] text-adm-t3">{description}</p>
        ) : null}
        <div className={gridCls}>{children}</div>
      </div>
    </div>
  );
};

/* ── Info Field ───────────────────────────────────────────────── */
export const InfoField = ({
  label,
  value,
  mono = false,
  accent = false,
  highlight = false,
  emptyLabel = '—',
  copyable = false,
  /** @deprecated use isCopied */
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

  const valueCls = [
    'mt-1 flex items-center gap-2 break-all',
    mono || accent || highlight ? 'font-mono text-[11px]' : 'text-[13px]',
    accent || highlight ? 'font-semibold text-adm-amber' : hasValue ? 'text-adm-t1' : 'text-adm-t3',
  ].join(' ');

  return (
    <div className="min-w-0">
      {/* Label */}
      <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">{label}</div>
      {/* Value */}
      <div className={valueCls}>
        {icon ? <span className="text-adm-t3">{icon}</span> : null}
        {link && hasValue ? (
          <a
            href={link}
            target={link.startsWith('/') ? undefined : '_blank'}
            rel={link.startsWith('/') ? undefined : 'noopener noreferrer'}
            className="inline-flex items-center gap-1 text-adm-amber hover:opacity-75"
          >
            {displayValue}
            <ExternalLink size={11} />
          </a>
        ) : (
          <span>{displayValue}</span>
        )}
        {copyable && hasValue && onCopy ? (
          <button
            onClick={() => onCopy(normalized)}
            className="shrink-0 rounded p-0.5 text-adm-t3 transition-colors hover:bg-adm-hover hover:text-adm-amber"
            title="Copy"
          >
            {showCopied ? <Check size={12} className="text-adm-green" /> : <Copy size={12} />}
          </button>
        ) : null}
      </div>
    </div>
  );
};

/* ── Json Block ───────────────────────────────────────────────── */
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
    <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
      {title}
    </div>
    <pre
      className={`overflow-auto rounded bg-gray-900 p-3 font-mono text-[11px] text-gray-100 ${
        compact ? 'max-h-56' : 'max-h-96'
      }`}
    >
      {typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)}
    </pre>
  </div>
);

/* ── Action Section ───────────────────────────────────────────── */
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
  <div className="overflow-hidden rounded-lg border border-adm-border bg-adm-panel shadow-sm">
    <div className="flex items-center gap-2 border-b border-adm-border bg-adm-card px-4 py-2.5">
      <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
        {title}
      </span>
    </div>
    <div className="p-4">
      {description ? (
        <p className="mb-3 font-mono text-[11px] text-adm-t3">{description}</p>
      ) : null}
      {children ?? (
        <div className="font-mono text-[11px] text-adm-t3">{emptyText ?? '—'}</div>
      )}
    </div>
  </div>
);
