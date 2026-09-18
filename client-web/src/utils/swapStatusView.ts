// client-web/src/utils/swapStatusView.ts

/* ── Swap Status View (client, tipping-off safe) ───────────────────
   Client-facing status mapping for swap orders. Mirrors
   withdrawStatusView.ts / depositStatusView.ts's tipping-off rule and
   {label, note?, tone} shape, applied to swap's own (simpler) status set:

   1. COMPLIANCE_PENDING and PROCESSING must be INDISTINGUISHABLE to the
      customer — same label, same tone. A swap now waits for a Sumsub KYT
      verdict on its sell leg before it can settle; the customer must not
      learn that a compliance review is happening, only that the order is
      still being worked on. Do not "improve" this to a more specific
      label — that is itself the tipping-off signal.
      (FROZEN never reaches this file: the service layer's
      toCustomerSwapStatus() already collapses it into COMPLIANCE_PENDING
      before the client ever sees a status string, so this table carries
      no FROZEN entry of its own — nothing to keep in sync here.)
   2. Unknown status -> "PROCESSING" (never a bare/raw status code).
   3. Zero Chinese; all user-facing text is English.
   ─────────────────────────────────────────────────────────────── */

export interface SwapStatusView {
  label: string;
  note?: string;
  tone: 'neutral' | 'positive' | 'warning' | 'danger';
}

const VIEW_MAP: Record<string, SwapStatusView> = {
  COMPLIANCE_PENDING: { label: 'PROCESSING', tone: 'neutral' },
  PROCESSING: { label: 'PROCESSING', tone: 'neutral' },
  SUCCESS: { label: 'SUCCESS', tone: 'positive' },
  // Neutral-toward-the-customer wording — no compliance/sanction implication,
  // mirrors withdrawStatusView.ts's own REJECTED -> DECLINED mapping.
  REJECTED: { label: 'DECLINED', tone: 'danger' },
};

const DEFAULT_VIEW: SwapStatusView = { label: 'PROCESSING', tone: 'neutral' };

/**
 * Returns the customer-facing view for a swap status. Unknown or unmapped
 * statuses (including the dead FAILED/REVERSED enum values) fall back to
 * the neutral "PROCESSING" default rather than ever rendering a raw status
 * code.
 */
export function getSwapStatusView(status: string): SwapStatusView {
  const key = String(status || '').toUpperCase();
  return VIEW_MAP[key] ?? DEFAULT_VIEW;
}
