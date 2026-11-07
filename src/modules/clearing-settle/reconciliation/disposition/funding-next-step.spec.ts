import { deriveFundingNextStep } from './funding-next-step';

describe('deriveFundingNextStep（平账二期 Task 8；戊波二 T7a：补款 COMPENSATION 退役，只剩垫款 + 划转单回链）', () => {
  const base = { book: 'CLIENT' as const, customerNo: 'CU1', walletNo: 'WA1' };
  const bounce = { externalLineId: 'line-1', lineAmountMinor: 120_000n, availableMinor: 30_000n, supplementNo: null };

  it('补款下一步不复存在：不论带什么事实，nextStep 都不会是 COMPENSATION（认损补缺的入口由读面按行事实算 SHORTFALL_TOPUP）', () => {
    // 旧事实（认损调账单已落账）不再是入参——FundingFacts 没有 adjustment 字段；剩下的任何组合都出不了补款
    const outs = [
      deriveFundingNextStep({ ...base }),
      deriveFundingNextStep({ ...base, transfer: { transferNo: 'ITR1', purpose: 'SHORTFALL_TOPUP', status: 'FAILED', recognized: false } }),
      deriveFundingNextStep({ ...base, bounce }),
    ];
    for (const o of outs) expect((o.nextStep as any)?.kind).not.toBe('COMPENSATION');
  });
  it('划转单回链保留，且带上「是否已记短缺」（认损补缺单的标签靠 status + recognized）', () => {
    expect(deriveFundingNextStep({ ...base, transfer: { transferNo: 'ITR1', purpose: 'SHORTFALL_TOPUP', status: 'EXECUTING', recognized: true } }).transfer)
      .toEqual({ transferNo: 'ITR1', purpose: 'SHORTFALL_TOPUP', status: 'EXECUTING', recognized: true });
    expect(deriveFundingNextStep({ ...base, transfer: { transferNo: 'ITR2', purpose: 'SHORTFALL_TOPUP', status: 'PENDING_APPROVAL', recognized: false } }).transfer)
      .toEqual({ transferNo: 'ITR2', purpose: 'SHORTFALL_TOPUP', status: 'PENDING_APPROVAL', recognized: false });
  });
  it('公司池只回链、不出下一步', () => {
    const r = deriveFundingNextStep({ ...base, book: 'FIRM', bounce, transfer: { transferNo: 'ITR1', purpose: 'SHORTFALL_TOPUP', status: 'SUCCESS', recognized: true } });
    expect(r.nextStep).toBeUndefined();
    expect(r.transfer?.transferNo).toBe('ITR1');
  });
  it('退汇行余额不足 → 待垫款，金额 = 账单行 − 可用', () => {
    const r = deriveFundingNextStep({ ...base, bounce });
    expect(r.nextStep).toEqual({ kind: 'ADVANCE', amount: '90000', externalLineId: 'line-1', customerNo: 'CU1', walletNo: 'WA1', available: '30000', lineAmount: '120000' });
  });
  it('余额够扣 / 已转补单 → 无', () => {
    expect(deriveFundingNextStep({ ...base, bounce: { ...bounce, availableMinor: 120_000n } }).nextStep).toBeUndefined();
    expect(deriveFundingNextStep({ ...base, bounce: { ...bounce, availableMinor: 0n, supplementNo: 'DEP1' } }).nextStep).toBeUndefined();
  });
  it('垫款单在走 / 已成功 → 只回挂状态，不再给按钮；失败 / 拒绝 / 撤回 → 回挂状态且按钮回来', () => {
    for (const status of ['PENDING_APPROVAL', 'EXECUTING', 'SUCCESS']) {
      const r = deriveFundingNextStep({ ...base, bounce, transfer: { transferNo: 'ITR1', purpose: 'CLIENT_ADVANCE', status, recognized: false } });
      expect(r.transfer?.status).toBe(status);
      expect(r.nextStep).toBeUndefined();
    }
    for (const status of ['FAILED', 'REJECTED', 'CANCELLED']) {
      const r = deriveFundingNextStep({ ...base, bounce, transfer: { transferNo: 'ITR1', purpose: 'CLIENT_ADVANCE', status, recognized: false } });
      expect(r.transfer?.status).toBe(status);
      expect(r.nextStep?.kind).toBe('ADVANCE');
    }
  });
});
