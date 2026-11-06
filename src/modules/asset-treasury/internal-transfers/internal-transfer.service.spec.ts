import { InternalTransferService } from './internal-transfer.service';
import { InternalTransferStatus as S } from './dto/internal-transfer.dto';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';

describe('InternalTransferService (Task 5)', () => {
  const svc = (prisma: any = {}, accounting: any = {}, systemWallets: any = {}) => new InternalTransferService(prisma, accounting, systemWallets);

  describe('six states, six edges', () => {
    it.each([
      [S.PENDING_APPROVAL, S.EXECUTING], [S.PENDING_APPROVAL, S.FAILED], [S.PENDING_APPROVAL, S.REJECTED], [S.PENDING_APPROVAL, S.CANCELLED],
      [S.EXECUTING, S.SUCCESS], [S.EXECUTING, S.FAILED],
    ])('%s → %s allowed', (from, to) => { expect(() => svc().assertTransition(from, to)).not.toThrow(); });
    it.each([
      [S.EXECUTING, S.CANCELLED], [S.EXECUTING, S.REJECTED], [S.PENDING_APPROVAL, S.SUCCESS],
      [S.SUCCESS, S.FAILED], [S.FAILED, S.EXECUTING], [S.REJECTED, S.EXECUTING], [S.CANCELLED, S.PENDING_APPROVAL],
    ])('%s → %s rejected', (from, to) => { expect(() => svc().assertTransition(from, to)).toThrow(/Illegal internal transfer status transition/); });
  });

  describe('assertFirmOpsBalance — F_OPS 钱包现金户（借方户）可用 = 借 − 贷 − 贷挂起 ≥ 金额（戊波一 T8）', () => {
    const ASSETS: Record<string, any> = {
      AED: { id: 'asset-aed', currency: 'AED' },
      USDT: { id: 'asset-usdt', currency: 'USDT' },
    };
    const prismaOf = () => ({
      // 行为化：真按 where.currency 找资产，找不到返回 null
      asset: { findFirst: jest.fn(async ({ where }: any) => ASSETS[where.currency] ?? null) },
    });
    const walletsOf = () => ({ resolve: jest.fn(async (assetId: string) => ({ id: `w-ops-${assetId}` })) });
    const accounting = (debitsPosted: bigint, creditsPosted: bigint, creditsPending = 0n, debitsPending = 0n) => ({
      // 权益户（resolveTbAccountId）故意抛：闸不许再读它
      resolveTbAccountId: jest.fn(async () => { throw new Error('the gate must read the F_OPS cash account, not a SYSTEM account'); }),
      resolveCashAccountId: jest.fn(async (walletId: string, ledger: number) => BigInt(ledger) * 1000n + BigInt(walletId.length)),
      lookupBalance: jest.fn(async () => ({ debitsPosted, creditsPosted, debitsPending, creditsPending })),
    });
    const gate = (acc: any, wallets: any = walletsOf()) => svc(prismaOf(), acc, wallets);
    it('enough → allowed', async () => {
      await expect(gate(accounting(100_000_000_000n, 571_811_000n)).assertFirmOpsBalance('USDT', 7_500_000n)).resolves.toBeUndefined();
    });
    it('not enough → 400, message carries available / needed', async () => {
      await expect(gate(accounting(1_000n, 0n)).assertFirmOpsBalance('AED', 2_000n)).rejects.toThrow(/Insufficient.*available 1000.*need 2000/);
    });
    it('outflow-locked amount (credits pending) already counts as committed', async () => {
      await expect(gate(accounting(3_000n, 0n, 2_000n)).assertFirmOpsBalance('AED', 1_500n)).rejects.toThrow(/Insufficient.*available 1000/);
    });
    it('debits pending (inflow not yet posted) is not spendable and does not raise available', async () => {
      await expect(gate(accounting(1_000n, 0n, 0n, 9_000n)).assertFirmOpsBalance('AED', 2_000n)).rejects.toThrow(/Insufficient.*available 1000/);
    });
    it('reads the F_OPS wallet of the currency\'s asset, then that wallet\'s cash account on the currency ledger', async () => {
      const wallets = walletsOf();
      const acc = accounting(10n, 0n);
      await gate(acc, wallets).assertFirmOpsBalance('USDT', 1n);
      expect(wallets.resolve).toHaveBeenCalledWith('asset-usdt', 'F_OPS');
      expect(acc.resolveCashAccountId).toHaveBeenCalledWith('w-ops-asset-usdt', TB_LEDGERS.USDT);
      expect(acc.resolveTbAccountId).not.toHaveBeenCalled();
    });
    it('currency not on the ledger → 400', async () => {
      await expect(gate(accounting(1n, 0n)).assertFirmOpsBalance('BTC', 1n)).rejects.toThrow(/Unsupported currency/);
    });
  });

  describe('findBlockingBySource — blocks anything not yet finished or already succeeded; failed / rejected / cancelled do not block', () => {
    it('the query condition includes exactly these three statuses', async () => {
      const prisma = { internalTransfer: { findFirst: jest.fn(async ({ where }: any) => where) } };
      const where = await svc(prisma).findBlockingBySource({ sourceAdjustmentNo: 'ADJ-1' });
      expect(where).toEqual({ sourceAdjustmentNo: 'ADJ-1', status: { in: ['PENDING_APPROVAL', 'EXECUTING', 'SUCCESS'] } });
    });
  });

  describe('getView — Rule 6', () => {
    it('the projection carries no internal ids; the amount is formatted to precision; leg reference numbers are picked by asset type', async () => {
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
