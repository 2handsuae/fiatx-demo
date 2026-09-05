import { InternalTransferService } from './internal-transfer.service';
import { InternalTransferStatus as S } from './dto/internal-transfer.dto';

describe('InternalTransferService（平账二期 Task 5）', () => {
  const svc = (prisma: any = {}, accounting: any = {}) => new InternalTransferService(prisma, accounting);

  describe('六态六边', () => {
    it.each([
      [S.PENDING_APPROVAL, S.EXECUTING], [S.PENDING_APPROVAL, S.FAILED], [S.PENDING_APPROVAL, S.REJECTED], [S.PENDING_APPROVAL, S.CANCELLED],
      [S.EXECUTING, S.SUCCESS], [S.EXECUTING, S.FAILED],
    ])('%s → %s 放行', (from, to) => { expect(() => svc().assertTransition(from, to)).not.toThrow(); });
    it.each([
      [S.EXECUTING, S.CANCELLED], [S.EXECUTING, S.REJECTED], [S.PENDING_APPROVAL, S.SUCCESS],
      [S.SUCCESS, S.FAILED], [S.FAILED, S.EXECUTING], [S.REJECTED, S.EXECUTING], [S.CANCELLED, S.PENDING_APPROVAL],
    ])('%s → %s 拒', (from, to) => { expect(() => svc().assertTransition(from, to)).toThrow(/非法状态迁移/); });
  });

  describe('assertFirmOpsBalance —— 运营户贷方常态净额（贷 − 借 − 待过账借）≥ 金额', () => {
    const accounting = (creditsPosted: bigint, debitsPosted: bigint, debitsPending = 0n) => ({
      resolveTbAccountId: jest.fn(async () => 1n),
      lookupBalance: jest.fn(async () => ({ creditsPosted, debitsPosted, debitsPending, creditsPending: 0n })),
    });
    it('够 → 放行', async () => {
      await expect(svc({}, accounting(100_000_000_000n, 571_811_000n)).assertFirmOpsBalance('USDT', 7_500_000n)).resolves.toBeUndefined();
    });
    it('不够 → 400，文案带可用 / 需要', async () => {
      await expect(svc({}, accounting(1_000n, 0n)).assertFirmOpsBalance('AED', 2_000n)).rejects.toThrow(/余额不足.*可用 1000.*需要 2000/);
    });
    it('待过账的借方也算占用', async () => {
      await expect(svc({}, accounting(3_000n, 0n, 2_000n)).assertFirmOpsBalance('AED', 1_500n)).rejects.toThrow(/余额不足/);
    });
    it('币种不在账本 → 400', async () => {
      await expect(svc({}, accounting(1n, 0n)).assertFirmOpsBalance('BTC', 1n)).rejects.toThrow(/不支持的币种/);
    });
  });

  describe('findBlockingBySource —— 未走完或已成功都挡，失败 / 拒绝 / 撤回不挡', () => {
    it('查询条件含且仅含三种状态', async () => {
      const prisma = { internalTransfer: { findFirst: jest.fn(async ({ where }: any) => where) } };
      const where = await svc(prisma).findBlockingBySource({ sourceAdjustmentNo: 'ADJ-1' });
      expect(where).toEqual({ sourceAdjustmentNo: 'ADJ-1', status: { in: ['PENDING_APPROVAL', 'EXECUTING', 'SUCCESS'] } });
    });
  });

  describe('getView —— 铁律⑥', () => {
    it('投影不含任何内部 id；金额按精度定位；腿参考号按资产类型取', async () => {
      const row = {
        id: 'uuid-itr', transferNo: 'ITR1', purpose: 'CLIENT_COMPENSATION', status: 'SUCCESS', customerId: 'uuid-cu', customerNo: 'CU1',
        asset: { code: 'USDT-TRON', currency: 'USDT', decimals: 6 }, amount: '7.5', reason: 'r', sourceCaseNo: 'REC1',
        sourceAdjustmentNo: 'ADJ1', sourceExternalLineId: 'uuid-line', approvalNo: 'APR1', failureReasonCode: null, failureNote: null,
        fromWalletId: 'uuid-w1', viaWalletId: null, toWalletId: 'uuid-w2', createdByUserId: 'ADM1',
        createdAt: new Date('2026-09-05T00:00:00Z'), executedAt: null, settledAt: null,
      };
      const prisma = {
        internalTransfer: { findUnique: jest.fn(async () => row) },
        fundsOrder: { findMany: jest.fn(async () => [{ fundsOrderNo: 'FO1', legSeq: 1, status: 'CLEARED', txHash: '0xabc', referenceNo: null, fromWallet: { walletNo: 'WA1' }, toWallet: { walletNo: 'WA2' }, asset: { type: 'CRYPTO' } }]) },
        wallet: { findMany: jest.fn(async () => [{ id: 'uuid-w1', walletNo: 'WA1' }, { id: 'uuid-w2', walletNo: 'WA2' }]) },
        externalStatementLine: { findUnique: jest.fn(async () => ({ externalRef: 'BANK-REF-9' })) },
      };
      const view = await svc(prisma).getView('ITR1');
      const json = JSON.stringify(view);
      for (const forbidden of ['uuid-itr', 'uuid-cu', 'uuid-line', 'uuid-w1', 'uuid-w2']) expect(json).not.toContain(forbidden);
      expect(view).toMatchObject({ transferNo: 'ITR1', amount: '7.500000', fromWalletNo: 'WA1', viaWalletNo: null, toWalletNo: 'WA2', sourceExternalRef: 'BANK-REF-9', legs: [{ fundsOrderNo: 'FO1', externalRef: '0xabc' }] });
    });
  });
});
