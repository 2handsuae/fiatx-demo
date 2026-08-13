// client-web/src/utils/swapStatusView.spec.ts

import { getSwapStatusView } from './swapStatusView';

/**
 * Client-facing swap status view — the tipping-off-safe table.
 * COMPLIANCE_PENDING and PROCESSING must be INDISTINGUISHABLE to the
 * customer: same text, same tone. Mirrors withdrawStatusView.spec.ts /
 * depositStatusView.spec.ts.
 */

// All 4 reachable backend statuses (src/modules/trading/swap-transactions/
// dto/swap-transaction.dto.ts's SwapTransactionStatus — FAILED/REVERSED are
// documented dead enum values, not reachable, so not exercised here).
const ALL_STATUSES = ['COMPLIANCE_PENDING', 'PROCESSING', 'SUCCESS', 'REJECTED'];

// [status, expected text]
const TEXT_CASES: Array<[string, string]> = [
  ['COMPLIANCE_PENDING', 'Processing'],
  ['PROCESSING', 'Processing'],
  ['SUCCESS', 'Completed'],
  ['REJECTED', 'Unsuccessful'],
];

describe('swapStatusView (client, tipping-off safe)', () => {
  it('exercises all 4 reachable backend statuses', () => {
    expect(ALL_STATUSES).toHaveLength(4);
  });

  it.each(TEXT_CASES)('%s -> text=%s', (status, text) => {
    expect(getSwapStatusView(status).text).toBe(text);
  });

  // 只断言 text 相同是不够的：tone 不同，客户端上这一单就"看着不一样"（颜色/图标
  // 不同），正在被合规审查的人照样能辨认出自己这单与"普通处理中"不同。所以这里
  // 断言**整个 view 对象逐字段等同**——将来谁把 COMPLIANCE_PENDING 单独调个颜色，
  // 本条即红。
  it('COMPLIANCE_PENDING 与 PROCESSING 逐字段完全一致（tipping-off 防线）——不暴露"正在被合规审查"', () => {
    expect(getSwapStatusView('COMPLIANCE_PENDING')).toEqual(getSwapStatusView('PROCESSING'));
  });

  it('unknown statuses fall back to Processing (never a bare/raw status code)', () => {
    expect(getSwapStatusView('SOME_FUTURE_STATUS')).toEqual({
      text: 'Processing',
      tone: 'pending',
    });
  });

  // Dead enum values (FAILED/REVERSED, kept only for historical-row compat —
  // see BACKLOG "V6 兑换 FAILED/REVERSED 死枚举") fall through to the same
  // default as any other unmapped status. Not a gap: the brief's mapping is
  // exactly the 4 reachable cases + a safe default.
  it.each(['FAILED', 'REVERSED'])(
    'dead enum value %s also falls back to Processing (never surfaced as its own state)',
    (status) => {
      expect(getSwapStatusView(status)).toEqual({ text: 'Processing', tone: 'pending' });
    },
  );

  it('every status text is title case, never a raw/uppercase status code', () => {
    for (const status of ALL_STATUSES) {
      const v = getSwapStatusView(status);
      expect(v.text).not.toBe(status);
      expect(v.text).not.toBe(v.text.toUpperCase());
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
      expect(v.text).not.toMatch(FORBIDDEN);
    },
  );
});
