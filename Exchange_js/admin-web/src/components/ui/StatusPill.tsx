// admin-web/src/components/ui/StatusPill.tsx
//
// Shared trading-domain status pill. Matches the deposit/withdraw/payin/payout
// list+detail badge exactly (rounded-full, Tailwind 100/800 palette) so all
// five trading pages (deposit/withdraw/swap/internal-transaction/settlement)
// render an identical status badge instead of the older dot-style AdminBadge.
import { formatStatusLabel } from '../../utils/transactionRootDisplay';

// Union of statuses emitted across the 5 trading pages + funds layer. Colours
// reuse the same palette as getDepositStatusBadgeClass / getWithdrawStatusBadgeClass.
const STATUS_PILL_MAP: Record<string, string> = {
  // positive / done
  SUCCESS: 'bg-green-100 text-green-800',
  DONE: 'bg-green-100 text-green-800',
  APPROVED: 'bg-green-100 text-green-800',
  CLEARED: 'bg-green-100 text-green-800',
  CLEAR: 'bg-green-100 text-green-800',
  PASS: 'bg-green-100 text-green-800',
  CONFIRMED: 'bg-indigo-100 text-indigo-800',
  // in-flight / pending
  CREATED: 'bg-gray-100 text-gray-800',
  PENDING: 'bg-blue-100 text-blue-800',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
  PENDING_COMPLIANCE: 'bg-purple-100 text-purple-800',
  COMPLIANCE_PENDING: 'bg-purple-100 text-purple-800',
  ACTION_PENDING: 'bg-amber-100 text-amber-800',
  PAYIN_PENDING: 'bg-blue-100 text-blue-800',
  PAYOUT_PENDING: 'bg-blue-100 text-blue-800',
  PROCESSING: 'bg-blue-100 text-blue-800',
  INTERNAL_FUNDS_PENDING: 'bg-blue-100 text-blue-800',
  SIGNING: 'bg-amber-100 text-amber-800',
  BROADCASTED: 'bg-blue-100 text-blue-800',
  CONFIRMING: 'bg-amber-100 text-amber-800',
  DETECTED: 'bg-blue-100 text-blue-800',
  // negative / terminal
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-red-100 text-red-800',
  RETURNED: 'bg-red-100 text-red-800',
  FAIL: 'bg-red-100 text-red-800',
  FAILED: 'bg-orange-100 text-orange-800',
  TIMEOUT: 'bg-orange-100 text-orange-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
  FROZEN: 'bg-cyan-100 text-cyan-800',
};

export function statusPillClass(status: string): string {
  return STATUS_PILL_MAP[status.toUpperCase()] || 'bg-gray-100 text-gray-800';
}

/**
 * Trading-domain status badge — the single status badge for all 5 trading
 * list + detail pages. `sm` (default) for list cells / sidebar KVs / sub-tables,
 * `md` for hero chips. One component, two sizes — no per-page badge variants.
 */
export const StatusPill = ({
  value,
  size = 'sm',
}: {
  value: string | null | undefined;
  size?: 'sm' | 'md';
}) => {
  if (!value) return <span className="text-adm-t3">—</span>;
  const sizeCls =
    size === 'md'
      ? 'px-3 py-0.5 text-xs font-medium'
      : 'px-2.5 py-0.5 text-[10px] font-semibold';
  return (
    <span
      className={`inline-flex items-center rounded-full ${sizeCls} ${statusPillClass(value)}`}
    >
      {formatStatusLabel(value)}
    </span>
  );
};
