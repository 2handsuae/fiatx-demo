// client-web/src/utils/withdrawStatusView.ts

/* ── Withdraw Status View (client, tipping-off safe) ──────────────
   Client-facing counterpart to admin-web's withdrawStatusMap.ts. The two
   tables are DELIBERATELY different and must never be merged: admin shows
   the raw status (FROZEN/MANUAL_CHECKING/...), this file exists precisely
   to hide that from the customer. Mirrors client-web/src/utils/depositStatusView.ts
   (design §1.2, 2026-08-02 owner ruling) — same three rules apply here:

   1. This file must NEVER emit sanction/enforcement/compliance wording.
      FROZEN / MANUAL_CHECKING / PENDING_APPROVAL must be **indistinguishable
      from COMPLIANCE_PENDING** — same label, same (absent) note, same tone.
      A distinct colour or a "contact support" hint is itself a tipping-off
      signal, so collapsing only the label is not enough. Do not "improve"
      this to a more accurate word, and do not add a note back.
      (PENDING_APPROVAL joins this set for withdraw specifically: it is the
      internal large-value maker-checker gate — an operational detail the
      customer has no legitimate need to see, and distinguishing it from
      ordinary processing would itself leak "this one is under extra
      scrutiny".)
   2. Unknown status -> "Processing" (never a bare/raw status code).
   3. Zero Chinese; all user-facing text is English.
   ────────────────────────────────────────────────────────────── */

export interface WithdrawStatusView {
  label: string;
  note?: string;
  tone: 'neutral' | 'positive' | 'warning' | 'danger';
}

const VIEW_MAP: Record<string, WithdrawStatusView> = {
  // 制裁/执法/人工复核/内部审批四态：与彼此逐字段完全一致（label + 无 note + neutral）,
  // 客户端上与"正常处理中"在视觉与文案上都无从区分。见文件头 2026-08-02 定稿理由。
  PENDING_APPROVAL: { label: 'PROCESSING', tone: 'neutral' },
  COMPLIANCE_PENDING: { label: 'PROCESSING', tone: 'neutral' },
  MANUAL_CHECKING: { label: 'PROCESSING', tone: 'neutral' },
  FROZEN: { label: 'PROCESSING', tone: 'neutral' },
  ACTION_PENDING: {
    label: 'ACTION REQUIRED',
    note: 'Please provide additional information',
    tone: 'warning',
  },
  // Post-approval payout in flight — still just "processing" to the customer,
  // no separate visual state (mirrors how PAYIN_PENDING === COMPLIANCE_PENDING
  // on the deposit side; an in-flight payout carries no note either).
  PAYOUT_PENDING: { label: 'PROCESSING', tone: 'neutral' },
  SUCCESS: { label: 'SUCCESS', tone: 'positive' },
  FAILED: {
    label: 'FAILED',
    note: 'Funds returned to your account',
    tone: 'danger',
  },
  // Neutral wording — no compliance/sanction implication. A withdrawal can be
  // declined for ordinary reasons (bad destination, risk-team judgement call
  // unrelated to sanctions, etc.); "DECLINED" answers "where did the money
  // go" without asserting why.
  REJECTED: {
    label: 'DECLINED',
    note: 'Funds returned to your account',
    tone: 'danger',
  },
  RETURNED: {
    label: 'RETURNED',
    note: 'Funds returned to your account',
    tone: 'neutral',
  },
};

const DEFAULT_VIEW: WithdrawStatusView = { label: 'PROCESSING', tone: 'neutral' };

/**
 * Returns the customer-facing view for a withdraw status. Unknown or
 * unmapped statuses fall back to the neutral "Processing" default rather
 * than ever rendering a raw/enforcement status code.
 */
export function getWithdrawStatusView(status: string): WithdrawStatusView {
  const key = String(status || '').toUpperCase();
  return VIEW_MAP[key] ?? DEFAULT_VIEW;
}
