import { Prisma } from '@prisma/client';
import { InternalActionsService } from './internal-actions.service';

describe('InternalActionsService', () => {
  let source: any;
  let svc: InternalActionsService;
  const businessDate = '2026-06-16';
  const cutoff = new Date('2026-06-17T00:00:00.000Z');

  beforeEach(() => {
    // C4: internal-actions reads funds_orders via FundsOrderSourceRepo (payin/payout/internal views).
    // Row-shape payloads below are byte-identical to the legacy table rows the collector consumes.
    source = {
      findInternals: jest.fn().mockResolvedValue([]),
      findPayins: jest.fn().mockResolvedValue([]),
      findPayouts: jest.fn().mockResolvedValue([]),
    };
    svc = new InternalActionsService(source);
  });

  it('collects internal_fund as IN keyed by txHash', async () => {
    source.findInternals.mockResolvedValue([
      { id: 'f1', fundsOrderNo: 'IF-1', amount: new Prisma.Decimal('60.76'), txHash: '0xFUND1', referenceNo: null },
    ]);
    const out = await svc.collect('asset-usdt', businessDate, cutoff);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sourceType: 'INTERNAL_FUND', sourceNo: 'IF-1', direction: 'IN', txHash: '0xFUND1' });
    expect(out[0].amount.toString()).toBe('60.76');
  });

  it('collects fiat internal_fund as IN keyed by referenceNo (no txHash)', async () => {
    source.findInternals.mockResolvedValue([
      { id: 'f2', fundsOrderNo: 'IFD-FIAT-1', amount: new Prisma.Decimal('333.58'), txHash: null, referenceNo: 'BANK-IFD-FIAT-1' },
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
    source.findPayins.mockResolvedValue([
      { id: 'p1', payinNo: 'PI-1', amount: new Prisma.Decimal('315.11'), txHash: '0xSEED51', referenceNo: 'REF-1' },
    ]);
    const out = await svc.collect('asset-usdt', businessDate, cutoff);
    const payin = out.find(a => a.sourceType === 'PAYIN');
    expect(payin).toMatchObject({ sourceNo: 'PI-1', direction: 'IN', txHash: '0xSEED51', referenceNo: 'REF-1' });
    expect(payin!.amount.toString()).toBe('315.11');
  });

  it('collects payout as OUT with match keys (no createdAt filter)', async () => {
    source.findPayouts.mockResolvedValue([
      { id: 'po1', payoutNo: 'PO-1', amount: new Prisma.Decimal('66.01'), txHash: '0xWDRPO-1', referenceNo: null },
    ]);
    const out = await svc.collect('asset-usdt', businessDate, cutoff);
    const payout = out.find(a => a.sourceType === 'PAYOUT');
    expect(payout).toMatchObject({ sourceNo: 'PO-1', direction: 'OUT', txHash: '0xWDRPO-1' });
    expect(payout!.amount.toString()).toBe('66.01');
    // payout view 查询不带 createdAt（CLEARED 即已物理出账）
    expect(source.findPayouts).toHaveBeenCalledWith({ assetId: 'asset-usdt', status: 'CLEARED' });
  });

  it('payin/internal_fund filtered to [day, cutoff); internal_fund requires a physical key (txHash OR referenceNo)', async () => {
    await svc.collect('asset-usdt', businessDate, cutoff);
    const start = new Date('2026-06-16T00:00:00.000Z');
    expect(source.findPayins).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'asset-usdt', status: 'CLEARED', createdAt: { gte: start, lt: cutoff } }),
    );
    // internal_fund 必须有外部物理键 txHash 或 referenceNo（requireExternalRef=true 让 repo 施加该过滤）
    expect(source.findInternals).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: 'asset-usdt',
        status: 'CLEARED',
        createdAt: { gte: start, lt: cutoff },
        requireExternalRef: true,
      }),
    );
  });
});
