// client-web/src/utils/withdrawStatusView.spec.ts

import { getWithdrawStatusView } from './withdrawStatusView';

/**
 * Client-facing withdraw status view — the tipping-off-safe table.
 * FROZEN / MANUAL_CHECKING / PENDING_APPROVAL must be INDISTINGUISHABLE
 * from COMPLIANCE_PENDING — same label, same (absent) note, same tone.
 * A distinct colour or a "contact support" hint is itself a tipping-off
 * signal. Mirrors depositStatusView.spec.ts. See design §1.2 /
 * doc-final/superpowers/plans/2026-08-03-withdraw-sumsub-full-flow.md.
 */

// All 10 backend statuses (src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto.ts).
const ALL_STATUSES = [
  'PENDING_APPROVAL',
  'COMPLIANCE_PENDING',
  'ACTION_PENDING',
  'MANUAL_CHECKING',
  'FROZEN',
  'PAYOUT_PENDING',
  'SUCCESS',
  'REJECTED',
  'FAILED',
  'RETURNED',
];

// [status, expected label]
const LABEL_CASES: Array<[string, string]> = [
  ['PENDING_APPROVAL', 'PROCESSING'],
  ['COMPLIANCE_PENDING', 'PROCESSING'],
  ['ACTION_PENDING', 'ACTION REQUIRED'],
  ['MANUAL_CHECKING', 'PROCESSING'],
  ['FROZEN', 'PROCESSING'],
  ['PAYOUT_PENDING', 'PROCESSING'],
  ['SUCCESS', 'SUCCESS'],
  ['REJECTED', 'DECLINED'],
  ['FAILED', 'FAILED'],
  ['RETURNED', 'RETURNED'],
];

describe('withdrawStatusView (client, tipping-off safe)', () => {
  it('exercises all 10 backend statuses', () => {
    expect(ALL_STATUSES).toHaveLength(10);
  });

  it.each(LABEL_CASES)('%s -> label=%s', (status, label) => {
    expect(getWithdrawStatusView(status).label).toBe(label);
  });

  // 只断言 label 相同是不够的：note 或 tone 任一不同，客户端上这一单就"看着不一样"，
  // 被调查/被内部审批盯上的人照样能辨认出自己这单与众不同。所以这里断言**整个 view
  // 对象逐字段等同**于正常处理中的 COMPLIANCE_PENDING —— 将来谁"体贴地"把
  // 'Please contact support' 加回来、或把颜色调成警示黄，本条即红。
  it.each(['FROZEN', 'MANUAL_CHECKING', 'PENDING_APPROVAL'])(
    '%s 与 COMPLIANCE_PENDING 逐字段完全一致（tipping-off 防线）',
    (status) => {
      expect(getWithdrawStatusView(status)).toEqual(
        getWithdrawStatusView('COMPLIANCE_PENDING'),
      );
    },
  );

  it('四个敏感态（COMPLIANCE_PENDING/FROZEN/MANUAL_CHECKING/PENDING_APPROVAL）一律不带 note（note 本身即可辨识信号）', () => {
    for (const status of [
      'COMPLIANCE_PENDING',
      'FROZEN',
      'MANUAL_CHECKING',
      'PENDING_APPROVAL',
    ]) {
      expect(getWithdrawStatusView(status).note).toBeUndefined();
    }
  });

  it('every badge label is fully uppercase', () => {
    for (const [status] of LABEL_CASES) {
      const v = getWithdrawStatusView(status);
      expect(v.label).toBe(v.label.toUpperCase());
    }
  });

  it('unknown statuses fall back to PROCESSING (never a bare/raw status code)', () => {
    const v = getWithdrawStatusView('SOME_FUTURE_STATUS');
    expect(v.label).toBe('PROCESSING');
    expect(v.tone).toBe('neutral');
    expect(v.note).toBeUndefined();
  });

  it('terminal states surface where the money went, with neutral (non-compliance) wording', () => {
    expect(getWithdrawStatusView('FAILED').note).toBe('Funds returned to your account');
    expect(getWithdrawStatusView('REJECTED').note).toBe('Funds returned to your account');
    expect(getWithdrawStatusView('RETURNED').note).toBe('Funds returned to your account');
  });

  // ── The actual compliance guardrail ────────────────────────────
  // Tipping-off: a customer must never see sanction/enforcement/internal-
  // process wording. This must hold across ALL 10 statuses, not just the
  // sensitive ones, so a future edit anywhere in the map can't quietly
  // regress it.
  const FORBIDDEN =
    /sanction|seiz|frozen|freeze|manual|compliance|approval|mlro|officer|review/i;

  it.each(ALL_STATUSES)(
    'forbidden-word sweep: %s output contains no sanction/enforcement/internal-process language',
    (status) => {
      const v = getWithdrawStatusView(status);
      const text = `${v.label} ${v.note ?? ''}`;
      expect(text).not.toMatch(FORBIDDEN);
    },
  );
});
