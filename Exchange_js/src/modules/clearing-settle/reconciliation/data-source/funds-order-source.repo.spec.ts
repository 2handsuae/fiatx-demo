import { Prisma } from '@prisma/client';
import { FundsOrderSourceRepo } from './funds-order-source.repo';

/**
 * C4: FundsOrderSourceRepo where-clause + shape mapping coverage.
 * The repo投影 funds_orders 行成旧表(payin/payout/internal/outstanding/feeAccrual) shape，
 * recon 消费方零改动。这里锁定每个方法的 where 条件（视角判别键）与 shape 映射。
 */
describe('FundsOrderSourceRepo', () => {
  let prisma: any;
  let repo: FundsOrderSourceRepo;
  const cutoff = new Date('2026-07-01T00:00:00.000Z');

  beforeEach(() => {
    prisma = { fundsOrder: { findMany: jest.fn().mockResolvedValue([]) } };
    repo = new FundsOrderSourceRepo(prisma);
  });

  const whereOf = () => prisma.fundsOrder.findMany.mock.calls[0][0].where;

  describe('findPayins — depositTransactionId != null', () => {
    it('filters deposit view + status + optional window and maps fundsOrderNo→payinNo', async () => {
      prisma.fundsOrder.findMany.mockResolvedValue([
        {
          id: 'f1', fundsOrderNo: 'FO-1', amount: new Prisma.Decimal('300'),
          txHash: '0xA', referenceNo: 'R1', createdAt: cutoff,
          toWallet: { id: 'w', vaultId: 'v', iban: null, walletRole: 'C_DEP' },
        },
      ]);
      const rows = await repo.findPayins({
        assetId: 'asset-usdt', status: 'CLEARED', createdAt: { gte: cutoff, lt: cutoff },
      });
      expect(whereOf()).toMatchObject({
        assetId: 'asset-usdt', status: 'CLEARED', depositTransactionId: { not: null },
        createdAt: { gte: cutoff, lt: cutoff },
      });
      expect(rows[0]).toMatchObject({ id: 'f1', payinNo: 'FO-1', txHash: '0xA', referenceNo: 'R1' });
      expect(rows[0].toWallet).toMatchObject({ vaultId: 'v', walletRole: 'C_DEP' });
    });

    it('omits createdAt when no window given', async () => {
      await repo.findPayins({ assetId: 'a', status: 'CLEARED' });
      expect(whereOf().createdAt).toBeUndefined();
    });
  });

  describe('findPayouts — withdrawTransactionId != null AND legSeq=1', () => {
    it('filters withdraw main leg (legSeq=1), no window; maps fundsOrderNo→payoutNo + ownerId via fromWallet', async () => {
      prisma.fundsOrder.findMany.mockResolvedValue([
        {
          id: 'f2', fundsOrderNo: 'FO-2', amount: new Prisma.Decimal('66'),
          txHash: null, referenceNo: 'WDR-1', createdAt: cutoff,
          fromWallet: { ownerId: 'cust-1' },
        },
      ]);
      const rows = await repo.findPayouts({ assetId: 'asset-aed', status: 'CLEARED' });
      expect(whereOf()).toMatchObject({
        assetId: 'asset-aed', status: 'CLEARED', withdrawTransactionId: { not: null }, legSeq: 1,
      });
      expect(rows[0]).toMatchObject({ id: 'f2', payoutNo: 'FO-2', referenceNo: 'WDR-1', ownerId: 'cust-1' });
    });

    it('ownerId is null when fromWallet missing', async () => {
      prisma.fundsOrder.findMany.mockResolvedValue([
        { id: 'f', fundsOrderNo: 'FO', amount: new Prisma.Decimal('1'), txHash: null, referenceNo: null, createdAt: cutoff, fromWallet: null },
      ]);
      const rows = await repo.findPayouts({ assetId: 'a', status: 'CLEARED' });
      expect(rows[0].ownerId).toBeNull();
    });
  });

  describe('findInternals — swapTransactionId != null OR (withdrawTransactionId != null AND legSeq>1)', () => {
    it('AND[0] carries the parent-FK OR (swap OR withdraw-fee-leg)', async () => {
      await repo.findInternals({ assetId: 'a', status: 'CLEARED', createdAt: { gte: cutoff, lt: cutoff } });
      const where = whereOf();
      expect(where).toMatchObject({ assetId: 'a', status: 'CLEARED', createdAt: { gte: cutoff, lt: cutoff } });
      expect(where.AND[0].OR).toEqual([
        { swapTransactionId: { not: null } },
        { AND: [{ withdrawTransactionId: { not: null } }, { legSeq: { gt: 1 } }] },
      ]);
    });

    it('requireExternalRef adds a second AND clause (txHash OR referenceNo)', async () => {
      await repo.findInternals({ assetId: 'a', status: 'CLEARED', requireExternalRef: true });
      const and = whereOf().AND;
      expect(and).toHaveLength(2);
      expect(and[1].OR).toEqual([{ txHash: { not: null } }, { referenceNo: { not: null } }]);
    });

    it('requireTxHash adds a top-level txHash filter', async () => {
      await repo.findInternals({ assetId: 'a', status: 'CLEARED', requireTxHash: true });
      expect(whereOf().txHash).toEqual({ not: null });
    });
  });

  describe('in-transit views — status IN(...) + createdAt < cutoff, amount only', () => {
    it('findPayinsInTransit filters deposit view + status set', async () => {
      await repo.findPayinsInTransit({ assetId: 'a', statuses: ['DETECTED', 'CONFIRMING'], cutoff });
      expect(whereOf()).toMatchObject({
        assetId: 'a', depositTransactionId: { not: null },
        status: { in: ['DETECTED', 'CONFIRMING'] }, createdAt: { lt: cutoff },
      });
    });

    it('findInternalsInTransit filters swap|withdraw-fee-leg + status set', async () => {
      await repo.findInternalsInTransit({ assetId: 'a', statuses: ['CREATED'], cutoff });
      const where = whereOf();
      expect(where).toMatchObject({ assetId: 'a', status: { in: ['CREATED'] }, createdAt: { lt: cutoff } });
      expect(where.OR).toEqual([
        { swapTransactionId: { not: null } },
        { AND: [{ withdrawTransactionId: { not: null } }, { legSeq: { gt: 1 } }] },
      ]);
    });
  });

  describe('five-formula RHS views', () => {
    it('findOpenOutstandings: in-flight statuses + currency + cutoff; direction from parent FK', async () => {
      prisma.fundsOrder.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal('10'), depositTransactionId: 'd', withdrawTransactionId: null, swapTransactionId: null },
        { amount: new Prisma.Decimal('4'), depositTransactionId: null, withdrawTransactionId: 'w', swapTransactionId: null },
        { amount: new Prisma.Decimal('7'), depositTransactionId: null, withdrawTransactionId: null, swapTransactionId: 's' },
      ]);
      const rows = await repo.findOpenOutstandings('USDT', cutoff);
      expect(whereOf()).toMatchObject({
        status: { in: ['SUBMITTED', 'CONFIRMING', 'CONFIRMED'] },
        asset: { is: { currency: 'USDT' } },
        createdAt: { lt: cutoff },
      });
      // deposit→IN, withdraw→OUT, swap→IN (conservative)
      expect(rows.map((r) => r.direction)).toEqual(['IN', 'OUT', 'IN']);
    });

    it('findFeeAccruals: withdraw fee legs (legSeq>1) in-flight + currency; amount only', async () => {
      await repo.findFeeAccruals('AED', cutoff);
      expect(whereOf()).toMatchObject({
        withdrawTransactionId: { not: null }, legSeq: { gt: 1 },
        status: { in: ['SUBMITTED', 'CONFIRMING', 'CONFIRMED'] },
        asset: { is: { currency: 'AED' } }, createdAt: { lt: cutoff },
      });
    });
  });
});
