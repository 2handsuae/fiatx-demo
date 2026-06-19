import { Prisma } from '@prisma/client';
import { InternalActionsService } from './internal-actions.service';

describe('InternalActionsService', () => {
  let prisma: any;
  let svc: InternalActionsService;
  const businessDate = '2026-06-16';
  const cutoff = new Date('2026-06-17T00:00:00.000Z');

  beforeEach(() => {
    prisma = {
      internalFund: { findMany: jest.fn().mockResolvedValue([]) },
      payin: { findMany: jest.fn().mockResolvedValue([]) },
      payout: { findMany: jest.fn().mockResolvedValue([]) },
    };
    svc = new InternalActionsService(prisma);
  });

  it('collects internal_fund as IN keyed by txHash', async () => {
    prisma.internalFund.findMany.mockResolvedValue([
      { id: 'f1', internalFundNo: 'IF-1', amount: new Prisma.Decimal('60.76'), txHash: '0xFUND1', referenceNo: null },
    ]);
    const out = await svc.collect('asset-usdt', businessDate, cutoff);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sourceType: 'INTERNAL_FUND', sourceNo: 'IF-1', direction: 'IN', txHash: '0xFUND1' });
    expect(out[0].amount.toString()).toBe('60.76');
  });

  it('collects fiat internal_fund as IN keyed by referenceNo (no txHash)', async () => {
    prisma.internalFund.findMany.mockResolvedValue([
      { id: 'f2', internalFundNo: 'IFD-FIAT-1', amount: new Prisma.Decimal('333.58'), txHash: null, referenceNo: 'BANK-IFD-FIAT-1' },
    ]);
    const out = await svc.collect('asset-aed', businessDate, cutoff);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      sourceType: 'INTERNAL_FUND', sourceNo: 'IFD-FIAT-1', direction: 'IN',
      txHash: null, referenceNo: 'BANK-IFD-FIAT-1',
    });
    expect(out[0].amount.toString()).toBe('333.58');
  });

  it('collects payin as IN with txHash + referenceNo match keys', async () => {
    prisma.payin.findMany.mockResolvedValue([
      { id: 'p1', payinNo: 'PI-1', amount: new Prisma.Decimal('315.11'), txHash: '0xSEED51', referenceNo: 'REF-1' },
    ]);
    const out = await svc.collect('asset-usdt', businessDate, cutoff);
    const payin = out.find(a => a.sourceType === 'PAYIN');
    expect(payin).toMatchObject({ sourceNo: 'PI-1', direction: 'IN', txHash: '0xSEED51', referenceNo: 'REF-1' });
    expect(payin!.amount.toString()).toBe('315.11');
  });

  it('collects payout as OUT with match keys (no createdAt filter)', async () => {
    prisma.payout.findMany.mockResolvedValue([
      { id: 'po1', payoutNo: 'PO-1', amount: new Prisma.Decimal('66.01'), txHash: '0xWDRPO-1', referenceNo: null },
    ]);
    const out = await svc.collect('asset-usdt', businessDate, cutoff);
    const payout = out.find(a => a.sourceType === 'PAYOUT');
    expect(payout).toMatchObject({ sourceNo: 'PO-1', direction: 'OUT', txHash: '0xWDRPO-1' });
    expect(payout!.amount.toString()).toBe('66.01');
    // payout 查询不带 createdAt（CLEARED 即已物理出账）
    expect(prisma.payout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assetId: 'asset-usdt', status: 'CLEARED' } }),
    );
  });

  it('payin/internal_fund filtered to [day, cutoff); internal_fund requires a physical key (txHash OR referenceNo)', async () => {
    await svc.collect('asset-usdt', businessDate, cutoff);
    const start = new Date('2026-06-16T00:00:00.000Z');
    expect(prisma.payin.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'CLEARED', createdAt: { gte: start, lt: cutoff } }) }),
    );
    // internal_fund 必须有外部物理键 txHash 或 referenceNo（无任何键的纯账内转账不进账实对账）
    expect(prisma.internalFund.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'CLEAR',
          createdAt: { gte: start, lt: cutoff },
          OR: [{ txHash: { not: null } }, { referenceNo: { not: null } }],
        }),
      }),
    );
  });
});
