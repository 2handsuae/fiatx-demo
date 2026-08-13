// admin-web/src/utils/swapStatusMap.ts

/* ── Swap Status Map (admin, as-is) ──────────────────────────────
   Single source of truth for the 4 backend swap statuses (task-10-brief.md).
   Unlike withdraw/deposit, a swap has no "waiting on customer" or maker-checker
   detour: it is born COMPLIANCE_PENDING, waits for a Sumsub KYT verdict, then
   advances to PROCESSING (→ SUCCESS) or dies at REJECTED — 4 statuses, 2
   terminal. The hero badge on SwapTransactionDetail.tsx still renders via the
   shared <StatusPill> component (STATUS_PILL_MAP already covers all 4 codes);
   this map's job is `isSwapTerminalStatus`, which gates whether the ⚡
   Simulation panel can still do anything to this order.
   ────────────────────────────────────────────────────────────── */

export const SWAP_STATUS_META: Record<string, { label: string; tone: string }> = {
  COMPLIANCE_PENDING: { label: 'Compliance Pending', tone: 'warning' },
  PROCESSING:         { label: 'Processing',         tone: 'info' },
  SUCCESS:            { label: 'Success',            tone: 'success' },
  REJECTED:           { label: 'Rejected',           tone: 'danger' },
};

export const isSwapTerminalStatus = (s: string) => s === 'SUCCESS' || s === 'REJECTED';
