// client-web/src/utils/swapStatusView.spec.ts

import { getSwapStatusView } from './swapStatusView';

/**
 * Client-facing swap status view — the tipping-off-safe table.
 * COMPLIANCE_PENDING and PROCESSING must be INDISTINGUISHABLE to the
 * customer: same label, same tone. Mirrors withdrawStatusView.spec.ts /
 * depositStatusView.spec.ts.
 */

// All 4 reachable backend statuses (src/modules/trading/swap-transactions/
// dto/swap-transaction.dto.ts's SwapTransactionStatus — FAILED/REVERSED are
// documented dead enum values, not reachable, so not exercised here).
// The backend is actually 5-state reachable as of 2026-08-20 (FROZEN added
// alongside COMPLIANCE_PENDING/PROCESSING/SUCCESS/REJECTED); the client only
// ever sees these 4 because the service layer's `toCustomerSwapStatus()`
// (swap-transactions.service.ts:652) collapses FROZEN into COMPLIANCE_PENDING
// before it ever reaches this view — that convergence, not a gap here, is why.
const ALL_STATUSES = ['COMPLIANCE_PENDING', 'PROCESSING', 'SUCCESS', 'REJECTED'];

// [status, expected label] — 客户端三域词表统一（业主裁定）
const LABEL_CASES: Array<[string, string]> = [
  ['COMPLIANCE_PENDING', 'PROCESSING'],
  ['PROCESSING', 'PROCESSING'],
  ['SUCCESS', 'SUCCESS'],
  ['REJECTED', 'DECLINED'],
];

describe('swapStatusView (client, tipping-off safe)', () => {
  it('exercises all 4 reachable backend statuses', () => {
    expect(ALL_STATUSES).toHaveLength(4);
  });

  it.each(LABEL_CASES)('%s -> label=%s', (status, label) => {
    expect(getSwapStatusView(status).label).toBe(label);
  });

  // 只断言 label 相同是不够的：tone 不同，客户端上这一单就"看着不一样"（颜色/图标
  // 不同），正在被合规审查的人照样能辨认出自己这单与"普通处理中"不同。所以这里
  // 断言**整个 view 对象逐字段等同**——将来谁把 COMPLIANCE_PENDING 单独调个颜色，
  // 本条即红。
  it('COMPLIANCE_PENDING 与 PROCESSING 逐字段完全一致（tipping-off 防线）——不暴露"正在被合规审查"', () => {
    expect(getSwapStatusView('COMPLIANCE_PENDING')).toEqual(getSwapStatusView('PROCESSING'));
  });

  it('unknown statuses fall back to PROCESSING (never a bare/raw status code)', () => {
    expect(getSwapStatusView('SOME_FUTURE_STATUS')).toEqual({
      label: 'PROCESSING',
      tone: 'neutral',
    });
  });

  // Dead enum values (FAILED/REVERSED, kept only for historical-row compat —
  // see BACKLOG "V6 兑换 FAILED/REVERSED 死枚举") fall through to the same
  // default as any other unmapped status. Not a gap: the brief's mapping is
  // exactly the 4 reachable cases + a safe default.
  it.each(['FAILED', 'REVERSED'])(
    'dead enum value %s also falls back to PROCESSING (never surfaced as its own state)',
    (status) => {
      expect(getSwapStatusView(status)).toEqual({ label: 'PROCESSING', tone: 'neutral' });
    },
  );

  // 充提现同款：徽章一律全大写（业主裁定的客户端三域词表统一）。
  it('every badge label is fully uppercase', () => {
    for (const status of ALL_STATUSES) {
      const v = getSwapStatusView(status);
      expect(v.label).toBe(v.label.toUpperCase());
    }
  });

  // ── The actual compliance guardrail ────────────────────────────
  // Tipping-off: a customer must never see sanction/enforcement/internal
  // compliance/investigation wording. Must hold across ALL statuses so a
  // future edit to the map can't quietly regress it.
  const FORBIDDEN = /sanction|seiz|frozen|freeze|manual|compliance|kyt|review|investigat/i;

  it.each(ALL_STATUSES)(
    'forbidden-word sweep: %s output contains no sanction/enforcement/investigative language',
    (status) => {
      const v = getSwapStatusView(status);
      expect(v.label).not.toMatch(FORBIDDEN);
    },
  );
});
