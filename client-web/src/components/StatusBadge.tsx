// client-web/src/components/StatusBadge.tsx

/* ── Status Badge (client, shared) ─────────────────────────────────
   Deposit/withdraw/swap status views all share the same shape
   ({ label, note?, tone }) and the same visual language — an uppercase,
   semibold, tone-colored pill. Extracted from the near-identical
   STATUS_TONE_CLASS + renderStatusBadge duplicated across Deposit.tsx /
   Withdraw.tsx (swap now matches too, 客户端三域词表统一, 业主裁定).
   fx-* tokens only (rules/frontend-client.md forbids raw Tailwind colors).
   ────────────────────────────────────────────────────────────── */

export interface StatusBadgeView {
  label: string;
  tone: 'neutral' | 'positive' | 'warning' | 'danger';
}

const STATUS_TONE_CLASS: Record<StatusBadgeView['tone'], string> = {
  positive: 'bg-fx-sage/20 text-fx-sage',
  warning: 'bg-fx-brass/20 text-fx-brass',
  danger: 'bg-fx-rust/20 text-fx-rust',
  neutral: 'bg-fx-dust/20 text-fx-dust',
};

export const StatusBadge = ({ view }: { view: StatusBadgeView }) => (
  <span
    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase ${STATUS_TONE_CLASS[view.tone]}`}
  >
    {view.label}
  </span>
);
