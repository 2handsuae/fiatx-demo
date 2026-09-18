// src/components/ui/LinkedRelationCard.tsx
//
// Shared card used by detail pages to express a 1:1 relationship
// between a subject and its governance artifact (and vice versa).
//
// Design rule: relationships are CONTENT, not actions. This card
// always lives in the left main area of a detail page, never in a
// sidebar action block.

import type { ReactNode } from 'react';
import { Link2 } from 'lucide-react';
import { AdminBadge } from './AdminBadge';

export const LinkedRelationCard = ({
  cap,
  identifier,
  statusValue,
  secondaryStatus,
  meta,
  onClick,
  disabled = false,
}: {
  /** Top micro-label, e.g. "Audit Evidence Package" */
  cap: string;
  /** Amber, mono, semibold identifier such as packageNo / ticketNo / approvalNo */
  identifier: string;
  /** Primary status badge value — omit to hide the badge */
  statusValue?: string | null;
  /** Optional secondary badge, e.g. execution status on an approval */
  secondaryStatus?: string | null;
  /** Optional single-line subtitle shown under the identifier */
  meta?: ReactNode;
  /** Click handler. If omitted, the card is non-interactive */
  onClick?: () => void;
  /** Explicitly mark the card as non-clickable (e.g. awaiting linkage) */
  disabled?: boolean;
}) => {
  const clickable = !!onClick && !disabled;
  const base =
    'flex items-start justify-between gap-3 rounded border border-adm-border bg-adm-bg px-4 py-2.5 text-left transition-colors';
  const interactive = clickable
    ? 'cursor-pointer hover:border-adm-bhi hover:bg-adm-hover'
    : 'cursor-default';

  const body = (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-adm-t3">
        {cap}
      </span>
      <span className="truncate font-mono text-[13px] font-semibold leading-tight text-adm-amber">
        {identifier}
      </span>
      {meta && (
        <span className="truncate font-mono text-[10px] text-adm-t3">{meta}</span>
      )}
    </div>
  );

  const badges = (statusValue || secondaryStatus || clickable) && (
    <div className="flex shrink-0 items-center gap-2">
      {statusValue     && <AdminBadge value={statusValue} />}
      {secondaryStatus && <AdminBadge value={secondaryStatus} />}
      {clickable && <Link2 size={13} className="text-adm-t3" />}
    </div>
  );

  if (clickable) {
    return (
      <button type="button" onClick={onClick} className={`${base} ${interactive}`}>
        {body}
        {badges}
      </button>
    );
  }
  return (
    <div className={`${base} ${interactive}`}>
      {body}
      {badges}
    </div>
  );
};

/**
 * Empty placeholder shown in the same slot as LinkedRelationCard
 * when the relationship does not yet exist (e.g. a DRAFT subject
 * that has not been submitted for approval yet).
 */
export const LinkedRelationEmpty = ({
  cap,
  message,
}: {
  cap: string;
  message: string;
}) => (
  <div className="rounded border border-dashed border-adm-border bg-adm-bg px-4 py-3">
    <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-adm-t3">
      {cap}
    </p>
    <p className="mt-1 font-mono text-[11px] text-adm-t3">{message}</p>
  </div>
);
