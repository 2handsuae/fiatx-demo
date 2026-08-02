// client-web/src/utils/depositStatusView.ts

/* ── Deposit Status View (client, tipping-off safe) ──────────────
   Client-facing counterpart to admin-web's depositStatusMap.ts. The two
   tables are DELIBERATELY different and must never be merged: admin
   shows the raw status (FROZEN/SEIZED/...), this file exists precisely
   to hide that from the customer.

   Three rules (design §1.2), enforced by depositStatusView.spec.ts:
   1. This file must NEVER emit sanction/enforcement wording. FROZEN /
      SEIZING / SEIZED / MANUAL_CHECKING must be **indistinguishable from
      COMPLIANCE_PENDING** — same label, same (absent) note, same tone.
      A distinct colour or a "contact support" hint is itself a tipping-off
      signal, so collapsing only the label is not enough. Do not "improve"
      this to a more accurate word, and do not add a note back.
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
  // 制裁 / 执法 / 人工复核四态：与 COMPLIANCE_PENDING **逐字段完全一致**
  // （label + 无 note + neutral），客户端上与"正常处理中"在视觉与文案上都无从区分。
  //
  // 2026-08-02 业主定稿，从 'UNDER REVIEW' + 'Please contact support' + warning 收敛而来。
  // 原写法虽然隐去了 FROZEN/SEIZED 字样，但黄色警示 + "联系客服"的组合本身就是可辨识
  // 信号——被调查人一眼看出自己这单与众不同，tipping-off 防线形同虚设。要么全同，
  // 要么就别装：这里选全同。
  //
  // ⚠️ 代价是客户拿不到求助路径。这是有意接受的取舍：对制裁/执法在办的单，
  // 引导客户来问本身就是不该做的动作。勿"体贴地"把 note 加回来。
  FROZEN: { label: 'PROCESSING', tone: 'neutral' },
  SEIZING: { label: 'PROCESSING', tone: 'neutral' },
  SEIZED: { label: 'PROCESSING', tone: 'neutral' },
  MANUAL_CHECKING: { label: 'PROCESSING', tone: 'neutral' },
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
