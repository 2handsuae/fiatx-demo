// client-web/src/utils/depositStatusView.spec.ts

import { getDepositStatusView } from './depositStatusView';

/**
 * Client-facing deposit status view — the tipping-off-safe table.
 * FROZEN / SEIZING / SEIZED / MANUAL_CHECKING must be INDISTINGUISHABLE
 * from COMPLIANCE_PENDING — same label, same (absent) note, same tone.
 * A distinct colour or a "contact support" hint is itself a tipping-off
 * signal. CONFISCATING / CONFISCATED must never surface
 * to the client at all (server already filters them out — this util's
 * job is to make sure that even if one leaks through, it never renders
 * enforcement language). See design §1.2.
 */

// Every status defined on the backend enum, minus OPERATION_PENDING (a
// BELOW_MIN-hold-pending admin-only status the customer never sees)
// (src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts:4-19)
const ALL_STATUSES = [
  'PAYIN_PENDING',
  'COMPLIANCE_PENDING',
  'ACTION_PENDING',
  'SUCCESS',
  'FROZEN',
  'FAILED',
  'CONFISCATED',
  'MANUAL_CHECKING',
  'RETURNING',
  'RETURNED',
  'SEIZING',
  'SEIZED',
  'CONFISCATING',
  'CLAWED_BACK',
];

// [status, expected label] — copied verbatim from design §1.2
const LABEL_CASES: Array<[string, string]> = [
  ['PAYIN_PENDING', 'PROCESSING'],
  ['COMPLIANCE_PENDING', 'PROCESSING'],
  ['ACTION_PENDING', 'ACTION REQUIRED'],
  ['SUCCESS', 'SUCCESS'],
  ['RETURNING', 'RETURNING'],
  ['RETURNED', 'RETURNED'],
  ['CLAWED_BACK', 'CLAWED BACK'],
  ['FROZEN', 'PROCESSING'],
  ['SEIZING', 'PROCESSING'],
  ['SEIZED', 'PROCESSING'],
  ['MANUAL_CHECKING', 'PROCESSING'],
  ['FAILED', 'FAILED'],
];

describe('depositStatusView (client, tipping-off safe)', () => {
  it('exercises all 14 backend statuses', () => {
    expect(ALL_STATUSES).toHaveLength(14);
  });

  it.each(LABEL_CASES)('%s -> label=%s', (status, label) => {
    expect(getDepositStatusView(status).label).toBe(label);
  });

  // 只断言 label 相同是不够的:note 或 tone 任一不同，客户端上这一单就"看着不一样"，
  // 被调查人照样能辨认出自己被盯上了。所以这里断言**整个 view 对象逐字段等同**于
  // 正常处理中的 COMPLIANCE_PENDING —— 将来谁"体贴地"把 'Please contact support'
  // 加回来、或把颜色调成警示黄，本条即红。
  it.each(['FROZEN', 'SEIZING', 'SEIZED', 'MANUAL_CHECKING'])(
    '%s 与 COMPLIANCE_PENDING 逐字段完全一致（tipping-off 防线）',
    (status) => {
      expect(getDepositStatusView(status)).toEqual(
        getDepositStatusView('COMPLIANCE_PENDING'),
      );
    },
  );

  it('执法四态一律不带 note（note 本身即可辨识信号）', () => {
    for (const status of ['FROZEN', 'SEIZING', 'SEIZED', 'MANUAL_CHECKING']) {
      expect(getDepositStatusView(status).note).toBeUndefined();
    }
  });

  it('every badge label is fully uppercase', () => {
    for (const [status] of LABEL_CASES) {
      const v = getDepositStatusView(status);
      expect(v.label).toBe(v.label.toUpperCase());
    }
  });

  it('unknown statuses fall back to PROCESSING (never a bare/raw status code)', () => {
    const v = getDepositStatusView('SOME_FUTURE_STATUS');
    expect(v.label).toBe('PROCESSING');
    expect(v.tone).toBe('neutral');
  });

  it('CONFISCATING/CONFISCATED never render as such to the client (server-filtered defensive default)', () => {
    expect(getDepositStatusView('CONFISCATING').label).not.toBe('CONFISCATING');
    expect(getDepositStatusView('CONFISCATED').label).not.toBe('CONFISCATED');
  });

  // ── The actual compliance guardrail ────────────────────────────
  // Tipping-off: a customer must never see sanction/enforcement wording.
  // This must hold across ALL 13 statuses, not just the four sensitive
  // ones, so a future edit anywhere in the map can't quietly regress it.
  const FORBIDDEN = /sanction|seiz|frozen|freeze|confiscat|enforcement|government|police/i;

  it.each(ALL_STATUSES)('forbidden-word sweep: %s output contains no sanction/enforcement language', (status) => {
    const v = getDepositStatusView(status);
    const text = `${v.label} ${v.note ?? ''}`;
    expect(text).not.toMatch(FORBIDDEN);
  });

  // ── 业主定稿（2026-08-06，减法）回归 ──────────────────────────
  //
  // 此前这里有一整套"客户是否已提交补料"（`opts.submitted`）改写渲染结果
  // 的机制（`SUBMITTED_VIEW` + `REAL_OUTCOME_STATUSES` 排除表），已随
  // `getDepositStatusView` 收口成单参纯查表一并删除，见文件头注释。以下
  // 钉住新口径本身，防止有人手滑把第二参数/短路加回来：`ACTION_PENDING`
  // 只有一种呈现，`toCustomerStatus`（接口层，见
  // deposit-transactions.service.spec.ts）无论 `actionSubmittedAt` 是否为空
  // 都原样下发 `ACTION_PENDING`，两层此后天然一致，不再需要分别钉两遍。
  it('ACTION_PENDING 恒为 ACTION REQUIRED——渲染层不再有第二个判据（钉住新口径）', () => {
    expect(getDepositStatusView('ACTION_PENDING')).toEqual({
      label: 'ACTION REQUIRED',
      note: 'Please provide additional information',
      tone: 'warning',
    });
  });

  it('已知取舍：ACTION_PENDING 被冻后与 COMPLIANCE_PENDING 逐字段一致，对所有客户一视同仁', () => {
    // 规则 1 的另一种表述——不再区分"提交过/没提交过"两类客户，冻结后的
    // 呈现都收敛到同一处，不再有一半客户经历可观测变化、另一半没有的不对称。
    expect(getDepositStatusView('FROZEN')).toEqual(getDepositStatusView('COMPLIANCE_PENDING'));
  });
});
