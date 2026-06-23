import { pairManifest, ReconciliationQueryService } from './reconciliation-query.service';

// Helpers to build test fixtures concisely.
function mkBreak(
  currency: string,
  book: string,
  bucket: string,
  internalAmount: string | null,
  externalAmount: string | null,
  targetRef = 'REF-DISPLAY-ONLY',
) {
  return { currency, book, bucket, targetRef, internalAmount, externalAmount, targetType: '', signedDelta: '0', note: '' };
}

function mkItem(
  currency: string,
  book: string,
  bucket: string,
  internalAmount: unknown,
  externalAmount: unknown,
) {
  return {
    id: `item-${currency}-${bucket}`,
    matchStatus: bucket,
    internalSourceNo: null,
    internalTxHash: null,
    externalTxId: null,
    externalTxHash: null,
    internalAmount,
    externalAmount,
    _currency: currency,
    _book: book,
  };
}

describe('pairManifest — amount-keyed pairing', () => {
  it('pairs injected breaks vs detected line-items by (currency,book,bucket,primaryAmount)', () => {
    // AED ORPHAN_INTERNAL: both sides carry internalAmount = 500
    // USDT ORPHAN_EXTERNAL: both sides carry externalAmount = 200
    // extra: AED AMOUNT_MISMATCH not injected as a break
    const breaks = [
      mkBreak('AED', 'CLIENT', 'ORPHAN_INTERNAL', '500', null, 'REF-DEMO-1-AED'),
      mkBreak('USDT', 'FIRM',  'ORPHAN_EXTERNAL', null, '200', '0xDEMO2USDT'),
    ];
    const items = [
      mkItem('AED',  'CLIENT', 'ORPHAN_INTERNAL', '500', null),
      // extra — not in breaks
      mkItem('AED',  'CLIENT', 'AMOUNT_MISMATCH', '300', '310'),
    ];
    const r = pairManifest(breaks as any, items as any);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].break.currency).toBe('AED');
    expect(r.missed).toHaveLength(1);   // USDT FIRM orphan-external — no item
    expect(r.missed[0].currency).toBe('USDT');
    expect(r.extra).toHaveLength(1);    // AED amount-mismatch not claimed
    expect(r.extra[0].matchStatus).toBe('AMOUNT_MISMATCH');
  });

  it('pairs when item externalAmount drives primaryAmount (ORPHAN_EXTERNAL, no internalAmount)', () => {
    const breaks = [mkBreak('USDT', 'CLIENT', 'ORPHAN_EXTERNAL', null, '999.5', '0xEXT123')];
    const items  = [mkItem('USDT', 'CLIENT', 'ORPHAN_EXTERNAL', null, '999.5')];
    const r = pairManifest(breaks as any, items as any);
    expect(r.matched).toHaveLength(1);
    expect(r.missed).toHaveLength(0);
    expect(r.extra).toHaveLength(0);
  });

  it('pairs AMOUNT_MISMATCH break using internalAmount (takes precedence over externalAmount)', () => {
    // For AMOUNT_MISMATCH both internal and external are present; primaryAmount = internalAmount.
    const breaks = [mkBreak('USDT', 'CLIENT', 'AMOUNT_MISMATCH', '1000', '900', '0xTXHASH1')];
    const items  = [mkItem('USDT', 'CLIENT', 'AMOUNT_MISMATCH', '1000', '900')];
    const r = pairManifest(breaks as any, items as any);
    expect(r.matched).toHaveLength(1);
    expect(r.missed).toHaveLength(0);
    expect(r.extra).toHaveLength(0);
  });

  it('returns all missed when no items exist', () => {
    const breaks = [mkBreak('AED', 'CLIENT', 'ORPHAN_INTERNAL', '500', null)];
    const r = pairManifest(breaks as any, []);
    expect(r.matched).toHaveLength(0);
    expect(r.missed).toHaveLength(1);
    expect(r.extra).toHaveLength(0);
  });

  it('returns all extra when no breaks exist', () => {
    const items = [mkItem('AED', 'CLIENT', 'AMOUNT_MISMATCH', '300', '310')];
    const r = pairManifest([], items as any);
    expect(r.matched).toHaveLength(0);
    expect(r.missed).toHaveLength(0);
    expect(r.extra).toHaveLength(1);
  });

  it('amount disambiguates two breaks with same (currency,book,bucket) but different amounts', () => {
    // Two AED ORPHAN_INTERNAL breaks at different amounts — must pair each to its own item.
    const breaks = [
      mkBreak('AED', 'CLIENT', 'ORPHAN_INTERNAL', '100', null, 'REF-A'),
      mkBreak('AED', 'CLIENT', 'ORPHAN_INTERNAL', '250', null, 'REF-B'),
    ];
    const items = [
      mkItem('AED', 'CLIENT', 'ORPHAN_INTERNAL', '250', null), // listed first — should pair to REF-B
      mkItem('AED', 'CLIENT', 'ORPHAN_INTERNAL', '100', null), // should pair to REF-A
    ];
    const r = pairManifest(breaks as any, items as any);
    expect(r.matched).toHaveLength(2);
    expect(r.missed).toHaveLength(0);
    expect(r.extra).toHaveLength(0);
    // REF-A (100) should match the item with internalAmount=100
    const matchA = r.matched.find((m) => m.break.targetRef === 'REF-A');
    expect(matchA?.item.internalAmount).toBe('100');
    // REF-B (250) should match the item with internalAmount=250
    const matchB = r.matched.find((m) => m.break.targetRef === 'REF-B');
    expect(matchB?.item.internalAmount).toBe('250');
  });
});

describe('getExternalBalance — statement lines scoped to the balance business day', () => {
  it('filters lines by the balance cutoffDate day window (no multi-day bleed)', async () => {
    const balance = {
      id: 'b1', statementId: 'STMT-20260622-ZAND-C-CMA-AED-0001',
      source: 'ZAND', accountRef: 'C_CMA-AED-0001', currency: 'AED', cutoffDate: '2026-06-22',
    };
    const prisma = {
      externalBalance: { findFirst: jest.fn().mockResolvedValue(balance) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new ReconciliationQueryService(prisma as any);
    await svc.getExternalBalance(balance.statementId);
    expect(prisma.externalStatementLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: 'ZAND',
          accountRef: 'C_CMA-AED-0001',
          currency: 'AED',
          datetime: {
            gte: new Date('2026-06-22T00:00:00.000Z'),
            lte: new Date('2026-06-22T23:59:59.999Z'),
          },
        }),
      }),
    );
  });
});
