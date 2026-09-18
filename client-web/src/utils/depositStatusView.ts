// client-web/src/utils/depositStatusView.ts

/* ── Deposit Status View (client, tipping-off safe) ──────────────
   Client-facing counterpart to admin-web's depositStatusMap.ts. The two
   tables are DELIBERATELY different and must never be merged: admin
   shows the raw status (FROZEN/SEIZED/...), this file exists precisely
   to hide that from the customer.

   业主定稿（2026-08-06，减法）：此前这里按"客户是否已提交补料"
   （`actionSubmittedAt`）额外改写渲染结果——同一个 `ACTION_PENDING`，
   已提交会短路成与 `COMPLIANCE_PENDING` 相同的 `PROCESSING`（`SUBMITTED_VIEW`），
   未提交才显示 `ACTION REQUIRED`。这套"状态 + 一个客户看不见的隐藏字段"
   的二元判据，接口层（`toCustomerStatus`）还要跟着同步收敛，两层判据必须
   逐字不差地保持一致——最近两轮里，这套机制连续制造了三个 Critical（易漏
   同步、易漏判据分支）。业主拍板收口：**状态就是状态，按钮归按钮**。
   `getDepositStatusView` 恢复成最初的样子——纯按 `status` 查表，不接受、
   也不该再接受第二个参数。"客户是否已交材料"改由详情页
   （`DepositDetail.tsx`）按每条 applicant action 自己的 `submittedAt`
   单独控制对应按钮是否可点，不再倒过来改写徽章或整体状态。

   ⚠️ 已知取舍（已登 BACKLOG）：`ACTION_PENDING` 的单被冻（`FROZEN`/
   `SEIZING`/`SEIZED`/`MANUAL_CHECKING`）时，徽章会从 `ACTION REQUIRED`
   变成 `PROCESSING`——对已提交材料的客户和未提交的客户**一视同仁**都会
   变。此前的短路只吸收了"已提交"客户的这次变化，让"未提交"客户独自
   经历它，是一条只对一半人生效的半拉子防线，也是三个 Critical 的根源
   之一。收窄成"人人都变"是业主认可的已知代价——不是新洞，只是从"只对
   一半客户可见的差异"变成"对所有客户一致的行为"。

   Three rules (design §1.2), enforced by depositStatusView.spec.ts:
   1. This file must NEVER emit sanction/enforcement wording. FROZEN /
      SEIZING / SEIZED / MANUAL_CHECKING must be **indistinguishable from
      COMPLIANCE_PENDING** — same label, same (absent) note, same tone.
      A distinct colour or a "contact support" hint is itself a tipping-off
      signal, so collapsing only the label is not enough. Do not "improve"
      this to a more accurate word, and do not add a note back. This rule
      is NOT affected by the 2026-08-06 simplification above — it must
      hold regardless of whether the underlying ACTION_PENDING was ever
      submitted. None of its tests may be removed.
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
  CLAWED_BACK: {
    label: 'CLAWED BACK',
    note: 'The bank reversed this deposit; your balance was reduced accordingly',
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
 *
 * Pure `status` lookup — no second parameter. See file header for why:
 * a hidden second judgment criterion (whether the customer already
 * submitted their materials) used to live here and repeatedly caused
 * bugs. Don't reintroduce one.
 */
export function getDepositStatusView(status: string): DepositStatusView {
  const key = String(status || '').toUpperCase();
  return VIEW_MAP[key] ?? DEFAULT_VIEW;
}
