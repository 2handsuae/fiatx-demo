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
];

// [status, expected label] — copied verbatim from design §1.2
const LABEL_CASES: Array<[string, string]> = [
  ['PAYIN_PENDING', 'PROCESSING'],
  ['COMPLIANCE_PENDING', 'PROCESSING'],
  ['ACTION_PENDING', 'ACTION REQUIRED'],
  ['SUCCESS', 'SUCCESS'],
  ['RETURNING', 'RETURNING'],
  ['RETURNED', 'RETURNED'],
  ['FROZEN', 'PROCESSING'],
  ['SEIZING', 'PROCESSING'],
  ['SEIZED', 'PROCESSING'],
  ['MANUAL_CHECKING', 'PROCESSING'],
  ['FAILED', 'FAILED'],
];

describe('depositStatusView (client, tipping-off safe)', () => {
  it('exercises all 13 backend statuses', () => {
    expect(ALL_STATUSES).toHaveLength(13);
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

  // ── applicant action 三展示态 + 泄密口 ──────────────────────
  //
  // 态③（客户已提交）要显示"已收到，审核中"。若该 note 按 **status** 给出，
  // 则：客户提交 → 见"已收到" → Sumsub 判回制裁 → 单子进 FROZEN → 该句
  // **凭空消失**。客户盯着自己那单，眼看一句话没了——这正是 2026-08-02
  // 收敛要堵的"一眼看出自己这单与众不同"。
  //
  // 故：该 note 绑 `submitted`，**不绑 status**。提交过即恒显，冻结时刻
  // 客户端零变化。
  describe('applicant action 展示态', () => {
    it('态①未提交：ACTION REQUIRED + 索要文案', () => {
      const v = getDepositStatusView('ACTION_PENDING', { submitted: false });
      expect(v.label).toBe('ACTION REQUIRED');
      expect(v.tone).toBe('warning');
    });

    it('态③已提交：收敛成 PROCESSING + 已收到文案', () => {
      const v = getDepositStatusView('ACTION_PENDING', { submitted: true });
      expect(v.label).toBe('PROCESSING');
      expect(v.tone).toBe('neutral');
      expect(v.note).toMatch(/received/i);
    });

    it.each([true, false])(
      '执法四态与 COMPLIANCE_PENDING 逐字段一致（submitted=%s 两个取值都要成立）',
      (submitted) => {
        for (const s of ['FROZEN', 'SEIZING', 'SEIZED', 'MANUAL_CHECKING']) {
          expect(getDepositStatusView(s, { submitted })).toEqual(
            getDepositStatusView('COMPLIANCE_PENDING', { submitted }),
          );
        }
      },
    );

    // 时序不变量：这才是客户实际观察到的东西
    it('提交后被冻——客户端渲染逐字段不变', () => {
      const before = getDepositStatusView('ACTION_PENDING', { submitted: true });
      const after = getDepositStatusView('FROZEN', { submitted: true });
      expect(after).toEqual(before);
    });

    it('已提交的文案里同样不得出现执法字样', () => {
      for (const s of ALL_STATUSES) {
        const v = getDepositStatusView(s, { submitted: true });
        expect(`${v.label} ${v.note ?? ''}`).not.toMatch(FORBIDDEN);
      }
    });
  });
});
