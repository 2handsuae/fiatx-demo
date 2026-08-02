// client-web/src/utils/depositStatusView.ts

/* ── Deposit Status View (client, tipping-off safe) ──────────────
   Client-facing counterpart to admin-web's depositStatusMap.ts. The two
   tables are DELIBERATELY different and must never be merged: admin
   shows the raw status (FROZEN/SEIZED/...), this file exists precisely
   to hide that from the customer.

   Three rules (design §1.2), enforced by depositStatusView.spec.ts:
   1. This file must NEVER emit sanction/enforcement wording. FROZEN /
      SEIZING / SEIZED / MANUAL_CHECKING all collapse to the neutral
      "UNDER REVIEW" — do not "improve" this to a more accurate word.
   2. Unknown status -> "Processing" (never a bare/raw status code).
      CONFISCATING/CONFISCATED are intentionally left out of the map
      below for the same reason: the server already filters these out
      before they reach the client, and if one ever leaked through this
      is the defensive fallback, not a literal "CONFISCATED" label.
   3. Zero Chinese; all user-facing text is English.

   Badge copy copied verbatim from design spec §1.2:
   doc-final/superpowers/specs/2026-07-29-deposit-frontend-design.md
   ────────────────────────────────────────────────────────────── */

export interface DepositStatusView {
  label: string;
  note?: string;
  tone: 'neutral' | 'positive' | 'warning' | 'danger';
}

const VIEW_MAP: Record<string, DepositStatusView> = {
  PAYIN_PENDING: { label: 'PROCESSING', tone: 'neutral' },
  COMPLIANCE_PENDING: { label: 'PROCESSING', tone: 'neutral' },
  ACTION_PENDING: {
    label: 'ACTION REQUIRED',
    note: 'Please provide additional information',
    tone: 'warning',
  },
  SUCCESS: { label: 'SUCCESS', tone: 'positive' },
  RETURNING: {
    label: 'RETURNING',
    note: 'Funds are being returned to the original sender',
    tone: 'warning',
  },
  RETURNED: {
    label: 'RETURNED',
    note: 'Funds were returned to the original sender',
    tone: 'neutral',
  },
  FROZEN: { label: 'UNDER REVIEW', note: 'Please contact support', tone: 'warning' },
  SEIZING: { label: 'UNDER REVIEW', note: 'Please contact support', tone: 'warning' },
  SEIZED: { label: 'UNDER REVIEW', note: 'Please contact support', tone: 'warning' },
  MANUAL_CHECKING: { label: 'UNDER REVIEW', note: 'Please contact support', tone: 'warning' },
  FAILED: { label: 'FAILED', tone: 'danger' },
  // REJECTED / EXPIRED removed (状态机收窄,业主 2026-07-31 定稿): neither could
  // answer "where did the money go" — deposit funds already landed on-chain/in
  // the bank, so a deposit could never legitimately be "rejected" or "expire"
  // after payin. See doc-final/reference/truth/v4-deposit.md §2.
  // CONFISCATING / CONFISCATED intentionally absent — see file header.
};

const DEFAULT_VIEW: DepositStatusView = { label: 'PROCESSING', tone: 'neutral' };

/**
 * Returns the customer-facing view for a deposit status. Unknown or
 * unmapped statuses (including CONFISCATING/CONFISCATED, which the
 * server should already have filtered out) fall back to the neutral
 * "Processing" default rather than ever rendering enforcement wording.
 */
export function getDepositStatusView(status: string): DepositStatusView {
  const key = String(status || '').toUpperCase();
  return VIEW_MAP[key] ?? DEFAULT_VIEW;
}
