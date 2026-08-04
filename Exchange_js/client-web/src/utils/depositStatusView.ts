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
 * 客户已提交补料后的统一呈现——绑提交事实，不绑当前状态（见下方注释）。
 * 冻结：按引用返回的对象若被调用方写一下 `view.note = …` 会污染所有单子的
 * 展示，故用 Object.freeze 锁死（VIEW_MAP 各项与 DEFAULT_VIEW 是既有模式，
 * 这里不动，只冻新增的这个单例）。
 */
const SUBMITTED_VIEW: DepositStatusView = Object.freeze({
  label: 'PROCESSING',
  note: 'We have received your information and it is being reviewed',
  tone: 'neutral',
});

// 「已提交」短路只覆盖"在审"集合，以下四个终态排除在外：
//   SUCCESS   —— 补料后 Sumsub 放行、单子真的成功了，客户必须看到 SUCCESS，
//                 不能永远卡在"审核中"（这正是本次要修的 Critical：
//                 actionSubmittedAt 终态不清空，若不排除会让 happy path
//                 自己把自己的成功结果吞掉）。
//   FAILED / RETURNING / RETURNED —— 钱已经退回/失败，客户必须看到真实结果，
//                 继续显示"已收到，审核中"是明确的误导。
// 遮蔽终态对规则 A（tipping-off）没有任何帮助：干净单走向这四个终态、
// 被冻的单根本到不了这里——冻结那一刻依旧是零变化，不受此排除影响。
//
// ⚠️ SEIZED / SEIZING 绝对不能加进来：它们也是终态，但属于执法态，必须
// 继续与 COMPLIANCE_PENDING 逐字段一致（规则 1）。这里的排除列表只放
// "客户本来就该看到真实结果"的几个，不是"终态就排除"。同理
// CONFISCATING/CONFISCATED 不在 VIEW_MAP 里（走兜底默认值），也不要加进来。
const REAL_OUTCOME_STATUSES = new Set(['SUCCESS', 'FAILED', 'RETURNING', 'RETURNED']);

/**
 * Returns the customer-facing view for a deposit status. Unknown or
 * unmapped statuses (including CONFISCATING/CONFISCATED, which the
 * server should already have filtered out) fall back to the neutral
 * "Processing" default rather than ever rendering enforcement wording.
 *
 * `opts.submitted` = 该单的 `actionSubmittedAt` 非空。
 *
 * 规则 4（2026-08-04）：客户提交过补料且单子仍"在审"（不在
 * REAL_OUTCOME_STATUSES 里）时，一律走 SUBMITTED_VIEW，与当前 status 无关。
 * 这不是偷懒，是防线：若按 status 给这条 note，则「提交 → 见'已收到' →
 * 被冻 → 该句消失」构成一次客户可观测的状态变化，等于在规则 1 刚补好的
 * 防线上重新开洞。
 *
 * 提交过的单在冻结时刻零变化；未提交即被冻仍有可观测变化（`ACTION REQUIRED`
 * / warning / 索要文案 → `PROCESSING` / neutral / 无 note），属已知取舍——
 * 要堵只能在冻结后继续向客户索要我方根本不会审阅的文件，已登记 BACKLOG。
 */
export function getDepositStatusView(
  status: string,
  opts?: { submitted?: boolean },
): DepositStatusView {
  const key = String(status || '').toUpperCase();
  if (opts?.submitted && !REAL_OUTCOME_STATUSES.has(key)) return SUBMITTED_VIEW;
  return VIEW_MAP[key] ?? DEFAULT_VIEW;
}
