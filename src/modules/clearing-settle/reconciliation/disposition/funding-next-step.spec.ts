import { deriveFundingNextStep } from './funding-next-step';

describe('deriveFundingNextStep（平账二期 Task 8）', () => {
  const base = { book: 'CLIENT' as const, customerNo: 'CU1', walletNo: 'WA1' };
  const postedLoss = { adjustmentNo: 'ADJ1', status: 'POSTED', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', amount: '7500000' };

  it('认损已落账、无划转单 → 待补款', () => {
    expect(deriveFundingNextStep({ ...base, adjustment: postedLoss }).nextStep).toEqual({ kind: 'COMPENSATION', adjustmentNo: 'ADJ1', amount: '7500000', customerNo: 'CU1', walletNo: 'WA1' });
  });
  it('认损未落账 → 无', () => {
    expect(deriveFundingNextStep({ ...base, adjustment: { ...postedLoss, status: 'PENDING_APPROVAL' } }).nextStep).toBeUndefined();
  });
  it('公司池核销不是补款来源', () => {
    expect(deriveFundingNextStep({ ...base, book: 'FIRM', adjustment: { ...postedLoss, reasonCode: 'UNEXPLAINED_WRITE_OFF' } }).nextStep).toBeUndefined();
  });
  // 评审 Finding 1：上一条同时翻转 book 与 reasonCode，删掉任一守卫都仍是绿——
  // 补两条各自单翻一个变量的用例，book 守卫、reasonCode 守卫各自可红。
  it('CLIENT 落账但事由是核销（非客损）→ 无（单独验证 reasonCode 守卫）', () => {
    expect(deriveFundingNextStep({ ...base, adjustment: { ...postedLoss, reasonCode: 'UNEXPLAINED_WRITE_OFF' } }).nextStep).toBeUndefined();
  });
  it('FIRM 落账客损事由（书本不对）→ 无（单独验证 book 守卫）', () => {
    expect(deriveFundingNextStep({ ...base, book: 'FIRM', adjustment: postedLoss }).nextStep).toBeUndefined();
  });
  it('已有划转单在走 / 已成功 → 只回挂状态，不再给按钮', () => {
    const r = deriveFundingNextStep({ ...base, adjustment: postedLoss, transfer: { transferNo: 'ITR1', purpose: 'CLIENT_COMPENSATION', status: 'EXECUTING' } });
    expect(r.transfer).toEqual({ transferNo: 'ITR1', purpose: 'CLIENT_COMPENSATION', status: 'EXECUTING' });
    expect(r.nextStep).toBeUndefined();
  });
  it('划转单失败 / 拒绝 / 撤回 → 回挂状态且按钮回来', () => {
    for (const status of ['FAILED', 'REJECTED', 'CANCELLED']) {
      const r = deriveFundingNextStep({ ...base, adjustment: postedLoss, transfer: { transferNo: 'ITR1', purpose: 'CLIENT_COMPENSATION', status } });
      expect(r.transfer?.status).toBe(status);
      expect(r.nextStep?.kind).toBe('COMPENSATION');
    }
  });
  it('退汇行余额不足 → 待垫款，金额 = 账单行 − 可用', () => {
    const r = deriveFundingNextStep({ ...base, bounce: { externalLineId: 'line-1', lineAmountMinor: 120_000n, availableMinor: 30_000n, supplementNo: null } });
    expect(r.nextStep).toEqual({ kind: 'ADVANCE', amount: '90000', externalLineId: 'line-1', customerNo: 'CU1', walletNo: 'WA1', available: '30000', lineAmount: '120000' });
  });
  it('余额够扣 / 已转补单 → 无', () => {
    expect(deriveFundingNextStep({ ...base, bounce: { externalLineId: 'line-1', lineAmountMinor: 120_000n, availableMinor: 120_000n, supplementNo: null } }).nextStep).toBeUndefined();
    expect(deriveFundingNextStep({ ...base, bounce: { externalLineId: 'line-1', lineAmountMinor: 120_000n, availableMinor: 0n, supplementNo: 'DEP1' } }).nextStep).toBeUndefined();
  });
});
