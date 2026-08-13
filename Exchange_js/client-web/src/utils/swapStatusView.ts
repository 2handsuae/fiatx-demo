// client-web/src/utils/swapStatusView.ts

/* ── Swap Status View (client, tipping-off safe) ───────────────────
   Client-facing status mapping for swap orders. Mirrors
   withdrawStatusView.ts / depositStatusView.ts's tipping-off rule, applied
   to swap's own (simpler) status set:

   1. COMPLIANCE_PENDING and PROCESSING must be INDISTINGUISHABLE to the
      customer — same text, same tone. A swap now waits for a Sumsub KYT
      verdict on its sell leg before it can settle; the customer must not
      learn that a compliance review is happening, only that the order is
      still being worked on. Do not "improve" this to a more specific
      label — that is itself the tipping-off signal.
   2. Unknown status -> "Processing" (never a bare/raw status code).
   3. Zero Chinese; all user-facing text is English.
   ─────────────────────────────────────────────────────────────── */

export interface SwapStatusView {
  text: string;
  tone: 'pending' | 'success' | 'failed';
}

export const getSwapStatusView = (status: string): SwapStatusView => {
  switch (status) {
    case 'COMPLIANCE_PENDING':
      return { text: 'Processing', tone: 'pending' };
    case 'PROCESSING':
      return { text: 'Processing', tone: 'pending' };
    case 'SUCCESS':
      return { text: 'Completed', tone: 'success' };
    case 'REJECTED':
      return { text: 'Unsuccessful', tone: 'failed' };
    default:
      return { text: 'Processing', tone: 'pending' };
  }
};
